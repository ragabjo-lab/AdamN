'use strict';
const express = require('express');
const auth = require('../lib/auth');
const excel = require('../lib/excel');
const time = require('../lib/time');
const { getSettings } = require('../services/settings');
const studentsService = require('../services/students');
const staffService = require('../services/staff');
const ledger = require('../services/ledger');
const finance = require('../services/finance');
const { idField } = require('../lib/validate');

const router = express.Router();
const requireExport = auth.requirePerm('exports.run');

function sendWorkbook(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'no-store');
  wb.xlsx.write(res).then(() => res.end());
}

const MONTHS_SHORT = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/* students list (with the full-year payment matrix) */
router.get('/students.xlsx', requireExport, async (req, res) => {
  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const year = Number(req.query.year) || Number(today.slice(0, 4));
  const data = studentsService.list({ ...req.query, pageSize: 200, page: 1 });
  const all = req.query.pageSize === 'all' ? studentsService.forPrint(year).items : data.items;
  const months = time.monthsOfYear(year);
  const columns = [
    { header: '#', key: 'idx', width: 6, align: 'center' },
    { header: 'الكود', key: 'code', width: 12 },
    { header: 'اسم الطالب', key: 'fullName', width: 28, align: 'right' },
    { header: 'تاريخ الميلاد', key: 'birthDateDisplay', width: 14 },
    { header: 'العمر', key: 'ageLabel', width: 22, value: (r) => r.age.label },
    { header: 'هاتف ولي الأمر', key: 'guardianPhone', width: 16 },
    { header: 'تاريخ الالتحاق', key: 'enrollDateDisplay', width: 14 },
    { header: 'مدة الالتحاق', key: 'durationLabel', width: 26, value: (r) => r.duration.label },
    { header: 'الاشتراك الشهري', key: 'monthlyFee', width: 14, money: true },
    ...months.map((m) => ({
      header: `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]} ${year}`,
      key: m,
      width: 12,
      value: (r) => (Number((r.payments || {})[m] || 0) > 0 ? `مدفوع ${r.payments[m]}` : 'لم يدفع'),
    })),
  ];
  const wb = excel.createWorkbook();
  excel.addSheet(wb, {
    name: 'الطلاب',
    title: `جدول الطلاب — ${settings.nursery_name}`,
    subtitle: excel.subtitleFor(settings, `سنة ${year} • ${all.length} طالب`),
    columns,
    rows: all.map((r, i) => ({ ...r, idx: i + 1 })),
    notes: 'تحديث التواريخ يتم تلقائيًا حسب المنطقة الزمنية: ' + settings.timezone,
  });
  await sendWorkbook(res, wb, `AdamN-Students-${year}-${excel.stamp()}.xlsx`);
});

/* single student report */
router.get('/student/:id.xlsx', requireExport, async (req, res) => {
  const settings = getSettings();
  const id = idField(req.params.id);
  const s = studentsService.getById(id, { year: req.query.year });
  const wb = excel.createWorkbook();
  excel.addSheet(wb, {
    name: 'بطاقة الطالب',
    title: `بطاقة الطالب — ${s.fullName}`,
    subtitle: excel.subtitleFor(settings, `كود ${s.code || '—'}`),
    columns: [
      { header: 'البيان', key: 'k', width: 26, align: 'right' },
      { header: 'القيمة', key: 'v', width: 40, align: 'right' },
    ],
    rows: [
      { k: 'اسم الطالب', v: s.fullName },
      { k: 'الكود', v: s.code },
      { k: 'تاريخ الميلاد', v: s.birthDateDisplay },
      { k: 'العمر', v: s.age.label },
      { k: 'تاريخ الالتحاق', v: s.enrollDateDisplay },
      { k: 'مدة الالتحاق', v: s.duration.label },
      { k: 'هاتف ولي الأمر', v: s.guardianPhone },
      { k: 'ولي الأمر', v: s.guardianName || '' },
      { k: 'الاشتراك الشهري', v: s.monthlyFee },
      { k: 'الحالة', v: s.status === 'active' ? 'نشط' : 'مؤرشف' },
      { k: 'ملاحظات', v: s.notes || '' },
    ],
  });
  excel.addSheet(wb, {
    name: 'الاشتراكات',
    title: `اشتراكات سنة ${s.year}`,
    subtitle: excel.subtitleFor(settings, s.fullName),
    columns: [
      { header: 'الشهر', key: 'month', width: 18 },
      { header: 'الحالة', key: 'status', width: 16 },
      { header: 'المبلغ', key: 'amount', width: 16, money: true },
      { header: 'تاريخ السداد', key: 'paidAt', width: 22 },
    ],
    rows: time.monthsOfYear(s.year).map((p) => ({
      month: `${MONTHS_SHORT[Number(p.slice(5, 7)) - 1]} ${s.year}`,
      status: Number(s.payments[p] || 0) > 0 ? 'مدفوع' : 'لم يدفع',
      amount: Number(s.payments[p] || 0),
      paidAt: (s.paymentHistory.find((h) => h.period === p) || {}).paidAt
        ? time.formatTimestampUTC(s.paymentHistory.find((h) => h.period === p).paidAt, settings.timezone, 'ar') : '',
    })),
    totals: { amount: Object.values(s.payments).reduce((a, b) => a + Number(b || 0), 0) },
  });
  await sendWorkbook(res, wb, `AdamN-Student-${s.code || s.id}-${excel.stamp()}.xlsx`);
});

