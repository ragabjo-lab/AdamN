'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated data file for the whole test run
process.env.ADAMN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'adamn-test-'));

const { createApp } = require('../server/app');
const { connectDataFile, relinkDataFile, backupNow } = require('../server/db/discover');
const { store } = require('../server/db/connection');
const { ensureDefaults } = require('../server/services/settings');

let server;
let baseUrl;
let cookie = '';

async function call(method, url, body, { headers = {}, raw = false } = {}) {
  const init = { method, headers: { 'x-adamn-client': '1', ...headers } };
  if (cookie) init.headers.cookie = cookie;
  if (body !== undefined) {
    if (raw) init.body = body;
    else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`${baseUrl}${url}`, init);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body: payload, type, headers: res.headers };
}

test.before(async () => {
  connectDataFile();
  ensureDefaults();
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  store.close();
});

test('health, setup wizard and login', async (t) => {
  await t.test('health responds', async () => {
    const res = await call('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.dataFileConnected, true);
  });

  await t.test('first run requires setup', async () => {
    const res = await call('GET', '/api/auth/setup-status');
    assert.equal(res.body.needsSetup, true);
  });

  await t.test('setup creates the admin and a session', async () => {
    const res = await call('POST', '/api/auth/setup', {
      username: 'admin', password: 'AdamN2026', fullName: 'مدير النظام', nurseryName: 'حضانة الاختبار',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'admin');
    assert.ok(cookie.startsWith('adamn_sid='));
  });

  await t.test('setup cannot run twice', async () => {
    const res = await call('POST', '/api/auth/setup', { username: 'x', password: 'Abcd1234', fullName: 'x' });
    assert.equal(res.status, 400);
  });

  await t.test('unauthenticated API access is rejected', async () => {
    const saved = cookie; cookie = '';
    const res = await call('GET', '/api/students');
    assert.equal(res.status, 401);
    cookie = saved;
  });

  await t.test('mutations without the client header are blocked', async () => {
    const res = await fetch(`${baseUrl}/api/students`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fullName: 'x' }),
    });
    assert.equal(res.status, 403);
  });
});

