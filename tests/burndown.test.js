/* Серии для burn-down / burn-up: история восстанавливается из дат задач */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeSprint, dayOfSprint } = require('./helpers/load');

/** Спринт, начавшийся 5 дней назад, чтобы «сегодня» приходилось на 6-й день. */
function runningSprint(app, tasks) {
  return makeSprint(app, { startOffset: -5, tasks });
}

test('ряд дней покрывает спринт целиком, будущее — null', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [{ points: 10, status: 'todo' }]);
  const s = app.Metrics.burnSeries(sprint, 'points');

  assert.equal(s.days.length, 14);
  assert.equal(s.days[0], sprint.startDate);
  assert.equal(s.days[13], sprint.endDate);
  assert.equal(s.todayIdx, 5, 'сегодня — шестой день спринта');
  assert.equal(s.remaining[5], 10, 'до сегодня линия есть');
  assert.equal(s.remaining[6], null, 'завтра линии нет');
  assert.equal(s.completed[6], null);
  assert.equal(s.scope[6], 10, 'а объём известен на весь спринт');
});

test('плановые задачи в объёме с первого дня, даже если заведены в середине спринта', () => {
  const app = loadApp();
  // createdAt = сейчас, то есть шестой день спринта — но задача плановая
  const sprint = runningSprint(app, [{ points: 20, status: 'todo' }]);
  const s = app.Metrics.burnSeries(sprint, 'points');
  assert.equal(s.scope[0], 20, 'импорт в середине спринта не создаёт ступеньку');
  assert.equal(s.startScope, 20);
});

test('внеплановая задача входит в объём в день появления', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [{ key: 'A-1', points: 10, status: 'todo' }]);
  const born = dayOfSprint(app.Store, sprint, 3);
  app.Store.addTask(sprint.id, { key: 'A-2', title: 'Прилетело', points: 5, status: 'todo', unplanned: true });
  app.Store.sprintById(sprint.id).tasks.find(t => t.key === 'A-2').createdAt = born;

  const s = app.Metrics.burnSeries(app.Store.sprintById(sprint.id), 'points');
  assert.deepEqual(s.scope.slice(0, 6), [10, 10, 10, 15, 15, 15], 'объём вырос на третий день');
});

test('закрытие задач опускает линию остатка по датам doneAt', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [
    { key: 'A-1', points: 10, status: 'done' },
    { key: 'A-2', points: 20, status: 'done' },
    { key: 'A-3', points: 10, status: 'todo' },
  ]);
  const tasks = app.Store.sprintById(sprint.id).tasks;
  tasks.find(t => t.key === 'A-1').doneAt = dayOfSprint(app.Store, sprint, 1);
  tasks.find(t => t.key === 'A-2').doneAt = dayOfSprint(app.Store, sprint, 4);

  const s = app.Metrics.burnSeries(app.Store.sprintById(sprint.id), 'points');
  assert.deepEqual(s.completed.slice(0, 6), [0, 10, 10, 10, 30, 30]);
  assert.deepEqual(s.remaining.slice(0, 6), [40, 30, 30, 30, 10, 10]);
});

test('снятая задача уменьшает объём в день снятия', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [
    { key: 'A-1', points: 30, status: 'todo' },
    { key: 'A-2', points: 10, status: 'todo' },
  ]);
  const t = app.Store.sprintById(sprint.id).tasks.find(x => x.key === 'A-2');
  app.Store.toggleTaskDropped(sprint.id, t.id, 'carry');
  app.Store.sprintById(sprint.id).tasks.find(x => x.key === 'A-2').droppedAt = dayOfSprint(app.Store, sprint, 2);

  const s = app.Metrics.burnSeries(app.Store.sprintById(sprint.id), 'points');
  assert.deepEqual(s.scope.slice(0, 5), [40, 40, 30, 30, 30]);
  assert.deepEqual(s.remaining.slice(0, 5), [40, 40, 30, 30, 30], 'остаток падает вместе с объёмом');
});

test('идеальная линия идёт от стартового объёма до нуля', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [{ points: 26, status: 'todo' }]);
  const s = app.Metrics.burnSeries(sprint, 'points');

  assert.equal(s.ideal[0], 26);
  assert.equal(s.ideal[13], 0);
  assert.equal(s.ideal[6], 14, 'ровно половина пути — половина объёма');
  assert.ok(s.ideal.every((v, i) => i === 0 || v <= s.ideal[i - 1]), 'линия монотонно убывает');
});

test('режим «задачи» считает штуки, а не оценки', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [
    { points: 100, status: 'done' }, { points: 1, status: 'todo' },
  ]);
  const s = app.Metrics.burnSeries(sprint, 'tasks');
  assert.equal(s.scope[0], 2);
  assert.equal(s.completed[5], 1);
  assert.equal(s.remaining[5], 1);
});

