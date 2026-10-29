'use strict';
const express = require('express');
const { store } = require('../db/connection');
const auth = require('../lib/auth');
const { badRequest, unauthorized } = require('../lib/errors');
const { getSettings } = require('../services/settings');
const notifications = require('../services/notifications');

const router = express.Router();

function userCount() {
  return store.get('SELECT COUNT(*) AS c FROM users').c;
}

router.get('/setup-status', (req, res) => {
  res.json({ needsSetup: userCount() === 0 });
});

router.post('/setup', (req, res, next) => {
  try {
    if (userCount() > 0) throw badRequest('تم إعداد النظام بالفعل');
    const { username, password, fullName, nurseryName } = req.body || {};
    const user = auth.createUser({
      username: String(username || 'admin').trim(),
      password,
      fullName: String(fullName || 'مدير النظام').trim(),
      role: 'admin',
    });
    if (nurseryName) store.setSetting('nursery_name', String(nurseryName).trim().slice(0, 120));
    const session = auth.createSession(user, req);
    auth.setSessionCookie(res, session.token, session.expiresAt);
    auth.audit(user, 'setup', 'system', null, { username: user.username });
    res.status(201).json({ user: auth.publicUser(user), settings: getSettings() });
  } catch (err) { next(err); }
});

router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const key = `${req.ip}|${String(username || '').toLowerCase()}`;
    auth.throttleLogin(key);
    const row = store.get('SELECT * FROM users WHERE username = ?', [String(username || '').trim()]);
    if (!row || !row.is_active || !auth.verifyPassword(String(password || ''), row.password_hash)) {
      auth.registerFailedLogin(key);
      throw unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    auth.clearLoginAttempts(key);
    store.run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    store.run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
    const session = auth.createSession(row, req);
    auth.setSessionCookie(res, session.token, session.expiresAt);
    auth.audit(row, 'login', 'user', row.id, { ip: req.ip });
    res.json({ user: auth.publicUser(row), settings: getSettings(), unread: notifications.unreadCount() });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  if (req.user) {
    store.run('DELETE FROM sessions WHERE id = ?', [req.user.sessionId]);
    auth.audit(req.user, 'logout', 'user', req.user.id);
  }
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({
    user: { ...auth.publicUser(req.user), sessionId: req.user.sessionId },
    settings: getSettings(),
    unread: notifications.unreadCount(),
  });
});

router.post('/password', auth.requireAuth, (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const row = store.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!auth.verifyPassword(String(currentPassword || ''), row.password_hash)) {
      throw unauthorized('كلمة المرور الحالية غير صحيحة');
    }
    auth.validatePassword(String(newPassword || ''));
    if (currentPassword === newPassword) throw badRequest('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
    store.run(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      [auth.hashPassword(newPassword), new Date().toISOString(), req.user.id]
    );
    // invalidate other sessions
    store.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [req.user.id, req.user.sessionId]);
    auth.audit(req.user, 'change-password', 'user', req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
