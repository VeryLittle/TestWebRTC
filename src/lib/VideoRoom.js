import Janus from "janus-gateway-ts";

export function createVideoRoomClient(options) {
	return new Promise(function(fulfill) {
		Janus.init(Object.assign({}, options, {
			callback: fulfill
		}))
	})
		.then(function() {
			return {
				createSession: function(server, options) {
					return createVideoRoomSession(server, options)
				}
			}
		})
}

export function createVideoRoomSession(server, options) {
	var eventTarget = makeEventTarget()
	return new Promise(function(fulfill, reject) {
		var resolved = false
		var session = new Janus(Object.assign({}, options, {
			server: server,
			success: function() {
				if (!resolved) {
					fulfill(session)
					resolved = true
				}
				else {
					//reconnected
				}
			},
			error: function(err) {
				if (!resolved) {
					reject(err)
					resolved = true
				}
				else if (typeof err == "string" && err.startsWith("Lost connection")) {
					eventTarget.dispatchEvent(new CustomEvent("connectionLost"))
				}
				else {
					console.error(err)
				}
			},
		}))
	})
		.then(function(session) {
			var ses = {
				eventTarget: eventTarget,
				isValid: function() {
					return session.isConnected()
				},
				joinRoom: function(roomId) {
					return joinVideoRoom(session, roomId)
				},
				subscribe: function(roomId, streams, options) {
					return createVideoRoomSubscriber(session, roomId, streams, options)
				},
				watch: function(mountPointId, options) {
					return createStreamingSubscriber(session, mountPointId, options)
				},
				attachToPlugin: function(plugin) {
					return attachToPlugin(session, plugin)
				},
				destroy: function() {
					return new Promise(function(fulfill, reject) {
						session.destroy({
							success: fulfill,
							error: reject
						})
					})
				}
			}
			return ses
		})
}

export function attachToPlugin(session, plugin) {
	var pendingRequests = []
	var eventTarget = makeEventTarget()
	return new Promise(function(fulfill, reject) {
		session.attach({
			plugin: plugin,
			success: fulfill,
			error: reject,
			consentDialog: function(state) {
				eventTarget.dispatchEvent(new CustomEvent("consentDialog", {detail: {state: state}}))
			},
			webrtcState: function(state, reason) {
				eventTarget.dispatchEvent(new CustomEvent("webrtcState", {detail: {state: state, reason: reason}}))
			},
			iceState: function(state) {
				eventTarget.dispatchEvent(new CustomEvent("iceState", {detail: {state: state}}))
			},
			mediaState: function(state) {
				eventTarget.dispatchEvent(new CustomEvent("mediaState", {detail: {state: state}}))
			},
			slowLink: function(state) {
				eventTarget.dispatchEvent(new CustomEvent("slowLink", {detail: {state: state}}))
			},
			onmessage: function(message, jsep) {
				var response = {message: message, jsep: jsep}
				var index = pendingRequests.findIndex(function(request) {
					return request.acceptResponse(response)
				})
				if (index != -1) pendingRequests.splice(index, 1)
				else eventTarget.dispatchEvent(new CustomEvent("message", {detail: {message: message, jsep: jsep}}))
			},
			onlocaltrack: function(track, added) {
				eventTarget.dispatchEvent(new CustomEvent("localtrack", {detail: {track: track, added: added}}))
			},
			onremotetrack: function(track, mid, added) {
				eventTarget.dispatchEvent(new CustomEvent("remotetrack", {detail: {track: track, mid: mid, added: added}}))
			},
			ondataopen: function(label, protocol) {
				eventTarget.dispatchEvent(new CustomEvent("dataopen", {detail: {label: label, protocol: protocol}}))
			},
			ondata: function(data, label) {
				eventTarget.dispatchEvent(new CustomEvent("data", {detail: {data: data, label: label}}))
			},
			oncleanup: function() {
				eventTarget.dispatchEvent(new CustomEvent("cleanup"))
			},
			ondetached: function() {
				eventTarget.dispatchEvent(new CustomEvent("detached"))
			}
		})
	})
		.then(function(handle) {
			// extend the handle to add convenience methods
			handle.eventTarget = eventTarget

			// method to send a synchrnous request to the plugin
			handle.sendRequest = function(message) {
				return new Promise(function(fulfill, reject) {
					handle.send({
						message: message,
						success: fulfill,
						error: reject
					})
				})
			}

			// method to send an asynchronous request to the plugin
			var pending = Promise.resolve()
			handle.sendAsyncRequest = function(request) {
				return pending = pending.catch(function() {})
					.then(function() {
						return new Promise(function(fulfill, reject) {
							handle.send({
								message: request.message,
								jsep: request.jsep,
								success: fulfill,
								error: reject
							})
						})
							.then(function() {
								return new Promise(function(fulfill, reject) {
									pendingRequests.push({
										acceptResponse: function(response) {
											if ((response.message.videoroom == "event" || response.message.streaming == "event") && response.message.error_code) {
												var err = new Error(response.message.error || response.message.error_code)
												err.code = response.message.error_code
												reject(err)
												return true
											}
											else if (request.expectResponse(response)) {
												fulfill(response)
												return true
											}
										}
									})
								})
							})
					})
			}
			return handle
		})
}

