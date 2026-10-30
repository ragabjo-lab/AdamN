'use strict';
/**
 * Printable reports (open in a new tab, "Export PDF" = the browser's print dialog).
 * Arabic is rendered by the browser text engine, so shaping/RTL is always correct.
 */
const express = require('express');
const auth = require('../lib/auth');
const P = require('../lib/print');
const time = require('../lib/time');
const { getSettings } = require('../services/settings');
const studentsService = require('../services/students');
const staffService = require('../services/staff');
const ledger = require('../services/ledger');
const finance = require('../services/finance');
const { idField } = require('../lib/validate');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.user) return res.redirect(`/?next=${encodeURIComponent(req.originalUrl)}`);
  return next();
});

const settings = () => getSettings();
const money = (n) => P.money(n);

router.get('/students', (req, res) => {
  const s = settings();
  const year = Number(req.query.year) || Number(time.todayISO(s.timezone).slice(0, 4));
  const data = studentsService.forPrint(year);
  let items = data.items;
  const status = req.query.status;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') ? req.query.month : time.monthKey(s.timezone);
  if (status === 'paid') items = items.filter((x) => Number(x.payments[month] || 0) > 0);
  if (status === 'unpaid') items = items.filter((x) => !(Number(x.payments[month] || 0) > 0));
  const body = `
    ${P.studentsTable(items, s, year)}
    <div class="doc-sub">عدد الطلاب: ${items.length} • ${status === 'paid' ? `المدفوعون لشهر ${P.esc(time.periodLabel(month, 'ar'))}` : status === 'unpaid' ? `غير المدفوعين لشهر ${P.esc(time.periodLabel(month, 'ar'))}` : 'جميع الطلاب النشطين'}</div>
    <div class="sign"><div>المشرف</div><div>الإدارة</div></div>`;
  res.type('html').send(P.layout({
    title: `جدول الطلاب ${year}`,
    subtitle: `حالة الاشتراك لكل شهر من شهور سنة ${year}`,
    body, settings: s, autoPrint: req.query.auto === '1', landscape: true,
  }));
});

router.get('/student/:id', (req, res) => {
  const s = settings();
  const id = idField(req.params.id);
  const year = Number(req.query.year) || Number(time.todayISO(s.timezone).slice(0, 4));
  const student = studentsService.getById(id, { year });
  res.type('html').send(P.layout({
    title: `بطاقة الطالب — ${student.fullName}`,
    subtitle: `بيانات الطالب وحالة الاشتراك لسنة ${year}`,
    body: P.studentCard(student, s, year),
    settings: s,
    autoPrint: req.query.auto === '1',
  }));
});

router.get('/staff', (req, res) => {
  const s = settings();
  const data = staffService.list({ pageSize: 200, status: req.query.status || 'all' });
  const columns = [
    { header: '#', value: (r, i) => i + 1 },
    { header: 'الكود', key: 'code' },
    { header: 'الاسم', key: 'fullName', align: 'right' },
    { header: 'الهاتف', key: 'phone' },
    { header: 'الدور', key: 'role' },
    { header: 'تاريخ التوظيف', key: 'hireDateDisplay' },
    { header: 'مدة الخدمة', value: (r) => r.duration.label },
    { header: 'الراتب الأساسي', key: 'baseSalary', money: true },
    { header: 'الحالة', value: (r) => (r.isActive ? 'نشط' : 'موقوف') },
  ];
  res.type('html').send(P.layout({
    title: 'بيانات الموظفين',
    subtitle: `عدد الموظفين: ${data.items.length}`,
    body: P.moneyTable(data.items, columns, s, { baseSalary: data.items.reduce((a, b) => a + b.baseSalary, 0) }),
    settings: s,
    autoPrint: req.query.auto === '1',
    landscape: true,
  }));
});

router.get('/payroll', (req, res) => {
  const s = settings();
  const period = req.query.period || time.monthKey(s.timezone);
  const data = staffService.payroll(period);
  const columns = [
    { header: 'الاسم', key: 'staffName', align: 'right' },
    { header: 'الدور', key: 'role' },
    { header: 'الأساسي', key: 'basic', money: true },
    { header: 'الحوافز', key: 'bonuses', money: true },
    { header: 'المكافآت', key: 'rewards', money: true },
    { header: 'الخصومات', key: 'deductions', money: true },
    { header: 'الصافي', key: 'net', money: true },
    { header: 'الحالة', value: (r) => (r.status === 'paid' ? 'مدفوع' : 'معلق') },
  ];
  res.type('html').send(P.layout({
    title: `مسير رواتب ${time.periodLabel(period, 'ar')}`,
    subtitle: `${data.items.length} موظف • إجمالي الصافي ${money(data.totals.net)} ${s.currency_symbol}`,
    body: P.moneyTable(data.items, columns, s, data.totals),
    settings: s,
    autoPrint: req.query.auto === '1',
    landscape: true,
  }));
});