/* staff */
router.get('/staff.xlsx', requireExport, async (req, res) => {
  const settings = getSettings();
  const data = staffService.list({ pageSize: 200, page: 1, status: req.query.status || 'all' });
  const items = data.pagination.total > 200
    ? staffService.list({ pageSize: 200, page: 1, status: 'all' }).items
    : data.items;
  const wb = excel.createWorkbook();
  excel.addSheet(wb, {
    name: 'الموظفون',
    title: `بيانات الموظفين — ${settings.nursery_name}`,
    subtitle: excel.subtitleFor(settings, `${items.length} موظف`),
    columns: [
      { header: '#', key: 'idx', width: 6 },
      { header: 'الكود', key: 'code', width: 12 },
      { header: 'الاسم', key: 'fullName', width: 26, align: 'right' },
      { header: 'رقم الهاتف', key: 'phone', width: 16 },
      { header: 'الدور', key: 'role', width: 18 },
      { header: 'تاريخ التوظيف', key: 'hireDateDisplay', width: 14 },
      { header: 'مدة الخدمة', key: 'durationLabel', width: 24, value: (r) => r.duration.label },
      { header: 'الراتب الأساسي', key: 'baseSalary', width: 16, money: true },
      { header: 'الحالة', key: 'activeLabel', width: 12, value: (r) => (r.isActive ? 'نشط' : 'موقوف') },
      { header: 'ملاحظات', key: 'notes', width: 30, wrap: true },
    ],
    rows: items.map((r, i) => ({ ...r, idx: i + 1 })),
    totals: { baseSalary: items.reduce((a, b) => a + b.baseSalary, 0) },
  });
  await sendWorkbook(res, wb, `AdamN-Staff-${excel.stamp()}.xlsx`);
});

/* payroll */
router.get('/payroll.xlsx', requireExport, async (req, res) => {
  const settings = getSettings();
  const period = req.query.period || time.monthKey(settings.timezone);
  const data = staffService.payroll(period);
  const wb = excel.createWorkbook();
  excel.addSheet(wb, {
    name: 'الرواتب',
    title: `مسير رواتب ${time.periodLabel(period, 'ar')}`,
    subtitle: excel.subtitleFor(settings, `${data.items.length} موظف`),
    columns: [
      { header: 'الاسم', key: 'staffName', width: 26, align: 'right' },
      { header: 'الدور', key: 'role', width: 18 },
      { header: 'الراتب الأساسي', key: 'basic', width: 16, money: true },
      { header: 'الحوافز', key: 'bonuses', width: 14, money: true },
      { header: 'المكافآت', key: 'rewards', width: 14, money: true },
      { header: 'الخصومات', key: 'deductions', width: 14, money: true },
      { header: 'الصافي', key: 'net', width: 16, money: true },
      { header: 'الحالة', key: 'statusLabel', width: 12, value: (r) => (r.status === 'paid' ? 'مدفوع' : 'معلق') },
    ],
    rows: data.items,
    totals: data.totals,
  });
  await sendWorkbook(res, wb, `AdamN-Payroll-${period}-${excel.stamp()}.xlsx`);
});

