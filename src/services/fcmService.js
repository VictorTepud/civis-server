// Firebase Cloud Messaging helper
// Uses firebase-admin to send push notifications

const admin = require('firebase-admin');
const db = require('../config/database');

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
 * Send a push notification to a specific user
 * @param {string} userId - The recipient user ID
 * @param {object} data - The notification data payload
 * @param {string} data.type - Notification type: 'chat_message' or 'incoming_call'
 * @param {string} [data.senderName] - Sender display name (for chat_message)
 * @param {string} [data.senderAvatar] - Sender avatar URL (for chat_message)
 * @param {string} [data.content] - Message content (for chat_message)
 * @param {string} [data.conversationId] - Conversation ID (for chat_message)
 * @param {string} [data.senderId] - Sender user ID (for chat_message)
 * @param {string} [data.replyContent] - Reply preview content (optional)
 * @param {string} [data.callerName] - Caller name (for incoming_call)
 * @param {string} [data.callType] - Call type: 'de voz' or 'de video' (for incoming_call)
 */
async function sendPush(userId, data) {
  if (!initialized) return false;

  try {
    // Get user's FCM token from database
    const user = db.prepare('SELECT fcm_token FROM users WHERE id = ?').get(userId);
    if (!user || !user.fcm_token) {
      return false;
    }

    // FCM data solo acepta strings — convertir todo a string
    const stringData = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = (value === null || value === undefined) ? '' : String(value);
    }

    // Enviar notification + data:
    // - FOREGROUND: onMessageReceived se llama, mostramos nuestra notificacion
    //   personalizada con MessagingStyle y reply inline.
    // - BACKGROUND: Android muestra la notificacion del sistema. Al tocarla,
    //   clickAction abre DIRECTAMENTE ChatActivity (no LoginActivity).
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
    // If token is invalid, clear it
    if (err.code === 'messaging/invalid-registration-token' ||
        err.code === 'messaging/registration-token-not-registered') {
      console.log(`[FCM] Invalid token for user ${userId}, clearing...`);
      db.prepare('UPDATE users SET fcm_token = NULL WHERE id = ?').run(userId);
    } else {
      console.error(`[FCM] Error sending push to user ${userId}:`, err.message);
    }
    return false;
  }
}

/**
 * Check if a user has an active socket connection (online in DB)
 */
function isUserOnline(userId) {
  try {
    const user = db.prepare('SELECT online FROM users WHERE id = ?').get(userId);
    return user ? user.online === 1 : false;
  } catch (e) {
    return false;
  }
}

module.exports = { init, sendPush, isUserOnline };
