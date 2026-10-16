/* Эпики: модель, импорт CSV из Jira, окно по HLE, загрузка людей, предупреждения */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

/** Ближайший понедельник не раньше сегодня — чтобы тесты не зависели от дня запуска. */
function nextMonday(Store) {
  let d = Store.today();
  while (Store.parseDate(d).getDay() !== 1) d = Store.addDays(d, 1);
  return d;
}

const CSV = [
  'Тема,Ключ проблемы,Идентификатор проблемы,Статус,Исполнитель,Автор,Создано,Пользовательское поле (HLE),Planned Start,Planned End',
  'Онбординг,prj-1,10001,Development,Анна,Самат,01/сен/26 10:00 AM,"7,5",05.10.2026,16.10.2026',
  'Биллинг,PRJ-2,10002,Requirements definition,Марат,Самат,03.09.2026 11:00,,2026-10-19,2026-10-30',
  'Отчёты,PRJ-3,10003,Ожидает бюджета,,Самат,,3,,',
  ',,,,,Самат,,,,',
].join('\n');

function importCsv(Store, text = CSV) {
  const rows = Store.parseCSV(text);
  const mapping = Store.detectCsvMapping(rows[0], Store.EPIC_CSV_HINTS);
  return { rows, mapping, ...Store.epicItemsFromCsv(rows, mapping) };
}

test('колонки русской выгрузки Jira распознаются, включая кастомные поля', () => {
  const { Store } = loadApp();
  const { mapping } = importCsv(Store);
  assert.deepEqual(mapping, {
    key: 1, issueId: 2, title: 0, author: 5, assignee: 4, status: 3,
    created: 6, hle: 7, plannedStart: 8, plannedEnd: 9,
  });
});

test('строки CSV превращаются в эпики: даты, HLE с запятой, статусы', () => {
  const { Store } = loadApp();
  const { items, unknownStatuses, skipped } = importCsv(Store);

  assert.equal(items.length, 3);
  assert.equal(skipped, 1, 'строка без ключа и темы пропущена');
  const [a, b, c] = items;
  assert.equal(a.key, 'PRJ-1', 'ключ в верхнем регистре');
  assert.equal(a.issueId, '10001');
  assert.equal(a.hle, 7.5);
  assert.equal(a.status, 'development');
  assert.equal(a.plannedStart, '2026-10-05');
  assert.equal(a.plannedEnd, '2026-10-16');
  assert.equal(Store.toISODate(new Date(a.createdAt)), '2026-09-01', 'русский месяц в формате Jira');
  assert.equal(b.status, 'requirements');
  assert.equal(b.hle, null);
  assert.equal(b.plannedStart, '2026-10-19', 'ISO-дата без сдвига часового пояса');
  assert.deepEqual(unknownStatuses, ['Ожидает бюджета']);
  assert.equal(c.status, 'backlog', 'незнакомый статус до сопоставления — Backlog');
});

test('все статусы эпиков из Jira распознаются', () => {
  const { Store } = loadApp();
  const cases = {
    'Backlog': 'backlog', 'Requirements definition': 'requirements', 'Ready for HLE': 'ready_for_hle',
    'Development': 'development', 'Готово': 'done', 'Rejected': 'rejected',
    'Ready for Deploy': 'ready_for_deploy', 'Ready for Testing': 'ready_for_testing', 'Testing': 'testing',
  };
  Object.entries(cases).forEach(([raw, id]) => assert.equal(Store.matchEpicStatus(raw), id, raw));
});

test('ручное сопоставление статуса запоминается и применяется при разборе', () => {
  const { Store } = loadApp();
  Store.setSetting('epicStatusMap', { 'ожидает бюджета': 'requirements' });
  const { items, unknownStatuses } = importCsv(Store);
  assert.equal(items[2].status, 'requirements');
  assert.deepEqual(unknownStatuses, []);
});

