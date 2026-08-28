/* Спринты: жизненный цикл, перенос задач при закрытии, импорт/экспорт состояния */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeSprint } = require('./helpers/load');

const byKey = (Store, sid, key) => Store.sprintById(sid).tasks.find(t => t.key === key);

test('первый запуск — пустое состояние без демо-данных', () => {
  const { Store } = loadApp();
  assert.deepEqual(Store.sprints(), []);
  assert.equal(Store.activeSprint(), null);
});

test('созданный спринт становится текущим', () => {
  const app = loadApp();
  const s = makeSprint(app, { name: 'Спринт 24' });
  assert.equal(app.Store.activeSprint().id, s.id);
  assert.equal(s.status, 'active');
});

test('архивация и возврат в работу переключают статус', () => {
  const app = loadApp();
  const s = makeSprint(app);
  app.Store.archiveSprint(s.id);
  assert.equal(app.Store.sprintById(s.id).status, 'archived');
  assert.ok(app.Store.sprintById(s.id).archivedAt);

  app.Store.reopenSprint(s.id);
  assert.equal(app.Store.sprintById(s.id).status, 'active');
  assert.equal(app.Store.sprintById(s.id).archivedAt, null);
});

test('удаление текущего спринта переводит выбор на другой', () => {
  const app = loadApp();
  const first = makeSprint(app, { name: 'Первый' });
  const second = makeSprint(app, { name: 'Второй' });
  app.Store.deleteSprint(second.id);
  assert.equal(app.Store.activeSprint().id, first.id);

  app.Store.deleteSprint(first.id);
  assert.equal(app.Store.activeSprint(), null, 'спринтов не осталось');
});

test('sortedSprints отдаёт свежие спринты первыми', () => {
  const app = loadApp();
  makeSprint(app, { name: 'Старый', startOffset: -30 });
  makeSprint(app, { name: 'Новый', startOffset: 0 });
  assert.deepEqual(app.Store.sortedSprints().map(s => s.name), ['Новый', 'Старый']);
});

test('к переносу предлагается всё незакрытое, кроме отменённого', () => {
  const app = loadApp();
  const s = makeSprint(app, { tasks: [
    { key: 'A-1', status: 'done' },
    { key: 'A-2', status: 'progress' },
    { key: 'A-3', status: 'todo', dropped: true, dropReason: 'cancelled' },
    { key: 'A-4', status: 'todo', dropped: true, dropReason: 'carry' },
  ]});
  const keys = app.Store.carryCandidates(s.id).map(t => t.key);
  assert.deepEqual(keys.sort(), ['A-2', 'A-4'], 'закрытое и отменённое не предлагаем');
});

test('перенос помечает исходную задачу и создаёт копию с остаточной оценкой', () => {
  const app = loadApp();
  const { Store } = app;
  const from = makeSprint(app, { name: 'Спринт 24', tasks: [
    { key: 'DEV-2', title: 'Миграция БД', points: 13, status: 'progress', assignee: 'Марат', type: 'Задача' },
  ]});
  const to = makeSprint(app, { name: 'Спринт 25', startOffset: 14 });
  const src = byKey(Store, from.id, 'DEV-2');

  const moved = Store.carryTasks(from.id, to.id, [{ taskId: src.id, points: 8 }]);
  assert.equal(moved, 1);

  const left = byKey(Store, from.id, 'DEV-2');
  assert.equal(left.dropped, true);
  assert.equal(left.dropReason, 'carry');
  assert.equal(left.points, 13, 'в закрытом спринте остаётся исходная оценка');
  assert.equal(left.carriedTo.name, 'Спринт 25');

  const arrived = byKey(Store, to.id, 'DEV-2');
  assert.equal(arrived.points, 8, 'в новый спринт едет остаток');
  assert.equal(arrived.status, 'progress', 'стадия работы сохраняется');
  assert.equal(arrived.assignee, 'Марат');
  assert.equal(arrived.carryCount, 1);
  assert.equal(arrived.carriedFrom.name, 'Спринт 24');
  assert.equal(arrived.unplanned, false, 'перенос — плановая работа нового спринта');
});

test('счётчик переносов растёт от спринта к спринту', () => {
  const app = loadApp();
  const { Store } = app;
  let current = makeSprint(app, { name: 'Спринт 1', tasks: [{ key: 'DEV-1', points: 5, status: 'todo' }] });

  for (let i = 2; i <= 4; i++) {
    const next = makeSprint(app, { name: `Спринт ${i}`, startOffset: 14 * (i - 1) });
    const task = byKey(Store, current.id, 'DEV-1');
    Store.carryTasks(current.id, next.id, [{ taskId: task.id, points: null }]);
    Store.archiveSprint(current.id);
    current = Store.sprintById(next.id);
  }

  const t = byKey(Store, current.id, 'DEV-1');
  assert.equal(t.carryCount, 3, 'задача едет четвёртый спринт');
  assert.equal(t.points, 5, 'без явной оценки переносится прежняя');
  assert.equal(app.Metrics.sprintMetrics(current).longRunners, 1);
});

test('перенос без указания оценки сохраняет исходную', () => {
  const app = loadApp();
  const { Store } = app;
  const from = makeSprint(app, { tasks: [{ key: 'A-1', points: 3, status: 'todo' }] });
  const to = makeSprint(app, { name: 'Следующий', startOffset: 14 });
  Store.carryTasks(from.id, to.id, [{ taskId: byKey(Store, from.id, 'A-1').id, points: null }]);
  assert.equal(byKey(Store, to.id, 'A-1').points, 3);
});

