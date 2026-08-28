/* Импорт CSV-выгрузки из Jira */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeSprint } = require('./helpers/load');

const BOM = '﻿';
const HEAD = 'Summary,Issue key,Issue Type,Status,Assignee,Custom field (Story Points),Resolved';

test('parseCSV: BOM, CRLF и хвостовые пустые строки', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV(`${BOM}a,b\r\n1,2\r\n\r\n`);
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('parseCSV: кавычки, запятая внутри значения, удвоенные кавычки', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV('Summary,Key\n"Поменять название, срочно",DEV-1\n"Починить ""экспорт""",DEV-2');
  assert.equal(rows[1][0], 'Поменять название, срочно');
  assert.equal(rows[2][0], 'Починить "экспорт"');
});

test('parseCSV: перевод строки внутри ячейки не рвёт строку', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV('Summary,Key\n"Первая строка\nвторая строка",DEV-1');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'Первая строка\nвторая строка');
  assert.equal(rows[1][1], 'DEV-1');
});

test('parseCSV: разделитель определяется автоматически', () => {
  const { Store } = loadApp();
  assert.deepEqual(Store.parseCSV('a;b;c\n1;2;3')[1], ['1', '2', '3']);
  assert.deepEqual(Store.parseCSV('a\tb\n1\t2')[1], ['1', '2']);
});

test('detectCsvMapping узнаёт заголовки Jira, включая кастомное поле', () => {
  const { Store } = loadApp();
  const headers = HEAD.split(',');
  const map = Store.detectCsvMapping(headers);
  assert.equal(headers[map.key], 'Issue key');
  assert.equal(headers[map.title], 'Summary');
  assert.equal(headers[map.type], 'Issue Type');
  assert.equal(headers[map.status], 'Status');
  assert.equal(headers[map.points], 'Custom field (Story Points)');
  assert.equal(headers[map.assignee], 'Assignee');
  assert.equal(headers[map.resolved], 'Resolved');
});

test('detectCsvMapping понимает русские заголовки и отсутствие колонок', () => {
  const { Store } = loadApp();
  const map = Store.detectCsvMapping(['Название', 'Ключ', 'Статус']);
  assert.equal(map.title, 0);
  assert.equal(map.key, 1);
  assert.equal(map.status, 2);
  assert.equal(map.points, -1, 'отсутствующая колонка помечается -1');
});

test('itemsFromCsv: статусы, типы, оценки и пропуск строк без названия', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV([
    HEAD,
    '"Первая",DEV-1,Task,Done,Аня,3,',
    '"Вторая",DEV-2,Bug,На тестировании,Дима,2,',
    '"",DEV-3,Task,Done,,1,',
  ].join('\n'));
  const { items, skipped } = Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), { status: 'todo' });

  assert.equal(items.length, 2);
  assert.equal(skipped, 1, 'строка без названия пропущена');
  assert.equal(items[0].status, 'done');
  assert.equal(items[0].type, 'Задача', 'тип канонизируется');
  assert.equal(items[0].assignee, 'Аня');
  assert.equal(items[1].status, 'testing');
  assert.equal(items[1].type, 'Баг');
  assert.equal(items[1].points, 2);
});

test('itemsFromCsv: незнакомые статусы собираются в список и падают в умолчание', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV([HEAD, '"Ждём",DEV-1,Task,Ожидает релиза,,5,'].join('\n'));
  const res = Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), { status: 'review' });

  assert.deepEqual(res.unknownStatuses, ['Ожидает релиза']);
  assert.equal(res.items[0].status, 'review', 'до сопоставления берётся умолчание');
});

test('сопоставленный статус применяется, но остаётся в списке для правки', () => {
  const { Store } = loadApp();
  Store.setSetting('statusMap', { 'ожидает релиза': 'deploy' });
  const rows = Store.parseCSV([HEAD, '"Ждём",DEV-1,Task,Ожидает релиза,,5,'].join('\n'));
  const res = Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), { status: 'todo' });

  assert.equal(res.items[0].status, 'deploy');
  assert.deepEqual(res.unknownStatuses, ['Ожидает релиза'],
    'строка не должна исчезать из блока сопоставления после выбора');
});

