const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST / - create group
router.post('/', authenticate, (req, res) => {
  try {
    const { name, description, avatar, members } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Group name is required.' });
    }

    const groupId = uuidv4();
    db.prepare('INSERT INTO groups (id, name, description, avatar, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(groupId, name, description || null, avatar || null, req.user.id);

    // Add creator as admin
    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, req.user.id, 'admin');

    // Add members
    const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');
    if (members && Array.isArray(members)) {
      members.forEach(memberId => {
        if (memberId !== req.user.id) {
          addMember.run(groupId, memberId);
        }
      });
    }

    // Create conversation for the group
    const convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, type, name, avatar, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(convId, 'group', name, avatar || null, req.user.id);

    // Add all participants to conversation
    const addParticipant = db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)');
    addParticipant.run(convId, req.user.id);
    if (members && Array.isArray(members)) {
      members.forEach(memberId => {
        addParticipant.run(convId, memberId);
      });
    }

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    res.status(201).json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / - list user's groups
router.get('/', authenticate, (req, res) => {
  try {
    const groups = db.prepare(`
      SELECT g.*,
             (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
             c.last_message, c.last_message_time
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      LEFT JOIN conversations c ON c.type = 'group' AND c.created_by = g.created_by
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `).all(req.user.id);

    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:groupId - get group info
router.get('/:groupId', authenticate, (req, res) => {
  try {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const members = db.prepare(`
      SELECT gm.role, gm.muted, u.id, u.name, u.avatar, u.online, u.last_seen
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
      ORDER BY gm.role ASC, u.name ASC
    `).all(req.params.groupId);

    res.json({ group, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:groupId - update group (admin only)
router.put('/:groupId', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update the group.' });
    }

    const { name, description, avatar } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(req.params.groupId);
    db.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:groupId/members - add members (admin only)
router.post('/:groupId/members', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can add members.' });
    }

    const { members } = req.body;
    if (!members || !Array.isArray(members)) {
      return res.status(400).json({ error: 'members array is required.' });
    }

    const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');
    members.forEach(memberId => {
      addMember.run(req.params.groupId, memberId);
    });

    res.json({ message: 'Members added.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:groupId/members/:userId - remove member (admin only)
router.delete('/:groupId/members/:userId', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can remove members.' });
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
      .run(req.params.groupId, req.params.userId);

    res.json({ message: 'Member removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:groupId/members/:userId/role - change role (admin only)
router.put('/:groupId/members/:userId/role', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change roles.' });
    }

    const { role } = req.body;
    if (!['admin', 'moderator', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }

    db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?')
      .run(role, req.params.groupId, req.params.userId);

    res.json({ message: 'Role updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:groupId - leave group
router.delete('/:groupId', authenticate, (req, res) => {
  try {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    if (group.created_by === req.user.id) {
      return res.status(400).json({ error: 'Admin cannot leave. Transfer ownership first.' });
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
      .run(req.params.groupId, req.user.id);

    res.json({ message: 'Left the group.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:groupId/messages - send message to group
router.post('/:groupId/messages', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.params.groupId, req.user.id);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this group.' });
    }

    const { content, message_type, media_url, reply_to, media_width, media_height } = req.body;

    // Find the conversation for this group
    const conversation = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp ON c.id = cp.conversation_id
      WHERE c.type = 'group' AND cp.user_id = ?
      AND c.created_by = (SELECT created_by FROM groups WHERE id = ?)
    `).get(req.user.id, req.params.groupId);

    const conversationId = conversation ? conversation.id : uuidv4();

    if (!conversation) {
      db.prepare('INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)')
        .run(conversationId, 'group', db.prepare('SELECT name FROM groups WHERE id = ?').get(req.params.groupId).name, req.user.id);
    }

    const messageId = uuidv4();
    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, group_id, content, message_type, media_url, reply_to, media_width, media_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(messageId, conversationId, req.user.id, req.params.groupId, content || null,
        message_type || 'text', media_url || null, reply_to || null, media_width || null, media_height || null);

    db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
      .run(content || '[Media]', conversationId);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:groupId/messages - get group messages
router.get('/:groupId/messages', authenticate, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const messages = db.prepare(`
      SELECT m.* FROM messages m
      WHERE m.group_id = ? AND m.deleted = 0
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.params.groupId, limit, offset);

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
