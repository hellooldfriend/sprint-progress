/* Текстовая сводка по спринту */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeSprint } = require('./helpers/load');

/** Идущий спринт: 15 из 40 SP закрыто, 6 SP прилетело внепланово. */
function running(app) {
  return makeSprint(app, { name: 'Спринт 24', goal: 'Раскатить онбординг', startOffset: -5, tasks: [
    { key: 'DEV-1', title: 'Дизайн', points: 5, status: 'done' },
    { key: 'DEV-2', title: 'API', points: 10, status: 'done' },
    { key: 'DEV-3', title: 'Миграция', points: 13, status: 'progress' },
    { key: 'DEV-4', title: 'Тесты', points: 6, status: 'todo' },
    { key: 'DEV-5', title: 'Хотфикс', points: 6, status: 'todo', unplanned: true },
  ]});
}

test('сводка идущего спринта: шапка, цель, день и главная цифра', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(running(app));

  const lines = text.split('\n');
  assert.equal(lines[0], 'Спринт 24');
  assert.equal(lines[1], 'Цель: Раскатить онбординг');
  assert.match(lines[2], /день 6 из 14$/);
  assert.ok(text.includes('Закрытие 38% — 15 из 40 SP · 2 из 5 задач'));
});

test('velocity показывается только у закрытого спринта', () => {
  const app = loadApp();
  const sprint = running(app);
  assert.ok(!app.Summary.forSprint(sprint).includes('Velocity'), 'в идущем спринте velocity ещё не итог');

  app.Store.archiveSprint(sprint.id);
  assert.ok(app.Summary.forSprint(app.Store.sprintById(sprint.id)).includes('Velocity 15 SP'));
});

test('идущий спринт описывает состояние: остаток, работа, темп', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(running(app));
  assert.ok(text.includes('Планово 34 SP, внепланово 6 SP — 15% объёма'));
  assert.ok(text.includes('Осталось 25 SP, из них в работе 13 SP'));
  // 15 SP за 6 прошедших дней = 2.5; остаток 25 SP на 8 оставшихся = 3.1
  assert.match(text, /Темп 2\.5 SP\/день, нужно 3\.1 SP\/день — идём примерно по графику/);
  assert.ok(!text.includes('Не сделано'), 'итог подводится только у закрытого спринта');
});

test('закрытый спринт описывает результат и куда ушло несделанное', () => {
  const app = loadApp();
  const { Store, Summary } = app;
  const from = makeSprint(app, { name: 'Спринт 24', startOffset: -20, tasks: [
    { key: 'DEV-1', title: 'Сделали', points: 10, status: 'done' },
    { key: 'DEV-2', title: 'Миграция', points: 13, status: 'progress' },
    { key: 'DEV-3', title: 'Ненужное', points: 5, status: 'todo', dropped: true, dropReason: 'cancelled' },
  ]});
  const to = makeSprint(app, { name: 'Спринт 25', startOffset: -6 });
  const mig = Store.sprintById(from.id).tasks.find(t => t.key === 'DEV-2');
  Store.carryTasks(from.id, to.id, [{ taskId: mig.id, points: 8 }]);
  Store.archiveSprint(from.id);

  const text = Summary.forSprint(Store.sprintById(from.id));
  assert.ok(text.includes('спринт закрыт'));
  assert.ok(text.includes('Не сделано 18 SP: перенесено 13 SP → «Спринт 25», отменено 5 SP'));
  assert.ok(!text.includes('Темп'), 'в закрытом спринте прогноз темпа не нужен');
});

test('полностью закрытый спринт говорит об этом прямо', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -20, tasks: [{ points: 5, status: 'done' }] });
  app.Store.archiveSprint(sprint.id);
  assert.ok(app.Summary.forSprint(app.Store.sprintById(sprint.id)).includes('Закрыли всё, что взяли'));
});

test('долг из прошлых спринтов и долгожители попадают в текст', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'DEV-1', title: 'Миграция', points: 8, status: 'progress' },
    { key: 'DEV-2', title: 'Свежая', points: 5, status: 'todo' },
  ]});
  const tasks = app.Store.sprintById(sprint.id).tasks;
  tasks.find(t => t.key === 'DEV-1').carryCount = 2;

  const text = app.Summary.forSprint(app.Store.sprintById(sprint.id));
  assert.ok(text.includes('Долг из прошлых спринтов: 8 SP'));
  assert.ok(text.includes('Едет третий спринт и дольше: DEV-1 Миграция'));
});

test('без оценок сводка считает задачи, а не story points', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { title: 'Раз', status: 'done' }, { title: 'Два' }, { title: 'Три' },
  ]});
  const text = app.Summary.forSprint(sprint);
  assert.ok(text.includes('Закрытие 33% — 1 из 3 задач'));
  assert.ok(!text.includes('SP'), 'единиц, которых нет, в тексте быть не должно');
});

test('перечень задач добавляется по требованию и помечает статусы', () => {
  const app = loadApp();
  const sprint = running(app);
  const short = app.Summary.forSprint(sprint);
  const long = app.Summary.forSprint(sprint, { withTasks: true });

  assert.ok(!short.includes('Сделано ('));
  assert.ok(long.includes('Сделано (2):'));
  assert.ok(long.includes('  DEV-1 Дизайн — 5 SP'));
  assert.ok(long.includes('Не сделано (3):'));
  assert.ok(long.includes('DEV-3 Миграция — 13 SP (In Progress)'));
  assert.ok(long.includes('DEV-5 Хотфикс — 6 SP (To Do, unplanned)'));
});

test('в перечне видно, что задача снята или перенесена', () => {
  const app = loadApp();
  const { Store, Summary } = app;
  const from = makeSprint(app, { name: 'Спринт 24', tasks: [
    { key: 'DEV-1', title: 'Уехала', points: 3, status: 'todo' },
    { key: 'DEV-2', title: 'Отменена', points: 2, status: 'todo', dropped: true, dropReason: 'cancelled' },
  ]});
  const to = makeSprint(app, { name: 'Спринт 25', startOffset: 14 });
  Store.carryTasks(from.id, to.id, [{ taskId: Store.sprintById(from.id).tasks.find(t => t.key === 'DEV-1').id }]);

  const text = Summary.forSprint(Store.sprintById(from.id), { withTasks: true });
  assert.ok(text.includes('DEV-1 Уехала — 3 SP (перенос → Спринт 25)'));
  assert.ok(text.includes('DEV-2 Отменена — 2 SP (отменена)'));
});

test('пустой спринт и отсутствие спринта не ломают сводку', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(makeSprint(app, { name: 'Пустой', tasks: [] }));
  assert.ok(text.includes('Задач в спринте нет.'));
  assert.ok(!text.includes('Закрытие'));
  assert.equal(app.Summary.forSprint(null), '');
});

test('сводка — это plain text без разметки', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(running(app), { withTasks: true });
  assert.ok(!/[<>*_`|#]/.test(text), 'ни html, ни markdown — вставляется куда угодно');
  assert.ok(!text.includes('\n\n\n'), 'без лишних пустых строк подряд');
  assert.equal(text.trim(), text, 'без пустых строк по краям');
});
