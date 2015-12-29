// Define some constants
const HTTP_PORT = 3000;
const MPD_HOST = "localhost";
const MPD_PORT = 6600;
const DEBUG_OUTPUT = false;

// Import depedencies
var net = require('net');
var express = require('express');

// Define the modules
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

// Define objects
var MPDClient = function(socketio) {
	var me = this;
	var client, idle_client;
	var queue = [];
	var _host, _port;

	var subscribers = {};

	this.status = {};
	this.song = {};
	this.playlist = [];
	this.outputs = [];

	var handlePlaylistResponse = function() {
		var song = {};
		return function(key, val) {
			song[key] = val;
			if (key == 'Id') {
				me.playlist.push(song);
				song = {};
			}
		};
	};

	var handleOutputsResponse = function() {
		me.outputs = [];
		var output = {};
		return function(key, val) {
			output[key] = val;
			if (key == 'outputenabled') {
				me.outputs.push(output);
				output = {};
			}
		};
	};

	var handleResponse = function(arg) {
		var obj = null;
		//console.log(arg + " | " + key);
		switch (arg) {
			case 'status':
				me.status = obj = {};
				break;
			case 'currentsong':
				me.song = obj = {};
				break;
		}

		return function(key, val) {
			if (obj) obj[key] = val;
		};
	};

	var responseBuffer = new (function() {
		var queue = [];

		this.push = function(msg) {
			var pending = [];
			if (typeof msg == 'string') {
				pending = msg.split("\n");
			} else if (typeof msg == 'array') {
				pending = msg;
			}

			pending.forEach(function(el) {
				queue.push(el);
			});
		};

		this.pop = function() {
			return queue.splice(0, 1)[0];
		};

		this.isEmpty = function() {
			return queue.length <= 0;
		};

		this.getQueue = function() {
			return queue;
		};
	})();

	var processResponse = function(msg) {
		if (msg) {
			if (msg.match(/^OK MPD/)) return null;
			responseBuffer.push(msg);
		}

		var arg = queue[0];
		var result = [arg];

		var handler;
		switch (arg) {
			case 'outputs':
				handler = handleOutputsResponse();
				break;
			case 'playlistinfo':
				handler = handlePlaylistResponse();
				break;
			default:
				handler = handleResponse(arg);
				break;
		}

		while (!responseBuffer.isEmpty()) {
			var el = responseBuffer.pop();
			if (DEBUG_OUTPUT) console.log(arg, el);

			if (el.match(/^OK/)) {
				queue.splice(0, 1);
				break;
			}

			if (!el.match(/^[a-z]+:\s/i)) {
				continue;
			}

			var parts = el.split(': ');
			parts = [parts.shift(), parts.join(': ')];
			handler(parts[0], parts[1]);
		}

		if (!responseBuffer.isEmpty()) {
			var temp = processResponse();
			if (DEBUG_OUTPUT) console.log(arg, temp, queue);
			temp.forEach(function(el) {
				result.push(el);
			});
		}

		return result;
	};

	var idle = function(client) {
		//console.log("Idle command");
		client.write("idle" + "\r\n");
	};

	var publishEvent = function(event_name, data) {
		if (event_name in subscribers) {
			subscribers[event_name].forEach(function(callback) {
				callback(data);
			});
		}
	};

	this.connect = function(host, port) {
		_host = host;
		_port = port;

		if (client && client.connected) {
			client.destroy();
		}

		if (idle_client && idle_client.connected) {
			idle_client.destroy();
		}

		var createSocket = function() {
			var socket = new net.Socket();

			socket.on('error', function(arg) {
				if (DEBUG_OUTPUT) console.log("Command socket", arg);	
				console.log("[ERROR] Pipe broken. Recreating command socket.");
				me.connect(host, port);
			});

			socket.on('data', function(data) {
				var msg = String(data).trim();
				//console.log(queue);
				//console.log(msg);
				var args = processResponse(msg);
				if (!args) return;
				me.emitMultiple(args);
			});

			socket.on('close', function() {
				mpd = new MPDClient(socketio);
				mpd.connect(host, port);
			});

			return {
				socket: socket,
				onconnect: function() {
					console.log("TCP socket connected to %s:%s", host, port);
					me.commands(['status', 'currentsong', 'outputs', 'playlistinfo']);

					http.listen(HTTP_PORT, function() {
						console.log("Web server listening on *:" + HTTP_PORT);
					});
				}
			};
		};

		var createIdleSocket = function() {
			var socket = new net.Socket();

			socket.on('error', function(arg) {
				if (DEBUG_OUTPUT) console.log("Idle socket", arg);
			});

			socket.on('data', function(data) {
				var msg = String(data).trim();
				if (msg.match(/^OK MPD/)) return;

				msg.split("\n").forEach(function(msg) {
					//console.log(msg);
					var regex = /^changed: ([a-z]+)/;
					var matches = msg.match(regex);
					if (matches) {
						var changed = matches[1];
						if (DEBUG_OUTPUT) console.log("changed: " + changed);

						switch (changed) {
							case 'player':
								me.command("status");
								me.command("currentsong");
								break;
							case 'output':
								me.command("status");
								me.command("outputs");
								break;
							default:
								me.command("status");
								break;
						}
					}
				});

				idle(socket);
			});

			return {
				socket: socket,
				onconnect: function() {
					console.log("Idle TCP socket connected to %s:%s", host, port);
					idle(idle_client);
				}
			};
		};

		var sockets = {
			idle: createIdleSocket(),
			cmd: createSocket()
		};

		idle_client = sockets.idle.socket;
		idle_client.connect(port, host, function() {
			client = sockets.cmd.socket;
			client.connect(port, host, sockets.cmd.onconnect);
			sockets.idle.onconnect();
		});
	};

	this.command = function(cmd, callback) {
		queue.push(cmd);
		if (DEBUG_OUTPUT) console.log("Command: " + cmd);
		client.write(cmd + "\r\n", 'UTF-8', callback);
	};

	this.commands = function(cmds) {
		var cmd = cmds.shift();
		if (cmd) {
			me.command(cmd, function() {
				me.commands(cmds);
			});
		}
	};

	this.emitMultiple = function(args) {
		args.forEach(function(arg) {
			me.emit(arg);
		});
	};

	this.emit = function(arg) {
		switch (arg) {
			case 'status':
				publishEvent('mpd status', me.status);
				socketio.emit('mpd status', JSON.stringify(me.status));
				break;
			case 'song':
			case 'currentsong':
				publishEvent('mpd song', me.song);
				socketio.emit('mpd song', JSON.stringify(me.song));
				break;
			case 'outputs':
				publishEvent('mpd outputs', me.outputs);
				socketio.emit('mpd outputs', JSON.stringify(me.outputs));
				break;
			case 'playlistinfo':
				publishEvent('mpd playlist', me.playlist);
				socketio.emit('mpd playlist', "/api/playlist.json");
				break;
		}
	};

	this.on = function(event_name, callback) {
		if (!(event_name in subscribers)) {
			subscribers[event_name] = [];
		}

		subscribers[event_name].push(callback);
	};
};

// Initialize objects
var mpd = new MPDClient(io);
mpd.on('mpd playlist', function(playlist) {
	var fs = require('fs');
	fs.writeFile(__dirname + "/storage/playlist.json", JSON.stringify(playlist));
});

// START: ExpressJS configurations
app.use('/assets', express.static(__dirname + '/public/assets'));
app.use('/bower_components', express.static(__dirname + '/bower_components'));
app.get('/api/playlist.json', function(req, res) {
	res.sendFile(__dirname + "/storage/playlist.json");
});
app.get('/', function(req, res) {
	res.sendFile(__dirname + "/views/index.html");
});
// END: ExpressJS configurations

// START: Socket.IO configurations
io.on('connection', function(socket) {
	if (DEBUG_OUTPUT) console.log(' connected');
	socket.on('mpd command', function(msg) {
		mpd.command(msg);
	});
	socket.on('mpd socketio connection', function() {
		mpd.emitMultiple(['status', 'outputs', 'playlistinfo', 'song']);
	});
	socket.on('disconnect', function() {
		if (DEBUG_OUTPUT) console.log(' disconnected');
	});
});
// END: Socket.IO configurations

// Finally start the server
mpd.connect(MPD_HOST, MPD_PORT);