test('повторный импорт обновляет по ключу и не откатывает план, подвинутый вручную', () => {
  const { Store } = loadApp();
  Store.upsertEpics(importCsv(Store).items);
  assert.equal(Store.epics().length, 3);

  const epic = Store.epics().find(e => e.key === 'PRJ-1');
  Store.updateEpic(epic.id, { plannedStart: '2026-11-02', plannedEnd: '2026-11-13', hle: 9 });

  const changed = CSV.replace('Онбординг,prj-1', 'Онбординг 2.0,prj-1').replace('Development', 'Testing');
  const res = Store.upsertEpics(importCsv(Store, changed).items);
  assert.deepEqual(res, { added: 0, updated: 3, total: 3 });
  assert.equal(Store.epics().length, 3, 'не задвоилось');

  const after = Store.epicById(epic.id);
  assert.equal(after.title, 'Онбординг 2.0', 'тема — из Jira');
  assert.equal(after.status, 'testing', 'статус — из Jira');
  assert.equal(after.plannedStart, '2026-11-02', 'план остался нашим');
  assert.equal(after.hle, 9);

  Store.upsertEpics(importCsv(Store, changed).items, { overwritePlan: true });
  assert.equal(Store.epicById(epic.id).plannedStart, '2026-10-05', 'с галкой план берётся из файла');
  assert.equal(Store.epicById(epic.id).hle, 7.5);
});

test('пустые поля плана заполняются из файла и без галки', () => {
  const { Store } = loadApp();
  const e = Store.addEpic({ key: 'PRJ-1', title: 'Онбординг' });
  Store.upsertEpics(importCsv(Store).items);
  assert.equal(Store.epicById(e.id).plannedStart, '2026-10-05');
  assert.equal(Store.epicById(e.id).hle, 7.5);
});

test('даты плана нормализуются: одна дата — однодневное окно, перевёрнутые меняются местами', () => {
  const { Store } = loadApp();
  const a = Store.addEpic({ title: 'A', plannedStart: '2026-10-05' });
  assert.equal(a.plannedEnd, '2026-10-05');
  const b = Store.addEpic({ title: 'B', plannedStart: '2026-10-20', plannedEnd: '2026-10-10' });
  assert.deepEqual([b.plannedStart, b.plannedEnd], ['2026-10-10', '2026-10-20']);
  const c = Store.addEpic({ title: 'C', status: 'непонятно', hle: -3 });
  assert.equal(c.status, 'backlog');
  assert.equal(c.hle, null);
});

test('эпики переживают экспорт и импорт бэкапа', () => {
  const { Store } = loadApp();
  Store.addEpic({ key: 'PRJ-9', title: 'Эпик', hle: 5, plannedStart: '2026-10-05', plannedEnd: '2026-10-09' });
  const restored = Store.parseImport(JSON.stringify(Store.get()));
  assert.equal(restored.epics.length, 1);
  assert.equal(restored.epics[0].key, 'PRJ-9');
  assert.equal(restored.epics[0].hle, 5);
});

test('CSV с планом: русские заголовки, экранирование, статус человеческим названием', () => {
  const { Store } = loadApp();
  Store.addEpic({ key: 'PRJ-1', title: 'Отчёт, "квартальный"', status: 'done', hle: 3,
                  plannedStart: '2026-10-05', plannedEnd: '2026-10-07' });
  const lines = Store.epicsToCsv().split('\r\n');
  assert.equal(lines[0], 'Ключ проблемы,Идентификатор проблемы,Тема,Исполнитель,Статус,HLE,Planned Start,Planned End');
  assert.equal(lines[1], 'PRJ-1,,"Отчёт, ""квартальный""",,Готово,3,2026-10-05,2026-10-07');
  // Выгрузка читается нашим же импортом — круг замкнут
  const rows = Store.parseCSV(lines.join('\n'));
  const items = Store.epicItemsFromCsv(rows, Store.detectCsvMapping(rows[0], Store.EPIC_CSV_HINTS)).items;
  assert.equal(items[0].title, 'Отчёт, "квартальный"');
  assert.equal(items[0].status, 'done');
});

