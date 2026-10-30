'use strict';
const { store } = require('../db/connection');
const { systemTimezone } = require('../config');
const { isValidTimezone } = require('../lib/time');
const { badRequest } = require('../lib/errors');

const DEFAULT_REVENUE_CATEGORIES = ['اشتراك شهري', 'أنشطة', 'زي مدرسي', 'مستلزمات', 'تبرعات', 'أخرى'];
const DEFAULT_EXPENSE_CATEGORIES = ['رواتب', 'إيجار', 'كهرباء ومياه', 'صيانة', 'مستلزمات', 'أنشطة', 'مواصلات', 'أخرى'];

function defaults() {
  return {
    nursery_name: 'حضانة AdamN',
    nursery_phone: '',
    nursery_address: '',
    nursery_logo: '',
    timezone: systemTimezone(),
    locale: 'ar',
    currency_code: 'EGP',
    currency_symbol: 'ج.م',
    default_subscription_fee: 0,
    subscription_due_day: 5,
    student_code_prefix: 'STU',
    staff_code_prefix: 'EMP',
    revenue_categories: DEFAULT_REVENUE_CATEGORIES,
    expense_categories: DEFAULT_EXPENSE_CATEGORIES,
    birthday_notifications: true,
    unpaid_notifications: true,
    salary_notifications: true,
    backup_daily: true,
    backup_keep: 14,
    last_daily_run: null,
    last_backup_at: null,
    theme: 'light',
    receipt_footer: 'شكرًا لتعاملكم معنا',
  };
}

function ensureDefaults() {
  const d = defaults();
  const existing = new Set(store.all('SELECT key FROM settings').map((r) => r.key));
  store.transaction(() => {
    for (const [key, value] of Object.entries(d)) {
      if (!existing.has(key)) store.setSetting(key, value);
    }
  });
}

function getSettings() {
  const d = defaults();
  const raw = {};
  for (const row of store.all('SELECT key, value FROM settings')) {
    try { raw[row.key] = JSON.parse(row.value); } catch { raw[row.key] = row.value; }
  }
  const merged = { ...d, ...raw };
  if (!isValidTimezone(merged.timezone)) merged.timezone = systemTimezone();
  merged.default_subscription_fee = Number(merged.default_subscription_fee) || 0;
  merged.subscription_due_day = Math.min(28, Math.max(1, Number(merged.subscription_due_day) || 5));
  if (!Array.isArray(merged.revenue_categories) || !merged.revenue_categories.length) {
    merged.revenue_categories = DEFAULT_REVENUE_CATEGORIES;
  }
  if (!Array.isArray(merged.expense_categories) || !merged.expense_categories.length) {
    merged.expense_categories = DEFAULT_EXPENSE_CATEGORIES;
  }
  merged.timezone = merged.timezone || 'UTC';
  merged.locale = merged.locale === 'en' ? 'en' : 'ar';
  return merged;
}

const ALLOWED_KEYS = new Set(Object.keys(defaults()));

function updateSettings(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!ALLOWED_KEYS.has(key)) continue;
    clean[key] = value;
  }
  if (clean.timezone !== undefined && !isValidTimezone(clean.timezone)) {
    throw badRequest('المنطقة الزمنية غير صحيحة');
  }
  if (clean.locale !== undefined && !['ar', 'en'].includes(clean.locale)) {
    throw badRequest('اللغة يجب أن تكون ar أو en');
  }
  if (clean.default_subscription_fee !== undefined) {
    const n = Number(clean.default_subscription_fee);
    if (!Number.isFinite(n) || n < 0) throw badRequest('قيمة الاشتراك الشهري غير صحيحة');
    clean.default_subscription_fee = Math.round(n * 100) / 100;
  }
  if (clean.subscription_due_day !== undefined) {
    const n = Number(clean.subscription_due_day);
    if (!Number.isInteger(n) || n < 1 || n > 28) throw badRequest('يوم الاستحقاق يجب أن يكون بين 1 و28');
    clean.subscription_due_day = n;
  }
  for (const key of ['revenue_categories', 'expense_categories']) {
    if (clean[key] !== undefined) {
      if (!Array.isArray(clean[key]) || clean[key].some((v) => typeof v !== 'string' || !v.trim())) {
        throw badRequest('قائمة التصنيفات غير صحيحة');
      }
      clean[key] = clean[key].map((v) => v.trim()).slice(0, 40);
    }
  }
  store.transaction(() => {
    for (const [key, value] of Object.entries(clean)) store.setSetting(key, value);
  });
  return getSettings();
}

module.exports = { getSettings, updateSettings, ensureDefaults, defaults };
