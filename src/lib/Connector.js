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

export class Connector {
	userId = null;
	peerConnection = null;
	signalChanel = null;

	constructor({stream, signalChanel, userId}) {
		this.userId = userId;
		this.signalChanel = signalChanel;
		this.peerConnection = new RTCPeerConnection();
		this.peerConnection.addEventListener('track', (e) => {
			console.log('Track', e);
			this.onTrack && this.onTrack(e);
		});
		this.addStream(stream);
	}

	addStream(stream) {
		if (this.peerConnection && stream) {
			this.peerConnection.addTrack(stream.getTracks()[0], stream);
		}
	}

	async connect() {
		const offer = await this.peerConnection.createOffer();
		await this.peerConnection.setLocalDescription(offer);
		const answer = await this.signalChanel.sendOffer(offer);
		await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
	}

	async acceptConnect(offer) {
		await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
		const answer = await this.peerConnection.createAnswer();
		await this.peerConnection.setLocalDescription(answer);
		await this.signalChanel.sendAnswer(answer);
	}
}