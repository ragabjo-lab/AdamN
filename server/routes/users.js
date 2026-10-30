'use strict';
const express = require('express');
const { store } = require('../db/connection');
const auth = require('../lib/auth');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { idField } = require('../lib/validate');

const router = express.Router();
const adminOnly = auth.requirePerm('users.manage');

router.get('/', adminOnly, (req, res) => {
  const rows = store.all('SELECT * FROM users ORDER BY created_at ASC');
  res.json({
    items: rows.map((r) => ({ ...auth.publicUser(r), activeSessions: store.get('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?', [r.id]).c })),
    roles: auth.ROLES,
    matrix: auth.PERMISSIONS,
  });
});

router.post('/', adminOnly, (req, res) => {
  const { username, password, fullName, role } = req.body || {};
  if (!fullName || String(fullName).trim().length < 2) throw badRequest('اسم المستخدم الكامل مطلوب');
  const user = auth.createUser({ username: String(username || '').trim(), password, fullName: String(fullName).trim(), role });
  auth.audit(req.user, 'create', 'user', user.id, { username: user.username, role });
  res.status(201).json(auth.publicUser(user));
});

router.put('/:id', adminOnly, (req, res) => {
  const id = idField(req.params.id);
  const user = store.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw notFound('المستخدم غير موجود');
  const { fullName, role, isActive } = req.body || {};
  if (role && !auth.ROLES.includes(role)) throw badRequest('الدور غير صحيح');
  if (id === req.user.id && (role !== user.role || isActive === false)) {
    throw conflict('لا يمكنك تعديل دورك أو تعطيل حسابك الحالي');
  }
  store.run(
    'UPDATE users SET full_name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?',
    [String(fullName || user.full_name).trim().slice(0, 120), role || user.role,
      isActive === false || isActive === 0 ? 0 : 1, new Date().toISOString(), id]
  );
  if (isActive === false || isActive === 0) store.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  auth.audit(req.user, 'update', 'user', id, { role, isActive });
  res.json(auth.publicUser(store.get('SELECT * FROM users WHERE id = ?', [id])));
});

router.post('/:id/password', adminOnly, (req, res) => {
  const id = idField(req.params.id);
  const user = store.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw notFound('المستخدم غير موجود');
  const password = req.body && req.body.password;
  auth.validatePassword(String(password || ''));
  store.run(
    'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?',
    [auth.hashPassword(password), new Date().toISOString(), id]
  );
  store.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  auth.audit(req.user, 'reset-password', 'user', id);
  res.json({ ok: true });
});

router.delete('/:id', adminOnly, (req, res) => {
  const id = idField(req.params.id);
  if (id === req.user.id) throw conflict('لا يمكنك حذف حسابك الحالي');
  const user = store.get('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) throw notFound('المستخدم غير موجود');
  const admins = store.get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1").c;
  const target = store.get('SELECT role FROM users WHERE id = ?', [id]);
  if (target.role === 'admin' && admins <= 1) throw conflict('يجب أن يبقى مدير نظام واحد على الأقل');
  store.run('DELETE FROM users WHERE id = ?', [id]);
  auth.audit(req.user, 'delete', 'user', id);
  res.json({ ok: true, id });
});

module.exports = router;
