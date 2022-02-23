const express = require('express')
const app = express()
const server = require('http').Server(app)
const io = require('socket.io')(server)
const { v4: uuidV4 } = require('uuid')

app.set('view engine', 'ejs')
app.use(express.static('public'))

app.get('/', (req, res) => {
	res.redirect(`/${uuidV4()}`)
})

app.get('/:room', (req, res) => {
	res.render('room', { roomId: req.params.room })
})

io.on('connection', socket => {
	socket.on('join-room', (roomId) => {
		socket.join(roomId);
		socket.to(roomId).emit('user-connected', socket.id);

		socket.on('disconnect', () => {
			socket.to(roomId).emit('user-disconnected', socket.id);
		});

		socket.on('offer', (offer, userId) => {
			io.to(userId).emit('offer', offer, socket.id);
		});

		socket.on('answer', (answer, userId) => {
			io.to(userId).emit('answer', answer, socket.id);
		});

		socket.on('candidate', (candidate, userId) => {
			io.to(userId).emit('candidate', candidate, socket.id);
		});
	});
});

server.listen(3000)