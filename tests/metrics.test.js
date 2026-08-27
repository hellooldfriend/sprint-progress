/* Метрики спринта: planned/unplanned, снятое, перенос, проценты и темп */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeSprint } = require('./helpers/load');

/** Спринт на 40 SP: 10 закрыто, 10 в работе, 20 не начато (5 из них — внеплановые). */
function baseSprint(app) {
  return makeSprint(app, { startOffset: -6, tasks: [
    { key: 'A-1', points: 10, status: 'done' },
    { key: 'A-2', points: 10, status: 'progress' },
    { key: 'A-3', points: 15, status: 'todo' },
    { key: 'A-4', points: 5,  status: 'todo', unplanned: true },
  ]});
}

test('базовые суммы: объём, планово, внепланово, закрыто', () => {
  const app = loadApp();
  const m = app.Metrics.sprintMetrics(baseSprint(app));

  assert.equal(m.totalPoints, 40);
  assert.equal(m.plannedPoints, 35);
  assert.equal(m.unplannedPoints, 5);
  assert.equal(m.donePoints, 10);
  assert.equal(m.remainingPoints, 30);
  assert.equal(m.notDonePoints, 30);
  assert.equal(m.velocity, 10, 'velocity — это SP в Done');
});

test('проценты считаются отдельно по задачам и по story points', () => {
  const app = loadApp();
  const m = app.Metrics.sprintMetrics(baseSprint(app));
  assert.equal(m.pctPoints, 25, '10 из 40 SP');
  assert.equal(m.pctTasks, 25, '1 из 4 задач');
  assert.equal(m.unplannedSharePoints, 13, '5 из 40 SP округляется до 13%');
});

test('«в работе» — это от In Progress до Deploy, без Backlog и Done', () => {
  const app = loadApp();
  const m = app.Metrics.sprintMetrics(makeSprint(app, { tasks: [
    { points: 1, status: 'backlog' }, { points: 2, status: 'todo' },
    { points: 4, status: 'progress' }, { points: 8, status: 'review' },
    { points: 16, status: 'ready_to_test' }, { points: 32, status: 'testing' },
    { points: 64, status: 'deploy' }, { points: 128, status: 'done' },
  ]}));
  assert.equal(m.inProgressPoints, 4 + 8 + 16 + 32 + 64);
  assert.equal(m.byStatus.deploy.count, 1);
  assert.equal(m.byStatus.done.points, 128);
});

test('снятое уходит из remaining, но остаётся в объёме обязательства', () => {
  const app = loadApp();
  const sprint = baseSprint(app);
  const a3 = sprint.tasks.find(t => t.key === 'A-3');
  app.Store.toggleTaskDropped(sprint.id, a3.id, 'carry');

  const m = app.Metrics.sprintMetrics(app.Store.sprintById(sprint.id));
  assert.equal(m.totalPoints, 40, 'объём не уменьшился');
  assert.equal(m.droppedPoints, 15);
  assert.equal(m.remainingPoints, 15, '40 − 10 закрытых − 15 снятых');
  assert.equal(m.notDonePoints, 30, 'не сделано — это всё, что не в Done');
  assert.equal(m.pctPoints, 25, 'снятием задач процент закрытия не накрутить');
});

test('снятое не считается «в работе»', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { tasks: [{ points: 8, status: 'progress', dropped: true }] });
  assert.equal(app.Metrics.sprintMetrics(sprint).inProgressPoints, 0);
});

test('разбивка снятого по причинам', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { tasks: [
    { key: 'A-1', points: 8, dropped: true, dropReason: 'carry' },
    { key: 'A-2', points: 3, dropped: true, dropReason: 'carry' },
    { key: 'A-3', points: 5, dropped: true, dropReason: 'cancelled' },
    { key: 'A-4', points: 2 },
  ]});
  const m = app.Metrics.sprintMetrics(sprint);
  assert.equal(m.droppedPoints, 16);
  assert.deepEqual(m.dropByReason.map(r => [r.id, r.points]), [['carry', 11], ['cancelled', 5]]);
});

test('перенос: сколько взяли долга и куда отдали несделанное', () => {
  const app = loadApp();
  const { Store, Metrics } = app;
  const from = makeSprint(app, { name: 'Спринт 24', tasks: [
    { key: 'A-1', points: 10, status: 'done' },
    { key: 'A-2', points: 13, status: 'progress' },
    { key: 'A-3', points: 3,  status: 'todo' },
  ]});
  const to = makeSprint(app, { name: 'Спринт 25', startOffset: 14 });
  const tasks = Store.sprintById(from.id).tasks;
  Store.carryTasks(from.id, to.id, [
    { taskId: tasks.find(t => t.key === 'A-2').id, points: 8 },
    { taskId: tasks.find(t => t.key === 'A-3').id, points: null },
  ]);

  const closed = Metrics.sprintMetrics(Store.sprintById(from.id));
  assert.equal(closed.notDonePoints, 16, 'не сделали 16 SP своего объёма');
  assert.equal(closed.carriedOutPoints, 16);
  assert.deepEqual(closed.carryDestinations, [{ name: 'Спринт 25', count: 2, points: 16 }]);

  const next = Metrics.sprintMetrics(Store.sprintById(to.id));
  assert.equal(next.carriedPoints, 11, 'новый спринт взял 8 + 3 остатка');
  assert.equal(next.carriedSharePoints, 100);
  assert.equal(next.longRunners, 0, 'один перенос долгожителем ещё не делает');
});

