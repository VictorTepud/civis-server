const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST / - create community
router.post('/', authenticate, (req, res) => {
  try {
    const { name, description, avatar, cover, settings } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Community name is required.' });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO communities (id, name, description, avatar, cover, created_by, settings) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, description || null, avatar || null, cover || null, req.user.id,
        JSON.stringify(settings || { join_approval: false }));

    // Add creator as owner
    db.prepare('INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)')
      .run(id, req.user.id, 'owner');

    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(id);
    res.status(201).json({ community });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / - list user's communities
router.get('/', authenticate, (req, res) => {
  try {
    const communities = db.prepare(`
      SELECT c.*,
             (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) as member_count
      FROM communities c
      JOIN community_members cm ON c.id = cm.community_id
      WHERE cm.user_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.id);

    res.json({ communities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /discover - list public communities
router.get('/discover', authenticate, (req, res) => {
  try {
    const communities = db.prepare(`
      SELECT c.*,
             (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) as member_count
      FROM communities c
      ORDER BY c.created_at DESC
      LIMIT 50
    `).all();

    res.json({ communities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:communityId - get community with channels
router.get('/:communityId', authenticate, (req, res) => {
  try {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const channels = db.prepare('SELECT * FROM community_channels WHERE community_id = ? ORDER BY created_at ASC')
      .all(req.params.communityId);

    res.json({ community, channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:communityId - update community (owner/admin)
router.put('/:communityId', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owner or admin can update the community.' });
    }

    const { name, description, avatar, cover } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }
    if (cover !== undefined) { updates.push('cover = ?'); values.push(cover); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(req.params.communityId);
    db.prepare(`UPDATE communities SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    res.json({ community });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:communityId - delete community (owner)
router.delete('/:communityId', authenticate, (req, res) => {
  try {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    if (community.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can delete the community.' });
    }

    const deleteCommunity = db.transaction(() => {
      db.prepare('DELETE FROM channel_messages WHERE channel_id IN (SELECT id FROM community_channels WHERE community_id = ?)').run(req.params.communityId);
      db.prepare('DELETE FROM community_channels WHERE community_id = ?').run(req.params.communityId);
      db.prepare('DELETE FROM community_members WHERE community_id = ?').run(req.params.communityId);
      db.prepare('DELETE FROM join_requests WHERE community_id = ?').run(req.params.communityId);
      db.prepare('DELETE FROM communities WHERE id = ?').run(req.params.communityId);
    });
    deleteCommunity();

    res.json({ message: 'Community deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:communityId/join - join community
router.post('/:communityId/join', authenticate, (req, res) => {
  try {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const existing = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'Already a member.' });
    }

    // Check if join approval is required
    const settings = JSON.parse(community.settings || '{}');
    if (settings.join_approval) {
      // Create join request
      const requestId = uuidv4();
      db.prepare('INSERT INTO join_requests (id, community_id, user_id) VALUES (?, ?, ?)')
        .run(requestId, req.params.communityId, req.user.id);
      return res.json({ message: 'Join request submitted.', request_id: requestId });
    }

    db.prepare('INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)')
      .run(req.params.communityId, req.user.id, 'member');

    res.json({ message: 'Joined community.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:communityId/leave - leave community
router.post('/:communityId/leave', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership) {
      return res.status(404).json({ error: 'Not a member.' });
    }

    if (membership.role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership first.' });
    }

    db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?')
      .run(req.params.communityId, req.user.id);

    res.json({ message: 'Left community.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:communityId/join-request - request to join
router.post('/:communityId/join-request', authenticate, (req, res) => {
  try {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const existing = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'Already a member.' });
    }

    const pendingRequest = db.prepare("SELECT * FROM join_requests WHERE community_id = ? AND user_id = ? AND status = 'pending'")
      .get(req.params.communityId, req.user.id);
    if (pendingRequest) {
      return res.status(409).json({ error: 'Join request already pending.' });
    }

    const requestId = uuidv4();
    db.prepare('INSERT INTO join_requests (id, community_id, user_id) VALUES (?, ?, ?)')
      .run(requestId, req.params.communityId, req.user.id);

    res.status(201).json({ message: 'Join request submitted.', request_id: requestId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:communityId/join-request/:requestId - approve/reject join request (admin)
router.put('/:communityId/join-request/:requestId', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owner or admin can manage join requests.' });
    }

    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected.' });
    }

    const request = db.prepare('SELECT * FROM join_requests WHERE id = ? AND community_id = ?')
      .get(req.params.requestId, req.params.communityId);
    if (!request) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    db.prepare('UPDATE join_requests SET status = ? WHERE id = ?').run(status, req.params.requestId);

    if (status === 'approved') {
      db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)')
        .run(req.params.communityId, request.user_id, 'member');
    }

    res.json({ message: `Join request ${status}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:communityId/members - list members
router.get('/:communityId/members', authenticate, (req, res) => {
  try {
    const members = db.prepare(`
      SELECT cm.role, cm.joined_at, u.id, u.name, u.avatar, u.online
      FROM community_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.community_id = ?
      ORDER BY cm.role ASC, u.name ASC
    `).all(req.params.communityId);

    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:communityId/channels - create channel
router.post('/:communityId/channels', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owner or admin can create channels.' });
    }

    const { name, description, type } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Channel name is required.' });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO community_channels (id, community_id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.params.communityId, name, description || null, type || 'text', req.user.id);

    const channel = db.prepare('SELECT * FROM community_channels WHERE id = ?').get(id);
    res.status(201).json({ channel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:communityId/channels - list channels
router.get('/:communityId/channels', authenticate, (req, res) => {
  try {
    const channels = db.prepare('SELECT * FROM community_channels WHERE community_id = ? ORDER BY created_at ASC')
      .all(req.params.communityId);

    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:communityId/channels/:channelId - update channel (admin)
router.put('/:communityId/channels/:channelId', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owner or admin can update channels.' });
    }

    const { name, description } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(req.params.channelId);
    db.prepare(`UPDATE community_channels SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const channel = db.prepare('SELECT * FROM community_channels WHERE id = ?').get(req.params.channelId);
    res.json({ channel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:communityId/channels/:channelId - delete channel (admin)
router.delete('/:communityId/channels/:channelId', authenticate, (req, res) => {
  try {
    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'Only owner or admin can delete channels.' });
    }

    db.prepare('DELETE FROM channel_messages WHERE channel_id = ?').run(req.params.channelId);
    db.prepare('DELETE FROM community_channels WHERE id = ?').run(req.params.channelId);

    res.json({ message: 'Channel deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:communityId/channels/:channelId/messages - send message
router.post('/:communityId/channels/:channelId/messages', authenticate, (req, res) => {
  try {
    const channel = db.prepare('SELECT * FROM community_channels WHERE id = ? AND community_id = ?')
      .get(req.params.channelId, req.params.communityId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found.' });
    }

    const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this community.' });
    }

    const { content, message_type, media_url } = req.body;
    const id = uuidv4();

    db.prepare('INSERT INTO channel_messages (id, channel_id, sender_id, content, message_type, media_url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.params.channelId, req.user.id, content || null, message_type || 'text', media_url || null);

    const message = db.prepare('SELECT cm.*, u.name as sender_name FROM channel_messages cm JOIN users u ON cm.sender_id = u.id WHERE cm.id = ?').get(id);
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:communityId/channels/:channelId/messages - get channel messages
router.get('/:communityId/channels/:channelId/messages', authenticate, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const messages = db.prepare(`
      SELECT cm.*, u.name as sender_name
      FROM channel_messages cm
      JOIN users u ON cm.sender_id = u.id
      WHERE cm.channel_id = ?
      ORDER BY cm.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.params.channelId, limit, offset);

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
