/* Small DOM/UI toolkit: elements, toasts, modals, formatting, small components. */
import { t, getLang, periodLabel, monthName } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  });
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

/* ---------------- toasts ---------------- */
export function toast(message, type = 'info', timeout = 3600) {
  const root = $('#toast-root');
  if (!root) return;
  const node = el('div', { class: `toast ${type}` }, message);
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(-6px)';
    setTimeout(() => node.remove(), 260);
  }, timeout);
}

export const toastSuccess = (m) => toast(m, 'success');
export const toastError = (m) => toast(m, 'error', 5000);

/* ---------------- modal ---------------- */
export function modal({ title = '', body = '', footer = null, size = '', onClose = null, closable = true }) {
  const root = $('#modal-root');
  const backdrop = el('div', { class: 'modal-backdrop' });
  const box = el('div', { class: `modal ${size}`.trim(), role: 'dialog', 'aria-modal': 'true' });
  const head = el('div', { class: 'modal-head' },
    el('h3', {}, title),
    closable ? el('button', { class: 'modal-close', type: 'button', 'aria-label': 'close', onclick: () => close() }, '×') : null);
  const bodyNode = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyNode.innerHTML = body; else bodyNode.appendChild(body);
  box.append(head, bodyNode);
  if (footer) {
    const footNode = typeof footer === 'string' ? el('div', { class: 'modal-foot', html: footer }) : el('div', { class: 'modal-foot' }, footer);
    box.appendChild(footNode);
  }
  backdrop.appendChild(box);
  root.appendChild(backdrop);
  const previouslyFocused = document.activeElement;

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape' && closable) close();
  }
  if (closable) {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
  }
  setTimeout(() => {
    const focusable = box.querySelector('input, select, textarea, button:not(.modal-close)');
    if (focusable) focusable.focus();
  }, 60);
  return { close, body: bodyNode, box };
}

export function confirmDialog({ title = '', message = '', confirmText = null, cancelText = null, danger = false }) {
  return new Promise((resolve) => {
    const foot = el('div', { style: 'display:flex;gap:10px' });
    const cancelBtn = el('button', { class: 'btn secondary', type: 'button' }, cancelText || t('common.cancel'));
    const okBtn = el('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'button' }, confirmText || t('common.confirm'));
    foot.append(cancelBtn, okBtn);
    const m = modal({ title, body: el('div', { html: `<p style="font-size:1.02rem;line-height:1.8;margin:0">${esc(message)}</p>` }), footer: foot, size: 'narrow' });
    cancelBtn.addEventListener('click', () => { m.close(); resolve(false); });
    okBtn.addEventListener('click', () => { m.close(); resolve(true); });
    setTimeout(() => okBtn.focus(), 80);
  });
}

/* ---------------- formatting ---------------- */
export function money(value, settings = {}) {
  const n = Number(value) || 0;
  const formatted = new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  const symbol = settings && settings.currency_symbol ? ` ${settings.currency_symbol}` : '';
  return `${formatted}${symbol}`;
}

export function plainNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

/** Civil date 'YYYY-MM-DD' -> dd/mm/yy (no timezone conversion). */
export function fmtDate(iso, { long = false } = {}) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const y = long ? m[1] : m[1].slice(2);
  return `${m[3]}/${m[2]}/${y}`;
}

export function fmtTimestamp(iso, timezone) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-GB' : 'ar-EG', {
      timeZone: timezone || undefined,
      dateStyle: 'short', timeStyle: 'short', numberingSystem: 'latn',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function relativeTime(iso) {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return getLang() === 'en' ? 'just now' : 'الآن';
  if (mins < 60) return getLang() === 'en' ? `${mins}m ago` : `منذ ${mins} دقيقة`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return getLang() === 'en' ? `${hours}h ago` : `منذ ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return getLang() === 'en' ? `${days}d ago` : `منذ ${days} يوم`;
  return fmtTimestamp(iso);
}

/** "3 سنة 9 شهر 14 يوم" – days, months, years order as required. */
export function durationLabel(d) {
  if (!d) return '—';
  const lang = getLang();
  const unit = (n, ar, en) => `${n} ${lang === 'en' ? (n === 1 ? en : `${en}s`) : ar}`;
  return [unit(d.days, 'يوم', 'day'), unit(d.months, 'شهر', 'month'), unit(d.years, 'سنة', 'year')].join(' ');
}

export function ageLabel(d) {
  if (!d) return '—';
  return durationLabel(d);
}

export function monthLabel(period) { return periodLabel(period); }

/* ---------------- components ---------------- */
export function statCard({ label, value, hint, variant = '' }) {
  return `<div class="stat ${variant}">
    <div class="label">${esc(label)}</div>
    <div class="value">${value}</div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;
}

