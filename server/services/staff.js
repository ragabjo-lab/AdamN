'use strict';
const { store } = require('../db/connection');
const time = require('../lib/time');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { getSettings } = require('./settings');

function nextCode(prefix) {
  const rows = store.all('SELECT code FROM staff WHERE code IS NOT NULL');
  let max = 0;
  for (const r of rows) {
    const m = String(r.code).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/** Basic salary that was in force at the end of `period` (historical accuracy). */
function basicForPeriod(staffId, period, fallback) {
  const bounds = time.periodBounds(period);
  const row = store.get(
    `SELECT basic FROM staff_salary_rates
      WHERE staff_id = ? AND effective_from <= ?
      ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [staffId, bounds ? bounds.end : period]
  );
  return row ? Number(row.basic) : Number(fallback) || 0;
}

function decorate(row, { today } = {}) {
  if (!row) return null;
  const duration = time.durationOf(row.hire_date, today);
  return {
    id: row.id,
    code: row.code,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
    hireDate: row.hire_date,
    hireDateDisplay: time.formatDdMmYy(row.hire_date),
    baseSalary: Number(row.base_salary),
    email: row.email,
    address: row.address,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    duration: { ...duration, label: `${duration.years} سنة ${duration.months} شهر ${duration.days} يوم` },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function list(params = {}) {
  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(200, Math.max(5, Number(params.pageSize) || 12));
  const q = (params.q || '').trim();
  const where = [];
  const args = [];
  if (params.status === 'active') where.push('is_active = 1');
  if (params.status === 'inactive') where.push('is_active = 0');
  if (q) {
    where.push('(full_name LIKE ? OR phone LIKE ? OR role LIKE ? OR code LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortMap = { name: 'full_name COLLATE NOCASE', hireDate: 'hire_date', salary: 'base_salary', role: 'role' };
  const sort = sortMap[params.sort] || sortMap.name;
  const order = String(params.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const total = store.get(`SELECT COUNT(*) AS c FROM staff ${whereSql}`, args).c;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const rows = store.all(
    `SELECT * FROM staff ${whereSql} ORDER BY ${sort} ${order}, id ASC LIMIT ? OFFSET ?`,
    [...args, pageSize, (safePage - 1) * pageSize]
  );
  const totals = store.get(
    "SELECT COUNT(*) AS c, COALESCE(SUM(base_salary),0) AS s FROM staff WHERE is_active = 1"
  );
  return {
    items: rows.map((r) => decorate(r, { today })),
    pagination: { page: safePage, pageSize, total, pages },
    summary: { activeCount: totals.c, monthlyPayroll: Number(totals.s) },
    today,
  };
}

function getById(id) {
  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const row = store.get('SELECT * FROM staff WHERE id = ?', [id]);
  if (!row) throw notFound('الموظف غير موجود');
  const rates = store.all(
    'SELECT id, effective_from, basic, note, created_at FROM staff_salary_rates WHERE staff_id = ? ORDER BY effective_from DESC, id DESC',
    [id]
  );
  const salaries = store.all(
    'SELECT * FROM staff_salaries WHERE staff_id = ? ORDER BY period DESC LIMIT 60',
    [id]
  );
  return {
    ...decorate(row, { today }),
    salaryRates: rates.map((r) => ({
      id: r.id, effectiveFrom: r.effective_from, effectiveFromDisplay: time.formatDdMmYy(r.effective_from),
      basic: Number(r.basic), note: r.note, createdAt: r.created_at,
    })),
    salaryHistory: salaries.map((s) => ({ ...salaryRow(s), label: time.periodLabel(s.period, settings.locale) })),
  };
}

function normalize(payload, settings) {
  const hire = v.dateField(payload.hireDate, 'تاريخ التوظيف');
  const today = time.todayISO(settings.timezone);
  if (hire > today) throw badRequest('تاريخ التوظيف لا يمكن أن يكون في المستقبل');
  return {
    full_name: v.nameField(payload.fullName, 'اسم الموظف'),
    phone: v.phoneField(payload.phone, 'رقم الهاتف'),
    role: v.requiredString(payload.role, 'الدور', { max: 80 }),
    hire_date: hire,
    base_salary: v.amountField(payload.baseSalary, 'الراتب الأساسي'),
    email: payload.email ? v.requiredString(payload.email, 'البريد الإلكتروني', { max: 120 }) : null,
    address: v.optionalString(payload.address, { max: 300 }),
    notes: v.optionalString(payload.notes, { max: 2000 }),
    is_active: payload.isActive === false || payload.isActive === 0 ? 0 : 1,
  };
}

function create(payload) {
  const settings = getSettings();
  const data = normalize(payload, settings);
  const now = new Date().toISOString();
  const code = payload.code || nextCode(settings.staff_code_prefix);
  let id;
  store.transaction(() => {
    const res = store.run(
      `INSERT INTO staff (code, full_name, phone, role, hire_date, base_salary, email, address, notes, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, data.full_name, data.phone, data.role, data.hire_date, data.base_salary, data.email,
        data.address, data.notes, data.is_active, now, now]
    );
    id = res.lastInsertRowid;
    store.run(
      'INSERT INTO staff_salary_rates (staff_id, effective_from, basic, note, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, data.hire_date, data.base_salary, 'الراتب عند التعيين', now]
    );
  });
  return getById(id);
}

