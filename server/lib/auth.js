'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { store } = require('../db/connection');
const { unauthorized, forbidden, badRequest, conflict } = require('./errors');

const COOKIE_NAME = 'adamn_sid';
const SESSION_DAYS = 30;

/** Role -> permission matrix (single source of truth for the UI and the API). */
const PERMISSIONS = {
  admin: ['*'],
  manager: [
    'students.read', 'students.write', 'students.delete', 'attachments.write',
    'staff.read', 'staff.write', 'staff.delete',
    'payroll.read', 'payroll.write',
    'revenue.read', 'revenue.write', 'revenue.delete',
    'expenses.read', 'expenses.write', 'expenses.delete',
    'finance.read', 'exports.run', 'notifications.read', 'settings.write', 'audit.read',
  ],
  accountant: [
    'students.read', 'students.write', 'attachments.write',
    'staff.read', 'payroll.read', 'payroll.write',
    'revenue.read', 'revenue.write', 'revenue.delete',
    'expenses.read', 'expenses.write', 'expenses.delete',
    'finance.read', 'exports.run', 'notifications.read',
  ],
  viewer: ['students.read', 'staff.read', 'revenue.read', 'expenses.read', 'finance.read', 'exports.run', 'notifications.read'],
};

const ROLES = Object.keys(PERMISSIONS);

function permissionsFor(role) {
  return PERMISSIONS[role] || PERMISSIONS.viewer;
}

function can(role, permission) {
  const perms = permissionsFor(role);
  return perms.includes('*') || perms.includes(permission);
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  try { return bcrypt.compareSync(password, hash); } catch { return false; }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw badRequest('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw badRequest('كلمة المرور يجب أن تحتوي حروفًا وأرقامًا');
  return password;
}

function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  store.run(
    `INSERT INTO sessions (user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user.id, sha256(token), now.toISOString(), expires.toISOString(), now.toISOString(),
      (req.headers['user-agent'] || '').slice(0, 300), req.ip || '']
  );
  return { token, expiresAt: expires.toISOString() };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // local desktop app over http://127.0.0.1
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    isActive: Boolean(user.is_active),
    mustChangePassword: Boolean(user.must_change_password),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    permissions: permissionsFor(user.role),
  };
}

/** Resolves req.user from the session cookie; never throws. */
function loadUser(req) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return null;
  const session = store.get(
    `SELECT s.*, u.username, u.full_name, u.role, u.is_active, u.must_change_password, u.last_login_at, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [sha256(token)]
  );
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    store.run('DELETE FROM sessions WHERE id = ?', [session.id]);
    return null;
  }
  if (!session.is_active) return null;
  // rolling last-seen (cheap, once per ~10 minutes)
  if (!session.last_seen_at || Date.now() - new Date(session.last_seen_at).getTime() > 600000) {
    store.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), session.id]);
  }
  return {
    id: session.user_id,
    username: session.username,
    full_name: session.full_name,
    role: session.role,
    is_active: session.is_active,
    must_change_password: session.must_change_password,
    last_login_at: session.last_login_at,
    created_at: session.created_at,
    sessionId: session.id,
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  return next();
}

function requirePerm(permission) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user.role, permission)) return next(forbidden());
    return next();
  };
}

/** Names of the fields a permission protects – used for friendlier errors in the UI. */
function audit(user, action, entity, entityId, details) {
  try {
    store.run(
      'INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user ? user.id : null, user ? user.username : null, action, entity || null,
        entityId || null, details ? JSON.stringify(details).slice(0, 4000) : null, new Date().toISOString()]
    );
  } catch { /* auditing must never break a request */ }
}

const loginAttempts = new Map();
function throttleLogin(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && entry.lockedUntil > now) {
    const seconds = Math.ceil((entry.lockedUntil - now) / 1000);
    const err = new Error(`محاولات دخول كثيرة، حاول بعد ${seconds} ثانية`);
    err.status = 429;
    err.code = 'too_many_attempts';
    throw err;
  }
}
function registerFailedLogin(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 8) { entry.lockedUntil = now + 5 * 60000; entry.count = 0; }
  loginAttempts.set(key, entry);
}
function clearLoginAttempts(key) { loginAttempts.delete(key); }

function createUser({ username, password, fullName, role }) {
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username || '')) {
    throw badRequest('اسم المستخدم يجب أن يكون 3-32 حرفًا إنجليزيًا أو أرقامًا');
  }
  if (!ROLES.includes(role)) throw badRequest('الدور غير صحيح');
  validatePassword(password);
  const exists = store.get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) throw conflict('اسم المستخدم مستخدم بالفعل');
  const now = new Date().toISOString();
  const res = store.run(
    `INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [username, hashPassword(password), fullName, role, now, now]
  );
  return store.get('SELECT * FROM users WHERE id = ?', [res.lastInsertRowid]);
}

module.exports = {
  COOKIE_NAME, PERMISSIONS, ROLES, permissionsFor, can, hashPassword, verifyPassword, validatePassword,
  createSession, setSessionCookie, clearSessionCookie, publicUser, loadUser, requireAuth, requirePerm,
  audit, throttleLogin, registerFailedLogin, clearLoginAttempts, createUser, sha256,
};
