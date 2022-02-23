import {io} from 'socket.io-client';
import {Connector} from "./lib/Connector";

(async () => {
	const addVideo = (stream, userId, muted) => {
		const video = document.createElement("video");
		video.id = userId;
		video.srcObject = stream;
		video.muted = !!muted;
		video.autoplay = true;
		document.getElementById('video-grid').append(video);
	};

	const removeVideo = (userId) => {
		const video = document.getElementById(userId);
		if (video) video.remove();
	};

	const updateConnectionsEl = () => {
		const connectionsEl = document.getElementById('connections');
		connectionsEl.innerHTML = Object.keys(connectors).length;
	}

	const socket = io('/');
	const connectors = {};
	const addConnectorToList = (connector) => {
		connectors[connector.userId] = connector;
		updateConnectionsEl();
	}
	window.connectors = connectors;

	const removeConnectorFromList = (connector) => {
		delete connectors[connector.userId];
		updateConnectionsEl();
	}

	let video = true;

	function getMedia(constraints) {
		return navigator.mediaDevices.getUserMedia(constraints)
	}

	const stream = await getMedia({video: true, audio: true})
		.catch(() => {
			video = false;
			return getMedia({audio: true});
		})
		.catch(() => {
			video = true;
			return getMedia({video: true});
		})
		.catch(() => {
			video = false;
			return null;
		});

	if (video) {
		addVideo(stream, 'self', true);
	}

	const getConnector = (user_id) => {
		if (connectors[user_id]) return connectors[user_id];
		const signalChanel = {
			sendOffer: async (offer) => {
				socket.emit('offer', offer, user_id);
				return new Promise((resolve) => {
					const func = (answer, userId) => {
						if (userId !== user_id) return;
						socket.off('answer');
						resolve(answer);
					};
					socket.on('answer', func);
				});
			},
			sendAnswer: async (answer) => {
				socket.emit('answer', answer, user_id);
			},
		};
		return new Connector({signalChanel, stream, userId: user_id});
	};

	socket.on('user-connected', async (userId) => {
		const connector = getConnector(userId);
		connector.onTrack = (e) => {
			addVideo(e.streams[0], user_id);
		};
		addConnectorToList(connector);
		await connector.connect();
	});

	socket.on('user-disconnected', async (userId) => {
		const connector = getConnector(userId);
		removeConnectorFromList(connector);
		removeVideo(userId);
	});

	socket.on('offer', async (offer, user_id) => {
		const connector = getConnector(user_id);
		connector.onTrack = (e) => {
			addVideo(e.streams[0], user_id);
		};
		addConnectorToList(connector);
		await connector.acceptConnect(offer);
	});

	socket.emit('join-room', ROOM_ID);
})();