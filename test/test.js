const express = require('express');
const axios = require('axios').default;
const testRouter = express.Router();

const { hashSync, genSaltSync, compareSync } = require("bcrypt");
const jsonwebtoken = require("jsonwebtoken");
const config = require("config");
const cookieParser = require('cookie-parser');
testRouter.use(cookieParser());

//testRouter.use(verifyToken);

testRouter.get('/testlogin',  async (req, res, next)=>{
	try {
		let username = req.query.username;
		let password = req.query.password;
		//console.log(username+" "+password);
		var response = await CallLogin(username,password);
		console.log(response.data);
		if(response.data.accessToken){
			res.cookie('token', response.data.accessToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + config.get('secret.expires')) }); //we add secure: true, when using https.
		}
		return res.status(200).send(response.data);
	}catch (e){
		console.log(e);
		return res.status(500).send(e.message);
	}
});
testRouter.get('/testjwt',  async (req, res, next)=>{
	try {
		const token = req.cookies.token;
		var refreshtoken = req.cookies.refreshtoken;
		console.log(token);
		var username = req.query.username;
		var password = req.query.password;
		if(token === undefined  ){
			//console.log(username+" "+password);
			var response = await CallLogin(username,password);
			if(response.data.accessToken){
				res.cookie('token', response.data.accessToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + parseInt(config.get('secret.expires'))*1000) }); //we add secure: true, when using https.
				res.cookie('refreshtoken', response.data.refreshToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + parseInt(config.get('secret.refresh_expires'))*1000) });
				return res.status(200).json({error: false, message: "success"});
			}else{
				return res.status(401).send('No access token generated from login');
			}
		} else{
			if (authData = await verifyToken(jsonwebtoken,token,config.get('secret.secret_key'))){
				return res.status(200).json({
					error: false,
					userdata: authData,
					message: "success with token for user",
				});
			}
		}
	}catch (e){
		console.log(e.message);
		if(e instanceof jsonwebtoken.TokenExpiredError){
			let responseref = await CallRefresh(refreshtoken);
			if(responseref.data.accessToken){
				res.cookie('token', responseref.data.accessToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + parseInt(config.get('secret.expires'))*1000) }); //we add secure: true, when using https.
				res.cookie('refreshtoken', responseref.data.refreshToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + parseInt(config.get('secret.refresh_expires'))*1000) });
				return res.status(200).json({error: false, message: "success token refreshed"});
			}
			//refresh token expired -> go to login page
			return res.status(401).json({ "ErrorCode" : "invalid_request", "Error" :"Refresh token expired" });
		}
		if(e instanceof jsonwebtoken.JsonWebTokenError){
			let resp = await CallLogin(username,password);
			if(resp.data.accessToken){
				res.cookie('token', response.data.accessToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + parseInt(config.get('secret.expires'))*1000) }); //we add secure: true, when using https.
				res.cookie('refreshtoken', response.data.refreshToken, { httpOnly: true, secure: false, SameSite: 'strict' , expires: new Date(Number(new Date()) + parseInt(config.get('secret.refresh_expires'))*1000) });
				return res.status(200).json({error: false, message: "success new token"});
			}else {
				return res.status(401).json({"ErrorCode": "invalid_request", "Error": e.message});
			}
		}
		return res.status(400).send(e.message);
	}
});

async function CallLogin(username,password){
	if(!username && !password){
		var username = "radu.horia@gmail.com";
		var password = "$2a$10$kzhZa7HUMzGq5Vhg3P71YuS8mhpbl.pDScjhOD7bgWCP9HHWm/ZTK";
	}
	return await axios.post("http://localhost:8001/login",
		{
			username: username,
			password: password
		},
		{

		}
	).then(async function (response) {
		// handle success
		return response;
	}).catch(function (error) {
		// handle error
		//console.log(error);
		throw error;
		//return res.status(500).json(error);
	});
}

async function CallRefresh(refreshToken){
	//console.log(refreshToken);
	return await axios.post("http://localhost:8001/refresh",
		{

		},
		{
			headers: {
				'Authorization': 'Bearer ' + refreshToken
			}
		}
	).then(function (response) {
		// handle success
		//console.log(response.data);
		return response;
	}).catch(function (error) {
		// handle error
		//console.log(error);
		throw error;
		//return res.status(500).json(error);
	});
}

const verifyToken = async (jwt,token,key) => {
	if(!token) return false;
	return new Promise((resolve,reject) =>
		jwt.verify(token,key,(err,authData) => err ? reject(err) :
			resolve(authData))
	);
}

module.exports = testRouter;