const bcrypt = require("bcrypt");
const config = require("config");
const MySQLEvents = require("@rodrigogs/mysql-events");
const mysql = require("mysql2/promise");

const db = {
	cachedata: []
};

const pool = mysql.createPool({
	connectionLimit: config.get("dbserver.connectionLimit"),
	password: config.get("dbserver.password"),
	user: config.get("dbserver.user"),
	database: config.get("dbserver.database"),
	host: config.get("dbserver.host"),
	port: config.get("dbserver.port"),
	waitForConnections: true
});

const useLocalCache = () => Boolean(config.get("server.withlocalcache"));
let cacheWatcher = null;
let cacheWatcherStartPromise = null;

const isBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(value || "");

const normalizeUser = (user) => user || null;

const updateCacheUser = (user) => {
	if (!user || !user.id) {
		return;
	}

	const foundIndex = db.cachedata.findIndex((item) => item.id === user.id);
	if (foundIndex === -1) {
		db.cachedata.push(user);
		return;
	}

	db.cachedata[foundIndex] = user;
};

const removeCacheUser = (id) => {
	const foundIndex = db.cachedata.findIndex((item) => item.id === id);
	if (foundIndex !== -1) {
		db.cachedata.splice(foundIndex, 1);
	}
};

const applyCacheEvent = (event) => {
	if (!event || event.table !== "users") {
		return;
	}

	for (const row of event.affectedRows || []) {
		if (event.type === "DELETE") {
			removeCacheUser(row.before && row.before.id);
			continue;
		}

		updateCacheUser(row.after);
	}
};

const passwordMatches = async (candidatePassword, storedPassword) => {
	if (!storedPassword) {
		return false;
	}

	if (isBcryptHash(storedPassword)) {
		return bcrypt.compare(candidatePassword, storedPassword);
	}

	return candidatePassword === storedPassword;
};

db.getUsers = async () => {
	const [results] = await pool.query("SELECT * FROM users");
	return results;
};

db.getUser = async (id) => {
	if (useLocalCache()) {
		const cached = db.cachedata.find((user) => user.id === id);
		if (cached) {
			return cached;
		}
	}

	const [results] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
	return normalizeUser(results[0]);
};

db.getUserByEmail = async (email) => {
	if (useLocalCache()) {
		const cached = db.cachedata.find((user) => user.email === email);
		if (cached) {
			return cached;
		}
	}

	const [results] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
	return normalizeUser(results[0]);
};

db.getUserByUsernameAndPassword = async (username, password) => {
	const user = await db.getUserByEmail(username);
	if (!user) {
		return null;
	}

	const matches = await passwordMatches(password, user.password);
	return matches ? user : null;
};

db.updateUserRefreshToken = async (id, refresh_token) => {
	const [result] = await pool.query(
		"UPDATE users SET refresh_token = ? WHERE id = ?",
		[refresh_token, id]
	);

	if (useLocalCache()) {
		const user = await db.getUser(id);
		if (user) {
			user.refresh_token = refresh_token;
			updateCacheUser(user);
		}
	}

	return result;
};

db.ensureUsersTable = async () => {
	await pool.query(`
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
};

db.seedTestUser = async ({
	email = "demo@example.com",
	name = "Demo User",
	password = "DemoPass123!",
	language = "en",
	role = "user"
} = {}) => {
	await db.ensureUsersTable();

	const passwordHash = await bcrypt.hash(password, 10);
	await pool.query(
		`INSERT INTO users (email, name, password, language, role, refresh_token)
		 VALUES (?, ?, ?, ?, ?, NULL)
		 ON DUPLICATE KEY UPDATE
			name = VALUES(name),
			password = VALUES(password),
			language = VALUES(language),
			role = VALUES(role),
			refresh_token = NULL`,
		[email, name, passwordHash, language, role]
	);

	const [users] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
	const user = normalizeUser(users[0]);
	updateCacheUser(user);

	return {
		id: user.id,
		email,
		name,
		language,
		role,
		password
	};
};

db.generateAccounts = async () => {
	const passwordHash = await bcrypt.hash("DemoPass123!", 10);
	const items = [];

	for (let i = 0, count = 10000; i < count; i++) {
		items.push({
			email: `radu.horia${i}@gmail.com`,
			name: "Horia",
			password: passwordHash,
			language: "ro",
			role: "user"
		});
	}

	const [result] = await pool.query(
		"INSERT INTO users (email, name, password, language, role) VALUES ?",
		[items.map((item) => [item.email, item.name, item.password, item.language, item.role])]
	);

	return result;
};

db.refreshCache = async () => {
	db.cachedata = JSON.parse(JSON.stringify(await db.getUsers()));
	return db.cachedata;
};

db.startCacheWatcher = async () => {
	if (!useLocalCache() || cacheWatcher) {
		return;
	}

	if (cacheWatcherStartPromise) {
		return cacheWatcherStartPromise;
	}

	cacheWatcherStartPromise = (async () => {
		await db.refreshCache();

		cacheWatcher = new MySQLEvents(
			{
			host: config.get("dbserver.host"),
			user: config.get("dbserver.user"),
			password: config.get("dbserver.password"),
			port: config.get("dbserver.port")
		},
			{
				startAtEnd: true
			}
		);

		await cacheWatcher.start();

		cacheWatcher.addTrigger({
			name: "users-cache",
			expression: `${config.get("dbserver.database")}.users`,
			statement: MySQLEvents.STATEMENTS.ALL,
			onEvent: applyCacheEvent
		});

		cacheWatcher.on(MySQLEvents.EVENTS.CONNECTION_ERROR, (error) => {
			console.error("MySQL cache watcher connection error:", error.message);
		});

		cacheWatcher.on(MySQLEvents.EVENTS.ZONGJI_ERROR, (error) => {
			console.error("MySQL cache watcher binlog error:", error.message);
		});
	})();

	try {
		await cacheWatcherStartPromise;
	} finally {
		cacheWatcherStartPromise = null;
	}
};

db.stopCacheWatcher = () => {
	if (!cacheWatcher) {
		return;
	}

	cacheWatcher.stop();
	cacheWatcher = null;
	cacheWatcherStartPromise = null;
};

db.close = async () => {
	db.stopCacheWatcher();
	await pool.end();
};

if (useLocalCache()) {
	db.startCacheWatcher().catch((error) => {
		console.error("Failed to start local users cache watcher:", error.message);
	});
}

module.exports = db;