test('окно по HLE считается в рабочих днях, старт в выходной сдвигается на понедельник', () => {
  const { Store, Epics } = loadApp();
  // 2026-10-05 — понедельник
  assert.deepEqual(Epics.windowFromHle('2026-10-05', 5), { start: '2026-10-05', end: '2026-10-09' });
  assert.deepEqual(Epics.windowFromHle('2026-10-05', 6), { start: '2026-10-05', end: '2026-10-12' }, 'через выходные');
  assert.deepEqual(Epics.windowFromHle('2026-10-10', 1), { start: '2026-10-12', end: '2026-10-12' }, 'суббота → понедельник');
  assert.deepEqual(Epics.windowFromHle('2026-10-05', 2.5), { start: '2026-10-05', end: '2026-10-07' }, 'дробный HLE вверх');
  const fallback = Epics.windowFromHle('2026-10-05', null);
  assert.equal(Store.workingDays(fallback.start, fallback.end), Epics.DEFAULT_WINDOW_DAYS, 'без оценки — окно по умолчанию');
});

test('интенсивность эпика — сколько людей нужно на окно', () => {
  const { Epics } = loadApp();
  const e = { hle: 5, plannedStart: '2026-10-05', plannedEnd: '2026-10-16' };   // 10 рабочих дней
  assert.equal(Epics.windowDays(e), 10);
  assert.equal(Epics.intensity(e), 0.5);
  assert.equal(Epics.intensity({ ...e, hle: null }), 0);
});

test('предупреждения: без дат, без HLE, не влезает, просрочен — исполнитель не важен', () => {
  const { Epics } = loadApp();
  const today = '2026-10-12';
  const ids = e => Epics.issues(e, today).map(i => i.id).sort();

  assert.deepEqual(ids({ status: 'backlog', hle: null, assignee: '', plannedStart: null, plannedEnd: null }),
    ['no-hle', 'unscheduled'], 'пустой исполнитель — не проблема');
  assert.deepEqual(ids({ status: 'development', hle: 12, plannedStart: '2026-10-19', plannedEnd: '2026-10-30' }),
    ['squeezed'], '12 п/д в 10 рабочих днях');
  assert.deepEqual(ids({ status: 'testing', hle: 3, plannedStart: '2026-09-28', plannedEnd: '2026-10-09' }),
    ['overdue']);
  assert.deepEqual(ids({ status: 'done', hle: null, plannedStart: null, plannedEnd: null }), [],
    'у закрытого эпика претензий нет');
});

test('сводка по плану и группировка Ганта', () => {
  const { Store, Epics } = loadApp();
  const mon = nextMonday(Store);
  const list = [
    { id: '1', key: 'P-2', rank: 1, status: 'development', hle: 10, plannedStart: mon, plannedEnd: Store.addDays(mon, 4) },
    { id: '2', key: 'P-1', rank: 2, status: 'backlog', hle: null, plannedStart: null, plannedEnd: null },
    { id: '3', key: 'P-3', rank: 3, status: 'testing', hle: 4, plannedStart: mon, plannedEnd: Store.addDays(mon, 4) },
    { id: '4', key: 'P-4', rank: 4, status: 'backlog', hle: 2, plannedStart: null, plannedEnd: null },
    { id: '5', key: 'P-5', rank: 5, status: 'rejected', hle: 99, plannedStart: null, plannedEnd: null },
  ];
  const o = Epics.overview(list, Store.today());
  assert.equal(o.open, 4);
  assert.equal(o.scheduled, 2);
  assert.equal(o.unscheduled, 2);
  assert.equal(o.hleTotal, 16, 'отклонённый эпик в сумму не входит');
  assert.equal(o.noHle, 1);
  assert.equal(o.squeezed, 1);
  assert.equal('overloaded' in o, false, 'загрузки людей больше нет');

  const flat = Epics.groupRows(list, 'none');
  assert.equal(flat.length, 1);
  assert.deepEqual(flat[0].epics.map(e => e.key), ['P-2', 'P-1', 'P-3', 'P-4', 'P-5'], 'по приоритету');
  assert.equal(Epics.groupRows(list, 'assignee').length, 1, 'старый режим «по людям» — просто список');
  assert.equal(typeof Epics.weeklyLoad, 'undefined');
});

