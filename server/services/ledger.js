'use strict';
/** Revenue & expense ledgers share the same shape (date, description, amount, category, notes). */
const { store } = require('../db/connection');
const time = require('../lib/time');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { getSettings } = require('./settings');

const TABLES = {
  revenue: { table: 'revenues', label: 'الإيرادات الأخرى', categoriesKey: 'revenue_categories' },
  expense: { table: 'expenses', label: 'المصروفات', categoriesKey: 'expense_categories' },
};

function meta(kind) {
  const cfg = TABLES[kind];
  if (!cfg) throw badRequest('نوع السجل غير صحيح');
  return cfg;
}

function row(kind, r) {
  return {
    id: r.id,
    kind,
    date: r.date,
    dateDisplay: time.formatDdMmYy(r.date),
    description: r.description,
    amount: Number(r.amount),
    category: r.category,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    period: time.periodOf(r.date),
  };
}

function list(kind, params = {}) {
  const cfg = meta(kind);
  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const where = [];
  const args = [];
  const q = (params.q || '').trim();
  if (q) {
    where.push('(description LIKE ? OR notes LIKE ? OR category LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (params.year && /^\d{4}$/.test(String(params.year))) {
    where.push("substr(date, 1, 4) = ?");
    args.push(String(params.year));
  }
  if (params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.month))) {
    where.push('substr(date, 1, 7) = ?');
    args.push(String(params.month));
  }
  if (params.day && /^\d{4}-\d{2}-\d{2}$/.test(String(params.day))) {
    where.push('date = ?');
    args.push(String(params.day));
  }
  if (params.from) { where.push('date >= ?'); args.push(String(params.from)); }
  if (params.to) { where.push('date <= ?'); args.push(String(params.to)); }
  if (params.category) { where.push('category = ?'); args.push(String(params.category)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(200, Math.max(5, Number(params.pageSize) || 12));
  const order = String(params.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sortMap = { date: 'date', amount: 'amount', category: 'category', description: 'description' };
  const sort = sortMap[params.sort] || 'date';

  const totals = store.get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS sum FROM ${cfg.table} ${whereSql}`, args
  );
  const total = totals.c;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const rows = store.all(
    `SELECT * FROM ${cfg.table} ${whereSql} ORDER BY ${sort} ${order}, id DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (safePage - 1) * pageSize]
  );
  const monthSum = store.get(
    `SELECT COALESCE(SUM(amount),0) AS s FROM ${cfg.table} WHERE substr(date,1,7) = ?`,
    [time.monthKey(settings.timezone)]
  ).s;
  const yearSum = store.get(
    `SELECT COALESCE(SUM(amount),0) AS s FROM ${cfg.table} WHERE substr(date,1,4) = ?`,
    [String(Number(today.slice(0, 4)))]
  ).s;
  const byCategory = store.all(
    `SELECT category, COUNT(*) AS count, COALESCE(SUM(amount),0) AS sum FROM ${cfg.table}
      GROUP BY category ORDER BY sum DESC`
  );
  return {
    items: rows.map((r) => row(kind, r)),
    pagination: { page: safePage, pageSize, total, pages },
    summary: {
      filteredTotal: Number(totals.sum),
      monthTotal: Number(monthSum),
      yearTotal: Number(yearSum),
      count: Number(total),
      byCategory: byCategory.map((c) => ({ category: c.category, count: c.count, total: Number(c.sum) })),
    },
    categories: settings[cfg.categoriesKey],
    context: { today, timezone: settings.timezone },
  };
}

function normalize(kind, payload, settings) {
  const cfg = meta(kind);
  const categories = settings[cfg.categoriesKey] || [];
  const category = v.optionalString(payload.category, { max: 80 }) || categories[categories.length - 1] || 'أخرى';
  return {
    date: v.dateField(payload.date, 'التاريخ'),
    description: v.requiredString(payload.description, 'البيان', { max: 300 }),
    amount: v.amountField(payload.amount, 'المبلغ'),
    category,
    notes: v.optionalString(payload.notes, { max: 2000 }),
  };
}

function create(kind, payload, user) {
  const cfg = meta(kind);
  const settings = getSettings();
  const data = normalize(kind, payload, settings);
  const now = new Date().toISOString();
  const res = store.run(
    `INSERT INTO ${cfg.table} (date, description, amount, category, notes, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.date, data.description, data.amount, data.category, data.notes, now, now, user ? user.id : null]
  );
  return row(kind, store.get(`SELECT * FROM ${cfg.table} WHERE id = ?`, [res.lastInsertRowid]));
}

function update(kind, id, payload) {
  const cfg = meta(kind);
  const existing = store.get(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
  if (!existing) throw notFound('السجل غير موجود');
  const settings = getSettings();
  const data = normalize(kind, payload, settings);
  store.run(
    `UPDATE ${cfg.table} SET date = ?, description = ?, amount = ?, category = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [data.date, data.description, data.amount, data.category, data.notes, new Date().toISOString(), id]
  );
  return row(kind, store.get(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]));
}

function remove(kind, id) {
  const cfg = meta(kind);
  const existing = store.get(`SELECT id FROM ${cfg.table} WHERE id = ?`, [id]);
  if (!existing) throw notFound('السجل غير موجود');
  store.run(`DELETE FROM ${cfg.table} WHERE id = ?`, [id]);
  return { id };
}

function forPeriod(kind, period) {
  const cfg = meta(kind);
  const bounds = time.periodBounds(period);
  const rows = store.all(
    `SELECT * FROM ${cfg.table} WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC`,
    [bounds.start, bounds.end]
  );
  return rows.map((r) => row(kind, r));
}

module.exports = { list, create, update, remove, forPeriod, TABLES };
