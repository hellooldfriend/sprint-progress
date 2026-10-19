/* Задачи: статусы, флаги Unplanned / «Не закроем», перенос, массовое обновление */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeSprint } = require('./helpers/load');

function setup(tasks) {
  const app = loadApp();
  const sprint = makeSprint(app, { tasks });
  return { ...app, sprint, sid: sprint.id };
}
const byKey = (Store, sid, key) => Store.sprintById(sid).tasks.find(t => t.key === key);

test('новая задача получает разумные значения по умолчанию', () => {
  const { Store, sid } = setup([]);
  const t = Store.addTask(sid, { title: 'Задача', points: 3, status: 'todo' });
  assert.equal(t.unplanned, false);
  assert.equal(t.dropped, false);
  assert.equal(t.carryCount, 0);
  assert.equal(t.doneAt, null);
  assert.equal(t.droppedAt, null);
  assert.equal(t.carriedFrom, null);
  assert.equal(t.carriedTo, null);
});

test('оценка нормализуется, ключ приводится к верхнему регистру', () => {
  const { Store, sid } = setup([]);
  assert.equal(Store.addTask(sid, { title: 'A', points: '' }).points, null);
  assert.equal(Store.addTask(sid, { title: 'B', points: 'не число' }).points, null);
  assert.equal(Store.addTask(sid, { title: 'C', points: -5 }).points, 0);
  assert.equal(Store.addTask(sid, { title: 'D', key: 'dev-7' }).key, 'DEV-7');
});

test('doneAt проставляется при входе в Done и снимается при выходе', () => {
  const { Store, sid } = setup([{ key: 'A-1', points: 3 }]);
  const id = byKey(Store, sid, 'A-1').id;

  Store.setTaskStatus(sid, id, 'done');
  const doneAt = byKey(Store, sid, 'A-1').doneAt;
  assert.ok(doneAt, 'дата закрытия появилась');

  Store.setTaskStatus(sid, id, 'review');
  assert.equal(byKey(Store, sid, 'A-1').doneAt, null, 'вышли из Done — дата снята');
});

test('повторный вход в Done не перетирает исходную дату закрытия', () => {
  const { Store, sid } = setup([{ key: 'A-1' }]);
  const id = byKey(Store, sid, 'A-1').id;
  Store.setTaskStatus(sid, id, 'done');
  const first = byKey(Store, sid, 'A-1').doneAt;
  Store.updateTask(sid, id, { title: 'Переименована' });
  assert.equal(byKey(Store, sid, 'A-1').doneAt, first);
});

test('стрелки статусов упираются в края, а не выходят за них', () => {
  const { Store, sid } = setup([{ key: 'A-1', status: 'backlog' }]);
  const id = byKey(Store, sid, 'A-1').id;

  Store.shiftTaskStatus(sid, id, -1);
  assert.equal(byKey(Store, sid, 'A-1').status, 'backlog', 'левее Backlog некуда');

  Store.STATUS_IDS.forEach(() => Store.shiftTaskStatus(sid, id, 1));
  assert.equal(byKey(Store, sid, 'A-1').status, 'done', 'правее Done некуда');

  Store.shiftTaskStatus(sid, id, -1);
  assert.equal(byKey(Store, sid, 'A-1').status, 'deploy', 'порядок колонок соблюдён');
});

test('снятие со спринта ставит дату и причину, возврат — очищает', () => {
  const { Store, sid } = setup([{ key: 'A-1', points: 5 }]);
  const id = byKey(Store, sid, 'A-1').id;

  Store.toggleTaskDropped(sid, id, 'blocked');
  let t = byKey(Store, sid, 'A-1');
  assert.equal(t.dropped, true);
  assert.equal(t.dropReason, 'blocked');
  assert.ok(t.droppedAt);

  Store.toggleTaskDropped(sid, id);
  t = byKey(Store, sid, 'A-1');
  assert.equal(t.dropped, false);
  assert.equal(t.droppedAt, null);
  assert.equal(t.carriedTo, null);
});

test('перевод снятой задачи в Done снимает флаг: закрыть и снять одновременно нельзя', () => {
  const { Store, sid } = setup([{ key: 'A-1', points: 5 }]);
  const id = byKey(Store, sid, 'A-1').id;
  Store.toggleTaskDropped(sid, id, 'carry');
  Store.setTaskStatus(sid, id, 'done');

  const t = byKey(Store, sid, 'A-1');
  assert.equal(t.dropped, false);
  assert.equal(t.droppedAt, null);
  assert.ok(t.doneAt);
});

test('неизвестная причина снятия схлопывается в перенос', () => {
  const { Store, sid } = setup([{ key: 'A-1' }]);
  const id = byKey(Store, sid, 'A-1').id;
  Store.updateTask(sid, id, { dropped: true, dropReason: 'что-то своё' });
  assert.equal(byKey(Store, sid, 'A-1').dropReason, 'carry');
});

test('массовое добавление обновляет по номеру, а не плодит дубли', () => {
  const { Store, sid } = setup([]);
  Store.addTasksBulk(sid, 'DEV-1 "Первая" Задача "To Do" 3', {});
  const res = Store.addTasksBulk(sid, 'DEV-1 "Первая переименована" Задача Готово 8\nDEV-2 "Вторая" Задача "To Do" 2', {});

  assert.deepEqual({ added: res.added, updated: res.updated }, { added: 1, updated: 1 });
  assert.equal(Store.sprintById(sid).tasks.length, 2);
  const first = byKey(Store, sid, 'DEV-1');
  assert.equal(first.title, 'Первая переименована');
  assert.equal(first.points, 8);
  assert.equal(first.status, 'done');
});

