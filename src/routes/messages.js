const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// Helper: get io instance
let io;
function getIo() {
  if (!io) {
    const { getServerIo } = require('../services/socketService');
    io = getServerIo();
  }
  return io;
}

// GET /conversations - list conversations
router.get('/conversations', authenticate, (req, res) => {
  try {
    const conversations = db.prepare(`
      SELECT cp.conversation_id, c.type, c.name, c.avatar, c.last_message, c.last_message_time,
             (SELECT COUNT(*) FROM messages m
              WHERE m.conversation_id = cp.conversation_id
              AND m.sender_id != cp.user_id AND m.read = 0 AND m.deleted = 0) as unread_count
      FROM conversation_participants cp
      JOIN conversations c ON cp.conversation_id = c.id
      WHERE cp.user_id = ?
      ORDER BY c.last_message_time DESC
    `).all(req.user.id);

    const result = conversations.map(conv => {
      if (conv.type === 'private') {
        const otherParticipant = db.prepare(`
          SELECT u.id, u.name, u.avatar, u.online, u.last_seen
          FROM conversation_participants cp
          JOIN users u ON cp.user_id = u.id
          WHERE cp.conversation_id = ? AND cp.user_id != ?
        `).get(conv.conversation_id, req.user.id);
        return { ...conv, other_user: otherParticipant };
      }
      return conv;
    });

    res.json({ conversations: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send - send message
router.post('/send', authenticate, (req, res) => {
  try {
    const { receiver_id, content, message_type, media_url, location_lat, location_lng, reply_to, forwarded } = req.body;

    if (!receiver_id && !req.body.group_id) {
      return res.status(400).json({ error: 'receiver_id is required.' });
    }

    // Find or create conversation
    let conversation = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
      JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
      WHERE c.type = 'private'
    `).get(req.user.id, receiver_id);

    if (!conversation) {
      const convId = uuidv4();
      db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(convId, 'private', req.user.id);
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, req.user.id);
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, receiver_id);
      conversation = { id: convId };
    }

    const messageId = uuidv4();
    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, media_url, location_lat, location_lng, reply_to, forwarded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(messageId, conversation.id, req.user.id, receiver_id, content || null,
        message_type || 'text', media_url || null, location_lat || null, location_lng || null,
        reply_to || null, forwarded ? 1 : 0);

    db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
      .run(content || '[Media]', conversation.id);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);

    // Emit via socket
    const socketIo = getIo();
    if (socketIo) {
      socketIo.emit(`message_${receiver_id}`, message);
    }

    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:conversationId - get messages
router.get('/:conversationId', authenticate, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const messages = db.prepare(`
      SELECT m.* FROM messages m
      WHERE m.conversation_id = ? AND m.deleted = 0
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.params.conversationId, limit, offset);

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:messageId/read - mark as read
router.put('/:messageId/read', authenticate, (req, res) => {
  try {
    db.prepare('UPDATE messages SET read = 1 WHERE id = ? AND receiver_id = ?')
      .run(req.params.messageId, req.user.id);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    const socketIo = getIo();
    if (socketIo && message) {
      socketIo.emit(`message_read_${message.sender_id}`, { messageId: req.params.messageId, read_by: req.user.id });
    }

    res.json({ message: 'Message marked as read.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:messageId/reply - reply to message
router.post('/:messageId/reply', authenticate, (req, res) => {
  try {
    const originalMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    if (!originalMessage) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const { content, message_type, media_url } = req.body;
    const messageId = uuidv4();

    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, media_url, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(messageId, originalMessage.conversation_id, req.user.id, originalMessage.sender_id,
        content || null, message_type || 'text', media_url || null, req.params.messageId);

    db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
      .run(content || '[Media]', originalMessage.conversation_id);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:messageId/forward - forward message
router.post('/:messageId/forward', authenticate, (req, res) => {
  try {
    const originalMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    if (!originalMessage) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const { receiver_id } = req.body;
    if (!receiver_id) {
      return res.status(400).json({ error: 'receiver_id is required.' });
    }

    // Find or create conversation with receiver
    let conversation = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
      JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
      WHERE c.type = 'private'
    `).get(req.user.id, receiver_id);

    if (!conversation) {
      const convId = uuidv4();
      db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(convId, 'private', req.user.id);
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, req.user.id);
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, receiver_id);
      conversation = { id: convId };
    }

    const messageId = uuidv4();
    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, media_url, forwarded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(messageId, conversation.id, req.user.id, receiver_id,
        originalMessage.content, originalMessage.message_type, originalMessage.media_url, 1);

    db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
      .run(originalMessage.content || '[Media]', conversation.id);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:messageId - soft delete
router.delete('/:messageId', authenticate, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (message.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Cannot delete other user\'s message.' });
    }

    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(req.params.messageId);

    res.json({ message: 'Message deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
