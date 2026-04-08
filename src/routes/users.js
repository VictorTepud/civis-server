const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// OBTENER PERFIL DEL USUARIO ACTUAL
// =============================================
router.get('/me', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, email, username, display_name, avatar, about, phone,
             privacy_profile_photo, privacy_about, privacy_last_seen, privacy_status,
             is_online, last_seen, created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.user.id);

    res.json({ success: true, data: { user } });
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ACTUALIZAR PERFIL
// =============================================
router.put('/me', (req, res) => {
  try {
    const { display_name, about, phone, username } = req.body;
    const db = getDb();

    // Verificar username único si se está cambiando
    if (username) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.toLowerCase().trim(), req.user.id);
      if (existing) {
        return res.status(409).json({ success: false, error: 'El nombre de usuario ya está en uso' });
      }
    }

    // Verificar teléfono único si se está cambiando
    if (phone) {
      const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone.trim(), req.user.id);
      if (existing) {
        return res.status(409).json({ success: false, error: 'El teléfono ya está registrado' });
      }
    }

    // Construir query dinámica
    const updates = [];
    const values = [];

    if (display_name !== undefined) { updates.push('display_name = ?'); values.push(display_name.trim()); }
    if (about !== undefined) { updates.push('about = ?'); values.push(about.trim()); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone.trim() || null); }
    if (username !== undefined) { updates.push('username = ?'); values.push(username.toLowerCase().trim() || null); }

    updates.push("updated_at = datetime('now')");
    values.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updatedUser = db.prepare(`
      SELECT id, email, username, display_name, avatar, about, phone,
             privacy_profile_photo, privacy_about, privacy_last_seen, privacy_status,
             is_online, last_seen, created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.user.id);

    res.json({ success: true, data: { user: updatedUser } });
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ACTUALIZAR AVATAR
// =============================================
router.put('/avatar', (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) {
      return res.status(400).json({ success: false, error: 'URL del avatar requerida' });
    }

    const db = getDb();
    db.prepare("UPDATE users SET avatar = ?, updated_at = datetime('now') WHERE id = ?").run(avatar, req.user.id);

    res.json({ success: true, message: 'Avatar actualizado' });
  } catch (error) {
    console.error('Error al actualizar avatar:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ACTUALIZAR PRIVACIDAD
// =============================================
router.put('/privacy', (req, res) => {
  try {
    const { privacy_profile_photo, privacy_about, privacy_last_seen, privacy_status } = req.body;
    const db = getDb();

    const updates = [];
    const values = [];

    if (privacy_profile_photo !== undefined) { updates.push('privacy_profile_photo = ?'); values.push(privacy_profile_photo); }
    if (privacy_about !== undefined) { updates.push('privacy_about = ?'); values.push(privacy_about); }
    if (privacy_last_seen !== undefined) { updates.push('privacy_last_seen = ?'); values.push(privacy_last_seen); }
    if (privacy_status !== undefined) { updates.push('privacy_status = ?'); values.push(privacy_status); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron campos para actualizar' });
    }

    updates.push("updated_at = datetime('now')");
    values.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, message: 'Privacidad actualizada' });
  } catch (error) {
    console.error('Error al actualizar privacidad:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// BUSCAR USUARIO POR ID
// =============================================
router.get('/:userId', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, display_name, avatar, about, phone, is_online, last_seen, created_at
      FROM users WHERE id = ?
    `).get(req.params.userId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    res.json({ success: true, data: { user } });
  } catch (error) {
    console.error('Error al buscar usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// CAMBIAR CONTRASEÑA
// =============================================
router.put('/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Contraseñas actuales y nueva requeridas' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    const db = getDb();
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);

    const bcrypt = require('bcryptjs');
    const isValid = await bcrypt.compare(current_password, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Contraseña actual incorrecta' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?").run(hashedPassword, req.user.id);

    res.json({ success: true, message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ACTUALIZAR FCM TOKEN (notificaciones push)
// =============================================
router.put('/fcm-token', (req, res) => {
  try {
    const { fcm_token } = req.body;
    if (!fcm_token) {
      return res.status(400).json({ success: false, error: 'FCM token requerido' });
    }

    const db = getDb();
    db.prepare('UPDATE users SET fcm_token = ? WHERE id = ?').run(fcm_token, req.user.id);

    res.json({ success: true, message: 'FCM token actualizado' });
  } catch (error) {
    console.error('Error al actualizar FCM token:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
