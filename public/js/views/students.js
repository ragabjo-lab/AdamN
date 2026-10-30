import { api, toQuery } from '../api.js';
import { getLang, t, monthName } from '../i18n.js';
import * as ui from '../ui.js';
import { parseDdMmYy, isoToDisplay, diffYMD, todayISO, monthsOfYear, currentPeriod } from '../dates.js';

const { esc, el, toast, toastSuccess, toastError, money, fmtDate, durationLabel, modal, confirmDialog, setFieldError, clearErrors } = ui;

const MONTHS_SHORT_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthShort = (m) => (getLang() === 'en' ? MONTHS_SHORT_EN : MONTHS_SHORT_AR)[Number(m) - 1];

const state = {
  root: null,
  ctx: null,
  query: {},
  data: null,
  current: null,
  mode: 'create',
  today: todayISO(),
  timezone: 'UTC',
  pendingPhotoFile: null,
  formMonth: currentPeriod(),
  selectedAttachments: [],
  loading: false,
};

function normalizeQuery(params = {}) {
  const today = todayISO();
  return {
    q: params.q || '',
    year: Number(params.year) || Number(today.slice(0, 4)),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month || '') ? params.month : today.slice(0, 7),
    status: ['paid', 'unpaid'].includes(params.status) ? params.status : 'all',
    lifeStatus: ['active', 'archived'].includes(params.lifeStatus) ? params.lifeStatus : 'active',
    sort: params.sort || 'name',
    order: params.order === 'desc' ? 'desc' : 'asc',
    page: Math.max(1, Number(params.page) || 1),
    pageSize: Number(params.pageSize) || 10,
    highlight: params.highlight ? Number(params.highlight) : null,
  };
}