test('повторный импорт не трогает локальные флаги существующих задач', () => {
  // Регрессия: unplanned собирался через ||, и повторная заливка с флагом
  // Unplanned помечала внеплановыми вообще все задачи спринта
  const { Store, sid } = setup([]);
  Store.addTasksBulk(sid, 'DEV-1 "Плановая" Задача "To Do" 3', { unplanned: false });
  const id = byKey(Store, sid, 'DEV-1').id;
  Store.updateTask(sid, id, { dropped: true, dropReason: 'blocked' });

  Store.addTasksBulk(sid, 'DEV-1 "Плановая" Задача "В процессе" 3\nDEV-9 "Новая" Задача "To Do" 1', { unplanned: true });

  const old = byKey(Store, sid, 'DEV-1');
  assert.equal(old.unplanned, false, 'существующая задача осталась плановой');
  assert.equal(old.dropped, true, 'флаг «не закроем» пережил импорт');
  assert.equal(old.status, 'progress', 'а статус из выгрузки применился');
  assert.equal(byKey(Store, sid, 'DEV-9').unplanned, true, 'новая задача получила флаг из настроек импорта');
});

test('пустая оценка в выгрузке не затирает уже проставленную', () => {
  const { Store, sid } = setup([]);
  Store.addTasksBulk(sid, 'DEV-1 "Задача" Задача "To Do" 5', {});
  Store.addTasksFromItems(sid, [{ key: 'DEV-1', title: 'Задача', points: null, status: 'todo' }]);
  assert.equal(byKey(Store, sid, 'DEV-1').points, 5);
});

test('дата закрытия из выгрузки важнее момента импорта', () => {
  const { Store, sid } = setup([]);
  const doneAt = '2026-08-22T13:10:00.000Z';
  Store.addTasksFromItems(sid, [{ key: 'DEV-1', title: 'Закрыта', points: 5, status: 'done', doneAt }]);
  assert.equal(byKey(Store, sid, 'DEV-1').doneAt, doneAt);
});

test('задачи без номера не склеиваются между собой', () => {
  const { Store, sid } = setup([]);
  Store.addTasksBulk(sid, 'Первая\nВторая', {});
  Store.addTasksBulk(sid, 'Первая\nВторая', {});
  assert.equal(Store.sprintById(sid).tasks.length, 4, 'без ключа сопоставлять не по чему');
});

test('удаление задачи убирает её из спринта', () => {
  const { Store, sid } = setup([{ key: 'A-1' }, { key: 'A-2' }]);
  Store.deleteTask(sid, byKey(Store, sid, 'A-1').id);
  assert.deepEqual(Store.sprintById(sid).tasks.map(t => t.key), ['A-2']);
});

test('удалить все задачи спринта — спринт остаётся, другие не трогаем', () => {
  const app = loadApp();
  const { Store } = app;
  const a = makeSprint(app, { name: 'A', tasks: [{ key: 'A-1', points: 3 }, { key: 'A-2', points: 5, status: 'done' }] });
  const b = makeSprint(app, { name: 'B', tasks: [{ key: 'B-1', points: 2 }] });
  assert.equal(Store.clearSprintTasks(a.id), 2);
  assert.equal(Store.sprintById(a.id).tasks.length, 0);
  assert.ok(Store.sprintById(a.id), 'спринт на месте');
  assert.equal(Store.sprintById(b.id).tasks.length, 1, 'чужой спринт не задет');
  assert.equal(Store.clearSprintTasks(a.id), 0);
  assert.equal(Store.clearSprintTasks('нет такого'), 0);
});

test('Rejected: стрелки его не трогают, снять отклонённую нельзя, переносить незачем', () => {
  const app = loadApp();
  const { Store } = app;
  const sprint = makeSprint(app, { tasks: [
    { key: 'A-1', status: 'done' },
    { key: 'A-2', status: 'rejected' },
    { key: 'A-3', status: 'todo', dropped: true, dropReason: 'carry' },
  ]});
  const byKey = key => Store.sprintById(sprint.id).tasks.find(t => t.key === key);
  const [done, rejected, dropped] = ['A-1', 'A-2', 'A-3'].map(byKey);

  Store.shiftTaskStatus(sprint.id, done.id, 1);
  assert.equal(done.status, 'done', 'из Done стрелкой вправо в Rejected не попасть');
  assert.equal(Store.shiftTaskStatus(sprint.id, rejected.id, -1), null);
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.rejectedAt, 'день отклонения запомнен');

  Store.setTaskStatus(sprint.id, dropped.id, 'rejected');
  assert.equal(dropped.dropped, false, 'отклонённая задача не может быть ещё и снятой');
  assert.ok(dropped.rejectedAt);

  Store.setTaskStatus(sprint.id, dropped.id, 'todo');
  assert.equal(dropped.rejectedAt, null, 'вернули в работу — дата отклонения сброшена');

  assert.ok(!Store.carryCandidates(sprint.id).some(t => t.id === rejected.id));
});