test('задача, заведённая до старта спринта, попадает в объём нулевого дня', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [{ key: 'A-1', points: 8, status: 'todo', unplanned: true }]);
  app.Store.sprintById(sprint.id).tasks[0].createdAt = new Date(
    app.Store.parseDate(app.Store.addDays(sprint.startDate, -10))
  ).toISOString();

  const s = app.Metrics.burnSeries(app.Store.sprintById(sprint.id), 'points');
  assert.equal(s.scope[0], 8);
});

test('будущий спринт: линии пустые, но объём известен', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: 3, tasks: [{ points: 5, status: 'todo' }] });
  const s = app.Metrics.burnSeries(sprint, 'points');
  assert.equal(s.todayIdx, -1);
  assert.ok(s.remaining.every(v => v === null));
  assert.equal(s.scope[0], 5);
});

test('пустой спринт не ломает серию', () => {
  const app = loadApp();
  const s = app.Metrics.burnSeries(runningSprint(app, []), 'points');
  assert.equal(s.startScope, 0);
  assert.ok(s.scope.every(v => v === 0));
  assert.ok(s.ideal.every(v => v === 0));
});

test('burnChart отдаёт валидный SVG с осями и точками', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [
    { points: 10, status: 'done' }, { points: 20, status: 'todo' },
  ]);
  const series = app.Metrics.burnSeries(sprint, 'points');

  const down = app.Charts.burnChart(series, 'burndown', 'SP');
  assert.match(down, /^\s*<svg[^>]*viewBox="0 0 760 280"/);
  assert.match(down, /<\/svg>\s*$/);
  assert.ok(down.includes('сегодня'), 'вертикаль текущего дня подписана');
  assert.ok(down.includes('circle'), 'точки данных нарисованы');
  // Оба градиента объявлены всегда — важно, какой из них реально используется
  assert.ok(down.includes('url(#gradDown)'));
  assert.ok(!down.includes('url(#gradUp)'));

  const up = app.Charts.burnChart(series, 'burnup', 'SP');
  assert.ok(up.includes('url(#gradUp)'));
  assert.ok(!up.includes('url(#gradDown)'), 'в burn-up своя заливка');
});

test('в SVG не утекает разметка из названий задач', () => {
  const app = loadApp();
  const sprint = runningSprint(app, [{ title: '<script>alert(1)</script>', points: 5, status: 'done' }]);
  const svg = app.Charts.burnChart(app.Metrics.burnSeries(sprint, 'points'), 'burndown', '<b>SP</b>');
  assert.ok(!svg.includes('<script>'), 'единицы измерения экранируются');
  assert.ok(svg.includes('&lt;b&gt;SP&lt;/b&gt;'));
});

test('velocityChart рисует по столбику на спринт и среднюю линию', () => {
  const app = loadApp();
  const rows = [
    { label: '10.08', title: 'Спринт 23', scope: 40, done: 30, active: false },
    { label: '24.08', title: 'Спринт 24', scope: 45, done: 20, active: false },
    { label: '07.09', title: 'Спринт 25', scope: 30, done: 5,  active: true },
  ];
  const svg = app.Charts.velocityChart(rows, 'SP');

  assert.match(svg, /^\s*<svg[^>]*viewBox="0 0 760 240"/);
  assert.equal((svg.match(/<g opacity=/g) || []).length, 3, 'по группе на спринт');
  assert.equal((svg.match(/<rect /g) || []).length, 6, 'взято и сделано — два столбика на спринт');
  assert.ok(svg.includes('<title>Спринт 24</title>'));
  assert.ok(svg.includes('10.08') && svg.includes('07.09'), 'подписи по оси X');
  assert.ok(svg.includes('среднее 25 SP'), 'среднее считается по закрытым: (30+20)/2');
  assert.ok(svg.includes('opacity="0.45"'), 'идущий спринт приглушён');
});

test('velocityChart не падает на пустых данных и одном спринте', () => {
  const app = loadApp();
  assert.equal(app.Charts.velocityChart([], 'SP'), '');
  const one = app.Charts.velocityChart([{ label: '1.09', title: 'Один', scope: 10, done: 10, active: false }], 'SP');
  assert.match(one, /<svg/);
  assert.ok(one.includes('среднее 10 SP'));
});

test('когда закрытых спринтов нет, среднее считается по всем', () => {
  const app = loadApp();
  const svg = app.Charts.velocityChart([
    { label: 'a', title: 'A', scope: 10, done: 6, active: true },
    { label: 'b', title: 'B', scope: 10, done: 4, active: true },
  ], 'SP');
  assert.ok(svg.includes('среднее 5 SP'), 'иначе делили бы на ноль');
});

test('в подписях столбиков не утекает разметка из названия спринта', () => {
  const app = loadApp();
  const svg = app.Charts.velocityChart(
    [{ label: '<b>', title: '<script>x</script>', scope: 5, done: 5, active: false }], 'SP');
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
});
