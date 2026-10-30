'use strict';
const { store } = require('../db/connection');
const time = require('../lib/time');
const { getSettings } = require('./settings');
const { notFound } = require('../lib/errors');

function push(entry) {
  const existing = store.get('SELECT * FROM notifications WHERE dedupe_key = ?', [entry.dedupeKey]);
  if (existing) {
    // Rolling alerts (unpaid month, payroll, finance) refresh in place instead of piling up
    // one row per day; the unread flag is reset only when the content actually changed.
    if (entry.upsert) {
      const changed = existing.title_ar !== entry.titleAr || (existing.body_ar || '') !== (entry.bodyAr || '');
      store.run(
        `UPDATE notifications SET title_ar = ?, title_en = ?, body_ar = ?, body_en = ?, severity = ?,
            link = ?, created_at = ?, expires_on = ?, is_read = CASE WHEN ? THEN 0 ELSE is_read END
          WHERE id = ?`,
        [entry.titleAr, entry.titleEn, entry.bodyAr || null, entry.bodyEn || null,
          entry.severity || existing.severity, entry.link || existing.link,
          new Date().toISOString(), entry.expiresOn || existing.expires_on,
          changed ? 1 : 0, existing.id]
      );
    }
    return false;
  }
  store.run(
    `INSERT INTO notifications (dedupe_key, type, severity, title_ar, title_en, body_ar, body_en, link,
        entity_type, entity_id, is_read, created_at, expires_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [entry.dedupeKey, entry.type, entry.severity || 'info', entry.titleAr, entry.titleEn,
      entry.bodyAr || null, entry.bodyEn || null, entry.link || null,
      entry.entityType || null, entry.entityId || null, new Date().toISOString(), entry.expiresOn || null]
  );
  return true;
}

/**
 * Scans the data file and materialises notifications (idempotent per day thanks to dedupe_key).
 * Never throws: notifications must not break the daily maintenance job.
 */
function generate(today) {
  const settings = getSettings();
  const tz = settings.timezone;
  const todayISO = today || time.todayISO(tz);
  const tomorrow = time.addDaysISO(todayISO, 1);
  const period = todayISO.slice(0, 7);
  let created = 0;
  const safe = (fn) => { try { if (fn()) created += 1; } catch { /* ignore */ } };

  // 1) Birthdays tomorrow
  if (settings.birthday_notifications) {
    const students = store.all("SELECT id, full_name, birth_date FROM students WHERE status = 'active'");
    for (const s of students) {
      const bday = time.birthdayThisYear(s.birth_date, tomorrow);
      if (bday === tomorrow) {
        const age = time.ageOf(s.birth_date, tomorrow).years;
        safe(() => push({
          dedupeKey: `birthday:${s.id}:${tomorrow}`,
          type: 'birthday',
          severity: 'success',
          titleAr: `عيد ميلاد ${s.full_name} غدًا`,
          titleEn: `${s.full_name} has a birthday tomorrow`,
          bodyAr: `يكمل ${age} سنة يوم ${time.formatDdMmYyyy(tomorrow)}`,
          bodyEn: `Turns ${age} on ${tomorrow}`,
          link: `#/students?highlight=${s.id}`,
          entityType: 'student', entityId: s.id,
          expiresOn: time.addDaysISO(tomorrow, 2),
        }));
      }
    }
  }

  // 2) Students who have not paid the current month
  if (settings.unpaid_notifications) {
    const unpaid = store.all(
      `SELECT id, full_name FROM students s
        WHERE status = 'active'
          AND NOT EXISTS (SELECT 1 FROM student_payments p WHERE p.student_id = s.id AND p.period = ? AND p.amount > 0)
        ORDER BY full_name COLLATE NOCASE`,
      [period]
    );
    if (unpaid.length) {
      const names = unpaid.slice(0, 8).map((u) => u.full_name).join('، ');
      safe(() => push({
        upsert: true,
        dedupeKey: `unpaid:${period}`,
        type: 'unpaid',
        severity: 'warning',
        titleAr: `${unpaid.length} طالب لم يدفعوا اشتراك ${time.periodLabel(period, 'ar')}`,
        titleEn: `${unpaid.length} students with unpaid subscription for ${time.periodLabel(period, 'en')}`,
        bodyAr: unpaid.length > 8 ? `${names} … وغيرهم` : names,
        bodyEn: `${unpaid.length} students still unpaid`,
        link: `#/students?status=unpaid&month=${period}`,
        entityType: 'period', entityId: null,
        expiresOn: time.addDaysISO(todayISO, 10),
      }));
    }
    const overdueDay = Number(settings.subscription_due_day) || 5;
    if (Number(todayISO.slice(8, 10)) > overdueDay && unpaid.length) {
      safe(() => push({
        upsert: true,
        dedupeKey: `overdue:${period}`,
        type: 'overdue',
        severity: 'danger',
        titleAr: `تجاوز موعد السداد لشهر ${time.periodLabel(period, 'ar')}`,
        titleEn: `Payment deadline passed for ${time.periodLabel(period, 'en')}`,
        bodyAr: `يوم الاستحقاق كان ${overdueDay}/${period.split('-')[1]}/${period.slice(0, 4)} — ${unpaid.length} طالب لم يسدد`,
        bodyEn: `Due day was the ${overdueDay} — ${unpaid.length} students unpaid`,
        link: `#/students?status=unpaid&month=${period}`,
        expiresOn: time.addDaysISO(todayISO, 15),
      }));
    }
  }

  // 3) Payroll not yet recorded / paid for the current month
  if (settings.salary_notifications) {
    const pending = store.get(
      `SELECT COUNT(*) AS c FROM staff st
        WHERE st.is_active = 1 AND st.hire_date <= ?
          AND NOT EXISTS (SELECT 1 FROM staff_salaries ss WHERE ss.staff_id = st.id AND ss.period = ?)`,
      [todayISO, period]
    ).c;
    if (pending > 0) {
      safe(() => push({
        upsert: true,
        dedupeKey: `payroll:${period}`,
        type: 'payroll',
        severity: 'info',
        titleAr: `رواتب ${time.periodLabel(period, 'ar')} لم تُسجل بعد`,
        titleEn: `Payroll for ${time.periodLabel(period, 'en')} is not recorded yet`,
        bodyAr: `${pending} موظف بانتظار تسجيل الراتب`,
        bodyEn: `${pending} employees awaiting payroll`,
        link: `#/staff?period=${period}`,
        expiresOn: time.addDaysISO(todayISO, 20),
      }));
    }
  }

  // 4) Start of a new month (automatic "unpaid" reset notice)
  safe(() => push({
    upsert: true,
    dedupeKey: `month:${period}`,
    type: 'month',
    severity: 'info',
    titleAr: `بدأ شهر ${time.periodLabel(period, 'ar')} — تم تصفير حالة السداد`,
    titleEn: `New month ${time.periodLabel(period, 'en')} — payment status reset`,
    bodyAr: 'جميع الطلاب أصبحوا «لم يدفع» حتى يتم تسجيل الاشتراك.',
    bodyEn: 'All students are marked unpaid until the subscription is recorded.',
    link: `#/students?month=${period}`,
    expiresOn: time.addDaysISO(todayISO, 45),
  }));

  // 5) Financial alert: previous month ended in a loss
  const prev = time.addMonthsToPeriod(period, -1);
  const finance = require('./finance');
  const prevOverview = finance.monthOverview(prev);
  if (prevOverview && prevOverview.net < 0 && prevOverview.revenue.total > 0) {
    safe(() => push({
      dedupeKey: `loss:${prev}`,
      type: 'finance',
      severity: 'danger',
      titleAr: `خسارة في شهر ${time.periodLabel(prev, 'ar')}`,
      titleEn: `Loss recorded in ${time.periodLabel(prev, 'en')}`,
      bodyAr: `صافي ${prevOverview.net} — الإيرادات ${prevOverview.revenue.total} مقابل مصروفات ${prevOverview.expenses.total}`,
      bodyEn: `Net ${prevOverview.net}`,
      link: `#/finance?period=${prev}`,
      expiresOn: time.addDaysISO(todayISO, 60),
    }));
  }

  prune();
  return { created, today: todayISO };
}