test('сохранённая группировка «по людям» превращается в «по готовности»', () => {
  const { Store } = loadApp();
  const state = Store.parseImport(JSON.stringify({ sprints: [], settings: { roadmapGroup: 'assignee' } }));
  assert.equal(state.settings.roadmapGroup, 'readiness');
  assert.equal(Store.parseImport(JSON.stringify({ sprints: [], settings: { roadmapGroup: 'none' } })).settings.roadmapGroup, 'none');
});

test('шкала начинается с понедельника и покрывает все эпики', () => {
  const { Store, Epics } = loadApp();
  const today = '2026-10-14';
  const range = Epics.timelineRange([{ plannedStart: '2026-06-03', plannedEnd: '2027-03-10' }], today);
  assert.equal(Store.parseDate(range.start).getDay(), 1);
  assert.equal(Store.parseDate(range.end).getDay(), 0);
  assert.ok(range.start <= '2026-06-03' && range.end >= '2027-03-10');
  assert.equal(range.days % 7, 0);
});

test('приоритет: новые эпики в конце, перетаскивание перенумеровывает 1..n', () => {
  const { Store } = loadApp();
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(title => Store.addEpic({ title }));
  assert.deepEqual([a, b, c, d].map(e => e.rank), [1, 2, 3, 4]);
  const order = () => [...Store.epics()].sort((x, y) => x.rank - y.rank).map(e => e.title).join('');

  assert.equal(Store.moveEpic(d.id, a.id, 'before'), true);
  assert.equal(order(), 'DABC');
  Store.moveEpic(d.id, c.id, 'after');
  assert.equal(order(), 'ABCD');
  Store.moveEpic(a.id, b.id, 'after');
  assert.equal(order(), 'BACD');
  assert.equal(Store.moveEpic(a.id, b.id, 'after'), false, 'уже на месте — ничего не сохраняем');
  assert.equal(Store.moveEpic(a.id, 'нет такого'), false);

  Store.deleteEpic(b.id);
  assert.deepEqual([...Store.epics()].sort((x, y) => x.rank - y.rank).map(e => e.rank), [1, 2, 3], 'без дыр после удаления');
  assert.equal(Store.addEpic({ title: 'E' }).rank, 4);
});

test('старые данные без приоритета получают порядок по дате старта', () => {
  const { Store } = loadApp();
  const state = Store.parseImport(JSON.stringify({ sprints: [], epics: [
    { key: 'P-3', title: 'Без дат' },
    { key: 'P-2', title: 'Позже', plannedStart: '2026-11-02', plannedEnd: '2026-11-06' },
    { key: 'P-1', title: 'Раньше', plannedStart: '2026-10-05', plannedEnd: '2026-10-09' },
  ] }));
  assert.deepEqual(state.epics.map(e => [e.key, e.rank]), [['P-3', 3], ['P-2', 2], ['P-1', 1]]);
});

test('импорт ставит новые эпики в конец приоритета и не трогает порядок существующих', () => {
  const { Store } = loadApp();
  const first = Store.addEpic({ key: 'PRJ-2', title: 'Был раньше' });
  Store.upsertEpics(importCsv(Store).items);
  assert.equal(Store.epicById(first.id).rank, 1);
  assert.deepEqual(Store.epics().map(e => e.rank).sort(), [1, 2, 3]);
});

test('готовность: груминг пройден, когда требования понятны и HLE проставлен', () => {
  const { Epics } = loadApp();
  const st = (status, hle = null) => Epics.stage({ status, hle });
  assert.equal(st('backlog', 5), 'requirements', 'HLE без понятных требований не считается');
  assert.equal(st('requirements'), 'requirements');
  assert.equal(st('ready_for_hle'), 'estimate');
  assert.equal(st('ready_for_hle', 8), 'ready');
  ['development', 'ready_for_testing', 'testing', 'ready_for_deploy']
    .forEach(s => assert.equal(st(s), 'progress', s));
  assert.equal(st('done'), 'closed');
  assert.equal(st('rejected'), 'closed');

  assert.equal(Epics.isGroomed({ status: 'ready_for_hle', hle: 3 }), true);
  assert.equal(Epics.isGroomed({ status: 'ready_for_hle', hle: null }), false);
  assert.equal(Epics.isGroomed({ status: 'done', hle: null }), null);
});

