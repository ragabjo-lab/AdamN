import { api, setUnauthorizedHandler, ApiError } from './api.js';
import { setLang, getLang, applyTranslations, t, roleLabel, pick } from './i18n.js';
import { $, $$, esc, el, toast, toastError, toastSuccess, modal, fmtTimestamp, relativeTime } from './ui.js';
import loginView from './views/login.js';
import studentsView from './views/students.js';
import staffView from './views/staff.js';
import revenueView from './views/revenue.js';
import expensesView from './views/expenses.js';
import financeView from './views/finance.js';
import settingsView from './views/settings.js';

export const state = {
  user: null,
  settings: {},
  unread: 0,
  lang: getLang(),
  timezone: 'UTC',
  view: null,
  viewName: null,
  params: {},
};

const VIEWS = {
  students: studentsView,
  staff: staffView,
  revenue: revenueView,
  expenses: expensesView,
  finance: financeView,
  settings: settingsView,
};

const DEFAULT_ROUTE = 'students';

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
export function hasPerm(permission) {
  const perms = (state.user && state.user.permissions) || [];
  return perms.includes('*') || perms.includes(permission);
}

export function serviceToken() { return api; }

export function settingsObject() { return state.settings || {}; }

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { name: DEFAULT_ROUTE, params: {} };
  const [name, queryString] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(queryString || ''));
  return { name: name || DEFAULT_ROUTE, params };
}

