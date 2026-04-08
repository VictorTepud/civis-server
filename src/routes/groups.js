const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// CREAR GRUPO
// =============================================
router.post('/', (req, res) => {
  try {
    const { name, description, avatar, member_ids } = req.body;

    if (!name || !member_ids || member_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Nombre y al menos un miembro son requeridos' });
    }

    const db = getDb();

    // Verificar que todos los miembros existen
    const placeholders = member_ids.map(() => '?').join(',');
    const members = db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...member_ids);

    if (members.length !== member_ids.length) {
      return res.status(400).json({ success: false, error: 'Uno o más miembros no existen' });
    }

    const groupId = uuidv4();

    const transaction = db.transaction(() => {
      // Crear grupo
      db.prepare(`
        INSERT INTO groups (id, name, description, avatar, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(groupId, name.trim(), description?.trim() || null, avatar || null, req.user.id);

      // Agregar al creador como admin
      db.prepare(`
        INSERT INTO group_members (group_id, user_id, role)
        VALUES (?, ?, 'admin')
      `).run(groupId, req.user.id);

      // Agregar miembros
      const addMember = db.prepare(`
        INSERT INTO group_members (group_id, user_id, role)
        VALUES (?, ?, 'member')
      `);

      for (const memberId of member_ids) {
        if (memberId !== req.user.id) {
          addMember.run(groupId, memberId);
        }
      }
    });

    transaction();

    res.status(201).json({ success: true, data: { group_id: groupId }, message: 'Grupo creado exitosamente' });
  } catch (error) {
    console.error('Error al crear grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER GRUPOS DEL USUARIO
// =============================================
router.get('/', (req, res) => {
  try {
    const db = getDb();

    const groups = db.prepare(`
      SELECT g.*,
             gm.role as my_role,
             gm.muted as is_muted,
             (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as members_count,
             (SELECT u.display_name FROM users u
              JOIN group_messages gm2 ON gm2.sender_id = u.id
              WHERE gm2.group_id = g.id
              ORDER BY gm2.created_at DESC LIMIT 1) as last_message_sender,
             (SELECT gm2.content FROM group_messages gm2
              WHERE gm2.group_id = g.id
              ORDER BY gm2.created_at DESC LIMIT 1) as last_message_preview,
             (SELECT gm2.message_type FROM group_messages gm2
              WHERE gm2.group_id = g.id
              ORDER BY gm2.created_at DESC LIMIT 1) as last_message_type,
             (SELECT gm2.created_at FROM group_messages gm2
              WHERE gm2.group_id = g.id
              ORDER BY gm2.created_at DESC LIMIT 1) as last_message_at,
             (SELECT COUNT(*) FROM group_messages gm2
              WHERE gm2.group_id = g.id AND gm2.sender_id != ? 
              AND gm2.id NOT IN (
                SELECT gmr.message_id FROM group_message_reads gmr 
                WHERE gmr.user_id = ?
              )) as unread_count
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = ?
      ORDER BY g.updated_at DESC
    `).all(req.user.id, req.user.id, req.user.id);

    res.json({ success: true, data: { groups } });
  } catch (error) {
    console.error('Error al obtener grupos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER INFO DE UN GRUPO
// =============================================
router.get('/:groupId', (req, res) => {
  try {
    const db = getDb();

    const group = db.prepare(`
      SELECT g.*, u.display_name as creator_name
      FROM groups g
      JOIN users u ON g.created_by = u.id
      WHERE g.id = ?
    `).get(req.params.groupId);

    if (!group) {
      return res.status(404).json({ success: false, error: 'Grupo no encontrado' });
    }

    // Obtener miembros
    const members = db.prepare(`
      SELECT gm.user_id, gm.role, gm.nickname, gm.muted, gm.joined_at,
             u.display_name, u.username, u.avatar, u.about, u.phone, u.is_online, u.last_seen
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
      ORDER BY gm.role = 'admin' DESC, u.display_name ASC
    `).all(req.params.groupId);

    res.json({ success: true, data: { group, members } });
  } catch (error) {
    console.error('Error al obtener grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ACTUALIZAR GRUPO (nombre, descripción, avatar)
// =============================================
router.put('/:groupId', (req, res) => {
  try {
    const db = getDb();

    // Verificar que es admin
    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo los administradores pueden editar el grupo' });
    }

    const { name, description, avatar, is_restricted } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description?.trim() || null); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }
    if (is_restricted !== undefined) { updates.push('is_restricted = ?'); values.push(is_restricted ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron campos para actualizar' });
    }

    updates.push("updated_at = datetime('now')");
    values.push(req.params.groupId);

    db.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, message: 'Grupo actualizado' });
  } catch (error) {
    console.error('Error al actualizar grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// AGREGAR MIEMBROS AL GRUPO
// =============================================
router.post('/:groupId/members', (req, res) => {
  try {
    const { user_ids } = req.body;
    if (!user_ids || user_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Lista de usuarios requerida' });
    }

    const db = getDb();

    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo los administradores pueden agregar miembros' });
    }

    const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');

    const transaction = db.transaction(() => {
      for (const userId of user_ids) {
        addMember.run(req.params.groupId, userId);
      }
    });
    transaction();

    res.json({ success: true, message: 'Miembros agregados' });
  } catch (error) {
    console.error('Error al agregar miembros:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR MIEMBRO DEL GRUPO
// =============================================
router.delete('/:groupId/members/:userId', (req, res) => {
  try {
    const db = getDb();

    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo los administradores pueden eliminar miembros' });
    }

    if (req.params.userId === req.user.id) {
      // Salir del grupo
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.params.groupId, req.user.id);
      // Si era el último admin, asignar admin al miembro más antiguo
      const admins = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND role = ?').get(req.params.groupId, 'admin');
      if (!admins) {
        const oldest = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at ASC LIMIT 1').get(req.params.groupId);
        if (oldest) {
          db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run('admin', req.params.groupId, oldest.user_id);
        }
      }
      return res.json({ success: true, message: 'Has salido del grupo' });
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.params.groupId, req.params.userId);

    res.json({ success: true, message: 'Miembro eliminado del grupo' });
  } catch (error) {
    console.error('Error al eliminar miembro:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// HACER ADMIN / QUITAR ADMIN
// =============================================
router.put('/:groupId/members/:userId/role', (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Rol inválido (admin o member)' });
    }

    const db = getDb();

    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo los administradores pueden cambiar roles' });
    }

    db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(role, req.params.groupId, req.params.userId);

    res.json({ success: true, message: 'Rol actualizado' });
  } catch (error) {
    console.error('Error al cambiar rol:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ENVIAR MENSAJE AL GRUPO
// =============================================
router.post('/:groupId/messages', (req, res) => {
  try {
    const { content, message_type, media_url, media_mime_type, media_size,
            media_width, media_height, media_duration, media_thumbnail,
            file_name, caption, forwarded, replied_to_id } = req.body;

    const db = getDb();

    // Verificar que es miembro
    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!membership) {
      return res.status(403).json({ success: false, error: 'No eres miembro de este grupo' });
    }

    // Verificar restricción
    if (membership.role !== 'admin') {
      const group = db.prepare('SELECT is_restricted FROM groups WHERE id = ?').get(req.params.groupId);
      if (group.is_restricted) {
        return res.status(403).json({ success: false, error: 'Solo los administradores pueden enviar mensajes en este grupo' });
      }
    }

    const validTypes = ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker'];
    const type = message_type || 'text';
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: 'Tipo de mensaje inválido' });
    }

    if (type === 'text' && !content) {
      return res.status(400).json({ success: false, error: 'El contenido es requerido' });
    }

    const messageId = uuidv4();

    db.prepare(`
      INSERT INTO group_messages (
        id, group_id, sender_id, content, message_type,
        media_url, media_mime_type, media_size, media_width, media_height,
        media_duration, media_thumbnail, file_name, caption, forwarded, replied_to_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId, req.params.groupId, req.user.id, content || null, type,
      media_url || null, media_mime_type || null, media_size || 0,
      media_width || 0, media_height || 0, media_duration || 0,
      media_thumbnail || null, file_name || null, caption || null,
      forwarded ? 1 : 0, replied_to_id || null
    );

    db.prepare("UPDATE groups SET updated_at = datetime('now') WHERE id = ?").run(req.params.groupId);

    const message = db.prepare(`
      SELECT gm.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM group_messages gm
      JOIN users u ON gm.sender_id = u.id
      WHERE gm.id = ?
    `).get(messageId);

    res.status(201).json({ success: true, data: { message } });
  } catch (error) {
    console.error('Error al enviar mensaje al grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER MENSAJES DEL GRUPO
// =============================================
router.get('/:groupId/messages', (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const db = getDb();

    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!membership) {
      return res.status(403).json({ success: false, error: 'No eres miembro de este grupo' });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const messages = db.prepare(`
      SELECT gm.*,
             CASE WHEN gm.is_deleted = 1 THEN '[Mensaje eliminado]' ELSE gm.content END as display_content,
             u.display_name as sender_name, u.avatar as sender_avatar
      FROM group_messages gm
      JOIN users u ON gm.sender_id = u.id
      WHERE gm.group_id = ?
      ORDER BY gm.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.params.groupId, parseInt(limit), offset);

    messages.reverse();

    // Marcar como leídos
    const unreadMessages = db.prepare(`
      SELECT id FROM group_messages
      WHERE group_id = ? AND sender_id != ? AND id NOT IN (
        SELECT message_id FROM group_message_reads WHERE user_id = ?
      )
    `).all(req.params.groupId, req.user.id, req.user.id);

    if (unreadMessages.length > 0) {
      const addRead = db.prepare('INSERT OR IGNORE INTO group_message_reads (message_id, user_id) VALUES (?, ?)');
      const transaction = db.transaction(() => {
        for (const msg of unreadMessages) {
          addRead.run(msg.id, req.user.id);
        }
      });
      transaction();
    }

    const total = db.prepare('SELECT COUNT(*) as count FROM group_messages WHERE group_id = ?').get(req.params.groupId);

    res.json({
      success: true,
      data: {
        messages,
        pagination: { page: parseInt(page), limit: parseInt(limit), total: total.count, has_more: offset + parseInt(limit) < total.count }
      }
    });
  } catch (error) {
    console.error('Error al obtener mensajes del grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR GRUPO
// =============================================
router.delete('/:groupId', (req, res) => {
  try {
    const db = getDb();

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Grupo no encontrado' });
    }

    if (group.created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Solo el creador puede eliminar el grupo' });
    }

    db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.groupId);

    res.json({ success: true, message: 'Grupo eliminado' });
  } catch (error) {
    console.error('Error al eliminar grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// SILENCIAR GRUPO
// =============================================
router.put('/:groupId/mute', (req, res) => {
  try {
    const { muted } = req.body;
    const db = getDb();

    db.prepare('UPDATE group_members SET muted = ? WHERE group_id = ? AND user_id = ?').run(muted ? 1 : 0, req.params.groupId, req.user.id);

    res.json({ success: true, message: muted ? 'Grupo silenciado' : 'Grupo no silenciado' });
  } catch (error) {
    console.error('Error al silenciar grupo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
