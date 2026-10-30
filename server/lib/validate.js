'use strict';
const { badRequest } = require('./errors');
const time = require('./time');

const AR_LETTER = /[\u0621-\u064A\u0660-\u0669]/;
const LETTERS_ONLY = /^[\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u0629\u0649\u064B-\u0652\s'’\-A-Za-z\u00C0-\u024F]+$/;
const PHONE_RE = /^[+]?[\d\s\-()]{4,20}$/;

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\u200f|\u200e/g, '').trim();
}

function requiredString(value, field, { min = 1, max = 400 } = {}) {
  const v = clean(value);
  if (!v) throw badRequest(`الحقل «${field}» مطلوب`);
  if (v.length < min) throw badRequest(`الحقل «${field}» قصير جدًا`);
  if (v.length > max) throw badRequest(`الحقل «${field}» أطول من المسموح (${max})`);
  return v;
}

function optionalString(value, { max = 2000 } = {}) {
  const v = clean(value);
  if (!v) return null;
  return v.slice(0, max);
}

/** Names must be letters only (Arabic or Latin) – enforced server side. */
function nameField(value, field = 'الاسم', { max = 120 } = {}) {
  const v = requiredString(value, field, { max });
  if (/\d/.test(v)) throw badRequest(`الحقل «${field}» يقبل حروفًا فقط بدون أرقام`);
  if (!LETTERS_ONLY.test(v)) throw badRequest(`الحقل «${field}» يحتوي على رموز غير مسموحة (حروف فقط)`);
  return v.replace(/\s+/g, ' ');
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function normalizeDigits(value) {
  return clean(value)
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/** Guardian phone – digits only (a leading + and separators are tolerated then stripped). */
function phoneField(value, field = 'رقم الهاتف', { required = true } = {}) {
  const v = normalizeDigits(value);
  if (!v) {
    if (required) throw badRequest(`الحقل «${field}» مطلوب`);
    return null;
  }
  if (!PHONE_RE.test(v)) throw badRequest(`الحقل «${field}» أرقام فقط`);
  const digits = v.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 15) throw badRequest(`الحقل «${field}» يجب أن يتكون من 4 إلى 15 رقمًا`);
  return digits;
}

function amountField(value, field = 'المبلغ', { required = true, allowNegative = false, max = 100000000 } = {}) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw badRequest(`الحقل «${field}» مطلوب`);
    return 0;
  }
  const n = Number(normalizeDigits(value));
  if (!Number.isFinite(n)) throw badRequest(`الحقل «${field}» يجب أن يكون رقمًا`);
  if (!allowNegative && n < 0) throw badRequest(`الحقل «${field}» لا يقبل قيمة سالبة`);
  if (Math.abs(n) > max) throw badRequest(`الحقل «${field}» أكبر من الحد المسموح`);
  return Math.round(n * 100) / 100;
}

function dateField(value, field = 'التاريخ', { required = true, minYear = 1900 } = {}) {
  const v = clean(value);
  if (!v) {
    if (required) throw badRequest(`الحقل «${field}» مطلوب`);
    return null;
  }
  const iso = time.parseDdMmYy(v);
  if (!iso) throw badRequest(`الحقل «${field}» غير صحيح، استخدم الصيغة يوم/شهر/سنة (dd/mm/yy)`);
  const year = Number(iso.slice(0, 4));
  if (year < minYear) throw badRequest(`الحقل «${field}» سنة غير صحيحة`);
  return iso;
}

function periodField(value, field = 'الشهر') {
  const v = clean(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw badRequest(`الحقل «${field}» يجب أن يكون بصيغة YYYY-MM`);
  return v;
}

function enumField(value, allowed, field, fallback) {
  const v = clean(value);
  if (!v) {
    if (fallback !== undefined) return fallback;
    throw badRequest(`الحقل «${field}» مطلوب`);
  }
  if (!allowed.includes(v)) throw badRequest(`قيمة غير صحيحة للحقل «${field}»`);
  return v;
}

function intField(value, field, { min = 0, max = 1e9, fallback = 0 } = {}) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(normalizeDigits(value));
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`قيمة غير صحيحة للحقل «${field}»`);
  return n;
}

function idField(value, field = 'المعرّف') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} غير صحيح`);
  return n;
}

module.exports = {
  clean, requiredString, optionalString, nameField, phoneField, amountField, dateField,
  periodField, enumField, intField, idField, normalizeDigits, AR_LETTER,
};