export function joinVideoRoom(session, roomId) {
	var cleanup = makeCleanup()
	var callbacks = makeCallbacks()

	// attach to plugin and get a new handle for this room
	return attachToPlugin(session, "janus.plugin.videoroom")
		.then(function(handle) {

			// remember to detach
			cleanup.add(function() {
				return new Promise(function(fulfill, reject) {
					handle.detach({
						success: fulfill,
						error: reject
					})
				})
			})

			// listen to events and invoke callbacks
			handle.eventTarget.addEventListener("message", function(event) {
				var message = event.detail.message
				if (message.videoroom == "event" && message.room == roomId) {
					if (message.publishers) {
						callbacks.get("onPublisherAdded")
							.then(function(callback) { return callback(message.publishers) })
							.catch(console.error)
					}
					if (message.unpublished) {
						callbacks.get("onPublisherRemoved")
							.then(function(callback) { return callback(message.unpublished) })
							.catch(console.error)
					}
				}
			})

			// send the join request
			return handle.sendAsyncRequest({
				message: {
					request: "join",
					ptype: "publisher",
					room: roomId,
				},
				expectResponse: function(r) {
					return r.message.videoroom == "joined" && r.message.room == roomId
				}
			})
				.then(function(response) {
					// invoke callback with the initial list of publishers
					if (response.message.publishers.length) {
						callbacks.get("onPublisherAdded")
							.then(function(callback) { return callback(response.message.publishers) })
							.catch(console.error)
					}

					// construct and return the VideoRoom object
					var room = {
						roomId: roomId,
						pluginHandle: handle,
						onPublisherAdded: function(callback) {
							callbacks.set("onPublisherAdded", callback)
						},
						onPublisherRemoved: function(callback) {
							callbacks.set("onPublisherRemoved", callback)
						},
						publish: function(options) {
							return createVideoRoomPublisher(handle, response.message.id, options)
						},
						subscribe: function(streams, options) {
							return createVideoRoomSubscriber(session, roomId, streams, options)
						},
						leave: function() {
							return cleanup.run()
						}
					}
					return room
				})
		})
		.catch(function(err) {
			return cleanup.run().catch(console.error)
				.then(function() { throw err })
		})
}

