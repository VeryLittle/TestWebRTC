const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const myPeer = new Peer();

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

const myVideo = document.createElement('video');
myVideo.muted = true;
const peers = {};
navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
}).then(stream => {
  addVideoStream(myVideo, stream)

  myPeer.on('call', call => {
    call.answer(stream)
    const video = document.createElement('video')
    call.on('stream', userVideoStream => {
      addVideoStream(video, userVideoStream, call.connectionId);
    })
  })

  socket.on('user-connected', userId => {
    connectToNewUser(userId, stream)
  })
})

socket.on('user-disconnected', userId => {
  if (peers[userId]) {
    const videoEl = document.getElementById(peers[userId].connectionId);
    if (videoEl) videoEl.remove();
    peers[userId].close();
    delete peers[userId]
  }
})

myPeer.on('open', id => {
  socket.emit('join-room', ROOM_ID, id)
})

function connectToNewUser(userId, stream) {
  const call = myPeer.call(userId, stream)
  const video = document.createElement('video')
  call.on('stream', userVideoStream => {
    addVideoStream(video, userVideoStream, call.connectionId);
  })
  call.on('close', () => {
    video.remove()
  })

  peers[userId] = call
}

function addVideoStream(video, stream, id) {
  video.id = id;
  video.srcObject = stream
  video.addEventListener('loadedmetadata', () => {
    video.play()
  })
  videoGrid.append(video)
}