test('долгожители — это задачи, которые едут третий спринт и дольше', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { tasks: [{ points: 5 }, { points: 3 }, { points: 1 }] });
  const tasks = app.Store.sprintById(sprint.id).tasks;
  tasks[0].carryCount = 1;
  tasks[1].carryCount = 2;
  tasks[2].carryCount = 5;

  const m = app.Metrics.sprintMetrics(app.Store.sprintById(sprint.id));
  assert.equal(m.longRunners, 2);
  assert.equal(m.maxCarryCount, 5);
});

test('темп и требуемая скорость считаются от прошедших и оставшихся дней', () => {
  const app = loadApp();
  // Спринт начался 4 дня назад: прошло 5 дней из 14, осталось 9
  const sprint = makeSprint(app, { startOffset: -4, tasks: [
    { points: 10, status: 'done' }, { points: 20, status: 'todo' },
  ]});
  const m = app.Metrics.sprintMetrics(sprint);

  assert.equal(m.elapsedDays, 5);
  assert.equal(m.daysLeft, 9);
  assert.equal(m.totalDays, 14);
  assert.equal(m.timePct, 36);
  assert.equal(m.pacePoints, 2, '10 SP за 5 дней');
  assert.ok(Math.abs(m.needPoints - 20 / 9) < 1e-9, 'остаток делится на оставшиеся дни');
});

test('ещё не начавшийся и уже закончившийся спринт не ломают счёт дней', () => {
  const app = loadApp();
  const future = app.Metrics.sprintMetrics(makeSprint(app, { startOffset: 5 }));
  assert.equal(future.elapsedDays, 0);
  assert.equal(future.daysLeft, 14);
  assert.equal(future.pacePoints, 0, 'делить на ноль дней не пытаемся');

  const past = app.Metrics.sprintMetrics(makeSprint(app, { startOffset: -30, name: 'Прошлый' }));
  assert.equal(past.daysLeft, 0);
  assert.equal(past.elapsedDays, 14, 'прошедшие дни не выходят за длину спринта');
});

test('пустой спринт даёт нули, а не деление на ноль', () => {
  const app = loadApp();
  const m = app.Metrics.sprintMetrics(makeSprint(app, { tasks: [] }));
  assert.equal(m.isEmpty, true);
  assert.equal(m.pctPoints, 0);
  assert.equal(m.pctTasks, 0);
  assert.equal(m.velocity, 0);
  assert.equal(m.unplannedSharePoints, 0);
});

test('задачи без оценки считаются в штуках, но не в SP', () => {
  const app = loadApp();
  const m = app.Metrics.sprintMetrics(makeSprint(app, { tasks: [
    { points: null, status: 'done' }, { points: null, status: 'todo' },
  ]}));
  assert.equal(m.totalPoints, 0);
  assert.equal(m.pctPoints, 0, 'по SP считать нечего');
  assert.equal(m.pctTasks, 50, 'а по задачам — половина');
});

test('inMode переключает единицы измерения', () => {
  const app = loadApp();
  const m = app.Metrics.sprintMetrics(baseSprint(app));
  const points = app.Metrics.inMode(m, 'points');
  const tasks = app.Metrics.inMode(m, 'tasks');

  assert.deepEqual([points.total, points.done, points.unit], [40, 10, 'SP']);
  assert.deepEqual([tasks.total, tasks.done, tasks.unit], [4, 1, 'задач']);
  assert.equal(tasks.planned, 3);
});

test('форматирование чисел и склонения', () => {
  const { Metrics } = loadApp();
  assert.equal(Metrics.fmt(12), '12');
  assert.equal(Metrics.fmt(12.5), '12.5');
  assert.equal(Metrics.fmt(12.34), '12.3');
  assert.equal(Metrics.fmt(null), '0');
  assert.equal(Metrics.fmt(NaN), '0');

  assert.equal(Metrics.plural(1, 'задача', 'задачи', 'задач'), 'задача');
  assert.equal(Metrics.plural(3, 'задача', 'задачи', 'задач'), 'задачи');
  assert.equal(Metrics.plural(5, 'задача', 'задачи', 'задач'), 'задач');
  assert.equal(Metrics.plural(11, 'задача', 'задачи', 'задач'), 'задач', '11 — исключение');
  assert.equal(Metrics.plural(21, 'задача', 'задачи', 'задач'), 'задача');
  assert.equal(Metrics.plural(0, 'задача', 'задачи', 'задач'), 'задач');
});

test('pct округляет и не делит на ноль', () => {
  const { Metrics } = loadApp();
  assert.equal(Metrics.pct(1, 3), 33);
  assert.equal(Metrics.pct(2, 3), 67);
  assert.equal(Metrics.pct(5, 0), 0);
});