function ledgerPrint(kind, label) {
  return (req, res) => {
    const s = settings();
    const data = ledger.list(kind, { ...req.query, pageSize: 200, page: 1 });
    const columns = [
      { header: '#', value: (r, i) => i + 1 },
      { header: 'التاريخ', key: 'dateDisplay' },
      { header: 'البيان', key: 'description', align: 'right' },
      { header: 'التصنيف', key: 'category' },
      { header: 'المبلغ', key: 'amount', money: true },
      { header: 'ملاحظات', key: 'notes' },
    ];
    res.type('html').send(P.layout({
      title: label,
      subtitle: `${data.items.length} سجل • الإجمالي ${money(data.items.reduce((a, b) => a + b.amount, 0))} ${s.currency_symbol}`,
      body: P.moneyTable(data.items, columns, s, { amount: data.items.reduce((a, b) => a + b.amount, 0) }),
      settings: s,
      autoPrint: req.query.auto === '1',
      landscape: true,
    }));
  };
}

router.get('/revenue', ledgerPrint('revenue', 'الإيرادات الأخرى'));
router.get('/expenses', ledgerPrint('expense', 'المصروفات'));

router.get('/finance', (req, res) => {
  const s = settings();
  const yearData = finance.yearOverview(req.query.year);
  const period = req.query.period || time.monthKey(s.timezone);
  const detail = finance.detail(period);
  const columns = [
    { header: 'الشهر', key: 'label', align: 'right' },
    { header: 'اشتراكات الطلاب', key: 'tuition', money: true },
    { header: 'إيرادات أخرى', key: 'otherRevenue', money: true },
    { header: 'إجمالي الإيرادات', key: 'revenueTotal', money: true },
    { header: 'الرواتب', key: 'salaries', money: true },
    { header: 'مصروفات أخرى', key: 'otherExpenses', money: true },
    { header: 'إجمالي المصروفات', key: 'expensesTotal', money: true },
    { header: 'الصافي', key: 'net', money: true },
  ];
  const cards = P.cards([
    { label: 'إجمالي الإيرادات', value: `${money(yearData.totals.revenueTotal)} ${s.currency_symbol}`, color: '#15803d' },
    { label: 'إجمالي المصروفات', value: `${money(yearData.totals.expensesTotal)} ${s.currency_symbol}`, color: '#b91c1c' },
    { label: 'صافي الربح', value: `${money(yearData.totals.net)} ${s.currency_symbol}`, color: yearData.totals.net >= 0 ? '#15803d' : '#b91c1c' },
    { label: `طلاب نشطون`, value: String(yearData.activeStudents) },
  ]);
  const monthCards = P.cards([
    { label: `إيرادات ${detail.overview.label}`, value: `${money(detail.overview.revenue.total)} ${s.currency_symbol}` },
    { label: `مصروفات ${detail.overview.label}`, value: `${money(detail.overview.expenses.total)} ${s.currency_symbol}` },
    { label: 'الصافي', value: `${money(detail.overview.net)} ${s.currency_symbol}`, color: detail.overview.net >= 0 ? '#15803d' : '#b91c1c' },
  ]);
  const bills = P.moneyTable(
    [{ label: 'اشتراكات الطلاب', total: detail.overview.revenue.tuition }, ...detail.breakdown.revenue.slice(1).map((r) => ({ label: r.category, total: r.total }))],
    [{ header: 'الإيرادات', key: 'label', align: 'right' }, { header: 'المبلغ', key: 'total', money: true }], s,
    { total: detail.overview.revenue.total }
  );
  const bills2 = P.moneyTable(
    [{ label: 'رواتب الموظفين', total: detail.overview.expenses.salaries }, ...detail.breakdown.expenses.slice(1).map((r) => ({ label: r.category, total: r.total }))],
    [{ header: 'المصروفات', key: 'label', align: 'right' }, { header: 'المبلغ', key: 'total', money: true }], s,
    { total: detail.overview.expenses.total }
  );
  res.type('html').send(P.layout({
    title: `التقرير المالي ${yearData.year}`,
    subtitle: `صافي ربح/خسارة لكل شهر — تفاصيل ${time.periodLabel(period, 'ar')}`,
    body: `${cards}<h2 class="doc-title">ملخص السنة</h2>${P.moneyTable(yearData.months, columns, s, yearData.totals)}
      <h2 class="doc-title">تفاصيل ${P.esc(detail.overview.label)}</h2>${monthCards}
      <div style="display:flex;gap:14px;flex-wrap:wrap"><div style="flex:1 1 320px">${bills}</div><div style="flex:1 1 320px">${bills2}</div></div>`,
    settings: s,
    autoPrint: req.query.auto === '1',
    landscape: true,
  }));
});

module.exports = router;
