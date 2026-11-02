const multer = require('multer');
const { AppError } = require('../utils/errors');

// Accepted MIME types for video and document uploads
const ALLOWED_VIDEO = [
  'video/mp4', 'video/webm', 'video/quicktime',
  'video/x-matroska', 'video/x-msvideo', 'video/avi',
  'video/3gpp', 'video/3gpp2',
];
const ALLOWED_DOCUMENT = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/x-7z-compressed',
];

const ALL_ALLOWED = new Set([...ALLOWED_VIDEO, ...ALLOWED_DOCUMENT]);

// 500 MB max for videos; memory storage (never written to disk unencrypted)
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ok = ALL_ALLOWED.has(file.mimetype) || file.mimetype === 'application/octet-stream';
    return ok ? cb(null, true) : cb(new AppError(415, `Unsupported file type: ${file.mimetype}`, 'FORMAT'));
  },
});

