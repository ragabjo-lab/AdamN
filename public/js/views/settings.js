import { api, toQuery } from '../api.js';
import { getLang, setLang, t, roleLabel } from '../i18n.js';
import * as ui from '../ui.js';

const { esc, el, toast, toastSuccess, toastError, modal, confirmDialog, fmtTimestamp, setFieldError } = ui;

const state = {
  root: null,
  ctx: null,
  section: 'general',
  settings: null,
  timezones: [],
  dataFile: null,
  system: null,
  users: null,
  backups: [],
  sessions: [],
  audit: [],
};

const SECTIONS = [
  { key: 'general', icon: '⚙️', label: 'settings.general' },
  { key: 'dataFile', icon: '💾', label: 'settings.dataFile' },
  { key: 'users', icon: '👥', label: 'settings.users' },
  { key: 'security', icon: '🔐', label: 'settings.security' },
  { key: 'system', icon: '🖥️', label: 'settings.system' },
  { key: 'audit', icon: '📜', label: 'settings.audit' },
];

function canWrite() { return state.ctx.hasPerm('settings.write'); }
function isAdmin() { return state.ctx.hasPerm('users.manage'); }

/* ------------------------------------------------------------------ */
/* loaders                                                             */
/* ------------------------------------------------------------------ */
async function loadBase() {
  const data = await api.get('/settings');
  state.settings = data.settings;
  state.timezones = data.timezones || [];
  if (!state.timezones.length) {
    state.timezones = ['UTC', 'Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'Africa/Alexandria'];
  }
  state.dataFile = await api.get('/settings/data-file');
  state.system = await api.get('/settings/system');
  state.backups = (await api.get('/settings/backups')).items || [];
  if (isAdmin()) {
    try { state.users = await api.get('/users'); } catch { state.users = null; }
  }
  try {
    state.sessions = (await api.get('/settings/sessions')).items || [];
  } catch { state.sessions = []; }
  if (state.ctx.hasPerm('audit.read')) {
    try { state.audit = (await api.get('/settings/audit?limit=100')).items || []; } catch { state.audit = []; }
  }
}

/* ------------------------------------------------------------------ */
/* general                                                             */
/* ------------------------------------------------------------------ */
function renderGeneral() {
  const s = state.settings;
  const disabled = canWrite() ? '' : 'disabled';
  return `
    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.general'))}</h3></div>
      <div class="card-body">
        <form id="general-form" class="grid-form">
          <div class="field span-2">
            <label>${esc(t('settings.nurseryName'))}</label>
            <input name="nursery_name" value="${esc(s.nursery_name || '')}" ${disabled} maxlength="120">
          </div>
          <div class="field"><label>${esc(t('settings.nurseryPhone'))}</label>
            <input name="nursery_phone" value="${esc(s.nursery_phone || '')}" ${disabled} maxlength="40"></div>
          <div class="field"><label>${esc(t('settings.nurseryAddress'))}</label>
            <input name="nursery_address" value="${esc(s.nursery_address || '')}" ${disabled} maxlength="300"></div>

          <div class="field">
            <label>${esc(t('settings.timezone'))}</label>
            <select name="timezone" ${disabled}>
              ${(state.timezones.includes(s.timezone) ? state.timezones : [s.timezone, ...state.timezones])
    .map((tz) => `<option value="${esc(tz)}" ${tz === s.timezone ? 'selected' : ''}>${esc(tz)}</option>`).join('')}
            </select>
            <div class="hint">${esc(t('settings.timezoneHint'))}</div>
          </div>
          <div class="field">
            <label>${esc(t('settings.language'))}</label>
            <select name="locale" ${disabled}>
              <option value="ar" ${s.locale === 'ar' ? 'selected' : ''}>العربية</option>
              <option value="en" ${s.locale === 'en' ? 'selected' : ''}>English</option>
            </select>
            <div class="hint">${esc(getLang() === 'en' ? 'Changing this switches the whole interface' : 'تغيير اللغة يغيّر الواجهة بالكامل')}</div>
          </div>
          <div class="field"><label>${esc(t('settings.currency'))}</label>
            <input name="currency_code" value="${esc(s.currency_code || '')}" ${disabled} maxlength="8"></div>
          <div class="field"><label>${esc(t('settings.currencySymbol'))}</label>
            <input name="currency_symbol" value="${esc(s.currency_symbol || '')}" ${disabled} maxlength="12"></div>
          <div class="field"><label>${esc(t('settings.defaultFee'))}</label>
            <input name="default_subscription_fee" type="number" min="0" step="0.01" value="${Number(s.default_subscription_fee) || 0}" ${disabled}></div>
          <div class="field"><label>${esc(t('settings.dueDay'))}</label>
            <input name="subscription_due_day" type="number" min="1" max="28" value="${Number(s.subscription_due_day) || 5}" ${disabled}></div>
        </form>
        <div class="btn-row" style="margin-top:14px">
          ${canWrite() ? `<button class="btn" id="general-save">💾 ${esc(t('common.save'))}</button>` : ''}
          <span class="muted small">AdamN NMS • ${esc(t('settings.timezone'))}: ${esc(s.timezone)}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.revenueCategories'))} / ${esc(t('settings.expenseCategories'))}</h3></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px">
          <div>
            <h4>${esc(t('settings.revenueCategories'))}</h4>
            <div class="chip-list" id="revenue-chips">${(s.revenue_categories || []).map((c) => `<span class="chip">${esc(c)}<button data-remove="revenue" data-value="${esc(c)}" ${canWrite() ? '' : 'disabled'}>×</button></span>`).join('')}</div>
            ${canWrite() ? `<div class="btn-row" style="margin-top:10px"><input id="rev-new" placeholder="${esc(t('settings.addCategory'))}" style="max-width:220px"><button class="btn secondary sm" id="rev-add">+</button></div>` : ''}
          </div>
          <div>
            <h4>${esc(t('settings.expenseCategories'))}</h4>
            <div class="chip-list" id="expense-chips">${(s.expense_categories || []).map((c) => `<span class="chip">${esc(c)}<button data-remove="expense" data-value="${esc(c)}" ${canWrite() ? '' : 'disabled'}>×</button></span>`).join('')}</div>
            ${canWrite() ? `<div class="btn-row" style="margin-top:10px"><input id="exp-new" placeholder="${esc(t('settings.addCategory'))}" style="max-width:220px"><button class="btn secondary sm" id="exp-add">+</button></div>` : ''}
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.notifications'))}</h3></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
          ${switchRow('birthday_notifications', t('settings.birthdayNotif'), s.birthday_notifications, disabled)}
          ${switchRow('unpaid_notifications', t('settings.unpaidNotif'), s.unpaid_notifications, disabled)}
          ${switchRow('salary_notifications', t('settings.salaryNotif'), s.salary_notifications, disabled)}
          ${switchRow('backup_daily', t('settings.dailyBackup'), s.backup_daily, disabled)}
        </div>
        <div class="grid-form" style="margin-top:14px;max-width:360px">
          <div class="field"><label>${esc(t('settings.backupKeep'))}</label>
            <input name="backup_keep" form="general-form" type="number" min="1" max="60" value="${Number(s.backup_keep) || 14}" ${disabled}></div>
        </div>
        <div class="btn-row" style="margin-top:14px">
          ${canWrite() ? `<button class="btn" id="notif-save">💾 ${esc(t('common.save'))}</button>
          <button class="btn secondary" id="daily-run">🔄 ${esc(t('settings.dailyRun'))}</button>` : ''}
        </div>
      </div>
    </section>`;
}

function switchRow(name, label, checked, disabled) {
  return `<label class="switch">
    <input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${disabled}>
    <span class="track"></span><span>${esc(label)}</span>
  </label>`;
}

function wireGeneral() {
  const form = state.root.querySelector('#general-form');
  if (!form) return;
  const save = async () => {
    if (!canWrite()) return;
    const payload = ui.formValues(form);
    ['birthday_notifications', 'unpaid_notifications', 'salary_notifications', 'backup_daily'].forEach((key) => {
      const input = state.root.querySelector(`input[name="${key}"]`);
      if (input) payload[key] = input.checked;
    });
    payload.default_subscription_fee = Number(payload.default_subscription_fee || 0);
    payload.subscription_due_day = Number(payload.subscription_due_day || 5);
    payload.backup_keep = Number(payload.backup_keep || 14);
    try {
      const result = await api.put('/settings', payload);
      toastSuccess(t('settings.saved'));
      const languageChanged = result.settings.locale !== state.settings.locale;
      state.settings = result.settings;
      if (state.ctx.onSettingsChanged) {
        state.ctx.state.settings = result.settings;
        state.ctx.onSettingsChanged(result.settings);
      } else {
        state.ctx.state.settings = result.settings;
        setLang(result.settings.locale);
        renderSection(state.section);
      }
      if (languageChanged) toastSuccess(t('settings.saved'));
    } catch (err) { toastError(err.message); }
  };
  const generalSave = state.root.querySelector('#general-save');
  if (generalSave) generalSave.addEventListener('click', save);
  const notifSave = state.root.querySelector('#notif-save');
  if (notifSave) notifSave.addEventListener('click', save);
  const dailyRun = state.root.querySelector('#daily-run');
  if (dailyRun) {
    dailyRun.addEventListener('click', async () => {
      try {
        const result = await api.post('/settings/system/daily-run', {});
        toastSuccess(`${t('settings.lastDailyRun')}: ${result.today}`);
        await loadBase();
        renderSection(state.section);
      } catch (err) { toastError(err.message); }
    });
  }

  const addCategory = async (kind) => {
    const input = state.root.querySelector(kind === 'revenue' ? '#rev-new' : '#exp-new');
    const value = input.value.trim();
    if (!value) return;
    const key = kind === 'revenue' ? 'revenue_categories' : 'expense_categories';
    const list = [...(state.settings[key] || []), value];
    try {
      const result = await api.put('/settings', { [key]: list });
      state.settings = result.settings;
      state.ctx.state.settings = result.settings;
      toastSuccess(t('settings.saved'));
      renderSection(state.section);
    } catch (err) { toastError(err.message); }
  };
  const revAdd = state.root.querySelector('#rev-add');
  if (revAdd) revAdd.addEventListener('click', () => addCategory('revenue'));
  const expAdd = state.root.querySelector('#exp-add');
  if (expAdd) expAdd.addEventListener('click', () => addCategory('expense'));
  state.root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.remove;
      const key = kind === 'revenue' ? 'revenue_categories' : 'expense_categories';
      const list = (state.settings[key] || []).filter((c) => c !== btn.dataset.value);
      if (!list.length) { toastError(getLang() === 'en' ? 'Keep at least one category' : 'يجب الإبقاء على تصنيف واحد على الأقل'); return; }
      try {
        const result = await api.put('/settings', { [key]: list });
        state.settings = result.settings;
        state.ctx.state.settings = result.settings;
        renderSection(state.section);
      } catch (err) { toastError(err.message); }
    });
  });
}