/* -------------------------------------------------------------- */
/* data                                                           */
/* -------------------------------------------------------------- */
async function load({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) {
    const tableHost = state.root.querySelector('#students-table-host');
    if (tableHost) tableHost.innerHTML = ui.loadingState();
  }
  try {
    const data = await api.get(`/students${toQuery(state.query)}`);
    state.data = data;
    state.today = data.context.today;
    state.timezone = data.context.timezone;
    renderStats();
    renderTable();
    renderTableToolbarState();
    if (state.query.highlight) {
      const row = state.root.querySelector(`tr[data-student-id="${state.query.highlight}"]`);
      if (row) {
        row.classList.add('highlight');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  } catch (err) {
    const host = state.root.querySelector('#students-table-host');
    if (host) host.innerHTML = `<div class="card-body"><p class="field-error">${esc(err.message)}</p></div>`;
    if (err.code !== 'unauthorized') toastError(err.message);
  } finally {
    state.loading = false;
  }
}

/* -------------------------------------------------------------- */
/* stats                                                          */
/* -------------------------------------------------------------- */
function renderStats() {
  const s = (state.data && state.data.summary) || {};
  const host = state.root.querySelector('#students-stats');
  if (!host) return;
  host.innerHTML = [
    ui.statCard({ label: t('students.title'), value: ui.plainNumber(s.totalStudents || 0), hint: t('common.active') }),
    ui.statCard({ label: `${t('common.paid')} — ${monthShort((s.month || '').slice(5, 7))}`, value: ui.plainNumber(s.paidCount || 0), variant: 'success' }),
    ui.statCard({ label: `${t('common.unpaid')} — ${monthShort((s.month || '').slice(5, 7))}`, value: ui.plainNumber(s.unpaidCount || 0), variant: 'danger' }),
    ui.statCard({ label: t('ledger.monthTotal'), value: money(s.collected, state.ctx.state.settings), variant: 'accent', hint: `${t('common.of')} ${money(s.expected, state.ctx.state.settings)}` }),
    ui.statCard({ label: t('ledger.yearTotal'), value: money(s.yearCollected, state.ctx.state.settings), variant: 'warning', hint: String(s.year || '') }),
  ].join('');
}

/* -------------------------------------------------------------- */
/* form                                                           */
/* -------------------------------------------------------------- */
function formHTML() {
  const lang = getLang();
  const years = [state.today.slice(0, 4), ...Array.from({ length: 6 }, (_, i) => String(Number(state.today.slice(0, 4)) - i - 1))];
  years.forEach((y) => { if (!years.includes(y)) years.push(y); });
  const yearOptions = [...new Set([state.formMonth.slice(0, 4), ...years])];
  return `
  <form id="student-form" class="with-photo" novalidate>
    <div class="grid-form">
      <div class="field">
        <label for="fullName">${esc(t('students.name'))} <span class="req">*</span></label>
        <input id="fullName" name="fullName" type="text" maxlength="120" autocomplete="off" placeholder="${esc(lang === 'en' ? 'Student full name' : 'اسم الطالب بالكامل')}">
        <div class="hint">${esc(t('students.nameHint'))}</div>
      </div>
      <div class="field">
        <label for="birthDate">${esc(t('students.birthDate'))} <span class="req">*</span></label>
        <input id="birthDate" name="birthDate" type="text" inputmode="numeric" placeholder="dd/mm/yy" maxlength="10" autocomplete="off">
        <div class="hint" id="age-hint">${esc(t('students.birthHint'))}</div>
      </div>
      <div class="field">
        <label for="enrollDate">${esc(t('students.enrollDate'))} <span class="req">*</span></label>
        <input id="enrollDate" name="enrollDate" type="text" inputmode="numeric" placeholder="dd/mm/yy" maxlength="10" autocomplete="off">
        <div class="hint" id="duration-hint">${esc(lang === 'en' ? 'Shows days, months, years' : 'يظهر عدد الأيام والشهور والسنين')}</div>
      </div>
      <div class="field">
        <label for="guardianPhone">${esc(t('students.guardianPhone'))} <span class="req">*</span></label>
        <input id="guardianPhone" name="guardianPhone" type="tel" inputmode="numeric" maxlength="15" autocomplete="off" placeholder="01xxxxxxxxx">
        <div class="hint">${esc(t('students.guardianPhoneHint'))}</div>
      </div>
      <div class="field">
        <label for="guardianName">${esc(t('students.guardianName'))}</label>
        <input id="guardianName" name="guardianName" type="text" maxlength="120" autocomplete="off">
      </div>
      <div class="field span-2">
        <label for="address">${esc(t('students.address'))}</label>
        <input id="address" name="address" type="text" maxlength="300" autocomplete="off">
      </div>
      <div class="field">
        <label for="monthlyFee">${esc(t('students.monthlyFee'))}</label>
        <input id="monthlyFee" name="monthlyFee" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
        <div class="hint">${esc(lang === 'en' ? 'Default fee used every month' : 'القيمة الافتراضية المحسوبة كل شهر')}</div>
      </div>
      <div class="field">
        <label for="feeMonth">${esc(t('common.month'))}</label>
        <select id="feeMonth" name="feeMonth">
          ${yearOptions.map((y) => `<optgroup label="${y}">${monthsOfYear(y).map((p) => `
            <option value="${p}" ${p === state.formMonth ? 'selected' : ''}>${monthShort(p.slice(5, 7))} ${y}</option>`).join('')}
          </optgroup>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="payAmount">${esc(t('students.paymentAmount'))} — <span id="fee-month-label">${esc(ui.monthLabel(state.formMonth))}</span></label>
        <input id="payAmount" name="payAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
        <div class="hint" id="fee-hint">${esc(t('students.paymentNote'))}</div>
      </div>
      <div class="field span-2">
        <label for="notes">${esc(t('common.notes'))}</label>
        <textarea id="notes" name="notes" maxlength="2000" rows="2"></textarea>
      </div>
    </div>
    <div class="photo-box">
      <div class="photo-frame" id="photo-frame">${esc(t('students.noPhoto'))}</div>
      <div class="caption">${esc(lang === 'en' ? 'Student photo' : 'صورة الطالب')}</div>
      <button class="btn secondary sm" type="button" id="photo-btn">📷 ${esc(t('students.uploadPhoto'))}</button>
      <button class="btn ghost sm" type="button" id="photo-remove">🗑 ${esc(t('students.removePhoto'))}</button>
      <input type="file" id="photo-input" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden">
    </div>
  </form>`;
}

function updateAgeHints() {
  const birth = parseDdMmYy(state.root.querySelector('#birthDate').value);
  const enroll = parseDdMmYy(state.root.querySelector('#enrollDate').value);
  const ageHint = state.root.querySelector('#age-hint');
  const durHint = state.root.querySelector('#duration-hint');
  if (birth && birth <= state.today) {
    const d = diffYMD(birth, state.today);
    ageHint.className = 'hint ok';
    ageHint.textContent = `${t('students.age')}: ${durationLabel(d)} (${ui.plainNumber(Math.round((Date.parse(state.today) - Date.parse(birth)) / 86400000))} ${getLang() === 'en' ? 'days' : 'يوم'})`;
  } else {
    ageHint.className = 'hint';
    ageHint.textContent = birth ? (getLang() === 'en' ? 'Birth date cannot be in the future' : 'تاريخ الميلاد لا يمكن أن يكون في المستقبل') : t('students.birthHint');
  }
  if (enroll && enroll <= state.today) {
    const d = diffYMD(enroll, state.today);
    durHint.className = 'hint ok';
    durHint.textContent = `${t('students.duration')}: ${durationLabel(d)}`;
  } else {
    durHint.className = 'hint';
    durHint.textContent = getLang() === 'en' ? 'Shows days, months, years' : 'يظهر عدد الأيام والشهور والسنين';
  }
  updateFeeHint();
}

function updateFeeHint() {
  const input = state.root.querySelector('#payAmount');
  const hint = state.root.querySelector('#fee-hint');
  const label = state.root.querySelector('#fee-month-label');
  if (label) label.textContent = ui.monthLabel(state.formMonth);
  if (!input || !hint) return;
  const value = Number(input.value || 0);
  if (value > 0) {
    hint.className = 'hint ok';
    hint.textContent = `${t('common.paid')} ✓ — ${money(value, state.ctx.state.settings)} • ${ui.monthLabel(state.formMonth)}`;
  } else {
    hint.className = 'hint warn';
    hint.textContent = `${t('common.unpaid')} ✗ • ${ui.monthLabel(state.formMonth)}`;
  }
}

function setPhotoPreview(url, name) {
  const frame = state.root.querySelector('#photo-frame');
  if (!frame) return;
  frame.innerHTML = url
    ? `<img src="${esc(url)}" alt="${esc(name || 'photo')}">`
    : esc(t('students.noPhoto'));
  const btn = state.root.querySelector('#photo-btn');
  if (btn) btn.textContent = url ? `📷 ${t('students.changePhoto')}` : `📷 ${t('students.uploadPhoto')}`;
}

function fillForm(student) {
  const form = state.root.querySelector('#student-form');
  if (!form) return;
  clearErrors(form);
  state.current = student || null;
  state.mode = student ? 'edit' : 'create';
  const badge = state.root.querySelector('#form-mode');
  if (badge) {
    badge.textContent = student ? `${t('students.modeEdit')} — ${student.fullName}` : t('students.modeCreate');
    badge.className = `badge ${student ? 'info' : 'neutral'}`;
  }
  form.querySelector('#fullName').value = student ? student.fullName : '';
  form.querySelector('#birthDate').value = student ? isoToDisplay(student.birthDate) : '';
  form.querySelector('#enrollDate').value = student ? isoToDisplay(student.enrollDate) : '';
  form.querySelector('#guardianPhone').value = student ? (student.guardianPhone || '') : '';
  form.querySelector('#guardianName').value = student ? (student.guardianName || '') : '';
  form.querySelector('#address').value = student ? (student.address || '') : '';
  form.querySelector('#notes').value = student ? (student.notes || '') : '';
  state.formMonth = student ? state.query.month : currentPeriod();
  const monthSelect = form.querySelector('#feeMonth');
  if (monthSelect) {
    if (![...monthSelect.querySelectorAll('option')].some((o) => o.value === state.formMonth)) {
      monthSelect.insertAdjacentHTML('afterbegin', `<option value="${state.formMonth}">${ui.monthLabel(state.formMonth)}</option>`);
    }
    monthSelect.value = state.formMonth;
  }
  const defaultFee = student
    ? student.monthlyFee
    : (state.ctx.state.settings.default_subscription_fee || 0);
  form.querySelector('#monthlyFee').value = defaultFee === 0 ? '0' : String(defaultFee);
  const paidThisMonth = student && student.payments ? Number(student.payments[state.formMonth] || 0) : 0;
  form.querySelector('#payAmount').value = paidThisMonth > 0 ? String(paidThisMonth) : '0';
  setPhotoPreview(student && student.photoUrl ? student.photoUrl : null, student && student.fullName);
  state.pendingPhotoFile = null;
  updateAgeHints();
}

function readForm() {
  const form = state.root.querySelector('#student-form');
  return {
    fullName: form.querySelector('#fullName').value.trim(),
    birthDate: form.querySelector('#birthDate').value.trim(),
    enrollDate: form.querySelector('#enrollDate').value.trim(),
    guardianPhone: ui.validators.digits(form.querySelector('#guardianPhone').value) === null
      ? form.querySelector('#guardianPhone').value.replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim()
      : form.querySelector('#guardianPhone').value.trim(),
    guardianName: form.querySelector('#guardianName').value.trim(),
    address: form.querySelector('#address').value.trim(),
    notes: form.querySelector('#notes').value.trim(),
    monthlyFee: form.querySelector('#monthlyFee').value,
    payAmount: form.querySelector('#payAmount').value,
    month: form.querySelector('#feeMonth').value,
  };
}

function validateForm(values) {
  const form = state.root.querySelector('#student-form');
  clearErrors(form);
  let ok = true;
  const fail = (selector, message) => {
    setFieldError(form.querySelector(selector), message);
    ok = false;
  };
  const nameError = ui.validators.letters(values.fullName);
  if (nameError) fail('#fullName', nameError);
  const birthError = ui.validators.date(values.birthDate);
  if (birthError) fail('#birthDate', birthError);
  else if (parseDdMmYy(values.birthDate) > state.today) fail('#birthDate', getLang() === 'en' ? 'Cannot be in the future' : 'لا يمكن أن يكون في المستقبل');
  const enrollError = ui.validators.date(values.enrollDate);
  if (enrollError) fail('#enrollDate', enrollError);
  else if (parseDdMmYy(values.enrollDate) > state.today) fail('#enrollDate', getLang() === 'en' ? 'Cannot be in the future' : 'لا يمكن أن يكون في المستقبل');
  else if (parseDdMmYy(values.birthDate) && parseDdMmYy(values.enrollDate) < parseDdMmYy(values.birthDate)) {
    fail('#enrollDate', getLang() === 'en' ? 'Must be after birth date' : 'يجب أن يكون بعد تاريخ الميلاد');
  }
  const phoneError = ui.validators.digits(values.guardianPhone);
  if (phoneError) fail('#guardianPhone', phoneError);
  const feeError = ui.validators.money(values.monthlyFee);
  if (feeError) fail('#monthlyFee', feeError);
  const payError = ui.validators.money(values.payAmount);
  if (payError) fail('#payAmount', payError);
  if (values.guardianName) {
    const gError = ui.validators.letters(values.guardianName);
    if (gError) fail('#guardianName', gError);
  }
  return ok;
}

async function saveStudent() {
  const values = readForm();
  if (!validateForm(values)) {
    toastError(getLang() === 'en' ? 'Please fix the highlighted fields' : 'يرجى تصحيح الحقول المشار إليها');
    return;
  }
  const payload = {
    fullName: values.fullName,
    birthDate: values.birthDate,
    enrollDate: values.enrollDate,
    guardianPhone: values.guardianPhone,
    guardianName: values.guardianName || null,
    address: values.address || null,
    notes: values.notes || null,
    monthlyFee: values.monthlyFee === '' ? 0 : Number(values.monthlyFee),
  };
  const saveBtn = state.root.querySelector('#btn-save');
  saveBtn.disabled = true;
  try {
    let saved;
    if (state.current && state.current.id) {
      saved = await api.put(`/students/${state.current.id}`, payload);
    } else {
      saved = await api.post('/students', payload);
    }
    if (state.pendingPhotoFile) {
      try {
        await api.upload(`/students/${saved.id}/photo`, state.pendingPhotoFile);
        state.pendingPhotoFile = null;
      } catch (err) { toastError(err.message); }
    }
    await api.put(`/students/${saved.id}/payments/${values.month}`, {
      amount: values.payAmount === '' ? 0 : Number(values.payAmount),
    });
    toastSuccess(t('common.saved'));
    state.query.page = 1;
    state.query.q = state.query.q || '';
    const fresh = await api.get(`/students/${saved.id}?year=${state.query.year}`);
    fillForm(fresh);
    await load();
  } catch (err) {
    toastError(err.message);
  } finally {
    saveBtn.disabled = false;
  }
}

/* -------------------------------------------------------------- */
/* table                                                          */
/* -------------------------------------------------------------- */
function sortHeader(key, label, extraClass = '') {
  const active = state.query.sort === key;
  const arrow = active ? (state.query.order === 'asc' ? '▲' : '▼') : '';
  return `<th class="sortable ${extraClass}" data-sort="${key}">${esc(label)} <span class="arrow">${arrow}</span></th>`;
}

function paymentCell(student, period) {
  const amount = Number((student.payments || {})[period] || 0);
  const paid = amount > 0;
  const isCurrent = period === currentPeriod();
  return `<td style="padding:5px 4px">
    <button type="button" class="badge ${paid ? 'paid' : 'unpaid'}" data-pay="${student.id}" data-period="${period}"
      style="border:0;cursor:pointer;${isCurrent ? 'outline:2px solid #1d4ed8;outline-offset:1px' : ''}"
      title="${esc(`${ui.monthLabel(period)} — ${paid ? t('common.paid') : t('common.unpaid')}${paid ? ` (${money(amount, state.ctx.state.settings)})` : ''}`)}">
      ${paid ? '✓' : '✗'}
    </button></td>`;
}

function renderTable() {
  const host = state.root.querySelector('#students-table-host');
  if (!host) return;
  const data = state.data;
  if (!data) return;
  const year = state.query.year;
  const months = monthsOfYear(year);
  const items = data.items;
  const current = currentPeriod();

  const head = `<tr>
    <th style="width:46px">#</th>
    ${sortHeader('name', getLang() === 'en' ? 'Student' : 'اسم الطالب')}
    ${sortHeader('age', t('students.age'))}
    ${sortHeader('phone', t('common.phone'))}
    ${sortHeader('enrollDate', t('students.enrollDate'))}
    <th>${esc(t('students.duration'))}</th>
    ${months.map((p) => `<th data-month="${p}" style="${p === current ? 'background:#dbeafe;color:#1e40af' : ''};font-size:.78rem">${esc(monthShort(p.slice(5, 7)))}</th>`).join('')}
    <th>${esc(t('common.actions'))}</th>
  </tr>`;

  const rows = items.map((student, idx) => {
    const globalIndex = ((data.pagination.page - 1) * data.pagination.pageSize) + idx + 1;
    const photo = student.photoUrl
      ? `<img class="avatar-cell" src="${esc(student.photoUrl)}" alt="">`
      : `<span class="avatar-cell placeholder">${esc((student.fullName || '?').charAt(0))}</span>`;
    return `<tr data-student-id="${student.id}">
      <td class="muted">${globalIndex}</td>
      <td class="name">
        <div style="display:flex;align-items:center;gap:9px">
          ${photo}
          <div>
            <div>${esc(student.fullName)}</div>
            <div class="muted small">${esc(student.code || '')}${student.status === 'archived' ? ` • ${esc(t('common.archived'))}` : ''}</div>
          </div>
        </div>
      </td>
      <td class="nowrap">${esc(durationLabel(student.age))}</td>
      <td class="numeric" dir="ltr">${esc(student.guardianPhone || '—')}</td>
      <td class="nowrap">${esc(fmtDate(student.enrollDate))}</td>
      <td class="nowrap">${esc(durationLabel(student.duration))}</td>
      ${months.map((p) => paymentCell(student, p)).join('')}
      <td class="actions">
        <div class="row-actions">
          <button class="icon-action" data-action="edit" data-id="${student.id}" title="${esc(t('common.edit'))}">✏️</button>
          <button class="icon-action" data-action="print" data-id="${student.id}" title="${esc(t('students.printStudent'))}">🖨️</button>
          <button class="icon-action" data-action="attachments" data-id="${student.id}" title="${esc(t('students.attachments'))}">📎</button>
          <button class="icon-action danger" data-action="delete" data-id="${student.id}" title="${esc(t('common.delete'))}">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>${head}</thead>
        <tbody>${rows || `<tr><td colspan="${7 + months.length}">${ui.emptyState(t('students.noStudents'), '🎓')}</td></tr>`}</tbody>
      </table>
    </div>
    <div id="students-pager"></div>`;

  const pagerHost = host.querySelector('#students-pager');
  pagerHost.appendChild(ui.pager(data.pagination, (page) => {
    state.query.page = page;
    load();
  }));

  host.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.query.sort === key) state.query.order = state.query.order === 'asc' ? 'desc' : 'asc';
      else { state.query.sort = key; state.query.order = 'asc'; }
      state.query.page = 1;
      load();
    });
  });

  host.querySelectorAll('[data-pay]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const student = state.data.items.find((s) => String(s.id) === btn.dataset.pay);
      if (student) openPaymentModal(student, btn.dataset.period);
    });
  });

  host.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const student = state.data.items.find((s) => s.id === id);
      const action = btn.dataset.action;
      if (action === 'edit' && student) {
        const full = await api.get(`/students/${id}?year=${state.query.year}`).catch(() => student);
        fillForm(full);
        state.root.querySelector('#student-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        state.root.querySelector('#fullName').focus();
      }
      if (action === 'print') printStudent(id);
      if (action === 'attachments') openAttachmentsModal(id);
      if (action === 'delete' && student) deleteStudent(student);
    });
  });
}

function renderTableToolbarState() {
  const search = state.root.querySelector('#students-search');
  if (search && document.activeElement !== search) search.value = state.query.q;
  const year = state.root.querySelector('#filter-year');
  if (year) year.value = String(state.query.year);
  const month = state.root.querySelector('#filter-month');
  if (month) month.value = state.query.month;
  const status = state.root.querySelector('#filter-status');
  if (status) status.value = state.query.status;
  const life = state.root.querySelector('#filter-life');
  if (life) life.value = state.query.lifeStatus;
  const size = state.root.querySelector('#filter-size');
  if (size) size.value = String(state.query.pageSize);
}

/* -------------------------------------------------------------- */
/* actions                                                        */
/* -------------------------------------------------------------- */
function printStudent(id) {
  const url = `/print/student/${id}?year=${state.query.year}&auto=1`;
  window.open(url, '_blank', 'noopener');
}

function printAll() {
  const q = toQuery({ year: state.query.year, status: state.query.status, month: state.query.month, auto: 1 });
  window.open(`/print/students${q}`, '_blank', 'noopener');
}

async function deleteStudent(student) {
  const ok = await confirmDialog({
    title: `${t('common.delete')} — ${student.fullName}`,
    message: t('students.deleteConfirm'),
    confirmText: t('common.delete'),
    danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/students/${student.id}`);
    toastSuccess(t('common.deleted'));
    if (state.current && state.current.id === student.id) fillForm(null);
    await load();
  } catch (err) { toastError(err.message); }
}