export function createVideoRoomPublisher(handle, publisherId, options) {
	options = Object.assign({}, options)
	var cleanup = makeCleanup()
	var callbacks = makeCallbacks()

	// listen to events and invoke callbacks
	var onLocalTrack = function(event) {
		if (event.detail.added) {
			callbacks.get("onTrackAdded")
				.then(function(callback) { return callback(event.detail.track) })
				.catch(console.error)
		}
		else {
			callbacks.get("onTrackRemoved")
				.then(function(callback) { return callback(event.detail.track) })
				.catch(console.error)
		}
	}
	handle.eventTarget.addEventListener("localtrack", onLocalTrack)

	// remember to remove the event listener
	cleanup.add(function() {
		handle.eventTarget.removeEventListener("localtrack", onLocalTrack)
	})

	// send the publish request
	return new Promise(function(fulfill, reject) {
		// the offer (local) sdp can be customized via mediaOptions.customizeSdp
		handle.createOffer(Object.assign({}, options.mediaOptions, {
			success: fulfill,
			error: reject
		}))
	})
		.then(function(offerJsep) {
			return handle.sendAsyncRequest({
				message: Object.assign({}, options.publishOptions, {
					request: "publish"
				}),
				jsep: offerJsep,
				expectResponse: function(r) {
					return r.message.videoroom == "event" && r.message.configured == "ok"
				}
			})
		})
		.then(function(response) {
			// remember to unpublish
			cleanup.add(function() {
				return handle.sendAsyncRequest({
					message: {request: "unpublish"},
					expectResponse: function(r) {
						return r.message.videoroom == "event" && r.message.unpublished == "ok"
					}
				})
			})

			// handle the answer JSEP
			return new Promise(function(fulfill, reject) {
				handle.handleRemoteJsep({
					jsep: response.jsep,
					success: fulfill,
					error: reject,
					customizeSdp: options.mediaOptions && options.mediaOptions.customizeRemoteSdp
				})
			})
		})
		.then(function() {
			// construct and return the VideoRoomPublisher object
			var pub = {
				publisherId: publisherId,
				onTrackAdded: function(callback) {
					callbacks.set("onTrackAdded", callback)
				},
				onTrackRemoved: function(callback) {
					callbacks.set("onTrackRemoved", callback)
				},
				configure: function(configureOptions) {
					return handle.sendAsyncRequest({
						message: Object.assign({}, configureOptions, {
							request: "configure"
						}),
						expectResponse: function(r) {
							return r.message.videoroom == "event" && r.message.configured == "ok"
						}
					})
				},
				restart: function(mediaOptions) {
					return new Promise(function(fulfill, reject) {
						handle.createOffer(Object.assign({}, mediaOptions, {
							success: fulfill,
							error: reject
						}))
					})
						.then(function(offerJsep) {
							return handle.sendAsyncRequest({
								message: {
									request: "configure",
								},
								jsep: offerJsep,
								expectResponse: function(r) {
									return r.message.videoroom == "event" && r.message.configured == "ok"
								}
							})
						})
						.then(function(response) {
							return new Promise(function(fulfill, reject) {
								handle.handleRemoteJsep({
									jsep: response.jsep,
									success: fulfill,
									error: reject
								})
							})
						})
						.then(function() {
							options.mediaOptions = mediaOptions
						})
				},
				unpublish: function() {
					return cleanup.run()
				}
			}
			return pub
		})
		.catch(function(err) {
			return cleanup.run().catch(console.error)
				.then(function() { throw err })
		})
}

