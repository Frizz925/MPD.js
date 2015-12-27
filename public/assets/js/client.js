var DEBUG_OUTPUT = false;
var app = angular.module('MPDApp', ['ngMaterial']);
var mPlaylist;

app.service('MPDService', ['$rootScope', '$mdToast', '$http', function($rootScope, $mdToast, $http) {
	this.LASTFM_API_KEY = "69e656fb307b9f940f316e4267053f8b";

	var socket = io();
	var listeners = [];
	var me = this;

	socket.on('connect', function() {
		$mdToast.show(
			$mdToast.simple()
				.textContent('Connected to MPD server')
				.hideDelay(3000)
		);
		socket.emit('mpd socketio connection');
	});

	socket.on('diconnect', function() {
		$mdToast.show(
			$mdToast.simple()
				.textContent('Lost connection to MPD server')
				.hideDelay(3000)
		);
	});

	socket.on('mpd message', function(msg) {
		me.notify('mpd message', msg);
	});

	socket.on('mpd status', function(msg) {
		var status = JSON.parse(msg);
		status.volume = Number(status.volume);
		status.single = Boolean(Number(status.single));
		status.repeat = Boolean(Number(status.repeat));
		status.consume = Boolean(Number(status.consume));
		status.random = Boolean(Number(status.random));
		status.time = Number(status.time.split(':')[0]);

		me.notify('mpd status', status);
	});

	socket.on('mpd song', function(msg) {
		var song = JSON.parse(msg);
		song.Pos = Number(song.Pos);
		if (DEBUG_OUTPUT) console.log('mpd song', song);

		me.notify('mpd song', song);
	});

	socket.on('mpd outputs', function(msg) {
		var outputs = JSON.parse(msg);
		outputs.forEach(function(el) {
			el.outputid = Number(el.outputid);
			el.outputenabled = Boolean(Number(el.outputenabled));
		});

		me.notify('mpd outputs', outputs);
	});

	socket.on('mpd playlist', function(url) {
		if (DEBUG_OUTPUT) console.log(url);
		$http.get(url).then(function(response) {
			var playlist = response.data;
			me.notify('mpd playlist', playlist);
		});
	});

	this.subscribe = function(event_name, scope, callback) {
		var handler = $rootScope.$on(event_name, callback);
		scope.$on('$destroy', handler);
	};

	this.notify = function(event_name, data) {
		$rootScope.$emit(event_name, data);
	};

	this.command = function(data) {
		socket.emit('mpd command', data);
	};
}]);

