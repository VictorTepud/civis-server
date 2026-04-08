const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authenticate);

// =============================================
// CONFIGURACIÓN MULTER - STORAGE
// =============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/media';
    const type = req.query.type || 'media';

    if (type === 'avatar') uploadPath = 'uploads/avatars';
    else if (type === 'status') uploadPath = 'uploads/status';

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

// =============================================
// FILTRO DE ARCHIVOS
// =============================================
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    // Imágenes
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    // Video
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
    // Audio
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac',
    // Documentos
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 50 * 1024 * 1024, // 50MB
  }
});

// =============================================
// SUBIR ARCHIVO
// =============================================
router.post('/', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó ningún archivo' });
    }

    const type = req.query.type || 'media';
    const filePath = `/${type === 'avatar' ? 'avatars' : type === 'status' ? 'status' : 'media'}/${req.file.filename}`;

    res.json({
      success: true,
      data: {
        url: filePath,
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size: req.file.size,
      }
    });
  } catch (error) {
    console.error('Error al subir archivo:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =============================================
// SUBIR MÚLTIPLES ARCHIVOS
// =============================================
router.post('/multiple', upload.array('files', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron archivos' });
    }

    const type = req.query.type || 'media';
    const dirName = type === 'avatar' ? 'avatars' : type === 'status' ? 'status' : 'media';

    const files = req.files.map(file => ({
      url: `/${dirName}/${file.filename}`,
      file_name: file.originalname,
      mime_type: file.mimetype,
      size: file.size
    }));

    res.json({ success: true, data: { files } });
  } catch (error) {
    console.error('Error al subir archivos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Manejo de errores de multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'El archivo excede el tamaño máximo permitido (50MB)' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

module.exports = router;
