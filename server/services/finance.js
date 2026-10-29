'use strict';
const { store } = require('../db/connection');
const time = require('../lib/time');
const v = require('../lib/validate');
const { getSettings } = require('./settings');
const ledger = require('./ledger');

function sum(sql, params = []) {
  const row = store.get(sql, params);
  return row ? Number(row.s || 0) : 0;
}

/** One month of P&L, built only from historical records (never from current salary values). */
function monthOverview(period) {
  const bounds = time.periodBounds(period);
  if (!bounds) return null;
  const tuition = sum('SELECT COALESCE(SUM(amount),0) AS s FROM student_payments WHERE period = ? AND amount > 0', [period]);
  const otherRevenue = sum('SELECT COALESCE(SUM(amount),0) AS s FROM revenues WHERE date BETWEEN ? AND ?', [bounds.start, bounds.end]);
  const salaries = sum('SELECT COALESCE(SUM(net),0) AS s FROM staff_salaries WHERE period = ?', [period]);
  const expenses = sum('SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE date BETWEEN ? AND ?', [bounds.start, bounds.end]);
  const payrollPending = store.all(
    `SELECT st.id, st.full_name, st.base_salary FROM staff st
      WHERE st.hire_date <= ? AND st.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM staff_salaries ss WHERE ss.staff_id = st.id AND ss.period = ?)`,
    [bounds.end, period]
  );
  const pendingBasic = payrollPending.reduce((acc, r) => {
    const staffSvc = require('./staff');
    return acc + staffSvc.basicForPeriod(r.id, period, r.base_salary);
  }, 0);
  const revenue = tuition + otherRevenue;
  const expenseTotal = salaries + expenses;
  return {
    period,
    label: time.periodLabel(period, getSettings().locale),
    revenue: { tuition, other: otherRevenue, total: round(revenue) },
    expenses: { salaries, other: expenses, total: round(expenseTotal) },
    net: round(revenue - expenseTotal),
    margin: revenue > 0 ? round(((revenue - expenseTotal) / revenue) * 100) : 0,
    pendingPayroll: { count: payrollPending.length, estimatedBasic: round(pendingBasic) },
    paidStudents: store.get('SELECT COUNT(*) AS c FROM student_payments WHERE period = ? AND amount > 0', [period]).c,
  };
}

function round(n) { return Math.round(n * 100) / 100; }

function breakdown(period) {
  const bounds = time.periodBounds(period);
  const otherByCategory = store.all(
    'SELECT category, COALESCE(SUM(amount),0) AS s, COUNT(*) AS c FROM revenues WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY s DESC',
    [bounds.start, bounds.end]
  ).map((r) => ({ category: r.category, total: Number(r.s), count: r.c }));
  const tuition = sum('SELECT COALESCE(SUM(amount),0) AS s FROM student_payments WHERE period = ? AND amount > 0', [period]);
  const revenue = [
    { category: 'اشتراك شهري', total: round(tuition), count: store.get('SELECT COUNT(*) AS c FROM student_payments WHERE period = ? AND amount > 0', [period]).c },
    ...otherByCategory,
  ];
  const expenseByCategory = store.all(
    'SELECT category, COALESCE(SUM(amount),0) AS s, COUNT(*) AS c FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY s DESC',
    [bounds.start, bounds.end]
  ).map((r) => ({ category: r.category, total: Number(r.s), count: r.c }));
  const salaries = sum('SELECT COALESCE(SUM(net),0) AS s FROM staff_salaries WHERE period = ?', [period]);
  const salaryCount = store.get('SELECT COUNT(*) AS c FROM staff_salaries WHERE period = ?', [period]).c;
  const expenses = [{ category: 'رواتب الموظفين', total: round(salaries), count: salaryCount }, ...expenseByCategory];
  return { period, revenue, expenses };
}

function yearOverview(year) {
  const y = Number(year) || Number(time.todayISO(getSettings().timezone).slice(0, 4));
  const months = time.monthsOfYear(y).map((p) => {
    const m = monthOverview(p);
    return {
      period: p,
      label: m.label,
      tuition: m.revenue.tuition,
      otherRevenue: m.revenue.other,
      revenueTotal: m.revenue.total,
      salaries: m.expenses.salaries,
      otherExpenses: m.expenses.other,
      expensesTotal: m.expenses.total,
      net: m.net,
      margin: m.margin,
    };
  });
  const totals = months.reduce((acc, m) => ({
    tuition: acc.tuition + m.tuition,
    otherRevenue: acc.otherRevenue + m.otherRevenue,
    revenueTotal: acc.revenueTotal + m.revenueTotal,
    salaries: acc.salaries + m.salaries,
    otherExpenses: acc.otherExpenses + m.otherExpenses,
    expensesTotal: acc.expensesTotal + m.expensesTotal,
    net: acc.net + m.net,
  }), { tuition: 0, otherRevenue: 0, revenueTotal: 0, salaries: 0, otherExpenses: 0, expensesTotal: 0, net: 0 });
  const paidStudents = store.get(
    "SELECT COUNT(DISTINCT student_id) AS c FROM student_payments WHERE period LIKE ? AND amount > 0", [`${y}-%`]
  ).c;
  return {
    year: y,
    months,
    totals: {
      tuition: round(totals.tuition), otherRevenue: round(totals.otherRevenue), revenueTotal: round(totals.revenueTotal),
      salaries: round(totals.salaries), otherExpenses: round(totals.otherExpenses),
      expensesTotal: round(totals.expensesTotal), net: round(totals.net),
    },
    activeStudents: store.get("SELECT COUNT(*) AS c FROM students WHERE status = 'active'").c,
    paidStudents: paidStudents,
    activeStaff: store.get("SELECT COUNT(*) AS c FROM staff WHERE is_active = 1").c,
  };
}

function detail(period) {
  const p = v.periodField(period);
  const m = monthOverview(p);
  const b = breakdown(p);
  const revenues = ledger.forPeriod('revenue', p);
  const expenses = ledger.forPeriod('expense', p);
  const tuition = store.all(
    `SELECT sp.student_id, st.full_name, sp.amount, sp.paid_at, sp.method
       FROM student_payments sp JOIN students st ON st.id = sp.student_id
      WHERE sp.period = ? AND sp.amount > 0 ORDER BY st.full_name COLLATE NOCASE`,
    [p]
  ).map((r) => ({ studentId: r.student_id, studentName: r.full_name, amount: Number(r.amount), paidAt: r.paid_at, method: r.method }));
  const salaries = store.all(
    `SELECT ss.*, st.full_name, st.role FROM staff_salaries ss JOIN staff st ON st.id = ss.staff_id
      WHERE ss.period = ? ORDER BY st.full_name COLLATE NOCASE`, [p]
  ).map((r) => ({
    id: r.id, staffId: r.staff_id, staffName: r.full_name, role: r.role,
    basic: Number(r.basic), bonuses: Number(r.bonuses), rewards: Number(r.rewards),
    deductions: Number(r.deductions), net: Number(r.net), status: r.status,
  }));
  return { overview: m, breakdown: b, revenues, expenses, tuition, salaries };
}

module.exports = { monthOverview, yearOverview, breakdown, detail, round };
