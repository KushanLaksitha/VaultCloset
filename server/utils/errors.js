const path = require('path');
class AppError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Strip folders/odd characters from user-supplied filenames.
const safeName = (n = 'image') => path.basename(String(n)).replace(/[^\w.\- ()]/g, '_').slice(0, 200);
module.exports = { AppError, wrap, safeName };
