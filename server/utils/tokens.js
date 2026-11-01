const jwt = require('jsonwebtoken');
const env = require('../config/env');
// Session token (cookie) and short-lived media tokens (image URLs) are different "t" types,
// so a leaked image link can never be used as a login session.
const signSession = (userId) => jwt.sign({ sub: userId, t: 'session' }, env.jwtSecret, { expiresIn: `${env.sessionHours}h` });
const signMedia = (userId, imgId, kind, seconds) => jwt.sign({ sub: userId, img: imgId, kind, t: 'media' }, env.jwtSecret, { expiresIn: seconds });
const verify = (token) => jwt.verify(token, env.jwtSecret);
module.exports = { signSession, signMedia, verify };
