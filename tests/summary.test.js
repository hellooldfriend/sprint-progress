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
  assert.equal(lines[0], '🏃 Спринт 24');
  assert.equal(lines[1], '🎯 Цель: Раскатить онбординг');
  assert.match(lines[2], /день 6 из 14$/);
  assert.ok(text.includes('✅ Закрытие 38% — 15 из 40 SP · 2 из 5 задач'));
});

test('velocity показывается только у закрытого спринта', () => {
  const app = loadApp();
  const sprint = running(app);
  assert.ok(!app.Summary.forSprint(sprint).includes('Velocity'), 'в идущем спринте velocity ещё не итог');

  app.Store.archiveSprint(sprint.id);
  const closed = app.Summary.forSprint(app.Store.sprintById(sprint.id));
  assert.ok(closed.includes('⚡ Velocity 15 SP'));
  assert.ok(closed.startsWith('🏁 '), 'закрытый спринт помечен флажком');
});

test('идущий спринт описывает состояние: остаток, работа, темп', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(running(app));
  assert.ok(text.includes('🧩 Планово 34 SP, внепланово 6 SP — 15% объёма'));
  assert.ok(text.includes('⏳ Осталось 25 SP, из них в работе 13 SP'));
  // 15 SP за 6 прошедших дней = 2.5; остаток 25 SP на 8 оставшихся = 3.1
  assert.match(text, /📈 Темп 2\.5 SP\/день, нужно 3\.1 SP\/день — идём примерно по графику/);
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
  assert.ok(text.includes('📤 Не сделано 18 SP: перенесено 13 SP → «Спринт 25», отменено 5 SP'));
  assert.ok(!text.includes('Темп'), 'в закрытом спринте прогноз темпа не нужен');
});

test('полностью закрытый спринт говорит об этом прямо', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -20, tasks: [{ points: 5, status: 'done' }] });
  app.Store.archiveSprint(sprint.id);
  assert.ok(app.Summary.forSprint(app.Store.sprintById(sprint.id)).includes('🎉 Закрыли всё, что взяли'));
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
  assert.ok(text.includes('♻️ Долг из прошлых спринтов: 8 SP'));
  assert.ok(text.includes('🔁 Едет третий спринт и дольше: DEV-1 Миграция'));
});

test('участники попадают в сводку строкой и разбивкой', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'A-1', title: 'Раз', points: 8, status: 'done', assignee: 'Марат' },
    { key: 'A-2', title: 'Два', points: 5, status: 'progress', assignee: 'Аня' },
    { key: 'A-3', title: 'Три', points: 2, status: 'todo' },
  ]});

  const short = app.Summary.forSprint(sprint, { withPeople: true });
  assert.ok(short.includes('👥 Участники: 2 — Марат, Аня, без исполнителя 1 задача'));

  const long = app.Summary.forSprint(sprint, { withTasks: true, withPeople: true });
  assert.ok(long.includes('👥 Участники (2):'));
  assert.ok(long.includes('  Марат — 1 задача · 8 SP, закрыто 8 SP'));
  assert.ok(long.includes('  Аня — 1 задача · 5 SP, закрыто 0 SP'));
  assert.ok(long.includes('  Без исполнителя — 1 задача · 2 SP'));
});

test('если исполнители не заполнены, строки об участниках нет', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(
    makeSprint(app, { startOffset: -5, tasks: [{ title: 'Раз', points: 3 }] }),
    { withTasks: true, withPeople: true });
  assert.ok(!text.includes('👥'));
});

test('без оценок сводка считает задачи, а не story points', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { title: 'Раз', status: 'done' }, { title: 'Два' }, { title: 'Три' },
  ]});
  const text = app.Summary.forSprint(sprint);
  assert.ok(text.includes('✅ Закрытие 33% — 1 из 3 задач'));
  assert.ok(!text.includes('SP'), 'единиц, которых нет, в тексте быть не должно');
});

test('перечень задач добавляется только по требованию', () => {
  const app = loadApp();
  const sprint = running(app);
  assert.ok(!app.Summary.forSprint(sprint).includes('Done ('));
  assert.ok(app.Summary.forSprint(sprint, { withTasks: true }).includes('✅ Done ('));
});

test('в идущем спринте задачи разложены по колонкам доски', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(running(app), { withTasks: true });

  assert.ok(text.includes('✅ Done (2 · 15 SP):'));
  assert.ok(text.includes('  DEV-1 Дизайн — 5 SP'));
  assert.ok(text.includes('🔨 In Progress (1 · 13 SP):'));
  assert.ok(text.includes('  DEV-3 Миграция — 13 SP'));
  assert.ok(text.includes('📋 To Do (2 · 12 SP):'));
  assert.ok(!text.includes('Не сделано'), 'у идущего спринта итог не подводится');
  assert.ok(!text.includes('Backlog'), 'пустые колонки не печатаются');
});

