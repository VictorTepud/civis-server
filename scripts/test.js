const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const BASE_URL = 'http://localhost:3000';
let serverProcess = null;
let passed = 0;
let failed = 0;
const testResults = [];

// Test helper
async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

function runTest(name, fn) {
  return fn().then(() => {
    passed++;
    testResults.push({ name, status: 'PASSED' });
    console.log(`  ✅ PASSED: ${name}`);
  }).catch(err => {
    failed++;
    testResults.push({ name, status: 'FAILED', error: err.message });
    console.log(`  ❌ FAILED: ${name} - ${err.message}`);
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n🚀 Starting Civis Server Tests...\n');

  // Start server
  console.log('Starting server...');
  serverProcess = spawn('node', ['src/server.js'], {
    cwd: __dirname + '/..',
    stdio: 'pipe',
    env: { ...process.env, PORT: '3000' }
  });

  // Wait for server to start
  await sleep(2000);

  // Check server is running
  try {
    await request('GET', '/api/auth/verify-token');
  } catch (e) {
    console.error('Server failed to start!');
    console.error(e.message);
    serverProcess.kill();
    process.exit(1);
  }

  // ==================== AUTH TESTS ====================
  console.log('\n📋 Auth Tests:');

  // Test 1: Register new user
  await runTest('POST /api/auth/register - Register new user', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: 'test@civis.com',
      name: 'Test User',
      password: 'testpass123'
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.user);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.email, 'test@civis.com');
  });

  // Test 2: Register duplicate user
  await runTest('POST /api/auth/register - Reject duplicate email', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: 'test@civis.com',
      name: 'Test User 2',
      password: 'testpass123'
    });
    assert.strictEqual(res.status, 409);
  });

  // Test 3: Register missing fields
  await runTest('POST /api/auth/register - Reject missing fields', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: 'incomplete@civis.com'
    });
    assert.strictEqual(res.status, 400);
  });

  // Test 4: Login with valid credentials
  await runTest('POST /api/auth/login - Login successfully', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'test@civis.com',
      password: 'testpass123'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.user);
    assert.ok(res.body.token);
  });

  // Test 5: Login with wrong password
  await runTest('POST /api/auth/login - Reject wrong password', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'test@civis.com',
      password: 'wrongpassword'
    });
    assert.strictEqual(res.status, 401);
  });

  // Test 6: Login with non-existent email
  await runTest('POST /api/auth/login - Reject non-existent email', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'nonexistent@civis.com',
      password: 'password'
    });
    assert.strictEqual(res.status, 401);
  });

  // Test 7: Verify token
  let authToken;
  await runTest('GET /api/auth/verify-token - Verify valid token', async () => {
    const loginRes = await request('POST', '/api/auth/login', {
      email: 'test@civis.com',
      password: 'testpass123'
    });
    authToken = loginRes.body.token;

    const res = await request('GET', '/api/auth/verify-token', null, authToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.user);
    assert.strictEqual(res.body.user.email, 'test@civis.com');
  });

  // Test 8: Verify invalid token
  await runTest('GET /api/auth/verify-token - Reject invalid token', async () => {
    const res = await request('GET', '/api/auth/verify-token', null, 'invalid_token');
    assert.strictEqual(res.status, 401);
  });

  // Test 9: Logout
  await runTest('POST /api/auth/logout - Logout successfully', async () => {
    const res = await request('POST', '/api/auth/logout');
    assert.strictEqual(res.status, 200);
  });

  // ==================== USER TESTS ====================
  console.log('\n📋 User Tests:');

  // Get auth token for user tests
  const loginRes = await request('POST', '/api/auth/login', { email: 'carlos@civis.com', password: 'password123' });
  const userToken = loginRes.body.token;
  const userId = loginRes.body.user.id;

  // Test 10: Get profile
  await runTest('GET /api/users/profile - Get own profile', async () => {
    const res = await request('GET', '/api/users/profile', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.user);
    assert.strictEqual(res.body.user.email, 'carlos@civis.com');
  });

  // Test 11: Update profile
  await runTest('PUT /api/users/profile - Update profile', async () => {
    const res = await request('PUT', '/api/users/profile', {
      name: 'Carlos Mendoza Updated',
      bio: 'Updated bio',
      phone: '+1-555-9999'
    }, userToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.name, 'Carlos Mendoza Updated');
    assert.strictEqual(res.body.user.bio, 'Updated bio');
  });

  // Test 12: Update privacy settings
  await runTest('PUT /api/users/privacy - Update privacy settings', async () => {
    const res = await request('PUT', '/api/users/privacy', {
      privacy_settings: { show_last_seen: true, show_online: false }
    }, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.user.privacy_settings);
  });

  // Test 13: Change password
  await runTest('PUT /api/users/password - Change password', async () => {
    const res = await request('PUT', '/api/users/password', {
      old_password: 'password123',
      new_password: 'newpassword456'
    }, userToken);
    assert.strictEqual(res.status, 200);

    // Verify new password works
    const loginNew = await request('POST', '/api/auth/login', {
      email: 'carlos@civis.com',
      password: 'newpassword456'
    });
    assert.strictEqual(loginNew.status, 200);

    // Revert password
    await request('PUT', '/api/users/password', {
      old_password: 'newpassword456',
      new_password: 'password123'
    }, userToken);
  });

  // Test 14: Change password wrong old
  await runTest('PUT /api/users/password - Reject wrong old password', async () => {
    const res = await request('PUT', '/api/users/password', {
      old_password: 'wrongpassword',
      new_password: 'anotherpass'
    }, userToken);
    assert.strictEqual(res.status, 401);
  });

  // Get another user's ID
  const mariaLogin = await request('POST', '/api/auth/login', { email: 'maria@civis.com', password: 'password123' });
  const mariaId = mariaLogin.body.user.id;

  // Test 15: Get another user's profile
  await runTest('GET /api/users/:userId - Get other user profile', async () => {
    const res = await request('GET', `/api/users/${mariaId}`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.user);
    assert.strictEqual(res.body.user.name, 'María García');
    // Should not contain email for privacy
    assert.strictEqual(res.body.user.email, undefined);
  });

  // ==================== CONTACT TESTS ====================
  console.log('\n📋 Contact Tests:');

  // Login as test user for contact tests
  const testLogin = await request('POST', '/api/auth/login', { email: 'test@civis.com', password: 'testpass123' });
  const testToken = testLogin.body.token;

  // Test 16: Add contact
  await runTest('POST /api/contacts/add - Add contact', async () => {
    const res = await request('POST', '/api/contacts/add', {
      email: 'juan@civis.com'
    }, testToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.contact);
    assert.strictEqual(res.body.contact.name, 'Juan Pérez');
  });

  // Test 17: Add self as contact
  await runTest('POST /api/contacts/add - Reject adding self', async () => {
    const res = await request('POST', '/api/contacts/add', {
      email: 'test@civis.com'
    }, testToken);
    assert.strictEqual(res.status, 400);
  });

  // Test 18: Add duplicate contact
  await runTest('POST /api/contacts/add - Reject duplicate contact', async () => {
    const res = await request('POST', '/api/contacts/add', {
      email: 'juan@civis.com'
    }, testToken);
    assert.strictEqual(res.status, 409);
  });

  // Test 19: Add non-existent contact
  await runTest('POST /api/contacts/add - Reject non-existent user', async () => {
    const res = await request('POST', '/api/contacts/add', {
      email: 'nobody@civis.com'
    }, testToken);
    assert.strictEqual(res.status, 404);
  });

  // Test 20: List contacts
  await runTest('GET /api/contacts/ - List contacts', async () => {
    const res = await request('GET', '/api/contacts/', null, testToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.contacts));
    assert.ok(res.body.contacts.length > 0);
  });

  // Test 21: Block contact
  await runTest('PUT /api/contacts/:contactId/block - Block contact', async () => {
    const juanLogin = await request('POST', '/api/auth/login', { email: 'juan@civis.com', password: 'password123' });
    const juanId = juanLogin.body.user.id;

    const res = await request('PUT', `/api/contacts/${juanId}/block`, {}, testToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.blocked, true);
  });

  // Test 22: Unblock contact
  await runTest('PUT /api/contacts/:contactId/block - Unblock contact', async () => {
    const juanLogin = await request('POST', '/api/auth/login', { email: 'juan@civis.com', password: 'password123' });
    const juanId = juanLogin.body.user.id;

    const res = await request('PUT', `/api/contacts/${juanId}/block`, {}, testToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.blocked, false);
  });

  // Test 23: Mute contact
  await runTest('PUT /api/contacts/:contactId/mute - Mute contact', async () => {
    const juanLogin = await request('POST', '/api/auth/login', { email: 'juan@civis.com', password: 'password123' });
    const juanId = juanLogin.body.user.id;

    const res = await request('PUT', `/api/contacts/${juanId}/mute`, {}, testToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.muted, true);
  });

  // Test 24: Set nickname
  await runTest('PUT /api/contacts/:contactId/nickname - Set nickname', async () => {
    const juanLogin = await request('POST', '/api/auth/login', { email: 'juan@civis.com', password: 'password123' });
    const juanId = juanLogin.body.user.id;

    const res = await request('PUT', `/api/contacts/${juanId}/nickname`, {
      nickname: 'Juanito'
    }, testToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.nickname, 'Juanito');
  });

  // Test 25: Remove contact
  await runTest('DELETE /api/contacts/remove - Remove contact', async () => {
    const juanLogin = await request('POST', '/api/auth/login', { email: 'juan@civis.com', password: 'password123' });
    const juanId = juanLogin.body.user.id;

    const res = await request('DELETE', '/api/contacts/remove', {
      contactId: juanId
    }, testToken);
    assert.strictEqual(res.status, 200);
  });

  // ==================== MESSAGE TESTS ====================
  console.log('\n📋 Message Tests:');

  // Test 26: Get conversations
  await runTest('GET /api/messages/conversations - List conversations', async () => {
    const res = await request('GET', '/api/messages/conversations', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.conversations));
  });

  // Test 27: Send message
  let messageConversationId;
  await runTest('POST /api/messages/send - Send message', async () => {
    const res = await request('POST', '/api/messages/send', {
      receiver_id: mariaId,
      content: 'Hello María! This is a test message.'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.message);
    assert.strictEqual(res.body.message.content, 'Hello María! This is a test message.');
    messageConversationId = res.body.message.conversation_id;
  });

  // Test 28: Send image message
  await runTest('POST /api/messages/send - Send image message', async () => {
    const res = await request('POST', '/api/messages/send', {
      receiver_id: mariaId,
      content: null,
      message_type: 'image',
      media_url: '/uploads/media/test.jpg'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.message.message_type, 'image');
  });

  // Test 29: Get messages for conversation
  await runTest('GET /api/messages/:conversationId - Get messages', async () => {
    const res = await request('GET', `/api/messages/${messageConversationId}?limit=10&offset=0`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
    assert.ok(res.body.messages.length > 0);
  });

  // Test 30: Get messages with pagination
  await runTest('GET /api/messages/:conversationId - Paginate messages', async () => {
    const res = await request('GET', `/api/messages/${messageConversationId}?limit=1&offset=0`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.messages.length <= 1);
  });

  // Get message ID for further tests
  let messageId;
  {
    const msgs = await request('GET', `/api/messages/${messageConversationId}`, null, userToken);
    messageId = msgs.body.messages.find(m => m.content === 'Hello María! This is a test message.').id;
  }

  // Test 31: Mark message as read
  await runTest('PUT /api/messages/:messageId/read - Mark as read', async () => {
    const res = await request('PUT', `/api/messages/${messageId}/read`, {}, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 32: Reply to message
  await runTest('POST /api/messages/:messageId/reply - Reply to message', async () => {
    const res = await request('POST', `/api/messages/${messageId}/reply`, {
      content: 'This is a reply!'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.message);
    assert.strictEqual(res.body.message.reply_to, messageId);
  });

  // Test 33: Forward message
  await runTest('POST /api/messages/:messageId/forward - Forward message', async () => {
    const anaLogin = await request('POST', '/api/auth/login', { email: 'ana@civis.com', password: 'password123' });
    const anaId = anaLogin.body.user.id;

    const res = await request('POST', `/api/messages/${messageId}/forward`, {
      receiver_id: anaId
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.message);
    assert.strictEqual(res.body.message.forwarded, 1);
  });

  // Test 34: Delete message (soft)
  await runTest('DELETE /api/messages/:messageId - Soft delete message', async () => {
    const res = await request('DELETE', `/api/messages/${messageId}`, null, userToken);
    assert.strictEqual(res.status, 200);
  });

  // ==================== GROUP TESTS ====================
  console.log('\n📋 Group Tests:');

  // Get IDs for group tests
  const luisLogin = await request('POST', '/api/auth/login', { email: 'luis@civis.com', password: 'password123' });
  const luisId = luisLogin.body.user.id;
  const sofiaLogin = await request('POST', '/api/auth/login', { email: 'sofia@civis.com', password: 'password123' });
  const sofiaId = sofiaLogin.body.user.id;

  // Test 35: Create group
  let groupId;
  await runTest('POST /api/groups/ - Create group', async () => {
    const res = await request('POST', '/api/groups/', {
      name: 'Test Group',
      description: 'A test group',
      members: [mariaId, luisId]
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.group);
    assert.strictEqual(res.body.group.name, 'Test Group');
    groupId = res.body.group.id;
  });

  // Test 36: Create group without name
  await runTest('POST /api/groups/ - Reject group without name', async () => {
    const res = await request('POST', '/api/groups/', {
      description: 'No name group'
    }, userToken);
    assert.strictEqual(res.status, 400);
  });

  // Test 37: List groups
  await runTest('GET /api/groups/ - List user groups', async () => {
    const res = await request('GET', '/api/groups/', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.groups));
    assert.ok(res.body.groups.length > 0);
  });

  // Test 38: Get group info
  await runTest('GET /api/groups/:groupId - Get group details', async () => {
    const res = await request('GET', `/api/groups/${groupId}`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.group);
    assert.ok(Array.isArray(res.body.members));
    assert.ok(res.body.members.length >= 2);
  });

  // Test 39: Update group
  await runTest('PUT /api/groups/:groupId - Update group', async () => {
    const res = await request('PUT', `/api/groups/${groupId}`, {
      name: 'Updated Test Group',
      description: 'Updated description'
    }, userToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.group.name, 'Updated Test Group');
  });

  // Test 40: Add group member
  await runTest('POST /api/groups/:groupId/members - Add member', async () => {
    const res = await request('POST', `/api/groups/${groupId}/members`, {
      members: [sofiaId]
    }, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 41: Change member role
  await runTest('PUT /api/groups/:groupId/members/:userId/role - Change role', async () => {
    const res = await request('PUT', `/api/groups/${groupId}/members/${sofiaId}/role`, {
      role: 'moderator'
    }, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 42: Remove group member
  await runTest('DELETE /api/groups/:groupId/members/:userId - Remove member', async () => {
    const res = await request('DELETE', `/api/groups/${groupId}/members/${luisId}`, null, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 43: Send group message
  await runTest('POST /api/groups/:groupId/messages - Send group message', async () => {
    const res = await request('POST', `/api/groups/${groupId}/messages`, {
      content: 'Hello group! This is a test message.'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.message);
    assert.strictEqual(res.body.message.content, 'Hello group! This is a test message.');
  });

  // Test 44: Get group messages
  await runTest('GET /api/groups/:groupId/messages - Get group messages', async () => {
    const res = await request('GET', `/api/groups/${groupId}/messages`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
  });

  // ==================== STATUS TESTS ====================
  console.log('\n📋 Status Tests:');

  // Test 45: Create text status
  let statusId;
  await runTest('POST /api/status/ - Create text status', async () => {
    const res = await request('POST', '/api/status/', {
      type: 'text',
      content: 'Testing status feature!',
      background_color: '#FF5722'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.status);
    assert.strictEqual(res.body.status.content, 'Testing status feature!');
    statusId = res.body.status.id;
  });

  // Test 46: Create status without content
  await runTest('POST /api/status/ - Reject status without content', async () => {
    const res = await request('POST', '/api/status/', {
      type: 'text'
    }, userToken);
    assert.strictEqual(res.status, 400);
  });

  // Test 47: List statuses (from contacts + own)
  await runTest('GET /api/status/ - List statuses', async () => {
    const res = await request('GET', '/api/status/', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.statuses));
  });

  // Test 48: Get own statuses
  await runTest('GET /api/status/my - List own statuses', async () => {
    const res = await request('GET', '/api/status/my', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.statuses));
    assert.ok(res.body.statuses.length > 0);
  });

  // Test 49: View status
  await runTest('POST /api/status/:statusId/view - View status', async () => {
    const res = await request('POST', `/api/status/${statusId}/view`, {}, userToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.viewed, true);
  });

  // Test 50: Reply to status
  await runTest('POST /api/status/:statusId/reply - Reply to status', async () => {
    const res = await request('POST', `/api/status/${statusId}/reply`, {
      content: 'Nice status!'
    }, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 51: Get user statuses
  await runTest('GET /api/status/user/:userId - Get user statuses', async () => {
    const res = await request('GET', `/api/status/user/${userId}`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.statuses));
  });

  // Test 52: Delete own status
  await runTest('DELETE /api/status/:statusId - Delete own status', async () => {
    const res = await request('DELETE', `/api/status/${statusId}`, null, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 53: View non-existent status
  await runTest('POST /api/status/:statusId/view - Reject non-existent status', async () => {
    const res = await request('POST', '/api/status/nonexistent/view', {}, userToken);
    assert.strictEqual(res.status, 404);
  });

  // ==================== COMMUNITY TESTS ====================
  console.log('\n📋 Community Tests:');

  // Test 54: Create community
  let communityId;
  await runTest('POST /api/communities/ - Create community', async () => {
    const res = await request('POST', '/api/communities/', {
      name: 'Test Community',
      description: 'A test community for testing'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.community);
    assert.strictEqual(res.body.community.name, 'Test Community');
    communityId = res.body.community.id;
  });

  // Test 55: Create community without name
  await runTest('POST /api/communities/ - Reject community without name', async () => {
    const res = await request('POST', '/api/communities/', {
      description: 'No name community'
    }, userToken);
    assert.strictEqual(res.status, 400);
  });

  // Test 56: List communities
  await runTest('GET /api/communities/ - List user communities', async () => {
    const res = await request('GET', '/api/communities/', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.communities));
  });

  // Test 57: Discover communities
  await runTest('GET /api/communities/discover - Discover communities', async () => {
    const res = await request('GET', '/api/communities/discover', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.communities));
  });

  // Test 58: Get community details
  await runTest('GET /api/communities/:communityId - Get community details', async () => {
    const res = await request('GET', `/api/communities/${communityId}`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.community);
    assert.ok(Array.isArray(res.body.channels));
  });

  // Test 59: Update community
  await runTest('PUT /api/communities/:communityId - Update community', async () => {
    const res = await request('PUT', `/api/communities/${communityId}`, {
      name: 'Updated Test Community',
      description: 'Updated description'
    }, userToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.community.name, 'Updated Test Community');
  });

  // Test 60: Get community members
  await runTest('GET /api/communities/:communityId/members - List members', async () => {
    const res = await request('GET', `/api/communities/${communityId}/members`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.members));
  });

  // Test 61: Create channel
  let channelId;
  await runTest('POST /api/communities/:communityId/channels - Create channel', async () => {
    const res = await request('POST', `/api/communities/${communityId}/channels`, {
      name: 'general',
      description: 'General discussion',
      type: 'text'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.channel);
    assert.strictEqual(res.body.channel.name, 'general');
    channelId = res.body.channel.id;
  });

  // Test 62: List channels
  await runTest('GET /api/communities/:communityId/channels - List channels', async () => {
    const res = await request('GET', `/api/communities/${communityId}/channels`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.channels));
  });

  // Test 63: Update channel
  await runTest('PUT /api/communities/:communityId/channels/:channelId - Update channel', async () => {
    const res = await request('PUT', `/api/communities/${communityId}/channels/${channelId}`, {
      name: 'general-updated',
      description: 'Updated general channel'
    }, userToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.channel.name, 'general-updated');
  });

  // Test 64: Send channel message
  await runTest('POST /api/communities/:communityId/channels/:channelId/messages - Send channel message', async () => {
    const res = await request('POST', `/api/communities/${communityId}/channels/${channelId}/messages`, {
      content: 'Hello channel!'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.message);
  });

  // Test 65: Get channel messages
  await runTest('GET /api/communities/:communityId/channels/:channelId/messages - Get channel messages', async () => {
    const res = await request('GET', `/api/communities/${communityId}/channels/${channelId}/messages`, null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
  });

  // Test 66: Join community (as Maria)
  await runTest('POST /api/communities/:communityId/join - Join community', async () => {
    const mariaLoginRes = await request('POST', '/api/auth/login', { email: 'maria@civis.com', password: 'password123' });
    const mariaToken = mariaLoginRes.body.token;

    const res = await request('POST', `/api/communities/${communityId}/join`, {}, mariaToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 67: Leave community
  await runTest('POST /api/communities/:communityId/leave - Leave community', async () => {
    const mariaLoginRes = await request('POST', '/api/auth/login', { email: 'maria@civis.com', password: 'password123' });
    const mariaToken = mariaLoginRes.body.token;

    const res = await request('POST', `/api/communities/${communityId}/leave`, {}, mariaToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 68: Delete channel
  await runTest('DELETE /api/communities/:communityId/channels/:channelId - Delete channel', async () => {
    const res = await request('DELETE', `/api/communities/${communityId}/channels/${channelId}`, null, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 69: Delete community
  await runTest('DELETE /api/communities/:communityId - Delete community', async () => {
    const res = await request('DELETE', `/api/communities/${communityId}`, null, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 70: Get non-existent community
  await runTest('GET /api/communities/:communityId - Reject non-existent community', async () => {
    const res = await request('GET', '/api/communities/nonexistent', null, userToken);
    assert.strictEqual(res.status, 404);
  });

  // ==================== CALL TESTS ====================
  console.log('\n📋 Call Tests:');

  // Test 71: Initiate private call
  let callId;
  await runTest('POST /api/calls/initiate - Initiate private call', async () => {
    const res = await request('POST', '/api/calls/initiate', {
      receiver_id: mariaId,
      type: 'private'
    }, userToken);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.call);
    assert.strictEqual(res.body.call.status, 'ringing');
    callId = res.body.call.id;
  });

  // Test 72: Answer call
  await runTest('POST /api/calls/:callId/answer - Answer call', async () => {
    const res = await request('POST', `/api/calls/${callId}/answer`, {}, userToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.call.status, 'ongoing');
  });

  // Test 73: End call
  await runTest('POST /api/calls/:callId/end - End call', async () => {
    const res = await request('POST', `/api/calls/${callId}/end`, {
      duration: 120
    }, userToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.call.status, 'ended');
    assert.strictEqual(res.body.call.duration, 120);
  });

  // Test 74: Initiate call without receiver
  await runTest('POST /api/calls/initiate - Reject private call without receiver', async () => {
    const res = await request('POST', '/api/calls/initiate', {
      type: 'private'
    }, userToken);
    assert.strictEqual(res.status, 400);
  });

  // Initiate another call for further tests
  let callId2;
  {
    const callRes = await request('POST', '/api/calls/initiate', { receiver_id: mariaId, type: 'private' }, userToken);
    callId2 = callRes.body.call.id;
  }

  // Test 75: Call signal
  await runTest('POST /api/calls/:callId/signal - Send call signal', async () => {
    const res = await request('POST', `/api/calls/${callId2}/signal`, {
      signal_type: 'offer',
      signal_data: '{"sdp":"test-sdp"}'
    }, userToken);
    assert.strictEqual(res.status, 200);
  });

  // Test 76: Get call history
  await runTest('GET /api/calls/history - Get call history', async () => {
    const res = await request('GET', '/api/calls/history', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.calls));
    assert.ok(res.body.calls.length >= 2);
  });

  // ==================== SEARCH TESTS ====================
  console.log('\n📋 Search Tests:');

  // Test 77: Global search
  await runTest('GET /api/search/global?q=Carlos - Global search', async () => {
    const res = await request('GET', '/api/search/global?q=Carlos', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
    assert.ok(res.body.users.length > 0);
  });

  // Test 78: Search users
  await runTest('GET /api/search/users?q=María - Search users', async () => {
    const res = await request('GET', '/api/search/users?q=María', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
  });

  // Test 79: Search messages
  await runTest('GET /api/search/messages?q=test - Search messages', async () => {
    const res = await request('GET', '/api/search/messages?q=test', null, userToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
  });

  // Test 80: Search without query
  await runTest('GET /api/search/global - Reject search without query', async () => {
    const res = await request('GET', '/api/search/global', null, userToken);
    assert.strictEqual(res.status, 400);
  });

  // ==================== SUMMARY ====================
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Test Results: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} total\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    testResults.filter(t => t.status === 'FAILED').forEach(t => {
      console.log(`  ❌ ${t.name}: ${t.error}`);
    });
    console.log('');
  }

  // Cleanup
  serverProcess.kill();
  console.log('Server stopped.');
  console.log('='.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  if (serverProcess) serverProcess.kill();
  process.exit(1);
});
