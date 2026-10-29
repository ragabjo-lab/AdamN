import { api, toQuery } from '../api.js';
import { getLang, t } from '../i18n.js';
import * as ui from '../ui.js';
import { todayISO, currentPeriod } from '../dates.js';

const { esc, el, toastSuccess, toastError, money, modal } = ui;

const state = {
  root: null,
  ctx: null,
  year: Number(todayISO().slice(0, 4)),
  period: currentPeriod(),
  overview: null,
  detail: null,
  loading: false,
};

async function load() {
  const root = state.root;
  const host = root.querySelector('#finance-host');
  host.innerHTML = ui.loadingState();
  try {
    const [overview, detail] = await Promise.all([
      api.get(`/finance/year/${state.year}`),
      api.get(`/finance/detail/${state.period}`),
    ]);
    state.overview = overview;
    state.detail = detail;
    render();
  } catch (err) {
    host.innerHTML = `<div class="card-body"><p class="field-error">${esc(err.message)}</p></div>`;
    if (err.code !== 'unauthorized') toastError(err.message);
  }
}

function netBadge(net) {
  const positive = Number(net) >= 0;
  return `<span class="badge ${positive ? 'paid' : 'unpaid'}">${positive ? '▲' : '▼'} ${ui.plainNumber(Math.abs(net))}</span>`;
}