export function createVideoRoomSubscriber(session, roomId, streams, options) {
	options = Object.assign({}, options)
	var cleanup = makeCleanup()
	var callbacks = makeCallbacks()

	// attach to plugin and get a separate handle for this subscriber
	return attachToPlugin(session, "janus.plugin.videoroom")
		.then(function(handle) {

			// remember to detach
			cleanup.add(function() {
				return new Promise(function(fulfill, reject) {
					handle.detach({
						success: fulfill,
						error: reject
					})
				})
			})

			// listen to events and invoke callbacks
			handle.eventTarget.addEventListener("remotetrack", function(event) {
				if (event.detail.added) {
					callbacks.get("onTrackAdded")
						.then(function(callback) { return callback(event.detail.track, event.detail.mid) })
						.catch(console.error)
				}
				else {
					callbacks.get("onTrackRemoved")
						.then(function(callback) { return callback(event.detail.track, event.detail.mid) })
						.catch(console.error)
				}
			})

			// join the room as a subscriber
			return handle.sendAsyncRequest({
				message: {
					request: "join",
					ptype: "subscriber",
					room: roomId,
					streams: streams
				},
				expectResponse: function(r) {
					return r.message.videoroom == "attached" && r.message.room == roomId
				}
			})
				.then(function(response) {
					return handleOffer(handle, response.jsep, options.mediaOptions)
				})
				.then(function() {
					// construct and return the VideoRoomSubscriber object
					var sub = {
						onTrackAdded: function(callback) {
							callbacks.set("onTrackAdded", callback)
						},
						onTrackRemoved: function(callback) {
							callbacks.set("onTrackRemoved", callback)
						},
						addStreams: function(streams) {
							return handle.sendAsyncRequest({
								message: {request: "subscribe", streams: streams},
								expectResponse: function(r) {
									return r.message.videoroom == "updated" && r.message.room == roomId
								}
							})
								.then(function(response) {
									if (response.jsep) return handleOffer(handle, response.jsep, options.mediaOptions)
								})
						},
						removeStreams: function(streams) {
							return handle.sendAsyncRequest({
								message: {request: "unsubscribe", streams: streams},
								expectResponse: function(r) {
									return r.message.videoroom == "updated" && r.message.room == roomId
								}
							})
								.then(function(response) {
									if (response.jsep) return handleOffer(handle, response.jsep, options.mediaOptions)
								})
						},
						pause: function() {
							return handle.sendAsyncRequest({
								message: {request: "pause"},
								expectResponse: function(r) {
									return r.message.videoroom == "event" && r.message.paused == "ok"
								}
							})
						},
						resume: function() {
							return handle.sendAsyncRequest({
								message: {request: "start"},
								expectResponse: function(r) {
									return r.message.videoroom == "event" && r.message.started == "ok"
								}
							})
						},
						configure: function(configureOptions) {
							return handle.sendAsyncRequest({
								message: Object.assign({}, configureOptions, {
									request: "configure",
									restart: false
								}),
								expectResponse: function(r) {
									return r.message.videoroom == "event" && r.message.configured == "ok"
								}
							})
						},
						restart: function(mediaOptions) {
							return handle.sendAsyncRequest({
								message: {
									request: "configure",
									restart: true
								},
								expectResponse: function(r) {
									return r.message.videoroom == "event" && r.message.configured == "ok"
								}
							})
								.then(function(response) {
									return handleOffer(handle, response.jsep, mediaOptions)
								})
								.then(function() {
									options.mediaOptions = mediaOptions
								})
						},
						unsubscribe: function() {
							return cleanup.run()
						}
					}
					return sub
				})
		})
		.catch(function(err) {
			return cleanup.run().catch(console.error)
				.then(function() { throw err })
		})
}