test('колонки идут от готового к нетронутому', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'A-1', title: 'Раз', points: 1, status: 'backlog' },
    { key: 'A-2', title: 'Два', points: 1, status: 'todo' },
    { key: 'A-3', title: 'Три', points: 1, status: 'progress' },
    { key: 'A-4', title: 'Четыре', points: 1, status: 'testing' },
    { key: 'A-5', title: 'Пять', points: 1, status: 'done' },
  ]});
  const heads = app.Summary.forSprint(sprint, { withTasks: true })
    .split('\n').filter(l => l.endsWith('):')).map(l => l.split(' (')[0]);

  assert.deepEqual(heads, ['✅ Done', '🧪 Testing', '🔨 In Progress', '📋 To Do', '🗂 Backlog']);
});

test('пометки на задаче: unplanned и счётчик спринтов', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'A-1', title: 'Прилетела', points: 3, status: 'progress', unplanned: true },
    { key: 'A-2', title: 'Долгожитель', points: 5, status: 'progress' },
  ]});
  app.Store.sprintById(sprint.id).tasks.find(t => t.key === 'A-2').carryCount = 3;

  const text = app.Summary.forSprint(app.Store.sprintById(sprint.id), { withTasks: true });
  assert.ok(text.includes('  A-1 Прилетела — 3 SP (unplanned)'));
  assert.ok(text.includes('  A-2 Долгожитель — 5 SP (4-й спринт)'));
});

test('снятые задачи вынесены из своих колонок в отдельную группу', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'A-1', title: 'Работаем', points: 5, status: 'todo' },
    { key: 'A-2', title: 'Не будем делать', points: 3, status: 'todo', dropped: true, dropReason: 'cancelled' },
  ]});
  const text = app.Summary.forSprint(app.Store.sprintById(sprint.id), { withTasks: true });

  assert.ok(text.includes('📋 To Do (1 · 5 SP):'), 'снятая не считается в своей колонке');
  assert.ok(text.includes('🚫 Снято со спринта (1 · 3 SP):'));
  assert.ok(text.includes('  A-2 Не будем делать — 3 SP (отменено)'));
});

test('без оценок в заголовке группы только количество', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'A-1', title: 'Раз', status: 'todo' }, { key: 'A-2', title: 'Два', status: 'todo' },
  ]});
  const text = app.Summary.forSprint(sprint, { withTasks: true });
  assert.ok(text.includes('📋 To Do (2):'));
  assert.ok(!text.includes('SP'));
});

test('у закрытого спринта перечень остаётся итоговым: сделали и не сделали', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -20, tasks: [
    { key: 'A-1', title: 'Успели', points: 5, status: 'done' },
    { key: 'A-2', title: 'Не успели', points: 8, status: 'testing' },
  ]});
  app.Store.archiveSprint(sprint.id);

  const text = app.Summary.forSprint(app.Store.sprintById(sprint.id), { withTasks: true });
  assert.ok(text.includes('✅ Сделано (1 · 5 SP):'));
  assert.ok(text.includes('📤 Не сделано (1 · 8 SP):'));
  assert.ok(text.includes('  A-2 Не успели — 8 SP (Testing)'), 'стадия видна прямо в строке');
  assert.ok(!text.includes('🧪 Testing (1'), 'разбивки по колонкам у закрытого спринта нет');
});

test('в перечне видно, куда уехала задача и что отменено', () => {
  const app = loadApp();
  const { Store, Summary } = app;
  const from = makeSprint(app, { name: 'Спринт 24', startOffset: -20, tasks: [
    { key: 'DEV-1', title: 'Уехала', points: 3, status: 'todo' },
    { key: 'DEV-2', title: 'Ненужная', points: 2, status: 'todo', dropped: true, dropReason: 'cancelled' },
  ]});
  const to = makeSprint(app, { name: 'Спринт 25', startOffset: -6 });
  Store.carryTasks(from.id, to.id, [{ taskId: Store.sprintById(from.id).tasks.find(t => t.key === 'DEV-1').id }]);
  Store.archiveSprint(from.id);

  const text = Summary.forSprint(Store.sprintById(from.id), { withTasks: true });
  assert.ok(text.includes('  DEV-1 Уехала — 3 SP (перенос → Спринт 25)'));
  assert.ok(text.includes('  DEV-2 Ненужная — 2 SP (отменено)'));
});