test('сводка готовности и группы «прошли / не прошли груминг»', () => {
  const { Epics } = loadApp();
  const list = [
    { id: '1', key: 'P-1', rank: 3, status: 'backlog', hle: null },
    { id: '2', key: 'P-2', rank: 2, status: 'ready_for_hle', hle: null },
    { id: '3', key: 'P-3', rank: 1, status: 'ready_for_hle', hle: 8 },
    { id: '4', key: 'P-4', rank: 4, status: 'development', hle: 12 },
    { id: '5', key: 'P-5', rank: 5, status: 'done', hle: 4 },
  ];
  const r = Epics.readiness(list);
  assert.deepEqual(r.groomed, { count: 2, hle: 20 });
  assert.deepEqual(r.ungroomed, { count: 2, hle: 0 });
  assert.deepEqual(r.stages.map(s => [s.id, s.count]),
    [['requirements', 1], ['estimate', 1], ['ready', 1], ['progress', 1], ['closed', 1]]);

  const groups = Epics.groupRows(list, 'readiness');
  assert.deepEqual(groups.map(g => [g.key, g.epics.map(e => e.key)]), [
    ['groomed', ['P-3', 'P-4']],
    ['ungroomed', ['P-2', 'P-1']],          // по приоритету, а не по порядку в массиве
    ['closed', ['P-5']],
  ]);
});

test('очередь: неделя приводится к понедельнику, длина — к целым неделям', () => {
  const { Store } = loadApp();
  const e = Store.addEpic({ title: 'A' });
  assert.equal(e.queue, null, 'новый эпик не в очереди');

  Store.setEpicQueue(e.id, '2026-10-15', 2.6);                  // четверг
  assert.deepEqual(Store.epicById(e.id).queue, { week: '2026-10-12', span: 3 });
  Store.setEpicQueue(e.id, '2026-10-26');
  assert.deepEqual(Store.epicById(e.id).queue, { week: '2026-10-26', span: 3 }, 'без длины — прежняя');
  Store.setEpicQueue(e.id, '2026-10-26', 999);
  assert.equal(Store.epicById(e.id).queue.span, Store.QUEUE_MAX_SPAN);
  Store.setEpicQueue(e.id, null);
  assert.equal(Store.epicById(e.id).queue, null);

  assert.equal(Store.addEpic({ title: 'B', queue: { week: 'мусор', span: 2 } }).queue, null);
  assert.equal(Store.mondayOf('2026-10-18'), '2026-10-12', 'воскресенье — к своему понедельнику');
});

test('очередь не трогает Planned Start / End', () => {
  const { Store } = loadApp();
  const e = Store.addEpic({ title: 'A', plannedStart: '2026-11-02', plannedEnd: '2026-11-13' });
  Store.setEpicQueue(e.id, '2026-10-12', 2);
  assert.equal(Store.epicById(e.id).plannedStart, '2026-11-02');
  assert.equal(Store.epicById(e.id).plannedEnd, '2026-11-13');
});

test('длина по умолчанию — HLE на рабочую неделю одного человека', () => {
  const { Epics } = loadApp();
  assert.equal(Epics.defaultSpan(null), 2);
  assert.equal(Epics.defaultSpan(5), 1);
  assert.equal(Epics.defaultSpan(12), 3);
  assert.equal(Epics.defaultSpan(1000), 26);
});

