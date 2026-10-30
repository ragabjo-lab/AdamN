/* Shared view for the "Other revenue" and "Expenses" tabs. */
import { api, toQuery } from '../api.js';
import { getLang, t } from '../i18n.js';
import * as ui from '../ui.js';
import { todayISO } from '../dates.js';

const { esc, el, toast, toastSuccess, toastError, money, fmtDate, modal, confirmDialog, setFieldError, clearErrors } = ui;

const TEXT = {
  revenue: {
    title: 'revenue.title',
    subtitle: 'revenue.subtitle',
    add: 'revenue.new',
    excel: '/exports/revenue.xlsx',
    print: '/print/revenue',
    api: '/revenue',
    perm: 'revenue',
    emoji: '➕',
  },
  expense: {
    title: 'expenses.title',
    subtitle: 'expenses.subtitle',
    add: 'expenses.new',
    excel: '/exports/expenses.xlsx',
    print: '/print/expenses',
    api: '/expenses',
    perm: 'expenses',
    emoji: '➖',
  },
};

export function createLedgerView(kind) {
  const cfg = TEXT[kind];
  const state = {
    root: null,
    ctx: null,
    query: {},
    data: null,
    current: null,
    categories: [],
    today: todayISO(),
    loading: false,
  };

  function normalizeQuery(params = {}) {
    return {
      q: params.q || '',
      day: params.day || '',
      month: params.month || '',
      year: params.year || '',
      category: params.category || '',
      page: Math.max(1, Number(params.page) || 1),
      pageSize: Number(params.pageSize) || 12,
      sort: params.sort || 'date',
      order: params.order === 'asc' ? 'asc' : 'desc',
    };
  }

  async function load({ silent = false } = {}) {
    const host = state.root.querySelector('#ledger-table-host');
    if (!silent && host) host.innerHTML = ui.loadingState();
    try {
      const data = await api.get(`${cfg.api}${toQuery(state.query)}`);
      state.data = data;
      state.categories = data.categories || state.categories;
      renderStats();
      renderTable();
      renderCategoryOptions();
    } catch (err) {
      if (host) host.innerHTML = `<div class="card-body"><p class="field-error">${esc(err.message)}</p></div>`;
      if (err.code !== 'unauthorized') toastError(err.message);
    }
  }

  function renderStats() {
    const host = state.root.querySelector('#ledger-stats');
    if (!host || !state.data) return;
    const s = state.data.summary || {};
    const settings = state.ctx.state.settings;
    const top = (s.byCategory || [])[0];
    host.innerHTML = [
      ui.statCard({ label: t('ledger.monthTotal'), value: money(s.monthTotal, settings), variant: 'success' }),
      ui.statCard({ label: t('ledger.yearTotal'), value: money(s.yearTotal, settings), variant: 'accent' }),
      ui.statCard({ label: t('ledger.filteredTotal'), value: money(s.filteredTotal, settings), variant: '' }),
      ui.statCard({ label: t('ledger.byCategory'), value: top ? esc(top.category) : '—', hint: top ? money(top.total, settings) : '' }),
    ].join('');
  }

  function formHTML() {
    return `
    <form id="ledger-form" class="grid-form" novalidate>
      <div class="field">
        <label for="lg-date">${esc(t('common.date'))} <span class="req">*</span></label>
        <input id="lg-date" name="date" type="text" inputmode="numeric" placeholder="dd/mm/yy" maxlength="10" autocomplete="off">
      </div>
      <div class="field span-2">
        <label for="lg-description">${esc(t('common.description'))} <span class="req">*</span></label>
        <input id="lg-description" name="description" type="text" maxlength="300" autocomplete="off">
      </div>
      <div class="field">
        <label for="lg-amount">${esc(t('common.amount'))} <span class="req">*</span></label>
        <input id="lg-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal">
      </div>
      <div class="field">
        <label for="lg-category">${esc(t('common.category'))}</label>
        <select id="lg-category" name="category"></select>
      </div>
      <div class="field span-2">
        <label for="lg-notes">${esc(t('common.notes'))}</label>
        <textarea id="lg-notes" name="notes" rows="2" maxlength="2000"></textarea>
      </div>
    </form>`;
  }

  function renderCategoryOptions() {
    const select = state.root.querySelector('#lg-category');
    const filter = state.root.querySelector('#filter-category');
    if (select) {
      const value = select.value;
      select.innerHTML = state.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      if (value) select.value = value;
    }
    if (filter) {
      const value = filter.value;
      filter.innerHTML = `<option value="">${esc(t('common.all'))}</option>${state.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
      if (value) filter.value = value;
    }
  }

  function fillForm(record) {
    const form = state.root.querySelector('#ledger-form');
    if (!form) return;
    clearErrors(form);
    state.current = record || null;
    const badge = state.root.querySelector('#ledger-mode');
    if (badge) {
      badge.textContent = record ? `${t('common.edit')} — ${record.description}` : t('common.new');
      badge.className = `badge ${record ? 'info' : 'neutral'}`;
    }
    form.querySelector('#lg-date').value = record ? ui.fmtDate(record.date, { long: true }) : ui.fmtDate(state.today, { long: true });
    form.querySelector('#lg-description').value = record ? record.description : '';
    form.querySelector('#lg-amount').value = record ? record.amount : '';
    form.querySelector('#lg-notes').value = record ? (record.notes || '') : '';
    renderCategoryOptions();
    if (record && record.category) form.querySelector('#lg-category').value = record.category;
  }

  function readForm() {
    const form = state.root.querySelector('#ledger-form');
    return {
      date: form.querySelector('#lg-date').value.trim(),
      description: form.querySelector('#lg-description').value.trim(),
      amount: form.querySelector('#lg-amount').value,
      category: form.querySelector('#lg-category').value,
      notes: form.querySelector('#lg-notes').value.trim(),
    };
  }

  function validate(values) {
    const form = state.root.querySelector('#ledger-form');
    clearErrors(form);
    let ok = true;
    const dateError = ui.validators.date(values.date);
    if (dateError) { setFieldError(form.querySelector('#lg-date'), dateError); ok = false; }
    if (!values.description) { setFieldError(form.querySelector('#lg-description'), t('common.required')); ok = false; }
    const amountError = ui.validators.money(values.amount, { min: 0 });
    if (amountError || values.amount === '') { setFieldError(form.querySelector('#lg-amount'), amountError || t('common.required')); ok = false; }
    return ok;
  }

  async function save() {
    const values = readForm();
    if (!validate(values)) { toastError(t('common.error')); return; }
    const payload = {
      date: values.date,
      description: values.description,
      amount: Number(values.amount),
      category: values.category,
      notes: values.notes || null,
    };
    const btn = state.root.querySelector('#ledger-save');
    btn.disabled = true;
    try {
      const saved = state.current && state.current.id
        ? await api.put(`${cfg.api}/${state.current.id}`, payload)
        : await api.post(cfg.api, payload);
      toastSuccess(t('common.saved'));
      fillForm(saved);
      await load();
    } catch (err) {
      toastError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function remove(record) {
    const ok = await confirmDialog({
      title: `${t('common.delete')} — ${record.description}`,
      message: t('ledger.deleteConfirm'),
      confirmText: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`${cfg.api}/${record.id}`);
      toastSuccess(t('common.deleted'));
      if (state.current && state.current.id === record.id) fillForm(null);
      await load();
    } catch (err) { toastError(err.message); }
  }

  function renderTable() {
    const host = state.root.querySelector('#ledger-table-host');
    if (!host || !state.data) return;
    const data = state.data;
    const headers = [
      { key: 'date', label: t('common.date'), sort: 'date' },
      { key: 'description', label: t('common.description'), sort: 'description' },
      { key: 'category', label: t('common.category'), sort: 'category' },
      { key: 'amount', label: t('common.amount'), sort: 'amount' },
      { key: 'notes', label: t('common.notes') },
    ];
    const th = headers.map((h) => h.sort
      ? `<th class="sortable" data-sort="${h.sort}">${esc(h.label)} <span class="arrow">${state.query.sort === h.sort ? (state.query.order === 'asc' ? '▲' : '▼') : ''}</span></th>`
      : `<th>${esc(h.label)}</th>`).join('');
    const rows = data.items.map((r, idx) => `
      <tr>
        <td class="muted">${(data.pagination.page - 1) * data.pagination.pageSize + idx + 1}</td>
        <td class="nowrap">${esc(fmtDate(r.date))}</td>
        <td class="name">${esc(r.description)}</td>
        <td><span class="badge neutral">${esc(r.category)}</span></td>
        <td class="amount">${money(r.amount, state.ctx.state.settings)}</td>
        <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(r.notes || '')}</td>
        <td class="actions"><div class="row-actions">
          <button class="icon-action" data-action="edit" data-id="${r.id}" title="${esc(t('common.edit'))}">✏️</button>
          <button class="icon-action danger" data-action="delete" data-id="${r.id}" title="${esc(t('common.delete'))}">🗑️</button>
        </div></td>
      </tr>`).join('');
    host.innerHTML = `
      <div class="table-wrap"><table class="data">
        <thead><tr><th style="width:46px">#</th>${th}<th>${esc(t('common.actions'))}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7">${ui.emptyState(esc(t('common.noData')), cfg.emoji)}</td></tr>`}</tbody>
        <tfoot><tr><td>${esc(t('common.total'))}</td><td colspan="2"></td><td></td>
          <td class="amount">${money(data.summary.filteredTotal, state.ctx.state.settings)}</td><td colspan="2"></td></tr></tfoot>
      </table></div>
      <div id="ledger-pager"></div>`;
    host.querySelector('#ledger-pager').appendChild(ui.pager(data.pagination, (page) => {
      state.query.page = page;
      load();
    }));
    host.querySelectorAll('th.sortable').forEach((thCell) => {
      thCell.addEventListener('click', () => {
        const key = thCell.dataset.sort;
        if (state.query.sort === key) state.query.order = state.query.order === 'asc' ? 'desc' : 'asc';
        else { state.query.sort = key; state.query.order = 'asc'; }
        load();
      });
    });
    host.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = data.items.find((r) => String(r.id) === btn.dataset.id);
        if (!item) return;
        if (btn.dataset.action === 'edit') {
          fillForm(item);
          state.root.querySelector('#ledger-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (btn.dataset.action === 'delete') remove(item);
      });
    });
  }

  function wireFilters() {
    const search = state.root.querySelector('#lg-search');
    const runSearch = () => { state.query.q = search.value.trim(); state.query.page = 1; load(); };
    state.root.querySelector('#lg-search-btn').addEventListener('click', runSearch);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
    state.root.querySelector('#filter-day').addEventListener('change', (e) => {
      state.query.day = e.target.value;
      if (e.target.value) { state.query.month = ''; state.root.querySelector('#filter-month').value = ''; }
      load();
    });
    state.root.querySelector('#filter-month').addEventListener('change', (e) => {
      state.query.month = e.target.value;
      if (e.target.value) { state.query.day = ''; state.root.querySelector('#filter-day').value = ''; }
      load();
    });
    state.root.querySelector('#filter-year').addEventListener('change', (e) => {
      state.query.year = e.target.value;
      state.query.month = '';
      state.query.day = '';
      state.root.querySelector('#filter-month').value = '';
      state.root.querySelector('#filter-day').value = '';
      load();
    });
    state.root.querySelector('#filter-category').addEventListener('change', (e) => {
      state.query.category = e.target.value;
      load();
    });
    state.root.querySelector('#filter-size').addEventListener('change', (e) => {
      state.query.pageSize = Number(e.target.value);
      state.query.page = 1;
      load();
    });
  }

  return {
    async mount(root, params, ctx) {
      state.root = root;
      state.ctx = ctx;
      state.query = normalizeQuery(params);
      state.current = null;
      const settings = ctx.state.settings;
      const thisYear = state.today.slice(0, 4);
      root.innerHTML = `
        <div class="page-head" style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px">
          <div>
            <h1 style="margin:0">${esc(t(cfg.title))}</h1>
            <p class="muted" style="margin:2px 0 0">${esc(t(cfg.subtitle))}</p>
          </div>
          <div class="btn-row">
            <button class="btn secondary" id="ledger-print">🖨️ ${esc(t('common.exportPdf'))}</button>
            <button class="btn secondary" id="ledger-export">📊 ${esc(t('common.exportExcel'))}</button>
          </div>
        </div>
        <div class="stats" id="ledger-stats"></div>

        <section class="card">
          <div class="card-head">
            <h2>${esc(t(cfg.add))}</h2>
            <span class="badge neutral" id="ledger-mode">${esc(t('common.new'))}</span>
          </div>
          <div class="card-body">
            ${formHTML()}
            <div class="btn-row" style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
              <button class="btn" id="ledger-save">💾 ${esc(t('common.save'))}</button>
              <button class="btn secondary" id="ledger-new">➕ ${esc(t('common.new'))}</button>
              <button class="btn secondary" id="ledger-edit">✏️ ${esc(t('common.edit'))}</button>
              <button class="btn danger" id="ledger-delete">🗑️ ${esc(t('common.delete'))}</button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h3>${esc(t('common.search'))}</h3>
            <span class="muted small">${esc(getLang() === 'en' ? 'Filter by day, month, year or category' : 'تصفية حسب اليوم أو الشهر أو السنة أو التصنيف')}</span>
          </div>
          <div class="card-body" style="padding-bottom:6px">
            <div class="toolbar">
              <div class="field grow">
                <label for="lg-search">${esc(t('common.search'))}</label>
                <input id="lg-search" type="search" placeholder="${esc(getLang() === 'en' ? 'Search description or notes…' : 'ابحث في البيان أو الملاحظات…')}" value="${esc(state.query.q)}">
              </div>
              <div class="field">
                <label for="filter-day">${esc(t('ledger.day'))}</label>
                <input type="date" id="filter-day" value="${esc(state.query.day)}">
              </div>
              <div class="field">
                <label for="filter-month">${esc(t('ledger.month'))}</label>
                <input type="month" id="filter-month" value="${esc(state.query.month)}">
              </div>
              <div class="field">
                <label for="filter-year">${esc(t('ledger.year'))}</label>
                <select id="filter-year">
                  <option value="">${esc(t('common.all'))}</option>
                  ${Array.from({ length: 8 }, (_, i) => Number(thisYear) - i).map((y) => `<option value="${y}" ${String(y) === String(state.query.year) ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="filter-category">${esc(t('common.category'))}</label>
                <select id="filter-category"><option value="">${esc(t('common.all'))}</option></select>
              </div>
              <div class="field">
                <label for="filter-size">${esc(t('common.perPage'))}</label>
                <select id="filter-size">
                  ${[12, 25, 50, 100].map((n) => `<option value="${n}" ${n === state.query.pageSize ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
              </div>
              <button class="btn secondary" id="lg-search-btn">🔍 ${esc(t('common.search'))}</button>
            </div>
          </div>
          <div id="ledger-table-host">${ui.loadingState()}</div>
        </section>`;

      const form = root.querySelector('#ledger-form');
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
      root.querySelector('#ledger-save').addEventListener('click', save);
      root.querySelector('#ledger-new').addEventListener('click', () => { fillForm(null); form.querySelector('#lg-description').focus(); });
      root.querySelector('#ledger-edit').addEventListener('click', () => {
        if (!state.current) { toast(getLang() === 'en' ? 'Pick a record from the table' : 'اختر سجلًا من الجدول أولًا'); return; }
        fillForm(state.current);
      });
      root.querySelector('#ledger-delete').addEventListener('click', () => {
        if (!state.current) { toastError(getLang() === 'en' ? 'Pick a record first' : 'اختر سجلًا أولًا'); return; }
        remove(state.current);
      });
      root.querySelector('#ledger-export').addEventListener('click', async () => {
        try {
          await api.download(`${cfg.excel}${toQuery(state.query)}`, `${kind}.xlsx`);
          toastSuccess(t('common.exportExcel'));
        } catch (err) { toastError(err.message); }
      });
      root.querySelector('#ledger-print').addEventListener('click', () => {
        window.open(`${cfg.print}${toQuery({ ...state.query, auto: 1 })}`, '_blank', 'noopener');
      });

      wireFilters();
      fillForm(null);
      await load();
      void settings;

      return { destroy() { state.data = null; } };
    },
  };
}
