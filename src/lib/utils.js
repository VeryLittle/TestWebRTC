export function getConnectedDevices(type, callback) {
  navigator.mediaDevices.enumerateDevices()
    .then(devices => {
      const filtered = devices.filter(device => device.kind === type);
      callback(filtered);
    });
}

export async function getStream() {
  function getMedia(constraints) {
    return navigator.mediaDevices.getUserMedia(constraints)
  }

  const stream = await getMedia({video: true, audio: true})
    .catch(() => {
      return getMedia({audio: true});
    })
    .catch(() => {
      return getMedia({video: true});
    })
    .catch(() => {
      return null;
    });

  return stream;
}