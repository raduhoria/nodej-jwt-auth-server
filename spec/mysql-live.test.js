process.env.NODE_CONFIG = JSON.stringify({
	server: {
		withlocalcache: true
	}
});

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const config = require("config");
const mysql = require("mysql2/promise");
const request = require("supertest");
const db = require("../src/db");
const routes = require("../src/routes");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, label, timeoutMs = 8000) => {
	const start = Date.now();

	while (Date.now() - start < timeoutMs) {
		if (predicate()) {
			return;
		}

		await sleep(100);
	}

	throw new Error(`Timed out waiting for ${label}`);
};

test("runs auth flow and updates local cache from MySQL binlog", async (t) => {
	t.after(async () => {
		await db.seedTestUser();
		await db.close();
	});

	await db.seedTestUser();
	await db.startCacheWatcher();

	const app = express();
	app.use(express.json());
	app.use(routes);

	const login = await request(app)
		.post("/login")
		.send({
			username: "demo@example.com",
			password: "DemoPass123!"
		})
		.expect(200);

	assert.ok(login.body.accessToken);
	assert.ok(login.body.refreshToken);

	const refresh = await request(app)
		.post("/refresh")
		.send({ refreshToken: login.body.refreshToken })
		.expect(200);

	assert.ok(refresh.body.accessToken);

	const connection = await mysql.createConnection({
		host: config.get("dbserver.host"),
		port: config.get("dbserver.port"),
		user: config.get("dbserver.user"),
		password: config.get("dbserver.password"),
		database: config.get("dbserver.database")
	});

	await connection.execute(
		"UPDATE users SET name = ? WHERE email = ?",
		["Binlog Demo User", "demo@example.com"]
	);
	await connection.end();

	await waitFor(() => {
		const user = db.cachedata.find((item) => item.email === "demo@example.com");
		return user && user.name === "Binlog Demo User";
	}, "binlog cache update");

	const logout = await request(app)
		.post("/logout")
		.set("Authorization", `Bearer ${login.body.accessToken}`)
		.expect(200);

	assert.equal(logout.body.message, "success");
});