test('недели доски и сколько взято на каждую', () => {
  const { Store, Epics } = loadApp();
  const today = '2026-10-14';                                    // среда, неделя с 12 октября
  const list = [
    { id: 'a', status: 'development', hle: 10, queue: { week: '2026-10-12', span: 2 } },   // 1 чел
    { id: 'b', status: 'ready_for_hle', hle: 5, queue: { week: '2026-10-19', span: 1 } },  // 1 чел
    { id: 'c', status: 'backlog', hle: null, queue: { week: '2026-10-19', span: 1 } },     // не оценён
    { id: 'd', status: 'done', hle: 50, queue: { week: '2026-10-12', span: 1 } },          // закрыт
    { id: 'e', status: 'backlog', hle: 3, queue: null },
  ];
  const weeks = Epics.queueWeeks(list, today);
  assert.equal(weeks[0], '2026-10-12');
  assert.equal(weeks.length, 12, 'минимум квартал вперёд');

  const [w1, w2, w3] = Epics.queueStats(list, weeks);
  assert.deepEqual([w1.count, w1.people], [1, 1], 'закрытый эпик неделю не занимает');
  assert.deepEqual([w2.count, w2.people, w2.unknown, w2.ungroomed], [3, 2, 1, 1]);
  assert.equal(w3.count, 0);

  assert.equal(Epics.queueWeeks([{ queue: { week: '2026-09-28', span: 1 } }], today)[0], '2026-09-28',
    'эпик, оставшийся в прошлом, не пропадает с доски');
  const far = Epics.queueWeeks([{ queue: { week: '2027-03-01', span: 4 } }], today);
  assert.equal(far[far.length - 1], '2027-04-05', 'две недели запаса за последним эпиком');
});

test('бэкап сохраняет очередь и размер команды', () => {
  const { Store } = loadApp();
  const e = Store.addEpic({ title: 'A' });
  Store.setEpicQueue(e.id, '2026-10-12', 2);
  Store.setSetting('queueTeamSize', 4);
  const restored = Store.parseImport(JSON.stringify(Store.get()));
  assert.deepEqual(restored.epics[0].queue, { week: '2026-10-12', span: 2 });
  assert.equal(restored.settings.queueTeamSize, 4);
});

test('перенос очереди в Planned: пн первой недели — пт последней, закрытые и совпадающие не трогаем', () => {
  const { Store, Epics } = loadApp();
  const fresh = Store.addEpic({ key: 'P-1', title: 'Новый' });
  const moved = Store.addEpic({ key: 'P-2', title: 'Был план', plannedStart: '2026-12-01', plannedEnd: '2026-12-10' });
  const same = Store.addEpic({ key: 'P-3', title: 'Совпадает', plannedStart: '2026-10-12', plannedEnd: '2026-10-16' });
  const done = Store.addEpic({ key: 'P-4', title: 'Закрыт', status: 'done' });
  Store.addEpic({ key: 'P-5', title: 'Вне очереди', plannedStart: '2026-11-02', plannedEnd: '2026-11-06' });
  Store.setEpicQueue(fresh.id, '2026-10-12', 3);
  Store.setEpicQueue(moved.id, '2026-10-19', 1);
  Store.setEpicQueue(same.id, '2026-10-12', 1);
  Store.setEpicQueue(done.id, '2026-10-12', 1);

  const { changes, same: unchanged } = Epics.queueToPlan(Store.epics());
  assert.equal(unchanged, 1);
  assert.deepEqual(changes.map(c => [c.epic.key, c.start, c.end, c.overwrite]), [
    ['P-1', '2026-10-12', '2026-10-30', false],
    ['P-2', '2026-10-19', '2026-10-23', true],
  ]);

  assert.equal(Store.applyQueuePlan(changes), 2);
  const byKey = k => Store.epics().find(e => e.key === k);
  assert.deepEqual([byKey('P-1').plannedStart, byKey('P-1').plannedEnd], ['2026-10-12', '2026-10-30']);
  assert.equal(byKey('P-2').plannedStart, '2026-10-19');
  assert.equal(byKey('P-4').plannedStart, null, 'закрытый эпик без изменений');
  assert.equal(byKey('P-5').plannedStart, '2026-11-02', 'эпик вне очереди без изменений');
  assert.deepEqual(byKey('P-1').queue, { week: '2026-10-12', span: 3 }, 'очередь остаётся как была');
  assert.equal(Epics.queueToPlan(Store.epics()).changes.length, 0, 'повторный перенос — нечего менять');
});