function prune() {
  const keepFrom = time.addDaysISO(time.todayISO(getSettings().timezone), -120);
  store.run('DELETE FROM notifications WHERE created_at < ?', [`${keepFrom}T00:00:00.000Z`]);
  store.run("DELETE FROM notifications WHERE expires_on IS NOT NULL AND expires_on < date('now')");
}

function list(params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(params.pageSize) || 20));
  const where = [];
  const args = [];
  if (params.filter === 'unread') where.push('is_read = 0');
  if (params.type) { where.push('type = ?'); args.push(params.type); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = store.get(`SELECT COUNT(*) AS c FROM notifications ${whereSql}`, args).c;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const rows = store.all(
    `SELECT * FROM notifications ${whereSql} ORDER BY is_read ASC, created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (safePage - 1) * pageSize]
  );
  return {
    items: rows.map((r) => ({
      id: r.id, type: r.type, severity: r.severity,
      titleAr: r.title_ar, titleEn: r.title_en, bodyAr: r.body_ar, bodyEn: r.body_en,
      link: r.link, isRead: Boolean(r.is_read), createdAt: r.created_at, expiresOn: r.expires_on,
    })),
    unread: store.get('SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0').c,
    total,
    pagination: { page: safePage, pageSize, pages },
  };
}

function unreadCount() {
  return store.get('SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0').c;
}

function markRead(id, read = true) {
  const row = store.get('SELECT id FROM notifications WHERE id = ?', [id]);
  if (!row) throw notFound('التنبيه غير موجود');
  store.run('UPDATE notifications SET is_read = ? WHERE id = ?', [read ? 1 : 0, id]);
  return { id, isRead: read, unread: unreadCount() };
}

function markAllRead() {
  store.run('UPDATE notifications SET is_read = 1 WHERE is_read = 0');
  return { unread: 0 };
}

function remove(id) {
  store.run('DELETE FROM notifications WHERE id = ?', [id]);
  return { id, unread: unreadCount() };
}

function clearRead() {
  store.run('DELETE FROM notifications WHERE is_read = 1');
  return { unread: unreadCount() };
}

module.exports = { generate, list, unreadCount, markRead, markAllRead, remove, clearRead };
