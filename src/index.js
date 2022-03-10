import {createVideoRoomClient} from "./lib/VideoRoom";
import {Janus} from "./lib/Janus";
import {getConnectedDevices, getStream} from "./lib/utils";

getConnectedDevices('videoinput', cameras => console.log('Камеры', cameras));
getConnectedDevices('audioinput', micro => console.log('Микрофоны', micro));
getConnectedDevices('audiooutput', output => console.log('Динамики', output));

const clientReady = createVideoRoomClient({debug: true})

async function connect(server, roomId, displayName) {
	const client = await clientReady
	const session = await client.createSession(server)
	const room = await session.joinRoom(roomId)
	// const stream = await getStream();
	const stream = document.querySelector('canvas').captureStream();

	setTimeout(() => {
		const canvas = document.querySelector('canvas');
		if (canvas.getContext) {
			var ctx = canvas.getContext('2d');

			ctx.fillRect(5,5,20,20);
			ctx.clearRect(9,9,12,12);
			ctx.strokeRect(10,10,10,10);
		}
	}, 5000);

	const pub = await room.publish({publishOptions: {display: displayName}, mediaOptions: { stream }})
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
