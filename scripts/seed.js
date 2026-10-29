#!/usr/bin/env node
/**
 * Seeds a demonstration dataset into the connected HDANA data file.
 * Usage:  npm run seed            (skips if students already exist)
 *         npm run seed -- --force (clears students/staff/ledgers first)
 */
'use strict';
const { connectDataFile } = require('../server/db/discover');
const { store } = require('../server/db/connection');
const { ensureDefaults, getSettings, updateSettings } = require('../server/services/settings');
const auth = require('../server/lib/auth');
const students = require('../server/services/students');
const staffSvc = require('../server/services/staff');
const ledger = require('../server/services/ledger');
const maintenance = require('../server/services/maintenance');
const time = require('../server/lib/time');

const force = process.argv.includes('--force');

function pad(n) { return String(n).padStart(2, '0'); }
function dd(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; }

const STUDENTS = [
  ['يوسف أحمد محمود', '2021-03-14', '2024-09-01', '01001234567'],
  ['ملك محمد السيد', '2020-11-02', '2023-09-10', '01112345678'],
  ['عمر خالد إبراهيم', '2022-01-25', '2025-02-03', '01223456789'],
  ['سلمى حسن علي', '2021-07-09', '2024-10-15', '01034567890'],
  ['آدم مصطفى كامل', '2019-12-19', '2022-09-05', '01145678901'],
  ['نور الدين طارق', '2022-05-30', '2025-01-20', '01256789012'],
  ['حلا إيهاب فؤاد', '2021-02-11', '2024-08-25', '01067890123'],
  ['زياد سامي عبد الله', '2020-09-08', '2023-10-01', '01178901234'],
  ['ريم أشرف عبد الرحمن', '2022-08-16', '2025-03-02', '01289012345'],
  ['مروان عمرو سعد', '2021-10-04', '2024-11-11', '01090123456'],
  ['لينا وليد فتحي', '2019-06-21', '2022-10-03', '01101234567'],
  ['كريم هشام نبيل', '2022-03-27', '2025-04-07', '01212345678'],
];

const STAFF = [
  ['منى عبد الفتاح', '01001112223', 'مديرة الحضانة', '2019-09-01', 9500],
  ['هالة سمير حسن', '01112223334', 'مدرسة', '2021-02-15', 6200],
  ['إسلام رفعت علي', '01223334445', 'مشرف أتوبيس', '2022-08-20', 4800],
  ['فاطمة الزهراء يوسف', '01034445556', 'مساعد مدرسة', '2023-01-09', 4200],
  ['أميرة جمال الدين', '01145556667', 'طاهية', '2023-10-01', 3900],
];

const REVENUES = [
  ['2026-01-12', 'دخل نشاط الرسم الشهري', 850, 'أنشطة'],
  ['2026-02-05', 'بيع زي مدرسي', 1500, 'زي مدرسي'],
  ['2026-02-18', 'تبرع من أولياء الأمور', 1200, 'تبرعات'],
  ['2026-03-03', 'دخل رحلة الحديقة', 900, 'أنشطة'],
  ['2026-04-10', 'بيع مستلزمات دراسية', 640, 'مستلزمات'],
  ['2026-05-22', 'دخل حفل نهاية العام', 2400, 'أنشطة'],
  ['2026-07-14', 'معسكر صيفي', 3200, 'أنشطة'],
  ['2026-08-01', 'تصوير الطلاب', 750, 'أخرى'],
  ['2026-09-09', 'دخل أنشطة رياضية', 1100, 'أنشطة'],
  ['2026-10-02', 'بيع زي مدرسي', 1800, 'زي مدرسي'],
];

const EXPENSES = [
  ['2026-01-03', 'إيجار المبنى — يناير', 8000, 'إيجار'],
  ['2026-01-20', 'فاتورة كهرباء ومياه', 1250, 'كهرباء ومياه'],
  ['2026-02-03', 'إيجار المبنى — فبراير', 8000, 'إيجار'],
  ['2026-02-14', 'مستلزمات أنشطة وألعاب', 1650, 'أنشطة'],
  ['2026-03-03', 'إيجار المبنى — مارس', 8000, 'إيجار'],
  ['2026-03-11', 'صيانة أتوبيس', 2100, 'صيانة'],
  ['2026-04-03', 'إيجار المبنى — أبريل', 8000, 'إيجار'],
  ['2026-04-19', 'أدوات نظافة', 700, 'مستلزمات'],
  ['2026-05-03', 'إيجار المبنى — مايو', 8000, 'إيجار'],
  ['2026-06-03', 'إيجار المبنى — يونيو', 8000, 'إيجار'],
  ['2026-07-03', 'إيجار المبنى — يوليو', 8000, 'إيجار'],
  ['2026-08-03', 'إيجار المبنى — أغسطس', 8000, 'إيجار'],
  ['2026-08-21', 'تجديد أثاث', 5400, 'صيانة'],
  ['2026-09-03', 'إيجار المبنى — سبتمبر', 8000, 'إيجار'],
  ['2026-09-15', 'مواصلات ورحلات', 1300, 'مواصلات'],
  ['2026-10-03', 'إيجار المبنى — أكتوبر', 8000, 'إيجار'],
];