app.controller('MPDController', ['$scope', '$location', '$http', 'MPDService', function($scope, $location, $http, MPDService) {
	var timeInterval;
	var timeUpdate = function() {
		$scope.status.time++;
		$scope.$apply();
	};

	$scope.playlistController = new (function() {
		var me = this;
		var _playlist = [];
		var currentPos = 0;

		var reset = function() {
			currentPos = 0;
			$scope.playlist = [];
		};

		this.perScrollSize = 20;

		this.setPlaylist = function(playlist) {
			reset();
			_playlist = playlist;
		};

		this.search = function() {
			reset();
			me.update();
		};

		this.update = function() {
			var search = $scope.search.toLowerCase();
			var count = 0, countMax = currentPos + me.perScrollSize;

			_playlist.forEach(function(el) {
				if (count > countMax) return;
				var keyword = el.Title + " " + el.Artist + " " + el.Album;
				keyword = keyword.toLowerCase();
				if (keyword.indexOf(search) != -1) {
					if (count >= currentPos) {
						$scope.playlist.push(el);
						currentPos++;
					}
					count++;
				}
			});
		};
	})();

	var fetchAlbumCover = function(song) {
		$scope.coverURL = "";
		if (!song.Artist || !song.Album) return;

		var params = {
			method: 'album.getInfo',
			api_key: MPDService.LASTFM_API_KEY,
			artist: song.Artist,
			album: 	song.Album,
			format: 'json'
		};
		var encparams = "";
		for (var key in params) {
			if (encparams != "") encparams += "&";
			encparams += key + "=" + encodeURIComponent(params[key]);
		}

		var url = "http://ws.audioscrobbler.com/2.0/?" + encparams;
		$http.get(url).then(function(response) {
			var album = response.data.album;

			if (album) {
				var images = album.image;
				$scope.coverURL = images[images.length-2]['#text'];
			}
		});
	};

	$scope.status = {};
	$scope.song = {};
	$scope.outputs = {};
	$scope.playlist = [];
	$scope.coverURL = "";
	$scope.search = "";
	/* $scope.stream_url = $sce.trustAsResourceUrl("http://" + $location.host() + ":8001"); */

	$scope.statusChanging = false;

	$scope.changeSong = function(song) {
		MPDService.command('play ' + song.Pos);
	};

	$scope.command = function(cmd) {
		MPDService.command(cmd);
	};

	$scope.commandToggle = function(name) {
		$scope.status[name] = !$scope.status[name];
		MPDService.command(name + ' ' + Number($scope.status[name]));
	};

	$scope.toggleOutput = function(output) {
		MPDService.command((output.outputenabled ? "enableoutput " : "disableoutput ") + output.outputid);
	};

	MPDService.subscribe('mpd status', $scope, function(event, status) {
		if ($scope.statusChanging) return;

		if (DEBUG_OUTPUT) console.log(status);

		if (status.state != 'play' && timeInterval) {
			clearInterval(timeInterval);
			timeInterval = null;
		} else if (status.state == 'play' && !timeInterval) {
			timeInterval = setInterval(timeUpdate, 1000);
		}

		$scope.status = status;
		$scope.$apply();
	});

	MPDService.subscribe('mpd song', $scope, function(event, song) {
		if (DEBUG_OUTPUT) console.log(song);
		fetchAlbumCover(song);

		$scope.song = song;
		$scope.$apply();
	});

	MPDService.subscribe('mpd outputs', $scope, function(event, outputs) {
		if (DEBUG_OUTPUT) console.log(outputs);
		$scope.outputs = outputs;
		$scope.$apply();
	});

	MPDService.subscribe('mpd playlist', $scope, function(event, playlist) {
		if (DEBUG_OUTPUT) console.log(playlist);
		playlist.forEach(function(el, idx) {
			el.index = idx;
		});

		$scope.playlistController.setPlaylist(playlist);
		$scope.playlistController.update();
	});

	$scope.$watch(function() {
		return $scope.status.volume;
	}, function(value, old_value) {
		if (typeof value != 'number' || value == old_value) return;
		MPDService.command("setvol " + value);
	});

	$scope.$watch(function() {
		return $scope.status.single;
	}, function(value, old_value) {
		if (typeof value != 'boolean' || value == old_value) return;
		MPDService.command("single " + Number(value));
	});

	$scope.$watch(function() {
		return $scope.status.consume;
	}, function(value, old_value) {
		if (typeof value != 'boolean' || value == old_value) return;
		MPDService.command("consume " + Number(value));
	});

	var searchTimeout;
	$scope.$watch(function() {
		return $scope.search;
	}, function() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(function() {
			$scope.playlistController.search();
		}, 500);
	});
}]);

app.directive('seeker', ['MPDService', function(MPDService) {
	return {
		restrict: 'A',
		require: 'ngModel',
		link: function($scope, element, attr, ngModel) {
			element.on('$md.pressup', function() {
				MPDService.command("seek " + $scope.song.Pos + " " + $scope.status.time);
			});

			ngModel.$parsers.push(function(percentage) {
				var result = Math.floor($scope.song.Time * percentage / 1000);
				return result;
			});
			ngModel.$formatters.push(function(time) {
				var result = Math.ceil(time / $scope.song.Time * 1000);
				return result;
			});
		}
	};
}]);

app.directive('volume', ['MPDService', function(MPDService) {
	return {
		restrict: 'A',
		require: 'ngModel',
		link: function($scope, element, attr, ngModel) {
			element.on('$md.pressdown', function() {
				$scope.statusChanging = true;
			});
			element.on('$md.pressup', function() {
				$scope.statusChanging = false;
			});
		}
	};
}]);

app.directive('playlistScroll', function() {
	return {
		restrict: 'A',
		link: function($scope, elm, attr) {
			var raw = elm[0];
			raw.addEventListener('scroll', function() {
				if (raw.scrollTop + raw.offsetHeight >= raw.scrollHeight) {
					$scope.playlistController.update();
				}
			});
		}
	};
});

app.filter('basename', function() {
	return function(input) {
		if (typeof input != 'string') return "";

		var matches = input.match(/[^\/]+/g);
		if (matches) {
			return matches[matches.length-1];
		} else {
			return input;
		}
	};
});

app.filter('time', function() {
	return function(input) {
		var hours = Math.floor(input / 3600);
		var minutes = Math.floor(input % 3600 / 60);
		var seconds = Math.floor(input % 60);

		var result = "";
		result += (hours > 0) ? ((hours < 10) ? '0' + hours : hours) + ':' : "";
		result += ((minutes < 10) ? '0' + minutes : minutes) + ':';
		result += (seconds < 10) ? '0' + seconds : seconds;

		return result;
	};
})

app.config(['$mdThemingProvider', function($mdThemingProvider) {
	$mdThemingProvider.theme('default')
		.primaryPalette('indigo')
		.accentPalette('pink');
}]);