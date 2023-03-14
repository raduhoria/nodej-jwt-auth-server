const config = require('config'); //to use different configs use "export NODE_ENV=production" (https://github.com/node-config/node-config)
const port = config.get('server.port');
const host = config.get('server.host');

const cluster = require('cluster');
const cCPUs = require('os').cpus().length;

if (cluster.isMaster) {
	require('portscanner').checkPortStatus(port, host, function (error, status) {
		if (status === 'open') {
			console.log('Master server failed to start on port '+port+' due to port conflict');
			process.exit(1);
		}
	});
	// Create a worker for each CPU
	for (let i = 0; i < cCPUs; i++) {
		cluster.fork();
	}
	cluster.on('online', function (worker) {
		console.log('Worker ' + worker.process.pid + ' is online.');
	});
	cluster.on('disconnect', worker => {
		console.log(`${worker.process.pid} disconnect!`)
		cluster.fork();
	})
	cluster.on('exit', function (worker, code, signal) {
		console.log('worker ' + worker.process.pid + ' died.'+' with signal: '+signal);
		//cluster.fork(); // if we want to restart the fork on error -> this is dangerous if is a code bug -> restarting should be dedicated only for unexpected client runtime error
	});
	process.on('SIGINT', function () {
		for (let id in cluster.workers) {
			cluster.workers[id].kill("SIGINT"); // send to all workers kill message
			console.log('worker killed');
		}
		process.exit(0);
	})
} else {
	const terminate = require('./src/terminate');
	const http = require('http');
	const cors = require('cors')
	const bodyParser = require('body-parser');
	const express = require("express");
	const apiRouter = require('./src/routes');
	const testRouter = require('./test/test');
	const app = express();
	app.use(bodyParser.urlencoded({
		extended: true
	}));
	app.use(bodyParser.json());
	app.use(cors({
		origin: '*',
		credentials: true
	}));

	app.use('/', apiRouter);
	app.use('/', testRouter);

	const server = http.createServer(app);
	const exitHandler = terminate(server, {
		coredump: false,
		timeout: 500
	});
	process.on('uncaughtException', exitHandler(1, 'Unexpected Error'));
	process.on('unhandledRejection', exitHandler(1, 'Unhandled Promise'));
	process.on('SIGTERM', exitHandler(0, 'SIGTERM'));
	process.on('SIGINT', exitHandler(0, 'SIGINT'));
	process.setMaxListeners(0);

	server.listen(port, () => {
		console.log("API running on localhost:"+port);
	});
}