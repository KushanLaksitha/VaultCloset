const multer = require('multer');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

// Accepted MIME types — includes HEIC/HEIF (iPhone camera native), AVIF (modern Android),
// and common mobile/web formats. Sharp converts them all server-side.
const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',      // iPhone HEIC (High Efficiency Image Codec)
  'image/heif',      // HEIF container (variant of HEIC)
  'image/avif',      // AVIF (Android, modern browsers)
  'image/gif',       // GIF (first frame saved as JPEG)
  'image/tiff',      // TIFF (some pro cameras)
  'image/bmp',       // BMP
];

// Memory storage: the raw file is never written to disk unencrypted.
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxFileMb * 1024 * 1024, files: 20 },
  fileFilter: (_r, f, cb) => {
    // Also accept if mimetype is empty/generic — mobile browsers sometimes send
    // 'application/octet-stream' for HEIC files. We let sharp validate actual content.
    const ok = ALLOWED_MIME.includes(f.mimetype) || f.mimetype === 'application/octet-stream' || f.mimetype.startsWith('image/');
    return ok ? cb(null, true) : cb(new AppError(415, 'Unsupported image format', 'FORMAT'));
  },
});

