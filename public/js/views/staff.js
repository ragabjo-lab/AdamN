import { api, toQuery } from '../api.js';
import { getLang, t } from '../i18n.js';
import * as ui from '../ui.js';
import { parseDdMmYy, isoToDisplay, diffYMD, todayISO, currentPeriod } from '../dates.js';

const { esc, el, toast, toastSuccess, toastError, money, fmtDate, durationLabel, modal, confirmDialog, setFieldError, clearErrors } = ui;

const state = {
  root: null,
  ctx: null,
  query: {},
  data: null,
  payroll: null,
  period: currentPeriod(),
  current: null,
  today: todayISO(),
  timezone: 'UTC',
  loading: false,
};

function normalizeQuery(params = {}) {
  return {
    q: params.q || '',
    status: ['active', 'inactive', 'all'].includes(params.status) ? params.status : 'all',
    page: Math.max(1, Number(params.page) || 1),
    pageSize: Number(params.pageSize) || 12,
    sort: params.sort || 'name',
    order: params.order === 'desc' ? 'desc' : 'asc',
  };
}

/* ---------------- data ---------------- */
async function loadList({ silent = false } = {}) {
  const host = state.root.querySelector('#staff-table-host');
  if (!silent && host) host.innerHTML = ui.loadingState();
  try {
    const data = await api.get(`/staff${toQuery(state.query)}`);
    state.data = data;
    state.today = data.today || state.today;
    renderStats();
    renderTable();
  } catch (err) {
    if (host) host.innerHTML = `<div class="card-body"><p class="field-error">${esc(err.message)}</p></div>`;
    toastError(err.message);
  }
}

async function loadPayroll(period = state.period) {
  const host = state.root.querySelector('#payroll-host');
  if (host) host.innerHTML = ui.loadingState();
  try {
    const data = await api.get(`/staff/payroll/${period}`);
    state.payroll = data;
    state.period = period;
    renderPayroll();
    renderStats();
  } catch (err) {
    if (host) host.innerHTML = `<div class="card-body"><p class="field-error">${esc(err.message)}</p></div>`;
    toastError(err.message);
  }
}

function renderStats() {
  const host = state.root.querySelector('#staff-stats');
  if (!host || !state.data) return;
  const s = state.data.summary || {};
  host.innerHTML = [
    ui.statCard({ label: t('staff.activeEmployees'), value: ui.plainNumber(s.activeCount || 0) }),
    ui.statCard({ label: t('staff.monthlyPayrollTotal'), value: money(s.monthlyPayroll, state.ctx.state.settings), variant: 'accent' }),
    ui.statCard({
      label: `${t('staff.payrollFor')} ${ui.monthLabel(state.period)}`,
      value: state.payroll ? money(state.payroll.totals.net, state.ctx.state.settings) : '—',
      variant: 'success',
      hint: state.payroll ? `${state.payroll.items.length} ${getLang() === 'en' ? 'employees' : 'موظف'}` : '',
    }),
  ].join('');
}

