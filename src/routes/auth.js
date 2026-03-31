const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'civis_jwt_secret_key_2024';

// POST /register
router.post('/register', (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const id = uuidv4();

    db.prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)').run(id, email, hashedPassword, name);

    const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '7d' });

    const user = db.prepare('SELECT id, email, name, phone, avatar, bio, online, last_seen, created_at FROM users WHERE id = ?').get(id);

    res.status(201).json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully.' });
});

// GET /verify-token
router.get('/verify-token', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, phone, avatar, bio, online, last_seen, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
