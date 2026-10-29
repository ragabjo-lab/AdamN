/**
 * AdamN - global configuration & filesystem layout.
 * The application keeps two kinds of persistent state:
 *   1) app-config.json  -> *how* to reach the data (path of the HDANA file, last known file uuid)
 *   2) HDANA.db         -> the actual data file (SQLite). Fully portable: copy/move it anywhere.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_ROOT = path.resolve(__dirname, '..');

/** Minimal .env loader (real env vars always win) so a desktop install can be configured by file. */
function loadDotEnv() {
  const file = path.join(APP_ROOT, '.env');
  if (!fs.existsSync(file)) return;
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDotEnv();

function resolveHome() {
  const custom = process.env.ADAMN_HOME && process.env.ADAMN_HOME.trim();
  return custom ? path.resolve(custom) : path.join(APP_ROOT, 'storage');
}

const STORAGE_DIR = resolveHome();
const CONFIG_FILE = path.join(STORAGE_DIR, 'app-config.json');
const BACKUP_DIR = path.join(STORAGE_DIR, 'backups');
const LOG_DIR = path.join(STORAGE_DIR, 'logs');
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const DATA_DIR = path.join(STORAGE_DIR, 'data');
const DEFAULT_DATA_FILE = path.join(DATA_DIR, 'HDANA.db');

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '127.0.0.1';

function ensureDirs() {
  for (const dir of [STORAGE_DIR, DATA_DIR, BACKUP_DIR, LOG_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function systemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const DEFAULT_CONFIG = {
  dataFile: DEFAULT_DATA_FILE,
  lastFileUuid: null,
  lastDataFilePaths: [],
  createdAt: new Date().toISOString(),
};

function readConfig() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(patch) {
  ensureDirs();
  const next = { ...readConfig(), ...patch, updatedAt: new Date().toISOString() };
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
  return next;
}

/** Candidate roots used when the data file has been moved and must be rediscovered. */
function discoveryRoots() {
  const home = os.homedir();
  const roots = new Set();
  const push = (p) => { if (p && fs.existsSync(p)) roots.add(path.resolve(p)); };
  push(STORAGE_DIR);
  push(DATA_DIR);
  push(home);
  push(path.join(home, 'Desktop'));
  push(path.join(home, 'Documents'));
  push(path.join(home, 'Downloads'));
  push(path.join(home, 'OneDrive'));
  push(path.join(home, 'OneDrive', 'Desktop'));
  push(path.join(home, 'OneDrive', 'Documents'));
  push(path.join(home, 'سطح المكتب'));
  push(path.join(home, 'المستندات'));
  push(path.join(home, 'My Drive'));
  push(path.join(home, 'Google Drive'));
  push('/media');
  push('/mnt');
  push('D:\\');
  push('E:\\');
  push(process.env.USERPROFILE || '');
  return [...roots];
}

module.exports = {
  APP_ROOT,
  STORAGE_DIR,
  CONFIG_FILE,
  BACKUP_DIR,
  LOG_DIR,
  DATA_DIR,
  PUBLIC_DIR,
  DEFAULT_DATA_FILE,
  PORT,
  HOST,
  ensureDirs,
  systemTimezone,
  readConfig,
  writeConfig,
  discoveryRoots,
};
