const http = require("http");
const { spawn } = require("child_process");
const { performance } = require("perf_hooks");
const os = require("os");
const bcrypt = require("bcrypt");
const config = require("config");
const mysql = require("mysql2/promise");

const userCount = Number(process.env.BENCHMARK_USERS || 10000);
const targetRps = Number(process.env.BENCHMARK_RPS || 100);
const durationSeconds = Number(process.env.BENCHMARK_DURATION || 60);
const password = process.env.BENCHMARK_PASSWORD || "BenchmarkPass123!";
const benchmarkEmailPrefix = "benchmark-";
const benchmarkEmailDomain = "example.com";
const serverHost = "127.0.0.1";
const serverPort = Number(config.get("server.port"));
const dbConfig = {
	host: config.get("dbserver.host"),
	port: config.get("dbserver.port"),
	user: config.get("dbserver.user"),
	password: config.get("dbserver.password"),
	database: config.get("dbserver.database")
};

const agent = new http.Agent({
	keepAlive: true,
	maxSockets: Math.max(256, targetRps * 4)
});

const percentile = (values, percentileValue) => {
	if (values.length === 0) {
		return 0;
	}

	const index = Math.ceil((percentileValue / 100) * values.length) - 1;
	return values[Math.min(Math.max(index, 0), values.length - 1)];
};

const requestJson = ({ method = "GET", path, body }) => new Promise((resolve, reject) => {
	const payload = body ? JSON.stringify(body) : null;
	const request = http.request({
		agent,
		hostname: serverHost,
		port: serverPort,
		path,
		method,
		headers: payload ? {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(payload)
		} : undefined,
		timeout: 15000
	}, (response) => {
		response.resume();
		response.on("end", () => resolve(response.statusCode));
	});

	request.on("error", reject);
	request.on("timeout", () => {
		request.destroy(new Error(`Request timed out: ${method} ${path}`));
	});

	if (payload) {
		request.write(payload);
	}

	request.end();
});

const isServerHealthy = async () => {
	try {
		return await requestJson({ path: "/health" }) === 200;
	} catch (_) {
		return false;
	}
};

