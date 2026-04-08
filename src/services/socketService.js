const { getDb } = require('../config/database');
const fcmService = require('./fcmService');

/**
 * Mapa de conexiones activas: userId -> socketId
 */
const onlineUsers = new Map();

/**
 * Mapa inverso: socketId -> userId
 */
const socketUsers = new Map();

/**
 * Mapa de salas: userId -> Set de socketIds
 */
const userSockets = new Map();

function setupSocket(io) {
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`🟢 Usuario conectado: ${socket.user.display_name} (${userId})`);

    // =============================================
    // REGISTRAR CONEXIÓN
    // =============================================
    registerUser(userId, socket.id);

    // Actualizar estado en la BD
    const db = getDb();
    db.prepare("UPDATE users SET is_online = 1, last_seen = datetime('now') WHERE id = ?").run(userId);

    // Notificar a contactos que el usuario está online
    const contacts = db.prepare(`
      SELECT contact_id FROM contacts WHERE user_id = ? AND blocked = 0
    `).all(userId);
    for (const contact of contacts) {
      emitToUser(io, contact.contact_id, 'user:online', { user_id: userId });
    }

    // Unirse a salas de conversaciones activas
    joinConversationRooms(socket, userId, db);

    // Unirse a salas de grupos
    joinGroupRooms(socket, userId, db);

    // =============================================
    // MENSAJE PRIVADO EN TIEMPO REAL
    // =============================================
    socket.on('message:send', (data) => {
      handleSendMessage(io, socket, userId, data, db);
    });

    // =============================================
    // INDICADOR DE ESCRITURA
    // =============================================
    socket.on('typing:start', (data) => {
      const { conversation_id } = data;
      if (!conversation_id) return;

      const conversation = db.prepare(`
        SELECT user1_id, user2_id FROM conversations WHERE id = ?
      `).get(conversation_id);
      if (!conversation) return;

      const otherUserId = conversation.user1_id === userId ? conversation.user2_id : conversation.user1_id;
      emitToUser(io, otherUserId, 'typing:start', {
        conversation_id,
        user_id: userId
      });
    });

    socket.on('typing:stop', (data) => {
      const { conversation_id } = data;
      if (!conversation_id) return;

      const conversation = db.prepare(`
        SELECT user1_id, user2_id FROM conversations WHERE id = ?
      `).get(conversation_id);
      if (!conversation) return;

      const otherUserId = conversation.user1_id === userId ? conversation.user2_id : conversation.user1_id;
      emitToUser(io, otherUserId, 'typing:stop', {
        conversation_id,
        user_id: userId
      });
    });

    // =============================================
    // MENSAJES LEÍDOS (en tiempo real)
    // =============================================
    socket.on('message:read', (data) => {
      const { conversation_id, message_ids } = data;
      if (!conversation_id || !message_ids) return;

      const conversation = db.prepare(`
        SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)
      `).get(conversation_id, userId, userId);
      if (!conversation) return;

      const markRead = db.prepare('UPDATE messages SET status = ? WHERE id = ? AND sender_id != ?');
      const addReadRecord = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)');

      const transaction = db.transaction(() => {
        for (const msgId of message_ids) {
          markRead.run('read', msgId, userId);
          addReadRecord.run(msgId, userId);
        }
        // Resetear contadores
        if (conversation.user1_id === userId) {
          db.prepare('UPDATE conversations SET unread_count_user1 = 0 WHERE id = ?').run(conversation_id);
        } else {
          db.prepare('UPDATE conversations SET unread_count_user2 = 0 WHERE id = ?').run(conversation_id);
        }
      });
      transaction();

      // Notificar al remitente que sus mensajes fueron leídos
      const otherUserId = conversation.user1_id === userId ? conversation.user2_id : conversation.user1_id;
      emitToUser(io, otherUserId, 'message:read_receipt', {
        conversation_id,
        read_by: userId,
        message_ids,
        read_at: new Date().toISOString()
      });
    });

    // =============================================
    // MENSAJE DE GRUPO EN TIEMPO REAL
    // =============================================
    socket.on('group:message:send', (data) => {
      handleGroupMessage(io, socket, userId, data, db);
    });

    // =============================================
    // NOTIFICACIÓN DE ENTREGA
    // =============================================
    socket.on('message:delivered', (data) => {
      const { message_ids } = data;
      if (!message_ids) return;

      // Obtener los mensajes y notificar a sus remitentes
      for (const msgId of message_ids) {
        const message = db.prepare(`
          SELECT m.*, c.user1_id, c.user2_id FROM messages m
          JOIN conversations c ON m.conversation_id = c.id
          WHERE m.id = ?
        `).get(msgId);

        if (message && message.status === 'sent') {
          db.prepare('UPDATE messages SET status = ? WHERE id = ?').run('delivered', msgId);
          const recipientId = message.sender_id;
          emitToUser(io, recipientId, 'message:delivered_receipt', {
            message_id: msgId,
            delivered_at: new Date().toISOString()
          });
        }
      }
    });

    // =============================================
    // LLAMADAS (señalización WebRTC completa)
    // =============================================
    socket.on('call:initiate', (data) => {
      handleCallInitiate(io, socket, userId, data, db);
    });

    socket.on('call:answer', (data) => {
      const { call_id } = data;
      if (!call_id) return;

      db.prepare("UPDATE calls SET status = 'connected', started_at = datetime('now') WHERE id = ? AND status = 'ringing'").run(call_id);

      // Notificar a todos los participantes
      const participants = db.prepare('SELECT user_id FROM call_participants WHERE call_id = ?').all(call_id);
      for (const p of participants) {
        emitToUser(io, p.user_id, 'call:answered', {
          call_id,
          answered_by: userId,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('call:reject', (data) => {
      const { call_id } = data;
      if (!call_id) return;

      db.prepare("UPDATE calls SET status = 'rejected', ended_at = datetime('now') WHERE id = ? AND status = 'ringing'").run(call_id);

      const call = db.prepare('SELECT caller_id FROM calls WHERE id = ?').get(call_id);
      if (call) {
        emitToUser(io, call.caller_id, 'call:rejected', {
          call_id, rejected_by: userId, timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('call:end', (data) => {
      const { call_id, duration } = data;
      if (!call_id) return;

      const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(call_id);
      if (!call) return;

      const now = new Date().toISOString();
      const finalDuration = call.started_at
        ? Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000)
        : (duration || 0);
      const status = (call.status === 'ringing') ? 'missed' : 'ended';

      db.prepare("UPDATE calls SET status = ?, ended_at = ?, duration = ? WHERE id = ?").run(status, now, finalDuration, call_id);
      db.prepare("UPDATE call_participants SET left_at = ? WHERE call_id = ? AND left_at IS NULL").run(now, call_id);

      const participants = db.prepare('SELECT user_id FROM call_participants WHERE call_id = ?').all(call_id);
      for (const p of participants) {
        emitToUser(io, p.user_id, 'call:ended', {
          call_id, ended_by: userId, status, duration: finalDuration, timestamp: now
        });
      }
    });

    socket.on('call:join', (data) => {
      const { call_id } = data;
      if (!call_id) return;

      const call = db.prepare("SELECT * FROM calls WHERE id = ? AND status IN ('ringing', 'connected')").get(call_id);
      if (!call) return;

      const existing = db.prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?').get(call_id, userId);
      if (existing) return;

      db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(call_id, userId, 'participant');

      if (call.status === 'ringing') {
        db.prepare("UPDATE calls SET status = 'connected', started_at = datetime('now') WHERE id = ?").run(call_id);
      }

      socket.join(`call_${call_id}`);

      // Notificar a todos
      const participants = db.prepare(`
        SELECT cp.user_id, u.display_name, u.avatar FROM call_participants cp
        JOIN users u ON cp.user_id = u.id WHERE cp.call_id = ? AND cp.left_at IS NULL
      `).all(call_id);
      for (const p of participants) {
        emitToUser(io, p.user_id, 'call:participant_joined', {
          call_id, user_id: userId, display_name: socket.user.display_name,
          avatar: socket.user.avatar, participants
        });
      }
    });

    socket.on('call:leave', (data) => {
      const { call_id } = data;
      if (!call_id) return;

      db.prepare("UPDATE call_participants SET left_at = datetime('now') WHERE call_id = ? AND user_id = ? AND left_at IS NULL")
        .run(call_id, userId);
      socket.leave(`call_${call_id}`);

      const remaining = db.prepare('SELECT COUNT(*) as count FROM call_participants WHERE call_id = ? AND left_at IS NULL').get(call_id);
      if (remaining.count === 0) {
        db.prepare("UPDATE calls SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(call_id);
      }

      emitToRoom(io, `call_${call_id}`, 'call:participant_left', {
        call_id, user_id: userId, display_name: socket.user.display_name
      });
    });

    // =============================================
    // SEÑALES WebRTC (offer, answer, ice-candidate)
    // =============================================
    socket.on('call:signal', (data) => {
      const { call_id, signal_type, target_id, sdp, candidate } = data;
      if (!call_id || !signal_type) return;

      // Guardar señal
      const { v4: uuidv4 } = require('uuid');
      db.prepare(`
        INSERT INTO call_signals (id, call_id, sender_id, target_id, signal_type, sdp, candidate)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), call_id, userId, target_id || null, signal_type, sdp || null, candidate || null);

      // Reenviar al destino
      if (target_id) {
        emitToUser(io, target_id, 'call:signal', {
          call_id, signal_type, sender_id: userId,
          display_name: socket.user.display_name,
          sdp, candidate, timestamp: new Date().toISOString()
        });
      } else {
        // Broadcast a todos los participantes de la llamada (excepto sender)
        emitToRoom(io, `call_${call_id}`, 'call:signal', {
          call_id, signal_type, sender_id: userId,
          display_name: socket.user.display_name,
          sdp, candidate, timestamp: new Date().toISOString()
        });
      }
    });

    // =============================================
    // MENSAJES DE CANAL EN TIEMPO REAL
    // =============================================
    socket.on('channel:message:send', (data) => {
      handleChannelMessage(io, socket, userId, data, db);
    });

    // Unirse a salas de canales
    joinChannelRooms(socket, userId, db);

    // =============================================
    // PRESENCIA: ÚLTIMA VEZ VISTO
    // =============================================
    socket.on('presence:update', (data) => {
      db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);
    });

    // =============================================
    // DESCONEXIÓN
    // =============================================
    socket.on('disconnect', (reason) => {
      console.log(`🔴 Usuario desconectado: ${socket.user.display_name} (${userId}) - Razón: ${reason}`);
      unregisterUser(userId, socket.id);

      // Si no quedan sockets activos para este usuario
      if (!userSockets.has(userId) || userSockets.get(userId).size === 0) {
        db.prepare("UPDATE users SET is_online = 0, last_seen = datetime('now') WHERE id = ?").run(userId);

        // Notificar a contactos que el usuario está offline
        const contacts = db.prepare(`
          SELECT contact_id FROM contacts WHERE user_id = ? AND blocked = 0
        `).all(userId);
        for (const contact of contacts) {
          emitToUser(io, contact.contact_id, 'user:offline', {
            user_id: userId,
            last_seen: new Date().toISOString()
          });
        }
      }
    });
  });
}

// =============================================
// FUNCIONES AUXILIARES
// =============================================

function registerUser(userId, socketId) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socketId);
  onlineUsers.set(userId, socketId);
  socketUsers.set(socketId, userId);
}

function unregisterUser(userId, socketId) {
  if (userSockets.has(userId)) {
    userSockets.get(userId).delete(socketId);
    if (userSockets.get(userId).size === 0) {
      userSockets.delete(userId);
      onlineUsers.delete(userId);
    }
  }
  socketUsers.delete(socketId);
}

function emitToUser(io, userId, event, data) {
  if (userSockets.has(userId)) {
    for (const socketId of userSockets.get(userId)) {
      io.to(socketId).emit(event, data);
    }
  }
}

function emitToRoom(io, room, event, data) {
  io.to(room).emit(event, data);
}

function joinConversationRooms(socket, userId, db) {
  const conversations = db.prepare(`
    SELECT id FROM conversations WHERE user1_id = ? OR user2_id = ?
  `).all(userId, userId);

  for (const conv of conversations) {
    socket.join(`conv_${conv.id}`);
  }
}

function joinGroupRooms(socket, userId, db) {
  const groups = db.prepare(`
    SELECT group_id FROM group_members WHERE user_id = ?
  `).all(userId);

  for (const group of groups) {
    socket.join(`group_${group.group_id}`);
  }
}

function handleSendMessage(io, socket, senderId, data, db) {
  const { conversation_id, content, message_type, media_url, media_mime_type,
          media_size, media_width, media_height, media_duration, media_thumbnail,
          file_name, caption, latitude, longitude, location_name,
          forwarded, replied_to_id } = data;

  if (!conversation_id) return;

  // Verificar acceso
  const conversation = db.prepare(`
    SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)
  `).get(conversation_id, senderId, senderId);

  if (!conversation) {
    socket.emit('error', { message: 'Conversación no encontrada' });
    return;
  }

  const validTypes = ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker'];
  const type = message_type || 'text';
  if (!validTypes.includes(type)) return;
  if (type === 'text' && !content) return;

  const { v4: uuidv4 } = require('uuid');
  const messageId = uuidv4();

  const transaction = db.transaction(() => {
    // Crear mensaje
    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_id, content, message_type,
        media_url, media_mime_type, media_size, media_width, media_height,
        media_duration, media_thumbnail, file_name, caption,
        latitude, longitude, location_name, forwarded, replied_to_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId, conversation_id, senderId, content || null, type,
      media_url || null, media_mime_type || null, media_size || 0,
      media_width || 0, media_height || 0, media_duration || 0,
      media_thumbnail || null, file_name || null, caption || null,
      latitude || null, longitude || null, location_name || null,
      forwarded ? 1 : 0, replied_to_id || null
    );

    // Actualizar conversación
    const preview = type === 'text' ? (content || '').substring(0, 100) : `[${type}]`;
    const otherCol = conversation.user1_id === senderId ? 'user2' : 'user1';
    db.prepare(`
      UPDATE conversations 
      SET last_message_id = ?, last_message_preview = ?, last_message_type = ?,
          last_message_sender_id = ?, last_message_at = datetime('now'),
          unread_count_${otherCol} = unread_count_${otherCol} + 1
      WHERE id = ?
    `).run(messageId, preview, type, senderId, conversation_id);
  });

  transaction();

  // Obtener mensaje completo
  const message = db.prepare(`
    SELECT m.*, u.display_name as sender_name, u.avatar as sender_avatar
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `).get(messageId);

  // Emitir al remitente (confirmación)
  socket.emit('message:sent', { message });

  // Emitir al receptor
  const otherUserId = conversation.user1_id === senderId ? conversation.user2_id : conversation.user1_id;
  emitToUser(io, otherUserId, 'message:new', { message, conversation_id });

  // Enviar push FCM al receptor si no está conectado por socket
  if (!userSockets.has(otherUserId)) {
    setImmediate(() => {
      const sender = db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(senderId);
      fcmService.sendPush(otherUserId, {
        type: 'chat_message',
        senderId,
        senderName: sender?.display_name || 'Usuario',
        senderAvatar: sender?.avatar || '',
        content: type === 'text' ? (content || '') : `[${type}]`,
        conversationId: conversation_id
      }).catch(() => {});
    });
  }

  // Enviar push notification al receptor
  try {
    const fcmService = require('./fcmService');
    const sender = db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(senderId);
    fcmService.sendPush(otherUserId, {
      type: 'chat_message',
      senderName: sender?.display_name || 'Nuevo mensaje',
      senderAvatar: sender?.avatar || '',
      senderId: senderId,
      content: type === 'text' ? (content || '') : `[${type}]`,
      conversationId: conversation_id
    });
  } catch (e) {
    // FCM no disponible, continuar sin push
  }

  // Emitir a todos los sockets del remitente para sincronización
  emitToUser(io, senderId, 'message:sync', { message, conversation_id });
}

function handleGroupMessage(io, socket, senderId, data, db) {
  const { group_id, content, message_type, media_url, media_mime_type,
          media_size, media_width, media_height, media_duration, media_thumbnail,
          file_name, caption, forwarded, replied_to_id } = data;

  if (!group_id) return;

  // Verificar que es miembro
  const membership = db.prepare(`
    SELECT gm.*, g.is_restricted FROM group_members gm
    JOIN groups g ON gm.group_id = g.id
    WHERE gm.group_id = ? AND gm.user_id = ?
  `).get(group_id, senderId);

  if (!membership) {
    socket.emit('error', { message: 'No eres miembro de este grupo' });
    return;
  }

  if (membership.role !== 'admin' && membership.is_restricted) {
    socket.emit('error', { message: 'Solo los admins pueden enviar mensajes' });
    return;
  }

  const validTypes = ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker'];
  const type = message_type || 'text';
  if (!validTypes.includes(type)) return;
  if (type === 'text' && !content) return;

  const { v4: uuidv4 } = require('uuid');
  const messageId = uuidv4();

  // Crear mensaje
  db.prepare(`
    INSERT INTO group_messages (
      id, group_id, sender_id, content, message_type,
      media_url, media_mime_type, media_size, media_width, media_height,
      media_duration, media_thumbnail, file_name, caption, forwarded, replied_to_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId, group_id, senderId, content || null, type,
    media_url || null, media_mime_type || null, media_size || 0,
    media_width || 0, media_height || 0, media_duration || 0,
    media_thumbnail || null, file_name || null, caption || null,
    forwarded ? 1 : 0, replied_to_id || null
  );

  db.prepare("UPDATE groups SET updated_at = datetime('now') WHERE id = ?").run(group_id);

  const message = db.prepare(`
    SELECT gm.*, u.display_name as sender_name, u.avatar as sender_avatar
    FROM group_messages gm JOIN users u ON gm.sender_id = u.id
    WHERE gm.id = ?
  `).get(messageId);

  // Emitir a toda la sala del grupo
  emitToRoom(io, `group_${group_id}`, 'group:message:new', { message, group_id });

  // Confirmación al remitente
  socket.emit('group:message:sent', { message });
}

// =============================================
// MANEJAR INICIO DE LLAMADA
// =============================================
function handleCallInitiate(io, socket, senderId, data, db) {
  const { target_user_id, call_type, channel_id } = data;
  const type = call_type || 'video';
  if (!['audio', 'video'].includes(type)) return;

  const { v4: uuidv4 } = require('uuid');
  const callId = uuidv4();

  if (channel_id) {
    // Llamada de canal de voz (comunidad)
    const channel = db.prepare('SELECT ch.*, c.id as community_id FROM channels ch JOIN communities c ON ch.community_id = c.id WHERE ch.id = ?').get(channel_id);
    if (!channel) { socket.emit('error', { message: 'Canal no encontrado' }); return; }

    db.prepare("INSERT INTO calls (id, call_type, call_mode, caller_id, status, community_id, channel_id) VALUES (?, ?, 'group', ?, 'ringing', ?, ?)")
      .run(callId, type, senderId, channel.community_id, channel_id);
    db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(callId, senderId, 'caller');

    // Unir al caller a la sala de la llamada
    socket.join(`call_${callId}`);

    // Notificar a miembros del canal
    const channelMembers = db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(channel_id);
    for (const m of channelMembers) {
      if (m.user_id !== senderId) {
        emitToUser(io, m.user_id, 'call:incoming', {
          call_id: callId, call_type: type, call_mode: 'group',
          caller_id: senderId, display_name: socket.user.display_name, avatar: socket.user.avatar,
          channel_id, timestamp: new Date().toISOString()
        });
      }
    }
    socket.emit('call:initiated', { call_id: callId, call_type: type, call_mode: 'group' });
  } else if (target_user_id) {
    // Llamada privada 1-a-1
    if (target_user_id === senderId) return;

    const isBlocked = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ? AND blocked = 1')
      .get(target_user_id, senderId);
    if (isBlocked) { socket.emit('error', { message: 'Has sido bloqueado' }); return; }

    // Verificar llamada activa
    const activeCall = db.prepare(`
      SELECT c.id FROM calls c
      JOIN call_participants cp1 ON c.id = cp1.call_id AND cp1.user_id = ?
      JOIN call_participants cp2 ON c.id = cp2.call_id AND cp2.user_id = ?
      WHERE c.status IN ('ringing', 'connected') AND c.call_mode = 'private'
    `).get(senderId, target_user_id);
    if (activeCall) { socket.emit('error', { message: 'Ya hay una llamada activa', data: { call_id: activeCall.id } }); return; }

    db.prepare("INSERT INTO calls (id, call_type, call_mode, caller_id, status) VALUES (?, ?, 'private', ?, 'ringing')")
      .run(callId, type, senderId);
    db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(callId, senderId, 'caller');
    db.prepare('INSERT INTO call_participants (call_id, user_id, role) VALUES (?, ?, ?)').run(callId, target_user_id, 'participant');

    socket.join(`call_${callId}`);

    emitToUser(io, target_user_id, 'call:incoming', {
      call_id: callId, call_type: type, call_mode: 'private',
      caller_id: senderId, display_name: socket.user.display_name, avatar: socket.user.avatar,
      timestamp: new Date().toISOString()
    });

    socket.emit('call:initiated', { call_id: callId, call_type: type, call_mode: 'private', target_user_id });
  }
}

// =============================================
// MANEJAR MENSAJE DE CANAL
// =============================================
function handleChannelMessage(io, socket, senderId, data, db) {
  const { channel_id, community_id, content, message_type, media_url, media_mime_type,
          media_size, media_width, media_height, media_duration, media_thumbnail,
          file_name, caption, forwarded, replied_to_id } = data;

  if (!channel_id || !community_id) return;

  const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND community_id = ?').get(channel_id, community_id);
  if (!channel) { socket.emit('error', { message: 'Canal no encontrado' }); return; }

  const membership = db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(community_id, senderId);
  if (!membership) { socket.emit('error', { message: 'No eres miembro' }); return; }

  if (channel.channel_type === 'announcement' && !['owner', 'admin', 'moderator'].includes(membership.role)) {
    socket.emit('error', { message: 'Solo admins pueden enviar aquí' }); return;
  }

  const validTypes = ['text', 'image', 'video', 'audio', 'document', 'link'];
  const type = message_type || 'text';
  if (!validTypes.includes(type)) return;
  if (type === 'text' && !content) return;

  const { v4: uuidv4 } = require('uuid');
  const messageId = uuidv4();

  db.prepare(`
    INSERT INTO channel_messages (id, channel_id, sender_id, content, message_type,
      media_url, media_mime_type, media_size, media_width, media_height,
      media_duration, media_thumbnail, file_name, caption, forwarded, replied_to_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(messageId, channel_id, senderId, content || null, type,
    media_url || null, media_mime_type || null, media_size || 0,
    media_width || 0, media_height || 0, media_duration || 0,
    media_thumbnail || null, file_name || null, caption || null,
    forwarded ? 1 : 0, replied_to_id || null);

  const preview = type === 'text' ? (content || '').substring(0, 100) : `[${type}]`;
  db.prepare("UPDATE channels SET last_message_preview = ?, last_message_type = ?, last_message_sender_id = ?, last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(preview, type, senderId, channel_id);

  db.prepare('UPDATE channel_members SET unread_count = unread_count + 1 WHERE channel_id = ? AND user_id != ?')
    .run(channel_id, senderId);

  const message = db.prepare(`
    SELECT cm.*, u.display_name as sender_name, u.avatar as sender_avatar
    FROM channel_messages cm JOIN users u ON cm.sender_id = u.id
    WHERE cm.id = ?
  `).get(messageId);

  emitToRoom(io, `channel_${channel_id}`, 'channel:message:new', { message, channel_id, community_id });
  socket.emit('channel:message:sent', { message });
}

// =============================================
// UNIRSE A SALAS DE CANALES
// =============================================
function joinChannelRooms(socket, userId, db) {
  const channels = db.prepare(`
    SELECT cm.channel_id FROM channel_members cm
    JOIN channels ch ON cm.channel_id = ch.id
    WHERE cm.user_id = ?
  `).all(userId);

  for (const ch of channels) {
    socket.join(`channel_${ch.channel_id}`);
  }
}

// Exportar funciones para uso externo
module.exports = { setupSocket, emitToUser, emitToRoom, onlineUsers, userSockets };