async function openPaymentModal(student, period) {
  const paidAmount = Number((student.payments || {})[period] || 0);
  const suggested = paidAmount > 0 ? paidAmount : (student.monthlyFee || state.ctx.state.settings.default_subscription_fee || 0);
  const body = el('div', { class: 'grid-form', style: 'grid-template-columns:1fr' });
  body.innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin:0">
      <div class="stat"><div class="label">${esc(t('students.name'))}</div><div class="value" style="font-size:1.1rem">${esc(student.fullName)}</div></div>
      <div class="stat"><div class="label">${esc(t('common.month'))}</div><div class="value" style="font-size:1.1rem">${esc(ui.monthLabel(period))}</div></div>
    </div>
    <div class="field">
      <label>${esc(t('students.paymentAmount'))}</label>
      <input type="number" id="pay-amount" min="0" step="0.01" value="${suggested}" style="font-size:1.2rem;font-weight:700">
      <div class="hint" id="pay-state"></div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn secondary sm" data-quick="${suggested}">${esc(money(suggested, state.ctx.state.settings))}</button>
      <button type="button" class="btn secondary sm" data-quick="0">${esc(t('common.unpaid'))}</button>
    </div>
    <div class="field"><label>${esc(t('common.notes'))}</label><textarea id="pay-notes" rows="2"></textarea></div>`;
  const foot = el('div', { style: 'display:flex;gap:10px' });
  const cancel = el('button', { class: 'btn secondary', type: 'button' }, t('common.cancel'));
  const ok = el('button', { class: 'btn success', type: 'button' }, t('common.save'));
  foot.append(cancel, ok);
  const m = modal({ title: `${t('students.paymentTitle')} — ${ui.monthLabel(period)}`, body, footer: foot });
  const amountInput = body.querySelector('#pay-amount');
  const stateHint = body.querySelector('#pay-state');
  const update = () => {
    const value = Number(amountInput.value || 0);
    stateHint.className = value > 0 ? 'hint ok' : 'hint warn';
    stateHint.textContent = value > 0 ? `${t('common.paid')} ✓` : `${t('common.unpaid')} ✗`;
  };
  update();
  amountInput.addEventListener('input', update);
  body.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    amountInput.value = b.dataset.quick;
    update();
  }));
  cancel.addEventListener('click', () => m.close());
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await api.put(`/students/${student.id}/payments/${period}`, {
        amount: Number(amountInput.value || 0),
        notes: body.querySelector('#pay-notes').value.trim() || null,
      });
      toastSuccess(t('students.paymentSaved'));
      m.close();
      await load();
    } catch (err) {
      toastError(err.message);
      ok.disabled = false;
    }
  });
}

async function openAttachmentsModal(studentId) {
  let student;
  try {
    student = await api.get(`/students/${studentId}?year=${state.query.year}`);
  } catch (err) { toastError(err.message); return; }
  const body = el('div');
  const renderList = (items) => {
    const list = items.length ? items.map((a) => `
      <div class="file-row" data-att="${a.id}">
        <span class="file-icon">${(a.mime || '').includes('pdf') ? '📕' : (a.mime || '').startsWith('image/') ? '🖼️' : '📄'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;word-break:break-all">${esc(a.fileName)}</div>
          <div class="muted small">${Math.round(a.size / 1024)} KB • ${esc(ui.fmtTimestamp(a.createdAt, state.timezone))}</div>
        </div>
        <a class="btn secondary sm" href="${esc(a.url)}?download=1" target="_blank" rel="noopener">${esc(t('settings.download'))}</a>
        <button class="icon-action danger" data-del="${a.id}" title="${esc(t('common.delete'))}">🗑️</button>
      </div>`).join('') : `<div class="empty">${esc(getLang() === 'en' ? 'No attachments yet' : 'لا توجد مرفقات بعد')}</div>`;
    body.querySelector('#att-list').innerHTML = list;
    body.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.del(`/attachments/${btn.dataset.del}`);
          toastSuccess(t('common.deleted'));
          const fresh = await api.get(`/students/${studentId}?year=${state.query.year}`);
          renderList(fresh.attachments);
          load({ silent: true });
        } catch (err) { toastError(err.message); }
      });
    });
  };
  body.innerHTML = `
    <div class="dropzone" id="att-drop">📎 ${esc(t('students.uploadAttachment'))}<div class="muted small">${esc(t('students.attachmentsHint'))}</div></div>
    <input type="file" id="att-input" class="hidden" multiple>
    <div id="att-list" style="margin-top:12px"></div>`;
  const m = modal({ title: `${t('students.attachments')} — ${student.fullName}`, body, size: 'wide' });
  renderList(student.attachments || []);

  const input = body.querySelector('#att-input');
  const drop = body.querySelector('#att-drop');
  const upload = async (files) => {
    for (const file of files) {
      try {
        await api.upload(`/students/${studentId}/attachments`, file);
        toastSuccess(`${t('students.attachUploaded')}: ${file.name}`);
      } catch (err) { toastError(`${file.name}: ${err.message}`); }
    }
    const fresh = await api.get(`/students/${studentId}?year=${state.query.year}`);
    renderList(fresh.attachments || []);
    load({ silent: true });
  };
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files.length) upload([...input.files]); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]);
  });
  void m;
}

/* -------------------------------------------------------------- */
/* mount                                                          */
/* -------------------------------------------------------------- */
export default {
  async mount(root, params, ctx) {
    state.root = root;
    state.ctx = ctx;
    state.query = normalizeQuery(params);
    state.current = null;
    state.mode = 'create';

    root.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <h1 style="margin:0">${esc(t('students.title'))}</h1>
          <p class="muted" style="margin:2px 0 0">${esc(t('students.subtitle'))}</p>
        </div>
        <div class="btn-row">
          <button class="btn secondary" id="btn-print-all">🖨️ ${esc(t('students.printAll'))}</button>
          <button class="btn secondary" id="btn-export-students">📊 ${esc(t('common.exportExcel'))}</button>
        </div>
      </div>
      <div class="stats" id="students-stats"></div>

      <section class="card" id="student-form-card">
        <div class="card-head">
          <h2>${esc(t('students.formTitle'))}</h2>
          <span class="badge neutral" id="form-mode">${esc(t('students.modeCreate'))}</span>
        </div>
        <div class="card-body">
          ${formHTML()}
          <div class="btn-row" style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
            <button class="btn" id="btn-save">💾 ${esc(t('common.save'))}</button>
            <button class="btn secondary" id="btn-new">➕ ${esc(t('students.newStudent'))}</button>
            <button class="btn secondary" id="btn-edit">✏️ ${esc(t('common.edit'))}</button>
            <button class="btn secondary" id="btn-search">🔍 ${esc(t('common.search'))}</button>
            <button class="btn secondary" id="btn-attach">📎 ${esc(t('students.uploadAttachment'))}</button>
            <button class="btn secondary" id="btn-preview">🖨️ ${esc(t('common.preview'))} / ${esc(t('common.print'))}</button>
            <button class="btn danger" id="btn-delete">🗑️ ${esc(t('common.delete'))}</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3>${esc(t('students.table'))}</h3>
          <span class="muted small">${esc(t('students.searchBy'))}</span>
        </div>
        <div class="card-body" style="padding-bottom:6px">
          <div class="toolbar">
            <div class="field grow">
              <label for="students-search">${esc(t('common.search'))}</label>
              <input id="students-search" type="search" placeholder="${esc(t('common.searchPlaceholder'))}" value="${esc(state.query.q)}">
            </div>
            <div class="field"><label for="filter-year">${esc(t('ledger.year'))}</label><select id="filter-year"></select></div>
            <div class="field"><label for="filter-month">${esc(t('common.month'))}</label><select id="filter-month"></select></div>
            <div class="field"><label for="filter-status">${esc(t('students.feeState'))}</label>
              <select id="filter-status">
                <option value="all">${esc(t('common.all'))}</option>
                <option value="paid">${esc(t('common.paid'))}</option>
                <option value="unpaid">${esc(t('common.unpaid'))}</option>
              </select>
            </div>
            <div class="field"><label for="filter-life">${esc(t('common.status'))}</label>
              <select id="filter-life">
                <option value="active">${esc(t('common.active'))}</option>
                <option value="archived">${esc(t('common.archived'))}</option>
                <option value="all">${esc(t('common.all'))}</option>
              </select>
            </div>
            <div class="field"><label for="filter-size">${esc(t('common.perPage'))}</label>
              <select id="filter-size">
                ${[10, 25, 50, 100].map((n) => `<option value="${n}">${n}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div id="students-table-host">${ui.loadingState()}</div>
      </section>`;

    const form = root.querySelector('#student-form');
    ['#birthDate', '#enrollDate'].forEach((sel) => form.querySelector(sel).addEventListener('input', updateAgeHints));
    form.querySelector('#payAmount').addEventListener('input', updateFeeHint);
    form.querySelector('#monthlyFee').addEventListener('input', updateFeeHint);
    form.querySelector('#feeMonth').addEventListener('change', (e) => {
      state.formMonth = e.target.value;
      const student = state.current;
      const stored = student && student.payments ? Number(student.payments[state.formMonth] || 0) : 0;
      form.querySelector('#payAmount').value = stored > 0 ? String(stored) : '0';
      updateFeeHint();
    });
    form.querySelector('#fullName').addEventListener('blur', (e) => {
      const error = ui.validators.letters(e.target.value);
      setFieldError(e.target, error);
    });
    form.querySelector('#guardianPhone').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^\d٠-٩]/g, '');
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); saveStudent(); });

    // photo upload
    const photoInput = form.querySelector('#photo-input');
    form.querySelector('#photo-btn').addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) { toastError(getLang() === 'en' ? 'Image must be under 6 MB' : 'حجم الصورة يجب أن يكون أقل من 6 ميجابايت'); return; }
      if (state.current && state.current.id) {
        try {
          await api.upload(`/students/${state.current.id}/photo`, file);
          toastSuccess(t('students.photoUploaded'));
          const fresh = await api.get(`/students/${state.current.id}?year=${state.query.year}`);
          fillForm(fresh);
          load({ silent: true });
        } catch (err) { toastError(err.message); }
      } else {
        state.pendingPhotoFile = file;
        setPhotoPreview(URL.createObjectURL(file), file.name);
      }
    });
    form.querySelector('#photo-remove').addEventListener('click', async () => {
      if (state.current && state.current.id) {
        try {
          await api.del(`/students/${state.current.id}/photo`);
          const fresh = await api.get(`/students/${state.current.id}?year=${state.query.year}`);
          fillForm(fresh);
          load({ silent: true });
        } catch (err) { toastError(err.message); }
      } else {
        state.pendingPhotoFile = null;
        setPhotoPreview(null);
      }
    });

    // filters
    const yearSelect = root.querySelector('#filter-year');
    const thisYear = Number(state.today.slice(0, 4));
    yearSelect.innerHTML = Array.from({ length: 8 }, (_, i) => thisYear - i)
      .map((y) => `<option value="${y}">${y}</option>`).join('');
    const monthSelect = root.querySelector('#filter-month');
    monthSelect.innerHTML = monthsOfYear(state.query.year)
      .map((p) => `<option value="${p}">${esc(ui.monthLabel(p))}</option>`).join('');

    const applyFilters = () => {
      state.query.page = 1;
      load();
    };
    root.querySelector('#students-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.query.q = e.target.value.trim();
        applyFilters();
      }
    });
    root.querySelector('#filter-year').addEventListener('change', (e) => {
      state.query.year = Number(e.target.value);
      state.query.month = `${state.query.year}-${state.query.month.slice(5, 7)}`;
      monthSelect.innerHTML = monthsOfYear(state.query.year).map((p) => `<option value="${p}">${esc(ui.monthLabel(p))}</option>`).join('');
      monthSelect.value = state.query.month;
      applyFilters();
    });
    monthSelect.addEventListener('change', (e) => { state.query.month = e.target.value; applyFilters(); });
    root.querySelector('#filter-status').addEventListener('change', (e) => { state.query.status = e.target.value; applyFilters(); });
    root.querySelector('#filter-life').addEventListener('change', (e) => { state.query.lifeStatus = e.target.value; applyFilters(); });
    root.querySelector('#filter-size').addEventListener('change', (e) => { state.query.pageSize = Number(e.target.value); applyFilters(); });

    // action buttons
    root.querySelector('#btn-save').addEventListener('click', saveStudent);
    root.querySelector('#btn-new').addEventListener('click', () => {
      fillForm(null);
      form.querySelector('#fullName').focus();
    });
    root.querySelector('#btn-edit').addEventListener('click', async () => {
      if (!state.current || !state.current.id) {
        toast(getLang() === 'en' ? 'Pick a student from the table to edit' : 'اختر طالبًا من الجدول أولًا للتعديل');
        return;
      }
      const fresh = await api.get(`/students/${state.current.id}?year=${state.query.year}`).catch(() => state.current);
      fillForm(fresh);
      form.querySelector('#fullName').focus();
    });
    root.querySelector('#btn-search').addEventListener('click', () => {
      const input = root.querySelector('#students-search');
      state.query.q = input.value.trim();
      state.query.page = 1;
      load();
      input.focus();
    });
    root.querySelector('#btn-attach').addEventListener('click', () => {
      if (!state.current || !state.current.id) { toastError(t('students.saveFirst')); return; }
      openAttachmentsModal(state.current.id);
    });
    root.querySelector('#btn-preview').addEventListener('click', () => {
      if (state.current && state.current.id) printStudent(state.current.id);
      else printAll();
    });
    root.querySelector('#btn-delete').addEventListener('click', () => {
      if (!state.current || !state.current.id) { toastError(getLang() === 'en' ? 'Pick a student first' : 'اختر طالبًا أولًا'); return; }
      deleteStudent(state.current);
    });
    root.querySelector('#btn-print-all').addEventListener('click', printAll);
    root.querySelector('#btn-export-students').addEventListener('click', async () => {
      try {
        await api.download(`/exports/students.xlsx${toQuery({ year: state.query.year, q: state.query.q })}`, 'students.xlsx');
        toastSuccess(t('common.exportExcel'));
      } catch (err) { toastError(err.message); }
    });

    fillForm(null);
    await load();

    const deepLinkStudent = state.query.highlight;
    if (deepLinkStudent) {
      const student = state.data && state.data.items.find((s) => s.id === deepLinkStudent);
      if (student) fillForm(student);
    }

    return {
      destroy() { state.data = null; },
    };
  },
};
