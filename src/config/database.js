const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/civis.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    avatar TEXT,
    bio TEXT,
    privacy_settings TEXT DEFAULT '{}',
    online INTEGER DEFAULT 0,
    last_seen TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    nickname TEXT,
    blocked INTEGER DEFAULT 0,
    muted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, contact_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    receiver_id TEXT,
    group_id TEXT,
    content TEXT,
    message_type TEXT DEFAULT 'text',
    media_url TEXT,
    location_lat REAL,
    location_lng REAL,
    reply_to TEXT,
    forwarded INTEGER DEFAULT 0,
    read INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT DEFAULT 'private',
    name TEXT,
    avatar TEXT,
    created_by TEXT,
    last_message TEXT,
    last_message_time TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    last_read_message_id TEXT,
    muted INTEGER DEFAULT 0,
    role TEXT DEFAULT 'member',
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    created_by TEXT NOT NULL,
    settings TEXT DEFAULT '{"restricted":false}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    muted INTEGER DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS statuses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    content TEXT NOT NULL,
    media_url TEXT,
    background_color TEXT,
    viewers TEXT DEFAULT '[]',
    replies TEXT DEFAULT '[]',
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS communities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    cover TEXT,
    created_by TEXT NOT NULL,
    settings TEXT DEFAULT '{"join_approval":false}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS community_members (
    community_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (community_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS community_channels (
    id TEXT PRIMARY KEY,
    community_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'text',
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS channel_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT,
    message_type TEXT DEFAULT 'text',
    media_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    type TEXT DEFAULT 'private',
    caller_id TEXT NOT NULL,
    receiver_id TEXT,
    group_id TEXT,
    status TEXT DEFAULT 'ringing',
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    duration INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS call_participants (
    call_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (call_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS call_signals (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    signal_data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS join_requests (
    id TEXT PRIMARY KEY,
    community_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    multiple INTEGER DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    message_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    id TEXT PRIMARY KEY,
    poll_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(poll_id, user_id, option_index)
  );
`);

// Create indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_contact_id ON contacts(contact_id);
  CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_community_members_community_id ON community_members(community_id);
  CREATE INDEX IF NOT EXISTS idx_community_members_user_id ON community_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_community_channels_community_id ON community_channels(community_id);
  CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_id ON channel_messages(channel_id);
  CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON calls(caller_id);
  CREATE INDEX IF NOT EXISTS idx_calls_receiver_id ON calls(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_call_signals_call_id ON call_signals(call_id);
  CREATE INDEX IF NOT EXISTS idx_statuses_user_id ON statuses(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON conversation_participants(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON conversation_participants(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON poll_votes(poll_id);
  CREATE INDEX IF NOT EXISTS idx_poll_votes_user_id ON poll_votes(user_id);
`);

module.exports = db;
