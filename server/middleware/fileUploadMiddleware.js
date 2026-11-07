const multer = require('multer');

// Memory storage: the raw file is never written to disk unencrypted.
// Accepts any document, archive, video, or media file up to 500 MB.
// Encryption is applied immediately in memory before writing to disk.
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 20 },
});
