#!/usr/bin/env node
/** Environment & data-file diagnostics. */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { DRIVER_NAME } = require('../server/db/connection');
const { connectDataFile, discoverDataFiles, listBackups } = require('../server/db/discover');
const { store } = require('../server/db/connection');
const config = require('../server/config');
const { getSettings } = require('../server/services/settings');

console.log('AdamN NMS — diagnostics');
console.log('--------------------------------------------------');
console.log(`Node.js           : ${process.version}`);
console.log(`Platform          : ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`SQLite driver     : ${DRIVER_NAME}`);
console.log(`App root          : ${config.APP_ROOT}`);
console.log(`Storage dir       : ${config.STORAGE_DIR}`);
console.log(`Public dir        : ${fs.existsSync(config.PUBLIC_DIR) ? 'ok' : 'MISSING'} (${config.PUBLIC_DIR})`);
console.log(`Bundled fonts     : ${fs.existsSync(path.join(config.PUBLIC_DIR, 'assets/fonts/tajawal-ar-400.woff2')) ? 'ok' : 'MISSING'}`);
try {
  const connected = connectDataFile();
  const settings = getSettings();
  console.log('--------------------------------------------------');
  console.log(`Data file         : ${connected.info.path}`);
  console.log(`  exists          : ${fs.existsSync(connected.info.path)}`);
  console.log(`  size            : ${connected.info.sizeHuman}`);
  console.log(`  file uuid       : ${connected.info.fileUuid}`);
  console.log(`  schema version  : ${connected.info.schemaVersion}`);
  console.log(`  auto re-attached: ${connected.relinked ? 'yes' : 'no'}`);
  console.log(`Timezone          : ${settings.timezone} (today: ${require('../server/lib/time').todayISO(settings.timezone)})`);
  console.log(`Counts            : students=${store.get('SELECT COUNT(*) AS c FROM students').c} staff=${store.get('SELECT COUNT(*) AS c FROM staff').c} users=${store.get('SELECT COUNT(*) AS c FROM users').c}`);
  console.log(`Backups           : ${listBackups().length}`);
  console.log('--------------------------------------------------');
  const found = discoverDataFiles({ maxDepth: 2 });
  console.log(`Other data files  : ${found.length}`);
  found.forEach((f) => console.log(`  • ${f.path} (${f.sizeHuman})`));
  store.close();
} catch (err) {
  console.error('Data file check failed:', err.message);
  process.exitCode = 1;
}
