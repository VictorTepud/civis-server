const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /add - add contact by email or userId
router.post('/add', authenticate, (req, res) => {
  try {
    const { email, userId } = req.body;
    
    let contactUser;
    if (email) {
      contactUser = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);
    } else if (userId) {
      contactUser = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
    }
    
    if (!contactUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (contactUser.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself as a contact.' });
    }

    const existing = db.prepare('SELECT id FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, contactUser.id);
    if (existing) {
      return res.status(409).json({ error: 'Contact already exists.' });
    }

    const id1 = uuidv4();
    const id2 = uuidv4();

    const insertContact = db.prepare('INSERT INTO contacts (id, user_id, contact_id) VALUES (?, ?, ?)');
    const insertMany = db.transaction(() => {
      insertContact.run(id1, req.user.id, contactUser.id);
      insertContact.run(id2, contactUser.id, req.user.id);
    });
    insertMany();

    res.status(201).json({ contact: contactUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /remove - remove contact
router.delete('/remove', authenticate, (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) {
      return res.status(400).json({ error: 'contactId is required.' });
    }

    const deleteContact = db.transaction(() => {
      db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.user.id, contactId);
      db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(contactId, req.user.id);
    });
    deleteContact();

    res.json({ message: 'Contact removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:contactId/block - toggle block
router.put('/:contactId/block', authenticate, (req, res) => {
  try {
    const contact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, req.params.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found.' });
    }

    const newBlocked = contact.blocked ? 0 : 1;
    db.prepare('UPDATE contacts SET blocked = ? WHERE user_id = ? AND contact_id = ?').run(newBlocked, req.user.id, req.params.contactId);

    res.json({ blocked: !!newBlocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:contactId/mute - toggle mute
router.put('/:contactId/mute', authenticate, (req, res) => {
  try {
    const contact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, req.params.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found.' });
    }

    const newMuted = contact.muted ? 0 : 1;
    db.prepare('UPDATE contacts SET muted = ? WHERE user_id = ? AND contact_id = ?').run(newMuted, req.user.id, req.params.contactId);

    res.json({ muted: !!newMuted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:contactId/nickname - set nickname
router.put('/:contactId/nickname', authenticate, (req, res) => {
  try {
    const { nickname } = req.body;
    const contact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, req.params.contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found.' });
    }

    db.prepare('UPDATE contacts SET nickname = ? WHERE user_id = ? AND contact_id = ?').run(nickname || null, req.user.id, req.params.contactId);

    res.json({ nickname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / - list contacts
router.get('/', authenticate, (req, res) => {
  try {
    const contacts = db.prepare(`
      SELECT c.id, c.contact_id, c.nickname, c.blocked, c.muted, c.created_at,
             u.name, u.phone, u.avatar, u.bio, u.online, u.last_seen, u.email
      FROM contacts c
      JOIN users u ON c.contact_id = u.id
      WHERE c.user_id = ?
      ORDER BY u.name ASC
    `).all(req.user.id);

    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
