const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://sirasitaundang-tech.github.io", "http://localhost:5500"],
    methods: ["GET", "POST"]
  }
});

let latestData = "";

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  socket.emit('sync-data', latestData);

  socket.on('update-data', (newData) => {
    latestData = newData;
    socket.broadcast.emit('sync-data', newData);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
