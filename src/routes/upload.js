const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../config/database');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Multer storage configurations
function createStorage(subdir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(UPLOAD_DIR, subdir));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = req.user ? req.user.id : Date.now().toString();
      cb(null, `${name}${ext}`);
    }
  });
}

const avatarUpload = multer({
  storage: createStorage('avatars'),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const mediaUpload = multer({
  storage: createStorage('media'),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const statusUpload = multer({
  storage: createStorage('status'),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const attachmentUpload = multer({
  storage: createStorage('attachments'),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// POST /avatar
router.post('/avatar', authenticate, avatarUpload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.user.id);
    res.json({ url: avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /media
router.post('/media', authenticate, mediaUpload.single('media'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const url = `/uploads/media/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /status
router.post('/status', authenticate, statusUpload.single('status'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const url = `/uploads/status/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /attachment
router.post('/attachment', authenticate, attachmentUpload.single('attachment'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const url = `/uploads/attachments/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:type/:filename - serve file
router.get('/:type/:filename', authenticate, (req, res) => {
  const allowedTypes = ['avatars', 'media', 'status', 'attachments'];
  const type = req.params.type;
  if (!allowedTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid file type.' });
  }
  const filePath = path.join(UPLOAD_DIR, type, req.params.filename);
  res.sendFile(path.resolve(filePath));
});

module.exports = router;
