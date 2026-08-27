/* Разбор массового ввода строками: DEV-123 "Название" Тип Статус SP */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

const { Store } = loadApp();
const parse = line => Store.parseBulkLine(line);

test('полная форма разбирается по всем пяти полям', () => {
  assert.deepEqual(parse('DEV-123 "Поменять название" Задача Готово 3'), {
    key: 'DEV-123', title: 'Поменять название', type: 'Задача',
    status: 'done', points: 3, unplanned: false,
  });
});

test('статус из двух слов в кавычках', () => {
  const t = parse('DEV-124 "Удалить логи" Задача "В процессе" 5');
  assert.equal(t.status, 'progress');
  assert.equal(t.title, 'Удалить логи');
  assert.equal(t.points, 5);
});

test('статус из трёх слов без кавычек', () => {
  assert.equal(parse('DEV-5 "Отдали в тест" Задача Ready to Test 3').status, 'ready_to_test');
  assert.equal(parse('DEV-6 "Ещё" Задача готово к тестированию 1').status, 'ready_to_test');
});

test('любое поле кроме названия можно опустить', () => {
  assert.deepEqual(parse('Просто название'), {
    key: '', title: 'Просто название', type: '', status: null, points: null, unplanned: false,
  });
  const noStatus = parse('DEV-55 "Рефакторинг" 8');
  assert.equal(noStatus.key, 'DEV-55');
  assert.equal(noStatus.points, 8);
  assert.equal(noStatus.status, null);
  assert.equal(noStatus.type, '');
});

test('восклицательный знак помечает задачу как unplanned', () => {
  assert.equal(parse('!DEV-77 "Прилетело" Bug "In Progress" 2').unplanned, true);
  assert.equal(parse('!Хотфикс прод').unplanned, true);
  assert.equal(parse('DEV-1 "Обычная"').unplanned, false);
});

test('старый формат с вертикальной чертой продолжает работать', () => {
  assert.equal(parse('Обновить документацию | 2').points, 2);
  assert.equal(parse('Обновить документацию | 2').title, 'Обновить документацию');
  assert.equal(parse('!Хотфикс | 1').unplanned, true);
});

test('вертикальная черта внутри названия не ломает разбор', () => {
  const t = parse('DEV-2 "Название с | внутри" Задача Готово 2');
  assert.equal(t.title, 'Название с | внутри');
  assert.equal(t.points, 2);
});

test('дробные оценки и запятая как разделитель', () => {
  assert.equal(parse('DEV-4 "Оценка" Задача Готово 2.5').points, 2.5);
  assert.equal(parse('DEV-4 "Оценка" | 1,5').points, 1.5);
});

test('русские ключи и кавычки-ёлочки', () => {
  const t = parse('ПРО-12 «Русский ключ» Задача В работе 5');
  assert.equal(t.key, 'ПРО-12');
  assert.equal(t.title, 'Русский ключ');
  assert.equal(t.status, 'progress');
});

test('незнакомый тип сохраняется, если название в кавычках', () => {
  assert.equal(parse('DEV-56 "Смешной тип" Регламент Готово 1').type, 'Регламент');
});

test('апостроф в названии не считается кавычкой', () => {
  const t = parse("Don't repeat yourself");
  assert.equal(t.title, "Don't repeat yourself");
});

test('название без кавычек собирается из остатка строки', () => {
  const t = parse('DEV-3 Название без кавычек Задача Готово 3');
  assert.equal(t.title, 'Название без кавычек');
  assert.equal(t.type, 'Задача');
  assert.equal(t.status, 'done');
});

test('пустые строки игнорируются', () => {
  assert.equal(parse(''), null);
  assert.equal(parse('    '), null);
  assert.equal(parse('\t'), null);
});

test('parseBulkText подставляет умолчания и выкидывает пустые строки', () => {
  const items = Store.parseBulkText(
    'Первая\n\n  \nDEV-2 "Вторая" Задача Готово 5\n',
    { status: 'review', unplanned: true }
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].status, 'review', 'без статуса берётся умолчание');
  assert.equal(items[1].status, 'done', 'явный статус умолчание не перебивает');
  assert.ok(items.every(i => i.unplanned), 'флаг применяется ко всей пачке');
});

test('словарь статусов покрывает русские и английские написания', () => {
  const cases = [
    ['Бэклог', 'backlog'], ['Backlog', 'backlog'],
    ['К выполнению', 'todo'], ['To Do', 'todo'], ['open', 'todo'],
    ['В работе', 'progress'], ['in progress', 'progress'],
    ['На ревью', 'review'], ['code review', 'review'],
    ['Тестирование', 'testing'], ['QA', 'testing'],
    ['Деплой', 'deploy'], ['release', 'deploy'], ['staging', 'deploy'],
    ['Готово', 'done'], ['resolved', 'done'], ['Закрыто', 'done'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(Store.matchStatus(input), expected, `${input} → ${expected}`);
  }
});

test('тестирование относится к Testing, а не к Review', () => {
  // Пока не было колонок Testing/Deploy, эти слова маппились в Review
  assert.equal(Store.matchStatus('тестирование'), 'testing');
  assert.equal(Store.matchStatus('на тестировании'), 'testing');
  assert.equal(Store.matchStatus('ревью'), 'review');
});

test('незнакомый статус — null, а не случайная колонка', () => {
  assert.equal(Store.matchStatus('Ожидает релиза'), null);
  assert.equal(Store.matchStatus(''), null);
});

test('типы приводятся к каноническому виду', () => {
  assert.equal(Store.matchType('bug'), 'Баг');
  assert.equal(Store.matchType('ОШИБКА'), 'Баг');
  assert.equal(Store.matchType('task'), 'Задача');
  assert.equal(Store.matchType('user story'), 'История');
  assert.equal(Store.matchType('tech debt'), 'Тех. долг');
  assert.equal(Store.matchType('регламент'), null);
});

test('resolveStatus учитывает пользовательский маппинг поверх словаря', () => {
  const app = loadApp();
  assert.equal(app.Store.resolveStatus('Ожидает релиза'), null);
  app.Store.setSetting('statusMap', { 'ожидает релиза': 'deploy' });
  assert.equal(app.Store.resolveStatus('Ожидает релиза'), 'deploy');
  assert.equal(app.Store.resolveStatus('  ОЖИДАЕТ  РЕЛИЗА '), 'deploy', 'ключ нормализуется');
});
