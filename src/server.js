require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize database
const db = require('./config/database');

// Create required directories
const dirs = ['data', 'uploads/avatars', 'uploads/media', 'uploads/status', 'uploads/attachments'];
dirs.forEach(dir => {
  const fullDir = path.join(__dirname, '..', '..', dir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }
});

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Import socket service
const { setupSocket } = require('./services/socketService');
setupSocket(io);

// Middleware
app.use(cors());
app.use(express.json());

// Response wrapper: todas las respuestas exitosas se envuelven en { success: true, data: ... }
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    // Errores pasan tal cual
    if (res.statusCode >= 400) {
      return originalJson(data);
    }
    // Envolver en formato estándar
    return originalJson({ success: true, data: data });
  };
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/status', require('./routes/status'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/search', require('./routes/search'));
app.use('/api/communities', require('./routes/communities'));
app.use('/api/calls', require('./routes/calls'));

// Serve static files from uploads
app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Civis server running on port ${PORT}`);
});

module.exports = { app, server, io };
