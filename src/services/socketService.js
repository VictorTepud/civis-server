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

    // Emit user_online to contacts
    const contactIds = getContactUserIds();
    contactIds.forEach(contactId => {
      io.emit(`user_online_${contactId}`, { user_id: userId });
    });

    // On disconnect
    socket.on('disconnect', () => {
      db.prepare("UPDATE users SET online = 0, last_seen = datetime('now') WHERE id = ?").run(userId);

      const cIds = getContactUserIds();
      cIds.forEach(contactId => {
        io.emit(`user_offline_${contactId}`, { user_id: userId });
      });
    });

    // On typing
    socket.on('typing', (data) => {
      const { target_id, conversation_id } = data;
      if (target_id) {
        io.emit(`typing_${target_id}`, { user_id: userId, conversation_id });
      }
      if (conversation_id) {
        io.emit(`conversation_typing_${conversation_id}`, { user_id: userId });
      }
    });

    // On stop_typing
    socket.on('stop_typing', (data) => {
      const { target_id, conversation_id } = data;
      if (target_id) {
        io.emit(`stop_typing_${target_id}`, { user_id: userId, conversation_id });
      }
      if (conversation_id) {
        io.emit(`conversation_stop_typing_${conversation_id}`, { user_id: userId });
      }
    });

    // On message_read
    socket.on('message_read', (data) => {
      const { message_id, sender_id } = data;
      if (message_id && sender_id) {
        db.prepare('UPDATE messages SET read = 1 WHERE id = ? AND receiver_id = ?')
          .run(message_id, userId);
        io.emit(`message_read_${sender_id}`, { message_id, read_by: userId });
      }
    });

    // On private_message
    socket.on('private_message', (data) => {
      const { receiver_id, content, message_type, media_url, reply_to, forwarded } = data;
      if (!receiver_id) return;

      const { v4: uuidv4 } = require('uuid');

      // Find or create conversation
      let conversation = db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
        JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
        WHERE c.type = 'private'
      `).get(userId, receiver_id);

      if (!conversation) {
        const convId = uuidv4();
        db.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(convId, 'private', userId);
        db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, userId);
        db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, receiver_id);
        conversation = { id: convId };
      }

      const messageId = uuidv4();
      db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, media_url, reply_to, forwarded)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(messageId, conversation.id, userId, receiver_id, content || null,
          message_type || 'text', media_url || null, reply_to || null, forwarded ? 1 : 0);

      db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
        .run(content || '[Media]', conversation.id);

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      const sender = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(userId);
      const messageWithSender = { ...message, sender };
      io.emit(`message_${receiver_id}`, messageWithSender);
    });

    // On group_message
    socket.on('group_message', (data) => {
      const { group_id, content, message_type, media_url, reply_to } = data;
      if (!group_id) return;

      const { v4: uuidv4 } = require('uuid');

      const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(group_id);
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
        .run(messageId, conversationId, userId, group_id, content || null,
          message_type || 'text', media_url || null, reply_to || null);

      db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?`)
        .run(content || '[Media]', conversationId);

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);

      // Emit to all group members
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(group_id);
      members.forEach(member => {
        if (member.user_id !== userId) {
          io.emit(`group_message_${member.user_id}`, message);
        }
      });
    });

    // On channel_message
    socket.on('channel_message', (data) => {
      const { channel_id, content, message_type, media_url } = data;
      if (!channel_id) return;

      const { v4: uuidv4 } = require('uuid');

      const channel = db.prepare('SELECT * FROM community_channels WHERE id = ?').get(channel_id);
      if (!channel) return;

      const messageId = uuidv4();
      db.prepare('INSERT INTO channel_messages (id, channel_id, sender_id, content, message_type, media_url) VALUES (?, ?, ?, ?, ?, ?)')
        .run(messageId, channel_id, userId, content || null, message_type || 'text', media_url || null);

      const message = db.prepare('SELECT cm.*, u.name as sender_name FROM channel_messages cm JOIN users u ON cm.sender_id = u.id WHERE cm.id = ?').get(messageId);

      // Emit to all community members
      const members = db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(channel.community_id);
      members.forEach(member => {
        if (member.user_id !== userId) {
          io.emit(`channel_message_${member.user_id}`, message);
        }
      });
    });

    // On call_signal
    socket.on('call_signal', (data) => {
      const { call_id, target_user_id, signal_type, signal_data } = data;
      if (!call_id || !signal_type) return;

      const { v4: uuidv4 } = require('uuid');
      const id = uuidv4();
      db.prepare('INSERT INTO call_signals (id, call_id, sender_id, signal_type, signal_data) VALUES (?, ?, ?, ?, ?)')
        .run(id, call_id, userId, signal_type, signal_data || null);

      // Emit to specific target or all call participants
      if (target_user_id) {
        io.emit(`call_signal_${target_user_id}`, { call_id, sender_id: userId, signal_type, signal_data });
      } else {
        io.emit(`call_signal_all_${call_id}`, { call_id, sender_id: userId, signal_type, signal_data });
      }
    });
  });
}

function getServerIo() {
  return serverIo;
}

module.exports = { setupSocket, getServerIo };
