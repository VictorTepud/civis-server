const express = require('express');
const { getDb } = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// OBTENER TODOS LOS CONTACTOS
// =============================================
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const contacts = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, u.about, u.phone, u.is_online, u.last_seen,
             c.nickname, c.blocked, c.muted, c.added_at
      FROM contacts c
      JOIN users u ON c.contact_id = u.id
      WHERE c.user_id = ?
      ORDER BY u.display_name ASC
    `).all(req.user.id);

    res.json({ success: true, data: { contacts } });
  } catch (error) {
    console.error('Error al obtener contactos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// AGREGAR CONTACTO
// =============================================
router.post('/', (req, res) => {
  try {
    const { contact_id, nickname } = req.body;
    if (!contact_id) {
      return res.status(400).json({ success: false, error: 'ID del contacto requerido' });
    }

    if (contact_id === req.user.id) {
      return res.status(400).json({ success: false, error: 'No puedes agregarte a ti mismo como contacto' });
    }

    const db = getDb();

    // Verificar que el usuario existe
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(contact_id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    // Verificar si ya es contacto
    const existing = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, contact_id);
    if (existing) {
      return res.status(409).json({ success: false, error: 'El usuario ya es tu contacto' });
    }

    // Agregar contacto (relación bidireccional)
    const addContact = db.prepare(`
      INSERT OR IGNORE INTO contacts (user_id, contact_id, nickname)
      VALUES (?, ?, ?)
    `);

    const addReverse = db.prepare(`
      INSERT OR IGNORE INTO contacts (user_id, contact_id)
      VALUES (?, ?)
    `);

    const transaction = db.transaction(() => {
      addContact.run(req.user.id, contact_id, nickname || null);
      addReverse.run(contact_id, req.user.id);
    });

    transaction();

    res.status(201).json({ success: true, message: 'Contacto agregado exitosamente' });
  } catch (error) {
    console.error('Error al agregar contacto:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ELIMINAR CONTACTO
// =============================================
router.delete('/:contactId', (req, res) => {
  try {
    const db = getDb();

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.user.id, req.params.contactId);
      db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.params.contactId, req.user.id);
    });

    transaction();

    res.json({ success: true, message: 'Contacto eliminado' });
  } catch (error) {
    console.error('Error al eliminar contacto:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// BLOQUEAR / DESBLOQUEAR CONTACTO
// =============================================
router.put('/:contactId/block', (req, res) => {
  try {
    const { blocked } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, req.params.contactId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
    }

    db.prepare('UPDATE contacts SET blocked = ? WHERE user_id = ? AND contact_id = ?').run(blocked ? 1 : 0, req.user.id, req.params.contactId);

    res.json({ success: true, message: blocked ? 'Contacto bloqueado' : 'Contacto desbloqueado' });
  } catch (error) {
    console.error('Error al bloquear contacto:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// SILENCIAR / QUITAR SILENCIO A CONTACTO
// =============================================
router.put('/:contactId/mute', (req, res) => {
  try {
    const { muted } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, req.params.contactId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
    }

    db.prepare('UPDATE contacts SET muted = ? WHERE user_id = ? AND contact_id = ?').run(muted ? 1 : 0, req.user.id, req.params.contactId);

    res.json({ success: true, message: muted ? 'Contacto silenciado' : 'Contacto no silenciado' });
  } catch (error) {
    console.error('Error al silenciar contacto:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// ACTUALIZAR APODO DE CONTACTO
// =============================================
router.put('/:contactId/nickname', (req, res) => {
  try {
    const { nickname } = req.body;
    const db = getDb();

    db.prepare('UPDATE contacts SET nickname = ? WHERE user_id = ? AND contact_id = ?').run(nickname || null, req.user.id, req.params.contactId);

    res.json({ success: true, message: 'Apodo actualizado' });
  } catch (error) {
    console.error('Error al actualizar apodo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// VERIFICAR SI ES CONTACTO
// =============================================
router.get('/:contactId/check', (req, res) => {
  try {
    const db = getDb();
    const contact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?').get(req.user.id, req.params.contactId);

    res.json({ success: true, data: { is_contact: !!contact, blocked: contact?.blocked || false } });
  } catch (error) {
    console.error('Error al verificar contacto:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// LISTA DE CONTACTOS BLOQUEADOS
// =============================================
router.get('/blocked/list', (req, res) => {
  try {
    const db = getDb();
    const blocked = db.prepare(`
      SELECT u.id, u.display_name, u.username, u.avatar, u.phone
      FROM contacts c
      JOIN users u ON c.contact_id = u.id
      WHERE c.user_id = ? AND c.blocked = 1
    `).all(req.user.id);

    res.json({ success: true, data: { blocked_contacts: blocked } });
  } catch (error) {
    console.error('Error al obtener bloqueados:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
