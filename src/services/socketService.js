const db = require('../config/database');
const { socketAuthMiddleware } = require('../middlewares/authMiddleware');

let serverIo = null;

function setupSocket(io) {
  serverIo = io;

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.user.id;

    // Set user online
    db.prepare('UPDATE users SET online = 1 WHERE id = ?').run(userId);

    // Get contact user IDs for targeted events
    const getContactUserIds = () => {
      const contacts = db.prepare('SELECT contact_id FROM contacts WHERE user_id = ?').all(userId);
      return contacts.map(c => c.contact_id);
    };

    // Emit user_online to contacts (camelCase para Android JSONObject)
    const contactIds = getContactUserIds();
    contactIds.forEach(contactId => {
      io.emit(`user_online_${contactId}`, { userId: userId });
    });

    // On disconnect
    socket.on('disconnect', () => {
      db.prepare("UPDATE users SET online = 0, last_seen = datetime('now') WHERE id = ?").run(userId);

      const cIds = getContactUserIds();
      cIds.forEach(contactId => {
        io.emit(`user_offline_${contactId}`, { userId: userId });
      });
    });

    // On typing (Android envía camelCase: targetId, conversationId)
    socket.on('typing', (data) => {
      const targetId = data.targetId || data.target_id;
      const conversationId = data.conversationId || data.conversation_id;
      if (targetId) {
        io.emit(`typing_${targetId}`, { userId: userId, conversationId: conversationId });
      }
      if (conversationId) {
        io.emit(`conversation_typing_${conversationId}`, { userId: userId });
      }
    });

    // On stop_typing
    socket.on('stop_typing', (data) => {
      const targetId = data.targetId || data.target_id;
      const conversationId = data.conversationId || data.conversation_id;
      if (targetId) {
        io.emit(`stop_typing_${targetId}`, { userId: userId, conversationId: conversationId });
      }
      if (conversationId) {
        io.emit(`conversation_stop_typing_${conversationId}`, { userId: userId });
      }
    });

    // On message_read (Android envía camelCase: messageId, senderId)
    socket.on('message_read', (data) => {
      const messageId = data.messageId || data.message_id;
      const senderId = data.senderId || data.sender_id;
      if (messageId && senderId) {
        db.prepare('UPDATE messages SET read = 1 WHERE id = ? AND receiver_id = ?')
          .run(messageId, userId);
        io.emit(`message_read_${senderId}`, { messageId: messageId, readBy: userId });
      }
    });

    // On private_message (Android envía camelCase)
    socket.on('private_message', (data) => {
      const receiverId = data.receiverId || data.receiver_id;
      const messageType = data.messageType || data.message_type;
      const mediaUrl = data.mediaUrl || data.media_url;
      const replyTo = data.replyTo || data.reply_to;
      if (!receiverId) return;

      const { v4: uuidv4 } = require('uuid');

      // Find or create conversation
      let conversation = db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
        JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
        WHERE c.type = 'private'
      `).get(userId, receiverId);

      if (!conversation) {
        const convId = uuidv4();
        db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(convId, 'private', userId);
        db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, userId);
        db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, receiverId);
        conversation = { id: convId };
      }

      const messageId = uuidv4();
      db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, media_url, reply_to, forwarded)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(messageId, conversation.id, userId, receiverId, data.content || null,
          messageType || 'text', mediaUrl || null, replyTo || null, data.forwarded ? 1 : 0);

      db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
        .run(data.content || '[Media]', conversation.id);

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      const sender = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(userId);
      const messageWithSender = { ...message, sender };
      // Emit raw SQL row (snake_case) — Android lo parsea con appGson (snake_case)
      io.emit(`message_${receiverId}`, messageWithSender);
    });

    // On group_message (Android envía camelCase)
    socket.on('group_message', (data) => {
      const groupId = data.groupId || data.group_id;
      const messageType = data.messageType || data.message_type;
      const mediaUrl = data.mediaUrl || data.media_url;
      const replyTo = data.replyTo || data.reply_to;
      if (!groupId) return;

      const { v4: uuidv4 } = require('uuid');

      const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
      if (!group) return;

      // Get or create conversation for group
      let conversation = db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id
        WHERE c.type = 'group' AND cp.user_id = ?
      `).get(userId);

      const conversationId = conversation ? conversation.id : uuidv4();

      const messageId = uuidv4();
      db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, group_id, content, message_type, media_url, reply_to)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(messageId, conversationId, userId, groupId, data.content || null,
          messageType || 'text', mediaUrl || null, replyTo || null);

      db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
        .run(data.content || '[Media]', conversationId);

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);

      // Emit to all group members
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId);
      members.forEach(member => {
        if (member.user_id !== userId) {
          io.emit(`group_message_${member.user_id}`, message);
        }
      });
    });

    // On channel_message (Android envía camelCase)
    socket.on('channel_message', (data) => {
      const channelId = data.channelId || data.channel_id;
      const messageType = data.messageType || data.message_type;
      const mediaUrl = data.mediaUrl || data.media_url;
      if (!channelId) return;

      const { v4: uuidv4 } = require('uuid');

      const channel = db.prepare('SELECT * FROM community_channels WHERE id = ?').get(channelId);
      if (!channel) return;

      const messageId = uuidv4();
      db.prepare('INSERT INTO channel_messages (id, channel_id, sender_id, content, message_type, media_url) VALUES (?, ?, ?, ?, ?, ?)')
        .run(messageId, channelId, userId, data.content || null, messageType || 'text', mediaUrl || null);

      const message = db.prepare('SELECT cm.*, u.name as sender_name FROM channel_messages cm JOIN users u ON cm.sender_id = u.id WHERE cm.id = ?').get(messageId);

      // Emit to all community members
      const members = db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(channel.community_id);
      members.forEach(member => {
        if (member.user_id !== userId) {
          io.emit(`channel_message_${member.user_id}`, message);
        }
      });
    });

    // On call_signal (Android envía camelCase)
    socket.on('call_signal', (data) => {
      const callId = data.callId || data.call_id;
      const targetUserId = data.targetUserId || data.target_user_id;
      const signalType = data.signalType || data.signal_type;
      const signalData = data.signalData || data.signal_data;
      if (!callId || !signalType) return;

      const { v4: uuidv4 } = require('uuid');
      const id = uuidv4();
      db.prepare('INSERT INTO call_signals (id, call_id, sender_id, signal_type, signal_data) VALUES (?, ?, ?, ?, ?)')
        .run(id, callId, userId, signalType, signalData || null);

      // Emit to specific target or all call participants
      if (targetUserId) {
        io.emit(`call_signal_${targetUserId}`, { callId: callId, senderId: userId, signalType: signalType, signalData: signalData });
      } else {
        io.emit(`call_signal_all_${callId}`, { callId: callId, senderId: userId, signalType: signalType, signalData: signalData });
      }
    });
  });
}

function getServerIo() {
  return serverIo;
}

module.exports = { setupSocket, getServerIo };