/**
 * Editing the base salary never rewrites history: a new rate row is appended and only
 * pay periods starting from the effective date are affected.
 */
function update(id, payload) {
  const existing = store.get('SELECT * FROM staff WHERE id = ?', [id]);
  if (!existing) throw notFound('الموظف غير موجود');
  const settings = getSettings();
  const data = normalize({ ...payload, code: payload.code || existing.code }, settings);
  const now = new Date().toISOString();
  const today = time.todayISO(settings.timezone);
  const effectiveFrom = payload.effectiveFrom
    ? v.dateField(payload.effectiveFrom, 'تاريخ سريان الراتب')
    : (data.hire_date > today ? data.hire_date : today);
  store.transaction(() => {
    store.run(
      `UPDATE staff SET full_name = ?, phone = ?, role = ?, hire_date = ?, base_salary = ?, email = ?,
          address = ?, notes = ?, is_active = ?, code = ?, updated_at = ? WHERE id = ?`,
      [data.full_name, data.phone, data.role, data.hire_date, data.base_salary, data.email, data.address,
        data.notes, data.is_active, existing.code, now, id]
    );
    if (Number(existing.base_salary) !== Number(data.base_salary)) {
      const sameRate = store.get(
        'SELECT id FROM staff_salary_rates WHERE staff_id = ? AND effective_from = ?', [id, effectiveFrom]
      );
      if (sameRate) {
        store.run('UPDATE staff_salary_rates SET basic = ?, note = ? WHERE id = ?',
          [data.base_salary, v.optionalString(payload.rateNote, { max: 300 }), sameRate.id]);
      } else {
        store.run(
          'INSERT INTO staff_salary_rates (staff_id, effective_from, basic, note, created_at) VALUES (?, ?, ?, ?, ?)',
          [id, effectiveFrom, data.base_salary, v.optionalString(payload.rateNote, { max: 300 }) || 'تعديل الراتب', now]
        );
      }
    }
  });
  return getById(id);
}

function remove(id) {
  const existing = store.get('SELECT id FROM staff WHERE id = ?', [id]);
  if (!existing) throw notFound('الموظف غير موجود');
  store.run('DELETE FROM staff WHERE id = ?', [id]);
  return { id };
}

function salaryRow(row, extra = {}) {
  return {
    id: row.id,
    staffId: row.staff_id,
    period: row.period,
    basic: Number(row.basic),
    bonuses: Number(row.bonuses),
    rewards: Number(row.rewards),
    deductions: Number(row.deductions),
    net: Number(row.net),
    status: row.status,
    paidAt: row.paid_at,
    notes: row.notes,
    recorded: Boolean(row.id),
    ...extra,
  };
}

function netOf({ basic, bonuses, rewards, deductions }) {
  return Math.round((Number(basic) + Number(bonuses) + Number(rewards) - Number(deductions)) * 100) / 100;
}

