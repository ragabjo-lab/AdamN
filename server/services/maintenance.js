'use strict';
/**
 * Daily maintenance – the "self-updating" part of the data file.
 * Runs once per calendar day (timezone aware) plus on boot:
 *   - creates the daily backup
 *   - regenerates notifications (birthdays tomorrow, unpaid month, payroll, new month)
 *   - records the run in job_runs / settings.last_daily_run
 */
const { store } = require('../db/connection');
const time = require('../lib/time');
const { getSettings } = require('./settings');
const notifications = require('./notifications');
const { backupNow } = require('../db/discover');

let timer = null;

function runDaily({ force = false } = {}) {
  const settings = getSettings();
  const tz = settings.timezone;
  const today = time.todayISO(tz);
  const last = settings.last_daily_run;
  if (!force && last === today) {
    return { skipped: true, today, lastRun: last };
  }
  const startedAt = new Date().toISOString();
  const result = { today, timezone: tz, actions: [] };

  try {
    if (settings.backup_daily) {
      const lastBackup = String(settings.last_backup_at || '').slice(0, 10);
      if (lastBackup !== today) {
        const backup = backupNow({ keep: Number(settings.backup_keep) || 14, tag: 'daily' });
        store.setSetting('last_backup_at', new Date().toISOString());
        result.actions.push({ backup: backup.fileName, size: backup.size });
      }
    }
    const gen = notifications.generate(today);
    result.actions.push({ notificationsCreated: gen.created });
    store.setSetting('last_daily_run', today);
    store.setSetting('current_period', today.slice(0, 7));
    store.run(
      'INSERT INTO job_runs (job, run_on, status, message, created_at) VALUES (?, ?, ?, ?, ?)',
      ['daily', today, 'success', JSON.stringify(result.actions), startedAt]
    );
    store.setMeta('last_daily_run', today);
    return result;
  } catch (err) {
    store.run(
      'INSERT INTO job_runs (job, run_on, status, message, created_at) VALUES (?, ?, ?, ?, ?)',
      ['daily', today, 'error', String(err.message).slice(0, 500), startedAt]
    );
    throw err;
  }
}

function startScheduler({ intervalMs = 15 * 60 * 1000 } = {}) {
  stopScheduler();
  const tick = () => {
    try {
      runDaily();
    } catch (err) {
      console.error('[maintenance] daily job failed:', err.message);
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

function lastRuns(limit = 10) {
  return store.all('SELECT * FROM job_runs ORDER BY id DESC LIMIT ?', [limit]);
}

module.exports = { runDaily, startScheduler, stopScheduler, lastRuns };
