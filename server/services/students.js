'use strict';
const { store } = require('../db/connection');
const time = require('../lib/time');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { getSettings } = require('./settings');

const SORTS = {
  name: 's.full_name COLLATE NOCASE',
  age: 's.birth_date',
  phone: 's.guardian_phone',
  enrollDate: 's.enroll_date',
  code: 's.code',
  createdAt: 's.created_at',
};

function nextCode(prefix) {
  const rows = store.all('SELECT code FROM students WHERE code IS NOT NULL');
  let max = 0;
  for (const r of rows) {
    const m = String(r.code).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/** Enriches a raw student row with timezone-aware derived values (age, duration, payments). */
function decorate(row, { today, payments = null, feeDefault = 0 }) {
  if (!row) return null;
  const age = time.ageOf(row.birth_date, today);
  const duration = time.durationOf(row.enroll_date, today);
  const photoUrl = row.photo_id ? `/api/attachments/${row.photo_id}/raw` : null;
  return {
    id: row.id,
    code: row.code,
    fullName: row.full_name,
    birthDate: row.birth_date,
    birthDateDisplay: time.formatDdMmYy(row.birth_date),
    enrollDate: row.enroll_date,
    enrollDateDisplay: time.formatDdMmYy(row.enroll_date),
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    address: row.address,
    notes: row.notes,
    monthlyFee: row.monthly_fee,
    feeDefault,
    status: row.status,
    photoId: row.photo_id,
    photoUrl,
    age: {
      ...age,
      label: `${age.years} سنة ${age.months} شهر ${age.days} يوم`,
      totalDays: age.totalDays,
    },
    duration: {
      ...duration,
      label: `${duration.days} يوم ${duration.months} شهر ${duration.years} سنة`,
      totalDays: duration.totalDays,
    },
    payments: payments || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function paymentsForYear(studentIds, year) {
  if (!studentIds.length) return new Map();
  const placeholders = studentIds.map(() => '?').join(',');
  const rows = store.all(
    `SELECT student_id, period, amount FROM student_payments
      WHERE student_id IN (${placeholders}) AND period LIKE ?`,
    [...studentIds, `${year}-%`]
  );
  const map = new Map();
  for (const r of rows) {
    const entry = map.get(r.student_id) || {};
    entry[r.period] = Number(r.amount) || 0;
    map.set(r.student_id, entry);
  }
  return map;
}

function paymentStatus(amount) {
  return Number(amount) > 0 ? 'paid' : 'unpaid';
}

function list(params = {}) {
  const settings = getSettings();
  const tz = settings.timezone;
  const today = time.todayISO(tz);
  const year = Number(params.year) || Number(today.slice(0, 4));
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month || '') ? params.month : time.monthKey(tz);
  const pageSize = Math.min(200, Math.max(5, Number(params.pageSize) || 10));
  const page = Math.max(1, Number(params.page) || 1);
  const sortKey = SORTS[params.sort] ? params.sort : 'name';
  const order = String(params.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const status = ['paid', 'unpaid', 'all'].includes(params.status) ? params.status : 'all';
  const lifeStatus = ['active', 'archived', 'all'].includes(params.lifeStatus) ? params.lifeStatus : 'active';
  const q = (params.q || '').toString().trim();

  const where = [];
  const args = [];
  if (lifeStatus !== 'all') { where.push('s.status = ?'); args.push(lifeStatus); }
  if (q) {
    where.push('(s.full_name LIKE ? OR s.guardian_phone LIKE ? OR s.code LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (params.phone) {
    where.push('s.guardian_phone LIKE ?');
    args.push(`%${v.normalizeDigits(params.phone)}%`);
  }
  if (params.enrolledBefore) {
    where.push('s.enroll_date <= ?');
    args.push(params.enrolledBefore);
  }
  if (status !== 'all') {
    const existsPaid = 'EXISTS (SELECT 1 FROM student_payments p WHERE p.student_id = s.id AND p.period = ? AND p.amount > 0)';
    where.push(status === 'paid' ? existsPaid : `NOT ${existsPaid}`);
    args.push(month);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = store.get(`SELECT COUNT(*) AS c FROM students s ${whereSql}`, args);
  const total = totalRow ? totalRow.c : 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const rows = store.all(
    `SELECT s.* FROM students s ${whereSql}
      ORDER BY ${SORTS[sortKey]} ${order}, s.id ASC
      LIMIT ? OFFSET ?`,
    [...args, pageSize, (safePage - 1) * pageSize]
  );
  const payments = paymentsForYear(rows.map((r) => r.id), year);

  return {
    items: rows.map((r) => decorate(r, { today, payments: payments.get(r.id) || {}, feeDefault: settings.default_subscription_fee })),
    pagination: { page: safePage, pageSize, total, pages },
    context: { year, month, today, timezone: tz, status, sort: sortKey, order, q },
    summary: summaryFor(year, month),
  };
}

function summaryFor(year, month) {
  const totalStudents = store.get("SELECT COUNT(*) AS c FROM students WHERE status = 'active'").c;
  const paid = store.get(
    'SELECT COUNT(*) AS c FROM student_payments WHERE period = ? AND amount > 0', [month]).c;
  const collected = store.get(
    'SELECT COALESCE(SUM(amount),0) AS s FROM student_payments WHERE period = ?', [month]).s;
  const expected = store.get("SELECT COALESCE(SUM(monthly_fee),0) AS s FROM students WHERE status = 'active'").s;
  const yearCollected = store.get(
    'SELECT COALESCE(SUM(amount),0) AS s FROM student_payments WHERE period LIKE ?', [`${year}-%`]).s;
  return {
    totalStudents,
    paidCount: paid,
    unpaidCount: Math.max(0, totalStudents - paid),
    collected: Number(collected),
    expected: Number(expected),
    yearCollected: Number(yearCollected),
    month,
    year,
  };
}

function getById(id, { year } = {}) {
  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const row = store.get('SELECT * FROM students WHERE id = ?', [id]);
  if (!row) throw notFound('الطالب غير موجود');
  const y = Number(year) || Number(today.slice(0, 4));
  const payments = paymentsForYear([row.id], y).get(row.id) || {};
  const allPayments = store.all(
    'SELECT period, amount, paid_at, method, notes FROM student_payments WHERE student_id = ? ORDER BY period DESC',
    [id]
  );
  const attachments = store.all(
    `SELECT id, file_name, mime, size, kind, created_at FROM attachments
      WHERE owner_type = 'student' AND owner_id = ? AND kind = 'document' ORDER BY created_at DESC`,
    [id]
  );
  return {
    ...decorate(row, { today, payments, feeDefault: settings.default_subscription_fee }),
    year: y,
    paymentHistory: allPayments.map((p) => ({
      period: p.period,
      label: time.periodLabel(p.period, settings.locale),
      amount: Number(p.amount),
      status: paymentStatus(p.amount),
      paidAt: p.paid_at,
      method: p.method,
      notes: p.notes,
    })),
    attachments: attachments.map((a) => ({
      id: a.id, fileName: a.file_name, mime: a.mime, size: a.size,
      createdAt: a.created_at, url: `/api/attachments/${a.id}/raw`,
    })),
  };
}

function create(payload, user) {
  const settings = getSettings();
  const now = new Date().toISOString();
  const data = normalizePayload(payload, settings);
  const code = data.code || nextCode(settings.student_code_prefix);
  const res = store.run(
    `INSERT INTO students (code, full_name, birth_date, enroll_date, guardian_name, guardian_phone,
        address, notes, monthly_fee, photo_id, status, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, data.full_name, data.birth_date, data.enroll_date, data.guardian_name, data.guardian_phone,
      data.address, data.notes, data.monthly_fee, data.photo_id || null, data.status, now, now,
      user ? user.id : null, user ? user.id : null]
  );
  return getById(res.lastInsertRowid);
}

function normalizePayload(payload, settings) {
  const data = {
    full_name: v.nameField(payload.fullName, 'اسم الطالب'),
    birth_date: v.dateField(payload.birthDate, 'تاريخ الميلاد'),
    enroll_date: v.dateField(payload.enrollDate, 'تاريخ الالتحاق'),
    guardian_name: payload.guardianName ? v.nameField(payload.guardianName, 'اسم ولي الأمر') : null,
    guardian_phone: v.phoneField(payload.guardianPhone, 'رقم هاتف ولي الأمر'),
    address: v.optionalString(payload.address, { max: 300 }),
    notes: v.optionalString(payload.notes, { max: 2000 }),
    monthly_fee: payload.monthlyFee === undefined || payload.monthlyFee === ''
      ? Number(settings.default_subscription_fee) || 0
      : v.amountField(payload.monthlyFee, 'قيمة الاشتراك الشهري'),
    status: v.enumField(payload.status, ['active', 'archived'], 'الحالة', 'active'),
    photo_id: payload.photoId ? v.idField(payload.photoId, 'الصورة') : null,
    code: payload.code ? v.requiredString(payload.code, 'الكود', { max: 40 }) : null,
  };
  const today = time.todayISO(settings.timezone);
  if (data.birth_date > today) throw badRequest('تاريخ الميلاد لا يمكن أن يكون في المستقبل');
  if (time.daysBetween(data.birth_date, data.enroll_date) < 0) {
    throw badRequest('تاريخ الالتحاق يجب أن يكون بعد تاريخ الميلاد');
  }
  return data;
}

function update(id, payload) {
  const existing = store.get('SELECT * FROM students WHERE id = ?', [id]);
  if (!existing) throw notFound('الطالب غير موجود');
  const settings = getSettings();
  const data = normalizePayload({ ...payload, code: payload.code || existing.code }, settings);
  const now = new Date().toISOString();
  store.run(
    `UPDATE students SET full_name = ?, birth_date = ?, enroll_date = ?, guardian_name = ?, guardian_phone = ?,
        address = ?, notes = ?, monthly_fee = ?, photo_id = ?, status = ?, code = ?, updated_at = ?
      WHERE id = ?`,
    [data.full_name, data.birth_date, data.enroll_date, data.guardian_name, data.guardian_phone,
      data.address, data.notes, data.monthly_fee, data.photo_id || existing.photo_id, data.status,
      data.code, now, id]
  );
  return getById(id);
}

function remove(id) {
  const existing = store.get('SELECT id, photo_id FROM students WHERE id = ?', [id]);
  if (!existing) throw notFound('الطالب غير موجود');
  store.transaction(() => {
    store.run('DELETE FROM attachments WHERE owner_type = ? AND owner_id = ?', ['student', id]);
    store.run('DELETE FROM students WHERE id = ?', [id]);
  });
  return { id };
}

/** Monthly subscription for one student. amount > 0 => paid, <= 0/absent => unpaid. */
function setPayment(studentId, period, payload, user) {
  const student = store.get('SELECT id, monthly_fee FROM students WHERE id = ?', [studentId]);
  if (!student) throw notFound('الطالب غير موجود');
  const p = v.periodField(period);
  const amount = v.amountField(payload.amount, 'قيمة الاشتراك الشهري', { required: false });
  const now = new Date().toISOString();
  const existing = store.get('SELECT * FROM student_payments WHERE student_id = ? AND period = ?', [studentId, p]);
  if (amount > 0) {
    const paidAt = payload.paidAt || now;
    if (existing) {
      store.run(
        'UPDATE student_payments SET amount = ?, paid_at = ?, method = ?, notes = ?, updated_at = ?, created_by = ? WHERE id = ?',
        [amount, paidAt, v.optionalString(payload.method, { max: 40 }), v.optionalString(payload.notes),
          now, user ? user.id : null, existing.id]
      );
    } else {
      store.run(
        `INSERT INTO student_payments (student_id, period, amount, paid_at, method, notes, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [studentId, p, amount, paidAt, v.optionalString(payload.method, { max: 40 }),
          v.optionalString(payload.notes), now, now, user ? user.id : null]
      );
    }
  } else if (existing) {
    // explicit unpaid: keep an auditable zero row instead of deleting history
    store.run(
      'UPDATE student_payments SET amount = 0, paid_at = NULL, notes = ?, updated_at = ?, created_by = ? WHERE id = ?',
      [v.optionalString(payload.notes), now, user ? user.id : null, existing.id]
    );
  } else {
    store.run(
      `INSERT INTO student_payments (student_id, period, amount, paid_at, notes, created_at, updated_at, created_by)
       VALUES (?, ?, 0, NULL, ?, ?, ?, ?)`,
      [studentId, p, v.optionalString(payload.notes), now, now, user ? user.id : null]
    );
  }
  return { studentId, period: p, amount, status: paymentStatus(amount) };
}

function paymentsMatrix(year, studentIds) {
  const map = paymentsForYear(studentIds, year);
  return studentIds.map((id) => ({ studentId: id, payments: map.get(id) || {} }));
}

function forPrint(year) {
  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const y = Number(year) || Number(today.slice(0, 4));
  const rows = store.all("SELECT * FROM students WHERE status = 'active' ORDER BY full_name COLLATE NOCASE");
  const map = paymentsForYear(rows.map((r) => r.id), y);
  return {
    year: y,
    today,
    timezone: settings.timezone,
    settings,
    items: rows.map((r) => decorate(r, { today, payments: map.get(r.id) || {}, feeDefault: settings.default_subscription_fee })),
  };
}

module.exports = {
  list, getById, create, update, remove, setPayment, summaryFor, paymentsMatrix, forPrint,
  decorate, paymentStatus, nextCode,
};