/** Payroll sheet for a period: stored snapshots win, otherwise derived from the rate history. */
function payroll(period) {
  const settings = getSettings();
  const p = v.periodField(period || time.monthKey(settings.timezone), 'الشهر');
  const bounds = time.periodBounds(p);
  const staffRows = store.all(
    `SELECT * FROM staff WHERE hire_date <= ? AND (is_active = 1 OR id IN (SELECT staff_id FROM staff_salaries WHERE period = ?))
     ORDER BY full_name COLLATE NOCASE`,
    [bounds.end, p]
  );
  const stored = new Map(
    store.all('SELECT * FROM staff_salaries WHERE period = ?', [p]).map((r) => [r.staff_id, r])
  );
  const items = staffRows.map((s) => {
    const record = stored.get(s.id);
    if (record) {
      return {
        ...salaryRow(record),
        staffName: s.full_name, staffCode: s.code, role: s.role, hireDate: s.hire_date,
        snapshot: true,
      };
    }
    const basic = basicForPeriod(s.id, p, s.base_salary);
    return {
      id: null, staffId: s.id, period: p, basic, bonuses: 0, rewards: 0, deductions: 0,
      net: netOf({ basic, bonuses: 0, rewards: 0, deductions: 0 }), status: 'pending',
      paidAt: null, notes: null, recorded: false, snapshot: false,
      staffName: s.full_name, staffCode: s.code, role: s.role, hireDate: s.hire_date,
    };
  });
  const totals = items.reduce((acc, i) => ({
    basic: acc.basic + i.basic, bonuses: acc.bonuses + i.bonuses, rewards: acc.rewards + i.rewards,
    deductions: acc.deductions + i.deductions, net: acc.net + i.net,
  }), { basic: 0, bonuses: 0, rewards: 0, deductions: 0, net: 0 });
  return { period: p, label: time.periodLabel(p, settings.locale), items, totals, settings };
}

function savePayroll(period, entries, user) {
  const settings = getSettings();
  const p = v.periodField(period, 'الشهر');
  const now = new Date().toISOString();
  if (!Array.isArray(entries)) throw badRequest('بيانات الرواتب غير صحيحة');
  store.transaction(() => {
    for (const entry of entries) {
      const staffId = v.idField(entry.staffId, 'الموظف');
      const staff = store.get('SELECT id FROM staff WHERE id = ?', [staffId]);
      if (!staff) throw notFound('الموظف غير موجود');
      const basic = entry.basic !== undefined && entry.basic !== ''
        ? v.amountField(entry.basic, 'الراتب الأساسي')
        : basicForPeriod(staffId, p, 0);
      const bonuses = v.amountField(entry.bonuses, 'الحوافز', { required: false });
      const rewards = v.amountField(entry.rewards, 'المكافآت', { required: false });
      const deductions = v.amountField(entry.deductions, 'الخصومات', { required: false });
      const net = netOf({ basic, bonuses, rewards, deductions });
      const status = entry.status === 'paid' ? 'paid' : 'pending';
      const paidAt = status === 'paid' ? (entry.paidAt || now) : null;
      const notes = v.optionalString(entry.notes, { max: 1000 });
      const existing = store.get('SELECT id FROM staff_salaries WHERE staff_id = ? AND period = ?', [staffId, p]);
      if (existing) {
        store.run(
          `UPDATE staff_salaries SET basic = ?, bonuses = ?, rewards = ?, deductions = ?, net = ?, status = ?,
              paid_at = ?, notes = ?, updated_at = ? WHERE id = ?`,
          [basic, bonuses, rewards, deductions, net, status, paidAt, notes, now, existing.id]
        );
      } else {
        store.run(
          `INSERT INTO staff_salaries (staff_id, period, basic, bonuses, rewards, deductions, net, status, paid_at, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [staffId, p, basic, bonuses, rewards, deductions, net, status, paidAt, notes, now, now]
        );
      }
    }
  });
  return payroll(p);
}

function salaryHistory(params = {}) {
  const settings = getSettings();
  const where = [];
  const args = [];
  if (params.period) { where.push('s.period = ?'); args.push(params.period); }
  if (params.year) { where.push('s.period LIKE ?'); args.push(`${params.year}-%`); }
  if (params.staffId) { where.push('s.staff_id = ?'); args.push(Number(params.staffId)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = store.all(
    `SELECT s.*, st.full_name, st.code, st.role FROM staff_salaries s
       JOIN staff st ON st.id = s.staff_id
       ${whereSql} ORDER BY s.period DESC, st.full_name COLLATE NOCASE LIMIT 500`,
    args
  );
  return rows.map((r) => ({
    ...salaryRow(r),
    staffName: r.full_name,
    staffCode: r.code,
    staffRole: r.role,
    label: time.periodLabel(r.period, settings.locale),
  }));
}

function removePayrollRow(id) {
  const row = store.get('SELECT id FROM staff_salaries WHERE id = ?', [id]);
  if (!row) throw notFound('سجل الراتب غير موجود');
  store.run('DELETE FROM staff_salaries WHERE id = ?', [id]);
  return { id };
}

module.exports = {
  list, getById, create, update, remove, payroll, savePayroll, salaryHistory, removePayrollRow,
  basicForPeriod, netOf, decorate,
};
