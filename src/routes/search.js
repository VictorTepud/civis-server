const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// BUSCAR USUARES POR NOMBRE, USERNAME O EMAIL
// =============================================
router.get('/users', (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'El término de búsqueda debe tener al menos 2 caracteres' });
    }

    const db = getDb();
    const searchTerm = `%${q.trim()}%`;

    const users = db.prepare(`
      SELECT id, username, display_name, avatar, about, phone, is_online, last_seen
      FROM users
      WHERE (display_name LIKE ? OR username LIKE ? OR email LIKE ? OR phone LIKE ?)
        AND id != ?
      ORDER BY 
        CASE WHEN display_name LIKE ? THEN 1
             WHEN username LIKE ? THEN 2
             ELSE 3 END,
        display_name ASC
      LIMIT ?
    `).all(searchTerm, searchTerm, searchTerm, searchTerm, req.user.id, `${q.trim()}%`, `${q.trim()}%`, parseInt(limit));

    res.json({ success: true, data: { users } });
  } catch (error) {
    console.error('Error en búsqueda de usuarios:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// BUSCAR MENSAJES EN CONVERSACIONES
// =============================================
router.get('/messages', (req, res) => {
  try {
    const { q, conversation_id } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'El término de búsqueda debe tener al menos 2 caracteres' });
    }

    const db = getDb();
    const searchTerm = `%${q.trim()}%`;

    let messages;
    if (conversation_id) {
      messages = db.prepare(`
        SELECT m.*, c.id as conversation_id, u.display_name as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        JOIN users u ON m.sender_id = u.id
        WHERE (c.user1_id = ? OR c.user2_id = ?)
          AND m.content LIKE ? AND m.is_deleted < 2
        ORDER BY m.created_at DESC
        LIMIT 50
      `).all(req.user.id, req.user.id, searchTerm);
    } else {
      messages = db.prepare(`
        SELECT m.*, c.id as conversation_id, u.display_name as sender_name, u.avatar as sender_avatar,
               CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END as other_user_id
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        JOIN users u ON m.sender_id = u.id
        WHERE (c.user1_id = ? OR c.user2_id = ?)
          AND m.content LIKE ? AND m.is_deleted < 2
        ORDER BY m.created_at DESC
        LIMIT 50
      `).all(req.user.id, req.user.id, req.user.id, searchTerm);
    }

    res.json({ success: true, data: { messages } });
  } catch (error) {
    console.error('Error en búsqueda de mensajes:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// BUSCAR MENSAJES EN GRUPOS
// =============================================
router.get('/group-messages', (req, res) => {
  try {
    const { q, group_id } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'El término de búsqueda debe tener al menos 2 caracteres' });
    }

    if (!group_id) {
      return res.status(400).json({ success: false, error: 'ID del grupo requerido' });
    }

    const db = getDb();
    const searchTerm = `%${q.trim()}%`;

    const messages = db.prepare(`
      SELECT gm.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM group_messages gm
      JOIN users u ON gm.sender_id = u.id
      WHERE gm.group_id = ? AND gm.content LIKE ? AND gm.is_deleted < 1
      ORDER BY gm.created_at DESC
      LIMIT 50
    `).all(group_id, searchTerm);

    res.json({ success: true, data: { messages } });
  } catch (error) {
    console.error('Error en búsqueda de mensajes de grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// BUSQUEDA GLOBAL
// =============================================
router.get('/global', (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'El término de búsqueda debe tener al menos 2 caracteres' });
    }

    const db = getDb();
    const searchTerm = `%${q.trim()}%`;

    // Buscar usuarios
    const users = db.prepare(`
      SELECT id, username, display_name, avatar, is_online
      FROM users
      WHERE (display_name LIKE ? OR username LIKE ?) AND id != ?
      LIMIT 10
    `).all(searchTerm, searchTerm, req.user.id);

    // Buscar en mensajes de conversaciones
    const messages = db.prepare(`
      SELECT m.*, u.display_name as sender_name,
             CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END as other_user_id,
             ou.display_name as other_user_name
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN users u ON m.sender_id = u.id
      JOIN users ou ON ou.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
      WHERE (c.user1_id = ? OR c.user2_id = ?)
        AND m.content LIKE ? AND m.is_deleted < 2
      ORDER BY m.created_at DESC
      LIMIT 20
    `).all(req.user.id, req.user.id, req.user.id, req.user.id, searchTerm);

    res.json({ success: true, data: { users, messages } });
  } catch (error) {
    console.error('Error en búsqueda global:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
