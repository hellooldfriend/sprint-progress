/* «Требует внимания»: какие проблемы попадают в список и в каком порядке */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

const TODAY = '2026-10-14';   // среда
const ids = items => items.map(i => i.id);
const collect = (app, extra = {}) => app.Attention.collect({
  sprint: null, epics: app.Store.epics(), today: TODAY, mode: 'points', ...extra,
});

test('эпик с Planned End в ближайшие 5 рабочих дней — «скоро срок», дальше — нет', () => {
  const app = loadApp();
  const { Store } = app;
  Store.addEpic({ key: 'A', title: 'Сегодня', hle: 3, plannedStart: '2026-10-05', plannedEnd: '2026-10-14' });
  Store.addEpic({ key: 'B', title: 'Через неделю', hle: 3, plannedStart: '2026-10-05', plannedEnd: '2026-10-20' });
  Store.addEpic({ key: 'C', title: 'Через две', hle: 3, plannedStart: '2026-10-05', plannedEnd: '2026-10-28' });
  Store.addEpic({ key: 'D', title: 'Закрыт', hle: 3, status: 'done', plannedStart: '2026-10-05', plannedEnd: '2026-10-15' });

  const soon = collect(app).find(i => i.id === 'epics-due-soon');
  assert.deepEqual(soon.epics.map(e => e.key), ['A', 'B'], 'отсортированы по сроку, закрытые не считаются');
});

test('просроченный эпик — ошибка и стоит выше предупреждений', () => {
  const app = loadApp();
  const { Store } = app;
  Store.addEpic({ key: 'A', title: 'Скоро', hle: 3, plannedStart: '2026-10-05', plannedEnd: '2026-10-16' });
  Store.addEpic({ key: 'B', title: 'Просрочен', hle: 3, plannedStart: '2026-09-28', plannedEnd: '2026-10-09' });

  const items = collect(app);
  assert.deepEqual(ids(items), ['epics-overdue', 'epics-due-soon']);
  assert.equal(items[0].level, 'err');
});

test('без HLE ругаемся только на эпики в работе или в плане, бэклог не трогаем', () => {
  const app = loadApp();
  const { Store } = app;
  Store.addEpic({ key: 'BACKLOG', title: 'Идея' });
  Store.addEpic({ key: 'DEV', title: 'В разработке', status: 'development' });
  Store.addEpic({ key: 'PLAN', title: 'С датами', plannedStart: '2026-11-02', plannedEnd: '2026-11-13' });

  const noHle = collect(app).find(i => i.id === 'epics-no-hle');
  assert.deepEqual(noHle.epics.map(e => e.key).sort(), ['DEV', 'PLAN']);
});

test('в очереди на ближайшие недели без груминга — предупреждение, через месяц — ещё нет', () => {
  const app = loadApp();
  const { Store } = app;
  const near = Store.addEpic({ key: 'NEAR', title: 'Скоро', status: 'requirements' });
  const far = Store.addEpic({ key: 'FAR', title: 'Нескоро', status: 'requirements' });
  Store.setEpicQueue(near.id, '2026-10-19', 1);
  Store.setEpicQueue(far.id, '2026-11-16', 1);

  const item = collect(app).find(i => i.id === 'queue-ungroomed');
  assert.deepEqual(item.epics.map(e => e.key), ['NEAR']);
});

test('расхождение очереди и Planned-дат — только когда заданы оба и не совпадают', () => {
  const app = loadApp();
  const { Store, Epics } = app;
  const same = Store.addEpic({ key: 'SAME', title: 'Совпадает', hle: 5, plannedStart: '2026-10-19', plannedEnd: '2026-10-30' });
  const diff = Store.addEpic({ key: 'DIFF', title: 'Разъехался', hle: 5, plannedStart: '2026-10-19', plannedEnd: '2026-10-30' });
  const onlyQueue = Store.addEpic({ key: 'Q', title: 'Только очередь', hle: 5 });
  Store.addEpic({ key: 'P', title: 'Только даты', hle: 5, plannedStart: '2026-11-02', plannedEnd: '2026-11-06' });
  Store.setEpicQueue(same.id, '2026-10-19', 2);
  Store.setEpicQueue(diff.id, '2026-10-26', 2);
  Store.setEpicQueue(onlyQueue.id, '2026-10-19', 1);

  assert.deepEqual(Epics.planMismatch(Store.epics()).map(e => e.key), ['DIFF']);
  const item = collect(app).find(i => i.id === 'queue-plan-mismatch');
  assert.equal(item.sync, true);
  assert.equal(item.level, 'info');

  Store.applyQueuePlan(Epics.queueToPlan(Store.epics()).changes);
  assert.equal(Epics.planMismatch(Store.epics()).length, 0, 'после синхронизации расхождений нет');
});

test('спринт: отставание от графика и задачи-долгожители', () => {
  const app = loadApp();
  const { Store } = app;
  const today = Store.today();
  const sprint = Store.createSprint({ name: 'Длинный', startDate: Store.addDays(today, -20), endDate: Store.addDays(today, 20) });
  Store.addTask(sprint.id, { title: 'Долгожитель', points: 5, status: 'progress' });
  Store.addTask(sprint.id, { title: 'Ещё одна', points: 5, status: 'todo' });
  Store.sprintById(sprint.id).tasks[1].carryCount = 2;

  const items = app.Attention.collect({ sprint: Store.sprintById(sprint.id), epics: [], today, mode: 'points' });
  assert.deepEqual(ids(items), ['sprint-behind', 'long-runners']);
});

test('спринт с вышедшим сроком просят закрыть; закрытый и пустой — молчат', () => {
  const app = loadApp();
  const { Store } = app;
  const today = Store.today();
  const old = Store.createSprint({ name: 'Старый', startDate: Store.addDays(today, -30), endDate: Store.addDays(today, -16) });
  Store.addTask(old.id, { title: 'Хвост', points: 3, status: 'todo' });
  const check = s => ids(app.Attention.collect({ sprint: s, epics: [], today, mode: 'points' }));

  assert.deepEqual(check(Store.sprintById(old.id)), ['sprint-expired']);
  assert.deepEqual(check({ ...Store.sprintById(old.id), status: 'archived' }), []);
  assert.deepEqual(check(Store.createSprint({ name: 'Пустой', startDate: today, endDate: Store.addDays(today, 13) })), []);
});

test('когда всё хорошо — список пуст', () => {
  const app = loadApp();
  app.Store.addEpic({ key: 'OK', title: 'Норм', hle: 5, status: 'ready_for_dev', plannedStart: '2026-11-02', plannedEnd: '2026-11-13' });
  assert.deepEqual(collect(app), []);
});
