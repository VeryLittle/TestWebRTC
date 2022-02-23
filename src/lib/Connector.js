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
    this.peerConnection = new RTCPeerConnection(
      {
        iceServers: [
          {
            urls: "stun:openrelay.metered.ca:80"
          },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
          },
          {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
          }
        ]
      }
    );
    this.peerConnection.ontrack = (e) => {
      this.onTrack && this.onTrack(e);
    };
    this.peerConnection.onicecandidate = (e) => {
      const message = {
        candidate: null,
      };
      if (e.candidate) {
        message.candidate = e.candidate.candidate;
        message.sdpMid = e.candidate.sdpMid;
        message.sdpMLineIndex = e.candidate.sdpMLineIndex;
      }
      this.signalChanel.sendCandidate(message);
      console.log(message);
    };

    this.peerConnection.onicecandidateerror = (e) => {
      console.log('Ice Candidate Error', e);
    };

    this.peerConnection.onnegotiationneeded = (e) => {
      console.log('Negotiation Needed', e);
    };
    this.addStream(stream);
  }

  addStream(stream) {
    if (stream) {
      stream.getTracks().forEach(track => this.peerConnection.addTrack(track, stream));
    }
  }

  async connect() {
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(new RTCSessionDescription(offer));
    const answer = await this.signalChanel.sendOffer(offer);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async acceptConnect(offer) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(new RTCSessionDescription(answer));
    await this.signalChanel.sendAnswer(answer);
  }

  async addIceCandidate(candidate) {
    if (!candidate.candidate) {
      return this.peerConnection.addIceCandidate(null);
    }
    return this.peerConnection.addIceCandidate(candidate);
  }
}