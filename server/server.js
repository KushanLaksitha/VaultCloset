const env = require('./config/env'); // validates secrets on startup (fails fast if missing)
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorMiddleware');
const { purgeExpiredRejected } = require('./services/imageService');

const app = express();
app.disable('x-powered-by');
if (env.prod) app.set('trust proxy', 1);
app.use(helmet({
  frameguard: { action: 'deny' },
  noSniff: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    },
  },
}));

// Strict Permissions-Policy & Cross-Domain lockdown to block sensor/camera/microphone access
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// Force zero-caching on all API responses so private vault data is never written to disk cache
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Universal Input Sanitizer against null-byte injection, path-traversal, and prototype pollution
app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete obj[key];
        return res.status(400).json({ error: 'Malicious payload detected' });
      }
      if (typeof obj[key] === 'string') {
        // Strip null bytes
        if (obj[key].includes('\0')) {
          return res.status(400).json({ error: 'Null bytes are not allowed' });
        }
      } else if (typeof obj[key] === 'object') {
        sanitize(obj[key]);
      }
    }
  };
  sanitize(req.query);
  sanitize(req.body);
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.startsWith('http://10.') || origin.startsWith('http://192.168.') || origin.startsWith('http://172.')) {
      return callback(null, true);
    }
    callback(null, env.clientOrigin || true);
  },
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 15 * 60e3, limit: 1500, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60e3, limit: 30, standardHeaders: true, legacyHeaders: false })); // auth brute-force protection
app.use('/api/categories', rateLimit({ windowMs: 15 * 60e3, limit: 120, standardHeaders: true, legacyHeaders: false })); // pin brute-force protection

// Local Wi-Fi network info endpoint for QR code mobile connect
app.get('/api/network-info', (_req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  const primaryIp = ips[0]?.address || 'localhost';
  const port = 5173;
  res.json({ ips, primaryIp, port, url: `http://${primaryIp}:${port}` });
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/images', require('./routes/imageRoutes'));
app.use('/api/files', require('./routes/fileRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/rejected', require('./routes/rejectedRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/media', require('./routes/mediaRoutes'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

if (env.prod) { // production: serve the built React app from the same origin
  const dist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);

setInterval(() => purgeExpiredRejected().catch((e) => console.error('purge failed', e.message)), 10 * 60e3);
app.listen(env.port, () => console.log(`VaultCloset API on http://localhost:${env.port}`));
