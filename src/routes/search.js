const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /global?q= - search users, groups, communities
router.get('/global', authenticate, (req, res) => {
  try {
    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: 'Search query is required.' });
    }

    const users = db.prepare("SELECT id, name, email, avatar, online FROM users WHERE name LIKE ? OR email LIKE ? LIMIT 20")
      .all(`%${q}%`, `%${q}%`);

    const groups = db.prepare("SELECT g.id, g.name, g.description, g.avatar, (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count FROM groups g WHERE g.name LIKE ? LIMIT 20")
      .all(`%${q}%`);

    const communities = db.prepare("SELECT id, name, description, avatar FROM communities WHERE name LIKE ? LIMIT 20")
      .all(`%${q}%`);

    res.json({ users, groups, communities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /users?q= - search users
router.get('/users', authenticate, (req, res) => {
  try {
    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: 'Search query is required.' });
    }

    const users = db.prepare("SELECT id, name, email, avatar, online FROM users WHERE name LIKE ? OR email LIKE ? LIMIT 20")
      .all(`%${q}%`, `%${q}%`);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /messages?q= - search messages in conversations
router.get('/messages', authenticate, (req, res) => {
  try {
    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: 'Search query is required.' });
    }

    const messages = db.prepare(`
      SELECT m.*, u.name as sender_name
      FROM messages m
      JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
      JOIN users u ON m.sender_id = u.id
      WHERE cp.user_id = ? AND m.content LIKE ? AND m.deleted = 0
      ORDER BY m.created_at DESC
      LIMIT 50
    `).all(req.user.id, `%${q}%`);

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