/* ---------------- employee form ---------------- */
function formHTML() {
  const lang = getLang();
  return `
  <form id="staff-form" class="grid-form" novalidate>
    <div class="field">
      <label for="staff-fullName">${esc(t('staff.name'))} <span class="req">*</span></label>
      <input id="staff-fullName" name="fullName" type="text" maxlength="120" autocomplete="off">
    </div>
    <div class="field">
      <label for="staff-phone">${esc(t('staff.phone'))} <span class="req">*</span></label>
      <input id="staff-phone" name="phone" type="tel" inputmode="numeric" maxlength="15" autocomplete="off">
    </div>
    <div class="field">
      <label for="staff-role">${esc(t('staff.role'))} <span class="req">*</span></label>
      <input id="staff-role" name="role" type="text" maxlength="80" list="staff-roles" autocomplete="off">
      <datalist id="staff-roles">
        ${(lang === 'en' ? ['Teacher', 'Assistant teacher', 'Nursery manager', 'Cook', 'Cleaner', 'Bus supervisor', 'Accountant']
    : ['مدرسة', 'مساعد مدرسة', 'مشرفة حضانة', 'طاهية', 'عامل نظافة', 'مشرفة أتوبيس', 'محاسبة'])
    .map((r) => `<option value="${r}"></option>`).join('')}
      </datalist>
    </div>
    <div class="field">
      <label for="staff-hireDate">${esc(t('staff.hireDate'))} <span class="req">*</span></label>
      <input id="staff-hireDate" name="hireDate" type="text" inputmode="numeric" placeholder="dd/mm/yy" maxlength="10" autocomplete="off">
      <div class="hint" id="staff-service-hint"></div>
    </div>
    <div class="field">
      <label for="staff-baseSalary">${esc(t('staff.baseSalary'))} <span class="req">*</span></label>
      <input id="staff-baseSalary" name="baseSalary" type="number" min="0" step="0.01" inputmode="decimal">
      <div class="hint">${esc(t('staff.salaryNote'))}</div>
    </div>
    <div class="field" id="effective-wrap" style="display:none">
      <label for="staff-effectiveFrom">${esc(t('staff.effectiveFrom'))}</label>
      <input id="staff-effectiveFrom" name="effectiveFrom" type="text" inputmode="numeric" placeholder="dd/mm/yy" maxlength="10">
      <div class="hint">${esc(getLang() === 'en' ? 'Defaults to today' : 'الافتراضي: اليوم')}</div>
    </div>
    <div class="field span-2">
      <label for="staff-notes">${esc(t('common.notes'))}</label>
      <textarea id="staff-notes" name="notes" rows="2" maxlength="2000"></textarea>
    </div>
    <div class="field">
      <label>${esc(t('common.status'))}</label>
      <label class="switch">
        <input type="checkbox" id="staff-active" checked>
        <span class="track"></span>
        <span>${esc(t('common.active'))}</span>
      </label>
    </div>
  </form>`;
}

function fillForm(staff) {
  const form = state.root.querySelector('#staff-form');
  if (!form) return;
  clearErrors(form);
  state.current = staff || null;
  const badge = state.root.querySelector('#staff-mode');
  if (badge) {
    badge.textContent = staff ? `${t('staff.edit')} — ${staff.fullName}` : t('staff.new');
    badge.className = `badge ${staff ? 'info' : 'neutral'}`;
  }
  form.querySelector('#staff-fullName').value = staff ? staff.fullName : '';
  form.querySelector('#staff-phone').value = staff ? (staff.phone || '') : '';
  form.querySelector('#staff-role').value = staff ? (staff.role || '') : '';
  form.querySelector('#staff-hireDate').value = staff ? isoToDisplay(staff.hireDate) : '';
  form.querySelector('#staff-baseSalary').value = staff ? staff.baseSalary : '';
  form.querySelector('#staff-notes').value = staff ? (staff.notes || '') : '';
  form.querySelector('#staff-active').checked = staff ? staff.isActive : true;
  form.querySelector('#staff-effectiveFrom').value = '';
  form.querySelector('#effective-wrap').style.display = staff ? '' : 'none';
  updateServiceHint();
}

function updateServiceHint() {
  const form = state.root.querySelector('#staff-form');
  const hint = form && form.querySelector('#staff-service-hint');
  if (!hint) return;
  const hired = parseDdMmYy(form.querySelector('#staff-hireDate').value);
  if (hired && hired <= state.today) {
    const d = diffYMD(hired, state.today);
    hint.className = 'hint ok';
    hint.textContent = `${t('staff.service')}: ${durationLabel(d)}`;
  } else {
    hint.className = 'hint';
    hint.textContent = getLang() === 'en' ? 'dd/mm/yy' : 'يوم/شهر/سنة';
  }
}

function readForm() {
  const form = state.root.querySelector('#staff-form');
  return {
    fullName: form.querySelector('#staff-fullName').value.trim(),
    phone: form.querySelector('#staff-phone').value.replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim(),
    role: form.querySelector('#staff-role').value.trim(),
    hireDate: form.querySelector('#staff-hireDate').value.trim(),
    baseSalary: form.querySelector('#staff-baseSalary').value,
    effectiveFrom: form.querySelector('#staff-effectiveFrom').value.trim(),
    notes: form.querySelector('#staff-notes').value.trim(),
    isActive: form.querySelector('#staff-active').checked,
  };
}

