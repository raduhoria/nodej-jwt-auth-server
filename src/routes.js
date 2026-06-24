const express = require("express");
const defaultConfig = require("config");
const defaultDb = require("./db");
const defaultJwt = require("jsonwebtoken");
const defaultPkg = require("../package.json");

const getConfigValue = (config, key) => {
	if (typeof config.get === "function") {
		return config.get(key);
	}

	return key.split(".").reduce((value, part) => value && value[part], config);
};

const getBearerToken = (authorizationHeader) => {
	if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
		return null;
	}

	return authorizationHeader.substring(7);
};

const getBasicCredentials = (authorizationHeader) => {
	if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
		return null;
	}

	const decoded = Buffer.from(authorizationHeader.substring(6), "base64").toString();
	const separatorIndex = decoded.indexOf(":");
	if (separatorIndex === -1) {
		return null;
	}

	return {
		username: decoded.substring(0, separatorIndex),
		password: decoded.substring(separatorIndex + 1)
	};
};

const createRouter = ({
	db = defaultDb,
	config = defaultConfig,
	jwt = defaultJwt,
	pkg = defaultPkg
} = {}) => {
	const apiRouter = express.Router();

	const generateToken = async (user) => {
		const payload = {
			id: user.id,
			role: user.role
		};

		return jwt.sign(
			payload,
			getConfigValue(config, "secret.secret_key"),
			{ expiresIn: getConfigValue(config, "secret.expires") }
		);
	};

	const generateRefreshToken = async (user) => {
		const payload = {
			id: user.id,
			role: user.role
		};

		return jwt.sign(
			payload,
			getConfigValue(config, "secret.secret_key_refresh"),
			{ expiresIn: getConfigValue(config, "secret.refresh_expires") }
		);
	};

	const generateLoginTokens = async (user) => {
		const accessToken = await generateToken(user);
		const refreshToken = await generateRefreshToken(user);
		await db.updateUserRefreshToken(user.id, refreshToken);

		return { accessToken, refreshToken };
	};

	const verifyToken = async (token, key) => {
		if (!token) {
			return false;
		}

		return new Promise((resolve, reject) => {
			jwt.verify(token, key, (err, authData) => {
				err ? reject(err) : resolve(authData);
			});
		});
	};

	apiRouter.get("/health", (req, res) => {
		res.sendStatus(200);
	});

	apiRouter.get("/generate", async (req, res) => {
		try {
			const users = await db.generateAccounts();
			res.send(users);
		} catch (error) {
			res.status(500).json({ error: true, message: "Internal Server Error" });
		}
	});

	apiRouter.get("/", (req, res) => {
		res.status(200).json({
			service: "JWT Auth Server",
			version: pkg.version,
			description: pkg.description,
			positioning: "Reusable authentication API for Node.js products that need MySQL-backed users, JWT access tokens, refresh tokens, and basic health monitoring.",
			status: "online",
			endpoints: {
				health: "GET /health",
				login: "POST /login",
				refresh: "POST /refresh",
				logout: "POST /logout"
			},
			documentation: "README.md"
		});
	});

	apiRouter.post("/login", async (req, res) => {
		try {
			const basicCredentials = getBasicCredentials(req.headers.authorization);
			const username = basicCredentials ? basicCredentials.username : req.body.username;
			const password = basicCredentials ? basicCredentials.password : req.body.password;

			if (!username) {
				return res.status(400).json({ ErrorCode: "invalid_request", Error: "Required param : username" });
			}

			if (!password) {
				return res.status(400).json({ ErrorCode: "invalid_request", Error: "Required param : password" });
			}

			const user = await db.getUserByUsernameAndPassword(username, password);
			if (!user) {
				res.setHeader("WWW-Authenticate", "Basic");
				return res.status(401).json({ ErrorCode: "invalid_request", Error: "User not found" });
			}

			const { accessToken, refreshToken } = await generateLoginTokens(user);
			res.setHeader("Authorization", `Bearer ${accessToken}`);

			return res.status(200).json({
				error: false,
				accessToken,
				refreshToken,
				message: "success"
			});
		} catch (error) {
			return res.status(500).json({ error: true, message: "Internal Server Error" });
		}
	});

	apiRouter.post("/refresh", async (req, res) => {
		try {
			const refreshToken = getBearerToken(req.headers.authorization) || req.body.refreshToken;
			const authData = await verifyToken(refreshToken, getConfigValue(config, "secret.secret_key_refresh"));

			if (!authData) {
				return res.status(400).json({ ErrorCode: "invalid_request", Error: "Invalid Refresh Token" });
			}

			const user = await db.getUser(authData.id);
			if (!user) {
				return res.status(401).json({ ErrorCode: "invalid_request", Error: "User not found" });
			}

			if (refreshToken !== user.refresh_token) {
				return res.status(401).json({ ErrorCode: "invalid_request", Error: "Invalid Refresh Token" });
			}

			const accessToken = await generateToken(user);
			res.setHeader("Authorization", `Bearer ${accessToken}`);

			return res.status(200).json({
				error: false,
				accessToken,
				message: "success"
			});
		} catch (error) {
			if (error instanceof jwt.TokenExpiredError) {
				return res.status(400).json({ ErrorCode: "invalid_request", Error: "Refresh token expired" });
			}

			if (error instanceof jwt.JsonWebTokenError) {
				return res.status(400).json({ ErrorCode: "invalid_request", Error: "Invalid Refresh Token" });
			}

			return res.status(500).json({ error: true, message: "Internal Server Error" });
		}
	});

	apiRouter.post("/logout", async (req, res) => {
		try {
			const accessToken = getBearerToken(req.headers.authorization) || req.body.token;
			const authData = await verifyToken(accessToken, getConfigValue(config, "secret.secret_key"));

			if (!authData) {
				return res.status(400).json({ ErrorCode: "invalid_request", Error: "Invalid Token" });
			}

			const user = await db.getUser(authData.id);
			if (!user) {
				return res.status(401).json({ ErrorCode: "invalid_request", Error: "User not found" });
			}

			await db.updateUserRefreshToken(authData.id, null);

			return res.status(200).json({
				error: false,
				message: "success"
			});
		} catch (error) {
			if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
				return res.status(400).json({ ErrorCode: "invalid_request", Error: "Invalid Token" });
			}

			return res.status(500).json({ error: true, message: "Internal Server Error" });
		}
	});

	return apiRouter;
};

const apiRouter = createRouter();
apiRouter.createRouter = createRouter;

module.exports = apiRouter;
