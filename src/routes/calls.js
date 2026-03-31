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

// POST /initiate - create call
router.post('/initiate', authenticate, (req, res) => {
  try {
    const { receiver_id, group_id, type } = req.body;
    const callType = type || (group_id ? 'group' : 'private');

    if (callType === 'private' && !receiver_id) {
      return res.status(400).json({ error: 'receiver_id is required for private calls.' });
    }

    if (callType === 'group' && !group_id) {
      return res.status(400).json({ error: 'group_id is required for group calls.' });
    }

    const id = uuidv4();
    db.prepare("INSERT INTO calls (id, type, caller_id, receiver_id, group_id, status) VALUES (?, ?, ?, ?, ?, 'ringing')")
      .run(id, callType, req.user.id, receiver_id || null, group_id || null);

    // Add caller as participant
    db.prepare('INSERT INTO call_participants (call_id, user_id) VALUES (?, ?)').run(id, req.user.id);

    // Emit call signal to target
    const socketIo = getIo();
    if (socketIo) {
      if (receiver_id) {
        socketIo.emit(`call_signal_${receiver_id}`, { call_id: id, caller_id: req.user.id, type: callType });
      }
      if (group_id) {
        socketIo.emit(`group_call_${group_id}`, { call_id: id, caller_id: req.user.id, type: callType });
      }
    }

    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
    res.status(201).json({ call });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:callId/answer - answer call
router.post('/:callId/answer', authenticate, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    if (call.status !== 'ringing') {
      return res.status(400).json({ error: 'Call is not ringing.' });
    }

    db.prepare("UPDATE calls SET status = 'ongoing' WHERE id = ?").run(req.params.callId);

    // Add participant
    db.prepare('INSERT OR IGNORE INTO call_participants (call_id, user_id) VALUES (?, ?)')
      .run(req.params.callId, req.user.id);

    const updatedCall = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    res.json({ call: updatedCall });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:callId/reject - reject call
router.post('/:callId/reject', authenticate, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    db.prepare("UPDATE calls SET status = 'rejected', ended_at = datetime('now') WHERE id = ?").run(req.params.callId);

    const updatedCall = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    res.json({ call: updatedCall });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:callId/end - end call
router.post('/:callId/end', authenticate, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    const duration = req.body.duration || 0;
    db.prepare("UPDATE calls SET status = 'ended', ended_at = datetime('now'), duration = ? WHERE id = ?")
      .run(duration, req.params.callId);

    const updatedCall = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    res.json({ call: updatedCall });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:callId/join - join call
router.post('/:callId/join', authenticate, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    db.prepare('INSERT OR IGNORE INTO call_participants (call_id, user_id) VALUES (?, ?)')
      .run(req.params.callId, req.user.id);

    res.json({ message: 'Joined call.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:callId/leave - leave call
router.post('/:callId/leave', authenticate, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    db.prepare('DELETE FROM call_participants WHERE call_id = ? AND user_id = ?')
      .run(req.params.callId, req.user.id);

    res.json({ message: 'Left call.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:callId/signal - store and relay WebRTC signal
router.post('/:callId/signal', authenticate, (req, res) => {
  try {
    const { signal_type, signal_data, target_user_id } = req.body;
    if (!signal_type) {
      return res.status(400).json({ error: 'signal_type is required.' });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO call_signals (id, call_id, sender_id, signal_type, signal_data) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.params.callId, req.user.id, signal_type, signal_data || null);

    // Emit signal to other participants or specific target
    const socketIo = getIo();
    if (socketIo) {
      if (target_user_id) {
        socketIo.emit(`call_signal_${target_user_id}`, {
          call_id: req.params.callId,
          sender_id: req.user.id,
          signal_type,
          signal_data
        });
      } else {
        socketIo.emit(`call_signal_all_${req.params.callId}`, {
          call_id: req.params.callId,
          sender_id: req.user.id,
          signal_type,
          signal_data
        });
      }
    }

    res.json({ message: 'Signal sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /history - get user's call history (must be before /:callId)
router.get('/history', authenticate, (req, res) => {
  try {
    const calls = db.prepare(`
      SELECT c.*,
             (SELECT COUNT(*) FROM call_participants cp WHERE cp.call_id = c.id) as participant_count
      FROM calls c
      WHERE c.caller_id = ? OR c.receiver_id = ? OR c.id IN (
        SELECT call_id FROM call_participants WHERE user_id = ?
      )
      ORDER BY c.started_at DESC
      LIMIT 50
    `).all(req.user.id, req.user.id, req.user.id);

    res.json({ calls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:callId - get call details
router.get('/:callId', authenticate, (req, res) => {
  try {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    const participants = db.prepare(`
      SELECT cp.*, u.name, u.avatar
      FROM call_participants cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.call_id = ?
    `).all(req.params.callId);

    res.json({ call, participants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
