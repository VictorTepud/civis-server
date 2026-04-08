require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const contactRoutes = require('./routes/contacts');
const messageRoutes = require('./routes/messages');
const groupRoutes = require('./routes/groups');
const statusRoutes = require('./routes/status');
const uploadRoutes = require('./routes/upload');
const searchRoutes = require('./routes/search');
const communityRoutes = require('./routes/communities');
const callRoutes = require('./routes/calls');

const { initDatabase } = require('./config/database');
const { setupSocket } = require('./services/socketService');
const fcmService = require('./services/fcmService');
const { authenticateSocket } = require('./middlewares/authMiddleware');

const app = express();
const server = http.createServer(app);

// ===================== CORS =====================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ===================== MIDDLEWARES =====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Archivos estáticos para uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ===================== RUTAS REST =====================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/calls', callRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Civis Server', version: '1.0.0' });
});

// ===================== SOCKET.IO =====================
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware de autenticación para sockets
io.use(authenticateSocket);

// Configurar eventos de socket
setupSocket(io);

// ===================== INICIO =====================
const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Inicializar base de datos
    initDatabase();
    console.log('✅ Base de datos SQLite inicializada correctamente');

    // Inicializar Firebase Cloud Messaging
    fcmService.init();

    // Iniciar servidor HTTP
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor Civis ejecutándose en http://0.0.0.0:${PORT}`);
      console.log(`📡 Socket.io listo para conexiones en tiempo real`);
      console.log(`📁 Uploads disponibles en /uploads`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
}

startServer();

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});

module.exports = { app, server, io };
