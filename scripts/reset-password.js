#!/usr/bin/env node
/**
 * Password recovery for a locked-out administrator (data stays untouched).
 *
 *   npm run reset-password -- --list
 *   npm run reset-password -- --user admin --password NewPass2026
 *
 * The script connects to the same HDANA data file the app uses, validates the new
 * password against the app policy, revokes all sessions of that user and flags
 * "must change password" so it can be rotated again from inside the app.
 */
'use strict';
const { connectDataFile } = require('../server/db/discover');
const { store } = require('../server/db/connection');
const auth = require('../server/lib/auth');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function main() {
  const connected = connectDataFile();
  console.log(`[reset-password] data file: ${connected.info.path}`);

  const users = store.all('SELECT id, username, full_name, role, is_active FROM users ORDER BY id');
  if (!users.length) {
    console.log('No users exist yet — start the app once and complete the setup screen.');
    return;
  }

  if (process.argv.includes('--list') || !arg('user')) {
    console.log('\nUsers in this data file:');
    for (const u of users) {
      console.log(`  • ${u.username.padEnd(16)} ${u.role.padEnd(11)} ${u.is_active ? 'active  ' : 'disabled'}  ${u.full_name}`);
    }
    console.log('\nUsage: npm run reset-password -- --user <username> --password <newPassword>');
    console.log('Password policy: at least 8 characters containing letters and digits.');
    return;
  }

  const username = String(arg('user')).trim();
  const password = String(arg('password') || '');
  const user = store.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    console.error(`User "${username}" was not found. Run with --list to see available users.`);
    process.exitCode = 1;
    return;
  }
  try {
    auth.validatePassword(password);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  store.run(
    'UPDATE users SET password_hash = ?, must_change_password = 1, is_active = 1, updated_at = ? WHERE id = ?',
    [auth.hashPassword(password), new Date().toISOString(), user.id]
  );
  const revoked = store.run('DELETE FROM sessions WHERE user_id = ?', [user.id]).changes;
  store.run(
    'INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [null, 'cli', 'reset-password', 'user', user.id, JSON.stringify({ via: 'scripts/reset-password.js' }), new Date().toISOString()]
  );
  console.log(`\n✔ Password updated for "${username}" (${user.role}).`);
  console.log(`  Sessions revoked: ${revoked}`);
  console.log('  The app will ask this user to choose a new password after signing in.');
}

try {
  main();
  store.close();
} catch (err) {
  console.error('[reset-password] failed:', err.message);
  process.exitCode = 1;
}