test('в идущем спринте перенесённая задача показывает адрес в группе снятых', () => {
  const app = loadApp();
  const { Store, Summary } = app;
  const from = makeSprint(app, { name: 'Спринт 24', startOffset: -5, tasks: [
    { key: 'DEV-1', title: 'Уехала', points: 3, status: 'todo' },
  ]});
  const to = makeSprint(app, { name: 'Спринт 25', startOffset: 14 });
  Store.carryTasks(from.id, to.id, [{ taskId: Store.sprintById(from.id).tasks[0].id }]);

  const text = Summary.forSprint(Store.sprintById(from.id), { withTasks: true });
  assert.ok(text.includes('🚫 Снято со спринта (1 · 3 SP):'));
  assert.ok(text.includes('  DEV-1 Уехала — 3 SP (перенос → Спринт 25)'));
});

test('пустой спринт и отсутствие спринта не ломают сводку', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(makeSprint(app, { name: 'Пустой', tasks: [] }));
  assert.ok(text.includes('🫙 Задач в спринте нет.'));
  assert.ok(!text.includes('Закрытие'));
  assert.equal(app.Summary.forSprint(null), '');
});

test('сводка — это plain text без разметки', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(running(app), { withTasks: true });
  assert.ok(!/[<>*_`|#]/.test(text), 'ни html, ни markdown — вставляется куда угодно');
  assert.match(text, /\p{Extended_Pictographic}/u, 'эмодзи в тексте есть');
  assert.ok(!text.includes('\n\n\n'), 'без лишних пустых строк подряд');
  assert.equal(text.trim(), text, 'без пустых строк по краям');
});

test('ёмкость в сводке: на планировании перебор, в итоге фокус и точность', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -6, tasks: [
    { points: 20, status: 'done' }, { points: 42, status: 'progress' },
  ]});
  app.Store.updateSprint(sprint.id, { capacity: 45 });
  assert.ok(app.Summary.forSprint(app.Store.sprintById(sprint.id))
    .includes('📐 Ёмкость 45 п/д, взято 62 SP — перебор на 38%'));

  app.Store.updateSprint(sprint.id, { spent: 40 });
  app.Store.archiveSprint(sprint.id);
  assert.ok(app.Summary.forSprint(app.Store.sprintById(sprint.id))
    .includes('📐 Ёмкость 45 п/д, потрачено 40 п/д (фокус 89%) — на 1 п/д закрывали 0.5 SP'));
});

test('без ёмкости строки о человеко-днях в сводке нет', () => {
  const app = loadApp();
  const text = app.Summary.forSprint(makeSprint(app, { startOffset: -5, tasks: [{ points: 5 }] }));
  assert.ok(!text.includes('📐'));
});

test('участники добавляются отдельным флагом, а не вместе с задачами', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'A-1', title: 'Раз', points: 5, status: 'done', assignee: 'Марат Ахметов' },
  ]});

  const bare = app.Summary.forSprint(sprint);
  assert.ok(!bare.includes('👥'), 'по умолчанию участников нет');

  const withTasks = app.Summary.forSprint(sprint, { withTasks: true });
  assert.ok(withTasks.includes('✅ Done'));
  assert.ok(!withTasks.includes('👥'), 'перечень задач участников не тянет');

  const withPeople = app.Summary.forSprint(sprint, { withPeople: true });
  assert.ok(withPeople.includes('👥 Участники: 1 — Марат Ахметов'));
  assert.ok(withPeople.includes('👥 Участники (1):'), 'строка и разбивка приходят вместе');
  assert.ok(!withPeople.includes('✅ Done ('), 'а задачи — нет');
});

test('номер задачи превращается в ссылку, когда задан адрес трекера', () => {
  const app = loadApp();
  const sprint = makeSprint(app, { startOffset: -5, tasks: [
    { key: 'DEV-1', title: 'Дизайн', points: 5, status: 'done' },
  ]});

  const plain = app.Summary.forSprint(sprint, { withTasks: true });
  assert.ok(plain.includes('  DEV-1 Дизайн — 5 SP'));

  app.Store.setSetting('taskBaseUrl', 'jira.company.com/browse');
  const linked = app.Summary.forSprint(sprint, { withTasks: true });
  assert.ok(linked.includes('  https://jira.company.com/browse/DEV-1 Дизайн — 5 SP'));
  assert.ok(!linked.includes('[') && !linked.includes('<'), 'ссылка голая, без разметки');
});

test('задачи без номера не получают битых ссылок', () => {
  const app = loadApp();
  app.Store.setSetting('taskBaseUrl', 'jira.com');
  const sprint = makeSprint(app, { startOffset: -5, tasks: [{ key: '', title: 'Без номера', points: 3 }] });
  const text = app.Summary.forSprint(sprint, { withTasks: true });
  assert.ok(text.includes('  Без номера — 3 SP'));
  assert.ok(!text.includes('jira.com'));
});