test('перенос в тот же спринт и перенос закрытой задачи игнорируются', () => {
  const app = loadApp();
  const { Store } = app;
  const s = makeSprint(app, { tasks: [{ key: 'A-1', status: 'done' }, { key: 'A-2', status: 'todo' }] });
  const other = makeSprint(app, { name: 'Другой', startOffset: 14 });

  assert.equal(Store.carryTasks(s.id, s.id, [{ taskId: byKey(Store, s.id, 'A-2').id }]), 0);
  assert.equal(Store.carryTasks(s.id, other.id, [{ taskId: byKey(Store, s.id, 'A-1').id }]), 0);
  assert.equal(Store.sprintById(other.id).tasks.length, 0);
});

test('состояние переживает сохранение и чтение из хранилища', () => {
  const app = loadApp();
  makeSprint(app, { name: 'Спринт 24', tasks: [{ key: 'A-1', points: 5, status: 'done' }] });

  const raw = app.storage.getItem('sprint-progress:v1');
  const restored = app.Store.parseImport(raw);
  assert.equal(restored.sprints.length, 1);
  assert.equal(restored.sprints[0].tasks[0].points, 5);
  assert.equal(restored.sprints[0].tasks[0].status, 'done');
});

test('импорт чинит битые и неполные данные вместо падения', () => {
  const { Store } = loadApp();
  const state = Store.parseImport(JSON.stringify({
    sprints: [{
      name: 'Кривой спринт',
      startDate: 'не дата',
      tasks: [
        { title: 'Без статуса' },
        { title: 'Плохой статус', status: 'какой-то', points: 'много' },
        null,
      ],
    }],
  }));

  const sprint = state.sprints[0];
  assert.match(sprint.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Store.diffDays(sprint.startDate, sprint.endDate), Store.SPRINT_DEFAULT_DAYS - 1);
  assert.equal(sprint.tasks.length, 2, 'null-задачи отброшены');
  assert.equal(sprint.tasks[0].status, 'todo');
  assert.equal(sprint.tasks[1].status, 'todo', 'неизвестный статус заменён');
  assert.equal(sprint.tasks[1].points, null, 'нечисловая оценка обнулена');
});

test('импорт старого бэкапа без полей переноса и снятия', () => {
  const { Store } = loadApp();
  const state = Store.parseImport(JSON.stringify({
    sprints: [{ name: 'Старый', startDate: '2026-08-10', endDate: '2026-08-23',
      tasks: [{ title: 'Задача', status: 'progress', points: 3 }] }],
  }));
  const t = state.sprints[0].tasks[0];
  assert.equal(t.dropped, false);
  assert.equal(t.dropReason, 'carry');
  assert.equal(t.carryCount, 0);
  assert.equal(t.carriedFrom, null);
  assert.equal(t.key, '');
});

test('настройки нормализуются при импорте, включая состояние панели', () => {
  const { Store } = loadApp();
  const state = Store.parseImport(JSON.stringify({
    sprints: [],
    settings: { metricMode: 'tasks', chartMode: 'burnup', sidebarCollapsed: 1,
                statusMap: { 'Ожидает Релиза': 'deploy', 'Мимо': 'нет такой колонки' } },
  }));

  assert.equal(state.settings.metricMode, 'tasks');
  assert.equal(state.settings.chartMode, 'burnup');
  assert.equal(state.settings.sidebarCollapsed, true, 'приводится к булеву');
  assert.deepEqual(state.settings.statusMap, { 'ожидает релиза': 'deploy' },
    'ключ нормализуется, несуществующая колонка отбрасывается');

  const bare = Store.parseImport(JSON.stringify({ sprints: [] }));
  assert.deepEqual(bare.settings, {
    metricMode: 'points', chartMode: 'burndown', statusMap: {}, csvMapping: null,
    sidebarCollapsed: false, taskBaseUrl: '', summaryWithTasks: false, summaryWithPeople: false,
  });
});

test('импорт мусора отклоняется с понятной ошибкой', () => {
  const { Store } = loadApp();
  assert.throws(() => Store.parseImport('{"foo":1}'), /не похож на бэкап/);
  assert.throws(() => Store.parseImport('не json'), SyntaxError);
});

test('конец спринта не может быть раньше начала', () => {
  const { Store } = loadApp();
  const state = Store.parseImport(JSON.stringify({
    sprints: [{ name: 'Задом наперёд', startDate: '2026-08-20', endDate: '2026-08-10', tasks: [] }],
  }));
  assert.equal(state.sprints[0].endDate, '2026-08-20');
});

test('адрес задачи собирается из базы и номера', () => {
  const { Store } = loadApp();
  Store.setSetting('taskBaseUrl', 'jira.com');
  assert.equal(Store.taskUrl('DEV-123'), 'https://jira.com/DEV-123', 'схема дописывается');

  Store.setSetting('taskBaseUrl', 'https://jira.company.com/browse/');
  assert.equal(Store.taskUrl('DEV-1'), 'https://jira.company.com/browse/DEV-1', 'лишний слэш убирается');

  Store.setSetting('taskBaseUrl', 'jira.com');
  assert.equal(Store.taskUrl('ПРО-7'), 'https://jira.com/ПРО-7', 'кириллица остаётся читаемой');

  assert.equal(Store.taskUrl(''), '', 'без номера ссылки нет');
  Store.setSetting('taskBaseUrl', '');
  assert.equal(Store.taskUrl('DEV-1'), '', 'без базы ссылки нет');
});

test('настройки сводки переживают импорт', () => {
  const { Store } = loadApp();
  const state = Store.parseImport(JSON.stringify({
    sprints: [],
    settings: { taskBaseUrl: '  jira.com/browse  ', summaryWithTasks: 1, summaryWithPeople: 0 },
  }));
  assert.equal(state.settings.taskBaseUrl, 'jira.com/browse');
  assert.equal(state.settings.summaryWithTasks, true);
  assert.equal(state.settings.summaryWithPeople, false);
});
