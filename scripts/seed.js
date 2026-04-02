const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Use a fresh database for seeding
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, '..', 'data', 'civis.db');

// Remove existing DB
const fs = require('fs');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('Removed existing database.');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create tables (same as config/database.js)
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
`);

console.log('Database tables created.');

// Create 8 test users
const users = [
  { email: 'carlos@civis.com', password: 'password123', name: 'Carlos Mendoza', phone: '+1-555-0101', bio: 'Developer & coffee lover' },
  { email: 'maria@civis.com', password: 'password123', name: 'María García', phone: '+1-555-0102', bio: 'Designer & artist' },
  { email: 'juan@civis.com', password: 'password123', name: 'Juan Pérez', phone: '+1-555-0103', bio: 'Musician & traveler' },
  { email: 'ana@civis.com', password: 'password123', name: 'Ana Rodríguez', phone: '+1-555-0104', bio: 'Teacher & reader' },
  { email: 'luis@civis.com', password: 'password123', name: 'Luis Fernández', phone: '+1-555-0105', bio: 'Engineer & gamer' },
  { email: 'sofia@civis.com', password: 'password123', name: 'Sofía López', phone: '+1-555-0106', bio: 'Writer & photographer' },
  { email: 'diego@civis.com', password: 'password123', name: 'Diego Martínez', phone: '+1-555-0107', bio: 'Chef & foodie' },
  { email: 'valentina@civis.com', password: 'password123', name: 'Valentina Torres', phone: '+1-555-0108', bio: 'Doctor & athlete' }
];

const insertUser = db.prepare('INSERT INTO users (id, email, password, name, phone, bio) VALUES (?, ?, ?, ?, ?, ?)');
const createdUsers = [];

const seedUsers = db.transaction(() => {
  users.forEach(u => {
    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(u.password, 10);
    insertUser.run(id, u.email, hashedPassword, u.name, u.phone, u.bio);
    createdUsers.push({ id, ...u });
  });
});
seedUsers();

console.log(`Created ${createdUsers.length} users.`);

// Create contacts between all pairs
const insertContact = db.prepare('INSERT OR IGNORE INTO contacts (id, user_id, contact_id) VALUES (?, ?, ?)');
const seedContacts = db.transaction(() => {
  for (let i = 0; i < createdUsers.length; i++) {
    for (let j = i + 1; j < createdUsers.length; j++) {
      const id1 = uuidv4();
      const id2 = uuidv4();
      insertContact.run(id1, createdUsers[i].id, createdUsers[j].id);
      insertContact.run(id2, createdUsers[j].id, createdUsers[i].id);
    }
  }
});
seedContacts();
console.log('Created contacts between all users.');

// Create conversations and messages
const insertConversation = db.prepare('INSERT INTO conversations (id, type, created_by, last_message, last_message_time) VALUES (?, ?, ?, ?, ?)');
const insertParticipant = db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)');
const insertMessage = db.prepare('INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, read) VALUES (?, ?, ?, ?, ?, ?, ?)');

const privateMessages = [
  ['Hey, how are you?', 'I\'m great, thanks! How about you?', 'Doing well! Want to grab coffee later?'],
  ['Did you see the game last night?', 'Yes! It was amazing!', 'The final play was incredible.'],
  ['Happy birthday! 🎂', 'Thank you so much! 🎉', 'Let\'s celebrate this weekend!'],
  ['Can you send me the report?', 'Sure, I\'ll email it right now.', 'Got it, thanks!'],
  ['Are you coming to the meeting?', 'Yes, I\'ll be there at 3pm.', 'Perfect, see you there.'],
  ['Check out this new restaurant!', 'Looks amazing, let\'s go Friday!', 'It\'s a date!']
];

const seedPrivateMessages = db.transaction(() => {
  for (let i = 0; i < Math.min(6, createdUsers.length - 1); i++) {
    const convId = uuidv4();
    insertConversation.run(convId, 'private', createdUsers[i].id, privateMessages[i][2], datetime_now());
    insertParticipant.run(convId, createdUsers[i].id);
    insertParticipant.run(convId, createdUsers[i + 1].id);

    privateMessages[i].forEach((content, j) => {
      const msgId = uuidv4();
      const senderId = j % 2 === 0 ? createdUsers[i].id : createdUsers[i + 1].id;
      const receiverId = j % 2 === 0 ? createdUsers[i + 1].id : createdUsers[i].id;
      insertMessage.run(msgId, convId, senderId, receiverId, content, 'text', 1);
    });
  }
});

function datetime_now() {
  return new Date().toISOString();
}

seedPrivateMessages();
console.log('Created private conversations and messages.');

// Create 3 groups with all members
const groups = [
  { name: 'Familia Cívica', description: 'Family group for everyone' },
  { name: 'Proyecto Alpha', description: 'Work project collaboration' },
  { name: 'Amigos del Deporte', description: 'Sports fans group' }
];

const insertGroup = db.prepare('INSERT INTO groups (id, name, description, created_by) VALUES (?, ?, ?, ?)');
const insertGroupMember = db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');

const seedGroups = db.transaction(() => {
  groups.forEach((g, i) => {
    const groupId = uuidv4();
    insertGroup.run(groupId, g.name, g.description, createdUsers[i].id);
    insertGroupMember.run(groupId, createdUsers[i].id, 'admin');

    createdUsers.forEach((u, j) => {
      if (j !== i) {
        insertGroupMember.run(groupId, u.id, 'member');
      }
    });

    // Create conversation for group
    const convId = uuidv4();
    insertConversation.run(convId, 'group', createdUsers[i].id, `${g.name} group created`, datetime_now());
    createdUsers.forEach(u => {
      insertParticipant.run(convId, u.id);
    });

    // Add some group messages
    const groupMessages = [
      'Welcome to ' + g.name + '!',
      'Excited to be here!',
      'This is going to be great!'
    ];
    groupMessages.forEach((content, j) => {
      const msgId = uuidv4();
      const sender = createdUsers[j % createdUsers.length];
      insertMessage.run(msgId, convId, sender.id, null, content, 'text', 1);
      // Update group_id on message
      db.prepare('UPDATE messages SET group_id = ? WHERE id = ?').run(groupId, msgId);
    });
  });
});
seedGroups();
console.log('Created 3 groups with members and messages.');

// Create statuses for several users
const statusData = [
  { userId: 0, type: 'text', content: 'Having a great day! ☀️', background_color: '#FF5722' },
  { userId: 1, type: 'text', content: 'New design coming soon 🎨', background_color: '#4CAF50' },
  { userId: 2, type: 'text', content: 'Jamming tonight! 🎸', background_color: '#2196F3' },
  { userId: 3, type: 'text', content: 'Reading a great book 📚', background_color: '#9C27B0' },
  { userId: 5, type: 'text', content: 'Beautiful sunset today 🌅', background_color: '#FF9800' }
];

const insertStatus = db.prepare('INSERT INTO statuses (id, user_id, type, content, background_color, expires_at) VALUES (?, ?, ?, ?, ?, ?)');
const seedStatuses = db.transaction(() => {
  statusData.forEach(s => {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    insertStatus.run(id, createdUsers[s.userId].id, s.type, s.content, s.background_color, expiresAt);
  });
});
seedStatuses();
console.log('Created statuses for users.');

// Create 2 communities with channels
const communities = [
  { name: 'Tech Enthusiasts', description: 'Technology discussion community' },
  { name: 'Cooking Club', description: 'Share recipes and cooking tips' }
];

const insertCommunity = db.prepare('INSERT INTO communities (id, name, description, created_by) VALUES (?, ?, ?, ?)');
const insertCommunityMember = db.prepare('INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, ?)');
const insertChannel = db.prepare('INSERT INTO community_channels (id, community_id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?, ?)');
const insertChannelMessage = db.prepare('INSERT INTO channel_messages (id, channel_id, sender_id, content) VALUES (?, ?, ?, ?)');

const seedCommunities = db.transaction(() => {
  communities.forEach((c, i) => {
    const communityId = uuidv4();
    insertCommunity.run(communityId, c.name, c.description, createdUsers[i * 2].id);
    insertCommunityMember.run(communityId, createdUsers[i * 2].id, 'owner');

    // Add some members
    createdUsers.forEach((u, j) => {
      if (j !== i * 2) {
        insertCommunityMember.run(communityId, u.id, 'member');
      }
    });

    // Create channels
    const channels = [
      { name: 'general', description: 'General discussion', type: 'text' },
      { name: 'announcements', description: 'Important announcements', type: 'announcement' }
    ];

    channels.forEach(ch => {
      const channelId = uuidv4();
      insertChannel.run(channelId, communityId, ch.name, ch.description, ch.type, createdUsers[i * 2].id);

      // Add some messages
      const messages = [
        'Welcome to ' + ch.name + '!',
        'Feel free to share your thoughts here.'
      ];
      messages.forEach((content, j) => {
        const msgId = uuidv4();
        insertChannelMessage.run(msgId, channelId, createdUsers[(i * 2 + j) % createdUsers.length].id, content);
      });
    });
  });
});
seedCommunities();
console.log('Created 2 communities with channels and messages.');

console.log('\n✅ Database seeded successfully!');
console.log(`Created:`);
console.log(`  - ${createdUsers.length} users`);
console.log(`  - ${createdUsers.length * (createdUsers.length - 1) / 2 * 2} contact relationships`);
console.log(`  - 6 private conversations with messages`);
console.log(`  - 3 groups with all members`);
console.log(`  - 5 statuses`);
console.log(`  - 2 communities with 2 channels each`);
console.log(`\nTest accounts:`);
createdUsers.forEach(u => {
  console.log(`  ${u.email} / ${u.password} (${u.name})`);
});

db.close();
