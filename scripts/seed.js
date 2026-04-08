/**
 * Script de seed para Civis
 * Crea usuarios de prueba para probar el servidor
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'civis.db');

async function seed() {
  console.log('🌱 Iniciando seed de datos de prueba...\n');

  // Ensure data directory exists
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Crear tablas si no existen
  console.log('📊 Creando tablas...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      phone TEXT UNIQUE, username TEXT UNIQUE, display_name TEXT NOT NULL DEFAULT '',
      avatar TEXT DEFAULT NULL, about TEXT DEFAULT '¡Hola! Estoy usando Civis',
      privacy_profile_photo INTEGER DEFAULT 0, privacy_about INTEGER DEFAULT 0,
      privacy_last_seen INTEGER DEFAULT 0, privacy_status INTEGER DEFAULT 0,
      is_online INTEGER DEFAULT 0, last_seen TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contacts (
      user_id TEXT NOT NULL, contact_id TEXT NOT NULL, nickname TEXT DEFAULT NULL,
      blocked INTEGER DEFAULT 0, muted INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, contact_id), CHECK (user_id != contact_id)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, user1_id TEXT NOT NULL, user2_id TEXT NOT NULL,
      last_message_id TEXT DEFAULT NULL, last_message_preview TEXT DEFAULT NULL,
      last_message_type TEXT DEFAULT 'text', last_message_sender_id TEXT DEFAULT NULL,
      last_message_at TEXT DEFAULT NULL, unread_count_user1 INTEGER DEFAULT 0,
      unread_count_user2 INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user1_id, user2_id), CHECK (user1_id != user2_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      content TEXT DEFAULT NULL, message_type TEXT DEFAULT 'text',
      media_url TEXT DEFAULT NULL, media_mime_type TEXT DEFAULT NULL,
      media_size INTEGER DEFAULT 0, media_width INTEGER DEFAULT 0,
      media_height INTEGER DEFAULT 0, media_duration INTEGER DEFAULT 0,
      media_thumbnail TEXT DEFAULT NULL, file_name TEXT DEFAULT NULL,
      caption TEXT DEFAULT NULL, latitude REAL DEFAULT NULL, longitude REAL DEFAULT NULL,
      location_name TEXT DEFAULT NULL, forwarded INTEGER DEFAULT 0,
      replied_to_id TEXT DEFAULT NULL, status TEXT DEFAULT 'sent',
      is_deleted INTEGER DEFAULT 0, deleted_for TEXT DEFAULT NULL,
      deleted_at TEXT DEFAULT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL, user_id TEXT NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL, created_by TEXT NOT NULL,
      is_restricted INTEGER DEFAULT 0, max_members INTEGER DEFAULT 1024,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member',
      nickname TEXT DEFAULT NULL, muted INTEGER DEFAULT 0,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      content TEXT DEFAULT NULL, message_type TEXT DEFAULT 'text',
      media_url TEXT DEFAULT NULL, media_mime_type TEXT DEFAULT NULL,
      media_size INTEGER DEFAULT 0, media_width INTEGER DEFAULT 0,
      media_height INTEGER DEFAULT 0, media_duration INTEGER DEFAULT 0,
      media_thumbnail TEXT DEFAULT NULL, file_name TEXT DEFAULT NULL,
      caption TEXT DEFAULT NULL, forwarded INTEGER DEFAULT 0,
      replied_to_id TEXT DEFAULT NULL, is_deleted INTEGER DEFAULT 0,
      deleted_for TEXT DEFAULT NULL, deleted_at TEXT DEFAULT NULL,
      sender_deleted INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS group_message_reads (
      message_id TEXT NOT NULL, user_id TEXT NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS user_status (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      content_type TEXT DEFAULT 'text', content TEXT DEFAULT NULL,
      background_color TEXT DEFAULT '#1DA1F2', media_url TEXT DEFAULT NULL,
      media_thumbnail TEXT DEFAULT NULL, font_type TEXT DEFAULT 'default',
      views_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now', '+24 hours'))
    );
    CREATE TABLE IF NOT EXISTS status_views (
      status_id TEXT NOT NULL, viewer_id TEXT NOT NULL,
      viewed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (status_id, viewer_id)
    );
    CREATE TABLE IF NOT EXISTS status_replies (
      id TEXT PRIMARY KEY, status_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL, cover_image TEXT DEFAULT NULL, created_by TEXT NOT NULL,
      is_public INTEGER DEFAULT 0, approve_members INTEGER DEFAULT 0, max_members INTEGER DEFAULT 50000,
      allow_member_invite INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS community_members (
      community_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member',
      muted INTEGER DEFAULT 0, joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (community_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS community_roles (
      id TEXT PRIMARY KEY, community_id TEXT NOT NULL, name TEXT NOT NULL,
      color TEXT DEFAULT '#1DA1F2', permissions TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, community_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT DEFAULT NULL, channel_type TEXT DEFAULT 'text',
      sort_order INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, created_by TEXT NOT NULL,
      last_message_preview TEXT DEFAULT NULL, last_message_type TEXT DEFAULT 'text',
      last_message_sender_id TEXT DEFAULT NULL, last_message_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL, user_id TEXT NOT NULL, unread_count INTEGER DEFAULT 0,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      content TEXT DEFAULT NULL, message_type TEXT DEFAULT 'text',
      media_url TEXT DEFAULT NULL, media_mime_type TEXT DEFAULT NULL,
      media_size INTEGER DEFAULT 0, media_width INTEGER DEFAULT 0, media_height INTEGER DEFAULT 0,
      media_duration INTEGER DEFAULT 0, media_thumbnail TEXT DEFAULT NULL,
      file_name TEXT DEFAULT NULL, caption TEXT DEFAULT NULL, forwarded INTEGER DEFAULT 0,
      replied_to_id TEXT DEFAULT NULL, is_pinned INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0,
      deleted_for TEXT DEFAULT NULL, deleted_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS channel_message_reads (
      message_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS community_join_requests (
      id TEXT PRIMARY KEY, community_id TEXT NOT NULL, user_id TEXT NOT NULL,
      message TEXT DEFAULT NULL, status TEXT DEFAULT 'pending', reviewed_by TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, call_type TEXT NOT NULL, call_mode TEXT DEFAULT 'private',
      caller_id TEXT NOT NULL, status TEXT DEFAULT 'ringing', started_at TEXT,
      ended_at TEXT DEFAULT NULL, duration INTEGER DEFAULT 0,
      community_id TEXT DEFAULT NULL, channel_id TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS call_participants (
      call_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'participant',
      joined_at TEXT DEFAULT (datetime('now')), left_at TEXT DEFAULT NULL,
      PRIMARY KEY (call_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS call_signals (
      id TEXT PRIMARY KEY, call_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      target_id TEXT DEFAULT NULL, signal_type TEXT NOT NULL, sdp TEXT DEFAULT NULL,
      candidate TEXT DEFAULT NULL, created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now', '+60 seconds'))
    );
  `);
  console.log('  ✅ Tablas creadas');

  // Limpiar datos existentes
  console.log('🧹 Limpiando datos existentes...');
  db.exec(`
    DELETE FROM call_signals;
    DELETE FROM call_participants;
    DELETE FROM calls;
    DELETE FROM community_join_requests;
    DELETE FROM channel_message_reads;
    DELETE FROM channel_messages;
    DELETE FROM channel_members;
    DELETE FROM channels;
    DELETE FROM community_roles;
    DELETE FROM community_members;
    DELETE FROM communities;
    DELETE FROM status_replies;
    DELETE FROM status_views;
    DELETE FROM user_status;
    DELETE FROM group_message_reads;
    DELETE FROM group_messages;
    DELETE FROM group_members;
    DELETE FROM groups;
    DELETE FROM message_reads;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM contacts;
    DELETE FROM users;
  `);

  // =============================================
  // CREAR USUARIOS DE PRUEBA
  // =============================================
  console.log('👥 Creando usuarios de prueba...');

  const saltRounds = 12;
  const users = [
    {
      id: uuidv4(),
      email: 'juan.perez@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'Juan Pérez',
      username: 'juanperez',
      phone: '+52 555 1001',
      about: '¡Hola! Soy Juan, desarrollador full-stack 🚀'
    },
    {
      id: uuidv4(),
      email: 'maria.garcia@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'María García',
      username: 'mariagarcia',
      phone: '+52 555 1002',
      about: 'Diseñadora UX/UI | Amante del café ☕'
    },
    {
      id: uuidv4(),
      email: 'carlos.lopez@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'Carlos López',
      username: 'carloslopez',
      phone: '+52 555 1003',
      about: '🎵 Músico | 🎸 Guitarrista | Civis fan'
    },
    {
      id: uuidv4(),
      email: 'ana.martinez@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'Ana Martínez',
      username: 'anamartinez',
      phone: '+52 555 1004',
      about: '📸 Fotógrafa | Viajera incansable ✈️'
    },
    {
      id: uuidv4(),
      email: 'pedro.sanchez@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'Pedro Sánchez',
      username: 'pedrosanchez',
      phone: '+52 555 1005',
      about: '🍳 Chef | Comida mexicana 🌮'
    },
    {
      id: uuidv4(),
      email: 'laura.torres@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'Laura Torres',
      username: 'lauratorres',
      phone: '+52 555 1006',
      about: '📚 Medico | Vida sana y fitness 💪'
    },
    {
      id: uuidv4(),
      email: 'diego.ramirez@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'Diego Ramírez',
      username: 'diegoramirez',
      phone: '+52 555 1007',
      about: '🎮 Gamer | Desarrollador de videojuegos'
    },
    {
      id: uuidv4(),
      email: 'sofia.hernandez@civis.app',
      password: await bcrypt.hash('123456', saltRounds),
      display_name: 'Sofía Hernández',
      username: 'sofiahernandez',
      phone: '+52 555 1008',
      about: '🎨 Artista digital | Creatividad sin límites'
    }
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password, display_name, username, phone, about)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const user of users) {
    insertUser.run(user.id, user.email, user.password, user.display_name, user.username, user.phone, user.about);
  }

  console.log(`  ✅ ${users.length} usuarios creados`);

  // =============================================
  // CREAR CONTACTOS (red social entre usuarios)
  // =============================================
  console.log('🤝 Creando contactos...');

  const insertContact = db.prepare(`
    INSERT INTO contacts (user_id, contact_id) VALUES (?, ?)
  `);

  // Juan es contacto de todos
  for (let i = 1; i < users.length; i++) {
    insertContact.run(users[0].id, users[i].id);
    insertContact.run(users[i].id, users[0].id);
  }

  // María es contacto de Ana, Laura y Sofía
  const mariaContacts = [3, 5, 7];
  for (const idx of mariaContacts) {
    insertContact.run(users[1].id, users[idx].id);
    insertContact.run(users[idx].id, users[1].id);
  }

  // Carlos es contacto de Diego y Pedro
  const carlosContacts = [4, 6];
  for (const idx of carlosContacts) {
    insertContact.run(users[2].id, users[idx].id);
    insertContact.run(users[idx].id, users[2].id);
  }

  const contactCount = db.prepare('SELECT COUNT(*) as count FROM contacts').get().count;
  console.log(`  ✅ ${contactCount} relaciones de contacto creadas`);

  // =============================================
  // CREAR CONVERSACIONES CON MENSAJES
  // =============================================
  console.log('💬 Creando conversaciones y mensajes...');

  const sampleMessages = [
    '¡Hola! ¿Cómo estás? 😊',
    'Todo bien, gracias. ¿Y tú?',
    '¡Genial! ¿Viste el nuevo mensaje del equipo?',
    'Sí, estamos en la fase de pruebas 🚀',
    '¡Excelente noticia! Me alegra mucho',
    '¿Nos vemos mañana para el café?',
    '¡Claro! A las 10:00 en la oficina ☕',
    'Perfecto, ahí estaré. ¿Traigo algo?',
    'Si quieres unas galletas estaría genial 🍪',
    '¡Hecho! Nos vemos luego',
    '¿Puedes enviarme el documento por favor?',
    'Claro, te lo envío ahora mismo',
    '¡Gracias! Eres el mejor',
    'De nada 😄 Para eso estamos',
    'Oye, ¿viste la película que salió?',
    'Sí, está increíble. Debes verla 🎬',
  ];

  function createConversation(user1Id, user2Id, messageCount) {
    const userIds = [user1Id, user2Id].sort();
    const convId = uuidv4();

    db.prepare('INSERT INTO conversations (id, user1_id, user2_id) VALUES (?, ?, ?)').run(convId, userIds[0], userIds[1]);

    const insertMsg = db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, status)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < messageCount; i++) {
      const msgId = uuidv4();
      const sender = i % 2 === 0 ? user1Id : user2Id;
      const content = sampleMessages[i % sampleMessages.length];
      insertMsg.run(msgId, convId, sender, content, i < messageCount - 1 ? 'read' : 'delivered');
    }

    // Actualizar último mensaje
    const lastMsg = sampleMessages[(messageCount - 1) % sampleMessages.length];
    const lastSender = (messageCount - 1) % 2 === 0 ? user1Id : user2Id;
    db.prepare(`
      UPDATE conversations SET 
        last_message_preview = ?,
        last_message_type = 'text',
        last_message_sender_id = ?,
        last_message_at = datetime('now', '-${messageCount} minutes')
      WHERE id = ?
    `).run(lastMsg.substring(0, 50), lastSender, convId);

    return convId;
  }

  // Conversación Juan - María (15 mensajes)
  createConversation(users[0].id, users[1].id, 15);
  // Conversación Juan - Carlos (8 mensajes)
  createConversation(users[0].id, users[2].id, 8);
  // Conversación Juan - Ana (12 mensajes)
  createConversation(users[0].id, users[3].id, 12);
  // Conversación María - Ana (6 mensajes)
  createConversation(users[1].id, users[3].id, 6);
  // Conversación Carlos - Diego (10 mensajes)
  createConversation(users[2].id, users[6].id, 10);
  // Conversación Ana - Sofía (5 mensajes)
  createConversation(users[3].id, users[7].id, 5);
  // Conversación Pedro - Laura (7 mensajes)
  createConversation(users[4].id, users[5].id, 7);

  const convCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
  const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  console.log(`  ✅ ${convCount} conversaciones creadas con ${msgCount} mensajes`);

  // =============================================
  // CREAR GRUPOS
  // =============================================
  console.log('👥 Creando grupos...');

  const groups = [
    {
      name: '🚀 Equipo Civis Dev',
      description: 'Grupo de desarrollo del proyecto Civis',
      created_by_idx: 0,
      member_indices: [1, 2, 5, 6],
      messages: [
        { sender_idx: 0, content: '¡Bienvenidos al grupo de desarrollo de Civis! 🎉' },
        { sender_idx: 1, content: '¡Genial! Estoy emocionada por el proyecto 💪' },
        { sender_idx: 2, content: 'Yo me encargo de la parte de audio 🎵' },
        { sender_idx: 5, content: 'Perfecto, yo puedo ayudar con la parte médica si se necesita integración' },
        { sender_idx: 6, content: '¡Yo me apunto! Puedo hacer la parte de gaming 🎮' },
        { sender_idx: 0, content: 'Excelente equipo. Empecemos esta semana con la fase 1' },
      ]
    },
    {
      name: '🎨 Amigos del Arte',
      description: 'Compartimos arte y creatividad',
      created_by_idx: 7,
      member_indices: [1, 3, 4],
      messages: [
        { sender_idx: 7, content: '¡Hola a todos! Este grupo es para compartir arte 🎨' },
        { sender_idx: 3, content: '¡Me encanta la idea! Acabo de tomar unas fotos increíbles 📸' },
        { sender_idx: 1, content: 'Yo puedo compartir diseños que he hecho' },
        { sender_idx: 4, content: 'El arte culinario también cuenta, ¿verdad? 🍝' },
      ]
    },
    {
      name: '⚽ Liga Civis',
      description: 'Organización de partidos de fútbol',
      created_by_idx: 2,
      member_indices: [0, 4, 6],
      messages: [
        { sender_idx: 2, content: '¿Quién va al partido de este sábado? ⚽' },
        { sender_idx: 0, content: '¡Yo voy! Necesito práctica 😅' },
        { sender_idx: 4, content: 'Cuenta conmigo. Haré los tacos para después 🌮' },
        { sender_idx: 6, content: 'Vamos a ganar esta vez 🏆' },
        { sender_idx: 2, content: 'Perfecto, nos vemos a las 10:00 en el campo' },
      ]
    }
  ];

  for (const groupData of groups) {
    const groupId = uuidv4();
    db.prepare(`
      INSERT INTO groups (id, name, description, created_by) VALUES (?, ?, ?, ?)
    `).run(groupId, groupData.name, groupData.description, users[groupData.created_by_idx].id);

    // Creador como admin
    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, users[groupData.created_by_idx].id, 'admin');

    // Miembros
    for (const idx of groupData.member_indices) {
      db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, users[idx].id, 'member');
    }

    // Mensajes del grupo
    for (let i = 0; i < groupData.messages.length; i++) {
      const msgData = groupData.messages[i];
      const msgId = uuidv4();
      db.prepare(`
        INSERT INTO group_messages (id, group_id, sender_id, content)
        VALUES (?, ?, ?, ?)
      `).run(msgId, groupId, users[msgData.sender_idx].id, msgData.content);
    }

    db.prepare("UPDATE groups SET updated_at = datetime('now') WHERE id = ?").run(groupId);
  }

  const groupCount = db.prepare('SELECT COUNT(*) as count FROM groups').get().count;
  const groupMsgCount = db.prepare('SELECT COUNT(*) as count FROM group_messages').get().count;
  console.log(`  ✅ ${groupCount} grupos creados con ${groupMsgCount} mensajes`);

  // =============================================
  // CREAR COMUNIDADES Y CANALES
  // =============================================
  console.log('🏗️  Creando comunidades y canales...');

  const communitiesData = [
    {
      name: '🌐 Civis Developer Hub',
      description: 'Comunidad oficial de desarrolladores de Civis',
      is_public: 1,
      created_by_idx: 0,
      member_indices: [1, 2, 5, 6, 7],
      channels: [
        { name: 'General', description: 'Discusión general', type: 'text', default: true, sort: 0 },
        { name: '📢 Anuncios', description: 'Anuncios oficiales', type: 'announcement', default: false, sort: 1 },
        { name: '🐛 Bugs', description: 'Reportar bugs', type: 'text', default: false, sort: 2 },
        { name: '💡 Ideas', description: 'Propuestas de features', type: 'text', default: false, sort: 3 },
        { name: '🎤 Voice Chat', description: 'Canal de voz', type: 'voice', default: false, sort: 4 },
      ],
      messages: [
        { channel: 'General', sender: 0, content: '¡Bienvenidos a la comunidad de Civis Dev! 🎉' },
        { channel: 'General', sender: 1, content: '¡Genial! Estoy emocionada de estar aquí' },
        { channel: 'General', sender: 2, content: '¿Alguien ha probado la nueva feature de canales?' },
        { channel: '📢 Anuncios', sender: 0, content: '📢 Nueva versión 2.0 disponible: Comunidades, canales y videollamadas' },
        { channel: '🐛 Bugs', sender: 6, content: 'Encontré un bug en la notificación de mensajes grupales' },
        { channel: '💡 Ideas', sender: 5, content: 'Sería genial tener reacciones con emoji en los mensajes' },
        { channel: '💡 Ideas', sender: 7, content: '+1, y también stickers personalizados' },
      ]
    },
    {
      name: '🎮 Gamers MX',
      description: 'Comunidad de gamers mexicanos',
      is_public: 1,
      created_by_idx: 6,
      member_indices: [0, 2, 4],
      channels: [
        { name: 'General', type: 'text', default: true, sort: 0 },
        { name: '📢 Eventos', type: 'announcement', default: false, sort: 1 },
        { name: '💬 LFG', type: 'text', default: false, sort: 2 },
        { name: '🎤 Chat de voz', type: 'voice', default: false, sort: 3 },
      ],
      messages: [
        { channel: 'General', sender: 6, content: '¡Bienvenidos a Gamers MX! 🎮🔥' },
        { channel: 'General', sender: 0, content: '¿Quién para ranked esta noche?' },
        { channel: '💬 LFG', sender: 2, content: 'Busco squad para Valorant, rank inmortal+' },
        { channel: '📢 Eventos', sender: 6, content: '📢 Torneo de Civis Gaming este sábado 8pm' },
      ]
    }
  ];

  const addCommunityMember = db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)');
  const addChannelMember = db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)');
  const insertChannelMsg = db.prepare(`INSERT INTO channel_messages (id, channel_id, sender_id, content) VALUES (?, ?, ?, ?)`);

  for (const com of communitiesData) {
    const comId = uuidv4();
    db.prepare(`
      INSERT INTO communities (id, name, description, created_by, is_public)
      VALUES (?, ?, ?, ?, ?)
    `).run(comId, com.name, com.description, users[com.created_by_idx].id, com.is_public);

    addCommunityMember.run(comId, users[com.created_by_idx].id, 'owner');

    const channelMap = {};
    for (const ch of com.channels) {
      const chId = uuidv4();
      channelMap[ch.name] = chId;
      db.prepare(`
        INSERT INTO channels (id, community_id, name, description, channel_type, sort_order, is_default, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(chId, comId, ch.name, ch.description || null, ch.type, ch.sort, ch.default ? 1 : 0, users[com.created_by_idx].id);
    }

    for (const mIdx of com.member_indices) {
      addCommunityMember.run(comId, users[mIdx].id, 'member');
      for (const chId of Object.values(channelMap)) {
        addChannelMember.run(chId, users[mIdx].id);
      }
    }

    for (const msg of com.messages) {
      const msgId = uuidv4();
      insertChannelMsg.run(msgId, channelMap[msg.channel], users[msg.sender].id, msg.content);
    }
  }

  const comCount = db.prepare('SELECT COUNT(*) as count FROM communities').get().count;
  const chCount = db.prepare('SELECT COUNT(*) as count FROM channels').get().count;
  const chMsgCount = db.prepare('SELECT COUNT(*) as count FROM channel_messages').get().count;
  console.log(`  ✅ ${comCount} comunidades, ${chCount} canales, ${chMsgCount} mensajes de canal`);

  // =============================================
  // CREAR ESTADOS/ESTORIES
  // =============================================
  console.log('📱 Creando estados...');

  const sampleStatuses = [
    { user_idx: 0, content: '¡Trabajando en Civis! 🚀', background_color: '#1DA1F2' },
    { user_idx: 1, content: 'Día de diseño ✨', background_color: '#E91E63' },
    { user_idx: 3, content: 'Nueva foto espectacular 📸', background_color: '#4CAF50' },
    { user_idx: 7, content: 'Nuevo arte digital 🎨', background_color: '#FF9800' },
    { user_idx: 4, content: 'Receta del día: Tacos al pastor 🌮', background_color: '#F44336' },
  ];

  for (const status of sampleStatuses) {
    const statusId = uuidv4();
    db.prepare(`
      INSERT INTO user_status (id, user_id, content_type, content, background_color, expires_at)
      VALUES (?, ?, 'text', ?, ?, datetime('now', '+24 hours'))
    `).run(statusId, users[status.user_idx].id, status.content, status.background_color);
  }

  const statusCount = db.prepare('SELECT COUNT(*) as count FROM user_status').get().count;
  console.log(`  ✅ ${statusCount} estados creados`);

  // =============================================
  // RESUMEN FINAL
  // =============================================
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Seed completado exitosamente');
  console.log('='.repeat(60));
  console.log('\n📊 RESUMEN DE DATOS:');
  console.log(`  👥 Usuarios:       ${users.length}`);
  console.log(`  🤝 Contactos:      ${contactCount}`);
  console.log(`  💬 Conversaciones: ${convCount}`);
  console.log(`  📨 Mensajes:       ${msgCount}`);
  console.log(`  👥 Grupos:         ${groupCount}`);
  console.log(`  📨 Mensajes grupo: ${groupMsgCount}`);
  console.log(`  🏗️  Comunidades:    ${comCount}`);
  console.log(`  📢 Canales:        ${chCount}`);
  console.log(`  📨 Msg. canales:   ${chMsgCount}`);
  console.log(`  📱 Estados:        ${statusCount}`);

  console.log('\n🔑 CREDENCIALES DE PRUEBA (todas con contraseña: 123456):');
  console.log('-'.repeat(60));
  for (const user of users) {
    console.log(`  📧 ${user.email}`);
    console.log(`     👤 @${user.username} - ${user.display_name}`);
    console.log(`     📱 ${user.phone}`);
  }

  console.log('\n🚀 ¡Servidor listo para probar!');
  console.log('   Inicia el servidor con: npm run dev');
  console.log('   Los endpoints están en: http://localhost:3001/api\n');

  db.close();
}

seed().catch(err => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