test('обратный перенос: Planned Start / End → неделя и длина в очереди', () => {
  const { Store, Epics } = loadApp();
  const fresh = Store.addEpic({ key: 'P-1', title: 'Ср–вт', plannedStart: '2026-10-14', plannedEnd: '2026-10-27' });
  const moved = Store.addEpic({ key: 'P-2', title: 'Был в очереди', plannedStart: '2026-11-02', plannedEnd: '2026-11-06' });
  const same = Store.addEpic({ key: 'P-3', title: 'Совпадает', plannedStart: '2026-10-12', plannedEnd: '2026-10-16' });
  const noDates = Store.addEpic({ key: 'P-4', title: 'Без дат' });
  const done = Store.addEpic({ key: 'P-5', title: 'Закрыт', status: 'done', plannedStart: '2026-10-12', plannedEnd: '2026-10-16' });
  Store.setEpicQueue(moved.id, '2026-10-12', 4);
  Store.setEpicQueue(same.id, '2026-10-12', 1);
  Store.setEpicQueue(noDates.id, '2026-10-19', 2);

  const { changes, same: unchanged } = Epics.planToQueue(Store.epics());
  assert.equal(unchanged, 1);
  assert.deepEqual(changes.map(c => [c.epic.key, c.week, c.span, c.overwrite]), [
    ['P-1', '2026-10-12', 3, false],       // среда → понедельник; задевает три недели
    ['P-2', '2026-11-02', 1, true],
  ]);

  assert.equal(Store.applyPlanToQueue(changes), 2);
  const byKey = k => Store.epics().find(e => e.key === k);
  assert.deepEqual(byKey('P-1').queue, { week: '2026-10-12', span: 3 });
  assert.deepEqual(byKey('P-4').queue, { week: '2026-10-19', span: 2 }, 'эпик без дат остался на месте');
  assert.equal(byKey('P-5').queue, null, 'закрытый не трогаем');
  assert.equal(byKey('P-1').plannedStart, '2026-10-14', 'Planned-даты не меняются');
});

test('круг очередь → Planned → очередь ничего не сдвигает', () => {
  const { Store, Epics } = loadApp();
  const e = Store.addEpic({ title: 'A' });
  Store.setEpicQueue(e.id, '2026-10-12', 3);
  Store.applyQueuePlan(Epics.queueToPlan(Store.epics()).changes);
  const back = Epics.planToQueue(Store.epics());
  assert.equal(back.changes.length, 0);
  assert.equal(back.same, 1);
});

test('в самый верх и в самый низ приоритета', () => {
  const { Store } = loadApp();
  const [a, b, c] = ['A', 'B', 'C'].map(title => Store.addEpic({ title }));
  const order = () => [...Store.epics()].sort((x, y) => x.rank - y.rank).map(e => e.title).join('');

  assert.equal(Store.moveEpicToEdge(c.id, 'top'), true);
  assert.equal(order(), 'CAB');
  assert.equal(Store.moveEpicToEdge(c.id, 'top'), false, 'уже наверху — ничего не сохраняем');
  Store.moveEpicToEdge(c.id, 'bottom');
  assert.equal(order(), 'ABC');
  Store.moveEpicToEdge(a.id, 'bottom');
  assert.equal(order(), 'BCA');
  assert.deepEqual([...Store.epics()].map(e => e.rank).sort(), [1, 2, 3]);
  assert.equal(Store.moveEpicToEdge('нет такого', 'top'), false);
  assert.equal(b.rank, 1);
});

test('удалить все эпики — вместе с очередью и приоритетом', () => {
  const { Store } = loadApp();
  assert.equal(Store.deleteAllEpics(), 0, 'пусто — нечего удалять');
  const a = Store.addEpic({ title: 'A' });
  Store.addEpic({ title: 'B' });
  Store.setEpicQueue(a.id, '2026-10-12', 2);
  assert.equal(Store.deleteAllEpics(), 2);
  assert.deepEqual(Store.epics(), []);
  assert.equal(Store.parseImport(JSON.stringify(Store.get())).epics.length, 0, 'пустота переживает бэкап');
  assert.equal(Store.addEpic({ title: 'C' }).rank, 1, 'нумерация приоритета начинается заново');
});