/* ledgers */
function ledgerExport(kind, label, fileStem) {
  return async (req, res) => {
    const settings = getSettings();
    const data = ledger.list(kind, { ...req.query, pageSize: 200, page: 1 });
    const wb = excel.createWorkbook();
    excel.addSheet(wb, {
      name: label,
      title: `${label} — ${settings.nursery_name}`,
      subtitle: excel.subtitleFor(settings, `${data.items.length} سجل`),
      columns: [
        { header: '#', key: 'idx', width: 6 },
        { header: 'التاريخ', key: 'dateDisplay', width: 14 },
        { header: 'البيان', key: 'description', width: 36, align: 'right' },
        { header: 'التصنيف', key: 'category', width: 18 },
        { header: 'المبلغ', key: 'amount', width: 16, money: true },
        { header: 'ملاحظات', key: 'notes', width: 32, wrap: true },
      ],
      rows: data.items.map((r, i) => ({ ...r, idx: i + 1 })),
      totals: { amount: data.items.reduce((a, b) => a + b.amount, 0) },
    });
    await sendWorkbook(res, wb, `AdamN-${fileStem}-${excel.stamp()}.xlsx`);
  };
}

router.get('/revenue.xlsx', requireExport, ledgerExport('revenue', 'الإيرادات الأخرى', 'Revenue'));
router.get('/expenses.xlsx', requireExport, ledgerExport('expense', 'المصروفات', 'Expenses'));

/* finance (full year P&L) */
router.get('/finance.xlsx', requireExport, async (req, res) => {
  const settings = getSettings();
  const data = finance.yearOverview(req.query.year);
  const wb = excel.createWorkbook();
  excel.addSheet(wb, {
    name: 'الحسابات',
    title: `التقرير المالي لسنة ${data.year}`,
    subtitle: excel.subtitleFor(settings, `الإيرادات مقابل المصروفات`),
    columns: [
      { header: 'الشهر', key: 'label', width: 18 },
      { header: 'اشتراكات الطلاب', key: 'tuition', width: 18, money: true },
      { header: 'إيرادات أخرى', key: 'otherRevenue', width: 16, money: true },
      { header: 'إجمالي الإيرادات', key: 'revenueTotal', width: 18, money: true },
      { header: 'رواتب الموظفين', key: 'salaries', width: 18, money: true },
      { header: 'مصروفات أخرى', key: 'otherExpenses', width: 16, money: true },
      { header: 'إجمالي المصروفات', key: 'expensesTotal', width: 18, money: true },
      { header: 'صافي الربح/الخسارة', key: 'net', width: 20, money: true },
      { header: 'هامش %', key: 'margin', width: 12 },
    ],
    rows: data.months,
    totals: {
      label: 'الإجمالي', tuition: data.totals.tuition, otherRevenue: data.totals.otherRevenue,
      revenueTotal: data.totals.revenueTotal, salaries: data.totals.salaries,
      otherExpenses: data.totals.otherExpenses, expensesTotal: data.totals.expensesTotal, net: data.totals.net,
    },
  });
  await sendWorkbook(res, wb, `AdamN-Finance-${data.year}-${excel.stamp()}.xlsx`);
});

/* salary history (snapshot audit trail) */
router.get('/salary-history.xlsx', requireExport, async (req, res) => {
  const settings = getSettings();
  const rows = staffService.salaryHistory(req.query);
  const wb = excel.createWorkbook();
  excel.addSheet(wb, {
    name: 'سجل الرواتب',
    title: `سجل الرواتب التاريخي — ${settings.nursery_name}`,
    subtitle: excel.subtitleFor(settings, `${rows.length} سجل`),
    columns: [
      { header: 'الشهر', key: 'label', width: 18 },
      { header: 'الموظف', key: 'staffName', width: 26, align: 'right' },
      { header: 'الأساسي', key: 'basic', width: 14, money: true },
      { header: 'الحوافز', key: 'bonuses', width: 14, money: true },
      { header: 'المكافآت', key: 'rewards', width: 14, money: true },
      { header: 'الخصومات', key: 'deductions', width: 14, money: true },
      { header: 'الصافي', key: 'net', width: 16, money: true },
      { header: 'الحالة', key: 'statusLabel', width: 12, value: (r) => (r.status === 'paid' ? 'مدفوع' : 'معلق') },
    ],
    rows,
    totals: { net: rows.reduce((a, b) => a + b.net, 0) },
  });
  await sendWorkbook(res, wb, `AdamN-SalaryHistory-${excel.stamp()}.xlsx`);
});

module.exports = router;
