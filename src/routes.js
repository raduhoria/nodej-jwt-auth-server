const express = require("express");
const config = require('config');
const db = require("./db");
const jsonwebtoken = require("jsonwebtoken");
const apiRouter = express.Router();

apiRouter.get('/health', (req, res) => {
	res.sendStatus(200);
});

apiRouter.get('/generate', async (req, res) => {
	let users = await db.generateAccounts();
	res.send(users);
	//res.sendStatus(200);
});

apiRouter.get('/', async (req, res) => {
	let users = await db.getUser(1);
	res.send(users);
	//res.sendStatus(200);
});

apiRouter.post('/login', async(req, res, next)=>{
	try{
		/*
		Using both Basic auth header authentication or body payload
		 */
		//console.log(req.headers);
		//console.log(req.body);
		const authheader = req.headers.authorization;
		if (authheader) {
			let auth = new Buffer.from(authheader.split(' ')[1],'base64').toString().split(':');
			var username = auth[0];
			var password = auth[1];
		}else{
			var username = req.body.username;
			var password = req.body.password;
		}
		if(!username){
			return res.status(400).json({ "ErrorCode" : "invalid_request", "Error" :"Required param : username" });
		}
		if(!password){
			return res.status(400).json({ "ErrorCode" : "invalid_request", "Error" :"Required param : password" });
		}
		var user = await db.getUserByUsernameAndPassword(username, password);
		if(!user){
			res.setHeader('WWW-Authenticate', 'Basic');
			return res.status(401).json({ "ErrorCode" : "invalid_request", "Error" :"User not found" });
		}else{
			const {accessToken, refreshToken} = await generateLoginTokens(user);
			res.setHeader('Authorization', 'Bearer '+ accessToken); // sent in header also -> jwt standard
			//res.cookie('token', accessToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + parseInt(config.get('secret.expires'))*1000) }); //we add secure: true, when using https.
			return res.status(200).json({
				error: false,
				accessToken,
				refreshToken,
				message: "Logged in sucessfully",
			});
		}
	} catch(e){
		console.log(e);
		return res.status(500).json({ error: true, message: "Internal Server Error" });
	}
});

apiRouter.post('/refresh', async(req, res, next)=>{
	try{
		/*
		Using both Bearer header or body payload for receive refresh token
		 */
		//console.log(req.headers);
		//console.log(req.body);
		const authHeader = req.headers.authorization;
		if (authHeader && authHeader.startsWith("Bearer ")) {
			var rtoken = authHeader.substring(7, authHeader.length);
		}else{
			var rtoken = req.body.refreshToken;
		}
		console.log('refreshtoken request: '+ rtoken);
		if (authData = await verifyToken(jsonwebtoken,rtoken,config.get('secret.secret_key_refresh'))){
			const userid = authData.id;
			let user = await db.getUser(userid);
			if(!user){
				return res.status(401).json({ "ErrorCode" : "invalid_request", "Error" :"User not found" });
			}
			if(rtoken !== user.refresh_token){
				return res.status(401).json({ "ErrorCode" : "invalid_request", "Error" :"Invalid Refresh Token" });
			}
			//const {accessToken, refreshToken} = await generateLoginTokens(user);
			const accessToken = await generateToken(user);
			res.setHeader('Authorization', 'Bearer '+ accessToken); // sent in header also -> jwt standard
			return res.status(200).json({
				error: false,
				accessToken,
				//refreshToken,
				message: "success",
			});
		}else{
			return res.status(400).json({ "ErrorCode" : "invalid_request", "Error" :"Invalid Refresh Token" });
		}
	} catch(e){
		console.log(e);
		if(e instanceof jsonwebtoken.TokenExpiredError){
			return res.status(400).json({ "ErrorCode" : "invalid_request", "Error" :"Refresh token expired" });
		}
		if(e instanceof jsonwebtoken.JsonWebTokenError){
			return res.status(400).json({ "ErrorCode" : "invalid_request", "Error" : e.message });
		}
		return res.status(500).json({ error: true, message: "Internal Server Error" });
	}
});

apiRouter.post('/logout', async(req, res, next)=> {
	try {
		const authHeader = req.headers.authorization;
		if (authHeader && authHeader.startsWith("Bearer ")) {
			var rtoken = authHeader.substring(7, authHeader.length);
		}else{
			var rtoken = req.body.token;
		}
		if (authData = await verifyToken(jsonwebtoken,rtoken,config.get('secret.secret_key'))){
			const userid = authData.id;
			let user = await db.getUser(userid);
			if(!user){
				return res.status(401).json({ "ErrorCode" : "invalid_request", "Error" :"User not found" });
			}
			await db.updateUserRefreshToken(userid,null);
			return res.status(200).json({
				error: false,
				message: "success",
			});
		}else{
			return res.status(400).json({ "ErrorCode" : "invalid_request", "Error" :"Invalid Refresh Token" });
		}
	} catch(e){
		console.log(e);
		if(e instanceof jsonwebtoken.TokenExpiredError){
			return res.status(401).json({ "ErrorCode" : "invalid_request", "Error" :"Token expired" });
		}
		if(e instanceof jsonwebtoken.JsonWebTokenError){
			return res.status(401).json({ "ErrorCode" : "invalid_request", "Error" : e.message });
		}
		return res.status(500).json({ error: true, message: "Internal Server Error" });
	}
});
const generateToken = async (user) =>{
	try {
		const payload = { id: user.id, role: user.role };
		const accessToken = jsonwebtoken.sign(
			payload,
			config.get('secret.secret_key'),
			{ expiresIn: config.get('secret.expires') }
		);
		return Promise.resolve(accessToken);
	} catch (err) {
		return Promise.reject(err);
	}
};

const generateRefreshToken = async (user) =>{
	try {
		const payload = { id: user.id, role: user.role };
		const refreshToken = jsonwebtoken.sign(
			payload,
			config.get('secret.secret_key_refresh'),
			{ expiresIn: config.get('secret.refresh_expires') }
		);
		return Promise.resolve(refreshToken);
	} catch (err) {
		return Promise.reject(err);
	}
};

const generateLoginTokens = async (user) => {
	try {
		const accessToken = await generateToken(user);
		const refreshToken = await generateRefreshToken(user);
		await db.updateUserRefreshToken(user.id, refreshToken);
		return Promise.resolve({ accessToken, refreshToken });
	} catch (err) {
		return Promise.reject(err);
	}
};

const verifyToken = async (jwt,token,key) => {
	if(!token) return false;
	return new Promise((resolve,reject) =>
		jwt.verify(token,key,(err,authData) => err ? reject(err) :
			resolve(authData))
	);
}
module.exports = apiRouter;