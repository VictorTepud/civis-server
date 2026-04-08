const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');

// =============================================
// AUTENTICACIÓN PARA RUTAS HTTP (REST)
// =============================================
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token de autenticación no proporcionado'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const db = getDb();
    const user = db.prepare('SELECT id, email, username, display_name, avatar, about, phone, is_online, last_seen, privacy_profile_photo, privacy_about, privacy_last_seen, privacy_status FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Token inválido'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expirado'
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Error de autenticación'
    });
  }
}

// =============================================
// AUTENTICACIÓN PARA SOCKETS (WebSocket)
// =============================================
function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      return next(new Error('Token de autenticación no proporcionado'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const db = getDb();
    const user = db.prepare('SELECT id, email, username, display_name, avatar, about, phone, is_online, last_seen FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return next(new Error('Usuario no encontrado'));
    }

    socket.user = user;
    next();
  } catch (error) {
    return next(new Error('Autenticación fallida: ' + error.message));
  }
}

// Opcional: no falla si no hay token
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const db = getDb();
      const user = db.prepare('SELECT id, email, username, display_name, avatar, about, phone, is_online, last_seen FROM users WHERE id = ?').get(decoded.userId);
      req.user = user;
    }
  } catch (error) {
    // Token inválido, se continua sin usuario
  }
  next();
}

module.exports = { authenticate, authenticateSocket, optionalAuth };