const waitForServer = async (serverProcess) => {
	const output = [];

	if (serverProcess.stdout) {
		serverProcess.stdout.on("data", (chunk) => output.push(chunk.toString()));
	}

	if (serverProcess.stderr) {
		serverProcess.stderr.on("data", (chunk) => output.push(chunk.toString()));
	}

	const startedAt = Date.now();
	while (Date.now() - startedAt < 30000) {
		if (await isServerHealthy()) {
			return output;
		}

		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	throw new Error(`Server did not become healthy within 30s.\n${output.join("")}`);
};

const stopServer = async (serverProcess) => {
	if (!serverProcess || serverProcess.killed) {
		return;
	}

	serverProcess.kill("SIGINT");

	await Promise.race([
		new Promise((resolve) => serverProcess.once("exit", resolve)),
		new Promise((resolve) => setTimeout(resolve, 5000))
	]);

	if (!serverProcess.killed) {
		serverProcess.kill("SIGKILL");
	}
};

const ensureBenchmarkUsers = async () => {
	const connection = await mysql.createConnection(dbConfig);

	try {
		await connection.query(`
			CREATE TABLE IF NOT EXISTS users (
				id INT AUTO_INCREMENT PRIMARY KEY,
				email VARCHAR(255) NOT NULL UNIQUE,
				name VARCHAR(255),
				password VARCHAR(255) NOT NULL,
				language VARCHAR(10),
				role VARCHAR(50) DEFAULT 'user',
				refresh_token TEXT
			)
		`);

		await connection.query(
			"DELETE FROM users WHERE email LIKE ?",
			[`${benchmarkEmailPrefix}%@${benchmarkEmailDomain}`]
		);

		const passwordHash = await bcrypt.hash(password, 10);
		const chunkSize = 1000;

		for (let offset = 0; offset < userCount; offset += chunkSize) {
			const rows = [];
			const limit = Math.min(offset + chunkSize, userCount);

			for (let index = offset; index < limit; index++) {
				rows.push([
					`${benchmarkEmailPrefix}${String(index).padStart(5, "0")}@${benchmarkEmailDomain}`,
					`Benchmark User ${index}`,
					passwordHash,
					"en",
					"user",
					null
				]);
			}

			await connection.query(
				"INSERT INTO users (email, name, password, language, role, refresh_token) VALUES ?",
				[rows]
			);
		}

		const [[{ count }]] = await connection.query(
			"SELECT COUNT(*) AS count FROM users WHERE email LIKE ?",
			[`${benchmarkEmailPrefix}%@${benchmarkEmailDomain}`]
		);

		return Number(count);
	} finally {
		await connection.end();
	}
};

const runBenchmark = async () => {
	const totalRequests = targetRps * durationSeconds;
	const intervalMs = 1000 / targetRps;
	const latencies = [];
	const statusCounts = {};
	let sent = 0;
	let completed = 0;
	let failed = 0;
	let inFlight = 0;
	let maxInFlight = 0;
	let firstSentAt = 0;
	let lastSentAt = 0;
	let lastCompletedAt = 0;

	const makeLoginRequest = async (index) => {
		const userIndex = index % userCount;
		const username = `${benchmarkEmailPrefix}${String(userIndex).padStart(5, "0")}@${benchmarkEmailDomain}`;
		const startedAt = performance.now();

		try {
			const statusCode = await requestJson({
				method: "POST",
				path: "/login",
				body: {
					username,
					password
				}
			});

			statusCounts[statusCode] = (statusCounts[statusCode] || 0) + 1;
			if (statusCode >= 400) {
				failed += 1;
			}
		} catch (_) {
			failed += 1;
			statusCounts.error = (statusCounts.error || 0) + 1;
		} finally {
			latencies.push(performance.now() - startedAt);
			completed += 1;
			inFlight -= 1;
			lastCompletedAt = performance.now();
		}
	};

	const scheduledAt = performance.now();

	await new Promise((resolve) => {
		const interval = setInterval(() => {
			if (sent >= totalRequests) {
				clearInterval(interval);
				resolve();
				return;
			}

			if (sent === 0) {
				firstSentAt = performance.now();
			}

			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			lastSentAt = performance.now();
			makeLoginRequest(sent);
			sent += 1;
		}, intervalMs);
	});

	while (completed < sent) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	latencies.sort((a, b) => a - b);
	const wallTimeSeconds = (lastCompletedAt - firstSentAt) / 1000;
	const scheduleSeconds = (lastSentAt - scheduledAt) / 1000;

	return {
		targetRps,
		durationSeconds,
		userCount,
		totalRequests,
		sent,
		completed,
		failed,
		successful: completed - failed,
		statusCounts,
		achievedRps: Number((completed / wallTimeSeconds).toFixed(2)),
		scheduleRps: Number((sent / scheduleSeconds).toFixed(2)),
		maxInFlight,
		latencyMs: {
			min: Number((latencies[0] || 0).toFixed(2)),
			avg: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
			p50: Number(percentile(latencies, 50).toFixed(2)),
			p90: Number(percentile(latencies, 90).toFixed(2)),
			p95: Number(percentile(latencies, 95).toFixed(2)),
			p99: Number(percentile(latencies, 99).toFixed(2)),
			max: Number((latencies[latencies.length - 1] || 0).toFixed(2))
		}
	};
};

const main = async () => {
	console.log(`Preparing ${userCount} benchmark users in MySQL ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}...`);
	const seededUsers = await ensureBenchmarkUsers();
	console.log(`Seeded benchmark users: ${seededUsers}`);

	let serverProcess = null;
	const serverWasRunning = await isServerHealthy();

	if (!serverWasRunning) {
		console.log(`Starting API server on ${serverHost}:${serverPort}...`);
		serverProcess = spawn(process.execPath, ["server.js"], {
			cwd: process.cwd(),
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"]
		});
		await waitForServer(serverProcess);
	}

	try {
		console.log(`Running login benchmark: ${targetRps} req/s for ${durationSeconds}s...`);
		const result = await runBenchmark();
		console.log(JSON.stringify({
			node: process.version,
			cpus: os.cpus().length,
			api: `${serverHost}:${serverPort}`,
			mysql: `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
			...result
		}, null, 2));
	} finally {
		await stopServer(serverProcess);
		agent.destroy();
	}
};

main().catch((error) => {
	console.error(error);
	agent.destroy();
	process.exit(1);
});
