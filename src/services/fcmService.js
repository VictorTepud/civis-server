// Firebase Cloud Messaging helper
// Usa firebase-admin para enviar push notifications

const admin = require('firebase-admin');
const { getDb } = require('../config/database');

let initialized = false;

function init() {
  if (initialized) return;
  try {
    const serviceAccount = require('../config/firebase-service-account.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    initialized = true;
    console.log('[FCM] Firebase Admin initialized successfully');
  } catch (err) {
    console.warn('[FCM] Firebase Admin not initialized:', err.message);
    console.warn('[FCM] Push notifications will only work via socket.io');
    console.warn('[FCM] To enable FCM, place firebase-service-account.json in src/config/');
  }
}

/**
 * Enviar push notification a un usuario
 * Estrategia dual:
 * - notification: para que Android muestre algo cuando la app está en background
 * - data: para que onMessageReceived pueda mostrar la notificación personalizada en foreground
 * - clickAction: para que al tocar la notificación del sistema abra DIRECTAMENTE el ChatActivity
 */
async function sendPush(userId, data) {
  if (!initialized) return false;

  try {
    const db = getDb();
    const user = db.prepare('SELECT fcm_token FROM users WHERE id = ?').get(userId);
    if (!user || !user.fcm_token) {
      return false;
    }

    // FCM data solo acepta strings — convertir todo
    const stringData = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = (value === null || value === undefined) ? '' : String(value);
    }

    const message = {
      token: user.fcm_token,
      notification: {
        title: data.senderName || 'Nuevo mensaje',
        body: data.content || 'Multimedia',
      },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          channelId: 'civis_messages',
          sound: 'default',
          clickAction: 'OPEN_CHAT'
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log(`[FCM] Push sent to user ${userId}:`, response);
    return true;
  } catch (err) {
    if (err.code === 'messaging/invalid-registration-token' ||
        err.code === 'messaging/registration-token-not-registered') {
      console.log(`[FCM] Invalid token for user ${userId}, clearing...`);
      try {
        const db = getDb();
        db.prepare('UPDATE users SET fcm_token = NULL WHERE id = ?').run(userId);
      } catch (e) {}
    } else {
      console.error(`[FCM] Error sending push to user ${userId}:`, err.message);
    }
    return false;
  }
}

module.exports = { init, sendPush };
