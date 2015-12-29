# MPD.js
Web client for MPD server written using Node.js, Socket.IO, and AngularJS

# Screenshot
![MPD.js](https://raw.githubusercontent.com/Frizz925/MPD.js/master/screenshots/main.png)

# Stability
MPD.js is currently in alpha stage and thus may be unstable at times. If you happen to find a bug or error, please report over to [issues](https://github.com/Frizz925/MPD.js/issues)!

# How to use
Install the required Node.js modules

		$ npm install

By default everything should work out of the box if you install it on local machine that is also running MPD. 

		$ node app.js

From there you can access the web server from port **3000**.
If you wish to change either the web port or MPD host/port, everything you need to change is in the **app.js** file.

```js
	const HTTP_PORT = 3000;
	const MPD_HOST = "localhost";
	const MPD_PORT = 6600;
```

To change the web port, you only need to change the **HTTP\_PORT** constant.
To change where MPD.js server should connect to the MPD server through what host and which port, you can change **MPD\_HOST** and **MPD\_PORT** respectively.

# Features
Currently MPD.js has the following features.

  - Album cover fetching using [Last.FM API](http://www.last.fm/api)
  - Real-time music updates between server and each clients
