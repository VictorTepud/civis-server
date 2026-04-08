const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// INICIAR LLAMADA (1-a-1)
// =============================================
router.post('/', (req, res) => {
  try {
    const { target_user_id, call_type, channel_id } = req.body;
    const type = call_type || 'video';
    if (!['audio', 'video'].includes(type)) return res.status(400).json({ success: false, error: 'Tipo inválido (audio o video)' });

    const db = getDb();

    if (channel_id) {
      // Llamada de canal de voz (grupal)
      const channel = db.prepare('SELECT ch.*, c.id as community_id FROM channels ch JOIN communities c ON ch.community_id = c.id WHERE ch.id = ?').get(channel_id);
      if (!channel) return res.status(404).json({ success: false, error: 'Canal no encontrado' });

      const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?').get(channel.community_id, req.user.id);
      if (!membership) return res.status(403).json({ success: false, error: 'No eres miembro de la comunidad' });

      const callId = uuidv4();
      db.prepare(`
        INSERT INTO calls (id, call_type, call_mode, caller_id, status, community_id, channel_id)
        VALUES (?, ?, 'group', ?, 'ringing', ?, ?)
      `).run(callId, type, req.user.id, channel.community_id, channel_id);
      db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(callId, req.user.id, 'caller');

      return res.status(201).json({ success: true, data: { call_id: callId, call_type: type, call_mode: 'group' } });
    }

    // Llamada privada 1-a-1
    if (!target_user_id) return res.status(400).json({ success: false, error: 'Usuario destino requerido' });
    if (target_user_id === req.user.id) return res.status(400).json({ success: false, error: 'No puedes llamarte a ti mismo' });

    // Verificar que no está bloqueado
    const isBlocked = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ? AND blocked = 1')
      .get(target_user_id, req.user.id);
    if (isBlocked) return res.status(403).json({ success: false, error: 'Has sido bloqueado por el usuario' });

    // Verificar si hay llamada activa entre ambos
    const activeCall = db.prepare(`
      SELECT c.id FROM calls c
      JOIN call_participants cp1 ON c.id = cp1.call_id AND cp1.user_id = ?
      JOIN call_participants cp2 ON c.id = cp2.call_id AND cp2.user_id = ?
      WHERE c.status IN ('ringing', 'connected') AND c.call_mode = 'private'
    `).get(req.user.id, target_user_id);
    if (activeCall) return res.status(409).json({ success: false, error: 'Ya existe una llamada activa', data: { active_call_id: activeCall.id } });

    const callId = uuidv4();
    db.prepare(`
      INSERT INTO calls (id, call_type, call_mode, caller_id, status)
      VALUES (?, ?, 'private', ?, 'ringing')
    `).run(callId, type, req.user.id);

    db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(callId, req.user.id, 'caller');
    db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(callId, target_user_id, 'participant');

    res.status(201).json({ success: true, data: { call_id: callId, call_type: type, call_mode: 'private', target_user_id } });
  } catch (error) {
    console.error('Error al iniciar llamada:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// CONTESTAR LLAMADA
// =============================================
router.put('/:callId/answer', (req, res) => {
  try {
    const db = getDb();
    const participant = db.prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
      .get(req.params.callId, req.user.id);
    if (!participant) return res.status(403).json({ success: false, error: 'No eres participante de esta llamada' });

    db.prepare("UPDATE calls SET status = 'connected', started_at = datetime('now') WHERE id = ? AND status = 'ringing'")
      .run(req.params.callId);

    res.json({ success: true, data: { call_id: req.params.callId, status: 'connected' } });
  } catch (error) {
    console.error('Error al contestar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// RECHAZAR LLAMADA
// =============================================
router.put('/:callId/reject', (req, res) => {
  try {
    const db = getDb();
    db.prepare("UPDATE calls SET status = 'rejected', ended_at = datetime('now') WHERE id = ? AND status = 'ringing'")
      .run(req.params.callId);

    res.json({ success: true, data: { call_id: req.params.callId, status: 'rejected' } });
  } catch (error) {
    console.error('Error al rechazar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// TERMINAR LLAMADA
// =============================================
router.put('/:callId/end', (req, res) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) return res.status(404).json({ success: false, error: 'Llamada no encontrada' });

    const now = new Date().toISOString();
    let duration = 0;
    if (call.started_at) {
      duration = Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000);
    }

    // Si caller termina y era ringing → missed
    const status = (call.status === 'ringing' && call.caller_id === req.user.id) ? 'missed' : 'ended';

    db.prepare("UPDATE calls SET status = ?, ended_at = ?, duration = ? WHERE id = ?").run(status, now, duration, req.params.callId);
    db.prepare("UPDATE call_participants SET left_at = ? WHERE call_id = ? AND left_at IS NULL").run(now, req.params.callId);

    res.json({ success: true, data: { call_id: req.params.callId, status, duration } });
  } catch (error) {
    console.error('Error al terminar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// UNIRSE A LLAMADA GRUPAL
// =============================================
router.post('/:callId/join', (req, res) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls WHERE id = ? AND status IN (?, ?)').get(req.params.callId, 'ringing', 'connected');
    if (!call) return res.status(404).json({ success: false, error: 'Llamada no encontrada o terminada' });

    const existing = db.prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
      .get(req.params.callId, req.user.id);
    if (existing) return res.status(409).json({ success: false, error: 'Ya eres participante' });

    // Si es llamada privada no se puede unir más gente
    if (call.call_mode === 'private') return res.status(403).json({ success: false, error: 'Llamada privada' });

    db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(req.params.callId, req.user.id, 'participant');

    // Si era ringing, conectar
    if (call.status === 'ringing') {
      db.prepare("UPDATE calls SET status = 'connected', started_at = datetime('now') WHERE id = ?").run(req.params.callId);
    }

    // Obtener participantes
    const participants = db.prepare(`
      SELECT cp.user_id, cp.role, cp.joined_at, u.display_name, u.avatar
      FROM call_participants cp JOIN users u ON cp.user_id = u.id
      WHERE cp.call_id = ? ORDER BY cp.joined_at ASC
    `).all(req.params.callId);

    res.status(201).json({ success: true, data: { call_id: req.params.callId, status: 'connected', participants } });
  } catch (error) {
    console.error('Error al unirse:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// SALIR DE LLAMADA GRUPAL (sin terminarla)
// =============================================
router.put('/:callId/leave', (req, res) => {
  try {
    const db = getDb();
    db.prepare("UPDATE call_participants SET left_at = datetime('now') WHERE call_id = ? AND user_id = ? AND left_at IS NULL")
      .run(req.params.callId, req.user.id);

    // Si no quedan participantes, terminar la llamada
    const remaining = db.prepare('SELECT COUNT(*) as count FROM call_participants WHERE call_id = ? AND left_at IS NULL')
      .get(req.params.callId);
    if (remaining.count === 0) {
      db.prepare("UPDATE calls SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(req.params.callId);
    }

    res.json({ success: true, message: 'Has salido de la llamada' });
  } catch (error) {
    console.error('Error al salir:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ENVIAR SEÑAL WebRTC (offer/answer/ice-candidate)
// =============================================
router.post('/:callId/signal', (req, res) => {
  try {
    const { signal_type, target_id, sdp, candidate } = req.body;
    if (!['offer', 'answer', 'ice-candidate', 'leave'].includes(signal_type)) {
      return res.status(400).json({ success: false, error: 'Tipo de señal inválido' });
    }

    const db = getDb();
    const call = db.prepare('SELECT * FROM calls WHERE id = ? AND status IN (?, ?)').get(req.params.callId, 'ringing', 'connected');
    if (!call) return res.status(404).json({ success: false, error: 'Llamada no activa' });

    const participant = db.prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
      .get(req.params.callId, req.user.id);
    if (!participant) return res.status(403).json({ success: false, error: 'No eres participante' });

    const signalId = uuidv4();
    db.prepare(`
      INSERT INTO call_signals (id, call_id, sender_id, target_id, signal_type, sdp, candidate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(signalId, req.params.callId, req.user.id, target_id || null, signal_type, sdp || null, candidate || null);

    res.json({ success: true, data: { signal_id: signalId } });
  } catch (error) {
    console.error('Error al enviar señal:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER SEÑALES PENDIENTES
// =============================================
router.get('/:callId/signals', (req, res) => {
  try {
    const { since } = req.query;
    const db = getDb();

    let signals;
    if (since) {
      signals = db.prepare(`
        SELECT cs.*, u.display_name as sender_name
        FROM call_signals cs JOIN users u ON cs.sender_id = u.id
        WHERE cs.call_id = ? AND cs.created_at > ? AND cs.sender_id != ?
          AND (cs.target_id IS NULL OR cs.target_id = ?)
        ORDER BY cs.created_at ASC
      `).all(req.params.callId, since, req.user.id, req.user.id);
    } else {
      signals = db.prepare(`
        SELECT cs.*, u.display_name as sender_name
        FROM call_signals cs JOIN users u ON cs.sender_id = u.id
        WHERE cs.call_id = ? AND cs.sender_id != ?
          AND (cs.target_id IS NULL OR cs.target_id = ?)
        ORDER BY cs.created_at ASC
      `).all(req.params.callId, req.user.id, req.user.id);
    }

    res.json({ success: true, data: { signals } });
  } catch (error) {
    console.error('Error al obtener señales:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER INFO DE LLAMADA
// =============================================
router.get('/:callId', (req, res) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.callId);
    if (!call) return res.status(404).json({ success: false, error: 'Llamada no encontrada' });

    const participants = db.prepare(`
      SELECT cp.user_id, cp.role, cp.joined_at, cp.left_at,
             u.display_name, u.username, u.avatar
      FROM call_participants cp JOIN users u ON cp.user_id = u.id
      WHERE cp.call_id = ? ORDER BY cp.joined_at ASC
    `).all(req.params.callId);

    res.json({ success: true, data: { call, participants } });
  } catch (error) {
    console.error('Error al obtener llamada:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// HISTORIAL DE LLAMADAS DEL USUARIO
// =============================================
router.get('/history/list', (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const db = getDb();

    const calls = db.prepare(`
      SELECT c.*,
             (SELECT u.display_name FROM users u WHERE u.id = c.caller_id) as caller_name,
             (SELECT u.avatar FROM users u WHERE u.id = c.caller_id) as caller_avatar,
             (SELECT COUNT(*) FROM call_participants WHERE call_id = c.id) as participants_count,
             CASE WHEN c.caller_id = ? THEN 'outgoing' ELSE 'incoming' END as direction
      FROM calls c
      JOIN call_participants cp ON c.id = cp.call_id
      WHERE cp.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, req.user.id, parseInt(limit), parseInt(offset));

    res.json({ success: true, data: { calls } });
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
