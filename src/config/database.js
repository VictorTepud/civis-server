const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'civis.db');

let db;

function initDatabase() {
  // Asegurar que el directorio existe
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Configuración de rendimiento de SQLite
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('busy_timeout = 5000');

  // Crear tablas
  createTables();

  return db;
}

function createTables() {
  db.exec(`
    -- ============================================================
    -- TABLA: users - Usuarios del sistema
    -- ============================================================
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT UNIQUE,
      username TEXT UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      avatar TEXT DEFAULT NULL,
      about TEXT DEFAULT '¡Hola! Estoy usando Civis',
      privacy_profile_photo INTEGER DEFAULT 0, -- 0=todos, 1=contactos, 2=nadie
      privacy_about INTEGER DEFAULT 0,
      privacy_last_seen INTEGER DEFAULT 0,
      privacy_status INTEGER DEFAULT 0,
      is_online INTEGER DEFAULT 0,
      last_seen TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- TABLA: contacts - Contactos del usuario
    -- ============================================================
    CREATE TABLE IF NOT EXISTS contacts (
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      nickname TEXT DEFAULT NULL,
      blocked INTEGER DEFAULT 0,
      muted INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, contact_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE,
      CHECK (user_id != contact_id)
    );

    -- ============================================================
    -- TABLA: conversations - Conversaciones individuales
    -- ============================================================
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      last_message_id TEXT DEFAULT NULL,
      last_message_preview TEXT DEFAULT NULL,
      last_message_type TEXT DEFAULT 'text',
      last_message_sender_id TEXT DEFAULT NULL,
      last_message_at TEXT DEFAULT NULL,
      unread_count_user1 INTEGER DEFAULT 0,
      unread_count_user2 INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (user1_id, user2_id),
      CHECK (user1_id != user2_id)
    );

    -- ============================================================
    -- TABLA: messages - Mensajes de conversaciones individuales
    -- ============================================================
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT DEFAULT NULL,
      message_type TEXT DEFAULT 'text', -- text, image, video, audio, document, location, contact, sticker
      media_url TEXT DEFAULT NULL,
      media_mime_type TEXT DEFAULT NULL,
      media_size INTEGER DEFAULT 0,
      media_width INTEGER DEFAULT 0,
      media_height INTEGER DEFAULT 0,
      media_duration INTEGER DEFAULT 0, -- duración en segundos para audio/video
      media_thumbnail TEXT DEFAULT NULL,
      file_name TEXT DEFAULT NULL,
      caption TEXT DEFAULT NULL,
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL,
      location_name TEXT DEFAULT NULL,
      forwarded INTEGER DEFAULT 0,
      replied_to_id TEXT DEFAULT NULL,
      status TEXT DEFAULT 'sent', -- sent, delivered, read
      is_deleted INTEGER DEFAULT 0, -- 0=normal, 1=eliminado para mí, 2=eliminado para todos
      deleted_for TEXT DEFAULT NULL, -- JSON array de user IDs para soft delete
      deleted_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: message_reads - Control de mensajes leídos
    -- ============================================================
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: groups - Grupos de chat
    -- ============================================================
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      created_by TEXT NOT NULL,
      is_restricted INTEGER DEFAULT 0, -- solo admins pueden enviar mensajes
      max_members INTEGER DEFAULT 1024,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: group_members - Miembros de un grupo
    -- ============================================================
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member', -- admin, member
      nickname TEXT DEFAULT NULL,
      muted INTEGER DEFAULT 0,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: group_messages - Mensajes de grupos
    -- ============================================================
    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT DEFAULT NULL,
      message_type TEXT DEFAULT 'text',
      media_url TEXT DEFAULT NULL,
      media_mime_type TEXT DEFAULT NULL,
      media_size INTEGER DEFAULT 0,
      media_width INTEGER DEFAULT 0,
      media_height INTEGER DEFAULT 0,
      media_duration INTEGER DEFAULT 0,
      media_thumbnail TEXT DEFAULT NULL,
      file_name TEXT DEFAULT NULL,
      caption TEXT DEFAULT NULL,
      forwarded INTEGER DEFAULT 0,
      replied_to_id TEXT DEFAULT NULL,
      is_deleted INTEGER DEFAULT 0,
      deleted_for TEXT DEFAULT NULL,
      deleted_at TEXT DEFAULT NULL,
      sender_deleted INTEGER DEFAULT 0, -- si el remitente borró el mensaje
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: group_message_reads - Lectura de mensajes de grupo
    -- ============================================================
    CREATE TABLE IF NOT EXISTS group_message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: user_status - Estados/Estories de usuarios
    -- ============================================================
    CREATE TABLE IF NOT EXISTS user_status (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content_type TEXT DEFAULT 'text', -- text, image, video
      content TEXT DEFAULT NULL,
      background_color TEXT DEFAULT '#1DA1F2',
      media_url TEXT DEFAULT NULL,
      media_thumbnail TEXT DEFAULT NULL,
      font_type TEXT DEFAULT 'default',
      views_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now', '+24 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: status_views - Vistas de estados
    -- ============================================================
    CREATE TABLE IF NOT EXISTS status_views (
      status_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      viewed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (status_id, viewer_id),
      FOREIGN KEY (status_id) REFERENCES user_status(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: status_replies - Respuestas a estados
    -- ============================================================
    CREATE TABLE IF NOT EXISTS status_replies (
      id TEXT PRIMARY KEY,
      status_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (status_id) REFERENCES user_status(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: communities - Comunidades (paraguas de canales)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      cover_image TEXT DEFAULT NULL,
      created_by TEXT NOT NULL,
      is_public INTEGER DEFAULT 0,           -- 0=privada (solo invitación), 1=pública (cualquiera puede pedir unirse)
      approve_members INTEGER DEFAULT 0,      -- 0=entrada libre, 1=solicitan y admin aprueba
      max_members INTEGER DEFAULT 50000,
      allow_member_invite INTEGER DEFAULT 1,  -- miembros pueden invitar
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: community_members - Miembros de comunidad
    -- ============================================================
    CREATE TABLE IF NOT EXISTS community_members (
      community_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',             -- owner, admin, moderator, member
      muted INTEGER DEFAULT 0,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (community_id, user_id),
      FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: community_roles - Roles personalizados por comunidad
    -- ============================================================
    CREATE TABLE IF NOT EXISTS community_roles (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#1DA1F2',
      permissions TEXT DEFAULT '{}',           -- JSON: can_manage_channels, can_manage_members, etc.
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: channels - Canales dentro de una comunidad
    -- ============================================================
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      channel_type TEXT DEFAULT 'text',        -- text, announcement (solo admins), voice, media
      sort_order INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,            -- canal general por defecto
      created_by TEXT NOT NULL,
      last_message_preview TEXT DEFAULT NULL,
      last_message_type TEXT DEFAULT 'text',
      last_message_sender_id TEXT DEFAULT NULL,
      last_message_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: channel_members - Miembros de un canal
    -- ============================================================
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      unread_count INTEGER DEFAULT 0,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: channel_messages - Mensajes de canales
    -- ============================================================
    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT DEFAULT NULL,
      message_type TEXT DEFAULT 'text',
      media_url TEXT DEFAULT NULL,
      media_mime_type TEXT DEFAULT NULL,
      media_size INTEGER DEFAULT 0,
      media_width INTEGER DEFAULT 0,
      media_height INTEGER DEFAULT 0,
      media_duration INTEGER DEFAULT 0,
      media_thumbnail TEXT DEFAULT NULL,
      file_name TEXT DEFAULT NULL,
      caption TEXT DEFAULT NULL,
      forwarded INTEGER DEFAULT 0,
      replied_to_id TEXT DEFAULT NULL,
      is_pinned INTEGER DEFAULT 0,             -- mensaje fijado
      is_deleted INTEGER DEFAULT 0,
      deleted_for TEXT DEFAULT NULL,
      deleted_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: channel_message_reads - Lectura de mensajes de canal
    -- ============================================================
    CREATE TABLE IF NOT EXISTS channel_message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES channel_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: community_join_requests - Solicitudes para unirse
    -- ============================================================
    CREATE TABLE IF NOT EXISTS community_join_requests (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT DEFAULT NULL,
      status TEXT DEFAULT 'pending',          -- pending, approved, rejected
      reviewed_by TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT DEFAULT NULL,
      FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- ============================================================
    -- TABLA: calls - Registro de llamadas (señalización + historial)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      call_type TEXT NOT NULL,                 -- audio, video
      call_mode TEXT DEFAULT 'private',        -- private, group
      caller_id TEXT NOT NULL,
      status TEXT DEFAULT 'ringing',           -- ringing, connected, ended, missed, rejected
      started_at TEXT,
      ended_at TEXT DEFAULT NULL,
      duration INTEGER DEFAULT 0,              -- duración en segundos
      community_id TEXT DEFAULT NULL,          -- si es llamada grupal dentro de una comunidad
      channel_id TEXT DEFAULT NULL,            -- si es llamada de canal de voz
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
    );

    -- ============================================================
    -- TABLA: call_participants - Participantes de una llamada
    -- ============================================================
    CREATE TABLE IF NOT EXISTS call_participants (
      call_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'participant',         -- caller, participant
      joined_at TEXT DEFAULT (datetime('now')),
      left_at TEXT DEFAULT NULL,
      PRIMARY KEY (call_id, user_id),
      FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- TABLA: call_signals - Señales WebRTC almacenadas temporalmente
    -- ============================================================
    CREATE TABLE IF NOT EXISTS call_signals (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      target_id TEXT DEFAULT NULL,             -- NULL = broadcast a todos los participantes
      signal_type TEXT NOT NULL,               -- offer, answer, ice-candidate, leave
      sdp TEXT DEFAULT NULL,
      candidate TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now', '+60 seconds')),
      FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- ============================================================
    -- ÍNDICES para optimizar consultas
    -- ============================================================
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations(user1_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations(user2_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_contact ON contacts(contact_id);
    CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_user_status_user ON user_status(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_status_expires ON user_status(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_users_online ON users(is_online);
    CREATE INDEX IF NOT EXISTS idx_communities_created ON communities(created_by);
    CREATE INDEX IF NOT EXISTS idx_communities_public ON communities(is_public);
    CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_community_members_community ON community_members(community_id);
    CREATE INDEX IF NOT EXISTS idx_channels_community ON channels(community_id);
    CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_channel_messages_sender ON channel_messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
    CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_call_participants_call ON call_participants(call_id);
    CREATE INDEX IF NOT EXISTS idx_call_signals_call ON call_signals(call_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_call_signals_target ON call_signals(target_id);
    CREATE INDEX IF NOT EXISTS idx_community_join_requests ON community_join_requests(community_id, status);
  `);

  // Migraciones seguras: agregar columnas que no existen
  try {
    db.prepare('SELECT fcm_token FROM users LIMIT 0').get();
  } catch (e) {
    db.exec('ALTER TABLE users ADD COLUMN fcm_token TEXT DEFAULT NULL');
    console.log('  ✅ Columna fcm_token agregada a users');
  }

  console.log('  ✅ Todas las tablas e índices creados');
}

function getDb() {
  if (!db) {
    throw new Error('La base de datos no ha sido inicializada. Llama a initDatabase() primero.');
  }
  return db;
}

module.exports = { initDatabase, getDb };
