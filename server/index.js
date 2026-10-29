'use strict';
const { createApp } = require('./app');
const { connectDataFile } = require('./db/discover');
const { store } = require('./db/connection');
const { ensureDefaults } = require('./services/settings');
const maintenance = require('./services/maintenance');
const config = require('./config');

function log(msg) { console.log(`[AdamN] ${msg}`); }

function boot() {
  config.ensureDirs();
  const connected = connectDataFile();
  ensureDefaults();
  const app = createApp();
  const server = app.listen(config.PORT, config.HOST, () => {
    log(`data file: ${connected.info.path}${connected.relinked ? ' (re-attached automatically)' : ''}`);
    log(`driver: ${connected.info.driver} • schema v${connected.info.schemaVersion}`);
    log(`listening on http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
    if (!store.get('SELECT COUNT(*) AS c FROM users').c) {
      log('first run: open the app in your browser to create the administrator account');
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[AdamN] port ${config.PORT} is already in use. Set PORT=4001 and try again.`);
      process.exit(1);
    }
    throw err;
  });

  try {
    const result = maintenance.runDaily();
    log(result.skipped ? `daily job already ran for ${result.today}` : `daily job completed: ${JSON.stringify(result.actions)}`);
  } catch (err) {
    console.error('[AdamN] daily job failed:', err.message);
  }
  maintenance.startScheduler();

  // Open the default browser on desktop starts (optional, ADAMN_OPEN=1)
  if (process.env.ADAMN_OPEN === '1') {
    const url = `http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`;
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }

  const shutdown = (signal) => {
    log(`${signal} received, closing database...`);
    maintenance.stopScheduler();
    try { store.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    store.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => { console.error('[AdamN] uncaught:', err); });
  process.on('unhandledRejection', (err) => { console.error('[AdamN] unhandled rejection:', err); });

  return { app, server };
}

if (require.main === module) boot();
module.exports = { boot };
