/**
 * Script de pruebas para Civis Server
 * Inicia el servidor automáticamente, ejecuta tests y se limpia
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const PROJECT_ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:3001';
let serverProcess;
let passed = 0;
let failed = 0;
const errors = [];

function request(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, raw: true }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function test(name, fn) {
  return fn().then(() => {
    passed++;
    console.log(`  ✅ ${name}`);
  }).catch(err => {
    failed++;
    errors.push({ name, error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function waitForServer(maxRetries = 20) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http.get(`${BASE}/api/health`, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { JSON.parse(d); resolve(); } catch(e) { retry(); } });
      }).on('error', retry);

      function retry() {
        attempts++;
        if (attempts >= maxRetries) { reject(new Error('Server never started')); return; }
        setTimeout(check, 300);
      }
    };
    check();
  });
}

async function main() {
  // Clean and seed
  console.log('🧹 Limpiando base de datos...');
  try {
    execSync('rm -rf ' + path.join(PROJECT_ROOT, 'data'), { stdio: 'ignore' });
    execSync('rm -rf ' + path.join(PROJECT_ROOT, 'src', 'data'), { stdio: 'ignore' });
  } catch(e) {}

  console.log('🌱 Ejecutando seed...');
  try {
    const seedOut = execSync(`node ${path.join(PROJECT_ROOT, 'scripts', 'seed.js')}`, {
      encoding: 'utf-8', cwd: PROJECT_ROOT
    });
    const lines = seedOut.trim().split('\n');
    console.log(lines[lines.length - 1]);
  } catch(e) {
    console.error('❌ Seed failed:', e.stderr || e.message);
    process.exit(1);
  }

  // Start server
  console.log('🚀 Iniciando servidor...');
  serverProcess = spawn('node', [path.join(PROJECT_ROOT, 'src', 'server.js')], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  serverProcess.stdout.on('data', d => process.stdout.write(d));
  serverProcess.stderr.on('data', d => process.stderr.write(d));

  await waitForServer();
  console.log('✅ Servidor listo\n');

  console.log('='.repeat(60));
  console.log('🧪 EJECUTANDO PRUEBAS EXHAUSTIVAS DE CIVIS');
  console.log('='.repeat(60));

  let juanToken, mariaToken, carlosToken, juanId, mariaId;

  // ==========================================
  // AUTH
  // ==========================================
  console.log('\n📦 MÓDULO: AUTENTICACIÓN');
  console.log('-'.repeat(40));

  await test('Health Check', async () => {
    const r = await request('GET', '/api/health');
    assert(r.data.status === 'ok');
  });

  await test('Login Juan Pérez', async () => {
    const r = await request('POST', '/api/auth/login', { email: 'juan.perez@civis.app', password: '123456' });
    assert(r.data.success, JSON.stringify(r.data));
    juanToken = r.data.data.token;
    juanId = r.data.data.user.id;
    assert(r.data.data.user.display_name === 'Juan Pérez');
  });

  await test('Login María García', async () => {
    const r = await request('POST', '/api/auth/login', { email: 'maria.garcia@civis.app', password: '123456' });
    assert(r.data.success);
    mariaToken = r.data.data.token;
    mariaId = r.data.data.user.id;
  });

  await test('Login Carlos López', async () => {
    const r = await request('POST', '/api/auth/login', { email: 'carlos.lopez@civis.app', password: '123456' });
    assert(r.data.success);
    carlosToken = r.data.data.token;
  });

  await test('Login con contraseña incorrecta', async () => {
    const r = await request('POST', '/api/auth/login', { email: 'juan.perez@civis.app', password: 'wrong' });
    assert(!r.data.success);
    assert(r.status === 401);
  });

  await test('Login con email inexistente', async () => {
    const r = await request('POST', '/api/auth/login', { email: 'nobody@test.com', password: '123456' });
    assert(!r.data.success);
    assert(r.status === 401);
  });

  await test('Verificar token JWT', async () => {
    const r = await request('GET', '/api/auth/verify', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.user.email === 'juan.perez@civis.app');
  });

  await test('Rechazar token inválido', async () => {
    const r = await request('GET', '/api/auth/verify', null, 'bad_token');
    assert(r.status === 401);
  });

  await test('Rechazar sin token', async () => {
    const r = await request('GET', '/api/auth/verify');
    assert(r.status === 401);
  });

  await test('Registrar nuevo usuario', async () => {
    const r = await request('POST', '/api/auth/register', {
      email: 'nuevo@civis.app',
      password: '123456',
      display_name: 'Usuario Nuevo'
    });
    assert(r.data.success);
    assert(r.data.data.token);
    assert(r.data.data.user.email === 'nuevo@civis.app');
  });

  await test('Rechazar registro duplicado', async () => {
    const r = await request('POST', '/api/auth/register', {
      email: 'juan.perez@civis.app',
      password: '123456',
      display_name: 'Duplicado'
    });
    assert(!r.data.success);
    assert(r.status === 409);
  });

  // ==========================================
  // USERS
  // ==========================================
  console.log('\n📦 MÓDULO: USUARIOS');
  console.log('-'.repeat(40));

  await test('Obtener mi perfil', async () => {
    const r = await request('GET', '/api/users/me', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.user.display_name === 'Juan Pérez');
    assert(r.data.data.user.username === 'juanperez');
  });

  await test('Actualizar perfil (nombre y about)', async () => {
    const r = await request('PUT', '/api/users/me', {
      display_name: 'Juan Pérez G.',
      about: 'Creador de Civis 🚀'
    }, juanToken);
    assert(r.data.success);
    const profile = await request('GET', '/api/users/me', null, juanToken);
    assert(profile.data.data.user.display_name === 'Juan Pérez G.');
    assert(profile.data.data.user.about === 'Creador de Civis 🚀');
  });

  await test('Buscar usuario por ID', async () => {
    const r = await request('GET', `/api/users/${mariaId}`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.user.display_name === 'María García');
  });

  await test('Actualizar privacidad', async () => {
    const r = await request('PUT', '/api/users/privacy', {
      privacy_last_seen: 1,
      privacy_profile_photo: 0
    }, juanToken);
    assert(r.data.success);
  });

  // ==========================================
  // CONTACTS
  // ==========================================
  console.log('\n📦 MÓDULO: CONTACTOS');
  console.log('-'.repeat(40));

  await test('Listar contactos de Juan', async () => {
    const r = await request('GET', '/api/contacts', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.contacts.length > 0);
    console.log(`     → ${r.data.data.contacts.length} contactos`);
  });

  await test('Verificar si es contacto', async () => {
    const r = await request('GET', `/api/contacts/${mariaId}/check`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.is_contact === true);
  });

  await test('Actualizar apodo de contacto', async () => {
    const r = await request('PUT', `/api/contacts/${mariaId}/nickname`, { nickname: 'Mari ❤️' }, juanToken);
    assert(r.data.success);
  });

  await test('Silenciar contacto', async () => {
    const r = await request('PUT', `/api/contacts/${mariaId}/mute`, { muted: true }, juanToken);
    assert(r.data.success);
  });

  // ==========================================
  // CONVERSATIONS
  // ==========================================
  console.log('\n📦 MÓDULO: CONVERSACIONES');
  console.log('-'.repeat(40));

  await test('Listar conversaciones de Juan', async () => {
    const r = await request('GET', '/api/messages/conversations', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.conversations.length > 0);
    console.log(`     → ${r.data.data.conversations.length} conversaciones`);
  });

  let convId;
  await test('Crear/obtener conversación con María', async () => {
    const r = await request('POST', '/api/messages/conversations', { other_user_id: mariaId }, juanToken);
    assert(r.data.success);
    convId = r.data.data.conversation_id;
    assert(convId);
  });

  await test('No crear conversación consigo mismo', async () => {
    const r = await request('POST', '/api/messages/conversations', { other_user_id: juanId }, juanToken);
    assert(r.status === 400);
  });

  // ==========================================
  // MESSAGES 1-TO-1
  // ==========================================
  console.log('\n📦 MÓDULO: MENSAJES 1-A-1');
  console.log('-'.repeat(40));

  let msgId;
  await test('Enviar mensaje de texto', async () => {
    const r = await request('POST', `/api/messages/conversations/${convId}/messages`, {
      content: '¡Hola María! Probando Civis 🚀',
      message_type: 'text'
    }, juanToken);
    assert(r.data.success);
    msgId = r.data.data.message.id;
    assert(msgId);
    assert(r.data.data.message.content === '¡Hola María! Probando Civis 🚀');
  });

  await test('Enviar mensaje con ubicación', async () => {
    const r = await request('POST', `/api/messages/conversations/${convId}/messages`, {
      message_type: 'location',
      latitude: 19.4326,
      longitude: -99.1332,
      location_name: 'Ciudad de México'
    }, juanToken);
    assert(r.data.success);
    assert(r.data.data.message.message_type === 'location');
  });

  await test('Enviar mensaje multimedia (simulado)', async () => {
    const r = await request('POST', `/api/messages/conversations/${convId}/messages`, {
      message_type: 'image',
      media_url: '/media/test-image.jpg',
      media_mime_type: 'image/jpeg',
      media_size: 102400,
      caption: '¡Mira esta foto!'
    }, juanToken);
    assert(r.data.success);
  });

  await test('Obtener mensajes (como María)', async () => {
    const r = await request('GET', `/api/messages/conversations/${convId}/messages`, null, mariaToken);
    assert(r.data.success);
    assert(r.data.data.messages.length >= 3);
    console.log(`     → ${r.data.data.messages.length} mensajes`);
    assert(r.data.data.pagination.has_more === false);
  });

  await test('Marcar mensajes como leídos', async () => {
    const r = await request('PUT', `/api/messages/conversations/${convId}/read`, null, mariaToken);
    assert(r.data.success);
  });

  await test('Responder a mensaje', async () => {
    const r = await request('POST', `/api/messages/conversations/${convId}/messages`, {
      content: '¡Hola Juan! Civis está increíble 😊',
      message_type: 'text',
      replied_to_id: msgId
    }, mariaToken);
    assert(r.data.success);
  });

  await test('Obtener mensaje por ID', async () => {
    const r = await request('GET', `/api/messages/messages/${msgId}`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.message.id === msgId);
  });

  await test('Eliminar mensaje para mí', async () => {
    const r = await request('DELETE', `/api/messages/messages/${msgId}`, null, juanToken);
    assert(r.data.success);
  });

  await test('Reenviar mensaje', async () => {
    // First get another conversation
    const convs = await request('GET', '/api/messages/conversations', null, juanToken);
    const otherConv = convs.data.data.conversations.find(c => c.conversation_id !== convId);
    assert(otherConv, 'Need another conversation');
    
    const r = await request('POST', `/api/messages/messages/${msgId}/forward`, {
      target_conversation_id: otherConv.conversation_id
    }, juanToken);
    assert(r.data.success);
  });

  // ==========================================
  // GROUPS
  // ==========================================
  console.log('\n📦 MÓDULO: GRUPOS');
  console.log('-'.repeat(40));

  let groupId;
  await test('Listar grupos', async () => {
    const r = await request('GET', '/api/groups', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.groups.length > 0);
    groupId = r.data.data.groups[0].id;
    console.log(`     → ${r.data.data.groups.length} grupos`);
  });

  await test('Obtener info de grupo con miembros', async () => {
    const r = await request('GET', `/api/groups/${groupId}`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.group.name);
    assert(r.data.data.members.length > 0);
    console.log(`     → ${r.data.data.group.name} (${r.data.data.members.length} miembros)`);
  });

  let newGroupId;
  await test('Crear nuevo grupo', async () => {
    const r = await request('POST', '/api/groups', {
      name: '🧪 Grupo de Pruebas Civis',
      description: 'Creado durante tests automatizados',
      member_ids: [mariaId]
    }, juanToken);
    assert(r.data.success);
    newGroupId = r.data.data.group_id;
  });

  await test('Enviar mensaje al grupo', async () => {
    const r = await request('POST', `/api/groups/${newGroupId}/messages`, {
      content: '¡Primer mensaje del grupo de pruebas! 🧪',
      message_type: 'text'
    }, juanToken);
    assert(r.data.success);
  });

  await test('María responde al grupo', async () => {
    const r = await request('POST', `/api/groups/${newGroupId}/messages`, {
      content: '¡Funciona perfecto! 👏',
      message_type: 'text'
    }, mariaToken);
    assert(r.data.success);
  });

  await test('Obtener mensajes del grupo', async () => {
    const r = await request('GET', `/api/groups/${newGroupId}/messages`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.messages.length >= 2);
    console.log(`     → ${r.data.data.messages.length} mensajes en grupo`);
  });

  await test('Silenciar grupo', async () => {
    const r = await request('PUT', `/api/groups/${newGroupId}/mute`, { muted: true }, juanToken);
    assert(r.data.success);
  });

  await test('Actualizar nombre del grupo', async () => {
    const r = await request('PUT', `/api/groups/${newGroupId}`, { name: '🧪 Tests Civis (editado)' }, juanToken);
    assert(r.data.success);
  });

  // ==========================================
  // STATUS / STORIES
  // ==========================================
  console.log('\n📦 MÓDULO: ESTADOS/ESTORIES');
  console.log('-'.repeat(40));

  let statusId;
  await test('Publicar estado de texto', async () => {
    const r = await request('POST', '/api/status', {
      content_type: 'text',
      content: '¡Probando estados en Civis! 🔥',
      background_color: '#FF5722'
    }, juanToken);
    assert(r.data.success);
    statusId = r.data.data.status_id;
  });

  await test('Ver mi estado', async () => {
    const r = await request('GET', '/api/status/my', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.statuses.length > 0);
    console.log(`     → ${r.data.data.statuses.length} estados propios`);
  });

  await test('Feed de estados', async () => {
    const r = await request('GET', '/api/status/feed', null, mariaToken);
    assert(r.data.success);
    assert(r.data.data.statuses.length > 0);
  });

  await test('María ve el estado de Juan', async () => {
    const r = await request('POST', `/api/status/${statusId}/view`, null, mariaToken);
    assert(r.data.success);
  });

  await test('Obtener vistas del estado', async () => {
    const r = await request('GET', `/api/status/${statusId}/views`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.views.length >= 1);
    console.log(`     → ${r.data.data.views.length} vistas`);
  });

  await test('Responder a estado', async () => {
    const r = await request('POST', `/api/status/${statusId}/reply`, { content: '¡Se ve genial!' }, mariaToken);
    assert(r.data.success);
  });

  await test('Eliminar estado', async () => {
    const r = await request('DELETE', `/api/status/${statusId}`, null, juanToken);
    assert(r.data.success);
  });

  // ==========================================
  // SEARCH
  // ==========================================
  console.log('\n📦 MÓDULO: BÚSQUEDA');
  console.log('-'.repeat(40));

  await test('Buscar usuarios por nombre', async () => {
    const r = await request('GET', '/api/search/users?q=mar', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.users.length > 0);
    console.log(`     → ${r.data.data.users.length} usuarios encontrados`);
  });

  await test('Buscar por username', async () => {
    const r = await request('GET', '/api/search/users?q=carlos', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.users.length > 0);
  });

  await test('Buscar mensajes', async () => {
    const r = await request('GET', '/api/search/messages?q=Civis', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.messages.length > 0);
    console.log(`     → ${r.data.data.messages.length} mensajes encontrados`);
  });

  await test('Búsqueda global', async () => {
    const r = await request('GET', '/api/search/global?q=Juan', null, mariaToken);
    assert(r.data.success);
  });

  await test('Búsqueda corta rechazada (< 2 chars)', async () => {
    const r = await request('GET', '/api/search/users?q=a', null, juanToken);
    assert(r.status === 400);
  });

  // ==========================================
  // COMMUNITIES
  // ==========================================
  console.log('\n📦 MÓDULO: COMUNIDADES');
  console.log('-'.repeat(40));

  let communityId;
  await test('Listar comunidades', async () => {
    const r = await request('GET', '/api/communities', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.communities.length > 0);
    console.log(`     → ${r.data.data.communities.length} comunidades`);
    communityId = r.data.data.communities[0].id;
  });

  let generalChannelId;
  await test('Detalle de comunidad con canales y miembros', async () => {
    const r = await request('GET', `/api/communities/${communityId}`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.channels.length > 0);
    assert(r.data.data.members.length > 0);
    console.log(`     → ${r.data.data.community.name}: ${r.data.data.channels.length} canales, ${r.data.data.members.length} miembros`);
    generalChannelId = r.data.data.channels.find(c => c.is_default_channel)?.id;
  });

  await test('Crear nueva comunidad', async () => {
    const r = await request('POST', '/api/communities', {
      name: '🧪 Comunidad de Pruebas',
      description: 'Para probar comunidades',
      is_public: true
    }, mariaToken);
    assert(r.data.success);
    assert(r.data.data.general_channel_id);
  });

  let newComId;
  await test('Crear canal de anuncios', async () => {
    const coms = await request('GET', '/api/communities', null, mariaToken);
    newComId = coms.data.data.communities.find(c => c.name.includes('Pruebas'))?.id;
    assert(newComId);

    const r = await request('POST', `/api/communities/${newComId}/channels`, {
      name: '📢 Anuncios',
      channel_type: 'announcement'
    }, mariaToken);
    assert(r.data.success);
  });

  await test('Invitar a comunidad', async () => {
    const r = await request('POST', `/api/communities/${newComId}/invite`, { user_ids: [juanId] }, mariaToken);
    assert(r.data.success);
  });

  await test('Enviar mensaje a canal', async () => {
    const detail = await request('GET', `/api/communities/${communityId}`, null, juanToken);
    const gCh = detail.data.data.channels.find(c => c.is_default_channel);
    assert(gCh);

    const r = await request('POST', `/api/communities/${communityId}/channels/${gCh.id}/messages`, {
      content: '¡Mensaje de prueba desde tests! 🧪',
      message_type: 'text'
    }, juanToken);
    assert(r.data.success);
  });

  await test('Obtener mensajes del canal', async () => {
    const detail = await request('GET', `/api/communities/${communityId}`, null, juanToken);
    const gCh = detail.data.data.channels.find(c => c.is_default_channel);
    const r = await request('GET', `/api/communities/${communityId}/channels/${gCh.id}/messages`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.messages.length > 0);
    console.log(`     → ${r.data.data.messages.length} mensajes en canal`);
  });

  await test('Fijar mensaje en canal', async () => {
    const detail = await request('GET', `/api/communities/${communityId}`, null, juanToken);
    const gCh = detail.data.data.channels.find(c => c.is_default_channel);
    const msgs = await request('GET', `/api/communities/${communityId}/channels/${gCh.id}/messages`, null, juanToken);
    const lastMsg = msgs.data.data.messages[msgs.data.data.messages.length - 1];

    const r = await request('PUT', `/api/communities/${communityId}/channels/${gCh.id}/messages/${lastMsg.id}/pin`, { is_pinned: true }, juanToken);
    assert(r.data.success);
  });

  await test('Descubrir comunidades públicas', async () => {
    const r = await request('GET', '/api/communities/discover', null, carlosToken);
    assert(r.data.success);
  });

  await test('Editar comunidad', async () => {
    const coms = await request('GET', '/api/communities', null, juanToken);
    const ownCom = coms.data.data.communities.find(c => c.my_role === 'owner');
    if (!ownCom) { console.log('     ⚠️  Sin comunidad own'); return; }
    const r = await request('PUT', `/api/communities/${ownCom.id}`, { description: 'Actualizado por tests' }, juanToken);
    assert(r.data.success);
  });

  await test('Cambiar rol de miembro', async () => {
    const coms = await request('GET', '/api/communities', null, juanToken);
    const ownCom = coms.data.data.communities.find(c => c.my_role === 'owner');
    if (!ownCom) { console.log('     ⚠️  Sin comunidad own'); return; }
    const detail = await request('GET', `/api/communities/${ownCom.id}`, null, juanToken);
    const member = detail.data.data.members.find(m => m.role === 'member');
    if (!member) { console.log('     ⚠️  Sin miembros'); return; }
    const r = await request('PUT', `/api/communities/${ownCom.id}/members/${member.user_id}/role`, { role: 'moderator' }, juanToken);
    assert(r.data.success);
  });

  // ==========================================
  // CALLS (VIDEOLLAMADAS)
  // ==========================================
  console.log('\n📦 MÓDULO: VIDEOLLAMADAS');
  console.log('-'.repeat(40));

  let callId;
  await test('Iniciar videollamada privada', async () => {
    const r = await request('POST', '/api/calls', {
      target_user_id: mariaId,
      call_type: 'video'
    }, juanToken);
    assert(r.data.success);
    callId = r.data.data.call_id;
    assert(r.data.data.call_mode === 'private');
  });

  await test('Info de llamada', async () => {
    const r = await request('GET', `/api/calls/${callId}`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.call.status === 'ringing');
    assert(r.data.data.participants.length === 2);
  });

  await test('Contestar llamada', async () => {
    const r = await request('PUT', `/api/calls/${callId}/answer`, null, mariaToken);
    assert(r.data.success);
    assert(r.data.data.status === 'connected');
  });

  await test('Enviar señal WebRTC (offer)', async () => {
    const r = await request('POST', `/api/calls/${callId}/signal`, {
      signal_type: 'offer', target_id: mariaId,
      sdp: JSON.stringify({ type: 'offer', sdp: 'mock-sdp' })
    }, juanToken);
    assert(r.data.success);
  });

  await test('Enviar señal WebRTC (answer)', async () => {
    const r = await request('POST', `/api/calls/${callId}/signal`, {
      signal_type: 'answer', target_id: juanId,
      sdp: JSON.stringify({ type: 'answer', sdp: 'mock-sdp' })
    }, mariaToken);
    assert(r.data.success);
  });

  await test('Enviar señal ICE candidate', async () => {
    const r = await request('POST', `/api/calls/${callId}/signal`, {
      signal_type: 'ice-candidate', target_id: juanId,
      candidate: JSON.stringify({ candidate: 'mock-candidate' })
    }, mariaToken);
    assert(r.data.success);
  });

  await test('Obtener señales pendientes', async () => {
    const r = await request('GET', `/api/calls/${callId}/signals`, null, juanToken);
    assert(r.data.success);
    assert(r.data.data.signals.length > 0);
    console.log(`     → ${r.data.data.signals.length} señales`);
  });

  await test('Terminar videollamada', async () => {
    const r = await request('PUT', `/api/calls/${callId}/end`, { duration: 120 }, juanToken);
    assert(r.data.success);
    assert(r.data.data.status === 'ended');
  });

  await test('Llamada de audio', async () => {
    const r = await request('POST', '/api/calls', {
      target_user_id: mariaId, call_type: 'audio'
    }, juanToken);
    assert(r.data.success);
    await request('PUT', `/api/calls/${r.data.data.call_id}/end`, null, juanToken);
  });

  await test('Rechazar llamada', async () => {
    const r = await request('POST', '/api/calls', {
      target_user_id: mariaId, call_type: 'video'
    }, juanToken);
    assert(r.data.success);
    const rej = await request('PUT', `/api/calls/${r.data.data.call_id}/reject`, null, mariaToken);
    assert(rej.data.success);
  });

  await test('No llamarse a sí mismo', async () => {
    const r = await request('POST', '/api/calls', {
      target_user_id: juanId, call_type: 'video'
    }, juanToken);
    assert(r.status === 400);
  });

  await test('No llamada duplicada', async () => {
    const r1 = await request('POST', '/api/calls', {
      target_user_id: mariaId, call_type: 'video'
    }, juanToken);
    assert(r1.data.success);
    const r2 = await request('POST', '/api/calls', {
      target_user_id: mariaId, call_type: 'video'
    }, juanToken);
    assert(r2.status === 409);
    await request('PUT', `/api/calls/${r1.data.data.call_id}/end`, null, juanToken);
  });

  await test('Historial de llamadas', async () => {
    const r = await request('GET', '/api/calls/history/list', null, juanToken);
    assert(r.data.success);
    assert(r.data.data.calls.length > 0);
    console.log(`     → ${r.data.data.calls.length} llamadas en historial`);
  });

  await test('Llamada grupal (canal de voz)', async () => {
    const comDetail = await request('GET', `/api/communities/${communityId}`, null, juanToken);
    const voiceCh = comDetail.data.data.channels.find(c => c.channel_type === 'voice');
    if (!voiceCh) { console.log('     ⚠️  Sin canal de voz'); return; }

    const r = await request('POST', '/api/calls', {
      channel_id: voiceCh.id, call_type: 'audio'
    }, juanToken);
    assert(r.data.success);
    assert(r.data.data.call_mode === 'group');
    await request('PUT', `/api/calls/${r.data.data.call_id}/end`, null, juanToken);
  });

  // ==========================================
  // RESULTS
  // ==========================================
  console.log('\n' + '='.repeat(60));
  const total = passed + failed;
  const pct = ((passed / total) * 100).toFixed(1);
  
  if (failed === 0) {
    console.log(`  🎉 ¡TODAS LAS PRUEBAS PASARON! (${passed}/${total})`);
  } else {
    console.log(`  📊 RESULTADOS: ${passed} PASADOS, ${failed} FALLIDOS de ${total} (${pct}%)`);
    if (errors.length > 0) {
      console.log('\n  Errores:');
      errors.forEach(e => console.log(`    • ${e.name}: ${e.error}`));
    }
  }
  console.log('='.repeat(60) + '\n');

  // Cleanup
  if (serverProcess) serverProcess.kill();
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  if (serverProcess) serverProcess.kill();
  process.exit(1);
});
