'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { migrations, LATEST_VERSION } = require('./schema');

/** Loads the SQLite driver: built-in node:sqlite (Node >= 22.13), else better-sqlite3. */
function loadDriver() {
  try {
    // eslint-disable-next-line global-require
    const { DatabaseSync } = require('node:sqlite');
    return {
      name: 'node:sqlite',
      open(file) {
        const db = new DatabaseSync(file);
        return {
          raw: db,
          exec: (sql) => db.exec(sql),
          prepare: (sql) => db.prepare(sql),
          close: () => db.close(),
        };
      },
    };
  } catch (err) {
    try {
      // eslint-disable-next-line global-require
      const Better = require('better-sqlite3');
      return {
        name: 'better-sqlite3',
        open(file) {
          const db = new Better(file);
          return {
            raw: db,
            exec: (sql) => db.exec(sql),
            prepare: (sql) => db.prepare(sql),
            close: () => db.close(),
          };
        },
      };
    } catch (e2) {
      const error = new Error(
        'No SQLite driver available. Use Node.js >= 22.13 (built-in node:sqlite) or install better-sqlite3.'
      );
      error.cause = err;
      throw error;
    }
  }
}

const DRIVER = loadDriver();

class Store {
  constructor() {
    this.handle = null;
    this.filePath = null;
    this.driver = DRIVER.name;
  }

  get isOpen() {
    return Boolean(this.handle);
  }

  /** Opens (creating if needed) the HDANA data file and runs migrations. */
  open(filePath) {
    const absolute = path.resolve(filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    this.close();
    const handle = DRIVER.open(absolute);
    handle.exec('PRAGMA journal_mode = WAL;');
    handle.exec('PRAGMA foreign_keys = ON;');
    handle.exec('PRAGMA busy_timeout = 8000;');
    handle.exec('PRAGMA synchronous = NORMAL;');
    this.handle = handle;
    this.filePath = absolute;
    this.migrate();
    this.ensureIdentity();
    return this;
  }

  close() {
    if (this.handle) {
      try { this.handle.close(); } catch { /* already closed */ }
    }
    this.handle = null;
    this.filePath = null;
  }

  assertOpen() {
    if (!this.handle) throw new Error('Data file is not connected');
  }

  migrate() {
    this.assertOpen();
    const row = this.get('PRAGMA user_version');
    const current = Number(row ? row.user_version : 0);
    for (const migration of migrations) {
      if (migration.version > current) {
        this.exec('BEGIN');
        try {
          migration.up(this.handle);
          this.exec(`PRAGMA user_version = ${migration.version}`);
          this.exec('COMMIT');
        } catch (err) {
          try { this.exec('ROLLBACK'); } catch { /* ignore */ }
          throw new Error(`Migration ${migration.version} failed: ${err.message}`);
        }
      }
    }
  }

  /** Each data file carries a stable UUID so it can be rediscovered after being moved. */
  ensureIdentity() {
    let uuid = this.meta('file_uuid');
    if (!uuid) {
      uuid = crypto.randomUUID();
      this.setMeta('file_uuid', uuid);
      this.setMeta('created_at', new Date().toISOString());
      this.setMeta('app_signature', 'AdamN-NMS');
    }
    this.setMeta('last_opened_at', new Date().toISOString());
    this.setMeta('schema_version', String(LATEST_VERSION));
    return uuid;
  }

  all(sql, params = []) {
    this.assertOpen();
    return this.handle.prepare(sql).all(...params);
  }

  get(sql, params = []) {
    this.assertOpen();
    return this.handle.prepare(sql).get(...params) || null;
  }

  run(sql, params = []) {
    this.assertOpen();
    const res = this.handle.prepare(sql).run(...params);
    return {
      changes: Number(res.changes || 0),
      lastInsertRowid: Number(res.lastInsertRowid || 0),
    };
  }

  exec(sql) {
    this.assertOpen();
    this.handle.exec(sql);
  }

  transaction(fn) {
    this.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }

  meta(key, fallback = null) {
    const row = this.get('SELECT value FROM meta WHERE key = ?', [key]);
    return row ? row.value : fallback;
  }

  setMeta(key, value) {
    this.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, String(value)]
    );
  }

  /** Settings hold business options (timezone, currency, nursery name ...). */
  setting(key, fallback = null) {
    const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  settingRaw(key, fallback = null) {
    const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : fallback;
  }

  setSetting(key, value) {
    this.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, typeof value === 'string' ? value : JSON.stringify(value)]
    );
  }

  get timezone() {
    return this.setting('timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  get locale() {
    return this.setting('locale') || 'ar';
  }

  info() {
    const size = this.filePath && fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
    const stat = this.filePath && fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
    return {
      path: this.filePath,
      fileName: this.filePath ? path.basename(this.filePath) : null,
      size,
      sizeHuman: humanSize(size),
      modifiedAt: stat ? stat.mtime.toISOString() : null,
      fileUuid: this.meta('file_uuid'),
      schemaVersion: Number(this.meta('schema_version', 0)),
      driver: this.driver,
      connected: this.isOpen,
    };
  }
}

function humanSize(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

module.exports = { store: new Store(), Store, DRIVER_NAME: DRIVER.name, LATEST_VERSION };
