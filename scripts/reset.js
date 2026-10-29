#!/usr/bin/env node
/** Deletes the connected data file (after writing a safety backup). Requires --yes. */
'use strict';
const fs = require('fs');
const { connectDataFile, backupNow } = require('../server/db/discover');
const { store } = require('../server/db/connection');

if (!process.argv.includes('--yes')) {
  console.log('This deletes the current HDANA data file.');
  console.log('Re-run with:  npm run reset -- --yes');
  process.exit(0);
}

const connected = connectDataFile();
const safety = backupNow({ tag: 'before-reset' });
console.log(`[reset] safety backup → ${safety.path}`);
const target = store.filePath;
store.close();
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(`${target}${suffix}`); } catch { /* ignore */ }
}
const { writeConfig, readConfig, DEFAULT_DATA_FILE } = require('../server/config');
writeConfig({ ...readConfig(), dataFile: DEFAULT_DATA_FILE, lastFileUuid: null });
console.log(`[reset] removed ${target}. A fresh file will be created on next start.`);
