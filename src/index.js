import {Janus} from "./lib/Janus";
import {createVideoRoomClient} from "./lib/VideoRoom";

const clientPromise = createVideoRoomClient({debug: true});

async function connect(server, roomId, displayName) {
	const client = await clientPromise;
	const session = await client.createSession(server);
	const room = await session.joinRoom(roomId);

	const pub = await room.publish({publishOptions: {display: displayName}, mediaOptions: {media: {video: true}}});
	const myVideo = makeDisplay(displayName);
	pub.onTrackAdded(track => {
		console.log('onTrackAdded', track)
		myVideo.stream.addTrack(track)
	});
	pub.onTrackRemoved(track => {
		console.log('onTrackRemoved', track)
		myVideo.stream.removeTrack(track)
	});

	const subs = {};
	room.onPublisherAdded(publishers => publishers.forEach(subscribe));
	room.onPublisherRemoved(unsubscribe);

	return {session, room, publisher: pub, subscribers: subs};

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
	document.querySelector('#video-grid').append(display);
	Janus.attachMediaStream(display.querySelector('video'), stream);
	return {
		stream,
		remove: () => display.remove()
	}
}

setTimeout(() => {
	connect('wss://farm.maindp.ru/ws', 1234, 'MyDisplayName')
		.then(() => '')
		.catch(console.error)
}, 5000);