/* ------------------------------------------------------------------ */
/* data file                                                           */
/* ------------------------------------------------------------------ */
function renderDataFile() {
  const info = state.dataFile.info;
  const cfg = state.dataFile;
  return `
    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.dataFile'))}</h3>
        <span class="badge ${info.connected ? 'paid' : 'unpaid'}">${info.connected ? '✓' : '✗'} HDANA</span>
      </div>
      <div class="card-body">
        <p class="muted" style="margin-top:0">${esc(t('settings.stayConnected'))}</p>
        <div class="kv">
          <div class="item"><div class="k">${esc(t('settings.filePath'))}</div><div class="v mono">${esc(info.path)}</div></div>
          <div class="item"><div class="k">${esc(t('settings.fileSize'))}</div><div class="v">${esc(info.sizeHuman)}</div></div>
          <div class="item"><div class="k">${esc(t('settings.fileDriver'))}</div><div class="v">${esc(info.driver)} • schema v${info.schemaVersion}</div></div>
          <div class="item"><div class="k">${esc(t('settings.fileUuid'))}</div><div class="v mono small">${esc(info.fileUuid || '—')}</div></div>
          <div class="item"><div class="k">${esc(t('settings.lastDailyRun'))}</div><div class="v">${esc(state.settings.last_daily_run || '—')}</div></div>
          <div class="item"><div class="k">${esc(t('settings.backupLocation'))}</div><div class="v mono small">${esc((state.backups[0] || {}).path || cfg.storageDir)}</div></div>
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn" id="df-backup">💾 ${esc(t('settings.backupNow'))}</button>
          <button class="btn secondary" id="df-discover">🔍 ${esc(t('settings.discover'))}</button>
          <button class="btn secondary" id="df-relink">🔗 ${esc(t('settings.relink'))}</button>
          <button class="btn secondary" id="df-create">🆕 ${esc(t('settings.createFile'))}</button>
        </div>
        ${!isAdmin() ? `<p class="muted small" style="margin-top:10px">${esc(getLang() === 'en' ? 'Only an administrator can change the data file.' : 'تعديل ملف البيانات متاح لمدير النظام فقط.')}</p>` : ''}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.backups'))}</h3><span class="badge neutral">${state.backups.length}</span></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>${esc(t('common.name'))}</th><th>${esc(t('settings.fileSize'))}</th><th>${esc(t('common.date'))}</th><th>${esc(t('common.actions'))}</th></tr></thead>
          <tbody>${state.backups.length ? state.backups.map((b) => `<tr>
            <td class="name mono small">${esc(b.fileName)}</td>
            <td>${esc(b.sizeHuman)}</td>
            <td class="nowrap">${esc(fmtTimestamp(b.createdAt, state.settings.timezone))}</td>
            <td class="actions"><div class="row-actions">
              <button class="icon-action" data-dl="${esc(b.fileName)}" title="${esc(t('settings.download'))}">⬇️</button>
              ${isAdmin() ? `<button class="icon-action danger" data-restore="${esc(b.fileName)}" title="${esc(t('settings.restore'))}">♻️</button>` : ''}
            </div></td>
          </tr>`).join('') : `<tr><td colspan="4">${ui.emptyState(t('settings.noBackups'), '💾')}</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function wireDataFile() {
  const root = state.root;
  root.querySelector('#df-backup')?.addEventListener('click', async () => {
    try {
      const result = await api.post('/settings/data-file/backup', {});
      toastSuccess(`${t('settings.backupNow')}: ${result.fileName}`);
      state.backups = (await api.get('/settings/backups')).items || [];
      renderSection('dataFile');
    } catch (err) { toastError(err.message); }
  });

  root.querySelector('#df-discover')?.addEventListener('click', async () => {
    const body = el('div', { html: `<div class="loading"><div class="spinner"></div></div>` });
    const m = modal({ title: t('settings.discover'), body, size: 'wide' });
    try {
      const result = await api.post('/settings/data-file/discover', { depth: 4 });
      body.innerHTML = `
        <p class="muted">${esc(getLang() === 'en' ? 'Files found on this computer:' : 'ملفات تم العثور عليها على هذا الجهاز:')}</p>
        <div id="discover-list">${result.items.length ? result.items.map((f) => `
          <div class="file-row">
            <span class="file-icon">💾</span>
            <div style="flex:1;min-width:0">
              <div class="mono small" style="word-break:break-all">${esc(f.path)}</div>
              <div class="muted small">${esc(f.sizeHuman)} • ${esc(f.modifiedAt.slice(0, 10))} ${f.fileUuid === result.current ? `• <span class="badge paid">${esc(t('settings.current'))}</span>` : ''}</div>
            </div>
            ${f.fileUuid === result.current ? '' : `<button class="btn sm" data-link="${esc(f.path)}">${esc(t('settings.relink'))}</button>`}
          </div>`).join('') : `<div class="empty">${esc(t('settings.noFilesFound'))}</div>`}</div>`;
      body.querySelectorAll('[data-link]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: t('settings.relink'), message: t('settings.relinkConfirm'), confirmText: t('settings.relink'), danger: true });
          if (!ok) return;
          try {
            const result = await api.post('/settings/data-file/relink', { path: btn.dataset.link });
            toastSuccess(`${t('settings.saved')} — ${result.info.fileName}`);
            m.close();
            location.reload();
          } catch (err) { toastError(err.message); }
        });
      });
    } catch (err) {
      body.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
    }
  });

  root.querySelector('#df-relink')?.addEventListener('click', () => {
    if (!isAdmin()) { toastError(t('settings.usersOnly')); return; }
    const body = el('div');
    body.innerHTML = `
      <div class="field">
        <label>${esc(t('settings.filePath'))}</label>
        <input id="relink-path" placeholder="/Users/me/Documents/HDANA.db" style="direction:ltr;text-align:left">
        <div class="hint">${esc(t('settings.relinkHint'))}</div>
      </div>`;
    const foot = el('div', { style: 'display:flex;gap:10px' });
    const cancel = el('button', { class: 'btn secondary', type: 'button' }, t('common.cancel'));
    const ok = el('button', { class: 'btn', type: 'button' }, t('settings.relink'));
    foot.append(cancel, ok);
    const m = modal({ title: t('settings.relink'), body, footer: foot });
    cancel.addEventListener('click', () => m.close());
    ok.addEventListener('click', async () => {
      const path = body.querySelector('#relink-path').value.trim();
      if (!path) { setFieldError(body.querySelector('#relink-path'), t('common.required')); return; }
      const confirmed = await confirmDialog({ title: t('settings.relink'), message: t('settings.relinkConfirm'), danger: true });
      if (!confirmed) return;
      try {
        const result = await api.post('/settings/data-file/relink', { path });
        toastSuccess(`${t('settings.saved')} — ${result.info.fileName}`);
        m.close();
        location.reload();
      } catch (err) { toastError(err.message); }
    });
  });

  root.querySelector('#df-create')?.addEventListener('click', () => {
    if (!isAdmin()) { toastError(t('settings.usersOnly')); return; }
    const body = el('div', { class: 'grid-form', style: 'grid-template-columns:1fr' });
    body.innerHTML = `
      <div class="field"><label>${esc(t('settings.pickFolder'))}</label>
        <input id="create-dir" placeholder="C:\\Users\\Me\\Documents\\AdamN" style="direction:ltr;text-align:left">
        <div class="hint">${esc(getLang() === 'en' ? 'The folder is created if it does not exist' : 'سيتم إنشاء المجلد إذا لم يكن موجودًا')}</div></div>
      <div class="field"><label>${esc(t('settings.fileName'))}</label>
        <input id="create-name" value="HDANA.db" style="direction:ltr;text-align:left"></div>`;
    const foot = el('div', { style: 'display:flex;gap:10px' });
    const cancel = el('button', { class: 'btn secondary', type: 'button' }, t('common.cancel'));
    const ok = el('button', { class: 'btn', type: 'button' }, t('settings.createFile'));
    foot.append(cancel, ok);
    const m = modal({ title: t('settings.createFile'), body, footer: foot });
    cancel.addEventListener('click', () => m.close());
    ok.addEventListener('click', async () => {
      try {
        const result = await api.post('/settings/data-file/create', {
          directory: body.querySelector('#create-dir').value.trim(),
          fileName: body.querySelector('#create-name').value.trim(),
        });
        toastSuccess(result.info.path);
        m.close();
        location.reload();
      } catch (err) { toastError(err.message); }
    });
  });

  root.querySelectorAll('[data-dl]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await api.download(`/settings/backups/${encodeURIComponent(btn.dataset.dl)}/download`, btn.dataset.dl); }
      catch (err) { toastError(err.message); }
    });
  });
  root.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `${t('settings.restore')} — ${btn.dataset.restore}`,
        message: t('settings.restoreConfirm'),
        confirmText: t('settings.restore'),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.post(`/settings/backups/${encodeURIComponent(btn.dataset.restore)}/restore`, {});
        toastSuccess(t('settings.saved'));
        setTimeout(() => location.reload(), 800);
      } catch (err) { toastError(err.message); }
    });
  });
}

