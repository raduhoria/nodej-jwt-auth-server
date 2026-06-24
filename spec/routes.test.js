const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const request = require("supertest");
const routes = require("../src/routes");

const config = {
	get(key) {
		return {
			"secret.secret_key": "test-access-secret",
			"secret.secret_key_refresh": "test-refresh-secret",
			"secret.expires": "5m",
			"secret.refresh_expires": "30m"
		}[key];
	}
};

const createTestApp = () => {
	const user = {
		id: 1,
		email: "demo@example.com",
		role: "user",
		refresh_token: null
	};

	const db = {
		async getUserByUsernameAndPassword(username, password) {
			if (username === user.email && password === "DemoPass123!") {
				return user;
			}

			return null;
		},

		async updateUserRefreshToken(id, refreshToken) {
			if (id === user.id) {
				user.refresh_token = refreshToken;
			}
		},

		async getUser(id) {
			return id === user.id ? user : null;
		},

		async generateAccounts() {
			return { affectedRows: 0 };
		}
	};

	const app = express();
	app.use(express.json());
	app.use(routes.createRouter({
		db,
		config,
		pkg: {
			version: "test",
			description: "Test JWT auth service"
		}
	}));

	return { app, user };
};

test("returns a service profile", async () => {
	const { app } = createTestApp();

	const response = await request(app)
		.get("/")
		.expect(200);

	assert.equal(response.body.service, "JWT Auth Server");
	assert.equal(response.body.version, "test");
	assert.equal(response.body.endpoints.login, "POST /login");
});

test("validates missing login credentials", async () => {
	const { app } = createTestApp();

	const response = await request(app)
		.post("/login")
		.send({})
		.expect(400);

	assert.equal(response.body.ErrorCode, "invalid_request");
});

test("runs login, refresh, and logout flow", async () => {
	const { app, user } = createTestApp();

	const login = await request(app)
		.post("/login")
		.send({
			username: "demo@example.com",
			password: "DemoPass123!"
		})
		.expect(200);

	assert.equal(login.body.error, false);
	assert.ok(login.body.accessToken);
	assert.ok(login.body.refreshToken);
	assert.equal(user.refresh_token, login.body.refreshToken);

	const refresh = await request(app)
		.post("/refresh")
		.send({ refreshToken: login.body.refreshToken })
		.expect(200);

	assert.equal(refresh.body.error, false);
	assert.ok(refresh.body.accessToken);

	const logout = await request(app)
		.post("/logout")
		.set("Authorization", `Bearer ${login.body.accessToken}`)
		.expect(200);

	assert.equal(logout.body.message, "success");
	assert.equal(user.refresh_token, null);
});