export function createStreamingSubscriber(session, mountPointId, options) {
	options = Object.assign({}, options)
	var cleanup = makeCleanup()
	var callbacks = makeCallbacks()

	// attach to the streaming plugin
	return attachToPlugin(session, "janus.plugin.streaming")
		.then(function(handle) {

			// remember to detach
			cleanup.add(function() {
				return new Promise(function(fulfill, reject) {
					handle.detach({
						success: fulfill,
						error: reject
					})
				})
			})

			// listen to events and invoke callbacks
			handle.eventTarget.addEventListener("remotetrack", function(event) {
				if (event.detail.added) {
					callbacks.get("onTrackAdded")
						.then(function(callback) { return callback(event.detail.track, event.detail.mid) })
						.catch(console.error)
				}
				else {
					callbacks.get("onTrackRemoved")
						.then(function(callback) { return callback(event.detail.track, event.detail.mid) })
						.catch(console.error)
				}
			})

			// send the watch request
			return handle.sendAsyncRequest({
				message: Object.assign({}, options.watchOptions, {
					request: "watch",
					id: mountPointId
				}),
				expectResponse: function(r) {
					return r.message.streaming == "event" && r.message.result && r.message.result.status == "preparing"
				}
			})
				.then(function(response) {
					return handleOffer(handle, response.jsep, options.mediaOptions)
				})
				.then(function() {
					// construct and return the StreamingSubscriber object
					var sub = {
						onTrackAdded: function(callback) {
							callbacks.set("onTrackAdded", callback)
						},
						onTrackRemoved: function(callback) {
							callbacks.set("onTrackRemoved", callback)
						},
						pause: function() {
							return handle.sendAsyncRequest({
								message: {request: "pause"},
								expectResponse: function(r) {
									return r.message.streaming == "event" && r.message.result && r.message.result.status == "pausing"
								}
							})
						},
						resume: function() {
							return handle.sendAsyncRequest({
								message: {request: "start"},
								expectResponse: function(r) {
									return r.message.streaming == "event" && r.message.result && r.message.result.status == "starting"
								}
							})
						},
						configure: function(configureOptions) {
							return handle.sendAsyncRequest({
								message: Object.assign({}, configureOptions, {
									request: "configure"
								}),
								expectResponse: function(r) {
									return r.message.streaming == "event" && r.message.result && r.message.result.event == "configured"
								}
							})
						},
						switch: function(newMountPointId) {
							return handle.sendAsyncRequest({
								message: {
									request: "switch",
									id: newMountPointId
								},
								expectResponse: function(r) {
									return r.message.streaming == "event" && r.message.result && r.message.result.switched == "ok"
								}
							})
								.then(function() {
									mountPointId = newMountPointId
								})
						},
						restart: function(newOptions) {
							newOptions = Object.assign({}, newOptions)
							return handle.sendAsyncRequest({
								message: Object.assign({}, newOptions.watchOptions, {
									request: "watch",
									id: mountPointId
								}),
								expectResponse: function(r) {
									return r.message.streaming == "event" && r.message.result && r.message.result.status == "preparing"
								}
							})
								.then(function(response) {
									return handleOffer(handle, response.jsep, newOptions.mediaOptions)
								})
								.then(function() {
									options = newOptions
								})
						},
						unsubscribe: function() {
							return cleanup.run()
						}
					}
					return sub
				})
		})
		.catch(function(err) {
			return cleanup.run().catch(console.error)
				.then(function() { throw err })
		})
}

export function handleOffer(handle, offerJsep, mediaOptions) {
	// allow customizing the remote (offer) sdp
	if (mediaOptions && mediaOptions.customizeRemoteSdp) {
		mediaOptions.customizeRemoteSdp(offerJsep)
	}

	// create and send the answer
	return new Promise(function(fulfill, reject) {
		// the answer (local) sdp can be customized via mediaOptions.customizeSdp
		handle.createAnswer(Object.assign({}, mediaOptions, {
			media: Object.assign({audioSend: false, videoSend: false}, mediaOptions && mediaOptions.media),
			jsep: offerJsep,
			success: fulfill,
			error: reject
		}))
	})
		.then(function(answerJsep) {
			return handle.sendAsyncRequest({
				message: {request: "start"},
				jsep: answerJsep,
				expectResponse: function(r) {
					return r.message.videoroom == "event" && r.message.started == "ok" ||
						r.message.streaming == "event" && r.message.result && r.message.result.status == "starting"
				}
			})
		})
}

export function makeCleanup() {
	var tasks = []
	return {
		add: function(task) {
			tasks.push(task)
		},
		run: function() {
			var promise = Promise.resolve()
			for (var i=tasks.length-1; i>=0; i--) promise = promise.then(tasks[i])
			return promise
		}
	}
}

export function makeCallbacks() {
	var promises = {}
	return {
		get: function(name) {
			if (!promises[name]) {
				var fulfill
				promises[name] = new Promise(function(f) { fulfill = f })
				promises[name].fulfill = fulfill
			}
			return promises[name]
		},
		set: function(name, value) {
			this.get(name).fulfill(value)
		}
	}
}

export function makeEventTarget() {
	var listeners = {}
	return {
		addEventListener: function(name, callback) {
			if (!listeners[name]) listeners[name] = []
			listeners[name].push(callback)
		},
		removeEventListener: function(name, callback) {
			if (!listeners[name]) return
			var index = listeners[name].indexOf(callback)
			if (index >= 0) listeners[name].splice(index, 1)
		},
		dispatchEvent: function(event) {
			if (!listeners[event.type]) return
			for (var i=0; i<listeners[event.type].length; i++) {
				listeners[event.type][i](event)
			}
		}
	}
}
