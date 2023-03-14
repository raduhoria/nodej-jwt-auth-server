const config = require('config');
const mysql = require('mysql');
const pool = mysql.createPool({
	connectionLimit: config.get('dbserver.connectionLimit'),    // the number of connections will node hold open to our database
	password: config.get('dbserver.password'),
	user: config.get('dbserver.user'),
	database: config.get('dbserver.database'),
	host: config.get('dbserver.host'),
});
pool.on('connection', function(connection) {
	console.log('Connected to MySql database');
});

pool.on('error', function(err) {
	console.log('Error connecting to mysql: '+err);
	throw err;
});

let db = {}; //create an empty object  that you will use later to write  and export your queries.

db.getUsers = () =>{
	return new Promise((resolve, reject)=>{
		pool.query('SELECT * FROM users ', (error, results)=>{
			if(error){
				return reject(error);
			}
			return resolve(results);
		});
	});
};

db.getUser = (id) =>{
	if (config.get('server.withlocalcache')) {
		let foundIndex = db.cachedata.findIndex(x => x.id == id);
		if(foundIndex!=-1) {
			//console.log('found user in local cache: '+foundIndex);
			return db.cachedata[foundIndex];
		}
	}
	return new Promise((resolve, reject)=>{
		pool.query('SELECT * from users where id=?', [id], (error, results)=>{
			if(error){
				return reject(error);
			}
			return resolve(results[0]);
		});
	});
};

db.getUserByEmail = (email) =>{
	if (config.get('server.withlocalcache')) {
		let foundIndex = db.cachedata.findIndex(x => x.email == email);
		if(foundIndex!=-1) {
			//console.log('found user in local cache: '+foundIndex);
			return db.cachedata[foundIndex];
		}
	}
	return new Promise((resolve, reject)=>{
		pool.query('SELECT * from users where email=?', [email], (error, results)=>{
			if(error){
				return reject(error);
			}
			return resolve(results[0]);
		});
	});
};

db.getUserByUsernameAndPassword = (username,password) =>{
	if (config.get('server.withlocalcache')) {
		let foundIndex = db.cachedata.findIndex(x => (x.email == username && x.password == password));
		if(foundIndex!=-1) {
			//console.log('found user in local cache: '+foundIndex);
			return db.cachedata[foundIndex];
		}
	}
	return new Promise((resolve, reject)=>{
		pool.query('SELECT * from users where email=? and password=?', [username,password], (error, results)=>{
			if(error){
				return reject(error);
			}
			return resolve(results[0]);
		});
	});
};

db.updateUserRefreshToken = (id,refresh_token) =>{
	if (config.get('server.withlocalcache')) {
		let foundIndex = db.cachedata.findIndex(x => x.id == id);
		if(foundIndex!=-1) {
			//console.log('found user in local cache: '+foundIndex);
			db.cachedata[foundIndex]['refresh_token'] = refresh_token;
			return db.cachedata[foundIndex];
		}
	}
	return new Promise((resolve, reject)=>{
		pool.query('UPDATE users set refresh_token = ? where id = ?',	[refresh_token,id],	(error, result)=>{
			if(error){
				return reject(error);
			}
			return resolve(result);
		});
	});
};

db.generateAccounts = () =>{
	return new Promise((resolve, reject)=>{
		var items = [];
		for (var i = 0, count = 10000; i < count; i++) {
			items.push({email:"radu.horia"+i+"@gmail.com",name:"Horia",password:"$2a$10$kzhZa7HUMzGq5Vhg3P71YuS8mhpbl.pDScjhOD7bgWCP9HHWm/ZTK",language:"ro",role:"user"});
		}
		pool.query('INSERT INTO users (email,name,password,language,role) VALUES ?',	[items.map(item => [item.email, item.name, item.password,item.language,item.role])],	(error, result)=>{
			if(error){
				return reject(error);
			}
			return resolve(result);
		});
	});
};

var setCachedData = async (db) => {
	var MySQLEvents = require('mysql-events');
	var dsn = {
		host: config.get('dbserver.host'),
		user: config.get('dbserver.user'),
		password: config.get('dbserver.password')
	};
	var mysqlEventWatcher = MySQLEvents(dsn);
	db.cachedata = JSON.parse(JSON.stringify(await db.getUsers()));
	//console.log(db.cachedata);
	var watcher = mysqlEventWatcher.add(
		config.get('dbserver.database') + '.users',
		function (oldRow, newRow, event) {
			//row inserted
			if (oldRow === null) {
				console.log('Table users inserted');
				//console.log(newRow);
				db.cachedata.push({
					id: newRow.fields['id'],
					created_date: newRow.fields['created_date'],
					active_account: newRow.fields['active_account'],
					email: newRow.fields['email'],
					name: newRow.fields['name'],
					password: newRow.fields['password'],
					language: newRow.fields['language'],
					role: newRow.fields['role'],
					refresh_token: newRow.fields['refresh_token']
				});
			}

			//row deleted
			if (newRow === null) {
				console.log('Table users deleted');
				let foundIndex = db.cachedata.findIndex(x => x.id == oldRow.fields['id']);
				db.cachedata.splice(foundIndex,1);
				//console.log(db.cachedata[foundIndex]);
			}

			//row updated
			if (oldRow !== null && newRow !== null) {
				console.log('Table users updated');
				var foundIndex = db.cachedata.findIndex(x => x.id == oldRow.fields['id']);
				oldRow.changedColumns.forEach(function(element){
					db.cachedata[foundIndex][element] = newRow.fields[element];
				});
				//console.log(db.cachedata[foundIndex]);
			}
			//detailed event information
			//console.log(event)
		},
		null
	);
};

if (config.get('server.withlocalcache')) { // with cache
	setCachedData(db);
}
module.exports = db