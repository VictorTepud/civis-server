const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// CREAR COMUNIDAD
// =============================================
router.post('/', (req, res) => {
  try {
    const { name, description, avatar, cover_image, is_public, approve_members, max_members, allow_member_invite } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Nombre requerido' });

    const db = getDb();
    const communityId = uuidv4();
    const generalChannelId = uuidv4();

    const transaction = db.transaction(() => {
      // Crear comunidad
      db.prepare(`
        INSERT INTO communities (id, name, description, avatar, cover_image, created_by, is_public, approve_members, max_members, allow_member_invite)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(communityId, name.trim(), description?.trim() || null, avatar || null, cover_image || null,
        req.user.id, is_public ? 1 : 0, approve_members ? 1 : 0, max_members || 50000, allow_member_invite !== undefined ? (allow_member_invite ? 1 : 0) : 1);

      // Owner como miembro
      db.prepare(`INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, 'owner')`).run(communityId, req.user.id);

      // Canal general por defecto
      db.prepare(`
        INSERT INTO channels (id, community_id, name, description, channel_type, sort_order, is_default, created_by)
        VALUES (?, ?, 'General', 'Canal de discusión general', 'text', 0, 1, ?)
      `).run(generalChannelId, communityId, req.user.id);

      // Owner como miembro del canal general
      db.prepare(`INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)`).run(generalChannelId, req.user.id);
    });

    transaction();

    res.status(201).json({ success: true, data: { community_id: communityId, general_channel_id: generalChannelId } });
  } catch (error) {
    console.error('Error al crear comunidad:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER COMUNIDADES DEL USUARIO
// =============================================
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const communities = db.prepare(`
      SELECT c.*,
             cm.role as my_role,
             cm.muted as is_muted,
             (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as members_count,
             (SELECT COUNT(*) FROM channels WHERE community_id = c.id) as channels_count
      FROM communities c
      JOIN community_members cm ON c.id = cm.community_id
      WHERE cm.user_id = ?
      ORDER BY c.updated_at DESC
    `).all(req.user.id);

    res.json({ success: true, data: { communities } });
  } catch (error) {
    console.error('Error al obtener comunidades:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER COMUNIDADES PÚBLICAS (para descubrir)
// =============================================
router.get('/discover', (req, res) => {
  try {
    const { q, limit = 20, offset = 0 } = req.query;
    const db = getDb();

    let communities;
    if (q) {
      const term = `%${q.trim()}%`;
      communities = db.prepare(`
        SELECT c.*, u.display_name as creator_name,
               (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as members_count
        FROM communities c
        JOIN users u ON c.created_by = u.id
        WHERE c.is_public = 1 AND c.name LIKE ?
          AND c.id NOT IN (SELECT community_id FROM community_members WHERE user_id = ?)
        ORDER BY members_count DESC
        LIMIT ? OFFSET ?
      `).all(term, req.user.id, parseInt(limit), parseInt(offset));
    } else {
      communities = db.prepare(`
        SELECT c.*, u.display_name as creator_name,
               (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as members_count
        FROM communities c
        JOIN users u ON c.created_by = u.id
        WHERE c.is_public = 1
          AND c.id NOT IN (SELECT community_id FROM community_members WHERE user_id = ?)
        ORDER BY members_count DESC
        LIMIT ? OFFSET ?
      `).all(req.user.id, parseInt(limit), parseInt(offset));
    }

    res.json({ success: true, data: { communities } });
  } catch (error) {
    console.error('Error al descubrir comunidades:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// DETALLE DE COMUNIDAD (con canales y miembros)
// =============================================
router.get('/:communityId', (req, res) => {
  try {
    const db = getDb();
    const community = db.prepare(`
      SELECT c.*, u.display_name as creator_name
      FROM communities c JOIN users u ON c.created_by = u.id
      WHERE c.id = ?
    `).get(req.params.communityId);
    if (!community) return res.status(404).json({ success: false, error: 'Comunidad no encontrada' });

    const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);

    const channels = db.prepare(`
      SELECT ch.*, ch.is_default as is_default_channel,
             (SELECT COUNT(*) FROM channel_members WHERE channel_id = ch.id) as members_count,
             cm.unread_count
      FROM channels ch
      LEFT JOIN channel_members cm ON cm.channel_id = ch.id AND cm.user_id = ?
      WHERE ch.community_id = ?
      ORDER BY ch.is_default DESC, ch.sort_order ASC, ch.created_at ASC
    `).all(req.user.id, req.params.communityId);

    const members = db.prepare(`
      SELECT cm.user_id, cm.role, cm.muted, cm.joined_at,
             u.display_name, u.username, u.avatar, u.about
      FROM community_members cm JOIN users u ON cm.user_id = u.id
      WHERE cm.community_id = ?
      ORDER BY CASE cm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 3 ELSE 4 END,
               u.display_name ASC
    `).all(req.params.communityId);

    res.json({ success: true, data: { community, membership, channels, members } });
  } catch (error) {
    console.error('Error al obtener comunidad:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// EDITAR COMUNIDAD
// =============================================
router.put('/:communityId', (req, res) => {
  try {
    const { name, description, avatar, cover_image, is_public, approve_members, max_members, allow_member_invite } = req.body;
    const db = getDb();

    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ success: false, error: 'Solo owners o admins pueden editar la comunidad' });
    }

    const updates = [], values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description?.trim() || null); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }
    if (cover_image !== undefined) { updates.push('cover_image = ?'); values.push(cover_image); }
    if (is_public !== undefined) { updates.push('is_public = ?'); values.push(is_public ? 1 : 0); }
    if (approve_members !== undefined) { updates.push('approve_members = ?'); values.push(approve_members ? 1 : 0); }
    if (max_members !== undefined) { updates.push('max_members = ?'); values.push(max_members); }
    if (allow_member_invite !== undefined) { updates.push('allow_member_invite = ?'); values.push(allow_member_invite ? 1 : 0); }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nada que actualizar' });

    updates.push("updated_at = datetime('now')");
    values.push(req.params.communityId);
    db.prepare(`UPDATE communities SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, message: 'Comunidad actualizada' });
  } catch (error) {
    console.error('Error al editar comunidad:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR COMUNIDAD (solo owner)
// =============================================
router.delete('/:communityId', (req, res) => {
  try {
    const db = getDb();
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    if (!community) return res.status(404).json({ success: false, error: 'Comunidad no encontrada' });
    if (community.created_by !== req.user.id) return res.status(403).json({ success: false, error: 'Solo el owner puede eliminar' });

    db.prepare('DELETE FROM communities WHERE id = ?').run(req.params.communityId);
    res.json({ success: true, message: 'Comunidad eliminada' });
  } catch (error) {
    console.error('Error al eliminar comunidad:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// UNIRSE A COMUNIDAD (pública o con invitación)
// =============================================
router.post('/:communityId/join', (req, res) => {
  try {
    const db = getDb();
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    if (!community) return res.status(404).json({ success: false, error: 'Comunidad no encontrada' });

    const existing = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (existing) return res.status(409).json({ success: false, error: 'Ya eres miembro' });

    // Si requiere aprobación, crear solicitud
    if (community.approve_members && !community.is_public) {
      // Verificar si ya hay solicitud pendiente
      const pendingReq = db.prepare(`SELECT * FROM community_join_requests WHERE community_id = ? AND user_id = ? AND status = 'pending'`)
        .get(req.params.communityId, req.user.id);
      if (pendingReq) return res.status(409).json({ success: false, error: 'Ya tienes una solicitud pendiente' });

      const requestId = uuidv4();
      db.prepare(`INSERT INTO community_join_requests (id, community_id, user_id, message) VALUES (?, ?, ?, ?)`)
        .run(requestId, req.params.communityId, req.user.id, req.body.message || null);
      return res.status(201).json({ success: true, data: { request_id: requestId, status: 'pending' }, message: 'Solicitud enviada' });
    }

    // Entrada directa
    const addMember = db.prepare(`INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, 'member')`);
    const addChannelMember = db.prepare(`INSERT OR IGNORE INTO channel_members (channel_id, user_id) SELECT id, ? FROM channels WHERE community_id = ?`);
    const transaction = db.transaction(() => {
      addMember.run(req.params.communityId, req.user.id);
      addChannelMember.run(req.user.id, req.params.communityId);
    });
    transaction();

    res.status(201).json({ success: true, message: 'Te has unido a la comunidad' });
  } catch (error) {
    console.error('Error al unirse:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// SALIR DE COMUNIDAD
// =============================================
router.post('/:communityId/leave', (req, res) => {
  try {
    const db = getDb();
    const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership) return res.status(404).json({ success: false, error: 'No eres miembro' });

    if (membership.role === 'owner') return res.status(400).json({ success: false, error: 'El owner no puede salir. Transfiere o elimina la comunidad.' });

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(req.params.communityId, req.user.id);
      db.prepare('DELETE FROM channel_members WHERE channel_id IN (SELECT id FROM channels WHERE community_id = ?) AND user_id = ?')
        .run(req.params.communityId, req.user.id);
    });
    transaction();

    res.json({ success: true, message: 'Has salido de la comunidad' });
  } catch (error) {
    console.error('Error al salir:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// INVITAR USUARIOS A COMUNIDAD
// =============================================
router.post('/:communityId/invite', (req, res) => {
  try {
    const { user_ids } = req.body;
    if (!user_ids || user_ids.length === 0) return res.status(400).json({ success: false, error: 'Lista de usuarios requerida' });

    const db = getDb();
    const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership) return res.status(403).json({ success: false, error: 'No eres miembro' });

    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId);
    if (!community.allow_member_invite && !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ success: false, error: 'No tienes permiso para invitar' });
    }

    const addMember = db.prepare(`INSERT OR IGNORE INTO community_members (community_id, user_id, role) VALUES (?, ?, 'member')`);
    const addChannelMember = db.prepare(`INSERT OR IGNORE INTO channel_members (channel_id, user_id) SELECT ch.id, ? FROM channels ch WHERE ch.community_id = ?`);

    const transaction = db.transaction(() => {
      for (const userId of user_ids) {
        addMember.run(req.params.communityId, userId);
        addChannelMember.run(userId, req.params.communityId);
      }
    });
    transaction();

    res.json({ success: true, message: 'Usuarios invitados' });
  } catch (error) {
    console.error('Error al invitar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// EXPULSAR MIEMBRO
// =============================================
router.delete('/:communityId/members/:userId', (req, res) => {
  try {
    const db = getDb();
    const myMembership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!myMembership || !['owner', 'admin'].includes(myMembership.role)) {
      return res.status(403).json({ success: false, error: 'Sin permisos' });
    }

    const targetMember = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.params.userId);
    if (!targetMember) return res.status(404).json({ success: false, error: 'Usuario no es miembro' });

    // No se puede expulsar a un owner
    if (targetMember.role === 'owner') return res.status(400).json({ success: false, error: 'No se puede expulsar al owner' });
    // Admin no puede expulsar a otro admin
    if (targetMember.role === 'admin' && myMembership.role !== 'owner') return res.status(403).json({ success: false, error: 'Solo el owner puede expulsar admins' });

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(req.params.communityId, req.params.userId);
      db.prepare('DELETE FROM channel_members WHERE channel_id IN (SELECT id FROM channels WHERE community_id = ?) AND user_id = ?')
        .run(req.params.communityId, req.params.userId);
    });
    transaction();

    res.json({ success: true, message: 'Miembro expulsado' });
  } catch (error) {
    console.error('Error al expulsar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// CAMBIAR ROL DE MIEMBRO
// =============================================
router.put('/:communityId/members/:userId/role', (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'moderator', 'member'].includes(role)) return res.status(400).json({ success: false, error: 'Rol inválido' });

    const db = getDb();
    const myMembership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!myMembership || myMembership.role !== 'owner') return res.status(403).json({ success: false, error: 'Solo el owner cambia roles' });

    db.prepare('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?')
      .run(role, req.params.communityId, req.params.userId);

    res.json({ success: true, message: 'Rol actualizado' });
  } catch (error) {
    console.error('Error al cambiar rol:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// SOLICITUDES DE UNIÓN
// =============================================
router.get('/:communityId/requests', (req, res) => {
  try {
    const db = getDb();
    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) return res.status(403).json({ success: false, error: 'Sin permisos' });

    const requests = db.prepare(`
      SELECT jr.*, u.display_name, u.username, u.avatar
      FROM community_join_requests jr
      JOIN users u ON jr.user_id = u.id
      WHERE jr.community_id = ? AND jr.status = 'pending'
      ORDER BY jr.created_at ASC
    `).all(req.params.communityId);

    res.json({ success: true, data: { requests } });
  } catch (error) {
    console.error('Error al obtener solicitudes:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Aprobar solicitud
router.put('/:communityId/requests/:requestId/approve', (req, res) => {
  try {
    const db = getDb();
    const jr = db.prepare(`SELECT * FROM community_join_requests WHERE id = ? AND community_id = ? AND status = 'pending'`)
      .get(req.params.requestId, req.params.communityId);
    if (!jr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });

    const transaction = db.transaction(() => {
      db.prepare("UPDATE community_join_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
        .run(req.user.id, req.params.requestId);
      db.prepare(`INSERT OR IGNORE INTO community_members (community_id, user_id, role) VALUES (?, ?, 'member')`)
        .run(req.params.communityId, jr.user_id);
      db.prepare(`INSERT OR IGNORE INTO channel_members (channel_id, user_id) SELECT id, ? FROM channels WHERE community_id = ?`)
        .run(jr.user_id, req.params.communityId);
    });
    transaction();

    res.json({ success: true, message: 'Solicitud aprobada' });
  } catch (error) {
    console.error('Error al aprobar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Rechazar solicitud
router.put('/:communityId/requests/:requestId/reject', (req, res) => {
  try {
    const db = getDb();
    db.prepare("UPDATE community_join_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND community_id = ?")
      .run(req.user.id, req.params.requestId, req.params.communityId);

    res.json({ success: true, message: 'Solicitud rechazada' });
  } catch (error) {
    console.error('Error al rechazar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// CANALES dentro de comunidad
// =============================================

// Crear canal
router.post('/:communityId/channels', (req, res) => {
  try {
    const { name, description, channel_type, sort_order } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Nombre del canal requerido' });

    const validTypes = ['text', 'announcement', 'voice', 'media'];
    const type = channel_type || 'text';
    if (!validTypes.includes(type)) return res.status(400).json({ success: false, error: 'Tipo de canal inválido' });

    const db = getDb();
    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ success: false, error: 'Solo owners o admins pueden crear canales' });
    }

    const channelId = uuidv4();

    db.prepare(`
      INSERT INTO channels (id, community_id, name, description, channel_type, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(channelId, req.params.communityId, name.trim(), description?.trim() || null, type, sort_order || 0, req.user.id);

    res.status(201).json({ success: true, data: { channel_id: channelId } });
  } catch (error) {
    console.error('Error al crear canal:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Editar canal
router.put('/:communityId/channels/:channelId', (req, res) => {
  try {
    const { name, description, sort_order } = req.body;
    const db = getDb();

    const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ success: false, error: 'Sin permisos' });
    }

    const updates = [], values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description?.trim() || null); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nada que actualizar' });

    updates.push("updated_at = datetime('now')");
    values.push(req.params.channelId);
    db.prepare(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, message: 'Canal actualizado' });
  } catch (error) {
    console.error('Error al editar canal:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Eliminar canal
router.delete('/:communityId/channels/:channelId', (req, res) => {
  try {
    const db = getDb();
    const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND community_id = ?').get(req.params.channelId, req.params.communityId);
    if (!channel) return res.status(404).json({ success: false, error: 'Canal no encontrado' });

    if (channel.is_default) return res.status(400).json({ success: false, error: 'No se puede eliminar el canal general' });

    db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.channelId);
    res.json({ success: true, message: 'Canal eliminado' });
  } catch (error) {
    console.error('Error al eliminar canal:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// MENSAJES DE CANAL
// =============================================

// Enviar mensaje al canal
router.post('/:communityId/channels/:channelId/messages', (req, res) => {
  try {
    const { content, message_type, media_url, media_mime_type, media_size, media_width, media_height,
            media_duration, media_thumbnail, file_name, caption, forwarded, replied_to_id } = req.body;

    const db = getDb();
    const channel = db.prepare('SELECT ch.*, c.approve_members FROM channels ch JOIN communities c ON ch.community_id = c.id WHERE ch.id = ? AND ch.community_id = ?')
      .get(req.params.channelId, req.params.communityId);
    if (!channel) return res.status(404).json({ success: false, error: 'Canal no encontrado' });

    const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
      .get(req.params.communityId, req.user.id);
    if (!membership) return res.status(403).json({ success: false, error: 'No eres miembro de la comunidad' });

    // Canales de anuncio: solo admins/moderadores
    if (channel.channel_type === 'announcement' && !['owner', 'admin', 'moderator'].includes(membership.role)) {
      return res.status(403).json({ success: false, error: 'Solo admins/moderadores pueden enviar en canales de anuncios' });
    }

    const validTypes = ['text', 'image', 'video', 'audio', 'document', 'link'];
    const type = message_type || 'text';
    if (!validTypes.includes(type)) return res.status(400).json({ success: false, error: 'Tipo inválido' });
    if (type === 'text' && !content) return res.status(400).json({ success: false, error: 'Contenido requerido' });

    const messageId = uuidv4();

    db.prepare(`
      INSERT INTO channel_messages (id, channel_id, sender_id, content, message_type,
        media_url, media_mime_type, media_size, media_width, media_height,
        media_duration, media_thumbnail, file_name, caption, forwarded, replied_to_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, req.params.channelId, req.user.id, content || null, type,
      media_url || null, media_mime_type || null, media_size || 0,
      media_width || 0, media_height || 0, media_duration || 0,
      media_thumbnail || null, file_name || null, caption || null,
      forwarded ? 1 : 0, replied_to_id || null);

    // Actualizar último mensaje del canal
    const preview = type === 'text' ? (content || '').substring(0, 100) : `[${type}]`;
    db.prepare(`
      UPDATE channels SET last_message_preview = ?, last_message_type = ?, last_message_sender_id = ?,
        last_message_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(preview, type, req.user.id, req.params.channelId);

    db.prepare("UPDATE communities SET updated_at = datetime('now') WHERE id = ?").run(req.params.communityId);

    // Incrementar unread para todos los miembros del canal excepto el sender
    db.prepare(`UPDATE channel_members SET unread_count = unread_count + 1 WHERE channel_id = ? AND user_id != ?`)
      .run(req.params.channelId, req.user.id);

    const message = db.prepare(`
      SELECT cm.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM channel_messages cm JOIN users u ON cm.sender_id = u.id
      WHERE cm.id = ?
    `).get(messageId);

    res.status(201).json({ success: true, data: { message } });
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Obtener mensajes del canal
router.get('/:communityId/channels/:channelId/messages', (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const db = getDb();
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND community_id = ?')
      .get(req.params.channelId, req.params.communityId);
    if (!channel) return res.status(404).json({ success: false, error: 'Canal no encontrado' });

    const messages = db.prepare(`
      SELECT cm.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM channel_messages cm JOIN users u ON cm.sender_id = u.id
      WHERE cm.channel_id = ? AND (cm.is_deleted = 0 OR cm.is_deleted IS NULL)
      ORDER BY cm.created_at DESC LIMIT ? OFFSET ?
    `).all(req.params.channelId, parseInt(limit), offset);
    messages.reverse();

    // Marcar como leídos
    db.prepare('UPDATE channel_members SET unread_count = 0 WHERE channel_id = ? AND user_id = ?')
      .run(req.params.channelId, req.user.id);

    const total = db.prepare('SELECT COUNT(*) as count FROM channel_messages WHERE channel_id = ? AND is_deleted = 0')
      .get(req.params.channelId);

    res.json({ success: true, data: { messages, pagination: { page: parseInt(page), limit: parseInt(limit), total: total.count, has_more: offset + parseInt(limit) < total.count } } });
  } catch (error) {
    console.error('Error al obtener mensajes:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Fijar mensaje en canal
router.put('/:communityId/channels/:channelId/messages/:messageId/pin', (req, res) => {
  try {
    const { is_pinned } = req.body;
    const db = getDb();
    db.prepare('UPDATE channel_messages SET is_pinned = ? WHERE id = ? AND channel_id = ?')
      .run(is_pinned ? 1 : 0, req.params.messageId, req.params.channelId);
    res.json({ success: true, message: is_pinned ? 'Mensaje fijado' : 'Mensaje desfijado' });
  } catch (error) {
    console.error('Error al fijar mensaje:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Eliminar mensaje de canal
router.delete('/:communityId/channels/:channelId/messages/:messageId', (req, res) => {
  try {
    const { for_everyone } = req.query;
    const db = getDb();

    const message = db.prepare('SELECT * FROM channel_messages WHERE id = ? AND channel_id = ?')
      .get(req.params.messageId, req.params.channelId);
    if (!message) return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });

    if (for_everyone === 'true' && message.sender_id === req.user.id) {
      db.prepare("UPDATE channel_messages SET content = NULL, media_url = NULL, is_deleted = 1, deleted_at = datetime('now') WHERE id = ?")
        .run(req.params.messageId);
    } else {
      const currentDeleted = message.deleted_for ? JSON.parse(message.deleted_for) : [];
      if (!currentDeleted.includes(req.user.id)) {
        currentDeleted.push(req.user.id);
        db.prepare("UPDATE channel_messages SET deleted_for = ?, deleted_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(currentDeleted), req.params.messageId);
      }
    }

    res.json({ success: true, message: 'Mensaje eliminado' });
  } catch (error) {
    console.error('Error al eliminar mensaje:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
