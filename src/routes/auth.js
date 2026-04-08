const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// =============================================
// REGISTRO DE USUARIO
// =============================================
router.post('/register', async (req, res) => {
  try {
    const { email, password, display_name, phone, username } = req.body;

    // Validaciones
    if (!email || !password || !display_name) {
      return res.status(400).json({
        success: false,
        error: 'Email, contraseña y nombre son requeridos'
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Formato de email inválido'
      });
    }

    // Validar longitud de contraseña
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    const db = getDb();

    // Verificar email único
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        error: 'El email ya está registrado'
      });
    }

    // Verificar username único (si se proporciona)
    if (username) {
      const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
      if (existingUsername) {
        return res.status(409).json({
          success: false,
          error: 'El nombre de usuario ya está en uso'
        });
      }
    }

    // Verificar teléfono único (si se proporciona)
    if (phone) {
      const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
      if (existingPhone) {
        return res.status(409).json({
          success: false,
          error: 'El número de teléfono ya está registrado'
        });
      }
    }

    // Hash de contraseña
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Crear usuario
    const userId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, email, password, display_name, phone, username)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      email.toLowerCase().trim(),
      hashedPassword,
      display_name.trim(),
      phone ? phone.trim() : null,
      username ? username.toLowerCase().trim() : null
    );

    // Generar token JWT
    const token = jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Obtener el usuario creado (sin contraseña)
    const user = db.prepare(`
      SELECT id, email, username, display_name, avatar, about, phone, is_online, last_seen, created_at
      FROM users WHERE id = ?
    `).get(userId);

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      data: { user, token }
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// =============================================
// INICIO DE SESIÓN
// =============================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email y contraseña son requeridos'
      });
    }

    const db = getDb();

    // Buscar usuario por email
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas'
      });
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas'
      });
    }

    // Actualizar último acceso
    db.prepare("UPDATE users SET last_seen = datetime('now'), is_online = 1 WHERE id = ?").run(user.id);

    // Generar token JWT
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Retornar datos del usuario (sin contraseña)
    const userData = {
      id: user.id,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar: user.avatar,
      about: user.about,
      phone: user.phone,
      is_online: user.is_online,
      last_seen: user.last_seen,
      created_at: user.created_at
    };

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      data: { user: userData, token }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// =============================================
// VERIFICAR TOKEN
// =============================================
router.get('/verify', authenticate, (req, res) => {
  res.json({
    success: true,
    data: { user: req.user }
  });
});

// =============================================
// CERRAR SESIÓN
// =============================================
router.post('/logout', authenticate, (req, res) => {
  try {
    const db = getDb();
    db.prepare("UPDATE users SET is_online = 0, last_seen = datetime('now') WHERE id = ?").run(req.user.id);

    res.json({
      success: true,
      message: 'Sesión cerrada exitosamente'
    });
  } catch (error) {
    console.error('Error en logout:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

module.exports = router;