test('колонки Sprint дают счётчик переносов', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV([
    'Summary,Issue key,Status,Sprint,Sprint,Sprint',
    '"Свежая",DEV-1,To Do,Спринт 24,,',
    '"Едет вторым",DEV-2,To Do,Спринт 23,Спринт 24,',
    '"Едет четвёртым",DEV-3,To Do,Спринт 21,Спринт 22,Спринт 23',
  ].join('\n'));
  const { items } = Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), {});

  assert.equal(items[0].carryCount, 0);
  assert.equal(items[0].carriedFrom, null);
  assert.equal(items[1].carryCount, 1);
  assert.equal(items[1].carriedFrom.name, 'Спринт 23');
  assert.equal(items[2].carryCount, 2, 'три спринта = два переноса');
});

test('дата закрытия берётся из колонки Resolved только для закрытых задач', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV([
    HEAD,
    '"Закрыта",DEV-1,Task,Done,,5,22/Aug/26 4:10 PM',
    '"В работе",DEV-2,Task,In Progress,,3,22/Aug/26 4:10 PM',
  ].join('\n'));
  const { items } = Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), {});

  assert.equal(Store.toISODate(new Date(items[0].doneAt)), '2026-08-22');
  assert.equal(items[1].doneAt, null, 'незакрытой задаче дата закрытия не нужна');
});

test('весь набор статусов команды разбирается из CSV без ручного маппинга', () => {
  const { Store } = loadApp();
  const rows = Store.parseCSV([
    'Summary,Issue key,Status',
    'Раз,DEV-1,Development', 'Два,DEV-2,Ready For Testing', 'Три,DEV-3,Rejected',
    'Четыре,DEV-4,Hold', 'Пять,DEV-5,Готово', 'Шесть,DEV-6,Deploy',
    'Семь,DEV-7,Review', 'Восемь,DEV-8,Сделать',
  ].join('\n'));
  const res = Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), { status: 'todo' });

  assert.deepEqual(res.unknownStatuses, [], 'сопоставлять руками нечего');
  assert.deepEqual(res.items.map(i => i.status),
    ['progress', 'ready_to_test', 'backlog', 'backlog', 'done', 'deploy', 'review', 'todo']);
  assert.deepEqual(res.items.filter(i => i.dropped).map(i => [i.key, i.dropReason]),
    [['DEV-3', 'cancelled'], ['DEV-4', 'blocked']]);
});

test('Rejected и Hold уходят из remaining work, а не копятся в нём', () => {
  const app = loadApp();
  const { Store, Metrics } = app;
  const sprint = makeSprint(app, { tasks: [] });
  const rows = Store.parseCSV([
    'Summary,Issue key,Status,Custom field (Story Points)',
    'Работаем,DEV-1,Development,8',
    'Отклонили,DEV-2,Rejected,5',
    'Подвисла,DEV-3,Hold,2',
    'Закрыта,DEV-4,Готово,5',
  ].join('\n'));
  Store.addTasksFromItems(sprint.id, Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), {}).items);

  const m = Metrics.sprintMetrics(Store.sprintById(sprint.id));
  assert.equal(m.totalPoints, 20, 'объём обязательства не меняется');
  assert.equal(m.donePoints, 5);
  assert.equal(m.droppedPoints, 7, 'Rejected и Hold сняты');
  assert.equal(m.remainingPoints, 8, 'в остатке только то, что реально делается');
  assert.deepEqual(m.dropByReason.map(r => [r.id, r.points]), [['cancelled', 5], ['blocked', 2]]);
});

test('повторный импорт ставит снятие, но обратно его не снимает', () => {
  const app = loadApp();
  const { Store } = app;
  const sprint = makeSprint(app, { tasks: [] });
  const load = status => {
    const rows = Store.parseCSV(`Summary,Issue key,Status\nЗадача,DEV-1,${status}`);
    Store.addTasksFromItems(sprint.id, Store.itemsFromCsv(rows, Store.detectCsvMapping(rows[0]), {}).items);
    return Store.sprintById(sprint.id).tasks[0];
  };

  assert.equal(load('Development').dropped, false);
  const rejected = load('Rejected');
  assert.equal(rejected.dropped, true, 'трекер сказал прямо — снимаем');
  assert.equal(rejected.dropReason, 'cancelled');

  // Вернулась в работу в Jira: колонка обновится, но решение «не закроем» останется за тимлидом
  const back = load('Development');
  assert.equal(back.status, 'progress');
  assert.equal(back.dropped, true, 'импорт не снимает локальный флаг молча');
});

test('itemsFromCsv не падает на пустом и одном заголовке', () => {
  const { Store } = loadApp();
  assert.deepEqual(Store.itemsFromCsv([], {}, {}), { items: [], unknownStatuses: [], skipped: 0 });
  assert.deepEqual(Store.itemsFromCsv([['Summary']], { title: 0 }, {}).items, []);
});