export function emptyState(message = null, emoji = '📭') {
  return `<div class="empty"><span class="emoji">${emoji}</span>${esc(message || t('common.noData'))}</div>`;
}

export function loadingState() {
  return `<div class="loading"><div class="spinner"></div></div>`;
}

export function pager({ page, pages, total }, onGo) {
  const wrap = el('div', { class: 'pager' });
  const info = el('div', { class: 'muted small' },
    `${t('common.page')} ${page} ${t('common.of')} ${pages} • ${plainNumber(total)} ${getLang() === 'en' ? 'records' : 'سجل'}`);
  const pagesBox = el('div', { class: 'pages' });
  const btn = (label, target, { active = false, disabled = false } = {}) => {
    const b = el('button', { type: 'button', class: active ? 'active' : '', disabled: disabled || false }, label);
    b.addEventListener('click', () => { if (!disabled && !active) onGo(target); });
    return b;
  };
  pagesBox.append(btn('‹', page - 1, { disabled: page <= 1 }));
  const windowSize = 2;
  const start = Math.max(1, page - windowSize);
  const end = Math.min(pages, page + windowSize);
  if (start > 1) pagesBox.append(btn('1', 1, { active: page === 1 }), el('span', { class: 'muted' }, '…'));
  for (let i = start; i <= end; i += 1) pagesBox.append(btn(String(i), i, { active: i === page }));
  if (end < pages) pagesBox.append(el('span', { class: 'muted' }, '…'), btn(String(pages), pages, { active: page === pages }));
  pagesBox.append(btn('›', page + 1, { disabled: page >= pages }));
  wrap.append(info, pagesBox);
  return wrap;
}

export function debounce(fn, delay = 320) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Serialises a <form> into a plain object (trimmed strings). */
export function formValues(form) {
  const out = {};
  new FormData(form).forEach((value, key) => {
    out[key] = typeof value === 'string' ? value.trim() : value;
  });
  return out;
}

/* ---------------- client-side validation ---------------- */
export const validators = {
  letters(value) {
    const v = String(value || '').trim();
    if (!v) return t('common.required');
    if (/\d/.test(v)) return getLang() === 'en' ? 'Letters only — no digits' : 'حروف فقط بدون أرقام';
    if (!/^[\u0621-\u064A\s'’\-A-Za-z\u00C0-\u024F]+$/.test(v)) return getLang() === 'en' ? 'Invalid characters' : 'يحتوي على رموز غير مسموحة';
    return null;
  },
  digits(value, { required = true, min = 4, max = 15 } = {}) {
    const v = String(value || '').replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    if (!v.trim()) return required ? t('common.required') : null;
    if (!/^\d+$/.test(v.trim())) return getLang() === 'en' ? 'Digits only' : 'أرقام فقط';
    if (v.trim().length < min || v.trim().length > max) return getLang() === 'en' ? `Must be ${min}-${max} digits` : `يجب أن يكون ${min}-${max} رقمًا`;
    return null;
  },
  date(value, { required = true } = {}) {
    const v = String(value || '').trim();
    if (!v) return required ? t('common.required') : null;
    const m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!m) return getLang() === 'en' ? 'Use dd/mm/yy' : 'استخدم الصيغة يوم/شهر/سنة';
    const day = Number(m[1]); const month = Number(m[2]); let year = Number(m[3]);
    if (m[3].length === 2) year += year <= 68 ? 2000 : 1900;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return getLang() === 'en' ? 'Invalid date' : 'تاريخ غير صحيح';
    }
    return null;
  },
  money(value, { min = 0 } = {}) {
    const v = String(value ?? '').trim();
    if (!v) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return getLang() === 'en' ? 'Invalid amount' : 'مبلغ غير صحيح';
    if (Number(v) < min) return getLang() === 'en' ? `Minimum ${min}` : `الحد الأدنى ${min}`;
    return null;
  },
};

export function setFieldError(input, message) {
  if (!input) return;
  const field = input.closest('.field');
  input.classList.toggle('invalid', Boolean(message));
  let node = field ? field.querySelector('.field-error') : null;
  if (!node && field) {
    node = el('div', { class: 'field-error' });
    field.appendChild(node);
  }
  if (node) node.textContent = message || '';
}

export function clearErrors(form) {
  $$('.invalid', form).forEach((n) => n.classList.remove('invalid'));
  $$('.field-error', form).forEach((n) => n.remove());
}

export function toastApiError(err) {
  if (!err) return;
  if (err.code === 'unauthorized') return;
  toastError(err.message || t('common.error'));
}

export { monthName };