function validate(values) {
  const form = state.root.querySelector('#staff-form');
  clearErrors(form);
  let ok = true;
  const fail = (sel, msg) => { setFieldError(form.querySelector(sel), msg); ok = false; };
  const nameError = ui.validators.letters(values.fullName);
  if (nameError) fail('#staff-fullName', nameError);
  const phoneError = ui.validators.digits(values.phone);
  if (phoneError) fail('#staff-phone', phoneError);
  if (!values.role) fail('#staff-role', t('common.required'));
  const dateError = ui.validators.date(values.hireDate);
  if (dateError) fail('#staff-hireDate', dateError);
  else if (parseDdMmYy(values.hireDate) > state.today) fail('#staff-hireDate', getLang() === 'en' ? 'Cannot be in the future' : 'لا يمكن أن يكون في المستقبل');
  if (values.baseSalary === '' || Number(values.baseSalary) < 0) fail('#staff-baseSalary', t('common.required'));
  if (values.effectiveFrom) {
    const effError = ui.validators.date(values.effectiveFrom);
    if (effError) fail('#staff-effectiveFrom', effError);
  }
  return ok;
}

async function saveStaff() {
  const values = readForm();
  if (!validate(values)) { toastError(t('common.error')); return; }
  const payload = {
    fullName: values.fullName,
    phone: values.phone,
    role: values.role,
    hireDate: values.hireDate,
    baseSalary: Number(values.baseSalary),
    notes: values.notes || null,
    isActive: values.isActive,
  };
  if (values.effectiveFrom) payload.effectiveFrom = values.effectiveFrom;
  const btn = state.root.querySelector('#staff-save');
  btn.disabled = true;
  try {
    const saved = state.current && state.current.id
      ? await api.put(`/staff/${state.current.id}`, payload)
      : await api.post('/staff', payload);
    toastSuccess(t('common.saved'));
    fillForm(saved);
    await Promise.all([loadList({ silent: true }), loadPayroll(state.period)]);
  } catch (err) {
    toastError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function deleteStaff(staff) {
  const ok = await confirmDialog({
    title: `${t('common.delete')} — ${staff.fullName}`,
    message: t('staff.deleteConfirm'),
    confirmText: t('common.delete'),
    danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/staff/${staff.id}`);
    toastSuccess(t('common.deleted'));
    fillForm(null);
    await Promise.all([loadList({ silent: true }), loadPayroll(state.period)]);
  } catch (err) { toastError(err.message); }
}

/* ---------------- payroll ---------------- */
function renderPayroll() {
  const host = state.root.querySelector('#payroll-host');
  if (!host || !state.payroll) return;
  const data = state.payroll;
  const currency = state.ctx.state.settings.currency_symbol || '';
  const rows = data.items.map((item) => `
    <tr data-staff-id="${item.staffId}">
      <td class="name">
        <div>${esc(item.staffName)}</div>
        <div class="muted small">${esc(item.role || '')} ${item.snapshot ? `• ${esc(t('staff.snapshot'))}` : `• ${esc(t('staff.computed'))}`}</div>
      </td>
      <td><input type="number" min="0" step="0.01" class="${item.snapshot ? '' : 'computed'}" data-field="basic" value="${item.basic}" style="min-width:100px"></td>
      <td><input type="number" min="0" step="0.01" data-field="bonuses" value="${item.bonuses}" style="min-width:90px"></td>
      <td><input type="number" min="0" step="0.01" data-field="rewards" value="${item.rewards}" style="min-width:90px"></td>
      <td><input type="number" min="0" step="0.01" data-field="deductions" value="${item.deductions}" style="min-width:90px"></td>
      <td class="amount" data-net>${ui.plainNumber(item.net)}</td>
      <td>
        <select data-field="status" style="min-width:110px">
          <option value="pending" ${item.status !== 'paid' ? 'selected' : ''}>${esc(t('common.pending'))}</option>
          <option value="paid" ${item.status === 'paid' ? 'selected' : ''}>${esc(t('common.paid'))}</option>
        </select>
      </td>
    </tr>`).join('');

  host.innerHTML = `
    <div class="table-wrap">
      <table class="data" id="payroll-table">
        <thead><tr>
          <th>${esc(t('common.name'))}</th>
          <th>${esc(t('common.basic'))}</th>
          <th>${esc(t('common.bonuses'))}</th>
          <th>${esc(t('common.rewards'))}</th>
          <th>${esc(t('common.deductions'))}</th>
          <th>${esc(t('staff.netSalary'))}</th>
          <th>${esc(t('common.status'))}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="7">${ui.emptyState(t('staff.empty'), '👩‍🏫')}</td></tr>`}</tbody>
        <tfoot><tr>
          <td>${esc(t('common.total'))}</td>
          <td class="amount">${ui.plainNumber(data.totals.basic)}</td>
          <td class="amount">${ui.plainNumber(data.totals.bonuses)}</td>
          <td class="amount">${ui.plainNumber(data.totals.rewards)}</td>
          <td class="amount">${ui.plainNumber(data.totals.deductions)}</td>
          <td class="amount">${ui.plainNumber(data.totals.net)} ${esc(currency)}</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>
    <div class="pager">
      <span class="muted small">${esc(getLang() === 'en' ? 'Net = basic + bonuses + rewards − deductions' : 'الصافي = الأساسي + الحوافز + المكافآت − الخصومات')}</span>
      <div class="btn-row">
        <button class="btn" id="payroll-save">💾 ${esc(t('staff.savePayroll'))}</button>
        <button class="btn secondary" id="payroll-print">🖨️ ${esc(t('common.exportPdf'))}</button>
        <button class="btn secondary" id="payroll-export">📊 ${esc(t('common.exportExcel'))}</button>
      </div>
    </div>`;

  const table = host.querySelector('#payroll-table');
  const recalcRow = (tr) => {
    const value = (name) => Number(tr.querySelector(`[data-field="${name}"]`).value || 0);
    const net = value('basic') + value('bonuses') + value('rewards') - value('deductions');
    tr.querySelector('[data-net]').textContent = ui.plainNumber(net);
    return net;
  };
  const recalcTotals = () => {
    const trs = [...table.querySelectorAll('tbody tr[data-staff-id]')];
    const totals = { basic: 0, bonuses: 0, rewards: 0, deductions: 0, net: 0 };
    trs.forEach((tr) => {
      ['basic', 'bonuses', 'rewards', 'deductions'].forEach((f) => { totals[f] += Number(tr.querySelector(`[data-field="${f}"]`).value || 0); });
      totals.net += recalcRow(tr);
    });
    const tfoot = table.querySelectorAll('tfoot td');
    ['basic', 'bonuses', 'rewards', 'deductions'].forEach((f, i) => { tfoot[i + 1].textContent = ui.plainNumber(totals[f]); });
    tfoot[5].textContent = `${ui.plainNumber(totals.net)} ${currency}`;
  };
  table.querySelectorAll('tbody tr[data-staff-id] input').forEach((input) => {
    input.addEventListener('input', recalcTotals);
  });

  host.querySelector('#payroll-save').addEventListener('click', async () => {
    const entries = [...table.querySelectorAll('tbody tr[data-staff-id]')].map((tr) => ({
      staffId: Number(tr.dataset.staffId),
      basic: Number(tr.querySelector('[data-field="basic"]').value || 0),
      bonuses: Number(tr.querySelector('[data-field="bonuses"]').value || 0),
      rewards: Number(tr.querySelector('[data-field="rewards"]').value || 0),
      deductions: Number(tr.querySelector('[data-field="deductions"]').value || 0),
      status: tr.querySelector('[data-field="status"]').value,
    }));
    try {
      const updated = await api.put(`/staff/payroll/${state.period}`, { entries });
      state.payroll = updated;
      toastSuccess(t('staff.payrollSaved'));
      renderPayroll();
      renderStats();
    } catch (err) { toastError(err.message); }
  });
  host.querySelector('#payroll-print').addEventListener('click', () => {
    window.open(`/print/payroll?period=${state.period}&auto=1`, '_blank', 'noopener');
  });
  host.querySelector('#payroll-export').addEventListener('click', async () => {
    try { await api.download(`/exports/payroll.xlsx?period=${state.period}`, 'payroll.xlsx'); toastSuccess(t('common.exportExcel')); }
    catch (err) { toastError(err.message); }
  });
}

/* ---------------- list ---------------- */
function renderTable() {
  const host = state.root.querySelector('#staff-table-host');
  if (!host || !state.data) return;
  const data = state.data;
  const sortHeader = (key, label) => {
    const active = state.query.sort === key;
    return `<th class="sortable" data-sort="${key}">${esc(label)} <span class="arrow">${active ? (state.query.order === 'asc' ? '▲' : '▼') : ''}</span></th>`;
  };
  const rows = data.items.map((s, idx) => `
    <tr data-staff-id="${s.id}">
      <td class="muted">${(data.pagination.page - 1) * data.pagination.pageSize + idx + 1}</td>
      <td class="name"><div>${esc(s.fullName)}</div><div class="muted small">${esc(s.code || '')}</div></td>
      <td>${esc(s.role || '')}</td>
      <td class="numeric" dir="ltr">${esc(s.phone || '—')}</td>
      <td class="nowrap">${esc(fmtDate(s.hireDate))}</td>
      <td class="nowrap">${esc(durationLabel(s.duration))}</td>
      <td class="amount">${money(s.baseSalary, state.ctx.state.settings)}</td>
      <td>${s.isActive ? `<span class="badge paid">${esc(t('common.active'))}</span>` : `<span class="badge neutral">${esc(getLang() === 'en' ? 'Inactive' : 'موقوف')}</span>`}</td>
      <td class="actions">
        <div class="row-actions">
          <button class="icon-action" data-action="edit" data-id="${s.id}" title="${esc(t('common.edit'))}">✏️</button>
          <button class="icon-action" data-action="history" data-id="${s.id}" title="${esc(t('staff.salaryHistory'))}">📈</button>
          <button class="icon-action danger" data-action="delete" data-id="${s.id}" title="${esc(t('common.delete'))}">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th style="width:46px">#</th>
          ${sortHeader('name', t('common.name'))}
          ${sortHeader('role', t('common.role'))}
          <th>${esc(t('staff.phone'))}</th>
          ${sortHeader('hireDate', t('staff.hireDate'))}
          <th>${esc(t('staff.service'))}</th>
          ${sortHeader('salary', t('staff.baseSalary'))}
          <th>${esc(t('common.status'))}</th>
          <th>${esc(t('common.actions'))}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="9">${ui.emptyState(t('staff.empty'), '👩‍🏫')}</td></tr>`}</tbody>
      </table>
    </div>
    <div id="staff-pager"></div>`;
  host.querySelector('#staff-pager').appendChild(ui.pager(data.pagination, (page) => {
    state.query.page = page;
    loadList();
  }));
  host.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.query.sort === key) state.query.order = state.query.order === 'asc' ? 'desc' : 'asc';
      else { state.query.sort = key; state.query.order = 'asc'; }
      loadList();
    });
  });
  host.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      if (btn.dataset.action === 'edit') {
        const full = await api.get(`/staff/${id}`).catch(() => null);
        if (full) {
          fillForm(full);
          state.root.querySelector('#staff-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      if (btn.dataset.action === 'delete') {
        const staff = data.items.find((s) => s.id === id);
        if (staff) deleteStaff(staff);
      }
      if (btn.dataset.action === 'history') openHistory(id);
    });
  });
}

async function openHistory(id) {
  const staff = await api.get(`/staff/${id}`).catch((err) => { toastError(err.message); return null; });
  if (!staff) return;
  const rates = (staff.salaryRates || []).map((r) => `<tr><td>${esc(fmtDate(r.effectiveFrom, { long: true }))}</td><td class="amount">${money(r.basic, state.ctx.state.settings)}</td><td>${esc(r.note || '')}</td></tr>`).join('');
  const history = (staff.salaryHistory || []).map((r) => `<tr><td>${esc(ui.monthLabel(r.period))}</td><td class="amount">${ui.plainNumber(r.basic)}</td><td class="amount">${ui.plainNumber(r.bonuses)}</td><td class="amount">${ui.plainNumber(r.rewards)}</td><td class="amount">${ui.plainNumber(r.deductions)}</td><td class="amount">${ui.plainNumber(r.net)}</td><td>${r.status === 'paid' ? esc(t('common.paid')) : esc(t('common.pending'))}</td></tr>`).join('');
  const body = el('div');
  body.innerHTML = `
    <h4 style="margin-top:0">${esc(getLang() === 'en' ? 'Base salary rates' : 'سجل تعديلات الراتب الأساسي')}</h4>
    <div class="table-wrap" style="margin-bottom:18px"><table class="data" style="min-width:480px">
      <thead><tr><th>${esc(t('staff.effectiveFrom'))}</th><th>${esc(t('common.amount'))}</th><th>${esc(t('common.notes'))}</th></tr></thead>
      <tbody>${rates || `<tr><td colspan="3">${ui.emptyState()}</td></tr>`}</tbody></table></div>
    <h4>${esc(t('staff.salaryHistory'))}</h4>
    <div class="table-wrap"><table class="data" style="min-width:640px">
      <thead><tr><th>${esc(t('common.month'))}</th><th>${esc(t('common.basic'))}</th><th>${esc(t('common.bonuses'))}</th><th>${esc(t('common.rewards'))}</th><th>${esc(t('common.deductions'))}</th><th>${esc(t('staff.netSalary'))}</th><th>${esc(t('common.status'))}</th></tr></thead>
      <tbody>${history || `<tr><td colspan="7">${ui.emptyState(t('staff.noRecords'))}</td></tr>`}</tbody></table></div>`;
  modal({ title: `${staff.fullName} — ${t('staff.salaryHistory')}`, body, size: 'wide' });
}

/* ---------------- mount ---------------- */
export default {
  async mount(root, params, ctx) {
    state.root = root;
    state.ctx = ctx;
    state.query = normalizeQuery(params);
    state.period = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period || '') ? params.period : currentPeriod();
    state.current = null;

    root.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <h1 style="margin:0">${esc(t('staff.title'))}</h1>
          <p class="muted" style="margin:2px 0 0">${esc(t('staff.subtitle'))}</p>
        </div>
        <div class="btn-row">
          <button class="btn secondary" id="staff-print">🖨️ ${esc(t('common.exportPdf'))}</button>
          <button class="btn secondary" id="staff-export">📊 ${esc(t('common.exportExcel'))}</button>
        </div>
      </div>
      <div class="stats" id="staff-stats"></div>

      <section class="card">
        <div class="card-head">
          <h2>${esc(t('staff.new'))}</h2>
          <span class="badge neutral" id="staff-mode">${esc(t('staff.new'))}</span>
        </div>
        <div class="card-body">
          ${formHTML()}
          <div class="btn-row" style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
            <button class="btn" id="staff-save">💾 ${esc(t('common.save'))}</button>
            <button class="btn secondary" id="staff-new">➕ ${esc(t('common.new'))}</button>
            <button class="btn secondary" id="staff-edit">✏️ ${esc(t('common.edit'))}</button>
            <button class="btn danger" id="staff-delete">🗑️ ${esc(t('common.delete'))}</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3>${esc(t('staff.payroll'))}</h3>
          <div class="btn-row">
            <label class="muted small" for="payroll-period">${esc(t('staff.payrollFor'))}</label>
            <input type="month" id="payroll-period" value="${esc(state.period)}" style="max-width:180px;min-height:40px">
          </div>
        </div>
        <div id="payroll-host">${ui.loadingState()}</div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3>${esc(t('staff.list'))}</h3>
          <div class="toolbar" style="padding:0">
            <div class="field">
              <input type="search" id="staff-search" placeholder="${esc(t('common.searchPlaceholder'))}" value="${esc(state.query.q)}">
            </div>
            <div class="field">
              <select id="staff-status">
                <option value="all">${esc(t('common.all'))}</option>
                <option value="active">${esc(t('common.active'))}</option>
                <option value="inactive">${esc(getLang() === 'en' ? 'Inactive' : 'موقوف')}</option>
              </select>
            </div>
            <button class="btn secondary" id="staff-search-btn">🔍 ${esc(t('common.search'))}</button>
          </div>
        </div>
        <div id="staff-table-host">${ui.loadingState()}</div>
      </section>

      <section class="card" id="salary-history-card">
        <div class="card-head"><h3>${esc(t('staff.salaryHistory'))}</h3>
          <button class="btn secondary sm" id="history-export">📊 ${esc(t('common.exportExcel'))}</button>
        </div>
        <div id="salary-history-host">${ui.loadingState()}</div>
      </section>`;

    const form = root.querySelector('#staff-form');
    form.querySelector('#staff-hireDate').addEventListener('input', updateServiceHint);
    form.querySelector('#staff-phone').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^\d٠-٩]/g, ''); });
    form.addEventListener('submit', (e) => { e.preventDefault(); saveStaff(); });
    root.querySelector('#staff-save').addEventListener('click', saveStaff);
    root.querySelector('#staff-new').addEventListener('click', () => { fillForm(null); form.querySelector('#staff-fullName').focus(); });
    root.querySelector('#staff-edit').addEventListener('click', async () => {
      if (!state.current || !state.current.id) { toast(getLang() === 'en' ? 'Pick an employee from the table' : 'اختر موظفًا من الجدول أولًا'); return; }
      const full = await api.get(`/staff/${state.current.id}`).catch(() => state.current);
      fillForm(full);
    });
    root.querySelector('#staff-delete').addEventListener('click', () => {
      if (!state.current || !state.current.id) { toastError(getLang() === 'en' ? 'Pick an employee first' : 'اختر موظفًا أولًا'); return; }
      deleteStaff(state.current);
    });
    root.querySelector('#staff-print').addEventListener('click', () => window.open('/print/staff?auto=1', '_blank', 'noopener'));
    root.querySelector('#staff-export').addEventListener('click', async () => {
      try { await api.download('/exports/staff.xlsx', 'staff.xlsx'); toastSuccess(t('common.exportExcel')); }
      catch (err) { toastError(err.message); }
    });
    root.querySelector('#payroll-period').addEventListener('change', (e) => {
      state.period = e.target.value;
      loadPayroll(state.period);
      renderStats();
    });
    const search = root.querySelector('#staff-search');
    const runSearch = () => { state.query.q = search.value.trim(); state.query.page = 1; loadList(); };
    root.querySelector('#staff-search-btn').addEventListener('click', runSearch);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
    root.querySelector('#staff-status').addEventListener('change', (e) => { state.query.status = e.target.value; loadList(); });
    root.querySelector('#history-export').addEventListener('click', async () => {
      try { await api.download('/exports/salary-history.xlsx', 'salary-history.xlsx'); toastSuccess(t('common.exportExcel')); }
      catch (err) { toastError(err.message); }
    });

    fillForm(null);
    await Promise.all([loadList(), loadPayroll(state.period), loadHistory()]);

    async function loadHistory() {
      const host = root.querySelector('#salary-history-host');
      try {
        const { items } = await api.get('/staff/salary-history');
        if (!items.length) {
          host.innerHTML = ui.emptyState(t('staff.noRecords'), '📈');
          return;
        }
        host.innerHTML = `<div class="table-wrap"><table class="data">
          <thead><tr>
            <th>${esc(t('common.month'))}</th><th>${esc(t('common.name'))}</th>
            <th>${esc(t('common.basic'))}</th><th>${esc(t('common.bonuses'))}</th><th>${esc(t('common.rewards'))}</th>
            <th>${esc(t('common.deductions'))}</th><th>${esc(t('staff.netSalary'))}</th><th>${esc(t('common.status'))}</th>
          </tr></thead>
          <tbody>${items.map((r) => `<tr>
            <td class="nowrap">${esc(ui.monthLabel(r.period))}</td>
            <td class="name">${esc(r.staffName)}</td>
            <td class="amount">${ui.plainNumber(r.basic)}</td>
            <td class="amount">${ui.plainNumber(r.bonuses)}</td>
            <td class="amount">${ui.plainNumber(r.rewards)}</td>
            <td class="amount">${ui.plainNumber(r.deductions)}</td>
            <td class="amount"><strong>${ui.plainNumber(r.net)}</strong></td>
            <td>${r.status === 'paid' ? `<span class="badge paid">${esc(t('common.paid'))}</span>` : `<span class="badge warn">${esc(t('common.pending'))}</span>`}</td>
          </tr>`).join('')}</tbody></table></div>`;
      } catch (err) {
        host.innerHTML = `<div class="card-body"><p class="field-error">${esc(err.message)}</p></div>`;
      }
    }

    return { destroy() { state.data = null; state.payroll = null; } };
  },
};
