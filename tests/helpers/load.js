/* ============================================================
   Загрузчик приложения для тестов.

   Исходники — обычные скрипты для браузера, без экспортов: в проекте
   нет сборки, и заводить её ради тестов не хочется. Поэтому склеиваем
   три файла в тело одной функции и возвращаем их модули наружу.
   Каждый вызов loadApp() создаёт свежие Store/Metrics со своим
   состоянием — тесты не протекают друг в друга.
   ============================================================ */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCES = ['js/store.js', 'js/metrics.js', 'js/charts.js'];

/** Минимальная замена localStorage: обычный объект в памяти. */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    get size() { return data.size; },
  };
}

/**
 * Поднимает приложение в чистом контексте.
 * @returns {{Store: object, Metrics: object, Charts: object, storage: object}}
 */
let factorySource = null;

function buildFactorySource() {
  if (factorySource) return factorySource;
  const parts = SOURCES.map(file => `// ── ${file}\n` + fs.readFileSync(path.join(ROOT, file), 'utf8'));
  factorySource =
    '(function (localStorage, console, document, URL, Blob) {\n' +
    parts.join('\n') +
    '\nreturn { Store, Metrics, Charts };\n})';
  return factorySource;
}

function loadApp() {
  const storage = memoryStorage();
  // exportJSON трогает DOM — в тестах не вызывается, но заглушки дешевле, чем падение
  const documentStub = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  const urlStub = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };

  const factory = vm.runInThisContext(buildFactorySource(), { filename: 'app-bundle.js' });
  const app = factory(storage, console, documentStub, urlStub, class Blob {});

  app.Store.load();
  return { ...app, storage };
}

/**
 * Спринт с задачами из компактного описания — чтобы тесты читались,
 * а не тонули в конструировании объектов.
 *
 * @param {object} app результат loadApp()
 * @param {object} opts { startOffset, days, tasks: [{key,title,points,status,unplanned,dropped,...}] }
 */
function makeSprint(app, opts = {}) {
  const { Store } = app;
  const startOffset = opts.startOffset ?? 0;
  const days = opts.days ?? Store.SPRINT_DEFAULT_DAYS;
  const startDate = Store.addDays(Store.today(), startOffset);

  const sprint = Store.createSprint({
    name: opts.name || 'Тестовый спринт',
    goal: opts.goal || '',
    startDate,
    endDate: Store.addDays(startDate, days - 1),
  });

  (opts.tasks || []).forEach((t, i) => {
    const task = Store.addTask(sprint.id, {
      key: t.key || `TST-${i + 1}`,
      title: t.title || `Задача ${i + 1}`,
      type: t.type || '',
      points: t.points ?? null,
      status: t.status || 'todo',
      unplanned: !!t.unplanned,
      assignee: t.assignee || '',
    });
    // Точные метки времени нужны burn-down: выставляем их напрямую
    if (t.createdAt) task.createdAt = t.createdAt;
    if (t.doneAt) task.doneAt = t.doneAt;
    if (t.dropped) {
      Store.updateTask(sprint.id, task.id, { dropped: true, dropReason: t.dropReason || 'carry' });
      if (t.droppedAt) Store.sprintById(sprint.id).tasks.find(x => x.id === task.id).droppedAt = t.droppedAt;
    }
  });

  return Store.sprintById(sprint.id);
}

/** ISO-метка на N-й день спринта (по местному времени, как это делает приложение). */
function dayOfSprint(Store, sprint, dayIndex, hour = 12) {
  const d = Store.parseDate(Store.addDays(sprint.startDate, dayIndex));
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

module.exports = { loadApp, makeSprint, dayOfSprint };
