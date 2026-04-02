const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST / - create status
router.post('/', authenticate, (req, res) => {
  try {
    const { type, content, media_url, background_color } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Content is required.' });
    }

    const id = uuidv4();
    // Status expires in 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`INSERT INTO statuses (id, user_id, type, content, media_url, background_color, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.user.id, type || 'text', content, media_url || null, background_color || null, expiresAt);

    const status = db.prepare('SELECT * FROM statuses WHERE id = ?').get(id);
    res.status(201).json({ status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / - list statuses from contacts + own, not expired
router.get('/', authenticate, (req, res) => {
  try {
    const contactIds = db.prepare('SELECT contact_id FROM contacts WHERE user_id = ?').all(req.user.id).map(c => c.contact_id);
    const allUserIds = [req.user.id, ...contactIds];

    const placeholders = allUserIds.map(() => '?').join(',');
    const statuses = db.prepare(`
      SELECT s.*, u.name, u.avatar
      FROM statuses s
      JOIN users u ON s.user_id = u.id
      WHERE s.user_id IN (${placeholders}) AND s.expires_at > datetime('now')
      ORDER BY s.created_at DESC
    `).all(...allUserIds);

    // Group by user
    const grouped = {};
    statuses.forEach(s => {
      if (!grouped[s.user_id]) {
        grouped[s.user_id] = { user_id: s.user_id, name: s.name, avatar: s.avatar, statuses: [] };
      }
      grouped[s.user_id].statuses.push(s);
    });

    res.json({ statuses: Object.values(grouped) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /my - list own active statuses
router.get('/my', authenticate, (req, res) => {
  try {
    const statuses = db.prepare(`
      SELECT s.* FROM statuses s
      WHERE s.user_id = ? AND s.expires_at > datetime('now')
      ORDER BY s.created_at DESC
    `).all(req.user.id);

    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /user/:userId - list user's active statuses
router.get('/user/:userId', authenticate, (req, res) => {
  try {
    const statuses = db.prepare(`
      SELECT s.* FROM statuses s
      WHERE s.user_id = ? AND s.expires_at > datetime('now')
      ORDER BY s.created_at DESC
    `).all(req.params.userId);

    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:statusId/view - mark as viewed
router.post('/:statusId/view', authenticate, (req, res) => {
  try {
    const status = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.statusId);
    if (!status) {
      return res.status(404).json({ error: 'Status not found.' });
    }

    let viewers = JSON.parse(status.viewers || '[]');
    if (!viewers.includes(req.user.id)) {
      viewers.push(req.user.id);
      db.prepare('UPDATE statuses SET viewers = ? WHERE id = ?').run(JSON.stringify(viewers), req.params.statusId);
    }

    res.json({ viewed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:statusId/reply - reply to status
router.post('/:statusId/reply', authenticate, (req, res) => {
  try {
    const status = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.statusId);
    if (!status) {
      return res.status(404).json({ error: 'Status not found.' });
    }

    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Reply content is required.' });
    }

    let replies = JSON.parse(status.replies || '[]');
    replies.push({ user_id: req.user.id, content, created_at: new Date().toISOString() });
    db.prepare('UPDATE statuses SET replies = ? WHERE id = ?').run(JSON.stringify(replies), req.params.statusId);

    res.json({ message: 'Reply added.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:statusId - delete own status
router.delete('/:statusId', authenticate, (req, res) => {
  try {
    const status = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.statusId);
    if (!status) {
      return res.status(404).json({ error: 'Status not found.' });
    }

    if (status.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Cannot delete other user\'s status.' });
    }

    db.prepare('DELETE FROM statuses WHERE id = ?').run(req.params.statusId);

    res.json({ message: 'Status deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
