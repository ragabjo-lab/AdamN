/* Client-side civil-date helpers – mirror of server/lib/time.js (no UTC slicing). */
const pad = (n) => String(n).padStart(2, '0');

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

export function ymd(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
}

/** Accepts dd/mm/yy, dd/mm/yyyy, dd-mm-yy, dd.mm.yy -> 'YYYY-MM-DD'. */
export function parseDdMmYy(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const day = +m[1]; const month = +m[2]; let year = +m[3];
    if (m[3].length === 2) year = year <= 68 ? 2000 + year : 1900 + year;
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [year, month, day] = [+m[1], +m[2], +m[3]];
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  return null;
}

export function isoToDisplay(iso, { long = false } = {}) {
  const p = ymd(iso);
  if (!p) return '';
  return `${pad(p.day)}/${pad(p.month)}/${long ? p.year : String(p.year).slice(2)}`;
}

export function addMonthsClamped(iso, n) {
  const p = ymd(iso);
  if (!p) return null;
  const total = p.year * 12 + (p.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function daysBetween(fromISO, toISOString) {
  const a = ymd(fromISO); const b = ymd(toISOString);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

export function diffYMD(fromISO, toISOString) {
  const a = ymd(fromISO); const b = ymd(toISOString);
  if (!a || !b) return { years: 0, months: 0, days: 0 };
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (months < 0) return { years: 0, months: 0, days: 0 };
  let anchor = addMonthsClamped(fromISO, months);
  if (anchor > toISOString) {
    months -= 1;
    anchor = addMonthsClamped(fromISO, months);
  }
  if (months < 0) return { years: 0, months: 0, days: 0 };
  return { years: Math.floor(months / 12), months: months % 12, days: Math.max(0, daysBetween(anchor, toISOString)) };
}

export function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
}

export function currentPeriod(now = new Date()) {
  return todayISO(now).slice(0, 7);
}

export function yearOfPeriod(period) {
  return Number(String(period).slice(0, 4));
}

export function shiftPeriod(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}