/* ------------------------------------------------------------------ */
/* users                                                               */
/* ------------------------------------------------------------------ */
function renderUsers() {
  if (!state.users) {
    return `<section class="card"><div class="card-body">${ui.emptyState(t('settings.usersOnly'), '🔒')}</div></section>`;
  }
  const rows = state.users.items.map((u) => `<tr>
    <td class="name">${esc(u.fullName)}<div class="muted small mono">${esc(u.username)}</div></td>
    <td>${esc(roleLabel(u.role))}</td>
    <td>${u.isActive ? `<span class="badge paid">${esc(t('common.active'))}</span>` : `<span class="badge neutral">✗</span>`}</td>
    <td>${u.activeSessions}</td>
    <td class="nowrap">${u.lastLoginAt ? esc(fmtTimestamp(u.lastLoginAt, state.settings.timezone)) : '—'}</td>
    <td class="actions"><div class="row-actions">
      <button class="icon-action" data-user-role="${u.id}" title="${esc(t('settings.role'))}">🎚️</button>
      <button class="icon-action" data-user-pass="${u.id}" title="${esc(t('settings.resetPassword'))}">🔑</button>
      <button class="icon-action danger" data-user-del="${u.id}" title="${esc(t('common.delete'))}">🗑️</button>
    </div></td>
  </tr>`).join('');
  const roleOptions = Object.keys(state.users.matrix).map((r) => `<option value="${r}">${esc(roleLabel(r))}</option>`).join('');
  return `
    <section class="card">
      <div class="card-head">
        <h3>${esc(t('settings.users'))}</h3>
        <button class="btn" id="user-add">➕ ${esc(t('settings.addUser'))}</button>
      </div>
      <div class="card-body" style="padding-bottom:4px">
        <p class="muted" style="margin:0">${esc(t('settings.usersHint'))}</p>
        <div class="btn-row" style="margin-top:10px">
          ${Object.entries(state.users.matrix).map(([role, perms]) => `<span class="chip">${esc(roleLabel(role))}: ${perms.includes('*') ? '★' : perms.length}</span>`).join('')}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>${esc(t('common.name'))}</th><th>${esc(t('settings.role'))}</th><th>${esc(t('common.status'))}</th><th>${esc(t('settings.sessions'))}</th><th>${esc(getLang() === 'en' ? 'Last login' : 'آخر دخول')}</th><th>${esc(t('common.actions'))}</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6">${ui.emptyState()}</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function wireUsers() {
  if (!state.users) return;
  const root = state.root;
  root.querySelector('#user-add')?.addEventListener('click', () => {
    const body = el('form', { class: 'grid-form', style: 'grid-template-columns:1fr;gap:12px', id: 'user-form' });
    const roleOptions = Object.keys(state.users.matrix).map((r) => `<option value="${r}">${esc(roleLabel(r))}</option>`).join('');
    body.innerHTML = `
      <div class="field"><label>${esc(t('auth.fullName'))}</label><input name="fullName" required maxlength="120"></div>
      <div class="field"><label>${esc(t('auth.username'))}</label><input name="username" required maxlength="32" style="direction:ltr;text-align:left">
        <div class="hint">${esc(t('auth.usernameHint'))}</div></div>
      <div class="field"><label>${esc(t('settings.role'))}</label><select name="role">${roleOptions}</select></div>
      <div class="field"><label>${esc(t('auth.password'))}</label><input name="password" type="password" required minlength="8">
        <div class="hint">${esc(getLang() === 'en' ? 'At least 8 characters with letters and digits' : '8 أحرف على الأقل وتحتوي حروفًا وأرقامًا')}</div></div>`;
    const foot = el('div', { style: 'display:flex;gap:10px' });
    const cancel = el('button', { class: 'btn secondary', type: 'button' }, t('common.cancel'));
    const ok = el('button', { class: 'btn', type: 'button' }, t('common.save'));
    foot.append(cancel, ok);
    const m = modal({ title: t('settings.addUser'), body, footer: foot, size: 'narrow' });
    cancel.addEventListener('click', () => m.close());
    body.addEventListener('submit', (e) => e.preventDefault());
    ok.addEventListener('click', async () => {
      const values = ui.formValues(body);
      try {
        await api.post('/users', values);
        toastSuccess(t('common.saved'));
        m.close();
        state.users = await api.get('/users');
        renderSection('users');
      } catch (err) { toastError(err.message); }
    });
  });

  root.querySelectorAll('[data-user-role]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const user = state.users.items.find((u) => String(u.id) === btn.dataset.userRole);
      if (!user) return;
      const body = el('div');
      body.innerHTML = `<div class="grid-form" style="grid-template-columns:1fr">
        <div class="field"><label>${esc(t('settings.role'))}</label>
        <select id="role-select">${Object.keys(state.users.matrix).map((r) => `<option value="${r}" ${r === user.role ? 'selected' : ''}>${esc(roleLabel(r))}</option>`).join('')}</select></div>
        <label class="switch"><input type="checkbox" id="user-active" ${user.isActive ? 'checked' : ''}><span class="track"></span><span>${esc(t('common.active'))}</span></label>
      </div>`;
      const foot = el('div', { style: 'display:flex;gap:10px' });
      const cancel = el('button', { class: 'btn secondary', type: 'button' }, t('common.cancel'));
      const ok = el('button', { class: 'btn', type: 'button' }, t('common.save'));
      foot.append(cancel, ok);
      const m = modal({ title: user.fullName, body, footer: foot, size: 'narrow' });
      cancel.addEventListener('click', () => m.close());
      ok.addEventListener('click', async () => {
        try {
          await api.put(`/users/${user.id}`, {
            role: body.querySelector('#role-select').value,
            isActive: body.querySelector('#user-active').checked,
          });
          toastSuccess(t('common.saved'));
          m.close();
          state.users = await api.get('/users');
          renderSection('users');
        } catch (err) { toastError(err.message); }
      });
    });
  });

  root.querySelectorAll('[data-user-pass]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const user = state.users.items.find((u) => String(u.id) === btn.dataset.userPass);
      if (!user) return;
      const body = el('div', { html: `<div class="field"><label>${esc(t('auth.newPassword'))}</label><input type="password" id="new-pass" minlength="8"><div class="hint">${esc(getLang() === 'en' ? 'The user must change it on next login' : 'سيُطلب من المستخدم تغييرها عند الدخول القادم')}</div></div>` });
      const foot = el('div', { style: 'display:flex;gap:10px' });
      const cancel = el('button', { class: 'btn secondary', type: 'button' }, t('common.cancel'));
      const ok = el('button', { class: 'btn', type: 'button' }, t('common.save'));
      foot.append(cancel, ok);
      const m = modal({ title: `${t('settings.resetPassword')} — ${user.fullName}`, body, footer: foot, size: 'narrow' });
      cancel.addEventListener('click', () => m.close());
      ok.addEventListener('click', async () => {
        try {
          await api.post(`/users/${user.id}/password`, { password: body.querySelector('#new-pass').value });
          toastSuccess(t('settings.saved'));
          m.close();
        } catch (err) { toastError(err.message); }
      });
    });
  });

  root.querySelectorAll('[data-user-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const user = state.users.items.find((u) => String(u.id) === btn.dataset.userDel);
      if (!user) return;
      const ok = await confirmDialog({ title: user.fullName, message: t('students.deleteConfirm'), danger: true, confirmText: t('common.delete') });
      if (!ok) return;
      try {
        await api.del(`/users/${user.id}`);
        toastSuccess(t('common.deleted'));
        state.users = await api.get('/users');
        renderSection('users');
      } catch (err) { toastError(err.message); }
    });
  });
}

/* ------------------------------------------------------------------ */
/* security                                                           */
/* ------------------------------------------------------------------ */
function renderSecurity() {
  const rows = state.sessions.map((s) => `<tr>
    <td class="name">${esc(s.full_name)}<div class="muted small mono">${esc(s.username)}</div></td>
    <td class="small" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc((s.user_agent || '').slice(0, 80))}</td>
    <td class="mono small">${esc(s.ip || '')}</td>
    <td class="nowrap">${esc(fmtTimestamp(s.last_seen_at || s.created_at, state.settings.timezone))}</td>
    <td>${String(s.id) === String(state.currentSessionId)
      ? `<span class="badge paid">${esc(t('settings.current'))}</span>`
      : `<button class="icon-action danger" data-session="${s.id}" title="${esc(t('common.delete'))}">✕</button>`}</td>
  </tr>`).join('');
  return `
    <section class="card">
      <div class="card-head"><h3>${esc(t('auth.changePassword'))}</h3></div>
      <div class="card-body">
        <form id="password-form" class="grid-form" style="max-width:620px">
          <div class="field"><label>${esc(t('auth.currentPassword'))}</label><input type="password" name="currentPassword" required autocomplete="current-password"></div>
          <div class="field"><label>${esc(t('auth.newPassword'))}</label><input type="password" name="newPassword" required minlength="8" autocomplete="new-password"></div>
          <div class="field"><label>${esc(t('auth.confirmPassword'))}</label><input type="password" name="confirmPassword" required minlength="8" autocomplete="new-password"></div>
        </form>
        <div class="btn-row" style="margin-top:12px"><button class="btn" id="password-save">💾 ${esc(t('common.save'))}</button></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.sessions'))}</h3><span class="badge neutral">${state.sessions.length}</span></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>${esc(t('common.name'))}</th><th>${esc(getLang() === 'en' ? 'Device' : 'الجهاز')}</th><th>IP</th><th>${esc(getLang() === 'en' ? 'Last seen' : 'آخر نشاط')}</th><th>${esc(t('common.actions'))}</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5">${ui.emptyState()}</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function wireSecurity() {
  const root = state.root;
  root.querySelector('#password-save')?.addEventListener('click', async () => {
    const form = root.querySelector('#password-form');
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.newPassword !== values.confirmPassword) { toastError(t('auth.mismatch')); return; }
    try {
      await api.post('/auth/password', { currentPassword: values.currentPassword, newPassword: values.newPassword });
      toastSuccess(t('auth.passwordChanged'));
      form.reset();
    } catch (err) { toastError(err.message); }
  });
  root.querySelectorAll('[data-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.del(`/settings/sessions/${btn.dataset.session}`);
        toastSuccess(t('common.deleted'));
        state.sessions = (await api.get('/settings/sessions')).items || [];
        renderSection('security');
      } catch (err) { toastError(err.message); }
    });
  });
}