export function navigate(path) {
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`;
  if (location.hash === target) renderRoute();
  else location.hash = target;
}

function setActiveTab(name) {
  $$('#main-tabs .tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });
}

/* ------------------------------------------------------------------ */
/* notifications                                                      */
/* ------------------------------------------------------------------ */
async function refreshUnread() {
  try {
    const { unread } = await api.get('/notifications/count');
    state.unread = unread;
    renderBadge();
  } catch { /* ignore */ }
}

function renderBadge() {
  const badge = $('#notif-badge');
  if (!badge) return;
  if (state.unread > 0) {
    badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function toggleNotifications() {
  const panel = $('#notif-panel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  await loadNotificationsPanel();
}

async function loadNotificationsPanel() {
  const panel = $('#notif-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.innerHTML = `<div class="notif-panel-loading loading"><div class="spinner"></div></div>`;
  try {
    const data = await api.get('/notifications?pageSize=12');
    state.unread = data.unread;
    renderBadge();
    const lang = getLang();
    const items = data.items.map((n) => `
      <button class="notif-item ${n.isRead ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}">
        <span class="dot ${esc(n.severity)}"></span>
        <span class="content">
          <span class="title">${esc(lang === 'en' ? n.titleEn : n.titleAr)}</span>
          ${n.bodyAr || n.bodyEn ? `<span class="body">${esc(lang === 'en' ? (n.bodyEn || n.bodyAr) : (n.bodyAr || n.bodyEn))}</span>` : ''}
          <span class="time">${esc(relativeTime(n.createdAt))}</span>
        </span>
      </button>`).join('');
    panel.innerHTML = `
      <header>
        <strong>${esc(t('notif.title'))}</strong>
        <span style="display:flex;gap:6px">
          <button class="btn sm secondary" data-notif-action="refresh">↻</button>
          <button class="btn sm secondary" data-notif-action="read-all">${esc(t('notif.markAll'))}</button>
        </span>
      </header>
      <div class="notif-list">${items || `<div class="notif-empty">${esc(t('notif.empty'))}</div>`}</div>
      <div style="padding:9px 14px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px">
        <span class="muted small">${data.unread} ${esc(t('notif.unread'))}</span>
        <button class="btn sm ghost" data-notif-action="clear-read">${esc(t('notif.clearRead'))}</button>
      </div>`;

    panel.querySelectorAll('.notif-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try { await api.post(`/notifications/${btn.dataset.id}/read`, {}); } catch { /* ignore */ }
        if (btn.dataset.link) {
          const link = btn.dataset.link.replace(/^#?\/?/, '');
          panel.classList.add('hidden');
          navigate(link);
        } else {
          btn.classList.remove('unread');
        }
        refreshUnread();
      });
    });
    panel.querySelectorAll('[data-notif-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.notifAction;
        try {
          if (action === 'read-all') await api.post('/notifications/read-all', {});
          if (action === 'clear-read') await api.del('/notifications/read');
          if (action === 'refresh') await api.post('/notifications/refresh', {});
        } catch (err) { toastError(err.message); }
        await loadNotificationsPanel();
        await refreshUnread();
      });
    });
  } catch (err) {
    panel.innerHTML = `<div class="notif-empty">${esc(err.message)}</div>`;
  }
}

/* ------------------------------------------------------------------ */
/* shell                                                              */
/* ------------------------------------------------------------------ */
function paintShell() {
  const user = state.user || {};
  $('#brand-nursery').textContent = state.settings.nursery_name || t('app.tagline');
  $('#user-name').textContent = user.fullName || '—';
  $('#user-role').textContent = roleLabel(user.role);
  $('#user-avatar').textContent = (user.fullName || '?').trim().charAt(0);
  $('#footer-file').textContent = state.dataFileName
    ? `${state.dataFileName}` : 'HDANA';
  $('#footer-tz').textContent = `${t('settings.timezone')}: ${state.timezone}`;
  $('#lang-label').textContent = getLang() === 'ar' ? 'EN' : 'ع';
  applyTranslations(document);
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    const val = t(key, null);
    if (val) node.textContent = val;
  });
  renderBadge();
}

function showShell(show) {
  $('#app').classList.toggle('hidden', !show);
  $('#login-root').classList.toggle('hidden', show);
  $('.tabs')?.classList.toggle('hidden', !show);
}

async function renderRoute() {
  const { name, params } = parseHash();
  const view = VIEWS[name] || VIEWS[DEFAULT_ROUTE];
  const routeName = VIEWS[name] ? name : DEFAULT_ROUTE;
  if (state.view && state.view.destroy) {
    try { state.view.destroy(); } catch { /* ignore */ }
  }
  state.viewName = routeName;
  state.params = params;
  setActiveTab(routeName);
  const root = $('#view');
  root.innerHTML = '';
  root.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  try {
    state.view = await view.mount(root, params, { state, hasPerm, navigate, onSettingsChanged: handleSettingsChanged });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'unauthorized') return;
    root.innerHTML = `<div class="card"><div class="card-body"><h2>${esc(t('common.error'))}</h2><p class="muted">${esc(err.message || '')}</p>
      <button class="btn" onclick="location.reload()">${esc(t('common.confirm'))}</button></div></div>`;
  }
}

function handleSettingsChanged(settings) {
  state.settings = settings;
  state.timezone = settings.timezone;
  setLang(settings.locale || getLang(), { persist: false });
  paintShell();
  renderRoute();
}

async function loadSession() {
  const me = await api.get('/auth/me');
  state.user = me.user;
  state.settings = me.settings || {};
  state.timezone = state.settings.timezone || 'UTC';
  state.unread = me.unread || 0;
  try {
    const dataFile = await api.get('/settings/data-file');
    state.dataFileName = dataFile.info.fileName;
    state.dataFilePath = dataFile.info.path;
  } catch { /* ignore */ documentTitle(); }
  return me;
}

function documentTitle() {
  document.title = `${state.settings.nursery_name || 'AdamN'} • AdamN NMS`;
}

/* ------------------------------------------------------------------ */
/* auth                                                               */
/* ------------------------------------------------------------------ */
async function showLogin({ setup = false, message = '' } = {}) {
  showShell(false);
  state.user = null;
  const root = $('#login-root');
  await loginView.mount(root, { setup, message, onSuccess: onLoggedIn });
}

async function onLoggedIn(payload) {
  if (payload && payload.user) {
    state.user = payload.user;
    state.settings = payload.settings || state.settings;
    state.timezone = (payload.settings || {}).timezone || state.timezone;
  }
  await loadSession().catch(() => {});
  paintShell();
  documentTitle();
  showShell(true);
  const next = new URLSearchParams(location.search).get('next');
  if (next) {
    window.location.href = next;
    return;
  }
  if (!location.hash) navigate(`/${DEFAULT_ROUTE}`);
  else renderRoute();
  refreshUnread();
}

async function logout() {
  try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
  state.user = null;
  toast(t('auth.loggedOut'));
  await showLogin();
}

/* ------------------------------------------------------------------ */
/* password modal                                                     */
/* ------------------------------------------------------------------ */
function openPasswordModal(force = false) {
  const form = el('form', { class: 'grid-form', style: 'grid-template-columns:1fr' });
  form.innerHTML = `
    <div class="field"><label>${esc(t('auth.currentPassword'))}</label><input type="password" name="currentPassword" autocomplete="current-password" required></div>
    <div class="field"><label>${esc(t('auth.newPassword'))}</label><input type="password" name="newPassword" autocomplete="new-password" minlength="8" required>
      <div class="hint">${esc(getLang() === 'en' ? 'At least 8 characters with letters and digits' : '8 أحرف على الأقل وتحتوي حروفًا وأرقامًا')}</div></div>
    <div class="field"><label>${esc(t('auth.confirmPassword'))}</label><input type="password" name="confirmPassword" autocomplete="new-password" required></div>`;
  const foot = el('div', { style: 'display:flex;gap:10px' });
  const cancel = el('button', { class: 'btn secondary', type: 'button' }, t('common.cancel'));
  const submit = el('button', { class: 'btn', type: 'submit', form: 'password-form' }, t('common.save'));
  foot.append(cancel, submit);
  form.id = 'password-form';
  const m = modal({ title: t('auth.changePassword'), body: form, footer: foot, size: 'narrow', closable: !force });
  cancel.addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.newPassword !== values.confirmPassword) {
      toastError(t('auth.mismatch'));
      return;
    }
    try {
      await api.post('/auth/password', { currentPassword: values.currentPassword, newPassword: values.newPassword });
      toastSuccess(t('auth.passwordChanged'));
      m.close();
      if (state.user) state.user.mustChangePassword = false;
    } catch (err) { toastError(err.message); }
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */
function wireShell() {
  $('#btn-lang').addEventListener('click', () => {
    const next = getLang() === 'ar' ? 'en' : 'ar';
    setLang(next);
    paintShell();
    renderRoute();
    refreshUnread();
  });

  $('#btn-notifications').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNotifications();
  });
  document.addEventListener('click', (e) => {
    const panel = $('#notif-panel');
    if (panel && !panel.classList.contains('hidden') && !e.target.closest('.notif-wrap')) {
      panel.classList.add('hidden');
    }
    const menu = $('#user-menu');
    if (menu && !menu.classList.contains('hidden') && !e.target.closest('.user-wrap')) {
      menu.classList.add('hidden');
    }
  });

  $('#btn-user').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#user-menu').classList.toggle('hidden');
  });

  $('#user-menu').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    $('#user-menu').classList.add('hidden');
    const action = btn.dataset.action;
    if (action === 'logout') logout();
    if (action === 'password') openPasswordModal();
    if (action === 'settings') navigate('/settings');
  });

  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    renderRoute();
  });

  setInterval(() => { if (state.user) refreshUnread(); }, 60000);
}

async function boot() {
  setLang(getLang());
  setUnauthorizedHandler(() => {
    if (state.user) {
      state.user = null;
      toastError(t('auth.loggedOut'));
      showLogin();
    }
  });
  wireShell();
  try {
    const health = await api.get('/health');
    state.serverInfo = health;
    const setupStatus = await api.get('/auth/setup-status');
    if (setupStatus.needsSetup) {
      await showLogin({ setup: true });
      return;
    }
    try {
      await loadSession();
      paintShell();
      documentTitle();
      showShell(true);
      if (!location.hash) navigate(`/${DEFAULT_ROUTE}`);
      else renderRoute();
      refreshUnread();
      if (state.user.mustChangePassword) {
        setTimeout(() => openPasswordModal(true), 400);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await showLogin();
      } else {
        throw err;
      }
    }
  } catch (err) {
    $('#login-root').classList.remove('hidden');
    $('#login-root').innerHTML = `<div class="auth-screen"><div class="auth-form-wrap"><div class="auth-card">
      <h2>${esc(t('common.error'))}</h2><p class="muted">${esc(err.message || '')}</p>
      <button class="btn" onclick="location.reload()">${esc(getLang() === 'en' ? 'Retry' : 'إعادة المحاولة')}</button>
    </div></div></div>`;
  } finally {
    $('#boot').classList.add('hidden');
  }
}

export function requirePermOrThrow(permission) {
  if (!hasPerm(permission)) throw new Error(t('common.error'));
}

boot();
