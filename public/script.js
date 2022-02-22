(async () => {
  class Connector {
    userId = null;
    peerConnection = null;
    signalChanel = null;

    constructor({tracks = [], signalChanel, userId}) {
      this.userId = userId;
      this.signalChanel = signalChanel;
      this.peerConnection = new RTCPeerConnection();
      this.peerConnection.addEventListener('track', (e) => {
        console.log('Track', e);
        this.onTrack && this.onTrack(e);
      });
      this.addTracks(tracks);

      this.peerConnection.onconnectionstatechange = (ev) => {
        switch(this.peerConnection) {
          case "new":
          case "checking":
            console.log("Connecting...");
            break;
          case "connected":
            console.log("Online");
            break;
          case "disconnected":
            console.log("Disconnecting...");
            break;
          case "closed":
            console.log("Offline");
            break;
          case "failed":
            console.log("Error");
            break;
          default:
            console.log("Unknown");
            break;
        }
      }

      this.peerConnection.ondatachannel = ev => {
        console.log('Data Channel', ev);
      }

      this.peerConnection.onicecandidate = event => {
        console.log('Ice Candidate', event);
        if (event.candidate) {
          console.log('Ice Candidate', event.candidate);
        }
      };

      this.peerConnection.addEventListener("icecandidateerror", (event) => {
        console.log('Icecandidateerror', event)
      });

      this.peerConnection.oniceconnectionstatechange = ev => {
        console.log('Ice Connection State Change', ev);
      }

      this.peerConnection.onicegatheringstatechange = ev => {
        console.log('Ice Gathering State Change', ev);
      }

      this.peerConnection.onnegotiationneeded = ev => {
        console.log('Negotiation Needed', ev);
      };

      this.peerConnection.onsignalingstatechange = ev => {
        console.log('Signaling State Change', ev);
      };
    }

    addTracks(tracks) {
      if (this.peerConnection) {
        (Array.isArray(tracks) ? tracks : [tracks]).forEach((track) => {
          this.peerConnection.addTrack(track);
        });
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

  const addVideo = (stream, userId) => {
    const video = document.createElement("video");
    video.id = userId;
    video.srcObject = stream;
    video.addEventListener("loadedmetadata", () => {
      video.play();
      document.getElementById('video-grid').append(video);
    });
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

  let stream = null;
  let tracks = [];
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
    tracks = stream.getTracks();
  } catch (e) {
    console.log(e);
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
    return new Connector({signalChanel, tracks, userId: user_id});
  };

  socket.on('user-connected', async (userId) => {
    const connector = getConnector(userId);
    connector.onTrack = (e) => {
      debugger
    };
    addConnectorToList(connector);
    await connector.connect();
  });

  socket.on('user-disconnected', async (userId) => {
    const connector = getConnector(userId);
    removeConnectorFromList(connector);
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
