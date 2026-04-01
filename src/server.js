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

// Convierte camelCase a snake_case en los bodies entrantes
// (Android envía camelCase via Retrofit/Gson, SQLite usa snake_case)
function toSnakeCase(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(toSnakeCase);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const newObj = {};
    for (const key of Object.keys(obj)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      newObj[snakeKey] = toSnakeCase(obj[key]);
    }
    return newObj;
  }
  return obj;
}
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body = toSnakeCase(req.body);
  }
  next();
});

// Nombres de campos booleanos que SQLite almacena como 0/1
const BOOLEAN_FIELDS = [
  'online', 'read', 'deleted', 'forwarded', 'muted', 'blocked',
  'only_admins_can_send', 'only_admins_can_edit', 'only_admins_can_post', 'is_public'
];

// Convierte recursivamente 0/1 a true/false para campos booleanos conocidos
function fixResponseBooleans(data) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map(fixResponseBooleans);
  }
  if (typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      if ((value === 0 || value === 1) && BOOLEAN_FIELDS.includes(key)) {
        result[key] = value === 1;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = fixResponseBooleans(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return data;
}

// Response wrapper: todas las respuestas exitosas se envuelven en { success: true, data: ... }
// Además convierte 0/1 a true/false automáticamente
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    // Errores pasan tal cual
    if (res.statusCode >= 400) {
      return originalJson(data);
    }
    // Corregir booleanos y envolver en formato estándar
    const fixedData = fixResponseBooleans(data);
    return originalJson({ success: true, data: fixedData });
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
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Civis server running on port ${PORT}`);
});

module.exports = { app, server, io };
