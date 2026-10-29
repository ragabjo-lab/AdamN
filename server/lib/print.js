'use strict';
/**
 * Server-side printable documents (Arabic-safe PDF path).
 * Arabic shaping + bidi are guaranteed by the browser's own text engine, so every
 * "Export PDF" button opens one of these documents and lets the user save it as PDF
 * through the system print dialog. Excel exports are real .xlsx files (see lib/excel.js).
 */
const time = require('./time');

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const money = (n) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function layout({ title, subtitle, body, settings, autoPrint, landscape }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @font-face { font-family: 'Tajawal'; src: url('/assets/fonts/tajawal-ar-400.woff2') format('woff2'); font-weight: 400; font-display: swap; }
  @font-face { font-family: 'Tajawal'; src: url('/assets/fonts/tajawal-ar-700.woff2') format('woff2'); font-weight: 700; font-display: swap; }
  @font-face { font-family: 'Tajawal'; src: url('/assets/fonts/tajawal-ar-800.woff2') format('woff2'); font-weight: 800; font-display: swap; }
  * { box-sizing: border-box; }
  body { font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; margin: 0; color: #0f172a; background: #fff; font-size: 13px; }
  .sheet { padding: 18px 22px; max-width: 1200px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 14px; gap: 16px; }
  .brand h1 { margin: 0; font-size: 22px; color: #1d4ed8; }
  .brand p { margin: 3px 0 0; font-size: 12px; color: #475569; }
  .meta { text-align: left; font-size: 11px; color: #475569; line-height: 1.7; }
  h2.doc-title { font-size: 17px; margin: 0 0 4px; }
  .doc-sub { color: #475569; font-size: 12px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; font-size: 12px; }
  th { background: #1d4ed8; color: #fff; font-weight: 700; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  td.name { text-align: right; font-weight: 600; }
  .paid { color: #15803d; font-weight: 700; }
  .unpaid { color: #b91c1c; font-weight: 700; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .badge.paid { background: #dcfce7; color: #15803d; }
  .badge.unpaid { background: #fee2e2; color: #b91c1c; }
  .totals { background: #eff6ff; font-weight: 700; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .card { flex: 1 1 160px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; }
  .card .k { font-size: 11px; color: #475569; }
  .card .v { font-size: 17px; font-weight: 800; margin-top: 4px; }
  .student-head { display: flex; gap: 16px; align-items: flex-start; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; margin-bottom: 14px; }
  .student-photo { width: 130px; height: 160px; border: 2px solid #1d4ed8; border-radius: 8px; overflow: hidden; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #94a3b8; font-size: 12px; }
  .student-photo img { width: 100%; height: 100%; object-fit: cover; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(160px, 1fr)); gap: 6px 18px; flex: 1; }
  .field { border-bottom: 1px dotted #cbd5e1; padding: 3px 0; font-size: 12.5px; }
  .field b { color: #334155; }
  .sign { margin-top: 26px; display: flex; justify-content: space-between; font-size: 12px; }
  .sign div { width: 30%; border-top: 1px solid #94a3b8; padding-top: 5px; text-align: center; }
  .months-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .month-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; text-align: center; }
  .month-box .m { font-weight: 700; margin-bottom: 3px; }
  .toolbar { position: sticky; top: 0; background: #f1f5f9; padding: 8px; display: flex; gap: 8px; justify-content: flex-end; border-bottom: 1px solid #cbd5e1; z-index: 5; }
  .toolbar button { font-family: inherit; font-size: 13px; padding: 7px 14px; border-radius: 6px; border: 1px solid #1d4ed8; background: #1d4ed8; color: #fff; cursor: pointer; }
  .toolbar button.ghost { background: #fff; color: #1d4ed8; }
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
  @media print { .toolbar { display: none !important; } .sheet { padding: 0; } body { font-size: 12px; } header { margin-bottom: 10px; } }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
  <button class="ghost" onclick="window.close()">إغلاق</button>
</div>
<div class="sheet">
  <header>
    <div class="brand">
      <h1>${esc(settings.nursery_name || 'AdamN NMS')}</h1>
      <p>${esc(settings.nursery_phone || '')}${settings.nursery_phone && settings.nursery_address ? ' • ' : ''}${esc(settings.nursery_address || '')}</p>
    </div>
    <div class="meta">
      <div>${esc(title)}</div>
      <div>تاريخ الطباعة: ${esc(time.formatDdMmYyyy(time.todayISO(settings.timezone)))}</div>
      <div>المنطقة الزمنية: ${esc(settings.timezone)}</div>
    </div>
  </header>
  ${subtitle ? `<div class="doc-sub">${esc(subtitle)}</div>` : ''}
  ${body}
</div>
${autoPrint ? '<script>window.addEventListener("load", function(){ setTimeout(function(){ window.print(); }, 350); });</script>' : ''}
</body></html>`;
}

function studentCard(student, settings, year) {
  const months = time.monthsOfYear(year).map((p) => {
    const amount = Number(student.payments[p] || 0);
    const isPaid = amount > 0;
    return `<div class="month-box">
      <div class="m">${MONTHS_AR[Number(p.slice(5, 7)) - 1]} ${year}</div>
      <div class="${isPaid ? 'paid' : 'unpaid'}">${isPaid ? 'مدفوع' : 'لم يدفع'}</div>
      ${isPaid ? `<div style="font-size:11px;color:#475569">${money(amount)} ${esc(settings.currency_symbol)}</div>` : ''}
    </div>`;
  }).join('');
  return `
  <div class="student-head">
    <div class="student-photo">${student.photoUrl ? `<img src="${esc(student.photoUrl)}" alt="">` : 'لا توجد صورة'}</div>
    <div class="grid">
      <div class="field"><b>اسم الطالب:</b> ${esc(student.fullName)}</div>
      <div class="field"><b>الكود:</b> ${esc(student.code || '—')}</div>
      <div class="field"><b>تاريخ الميلاد:</b> ${esc(student.birthDateDisplay)}</div>
      <div class="field"><b>العمر:</b> ${esc(student.age.label)}</div>
      <div class="field"><b>تاريخ الالتحاق:</b> ${esc(student.enrollDateDisplay)}</div>
      <div class="field"><b>مدة الالتحاق:</b> ${esc(student.duration.label)}</div>
      <div class="field"><b>هاتف ولي الأمر:</b> ${esc(student.guardianPhone || '—')}</div>
      <div class="field"><b>ولي الأمر:</b> ${esc(student.guardianName || '—')}</div>
      <div class="field"><b>الاشتراك الشهري:</b> ${money(student.monthlyFee)} ${esc(settings.currency_symbol)}</div>
      <div class="field"><b>الحالة:</b> ${student.status === 'active' ? 'نشط' : 'مؤرشف'}</div>
    </div>
  </div>
  <h2 class="doc-title">حالة الاشتراك لسنة ${year}</h2>
  <div class="months-grid" style="margin-bottom:14px">${months}</div>
  ${
    student.attachments && student.attachments.length
      ? `<h2 class="doc-title">المرفقات</h2><table><thead><tr><th>الملف</th><th>تاريخ الرفع</th><th>الحجم</th></tr></thead><tbody>${
        student.attachments.map((a) => `<tr><td class="name">${esc(a.fileName)}</td><td>${esc(time.formatTimestampUTC(a.createdAt, settings.timezone, 'ar'))}</td><td>${Math.round(a.size / 1024)} KB</td></tr>`).join('')
      }</tbody></table>`
      : ''
  }
  ${student.notes ? `<div class="field"><b>ملاحظات:</b> ${esc(student.notes)}</div>` : ''}
  <div class="sign"><div>ولي الأمر</div><div>المشرف</div><div>الإدارة</div></div>`;
}

function studentsTable(items, settings, year, { withPhones = true } = {}) {
  const months = time.monthsOfYear(year);
  const head = `<tr><th>#</th><th>اسم الطالب</th><th>العمر</th>${withPhones ? '<th>هاتف ولي الأمر</th>' : ''}<th>تاريخ الالتحاق</th><th>مدة الالتحاق</th>${months.map((m) => `<th>${MONTHS_AR[Number(m.slice(5, 7)) - 1]}</th>`).join('')}</tr>`;
  const body = items.map((s, i) => `<tr>
    <td>${i + 1}</td>
    <td class="name">${esc(s.fullName)}</td>
    <td>${esc(s.age.label)}</td>
    ${withPhones ? `<td>${esc(s.guardianPhone || '—')}</td>` : ''}
    <td>${esc(s.enrollDateDisplay)}</td>
    <td>${esc(s.duration.label)}</td>
    ${months.map((m) => {
      const paid = Number(s.payments[m] || 0) > 0;
      return `<td class="${paid ? 'paid' : 'unpaid'}">${paid ? 'مدفوع' : 'لم يدفع'}</td>`;
    }).join('')}
  </tr>`).join('');
  return `<table><thead>${head}</thead><tbody>${body || `<tr><td colspan="${6 + months.length}">لا توجد بيانات</td></tr>`}</tbody></table>`;
}

function moneyTable(rows, columns, settings, totals) {
  const head = `<tr>${columns.map((c) => `<th>${esc(c.header)}</th>`).join('')}</tr>`;
  const body = rows.map((r, i) => `<tr>${columns.map((c) => {
    const value = c.value ? c.value(r, i) : r[c.key];
    return `<td class="${c.money ? 'amount' : ''} ${c.align === 'right' ? 'name' : ''}">${c.money ? money(value) : esc(value)}</td>`;
  }).join('')}</tr>`).join('');
  const foot = totals
    ? `<tr class="totals">${columns.map((c, idx) => `<td>${idx === 0 ? 'الإجمالي' : (totals[c.key] !== undefined ? (c.money ? money(totals[c.key]) : esc(totals[c.key])) : '')}</td>`).join('')}</tr>`
    : '';
  return `<table><thead>${head}</thead><tbody>${body || `<tr><td colspan="${columns.length}">لا توجد بيانات</td></tr>`}${foot}</tbody></table>`;
}

function cards(list) {
  return `<div class="cards">${list.map((c) => `<div class="card"><div class="k">${esc(c.label)}</div><div class="v" style="color:${c.color || '#0f172a'}">${esc(c.value)}</div></div>`).join('')}</div>`;
}

module.exports = { layout, esc, money, studentCard, studentsTable, moneyTable, cards, MONTHS_AR };
