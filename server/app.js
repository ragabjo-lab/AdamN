'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const auth = require('./lib/auth');
const { store } = require('./db/connection');
const { PUBLIC_DIR } = require('./config');
const { AppError } = require('./lib/errors');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  // Data file may be temporarily closed while relinking/restoring
  app.use((req, res, next) => {
    if (!store.isOpen && req.path.startsWith('/api/')) {
      return res.status(503).json({ error: 'data_file_unavailable', message: 'ملف البيانات غير متصل حاليًا' });
    }
    return next();
  });

  app.use((req, res, next) => {
    if (store.isOpen) req.user = auth.loadUser(req);
    next();
  });

  // Light CSRF protection: state-changing API calls must come from the app itself.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-adamn-client') === '1') return next();
    if (req.path === '/auth/login' || req.path === '/auth/setup') return next();
    return res.status(403).json({ error: 'csrf', message: 'طلب غير موثوق' });
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /* ---------------- API ---------------- */
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      app: 'AdamN NMS',
      version: require('../package.json').version,
      dataFileConnected: store.isOpen,
      file: store.isOpen ? store.info().fileName : null,
      time: new Date().toISOString(),
    });
  });

  const { revenue, expense } = require('./routes/ledger');
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/students', require('./routes/students'));
  app.use('/api/attachments', require('./routes/attachments'));
  app.use('/api/staff', require('./routes/staff'));
  app.use('/api/revenue', revenue);
  app.use('/api/expenses', expense);
  app.use('/api/finance', require('./routes/finance'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/settings', require('./routes/settings'));
  app.use('/api/exports', require('./routes/exports'));
  app.use('/print', require('./routes/print'));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found', message: 'المسار غير موجود' });
  });

  /* ---------------- static SPA ---------------- */
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    etag: true,
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  /* ---------------- errors ---------------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details || null });
    }
    if (err && err.status && err.status < 500) {
      return res.status(err.status).json({ error: err.code || 'request_error', message: err.message });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'too_large', message: 'حجم البيانات المرسلة أكبر من المسموح' });
    }
    console.error('[api error]', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'server_error', message: 'حدث خطأ داخلي، حاول مرة أخرى' });
  });

  return app;
}

module.exports = { createApp };