function render() {
  const root = state.root;
  const settings = state.ctx.state.settings;
  const o = state.overview;
  const d = state.detail;
  const host = root.querySelector('#finance-host');

  const months = o.months || [];
  const maxValue = Math.max(1, ...months.map((m) => Math.max(m.revenueTotal, m.expensesTotal)));
  const bars = months.map((m) => `
    <div class="bar-group" title="${esc(ui.monthLabel(m.period))}">
      <div class="bar-stack">
        <div class="bar rev" style="height:${Math.max(2, (m.revenueTotal / maxValue) * 100)}%"></div>
        <div class="bar exp" style="height:${Math.max(2, (m.expensesTotal / maxValue) * 100)}%"></div>
      </div>
      <div class="bar-label">${esc(ui.monthLabel(m.period).split(' ')[0].slice(0, 4))}</div>
    </div>`).join('');

  const rows = months.map((m) => `
    <tr>
      <td class="name">${esc(ui.monthLabel(m.period))}</td>
      <td class="amount">${ui.plainNumber(m.tuition)}</td>
      <td class="amount">${ui.plainNumber(m.otherRevenue)}</td>
      <td class="amount"><strong>${ui.plainNumber(m.revenueTotal)}</strong></td>
      <td class="amount">${ui.plainNumber(m.salaries)}</td>
      <td class="amount">${ui.plainNumber(m.otherExpenses)}</td>
      <td class="amount"><strong>${ui.plainNumber(m.expensesTotal)}</strong></td>
      <td class="amount">${netBadge(m.net)}</td>
      <td>${m.revenueTotal > 0 ? `${ui.plainNumber(m.margin)}%` : '—'}</td>
    </tr>`).join('');

  const revenueBreakdown = (d.breakdown.revenue || []).map((r) => `<div class="file-row"><span class="file-icon">💰</span><div style="flex:1"><strong>${esc(r.category)}</strong><div class="muted small">${r.count} ${esc(getLang() === 'en' ? 'records' : 'سجل')}</div></div><strong>${money(r.total, settings)}</strong></div>`).join('');
  const expenseBreakdown = (d.breakdown.expenses || []).map((r) => `<div class="file-row"><span class="file-icon">🧾</span><div style="flex:1"><strong>${esc(r.category)}</strong><div class="muted small">${r.count} ${esc(getLang() === 'en' ? 'records' : 'سجل')}</div></div><strong>${money(r.total, settings)}</strong></div>`).join('');

  host.innerHTML = `
    <div class="stats">
      ${ui.statCard({ label: t('finance.revenue'), value: money(o.totals.revenueTotal, settings), variant: 'success', hint: `${o.year}` })}
      ${ui.statCard({ label: t('finance.expenses'), value: money(o.totals.expensesTotal, settings), variant: 'danger' })}
      ${ui.statCard({ label: t('finance.net'), value: money(o.totals.net, settings), variant: o.totals.net >= 0 ? 'success' : 'danger' })}
      ${ui.statCard({ label: t('finance.paidStudents'), value: ui.plainNumber(o.paidStudents), hint: `${t('common.of')} ${o.activeStudents}` })}
      ${ui.statCard({ label: t('finance.activeStaff'), value: ui.plainNumber(o.activeStaff), variant: 'accent' })}
    </div>

    <section class="card">
      <div class="card-head">
        <h3>${esc(t('finance.monthly'))} — ${o.year}</h3>
        <div class="btn-row">
          <input type="month" id="finance-period" value="${esc(state.period)}" style="max-width:180px;min-height:40px">
          <button class="btn secondary" id="finance-print">🖨️ ${esc(t('common.exportPdf'))}</button>
          <button class="btn secondary" id="finance-export">📊 ${esc(t('common.exportExcel'))}</button>
        </div>
      </div>
      <div class="card-body">
        <div class="bars">${bars}</div>
        <div class="legend">
          <span><span class="sw" style="background:#15803d"></span>${esc(t('finance.revenue'))}</span>
          <span><span class="sw" style="background:#b91c1c"></span>${esc(t('finance.expenses'))}</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data" style="min-width:900px">
          <thead><tr>
            <th>${esc(t('common.month'))}</th>
            <th>${esc(t('finance.tuition'))}</th>
            <th>${esc(t('finance.otherRevenue'))}</th>
            <th>${esc(t('finance.revenue'))}</th>
            <th>${esc(t('finance.salaries'))}</th>
            <th>${esc(t('finance.otherExpenses'))}</th>
            <th>${esc(t('finance.expenses'))}</th>
            <th>${esc(t('finance.net'))}</th>
            <th>${esc(t('finance.margin'))}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td>${esc(t('common.total'))}</td>
            <td class="amount">${ui.plainNumber(o.totals.tuition)}</td>
            <td class="amount">${ui.plainNumber(o.totals.otherRevenue)}</td>
            <td class="amount">${ui.plainNumber(o.totals.revenueTotal)}</td>
            <td class="amount">${ui.plainNumber(o.totals.salaries)}</td>
            <td class="amount">${ui.plainNumber(o.totals.otherExpenses)}</td>
            <td class="amount">${ui.plainNumber(o.totals.expensesTotal)}</td>
            <td class="amount">${netBadge(o.totals.net)}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
    </section>

    <div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px">
      <section class="card">
        <div class="card-head"><h3>${esc(t('finance.detail'))} — ${esc(d.overview.label)}</h3></div>
        <div class="card-body">
          <div class="stats" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
            ${ui.statCard({ label: t('finance.revenue'), value: money(d.overview.revenue.total, settings), variant: 'success' })}
            ${ui.statCard({ label: t('finance.expenses'), value: money(d.overview.expenses.total, settings), variant: 'danger' })}
            ${ui.statCard({ label: t('finance.net'), value: money(d.overview.net, settings), variant: d.overview.net >= 0 ? 'success' : 'danger' })}
            ${ui.statCard({ label: t('finance.margin'), value: `${ui.plainNumber(d.overview.margin)}%`, variant: 'accent' })}
          </div>
          ${d.overview.pendingPayroll.count > 0 ? `<div class="toast warning" style="position:static;max-width:none;margin-bottom:12px">
            ⚠️ ${d.overview.pendingPayroll.count} ${esc(t('finance.pendingPayroll'))} — ${esc(t('finance.pendingNote'))} (${money(d.overview.pendingPayroll.estimatedBasic, settings)})
          </div>` : ''}
          <h4>${esc(t('finance.breakdown'))}</h4>
          ${revenueBreakdown || ui.emptyState(undefined, '💰')}
          <hr style="border:0;border-top:1px dashed var(--border);margin:12px 0">
          ${expenseBreakdown || ui.emptyState(undefined, '🧾')}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${esc(t('finance.studentFees'))} — ${esc(d.overview.label)}</h3>
          <span class="badge paid">${d.tuition.length} ${esc(getLang() === 'en' ? 'students' : 'طالب')}</span>
        </div>
        <div class="table-wrap" style="max-height:420px;overflow:auto">
          <table class="data" style="min-width:380px">
            <thead><tr><th>${esc(t('students.name'))}</th><th>${esc(t('common.amount'))}</th><th>${esc(t('common.date'))}</th></tr></thead>
            <tbody>${d.tuition.length ? d.tuition.map((r) => `<tr>
              <td class="name">${esc(r.studentName)}</td>
              <td class="amount">${money(r.amount, settings)}</td>
              <td class="nowrap">${esc(ui.fmtTimestamp(r.paidAt, state.ctx.state.timezone))}</td>
            </tr>`).join('') : `<tr><td colspan="3">${ui.emptyState(undefined, '🎓')}</td></tr>`}</tbody>
          </table>
        </div>
        <div class="card-head" style="border-top:1px solid var(--border);border-bottom:0">
          <h3 style="font-size:1rem">${esc(t('finance.salaries'))}</h3>
          <span class="badge warn">${d.salaries.length}</span>
        </div>
        <div class="table-wrap" style="max-height:300px;overflow:auto">
          <table class="data" style="min-width:360px">
            <thead><tr><th>${esc(t('common.name'))}</th><th>${esc(t('staff.netSalary'))}</th><th>${esc(t('common.status'))}</th></tr></thead>
            <tbody>${d.salaries.length ? d.salaries.map((r) => `<tr>
              <td class="name">${esc(r.staffName)}</td>
              <td class="amount">${money(r.net, settings)}</td>
              <td>${r.status === 'paid' ? `<span class="badge paid">${esc(t('common.paid'))}</span>` : `<span class="badge warn">${esc(t('common.pending'))}</span>`}</td>
            </tr>`).join('') : `<tr><td colspan="3">${ui.emptyState(undefined, '👩‍🏫')}</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>`;

  host.querySelector('#finance-period').addEventListener('change', (e) => {
    state.period = e.target.value;
    if (!state.period) return;
    const year = Number(state.period.slice(0, 4));
    if (year !== state.year) {
      state.year = year;
      root.querySelector('#finance-year').value = String(year);
    }
    load();
  });
  host.querySelector('#finance-export').addEventListener('click', async () => {
    try {
      await api.download(`/exports/finance.xlsx${toQuery({ year: state.year })}`, 'finance.xlsx');
      toastSuccess(t('common.exportExcel'));
    } catch (err) { toastError(err.message); }
  });
  host.querySelector('#finance-print').addEventListener('click', () => {
    window.open(`/print/finance${toQuery({ year: state.year, period: state.period, auto: 1 })}`, '_blank', 'noopener');
  });
}

export default {
  async mount(root, params, ctx) {
    state.root = root;
    state.ctx = ctx;
    const thisYear = Number(todayISO().slice(0, 4));
    state.year = Number(params.year) || thisYear;
    state.period = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period || '') ? params.period : `${state.year}-${currentPeriod().slice(5, 7)}`;

    root.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <h1 style="margin:0">${esc(t('finance.title'))}</h1>
          <p class="muted" style="margin:2px 0 0">${esc(t('finance.subtitle'))}</p>
        </div>
        <div class="field" style="min-width:160px">
          <label for="finance-year">${esc(t('finance.year'))}</label>
          <select id="finance-year">
            ${Array.from({ length: 8 }, (_, i) => thisYear - i).map((y) => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="finance-host">${ui.loadingState()}</div>`;

    root.querySelector('#finance-year').addEventListener('change', (e) => {
      state.year = Number(e.target.value);
      state.period = `${state.year}-${state.period.slice(5, 7)}`;
      load();
    });
    await load();
    return { destroy() { state.overview = null; state.detail = null; } };
  },
};
