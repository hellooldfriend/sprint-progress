/* Утилиты дат: всё считается в местном времени, без сдвига через UTC. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

const { Store } = loadApp();

test('toISODate не съезжает на сутки из-за часового пояса', () => {
  // Полночь по местному времени в UTC-плюсовых зонах превращается во «вчера»,
  // если считать через toISOString — проверяем, что этого не происходит
  assert.equal(Store.toISODate(new Date(2026, 7, 13, 0, 30)), '2026-08-13');
  assert.equal(Store.toISODate(new Date(2026, 7, 13, 23, 30)), '2026-08-13');
  assert.equal(Store.toISODate(new Date(2026, 0, 1)), '2026-01-01');
});

test('parseDate читает YYYY-MM-DD как местную дату', () => {
  const d = Store.parseDate('2026-08-13');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 13);
});

test('addDays переходит через границы месяца и года', () => {
  assert.equal(Store.addDays('2026-08-30', 3), '2026-09-02');
  assert.equal(Store.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(Store.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(Store.addDays('2026-08-13', 0), '2026-08-13');
});

test('diffDays считает календарные сутки в обе стороны', () => {
  assert.equal(Store.diffDays('2026-08-10', '2026-08-23'), 13);
  assert.equal(Store.diffDays('2026-08-23', '2026-08-10'), -13);
  assert.equal(Store.diffDays('2026-08-10', '2026-08-10'), 0);
});

test('стандартный спринт — 14 дней включительно', () => {
  const start = '2026-08-10';
  const end = Store.addDays(start, Store.SPRINT_DEFAULT_DAYS - 1);
  assert.equal(end, '2026-08-23');
  assert.equal(Store.dateRange(start, end).length, 14);
});

test('dateRange отдаёт непрерывный ряд дат включительно', () => {
  const range = Store.dateRange('2026-08-30', '2026-09-02');
  assert.deepEqual(range, ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
});

test('formatRange опускает год, если спринт внутри одного года', () => {
  assert.equal(Store.formatRange('2026-08-10', '2026-08-23'), '10 авг — 23 авг');
  assert.equal(Store.formatRange('2026-12-28', '2027-01-10'), '28 дек — 10 янв 2027');
});

test('parseDateTime понимает форматы Jira, локали и ISO', () => {
  const jira = Store.parseDateTime('13/Aug/26 3:04 PM');
  assert.equal(Store.toISODate(new Date(jira)), '2026-08-13');
  assert.equal(new Date(jira).getHours(), 15);

  assert.equal(new Date(Store.parseDateTime('2/Sep/26 9:15 AM')).getHours(), 9);
  assert.equal(Store.toISODate(new Date(Store.parseDateTime('13/Aug/2026 15:04'))), '2026-08-13');
  assert.equal(Store.toISODate(new Date(Store.parseDateTime('13.08.2026 15:04'))), '2026-08-13');
  assert.equal(Store.parseDateTime('2026-08-13T12:00:00.000Z'), '2026-08-13T12:00:00.000Z');
});

test('parseDateTime возвращает null на пустоте и мусоре', () => {
  assert.equal(Store.parseDateTime(''), null);
  assert.equal(Store.parseDateTime('   '), null);
  assert.equal(Store.parseDateTime('не дата'), null);
  assert.equal(Store.parseDateTime(null), null);
});
