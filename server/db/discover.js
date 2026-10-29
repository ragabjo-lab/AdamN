'use strict';

const fs = require('fs');
const path = require('path');
const { store } = require('./connection');
const { readConfig, writeConfig, discoveryRoots, DEFAULT_DATA_FILE, BACKUP_DIR, ensureDirs } = require('../config');

const SIGNATURE = 'AdamN-NMS';
const BACKUP_MARKER = `${path.sep}backups${path.sep}`;

function isBackupPath(file) {
  return path.resolve(file).includes(BACKUP_MARKER);
}
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cache', '.venv', 'venv', '__pycache__', 'AppData', 'Temp', 'temp',
  'Windows', 'Program Files', 'Program Files (x86)', 'System Volume Information', '$Recycle.Bin',
  '.local', '.cargo', '.rustup', 'dist', 'build', '.next', '.npm', 'Library', '.Trash',
]);
const DB_EXT = /\.(db|sqlite|sqlite3|hdana)$/i;

/** Read-only inspection: is this an AdamN data file? */
function inspectFile(file) {
  let handle = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    handle = new DatabaseSync(file, { readOnly: true });
    const rows = handle.prepare("SELECT key, value FROM meta WHERE key IN ('file_uuid','app_signature','schema_version')").all();
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (meta.app_signature !== SIGNATURE) return { ok: false };
    const stat = fs.statSync(file);
    return {
      ok: true,
      path: path.resolve(file),
      fileName: path.basename(file),
      isBackup: isBackupPath(file),
      size: stat.size,
      sizeHuman: human(stat.size),
      modifiedAt: stat.mtime.toISOString(),
      fileUuid: meta.file_uuid,
      schemaVersion: Number(meta.schema_version || 0),
    };
  } catch {
    return { ok: false };
  } finally {
    if (handle) { try { handle.close(); } catch { /* ignore */ } }
  }
}

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Walks the candidate roots looking for AdamN data files (bounded, never throws). */
function discoverDataFiles({ roots = discoveryRoots(), maxDepth = 3, maxFiles = 4000 } = {}) {
  const found = new Map();
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > maxDepth || visited > maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited > maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile() && DB_EXT.test(entry.name)) {
        visited += 1;
        const info = inspectFile(full);
        // Deduplicate by path: a backup copy legitimately shares the same file UUID.
        if (info.ok && !found.has(info.path)) found.set(info.path, info);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  // Live data files first (a backup is a copy and shares the same file UUID), newest first.
  return [...found.values()].sort((a, b) => {
    if (a.isBackup !== b.isBackup) return a.isBackup ? 1 : -1;
    return a.modifiedAt < b.modifiedAt ? 1 : -1;
  });
}

/**
 * Opens the configured data file. If it is missing (moved/renamed), the app tries to
 * re-attach automatically by matching the file UUID recorded from a previous session.
 */
function connectDataFile({ autoRelink = true } = {}) {
  const config = readConfig();
  const configured = config.dataFile || DEFAULT_DATA_FILE;
  if (fs.existsSync(configured)) {
    store.open(configured);
    const info = store.info();
    const history = new Set([...(config.lastDataFilePaths || []), configured]);
    writeConfig({ dataFile: info.path, lastFileUuid: info.fileUuid, lastDataFilePaths: [...history].slice(-10) });
    return { info, relinked: false, configured };
  }

  if (autoRelink) {
    const candidates = discoverDataFiles({
      roots: [path.dirname(configured), ...discoveryRoots()],
    }).filter((c) => !c.isBackup); // never silently attach to a snapshot
    const match = candidates.find((c) => config.lastFileUuid && c.fileUuid === config.lastFileUuid);
    if (match) {
      store.open(match.path);
      const info = store.info();
      writeConfig({ dataFile: info.path, lastFileUuid: info.fileUuid });
      return { info, relinked: true, previousPath: configured, configured };
    }
  }

  // Nothing to re-attach: start a fresh HDANA file at the default location.
  store.open(DEFAULT_DATA_FILE);
  const info = store.info();
  writeConfig({ dataFile: info.path, lastFileUuid: info.fileUuid });
  return { info, relinked: false, created: true, configured };
}

function relinkDataFile(targetPath) {
  const info = inspectFile(targetPath);
  if (!info.ok) {
    const err = new Error('الملف المحدد ليس ملف بيانات AdamN صالح');
    err.code = 'invalid_data_file';
    throw err;
  }
  store.open(targetPath);
  const opened = store.info();
  const config = readConfig();
  const history = new Set([...(config.lastDataFilePaths || []), targetPath, config.dataFile].filter(Boolean));
  writeConfig({ dataFile: opened.path, lastFileUuid: opened.fileUuid, lastDataFilePaths: [...history].slice(-10) });
  return opened;
}

/** Consistent copy of the data file (WAL checkpoint first), keeps the last `keep` backups. */
function backupNow({ keep = 14, tag = 'manual' } = {}) {
  ensureDirs();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  try { store.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(BACKUP_DIR, `HDANA-backup-${stamp}-${tag}.db`);
  fs.copyFileSync(store.filePath, target);
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('HDANA-backup-') && f.endsWith('.db'))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of backups.slice(keep)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old.f)); } catch { /* ignore */ }
  }
  return {
    path: target,
    fileName: path.basename(target),
    size: fs.statSync(target).size,
    createdAt: new Date().toISOString(),
    total: Math.min(backups.length, keep),
  };
}

function listBackups() {
  ensureDirs();
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { fileName: f, path: path.join(BACKUP_DIR, f), size: stat.size, sizeHuman: human(stat.size), createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = { inspectFile, discoverDataFiles, connectDataFile, relinkDataFile, backupNow, listBackups, SIGNATURE };
