/**
 * Timezone-safe date engine.
 * ------------------------------------------------------------------
 * Rules used across the whole application:
 *  - Calendar dates (birth date, hire date, expense date, period keys) are stored as
 *    plain 'YYYY-MM-DD' / 'YYYY-MM' strings. They are *civil dates*, never converted.
 *  - Timestamps are stored as ISO-8601 UTC strings (`new Date().toISOString()`).
 *    They are only ever converted to a human string through the configured timezone.
 *  - "Today" is always computed in the configured timezone, never via UTC slicing,
 *    which is what causes the classic "one day off" bug.
 */
'use strict';

const DEFAULT_TZ = 'UTC';

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Returns { year, month, day, hour, minute, second } of `date` in `tz`. */
function partsInTz(date, tz = DEFAULT_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(tz) ? tz : DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const out = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  if (out.hour === '24') out.hour = '00';
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of *now* (or the given instant) inside `tz`. */
function todayISO(tz = DEFAULT_TZ, now = new Date()) {
  const p = partsInTz(now, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function monthKey(tz = DEFAULT_TZ, now = new Date()) {
  return todayISO(tz, now).slice(0, 7);
}

function yearOf(tz = DEFAULT_TZ, now = new Date()) {
  return Number(todayISO(tz, now).slice(0, 4));
}

/** Human timestamp, e.g. "2026-10-29 14:05" rendered in `tz`. */
function formatTimestampUTC(iso, tz = DEFAULT_TZ, locale = 'ar-EG') {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-EG', {
      timeZone: isValidTimezone(tz) ? tz : DEFAULT_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Strict-ish parsing of dd/mm/yy (also accepts dd/mm/yyyy, dd-mm-yy, dd.mm.yy). */
function parseDdMmYy(input) {
  if (input == null || input === '') return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : toISO(input);
  const s = String(input).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (m[3].length === 2) year = year <= 68 ? 2000 + year : 1900 + year;
    if (!isRealDate(year, month, day)) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!isRealDate(year, month, day)) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toISO(d);
}

function isRealDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(year, month) {
  return new Date(Date.prototype.getTime.call(new Date(year, month, 0))).getDate();
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Calendar fields of a 'YYYY-MM-DD' string – no timezone involved (civil date). */
function ymd(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** dd/mm/yyyy <-> dd/mm/yy display helpers (order day/month/year is mandatory). */
function formatDdMmYy(iso, { shortYear = true } = {}) {
  const p = ymd(iso);
  if (!p) return '';
  const y = shortYear ? String(p.year).slice(-2) : String(p.year);
  return `${pad(p.day)}/${pad(p.month)}/${y}`;
}

function formatDdMmYyyy(iso) {
  return formatDdMmYy(iso, { shortYear: false });
}

/** Adds n months to a civil date, clamping the day to the end of the target month. */
function addMonthsClamped(iso, n) {
  const p = ymd(iso);
  if (!p) return null;
  const total = p.year * 12 + (p.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Difference between two civil dates as whole years / months / days.
 * Anchor-based (month-end clamping aware), so 31/08/2015 -> 01/03/2026 = 10y 6m 1d.
 */
function diffYMD(fromISO, toISOString) {
  const a = ymd(fromISO);
  const b = ymd(toISOString);
  if (!a || !b) return { years: 0, months: 0, days: 0 };
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (months < 0) return { years: 0, months: 0, days: 0 };
  let anchor = addMonthsClamped(fromISO, months);
  if (compareISO(anchor, toISOString) > 0) {
    months -= 1;
    anchor = addMonthsClamped(fromISO, months);
  }
  if (months < 0) return { years: 0, months: 0, days: 0 };
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  const days = Math.max(0, daysBetween(anchor, toISOString));
  return { years, months: remMonths, days };
}

function daysBetween(fromISO, toISOString) {
  const a = ymd(fromISO);
  const b = ymd(toISOString);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86400000);
}

function ageOf(birthISO, today) {
  const d = diffYMD(birthISO, today);
  return { ...d, totalDays: daysBetween(birthISO, today) };
}

function durationOf(startISO, today) {
  const d = diffYMD(startISO, today);
  return { ...d, totalDays: Math.max(0, daysBetween(startISO, today)) };
}

function addDaysISO(iso, n) {
  const p = ymd(iso);
  if (!p) return null;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Birthday of `birth` in the year of `today`, adjusted for 29/02. */
function birthdayThisYear(birthISO, todayISOStr) {
  const b = ymd(birthISO);
  const t = ymd(todayISOStr);
  if (!b || !t) return null;
  let day = b.day;
  if (b.month === 2 && b.day === 29 && !isLeap(t.year)) day = 28;
  return `${t.year}-${pad(b.month)}-${pad(day)}`;
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** ['YYYY-01' .. 'YYYY-12'] */
function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
}

function periodOf(isoDate) {
  return String(isoDate || '').slice(0, 7);
}

function periodBounds(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return null;
  const start = `${y}-${pad(m)}-01`;
  const end = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  return { start, end, year: y, month: m };
}

function periodLabel(period, locale = 'ar') {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return period;
  const namesAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const namesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${(locale === 'en' ? namesEn : namesAr)[m - 1]} ${y}`;
}

function addMonthsToPeriod(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

module.exports = {
  DEFAULT_TZ,
  isValidTimezone,
  partsInTz,
  todayISO,
  monthKey,
  yearOf,
  formatTimestampUTC,
  parseDdMmYy,
  formatDdMmYy,
  formatDdMmYyyy,
  diffYMD,
  daysBetween,
  ageOf,
  durationOf,
  addDaysISO,
  birthdayThisYear,
  isLeap,
  monthsOfYear,
  periodOf,
  periodBounds,
  periodLabel,
  addMonthsToPeriod,
  addMonthsClamped,
  daysInMonth,
  ymd,
  pad,
};