test('students: validation, age/duration, payments, search', async (t) => {
  let studentId;

  await t.test('rejects digits in the name', async () => {
    const res = await call('POST', '/api/students', {
      fullName: 'Ahmed 123', birthDate: '01/01/2020', enrollDate: '01/09/2023', guardianPhone: '01000000000',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /حروف/);
  });

  await t.test('rejects a non-digit phone', async () => {
    const res = await call('POST', '/api/students', {
      fullName: 'طالب سليم', birthDate: '01/01/2020', enrollDate: '01/09/2023', guardianPhone: 'abc123',
    });
    assert.equal(res.status, 400);
  });

  await t.test('rejects enrollment before birth', async () => {
    const res = await call('POST', '/api/students', {
      fullName: 'طالب سليم', birthDate: '01/01/2024', enrollDate: '01/09/2023', guardianPhone: '01000000000',
    });
    assert.equal(res.status, 400);
  });

  await t.test('creates a student with computed age and duration', async () => {
    const res = await call('POST', '/api/students', {
      fullName: 'يوسف أحمد محمود',
      birthDate: '14/03/2021',
      enrollDate: '01/09/2024',
      guardianPhone: '01001234567',
      guardianName: 'أحمد محمود',
      monthlyFee: 1200,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.birthDate, '2021-03-14');
    assert.ok(res.body.age.years >= 4);
    assert.ok(typeof res.body.duration.days === 'number');
    studentId = res.body.id;
  });

  await t.test('records a monthly payment and marks the month as paid', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const put = await call('PUT', `/api/students/${studentId}/payments/${period}`, { amount: 1200 });
    assert.equal(put.status, 200);
    assert.equal(put.body.status, 'paid');
    const list = await call('GET', `/api/students?status=paid&month=${period}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((s) => s.id === studentId));
    const paid = list.body.items.find((s) => s.id === studentId);
    assert.equal(paid.payments[period], 1200);
  });

  await t.test('amount zero flips the month back to unpaid', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const put = await call('PUT', `/api/students/${studentId}/payments/${period}`, { amount: 0 });
    assert.equal(put.body.status, 'unpaid');
    const list = await call('GET', `/api/students?status=unpaid&month=${period}`);
    assert.ok(list.body.items.some((s) => s.id === studentId));
  });

  await t.test('search by name and by phone works', async () => {
    const byName = await call('GET', '/api/students?q=يوسف');
    assert.ok(byName.body.items.length >= 1);
    const byPhone = await call('GET', '/api/students?q=01001234567');
    assert.ok(byPhone.body.items.length >= 1);
  });

  await t.test('photo upload is stored inside the data file', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const up = await call('POST', `/api/students/${studentId}/photo`, png, {
      raw: true, headers: { 'content-type': 'image/png', 'x-file-name': 'photo.png' },
    });
    assert.equal(up.status, 201);
    const raw = await fetch(`${baseUrl}/api/attachments/${up.body.photoId}/raw`, { headers: { cookie } });
    assert.equal(raw.status, 200);
    const bytes = Buffer.from(await raw.arrayBuffer());
    assert.deepEqual(bytes, png);
  });
});

test('staff, payroll snapshots and historical accuracy', async (t) => {
  let staffId;
  const period = new Date().toISOString().slice(0, 7);

  await t.test('creates a staff member', async () => {
    const res = await call('POST', '/api/staff', {
      fullName: 'منى عبد الفتاح', phone: '01001112223', role: 'مدرسة',
      hireDate: '01/09/2020', baseSalary: 5000,
    });
    assert.equal(res.status, 201);
    staffId = res.body.id;
  });

  await t.test('saves payroll with net = basic + bonuses + rewards - deductions', async () => {
    const res = await call('PUT', `/api/staff/payroll/${period}`, {
      entries: [{ staffId, basic: 5000, bonuses: 500, rewards: 300, deductions: 200, status: 'paid' }],
    });
    assert.equal(res.status, 200);
    const item = res.body.items.find((i) => i.staffId === staffId);
    assert.equal(item.net, 5600);
  });

  await t.test('a later raise does not rewrite past payroll', async () => {
    const raise = await call('PUT', `/api/staff/${staffId}`, {
      fullName: 'منى عبد الفتاح', phone: '01001112223', role: 'مدرسة',
      hireDate: '01/09/2020', baseSalary: 7000, effectiveFrom: '01/01/2030',
    });
    assert.equal(raise.status, 200);
    const sheet = await call('GET', `/api/staff/payroll/${period}`);
    const item = sheet.body.items.find((i) => i.staffId === staffId);
    assert.equal(item.basic, 5000, 'past month keeps the historical basic salary');
    assert.equal(item.net, 5600);
  });
});

test('revenues, expenses and finance reports', async (t) => {
  const period = new Date().toISOString().slice(0, 7);
  const today = new Date();
  const dd = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(2)}`;

  await t.test('creates other revenue and an expense', async () => {
    const rev = await call('POST', '/api/revenue', { date: dd, description: 'بيع زي مدرسي', amount: 1500, category: 'زي مدرسي' });
    assert.equal(rev.status, 201);
    const exp = await call('POST', '/api/expenses', { date: dd, description: 'إيجار', amount: 900, category: 'إيجار' });
    assert.equal(exp.status, 201);
    const filtered = await call('GET', `/api/revenue?month=${period}`);
    assert.ok(filtered.body.items.length >= 1);
    assert.ok(filtered.body.summary.filteredTotal >= 1500);
  });

  await t.test('finance month aggregates every source', async () => {
    const res = await call('GET', `/api/finance/month/${period}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.revenue.other >= 1500);
    assert.ok(res.body.expenses.other >= 900);
    assert.ok(res.body.expenses.salaries >= 5600);
    assert.equal(res.body.net, Math.round((res.body.revenue.total - res.body.expenses.total) * 100) / 100);
  });

  await t.test('finance year returns 12 months', async () => {
    const res = await call('GET', '/api/finance/year/2026');
    assert.equal(res.body.months.length, 12);
  });
});

test('notifications, exports and printable reports', async (t) => {
  await t.test('notification center exposes an unread badge count', async () => {
    const res = await call('GET', '/api/notifications?pageSize=10');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(typeof res.body.unread === 'number');
    if (res.body.items.length) {
      const first = res.body.items[0];
      const read = await call('POST', `/api/notifications/${first.id}/read`, {});
      assert.equal(read.status, 200);
      const all = await call('POST', '/api/notifications/read-all', {});
      assert.equal(all.body.unread, 0);
    }
  });

  await t.test('Excel exports are real xlsx files', async () => {
    for (const url of ['/api/exports/students.xlsx?year=2026', '/api/exports/staff.xlsx', '/api/exports/finance.xlsx?year=2026']) {
      const res = await fetch(`${baseUrl}${url}`, { headers: { cookie } });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /spreadsheetml/);
      const buffer = Buffer.from(await res.arrayBuffer());
      assert.ok(buffer.length > 2000);
      assert.equal(buffer.slice(0, 2).toString(), 'PK');
    }
  });

  await t.test('print view renders all 12 months for one student', async () => {
    const list = await call('GET', '/api/students?pageSize=1');
    const id = list.body.items[0].id;
    const res = await fetch(`${baseUrl}/print/student/${id}?year=2026`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    for (const month of ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']) {
      assert.ok(html.includes(month), `printout contains ${month}`);
    }
  });

  await t.test('print view requires a session', async () => {
    const res = await fetch(`${baseUrl}/print/students`, { redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

test('data file lifecycle: backup, relink and automatic re-attach after moving', async (t) => {
  await t.test('creates a backup copy', async () => {
    const res = await call('POST', '/api/settings/data-file/backup', {});
    assert.equal(res.status, 200);
    assert.ok(res.body.path && fs.existsSync(res.body.path));
  });

  await t.test('re-attaches automatically when the file was moved', async () => {
    const original = store.filePath;
    const moved = path.join(os.homedir(), `adamn-moved-${Date.now()}.db`);
    store.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(original, moved);
    store.close();
    fs.unlinkSync(original);
    const { connectDataFile: reconnect } = require('../server/db/discover');
    const result = reconnect();
    assert.equal(result.relinked, true, 'file was rediscovered by its UUID');
    assert.equal(path.resolve(result.info.path), path.resolve(moved));
    assert.ok(store.get('SELECT COUNT(*) AS c FROM students').c >= 1);
    fs.unlinkSync(moved);
  });

  await t.test('relink rejects a non-AdamN file', async () => {
    const junk = path.join(os.tmpdir(), `junk-${Date.now()}.db`);
    fs.writeFileSync(junk, 'not a database');
    assert.throws(() => relinkDataFile(junk));
    fs.unlinkSync(junk);
  });
});