function main() {
  const connected = connectDataFile();
  ensureDefaults();
  console.log(`[seed] data file: ${connected.info.path}`);

  const existingStudents = store.get('SELECT COUNT(*) AS c FROM students').c;
  if (existingStudents > 0 && !force) {
    console.log(`[seed] ${existingStudents} students already exist — use "npm run seed -- --force" to reseed.`);
    return;
  }
  if (force) {
    store.transaction(() => {
      for (const t of ['student_payments', 'attachments', 'students', 'staff_salaries', 'staff_salary_rates', 'staff', 'revenues', 'expenses', 'notifications']) {
        store.run(`DELETE FROM ${t}`);
      }
      store.run("UPDATE students SET photo_id = NULL WHERE 0");
    });
    console.log('[seed] cleared previous demo data');
  }

  updateSettings({
    nursery_name: 'حضانة AdamN النموذجية',
    nursery_phone: '03-555-1234',
    nursery_address: 'الإسكندرية — مصر',
    timezone: process.env.SEED_TZ || 'Africa/Cairo',
    locale: 'ar',
    currency_code: 'EGP',
    currency_symbol: 'ج.م',
    default_subscription_fee: 1200,
    subscription_due_day: 5,
  });

  if (!store.get('SELECT COUNT(*) AS c FROM users').c) {
    auth.createUser({ username: 'admin', password: 'AdamN2026', fullName: 'مدير النظام', role: 'admin' });
    console.log('[seed] admin user created → username: admin • password: AdamN2026');
  }

  const settings = getSettings();
  const today = time.todayISO(settings.timezone);
  const year = Number(today.slice(0, 4));
  const currentPeriod = today.slice(0, 7);

  const createdStudents = STUDENTS.map(([name, birth, enroll, phone], idx) => students.create({
    fullName: name,
    birthDate: dd(birth),
    enrollDate: dd(enroll),
    guardianPhone: phone,
    guardianName: ['أحمد محمود', 'محمد السيد', 'خالد إبراهيم', 'حسن علي', 'مصطفى كامل', 'طارق عبد الله'][idx % 6],
    address: 'الإسكندرية، مصر',
    monthlyFee: 1200,
  }));
  console.log(`[seed] ${createdStudents.length} students created`);

  // payments: every month of the year up to the current one, with a few unpaid students
  for (const [idx, student] of createdStudents.entries()) {
    for (let m = 1; m <= Number(currentPeriod.slice(5, 7)); m += 1) {
      const period = `${year}-${pad(m)}`;
      const unpaidThisMonth = m === Number(currentPeriod.slice(5, 7)) && idx % 4 === 3;
      const skippedPast = idx % 7 === 5 && m % 3 === 0;
      if (unpaidThisMonth || skippedPast) continue;
      students.setPayment(student.id, period, { amount: 1200, method: 'نقدي' }, null);
    }
  }
  console.log('[seed] student payments recorded');

  const createdStaff = STAFF.map(([name, phone, role, hire, salary]) => staffSvc.create({
    fullName: name,
    phone,
    role,
    hireDate: dd(hire),
    baseSalary: salary,
  }));
  console.log(`[seed] ${createdStaff.length} staff members created`);

  const periods = [time.addMonthsToPeriod(currentPeriod, -2), time.addMonthsToPeriod(currentPeriod, -1), currentPeriod];
  for (const period of periods) {
    const sheet = staffSvc.payroll(period);
    const entries = sheet.items.map((item, i) => ({
      staffId: item.staffId,
      basic: item.basic,
      bonuses: i % 3 === 0 ? 300 : 0,
      rewards: i === 0 ? 500 : 0,
      deductions: i % 4 === 1 ? 150 : 0,
      status: period === currentPeriod ? (i < 2 ? 'paid' : 'pending') : 'paid',
    }));
    staffSvc.savePayroll(period, entries, null);
  }
  console.log('[seed] payroll snapshots created');

  for (const [date, description, amount, category] of REVENUES) {
    ledger.create('revenue', { date: dd(date), description, amount, category }, null);
  }
  for (const [date, description, amount, category] of EXPENSES) {
    ledger.create('expense', { date: dd(date), description, amount, category }, null);
  }
  console.log('[seed] revenues and expenses created');

  const result = maintenance.runDaily({ force: true });
  console.log(`[seed] notifications generated: ${JSON.stringify(result.actions)}`);
  console.log('[seed] done ✔');
}

try {
  main();
  store.close();
} catch (err) {
  console.error('[seed] failed:', err);
  process.exitCode = 1;
}
