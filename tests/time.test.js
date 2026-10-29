'use strict';
const test = require('node:test');
const assert = require('node:assert');
const time = require('../server/lib/time');

test('parseDdMmYy accepts dd/mm/yy and dd/mm/yyyy, rejects impossible dates', () => {
  assert.equal(time.parseDdMmYy('09/05/21'), '2021-05-09');
  assert.equal(time.parseDdMmYy('9/5/2021'), '2021-05-09');
  assert.equal(time.parseDdMmYy('29/02/24'), '2024-02-29');
  assert.equal(time.parseDdMmYy('29/02/23'), null);
  assert.equal(time.parseDdMmYy('31/04/22'), null);
  assert.equal(time.parseDdMmYy('1/9/99'), '1999-09-01');
  assert.equal(time.parseDdMmYy(''), null);
});

test('formatDdMmYy keeps day/month/year order', () => {
  assert.equal(time.formatDdMmYy('2026-10-09'), '09/10/26');
  assert.equal(time.formatDdMmYyyy('2026-10-09'), '09/10/2026');
});

test('diffYMD handles month-end clamping', () => {
  assert.deepEqual(time.diffYMD('2015-08-31', '2026-03-01'), { years: 10, months: 6, days: 1 });
  assert.deepEqual(time.diffYMD('2022-02-28', '2026-10-29'), { years: 4, months: 8, days: 1 });
  assert.deepEqual(time.diffYMD('2024-02-29', '2025-02-28'), { years: 1, months: 0, days: 0 });
  assert.deepEqual(time.diffYMD('2024-02-29', '2025-03-01'), { years: 1, months: 0, days: 1 });
  assert.deepEqual(time.diffYMD('2026-10-29', '2026-10-29'), { years: 0, months: 0, days: 0 });
});

test('todayISO follows the configured timezone (no UTC off-by-one)', () => {
  const instant = new Date('2026-03-31T22:30:00.000Z'); // 01/04 in Cairo, still 31/03 in New York
  assert.equal(time.todayISO('Africa/Cairo', instant), '2026-04-01');
  assert.equal(time.todayISO('America/New_York', instant), '2026-03-31');
  assert.equal(time.todayISO('Pacific/Kiritimati', instant), '2026-04-01');
  assert.equal(time.todayISO('UTC', instant), '2026-03-31');
});

test('birthdayThisYear handles leap days', () => {
  assert.equal(time.birthdayThisYear('2020-02-29', '2027-01-01'), '2027-02-28');
  assert.equal(time.birthdayThisYear('2020-02-29', '2028-01-01'), '2028-02-29');
  assert.equal(time.birthdayThisYear('2019-07-14', '2026-10-29'), '2026-07-14');
});

test('period helpers', () => {
  assert.deepEqual(time.monthsOfYear(2026).length, 12);
  assert.deepEqual(time.periodBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28', year: 2026, month: 2 });
  assert.equal(time.addMonthsToPeriod('2026-01', -1), '2025-12');
  assert.equal(time.addMonthsToPeriod('2026-12', 1), '2027-01');
  assert.equal(time.addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(time.periodLabel('2026-10', 'ar'), 'أكتوبر 2026');
});
