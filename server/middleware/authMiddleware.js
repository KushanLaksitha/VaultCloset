const { verify } = require('../utils/tokens');
const { AppError } = require('../utils/errors');
// Reads the httpOnly cookie (JavaScript in the browser cannot read it => safer against XSS).
module.exports = function requireAuth(req, _res, next) {
  try {
    const p = verify(req.cookies.vc_session);
    if (p.t !== 'session') throw 0;
    req.user = { id: p.sub };
    next();
  } catch { next(new AppError(401, 'Please sign in to continue', 'UNAUTHORIZED')); }
};
