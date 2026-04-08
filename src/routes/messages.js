const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');
const fcmService = require('../services/fcmService');

const router = express.Router();
router.use(authenticate);

// =============================================
// OBTENER TODAS LAS CONVERSACIONES
// =============================================
router.get('/conversations', (req, res) => {
  try {
    const db = getDb();

    const conversations = db.prepare(`
      SELECT 
        c.id as conversation_id,
        c.last_message_preview,
        c.last_message_type,
        c.last_message_sender_id,
        c.last_message_at,
        c.created_at,
        CASE 
          WHEN c.user1_id = ? THEN c.unread_count_user1
          ELSE c.unread_count_user2
        END as unread_count,
        CASE 
          WHEN c.user1_id = ? THEN c.user2_id
          ELSE c.user1_id
        END as other_user_id,
        u.display_name as other_user_name,
        u.username as other_user_username,
        u.avatar as other_user_avatar,
        u.about as other_user_about,
        u.is_online as other_user_online,
        u.last_seen as other_user_last_seen,
        cn.blocked as is_blocked,
        cn.muted as is_muted
      FROM conversations c
      JOIN users u ON (
        (c.user1_id = ? AND u.id = c.user2_id) OR 
        (c.user2_id = ? AND u.id = c.user1_id)
      )
      LEFT JOIN contacts cn ON cn.user_id = ? AND cn.contact_id = u.id
      WHERE c.user1_id = ? OR c.user2_id = ?
      ORDER BY c.last_message_at DESC NULLS LAST
    `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

    res.json({ success: true, data: { conversations } });
  } catch (error) {
    console.error('Error al obtener conversaciones:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER O CREAR CONVERSACIÓN CON UN USUARIO
// =============================================
router.post('/conversations', (req, res) => {
  try {
    const { other_user_id } = req.body;
    if (!other_user_id) {
      return res.status(400).json({ success: false, error: 'ID del otro usuario requerido' });
    }

    if (other_user_id === req.user.id) {
      return res.status(400).json({ success: false, error: 'No puedes crear conversación contigo mismo' });
    }

    const db = getDb();

    // Verificar que el usuario existe
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(other_user_id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    // Buscar conversación existente
    const existing = db.prepare(`
      SELECT id FROM conversations 
      WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
    `).get(req.user.id, other_user_id, other_user_id, req.user.id);

    if (existing) {
      // Resetear contadores no leídos
      db.prepare(`
        UPDATE conversations 
        SET unread_count_user1 = CASE WHEN user1_id = ? THEN 0 ELSE unread_count_user1 END,
            unread_count_user2 = CASE WHEN user2_id = ? THEN 0 ELSE unread_count_user2 END
        WHERE id = ?
      `).run(req.user.id, req.user.id, existing.id);

      return res.json({ success: true, data: { conversation_id: existing.id } });
    }

    // Crear nueva conversación
    const { v4: uuidv4 } = require('uuid');
    const conversationId = uuidv4();

    const userIds = [req.user.id, other_user_id].sort();
    db.prepare(`
      INSERT INTO conversations (id, user1_id, user2_id)
      VALUES (?, ?, ?)
    `).run(conversationId, userIds[0], userIds[1]);

    res.status(201).json({ success: true, data: { conversation_id: conversationId } });
  } catch (error) {
    console.error('Error al crear conversación:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER MENSAJES DE UNA CONVERSACIÓN
// =============================================
router.get('/conversations/:conversationId/messages', (req, res) => {
  try {
    const { page = 1, limit = 50, before } = req.query;
    const db = getDb();

    // Verificar que el usuario pertenece a la conversación
    const conversation = db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)
    `).get(req.params.conversationId, req.user.id, req.user.id);

    if (!conversation) {
      return res.status(403).json({ success: false, error: 'No tienes acceso a esta conversación' });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    let messages;

    if (before) {
      messages = db.prepare(`
        SELECT m.*, 
               CASE WHEN m.is_deleted = 2 THEN '[Mensaje eliminado]' ELSE m.content END as display_content,
               u.display_name as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ? AND m.created_at < ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(req.params.conversationId, before, parseInt(limit));
    } else {
      messages = db.prepare(`
        SELECT m.*,
               CASE WHEN m.is_deleted = 2 THEN '[Mensaje eliminado]' ELSE m.content END as display_content,
               u.display_name as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at DESC
        LIMIT ? OFFSET ?
      `).all(req.params.conversationId, parseInt(limit), offset);
    }

    // Ordenar cronológicamente (ascendente)
    messages.reverse();

    // Marcar mensajes como leídos
    const otherUserId = conversation.user1_id === req.user.id ? conversation.user2_id : conversation.user1_id;
    markMessagesAsRead(req.user.id, conversation.id, db);

    // Resetear contadores no leídos
    if (conversation.user1_id === req.user.id) {
      db.prepare('UPDATE conversations SET unread_count_user1 = 0 WHERE id = ?').run(conversation.id);
    } else {
      db.prepare('UPDATE conversations SET unread_count_user2 = 0 WHERE id = ?').run(conversation.id);
    }

    // Obtener total para paginación
    const total = db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?').get(req.params.conversationId);

    res.json({
      success: true,
      data: {
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total.count,
          has_more: offset + parseInt(limit) < total.count
        }
      }
    });
  } catch (error) {
    console.error('Error al obtener mensajes:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ENVIAR MENSAJE (vía REST, también se hace por Socket)
// =============================================
router.post('/conversations/:conversationId/messages', (req, res) => {
  try {
    const { content, message_type, media_url, media_mime_type, media_size,
            media_width, media_height, media_duration, media_thumbnail,
            file_name, caption, latitude, longitude, location_name,
            forwarded, replied_to_id } = req.body;

    const db = getDb();

    // Verificar acceso a la conversación
    const conversation = db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)
    `).get(req.params.conversationId, req.user.id, req.user.id);

    if (!conversation) {
      return res.status(403).json({ success: false, error: 'No tienes acceso a esta conversación' });
    }

    // Verificar si el receptor ha bloqueado al remitente
    const isBlocked = db.prepare(`
      SELECT * FROM contacts WHERE user_id = ? AND contact_id = ? AND blocked = 1
    `).get(conversation.user1_id === req.user.id ? conversation.user2_id : conversation.user1_id, req.user.id);

    if (isBlocked) {
      return res.status(403).json({ success: false, error: 'No puedes enviar mensajes a este usuario' });
    }

    // Validar tipo de mensaje
    const validTypes = ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker'];
    const type = message_type || 'text';
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: 'Tipo de mensaje inválido' });
    }

    // Para mensajes de texto, el contenido es obligatorio
    if (type === 'text' && !content) {
      return res.status(400).json({ success: false, error: 'El contenido del mensaje es requerido' });
    }

    const { v4: uuidv4 } = require('uuid');
    const messageId = uuidv4();
    const now = new Date().toISOString();

    // Crear mensaje
    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_id, content, message_type,
        media_url, media_mime_type, media_size, media_width, media_height,
        media_duration, media_thumbnail, file_name, caption,
        latitude, longitude, location_name, forwarded, replied_to_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId, req.params.conversationId, req.user.id, content || null, type,
      media_url || null, media_mime_type || null, media_size || 0,
      media_width || 0, media_height || 0, media_duration || 0,
      media_thumbnail || null, file_name || null, caption || null,
      latitude || null, longitude || null, location_name || null,
      forwarded ? 1 : 0, replied_to_id || null
    );

    // Actualizar conversación
    const preview = type === 'text' ? content?.substring(0, 100) : `[${type}]`;
    const otherUserCol = conversation.user1_id === req.user.id ? 'user2' : 'user1';
    db.prepare(`
      UPDATE conversations 
      SET last_message_id = ?,
          last_message_preview = ?,
          last_message_type = ?,
          last_message_sender_id = ?,
          last_message_at = datetime('now'),
          unread_count_${otherUserCol} = unread_count_${otherUserCol} + 1
      WHERE id = ?
    `).run(messageId, preview, type, req.user.id, req.params.conversationId);

    // Obtener el mensaje creado
    const message = db.prepare(`
      SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(messageId);

    res.status(201).json({ success: true, data: { message } });

    // Enviar push notification al otro usuario vía FCM (fire-and-forget)
    const otherUserId = conversation.user1_id === req.user.id ? conversation.user2_id : conversation.user1_id;
    setImmediate(() => {
      fcmService.sendPush(otherUserId, {
        type: 'chat_message',
        senderId: req.user.id,
        senderName: req.user.display_name,
        senderAvatar: req.user.avatar || '',
        content: type === 'text' ? content : `[${type}]`,
        conversationId: req.params.conversationId
      }).catch(() => {});
    });
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR MENSAJE PARA MÍ
// =============================================
router.delete('/messages/:messageId', (req, res) => {
  try {
    const db = getDb();

    const message = db.prepare(`
      SELECT m.* FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND (c.user1_id = ? OR c.user2_id = ?)
    `).get(req.params.messageId, req.user.id, req.user.id);

    if (!message) {
      return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
    }

    // Soft delete: agregar usuario a la lista de eliminación
    const currentDeleted = message.deleted_for ? JSON.parse(message.deleted_for) : [];
    if (!currentDeleted.includes(req.user.id)) {
      currentDeleted.push(req.user.id);
      db.prepare(`
        UPDATE messages SET deleted_for = ?, deleted_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(currentDeleted), req.params.messageId);
    }

    res.json({ success: true, message: 'Mensaje eliminado para ti' });
  } catch (error) {
    console.error('Error al eliminar mensaje:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR MENSAJE PARA TODOS
// =============================================
router.delete('/messages/:messageId/everyone', (req, res) => {
  try {
    const db = getDb();

    const message = db.prepare(`
      SELECT m.* FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND m.sender_id = ?
    `).get(req.params.messageId, req.user.id);

    if (!message) {
      return res.status(404).json({ success: false, error: 'Mensaje no encontrado o no eres el remitente' });
    }

    // Solo puedes eliminar para todos en los primeros 30 minutos (como WhatsApp)
    // Para Civis, permitimos siempre en este MVP

    db.prepare(`
      UPDATE messages SET content = NULL, media_url = NULL, media_thumbnail = NULL,
                         caption = NULL, file_name = NULL, is_deleted = 2, deleted_at = datetime('now')
      WHERE id = ?
    `).run(req.params.messageId);

    res.json({ success: true, message: 'Mensaje eliminado para todos' });
  } catch (error) {
    console.error('Error al eliminar mensaje para todos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// MARCAR MENSAJES COMO LEÍDOS
// =============================================
router.put('/conversations/:conversationId/read', (req, res) => {
  try {
    const db = getDb();
    markMessagesAsRead(req.user.id, req.params.conversationId, db);

    res.json({ success: true, message: 'Mensajes marcados como leídos' });
  } catch (error) {
    console.error('Error al marcar como leído:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// REENVIAR MENSAJE
// =============================================
router.post('/messages/:messageId/forward', (req, res) => {
  try {
    const { target_conversation_id } = req.body;
    if (!target_conversation_id) {
      return res.status(400).json({ success: false, error: 'Conversación destino requerida' });
    }

    const db = getDb();

    // Obtener mensaje original
    const original = db.prepare(`
      SELECT m.* FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND (c.user1_id = ? OR c.user2_id = ?)
    `).get(req.params.messageId, req.user.id, req.user.id);

    if (!original) {
      return res.status(404).json({ success: false, error: 'Mensaje original no encontrado' });
    }

    // Verificar acceso a conversación destino
    const targetConv = db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)
    `).get(target_conversation_id, req.user.id, req.user.id);

    if (!targetConv) {
      return res.status(403).json({ success: false, error: 'No tienes acceso a la conversación destino' });
    }

    const { v4: uuidv4 } = require('uuid');
    const newMessageId = uuidv4();

    // Crear mensaje reenviado
    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_id, content, message_type,
        media_url, media_mime_type, media_size, media_width, media_height,
        media_duration, media_thumbnail, file_name, caption,
        latitude, longitude, location_name, forwarded, replied_to_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
    `).run(
      newMessageId, target_conversation_id, req.user.id, original.content, original.message_type,
      original.media_url, original.media_mime_type, original.media_size,
      original.media_width, original.media_height, original.media_duration,
      original.media_thumbnail, original.file_name, original.caption,
      original.latitude, original.longitude, original.location_name
    );

    // Actualizar conversación destino
    const preview = original.message_type === 'text' ? original.content?.substring(0, 100) : `[${original.message_type}]`;
    const otherUserCol = targetConv.user1_id === req.user.id ? 'user2' : 'user1';
    db.prepare(`
      UPDATE conversations
      SET last_message_id = ?,
          last_message_preview = ?,
          last_message_type = ?,
          last_message_sender_id = ?,
          last_message_at = datetime('now'),
          unread_count_${otherUserCol} = unread_count_${otherUserCol} + 1
      WHERE id = ?
    `).run(newMessageId, preview, original.message_type, req.user.id, target_conversation_id);

    const forwardedMessage = db.prepare(`
      SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(newMessageId);

    res.status(201).json({ success: true, data: { message: forwardedMessage } });
  } catch (error) {
    console.error('Error al reenviar mensaje:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// OBTENER MENSAJE POR ID (para replies)
// =============================================
router.get('/messages/:messageId', (req, res) => {
  try {
    const db = getDb();
    const message = db.prepare(`
      SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND (c.user1_id = ? OR c.user2_id = ?)
    `).get(req.params.messageId, req.user.id, req.user.id);

    if (!message) {
      return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
    }

    res.json({ success: true, data: { message } });
  } catch (error) {
    console.error('Error al obtener mensaje:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR CONVERSACIÓN COMPLETA
// =============================================
router.delete('/conversations/:conversationId', (req, res) => {
  try {
    const db = getDb();

    const conversation = db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)
    `).get(req.params.conversationId, req.user.id, req.user.id);

    if (!conversation) {
      return res.status(403).json({ success: false, error: 'No tienes acceso a esta conversación' });
    }

    // Eliminar todos los mensajes de la conversación
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.conversationId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.conversationId);

    res.json({ success: true, message: 'Conversación eliminada' });
  } catch (error) {
    console.error('Error al eliminar conversación:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// FUNCIÓN AUXILIAR: Marcar mensajes como leídos
// =============================================
function markMessagesAsRead(userId, conversationId, db) {
  // Obtener mensajes no leídos del otro usuario
  const unreadMessages = db.prepare(`
    SELECT m.id FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.id = ? AND m.sender_id != ? AND m.status != 'read' AND m.is_deleted < 2
  `).all(conversationId, userId);

  if (unreadMessages.length > 0) {
    const markRead = db.prepare('UPDATE messages SET status = ? WHERE id = ?');
    const addRead = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)');

    const transaction = db.transaction(() => {
      for (const msg of unreadMessages) {
        markRead.run('read', msg.id);
        addRead.run(msg.id, userId);
      }
    });
    transaction();
  }
}

module.exports = router;
