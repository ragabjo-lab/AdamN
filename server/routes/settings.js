'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { store } = require('../db/connection');
const auth = require('../lib/auth');
const time = require('../lib/time');
const { getSettings, updateSettings } = require('../services/settings');
const { readConfig, STORAGE_DIR, DEFAULT_DATA_FILE } = require('../config');
const discovery = require('../db/discover');
const maintenance = require('../services/maintenance');
const { badRequest } = require('../lib/errors');

const router = express.Router();

/* ---------- general settings ---------- */
router.get('/', auth.requireAuth, (req, res) => {
  const settings = getSettings();
  const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  res.json({
    settings,
    timezones,
    serverTime: {
      utc: new Date().toISOString(),
      today: time.todayISO(settings.timezone),
      period: time.monthKey(settings.timezone),
      timezone: settings.timezone,
    },
    locale: settings.locale,
  });
});

router.put('/', auth.requirePerm('settings.write'), (req, res) => {
  const before = getSettings();
  const settings = updateSettings(req.body || {});
  auth.audit(req.user, 'update', 'settings', null, {
    changed: Object.keys(req.body || {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(settings[k])),
  });
  res.json({ settings });
});

/* ---------- data file (HDANA) ---------- */
router.get('/data-file', auth.requireAuth, (req, res) => {
  const config = readConfig();
  res.json({
    info: store.info(),
    configured: config.dataFile,
    defaultPath: DEFAULT_DATA_FILE,
    storageDir: STORAGE_DIR,
    appHome: process.env.ADAMN_HOME || null,
    autoReconnect: true,
    lastRelink: config.updatedAt || null,
    recentPaths: config.lastDataFilePaths || [],
  });
});

router.post('/data-file/discover', auth.requirePerm('datafile.manage'), (req, res) => {
  const files = discovery.discoverDataFiles({ maxDepth: Math.min(5, Number(req.body && req.body.depth) || 3) })
    .filter((f) => !f.isBackup);
  res.json({
    items: files,
    current: store.meta('file_uuid'),
    roots: require('../config').discoveryRoots(),
  });
});

router.post('/data-file/relink', auth.requirePerm('datafile.manage'), (req, res) => {
  const target = (req.body && req.body.path) || '';
  if (!target) throw badRequest('مسار الملف مطلوب');
  const resolved = target.startsWith('~') ? path.join(os.homedir(), target.slice(1)) : path.resolve(target);
  if (!fs.existsSync(resolved)) throw badRequest('الملف غير موجود في المسار المحدد');
  const before = store.info();
  const info = discovery.relinkDataFile(resolved);
  auth.audit(req.user, 'relink-data-file', 'system', null, { from: before.path, to: info.path });
  res.json({ info, previous: before });
});

router.post('/data-file/create', auth.requirePerm('datafile.manage'), (req, res) => {
  const { directory, fileName } = req.body || {};
  if (!directory) throw badRequest('اختر مجلد الحفظ');
  const dir = String(directory).startsWith('~') ? path.join(os.homedir(), String(directory).slice(1)) : path.resolve(String(directory));
  fs.mkdirSync(dir, { recursive: true });
  const name = String(fileName || 'HDANA.db').replace(/[^A-Za-z0-9._\u0600-\u06FF-]/g, '_');
  const target = path.join(dir, name.endsWith('.db') ? name : `${name}.db`);
  if (fs.existsSync(target)) throw badRequest('يوجد ملف بنفس الاسم في هذا المجلد');
  const before = store.info();
  discovery.backupNow({ tag: 'pre-create' });
  store.open(target);
  const config = readConfig();
  require('../config').writeConfig({ dataFile: target, lastFileUuid: store.meta('file_uuid'), lastDataFilePaths: [...(config.lastDataFilePaths || []), target].slice(-10) });
  require('../services/settings').ensureDefaults();
  auth.audit(req.user, 'create-data-file', 'system', null, { path: target, previous: before.path });
  res.json({ info: store.info(), previous: before });
});

router.post('/data-file/backup', auth.requirePerm('datafile.manage'), (req, res) => {
  const result = discovery.backupNow({ tag: 'manual' });
  store.setSetting('last_backup_at', new Date().toISOString());
  auth.audit(req.user, 'backup', 'system', null, { file: result.fileName });
  res.json(result);
});

router.get('/backups', auth.requireAuth, (req, res) => {
  res.json({ items: discovery.listBackups() });
});

router.get('/backups/:file/download', auth.requirePerm('datafile.manage'), (req, res) => {
  const name = path.basename(String(req.params.file));
  const full = path.join(STORAGE_DIR, 'backups', name);
  if (!fs.existsSync(full)) throw badRequest('النسخة الاحتياطية غير موجودة');
  res.download(full, name);
});

router.post('/backups/:file/restore', auth.requirePerm('datafile.manage'), (req, res) => {
  const name = path.basename(String(req.params.file));
  const full = path.join(STORAGE_DIR, 'backups', name);
  if (!fs.existsSync(full)) throw badRequest('النسخة الاحتياطية غير موجودة');
  const current = store.filePath;
  const safety = discovery.backupNow({ tag: 'before-restore' });
  store.close();
  fs.copyFileSync(full, current);
  for (const ext of ['-wal', '-shm']) {
    try { fs.unlinkSync(`${current}${ext}`); } catch { /* ignore */ }
  }
  store.open(current);
  require('../services/settings').ensureDefaults();
  auth.audit(req.user, 'restore-backup', 'system', null, { file: name, safety: safety.fileName });
  res.json({ ok: true, restoredFrom: name, safetyBackup: safety.fileName, info: store.info() });
});

/* ---------- system ---------- */
router.get('/system', auth.requireAuth, (req, res) => {
  res.json({
    app: { name: 'AdamN NMS', version: require('../../package.json').version, node: process.version, platform: `${os.type()} ${os.release()}`, uptime: Math.round(process.uptime()) },
    dataFile: store.info(),
    driver: store.info().driver,
    counts: {
      students: store.get('SELECT COUNT(*) AS c FROM students').c,
      staff: store.get('SELECT COUNT(*) AS c FROM staff').c,
      revenues: store.get('SELECT COUNT(*) AS c FROM revenues').c,
      expenses: store.get('SELECT COUNT(*) AS c FROM expenses').c,
      payments: store.get('SELECT COUNT(*) AS c FROM student_payments').c,
      attachments: store.get('SELECT COUNT(*) AS c FROM attachments').c,
      users: store.get('SELECT COUNT(*) AS c FROM users').c,
    },
    lastJobRuns: maintenance.lastRuns(5),
    backup: { lastAt: getSettings().last_backup_at, items: discovery.listBackups().slice(0, 5) },
  });
});

router.post('/system/daily-run', auth.requirePerm('settings.write'), (req, res) => {
  const result = maintenance.runDaily({ force: true });
  auth.audit(req.user, 'daily-run', 'system', null, result);
  res.json(result);
});

router.get('/audit', auth.requirePerm('audit.read'), (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const rows = store.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
  res.json({ items: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) });
});

router.get('/sessions', auth.requireAuth, (req, res) => {
  const rows = store.all(
    `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.user_agent, s.ip, u.username, u.full_name
       FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.last_seen_at DESC`
  );
  res.json({ items: rows, current: req.user.sessionId });
});

router.delete('/sessions/:id', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  store.run('DELETE FROM sessions WHERE id = ?', [id]);
  res.json({ ok: true });
});

module.exports = router;
