const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /profile
router.get('/profile', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, phone, avatar, bio, privacy_settings, online, last_seen, created_at, updated_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /profile
router.put('/profile', authenticate, (req, res) => {
  try {
    const { name, phone, bio, avatar } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (bio !== undefined) { updates.push('bio = ?'); values.push(bio); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    updates.push("updated_at = datetime('now')");
    values.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const user = db.prepare('SELECT id, email, name, phone, avatar, bio, privacy_settings, online, last_seen, created_at, updated_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /privacy
router.put('/privacy', authenticate, (req, res) => {
  try {
    const { privacy_settings } = req.body;
    if (!privacy_settings) {
      return res.status(400).json({ error: 'privacy_settings is required.' });
    }

    db.prepare("UPDATE users SET privacy_settings = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(privacy_settings), req.user.id);

    const user = db.prepare('SELECT id, email, name, phone, avatar, bio, privacy_settings, online, last_seen, created_at, updated_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /password
router.put('/password', authenticate, (req, res) => {
  try {
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(400).json({ error: 'Old password and new password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const valid = bcrypt.compareSync(old_password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Old password is incorrect.' });
    }

    const hashedPassword = bcrypt.hashSync(new_password, 10);
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?").run(hashedPassword, req.user.id);

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:userId
router.get('/:userId', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, phone, avatar, bio, online, last_seen FROM users WHERE id = ?').get(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
