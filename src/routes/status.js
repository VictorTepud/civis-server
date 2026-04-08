const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// PUBLICAR UN ESTADO
// =============================================
router.post('/', (req, res) => {
  try {
    const { content_type, content, background_color, media_url, media_thumbnail, font_type } = req.body;

    const validTypes = ['text', 'image', 'video'];
    const type = content_type || 'text';
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: 'Tipo de estado inválido' });
    }

    if (type === 'text' && !content) {
      return res.status(400).json({ success: false, error: 'El contenido es requerido para estados de texto' });
    }

    if ((type === 'image' || type === 'video') && !media_url) {
      return res.status(400).json({ success: false, error: 'La URL del medio es requerida' });
    }

    const db = getDb();
    const statusId = uuidv4();

    db.prepare(`
      INSERT INTO user_status (id, user_id, content_type, content, background_color, media_url, media_thumbnail, font_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      statusId, req.user.id, type,
      content || null, background_color || '#1DA1F2',
      media_url || null, media_thumbnail || null, font_type || 'default'
    );

    res.status(201).json({ success: true, data: { status_id: statusId }, message: 'Estado publicado' });
  } catch (error) {
    console.error('Error al publicar estado:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER ESTADOS DE CONTACTOS
// =============================================
router.get('/feed', (req, res) => {
  try {
    const db = getDb();

    // Obtener IDs de contactos
    const contacts = db.prepare('SELECT contact_id FROM contacts WHERE user_id = ?').all(req.user.id);
    const contactIds = contacts.map(c => c.contact_id);
    if (contactIds.length === 0) {
      return res.json({ success: true, data: { statuses: [] } });
    }

    // Agregar el propio usuario
    contactIds.push(req.user.id);

    // Obtener estados no expirados agrupados por usuario
    const placeholders = contactIds.map(() => '?').join(',');
    const statuses = db.prepare(`
      SELECT us.*, u.display_name, u.username, u.avatar,
             EXISTS(
               SELECT 1 FROM status_views sv
               WHERE sv.status_id = us.id AND sv.viewer_id = ?
             ) as viewed
      FROM user_status us
      JOIN users u ON us.user_id = u.id
      WHERE us.user_id IN (${placeholders}) AND us.expires_at > datetime('now')
      ORDER BY us.user_id, us.created_at DESC
    `).all(req.user.id, ...contactIds);

    // Agrupar por usuario
    const grouped = {};
    for (const status of statuses) {
      if (!grouped[status.user_id]) {
        grouped[status.user_id] = {
          user_id: status.user_id,
          display_name: status.display_name,
          username: status.username,
          avatar: status.avatar,
          statuses: [],
          all_viewed: true
        };
      }
      grouped[status.user_id].statuses.push(status);
      if (!status.viewed) {
        grouped[status.user_id].all_viewed = false;
      }
    }

    res.json({ success: true, data: { statuses: Object.values(grouped) } });
  } catch (error) {
    console.error('Error al obtener estados:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER MIS ESTADOS
// =============================================
router.get('/my', (req, res) => {
  try {
    const db = getDb();

    const statuses = db.prepare(`
      SELECT us.*,
             (SELECT COUNT(*) FROM status_views sv WHERE sv.status_id = us.id) as views_count
      FROM user_status us
      WHERE us.user_id = ? AND us.expires_at > datetime('now')
      ORDER BY us.created_at DESC
    `).all(req.user.id);

    res.json({ success: true, data: { statuses } });
  } catch (error) {
    console.error('Error al obtener mis estados:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// MARCAR ESTADO COMO VISTO
// =============================================
router.post('/:statusId/view', (req, res) => {
  try {
    const db = getDb();

    const status = db.prepare('SELECT * FROM user_status WHERE id = ?').get(req.params.statusId);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Estado no encontrado' });
    }

    db.prepare('INSERT OR IGNORE INTO status_views (status_id, viewer_id) VALUES (?, ?)').run(req.params.statusId, req.user.id);
    db.prepare('UPDATE user_status SET views_count = views_count + 1 WHERE id = ?').run(req.params.statusId);

    res.json({ success: true, message: 'Estado visto' });
  } catch (error) {
    console.error('Error al marcar estado:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER VISTAS DE UN ESTADO
// =============================================
router.get('/:statusId/views', (req, res) => {
  try {
    const db = getDb();

    const status = db.prepare('SELECT * FROM user_status WHERE id = ? AND user_id = ?').get(req.params.statusId, req.user.id);
    if (!status) {
      return res.status(403).json({ success: false, error: 'No tienes acceso a este estado' });
    }

    const views = db.prepare(`
      SELECT sv.viewer_id, sv.viewed_at, u.display_name, u.username, u.avatar
      FROM status_views sv
      JOIN users u ON sv.viewer_id = u.id
      WHERE sv.status_id = ?
      ORDER BY sv.viewed_at ASC
    `).all(req.params.statusId);

    res.json({ success: true, data: { views } });
  } catch (error) {
    console.error('Error al obtener vistas:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// RESPONDER A UN ESTADO
// =============================================
router.post('/:statusId/reply', (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: 'El contenido de la respuesta es requerido' });
    }

    const db = getDb();

    const status = db.prepare('SELECT * FROM user_status WHERE id = ?').get(req.params.statusId);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Estado no encontrado' });
    }

    const replyId = uuidv4();
    db.prepare('INSERT INTO status_replies (id, status_id, sender_id, content) VALUES (?, ?, ?, ?)').run(replyId, req.params.statusId, req.user.id, content.trim());

    // Marcar como visto
    db.prepare('INSERT OR IGNORE INTO status_views (status_id, viewer_id) VALUES (?, ?)').run(req.params.statusId, req.user.id);

    res.status(201).json({ success: true, data: { reply_id: replyId } });
  } catch (error) {
    console.error('Error al responder estado:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR ESTADO
// =============================================
router.delete('/:statusId', (req, res) => {
  try {
    const db = getDb();

    const status = db.prepare('SELECT * FROM user_status WHERE id = ? AND user_id = ?').get(req.params.statusId, req.user.id);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Estado no encontrado' });
    }

    db.prepare('DELETE FROM user_status WHERE id = ?').run(req.params.statusId);

    res.json({ success: true, message: 'Estado eliminado' });
  } catch (error) {
    console.error('Error al eliminar estado:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
