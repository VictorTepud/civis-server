const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'civis_jwt_secret_key_2024';

// HTTP middleware
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

// Socket.io middleware
function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      return next(new Error('Authentication error: No token'));
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = { id: decoded.id, email: decoded.email };
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
}

module.exports = { authenticate, socketAuthMiddleware };
