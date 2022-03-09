import {createVideoRoomClient} from "./lib/VideoRoom";
import {Janus} from "./lib/Janus";

function getConnectedDevices(type, callback) {
	navigator.mediaDevices.enumerateDevices()
		.then(devices => {
			const filtered = devices.filter(device => device.kind === type);
			callback(filtered);
		});
}
getConnectedDevices('videoinput', cameras => console.log('Камеры', cameras));
getConnectedDevices('audioinput', micro => console.log('Микрофоны', micro));
getConnectedDevices('audiooutput', output => console.log('Динамики', output));

const clientReady = createVideoRoomClient({debug: true})

async function connect(server, roomId, displayName) {
	const client = await clientReady
	const session = await client.createSession(server)
	const room = await session.joinRoom(roomId)
	const stream = await getStream();

	const pub = await room.publish({publishOptions: {display: displayName}, stream, mediaOptions: {media: {video: "lowres"}}})
	const myVideo = makeDisplay(displayName)
	pub.onTrackAdded(track => myVideo.stream.addTrack(track))
	pub.onTrackRemoved(track => myVideo.stream.removeTrack(track))

	const subs = {}
	room.onPublisherAdded(publishers => publishers.forEach(subscribe))
	room.onPublisherRemoved(unsubscribe)

	return {session, room, publisher: pub, subscribers: subs}


	async function subscribe(publisher) {
		const sub = subs[publisher.id] = await room.subscribe([{feed: publisher.id}])
		sub.video = makeDisplay(publisher.display)
		sub.onTrackAdded(track => sub.video.stream.addTrack(track))
		sub.onTrackRemoved(track => sub.video.stream.removeTrack(track))
	}
	async function unsubscribe(publisherId) {
		await subs[publisherId].unsubscribe()
		subs[publisherId].video.remove()
	}
}

function makeDisplay(displayName) {
	const stream = new MediaStream()
	const display = document.createElement('div');
	display.classList.add('display');
	display.innerHTML = `<div class="name">${displayName}</div><video autoplay></video>`;
	document.querySelector('#displays').append(display);
	Janus.attachMediaStream(display.querySelector('video'), stream);
	return {
		stream,
		remove: () => display.remove()
	}
}

async function getStream() {
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

	return stream;
}

document.addEventListener("DOMContentLoaded", function(event) {
	const form = document.querySelector("#main-form");
	form.addEventListener('submit', function(e) {
		form.style.display = 'none'
		e.preventDefault();
		connect(this.server.value, Number(this.roomId.value), this.displayName.value)
			.then(() => '')
			.catch(console.error)
	})
});