/* ------------------------------------------------------------------ */
/* system + audit                                                      */
/* ------------------------------------------------------------------ */
function renderSystem() {
  const sys = state.system || {};
  const counts = sys.counts || {};
  const kv = (k, v) => `<div class="item"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
  return `
    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.system'))}</h3>
        <button class="btn secondary sm" id="sys-run">🔄 ${esc(t('settings.dailyRun'))}</button>
      </div>
      <div class="card-body">
        <div class="kv">
          ${kv('AdamN', `${sys.app?.version || ''}`)}
          ${kv(t('settings.node'), sys.app?.node || '')}
          ${kv(t('settings.platform'), sys.app?.platform || '')}
          ${kv(t('settings.uptime'), `${Math.round((sys.app?.uptime || 0) / 60)} min`)}
          ${kv(t('settings.filePath'), sys.dataFile?.path || '')}
          ${kv(t('settings.fileSize'), sys.dataFile?.sizeHuman || '')}
          ${kv(t('settings.lastDailyRun'), state.settings.last_daily_run || '—')}
          ${kv(t('settings.backupKeep'), String(state.settings.backup_keep || 14))}
        </div>
        <h4 style="margin-top:18px">${esc(t('settings.counts'))}</h4>
        <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          ${ui.statCard({ label: t('students.title'), value: ui.plainNumber(counts.students || 0) })}
          ${ui.statCard({ label: t('staff.title'), value: ui.plainNumber(counts.staff || 0) })}
          ${ui.statCard({ label: t('revenue.title'), value: ui.plainNumber(counts.revenues || 0) })}
          ${ui.statCard({ label: t('expenses.title'), value: ui.plainNumber(counts.expenses || 0) })}
          ${ui.statCard({ label: t('students.paymentMatrix'), value: ui.plainNumber(counts.payments || 0) })}
          ${ui.statCard({ label: t('students.attachments'), value: ui.plainNumber(counts.attachments || 0) })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>#</th><th>${getLang() === 'en' ? 'Job' : 'المهمة'}</th><th>${esc(t('common.date'))}</th><th>${esc(t('common.status'))}</th><th>${esc(t('common.description'))}</th></tr></thead>
          <tbody>${(sys.lastJobRuns || []).map((j) => `<tr>
            <td>${j.id}</td><td>${esc(j.job)}</td><td class="nowrap">${esc(j.run_on)}</td>
            <td>${j.status === 'success' ? `<span class="badge paid">✓</span>` : `<span class="badge unpaid">✗</span>`}</td>
            <td class="mono small" style="max-width:420px;overflow:hidden;text-overflow:ellipsis">${esc(j.message || '')}</td>
          </tr>`).join('') || `<tr><td colspan="5">${ui.emptyState()}</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function wireSystem() {
  state.root.querySelector('#sys-run')?.addEventListener('click', async () => {
    try {
      await api.post('/settings/system/daily-run', {});
      toastSuccess(t('settings.saved'));
      state.system = await api.get('/settings/system');
      state.settings = (await api.get('/settings')).settings;
      renderSection('system');
    } catch (err) { toastError(err.message); }
  });
}

function renderAudit() {
  if (!state.ctx.hasPerm('audit.read')) {
    return `<section class="card"><div class="card-body">${ui.emptyState(t('settings.usersOnly'), '🔒')}</div></section>`;
  }
  const rows = state.audit.map((a) => `<tr>
    <td>${a.id}</td>
    <td class="nowrap">${esc(fmtTimestamp(a.created_at, state.settings.timezone))}</td>
    <td class="name">${esc(a.username || '—')}</td>
    <td>${esc(a.action)}</td>
    <td>${esc(a.entity || '')}${a.entity_id ? ` #${a.entity_id}` : ''}</td>
    <td class="mono small" style="max-width:360px;overflow:hidden;text-overflow:ellipsis">${esc(a.details ? JSON.stringify(a.details) : '')}</td>
  </tr>`).join('');
  return `
    <section class="card">
      <div class="card-head"><h3>${esc(t('settings.audit'))}</h3><span class="muted small">${esc(t('settings.auditHint'))}</span></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>#</th><th>${esc(t('common.date'))}</th><th>${esc(t('auth.username'))}</th><th>${esc(t('common.actions'))}</th><th>${esc(t('common.type'))}</th><th>${esc(t('common.description'))}</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6">${ui.emptyState()}</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* section router                                                      */
/* ------------------------------------------------------------------ */
function renderSection(name) {
  state.section = name;
  const host = state.root.querySelector('#settings-host');
  const nav = state.root.querySelector('#settings-nav');
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
  let html = '';
  if (name === 'general') html = renderGeneral();
  if (name === 'dataFile') html = renderDataFile();
  if (name === 'users') html = renderUsers();
  if (name === 'security') html = renderSecurity();
  if (name === 'system') html = renderSystem();
  if (name === 'audit') html = renderAudit();
  host.innerHTML = html;
  if (name === 'general') wireGeneral();
  if (name === 'dataFile') wireDataFile();
  if (name === 'users') wireUsers();
  if (name === 'security') wireSecurity();
  if (name === 'system') wireSystem();
}

export default {
  async mount(root, params, ctx) {
    state.root = root;
    state.ctx = ctx;
    root.innerHTML = `
      <div class="page-head" style="margin-bottom:14px">
        <h1 style="margin:0">${esc(t('settings.title'))}</h1>
        <p class="muted" style="margin:2px 0 0">${esc(t('settings.subtitle'))}</p>
      </div>
      <div class="settings-grid">
        <nav class="settings-nav" id="settings-nav">
          ${SECTIONS.filter((s) => s.key !== 'users' || isAdmin()).map((s) => `<button type="button" data-section="${s.key}">${s.icon} ${esc(t(s.label))}</button>`).join('')}
        </nav>
        <div id="settings-host">${ui.loadingState()}</div>
      </div>`;

    root.querySelector('#settings-nav').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (btn) renderSection(btn.dataset.section);
    });

    try {
      await loadBase();
      state.currentSessionId = state.ctx.state.user ? state.ctx.state.user.sessionId : null;
      state.dataFile = await api.get('/settings/data-file');
      renderSection(params.section || 'general');
    } catch (err) {
      root.querySelector('#settings-host').innerHTML = `<div class="card"><div class="card-body"><p class="field-error">${esc(err.message)}</p></div></div>`;
    }
    return { destroy() {} };
  },
};
