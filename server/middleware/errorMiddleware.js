const { AppError } = require('../utils/errors');
module.exports = (err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') err = new AppError(413, 'That file is too large', 'TOO_LARGE');
  else if (err.name === 'MulterError') err = new AppError(400, 'Upload failed: ' + err.message);
  else if (err.code === 'ER_DUP_ENTRY') err = new AppError(409, 'That already exists', 'DUPLICATE');
  if (!(err instanceof AppError)) { console.error(err); err = new AppError(500, 'Something went wrong on our side. Please try again.'); }
  res.status(err.status).json({ error: err.message, code: err.code });
};
