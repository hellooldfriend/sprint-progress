/* ============================================================
   store.js — модель данных, персистентность, CRUD.
   Единственный модуль, который знает про localStorage.

   Форма состояния:
   {
     version: 1,
     activeSprintId: string|null,
     settings: { metricMode: 'points'|'tasks', chartMode: 'burndown'|'burnup' },
     sprints: [{
       id, name, goal, startDate:'YYYY-MM-DD', endDate:'YYYY-MM-DD',
       status: 'active'|'archived', createdAt, archivedAt,
       capacity:number|null,   // ёмкость команды в человеко-днях, заполняется на планировании
       spent:number|null,      // сколько человеко-дней реально ушло на задачи, заполняется при закрытии
       tasks: [{ id, key:string, title, type:string, points:number|null, status,
                 unplanned:boolean, dropped:boolean, dropReason:string, assignee:string,
                 carriedFrom:{id,name}|null, carriedTo:{id,name}|null, carryCount:number,
                 createdAt:ISO, doneAt:ISO|null, droppedAt:ISO|null }]
     }]
   }
   ============================================================ */
const Store = (() => {
  'use strict';

  const KEY = 'sprint-progress:v1';
  const SPRINT_DEFAULT_DAYS = 14;

  /** Колонки канбана. Порядок задаёт и порядок перемещения стрелками. */
  const STATUSES = [
    // icon — для текстовой сводки, которую уносят в чат
    { id: 'backlog',       label: 'Backlog',       color: 'var(--faint)',  dot: 'dot--muted',   icon: '🗂' },
    { id: 'todo',          label: 'To Do',         color: 'var(--muted)',  dot: 'dot--muted',   icon: '📋' },
    { id: 'progress',      label: 'In Progress',   color: 'var(--blue)',   dot: 'dot--blue',    icon: '🔨' },
    { id: 'review',        label: 'Review',        color: 'var(--accent)', dot: 'dot--accent',  icon: '👀' },
    { id: 'ready_to_test', label: 'Ready to Test', color: 'var(--indigo)', dot: 'dot--indigo',  icon: '📦' },
    { id: 'testing',       label: 'Testing',       color: 'var(--cyan)',   dot: 'dot--cyan',    icon: '🧪' },
    { id: 'deploy',        label: 'Deploy',        color: 'var(--teal)',   dot: 'dot--teal',    icon: '🚀' },
    { id: 'done',          label: 'Done',          color: 'var(--green)',  dot: 'dot--green',   icon: '✅' },
  ];

  /** Задача «в работе»: начата, но ещё не закрыта. Нужна метрикам и подсказкам. */
  const IN_FLIGHT_IDS = ['progress', 'review', 'ready_to_test', 'testing', 'deploy'];

  /**
   * Причины, по которым задачу снимают со спринта («не закроем»).
   * Снятие — это решение о скоупе, а не стадия работы, поэтому это флаг, а не колонка.
   */
  const DROP_REASONS = [
    // short — для тега на карточке, verb — для связного текста в сводке
    { id: 'carry',     label: 'Перенос в следующий спринт', short: 'Перенос',  verb: 'перенесено' },
    { id: 'cancelled', label: 'Отменили',                   short: 'Отменена', verb: 'отменено' },
    { id: 'blocked',   label: 'Заблокировано',              short: 'Блок',     verb: 'заблокировано' },
  ];
  const DROP_REASON_IDS = DROP_REASONS.map(r => r.id);
  const dropReasonById = id => DROP_REASONS.find(r => r.id === id) || DROP_REASONS[0];
  const STATUS_IDS = STATUSES.map(s => s.id);

  /**
   * Синонимы статусов для массового ввода: как их пишут в Jira, Kaiten и в голове.
   * Ключи уже нормализованы (нижний регистр, схлопнутые пробелы).
   */
  const STATUS_ALIASES = {
    backlog:  ['backlog', 'бэклог', 'беклог', 'бэклог задач'],
    todo:     ['to do', 'todo', 'to-do', 'open', 'new', 'к выполнению', 'сделать', 'запланировано',
               'открыто', 'открыта', 'новая', 'новый', 'ожидает'],
    progress: ['in progress', 'inprogress', 'in-progress', 'doing', 'wip', 'development', 'in development',
               'в процессе', 'в работе', 'в разработке', 'разработка', 'делается'],
    review:   ['review', 'in review', 'code review', 'cr',
               'ревью', 'на ревью', 'код-ревью', 'на проверке', 'проверка'],
    ready_to_test: ['ready to test', 'ready for test', 'ready for testing', 'ready to testing',
                    'ready to qa', 'ready for qa', 'rft',
                    'готово к тестированию', 'готова к тестированию', 'к тестированию',
                    'готово к тесту', 'можно тестировать'],
    testing:  ['testing', 'in testing', 'in test', 'qa', 'test',
               'тестирование', 'на тестировании', 'в тестировании', 'тестируется', 'на qa'],
    deploy:   ['deploy', 'deployment', 'deploying', 'ready to deploy', 'to deploy', 'release', 'staging',
               'деплой', 'на деплое', 'на выкатке', 'выкатка', 'релиз', 'готово к деплою'],
    done:     ['done', 'closed', 'resolved', 'complete', 'completed',
               'готово', 'готова', 'выполнено', 'выполнена', 'закрыто', 'закрыта', 'завершено', 'сделано'],
  };

  /**
   * Статусы трекера, которые не являются стадией работы: задача не движется по доске,
   * а снята с неё решением команды. В модели это флаг «Не закроем» с причиной,
   * поэтому в колонку они не превращаются — иначе Rejected копился бы в remaining work,
   * а попав в Done, ещё и надувал бы velocity.
   */
  const DROP_STATUS_ALIASES = {
    cancelled: ['rejected', 'reject', 'declined', 'cancelled', 'canceled', 'won\'t do', 'wont do', 'wont fix',
                'отклонено', 'отклонена', 'отменено', 'отменена', 'не будет делаться'],
    blocked:   ['hold', 'on hold', 'blocked', 'is blocked', 'paused', 'pending',
                'заблокировано', 'заблокирована', 'на паузе', 'приостановлено', 'ожидание'],
  };

  /** Строка → причина снятия ('cancelled' | 'blocked') или null. */
  function matchDropStatus(str) {
    const nrm = normalizeWord(str);
    if (!nrm) return null;
    for (const [reason, aliases] of Object.entries(DROP_STATUS_ALIASES)) {
      if (aliases.includes(nrm)) return reason;
    }
    return null;
  }

  /** Типы задач: разные написания → одно каноническое имя. */
  const TYPE_ALIASES = {
    'Задача':    ['задача', 'таска', 'task'],
    'Баг':       ['баг', 'ошибка', 'дефект', 'bug', 'defect'],
    'История':   ['история', 'user story', 'story'],
    'Улучшение': ['улучшение', 'improvement', 'enhancement'],
    'Фича':      ['фича', 'feature', 'новая функциональность'],
    'Эпик':      ['эпик', 'epic'],
    'Подзадача': ['подзадача', 'sub-task', 'subtask', 'sub task'],
    'Тех. долг': ['тех долг', 'тех. долг', 'техдолг', 'tech debt', 'techdebt', 'chore'],
    'Спайк':     ['спайк', 'spike', 'исследование', 'research'],
  };

  /** Ключ задачи вида DEV-123, ABC-7, ПРО-45. */
  const TASK_KEY_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_]*[-_]\d+$/;

  const normalizeWord = str => String(str).toLowerCase().replace(/[«»""'`.,;:]/g, '').replace(/\s+/g, ' ').trim();

  /**
   * Строка → id статуса с учётом пользовательского маппинга.
   * Сначала смотрим, что тимлид сам сопоставил (у каждой команды свой workflow),
   * потом общий словарь синонимов.
   */
  function resolveStatus(str) {
    const n = normalizeWord(str);
    if (!n) return null;
    const custom = state && state.settings && state.settings.statusMap;
    if (custom && STATUS_IDS.includes(custom[n])) return custom[n];
    return matchStatus(n);
  }

  /** Строка → id статуса или null. */
  function matchStatus(str) {
    const n = normalizeWord(str);
    if (!n) return null;
    if (STATUS_IDS.includes(n)) return n;
    for (const [id, aliases] of Object.entries(STATUS_ALIASES)) {
      if (aliases.includes(n)) return id;
    }
    return null;
  }

  /** Строка → каноническое название типа или null. */
  function matchType(str) {
    const n = normalizeWord(str);
    if (!n) return null;
    for (const [canonical, aliases] of Object.entries(TYPE_ALIASES)) {
      if (aliases.includes(n)) return canonical;
    }
    return null;
  }

  const isNumeric = str => str !== '' && !isNaN(parseFloat(String(str).replace(',', '.')));

  /**
   * Разбивает строку на токены, уважая кавычки: "…", '…', «…», “…”.
   * Возвращает [{ v: 'текст', quoted: true|false }].
   */
  function tokenize(line) {
    // Одинарные кавычки намеренно не поддерживаем: апостроф в «don't» дороже, чем такой синтаксис
    const PAIRS = { '"': '"', '«': '»', '\u201c': '\u201d' };
    const tokens = [];
    let buf = '', closing = null;

    const flush = quoted => {
      const v = buf.trim();
      if (v) tokens.push({ v, quoted: !!quoted });
      buf = '';
    };

    for (const ch of line) {
      if (closing) {
        if (ch === closing) { flush(true); closing = null; }
        else buf += ch;
      } else if (PAIRS[ch]) {
        flush(false);
        closing = PAIRS[ch];
      } else if (/\s/.test(ch)) {
        flush(false);
      } else {
        buf += ch;
      }
    }
    flush(!!closing);   // незакрытая кавычка — не теряем хвост
    return tokens;
  }

  /**
   * Разбор одной строки массового ввода.
   *
   * Основной формат:  DEV-123 "Поменять название" Задача Готово 3
   * Любое поле, кроме названия, можно опустить:
   *   "Только название"
   *   DEV-9 "Починить экспорт" Баг 2
   *   Обновить документацию | 2        (старый формат с вертикальной чертой)
   *   !DEV-7 "Прилетело в спринт" Баг "В процессе" 3
   *
   * @returns {object|null} { key, title, type, status, points, unplanned } либо null для пустой строки
   */
  function parseBulkLine(line) {
    let text = String(line).trim();
    if (!text) return null;

    // «!» в начале — задача пришла во время спринта
    let unplanned = false;
    if (text.startsWith('!')) { unplanned = true; text = text.slice(1).trim(); }

    // Совместимость со старым форматом: хвост после последней «|» — story points
    let points = null;
    const bar = text.lastIndexOf('|');
    if (bar !== -1) {
      const tail = text.slice(bar + 1).trim();
      if (isNumeric(tail)) {
        points = Math.max(0, parseFloat(tail.replace(',', '.')));
        text = text.slice(0, bar).trim();
      }
    }

    let tokens = tokenize(text);
    if (!tokens.length) return null;

    // 1) Story points — последний неквотированный числовой токен
    const last = tokens[tokens.length - 1];
    if (points === null && tokens.length > 1 && !last.quoted && isNumeric(last.v)) {
      points = Math.max(0, parseFloat(last.v.replace(',', '.')));
      tokens.pop();
    }

    // 2) Ключ задачи — первый токен вида DEV-123
    let key = '';
    if (tokens.length > 1 && !tokens[0].quoted && TASK_KEY_RE.test(tokens[0].v)) {
      key = tokens.shift().v.toUpperCase();
    }

    // 3) Статус — с конца: до трёх токенов подряд («в процессе» без кавычек — это два токена)
    let status = null;
    let dropReason = null;
    for (let n = Math.min(3, tokens.length - 1); n >= 1 && !status && !dropReason; n--) {
      const candidate = tokens.slice(-n).map(t => t.v).join(' ');
      const found = matchStatus(candidate);
      if (found) { status = found; tokens.splice(-n); continue; }
      // Rejected / Hold — не колонка, а снятие со спринта
      const drop = matchDropStatus(candidate);
      if (drop) { dropReason = drop; status = 'backlog'; tokens.splice(-n); }
    }

    // 4) Тип — тоже с конца, по словарю
    let type = '';
    for (let n = Math.min(2, tokens.length - 1); n >= 1 && !type; n--) {
      const found = matchType(tokens.slice(-n).map(t => t.v).join(' '));
      if (found) { type = found; tokens.splice(-n); }
    }

    // 5) Тип не из словаря, но название явно в кавычках → всё после названия считаем типом
    if (!type && tokens.length > 1 && tokens[0].quoted) {
      type = tokens.slice(1).map(t => t.v).join(' ');
      tokens = [tokens[0]];
    }

    const title = tokens.map(t => t.v).join(' ').trim();
    if (!title) return null;

    return { key, title, type, status, points, unplanned, dropped: !!dropReason, dropReason };
  }

  /**
   * Разбор всего текста массового ввода с подстановкой значений по умолчанию.
   * Используется и для предпросмотра в модалке, и для самого импорта.
   */
  function parseBulkText(text, defaults = {}) {
    return String(text)
      .split('\n')
      .map(line => parseBulkLine(line))
      .filter(Boolean)
      .map(item => ({
        ...item,
        status: item.status || (STATUS_IDS.includes(defaults.status) ? defaults.status : 'todo'),
        unplanned: item.unplanned || !!defaults.unplanned,
      }));
  }

  /* ───────────── Утилиты ───────────── */

  const uid = () =>
    Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  /** Локальная дата в 'YYYY-MM-DD' (без сдвига часового пояса, в отличие от toISOString). */
  function toISODate(date) {
    const d = date instanceof Date ? date : new Date(date);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function parseDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function addDays(iso, n) {
    const d = parseDate(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }
  /** Календарных дней между двумя датами (b - a). */
  function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  const today = () => toISODate(new Date());

  /** Список дат спринта включительно. */
  function dateRange(startDate, endDate) {
    const out = [];
    const total = Math.max(0, diffDays(startDate, endDate));
    for (let i = 0; i <= total; i++) out.push(addDays(startDate, i));
    return out;
  }

  const MONTHS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  function formatDate(iso, withYear) {
    const d = parseDate(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
  }
  function formatRange(a, b) {
    const sameYear = parseDate(a).getFullYear() === parseDate(b).getFullYear();
    return `${formatDate(a)} — ${formatDate(b, !sameYear)}`;
  }

  function emptyState() {
    return {
      version: 1,
      activeSprintId: null,
      settings: {
        metricMode: 'points', chartMode: 'burndown',
        statusMap: {}, csvMapping: null, sidebarCollapsed: false,
        taskBaseUrl: '', summaryWithTasks: false, summaryWithPeople: false,
      },
      sprints: [],
    };
  }

  /* ───────────── Загрузка / сохранение ───────────── */

  let state = null;

  /** Человеко-дни: положительное число либо null, если не заполнено. */
  function normalizeDays(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num * 10) / 10 : null;
  }

  /** Приводит любые входные данные (в т.ч. импорт) к валидной форме. */
  function normalize(raw) {
    const base = emptyState();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sprints)) return null;

    const sprints = raw.sprints.filter(Boolean).map(s => {
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(s.startDate) ? s.startDate : today();
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(s.endDate)
        ? s.endDate
        : addDays(startDate, SPRINT_DEFAULT_DAYS - 1);

      return {
        id: s.id || uid(),
        name: String(s.name || 'Без названия').slice(0, 120),
        goal: String(s.goal || '').slice(0, 200),
        startDate,
        endDate: diffDays(startDate, endDate) < 0 ? startDate : endDate,
        status: s.status === 'archived' ? 'archived' : 'active',
        createdAt: s.createdAt || new Date().toISOString(),
        archivedAt: s.archivedAt || null,
        capacity: normalizeDays(s.capacity),
        spent: normalizeDays(s.spent),
        tasks: Array.isArray(s.tasks) ? s.tasks.filter(Boolean).map(t => {
          const status = STATUS_IDS.includes(t.status) ? t.status : 'todo';
          const points = Number.isFinite(Number(t.points)) && t.points !== null && t.points !== ''
            ? Math.max(0, Number(t.points)) : null;
          return {
            id: t.id || uid(),
            key: String(t.key || '').trim().toUpperCase().slice(0, 24),
            title: String(t.title || 'Без названия').slice(0, 200),
            type: String(t.type || '').trim().slice(0, 32),
            points,
            status,
            unplanned: !!t.unplanned,
            dropped: status === 'done' ? false : !!t.dropped,
            dropReason: DROP_REASON_IDS.includes(t.dropReason) ? t.dropReason : 'carry',
            carriedFrom: t.carriedFrom && (t.carriedFrom.id || t.carriedFrom.name)
              ? { id: String(t.carriedFrom.id || ''), name: String(t.carriedFrom.name || 'прошлый спринт').slice(0, 120) }
              : null,
            carriedTo: t.carriedTo && t.carriedTo.id
              ? { id: String(t.carriedTo.id), name: String(t.carriedTo.name || 'следующий спринт').slice(0, 120) }
              : null,
            carryCount: Math.max(0, Math.round(Number(t.carryCount) || 0)),
            assignee: String(t.assignee || '').slice(0, 60),
            createdAt: t.createdAt || new Date().toISOString(),
            doneAt: status === 'done' ? (t.doneAt || new Date().toISOString()) : null,
            droppedAt: status !== 'done' && t.dropped ? (t.droppedAt || new Date().toISOString()) : null,
          };
        }) : [],
      };
    });

    const rawSettings = raw.settings || {};
    const statusMap = {};
    if (rawSettings.statusMap && typeof rawSettings.statusMap === 'object') {
      Object.entries(rawSettings.statusMap).forEach(([from, to]) => {
        if (STATUS_IDS.includes(to)) statusMap[normalizeWord(from)] = to;
      });
    }
    const settings = {
      metricMode: rawSettings.metricMode === 'tasks' ? 'tasks' : 'points',
      chartMode: rawSettings.chartMode === 'burnup' ? 'burnup' : 'burndown',
      statusMap,
      csvMapping: rawSettings.csvMapping && typeof rawSettings.csvMapping === 'object'
        ? rawSettings.csvMapping : null,
      sidebarCollapsed: !!rawSettings.sidebarCollapsed,
      taskBaseUrl: String(rawSettings.taskBaseUrl || '').trim().slice(0, 300),
      summaryWithTasks: !!rawSettings.summaryWithTasks,
      summaryWithPeople: !!rawSettings.summaryWithPeople,
    };
    const activeSprintId = sprints.some(s => s.id === raw.activeSprintId)
      ? raw.activeSprintId
      : (sprints.find(s => s.status === 'active') || sprints[0] || {}).id || null;

    return { ...base, sprints, settings, activeSprintId };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = normalize(JSON.parse(raw));
    } catch (err) {
      console.warn('[store] не удалось прочитать localStorage:', err);
    }
    if (!state) {            // первый запуск или битые данные — начинаем с чистого листа
      state = emptyState();
      save();
    }
    return state;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.error('[store] не удалось сохранить:', err);
      return false;
    }
    return true;
  }

  const get = () => state;
  const sprints = () => state.sprints;
  const activeSprint = () => state.sprints.find(s => s.id === state.activeSprintId) || null;
  const sprintById = id => state.sprints.find(s => s.id === id) || null;

  /** Спринты в порядке «сначала свежие» — для сайдбара и истории. */
  function sortedSprints() {
    return [...state.sprints].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  }

  /* ───────────── Настройки ───────────── */

  /**
   * Ссылка на задачу в трекере: базовый адрес из настроек + номер.
   * «jira.com» + «DEV-123» → «https://jira.com/DEV-123».
   * Схему дописываем сами: без неё ссылка не кликается ни в чате, ни в href.
   *
   * @returns {string} пустая строка, если база не задана или у задачи нет номера
   */
  function taskUrl(key) {
    const base = String((state && state.settings && state.settings.taskBaseUrl) || '').trim();
    if (!base || !key) return '';
    const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
    // Номер задачи URL-безопасен сам по себе, а кодирование делает кириллицу нечитаемой в чате
    return `${withScheme.replace(/\/+$/, '')}/${String(key).trim()}`;
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    save();
  }

  /* ───────────── CRUD: спринты ───────────── */

  function createSprint({ name, goal, startDate, endDate, capacity }) {
    const sprint = {
      id: uid(),
      name: name.trim(),
      goal: (goal || '').trim(),
      startDate,
      endDate,
      status: 'active',
      createdAt: new Date().toISOString(),
      archivedAt: null,
      capacity: normalizeDays(capacity),
      spent: null,
      tasks: [],
    };
    state.sprints.push(sprint);
    state.activeSprintId = sprint.id;
    save();
    return sprint;
  }

  function updateSprint(id, patch) {
    const s = sprintById(id);
    if (!s) return null;
    if (patch.capacity !== undefined) patch.capacity = normalizeDays(patch.capacity);
    if (patch.spent !== undefined) patch.spent = normalizeDays(patch.spent);
    Object.assign(s, patch);
    save();
    return s;
  }

  function archiveSprint(id) {
    return updateSprint(id, { status: 'archived', archivedAt: new Date().toISOString() });
  }

  function reopenSprint(id) {
    return updateSprint(id, { status: 'active', archivedAt: null });
  }

  function deleteSprint(id) {
    state.sprints = state.sprints.filter(s => s.id !== id);
    if (state.activeSprintId === id) {
      const next = state.sprints.find(s => s.status === 'active') || state.sprints[0];
      state.activeSprintId = next ? next.id : null;
    }
    save();
  }

  function selectSprint(id) {
    state.activeSprintId = id;
    save();
  }

  /* ───────────── Импорт CSV-выгрузки из Jira ───────────── */

  /** Заголовки колонок Jira (EN/RU) → наши поля. */
  const CSV_FIELD_HINTS = {
    key:      ['issue key', 'key', 'ключ', 'ключ задачи', 'номер', 'номер задачи'],
    title:    ['summary', 'название', 'тема', 'заголовок'],
    type:     ['issue type', 'issuetype', 'type', 'тип задачи', 'тип'],
    status:   ['status', 'статус'],
    points:   ['story points', 'story point estimate', 'оценка', 'story points estimate'],
    assignee: ['assignee', 'исполнитель', 'ответственный'],
    resolved:  ['resolved', 'resolution date', 'дата решения', 'решено', 'дата закрытия'],
  };
  const CSV_FIELDS = Object.keys(CSV_FIELD_HINTS);
  const CSV_FIELD_LABELS = {
    key: 'Номер задачи', title: 'Название', type: 'Тип',
    status: 'Статус', points: 'Story points', assignee: 'Исполнитель',
    resolved: 'Дата закрытия',
  };

  /** Заголовки колонок со спринтами — по ним считается, сколько спринтов едет задача. */
  const CSV_SPRINT_HINTS = ['sprint', 'спринт'];

  const JIRA_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  /**
   * Дата из выгрузки → ISO. Jira по умолчанию отдаёт «13/Aug/26 3:04 PM»,
   * локализованные экспорты — «13.08.2026 15:04», API — ISO.
   */
  function parseDateTime(str) {
    const raw = String(str || '').trim();
    if (!raw) return null;

    const jira = raw.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([AaPp])[Mm])?)?/);
    if (jira) {
      const month = JIRA_MONTHS[jira[2].toLowerCase()];
      if (month !== undefined) {
        let year = Number(jira[3]);
        if (year < 100) year += 2000;
        let hour = Number(jira[4] || 12);
        if (jira[6]) {
          const pm = jira[6].toLowerCase() === 'p';
          if (pm && hour < 12) hour += 12;
          if (!pm && hour === 12) hour = 0;
        }
        return new Date(year, month, Number(jira[1]), hour, Number(jira[5] || 0)).toISOString();
      }
    }

    const local = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (local) {
      return new Date(Number(local[3]), Number(local[2]) - 1, Number(local[1]),
                      Number(local[4] || 12), Number(local[5] || 0)).toISOString();
    }

    const ts = Date.parse(raw);
    return isNaN(ts) ? null : new Date(ts).toISOString();
  }

  /** Определяет разделитель по первой строке: Jira отдаёт запятую, локали — точку с запятой. */
  function detectDelimiter(text) {
    const line = text.split(/\r?\n/)[0] || '';
    const counts = [',', ';', '\t'].map(d => [d, line.split(d).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
  }

  /**
   * Разбор CSV по RFC 4180: кавычки, удвоенные кавычки внутри поля, переводы строк внутри значения.
   * Возвращает массив строк-массивов (первая строка — заголовки).
   */
  function parseCSV(text, delimiter) {
    let src = String(text).replace(/^\uFEFF/, '');   // Jira отдаёт файл с BOM
    const delim = delimiter || detectDelimiter(src);

    const rows = [];
    let row = [], field = '', inQuotes = false;

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // Выкидываем полностью пустые строки — Jira любит хвостовой перевод строки
    return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
  }

  /** Угадывает соответствие «наше поле → индекс колонки» по заголовкам. */
  function detectCsvMapping(headers) {
    const norm = headers.map(h => normalizeWord(h));
    const mapping = {};

    CSV_FIELDS.forEach(field => {
      const hints = CSV_FIELD_HINTS[field];
      let idx = norm.findIndex(h => hints.includes(h));
      if (idx === -1) {
        // Jira называет кастомные поля так: «Custom field (Story Points)»
        idx = norm.findIndex(h => hints.some(hint => h.includes(hint)));
      }
      mapping[field] = idx;
    });
    return mapping;
  }

  /** Индексы колонок со спринтами: их в выгрузке столько, в скольких спринтах побывала задача. */
  function csvSprintColumns(headers) {
    return headers
      .map((h, i) => (CSV_SPRINT_HINTS.includes(normalizeWord(h)) ? i : -1))
      .filter(i => i !== -1);
  }

  /**
   * Превращает разобранный CSV в задачи по заданному маппингу.
   * @returns {{items:Array, unknownStatuses:string[], skipped:number}}
   */
  function itemsFromCsv(rows, mapping, defaults = {}) {
    if (!rows || rows.length < 2) return { items: [], unknownStatuses: [], skipped: 0 };

    const headers = rows[0];
    const sprintCols = csvSprintColumns(headers);
    const defaultStatus = STATUS_IDS.includes(defaults.status) ? defaults.status : 'todo';
    const cell = (row, idx) => (idx >= 0 && idx < row.length ? String(row[idx]).trim() : '');

    const unknown = new Set();
    let skipped = 0;

    const items = rows.slice(1).map(row => {
      const title = cell(row, mapping.title);
      if (!title) { skipped++; return null; }

      const rawStatus = cell(row, mapping.status);
      const dropReason = matchDropStatus(rawStatus);
      // В список ручного сопоставления попадает всё, чего нет во встроенном словаре,
      // даже если пользователь это уже сопоставил — иначе строка исчезала бы при выборе
      if (rawStatus && !matchStatus(rawStatus) && !dropReason) unknown.add(rawStatus);
      const status = dropReason ? 'backlog' : resolveStatus(rawStatus);

      const rawPoints = cell(row, mapping.points).replace(',', '.');
      const points = rawPoints !== '' && !isNaN(parseFloat(rawPoints))
        ? Math.max(0, parseFloat(rawPoints)) : null;

      // Сколько спринтов задача уже прожила: колонок Sprint столько же, сколько спринтов
      const sprintNames = sprintCols.map(i => cell(row, i)).filter(Boolean);
      const carryCount = Math.max(0, sprintNames.length - 1);

      return {
        doneAt: status === 'done' ? parseDateTime(cell(row, mapping.resolved)) : null,
        key: cell(row, mapping.key).toUpperCase(),
        title,
        type: matchType(cell(row, mapping.type)) || cell(row, mapping.type),
        assignee: cell(row, mapping.assignee),
        points,
        status: status || defaultStatus,
        unplanned: !!defaults.unplanned,
        dropped: !!dropReason,
        dropReason,
        carryCount,
        carriedFrom: carryCount ? { id: '', name: sprintNames[sprintNames.length - 2] } : null,
      };
    }).filter(Boolean);

    return { items, unknownStatuses: [...unknown], skipped };
  }

  /* ───────────── CRUD: задачи ───────────── */

  function makeTask({ key, title, type, points, status, unplanned, assignee }) {
    const st = STATUS_IDS.includes(status) ? status : 'todo';
    const now = new Date().toISOString();
    return {
      id: uid(),
      key: (key || '').trim().toUpperCase().slice(0, 24),
      title: title.trim(),
      type: (type || '').trim().slice(0, 32),
      points: points === '' || points === null || points === undefined || isNaN(Number(points))
        ? null : Math.max(0, Number(points)),
      status: st,
      unplanned: !!unplanned,
      dropped: false,
      dropReason: 'carry',
      // Откуда приехала задача, куда уехала и сколько спринтов уже едет (0 — свежая)
      carriedFrom: null,
      carriedTo: null,
      carryCount: 0,
      assignee: (assignee || '').trim(),
      createdAt: now,
      doneAt: st === 'done' ? now : null,
      droppedAt: null,
    };
  }

  function addTask(sprintId, data) {
    const s = sprintById(sprintId);
    if (!s) return null;
    const task = makeTask(data);
    s.tasks.unshift(task);
    save();
    return task;
  }

  /**
   * Массовый ввод. Строка вида «DEV-123 "Название" Задача Готово 3».
   * Если задача с таким же ключом уже есть в спринте — она обновляется,
   * а не дублируется: можно спокойно перезаливать выгрузку из трекера.
   *
   * @returns {{added:number, updated:number, total:number}}
   */
  function addTasksBulk(sprintId, text, defaults = {}) {
    return addTasksFromItems(sprintId, parseBulkText(text, defaults));
  }

  /**
   * Добавляет пачку уже разобранных задач с обновлением по номеру.
   * @returns {{added:number, updated:number, total:number}}
   */
  function addTasksFromItems(sprintId, items) {
    const s = sprintById(sprintId);
    if (!s || !items) return { added: 0, updated: 0, total: 0 };

    const created = [];
    let updated = 0;

    items.forEach(item => {
      const existing = item.key && s.tasks.find(t => t.key && t.key === item.key);
      if (existing) {
        // Обновляем только то, что знает трекер. Unplanned и «Не закроем» — наши локальные
        // решения, в выгрузке их нет, поэтому повторный импорт их не трогает.
        applyTaskPatch(existing, {
          title: item.title,
          type: item.type || existing.type,
          points: item.points === null ? existing.points : item.points,
          status: item.status,
          assignee: item.assignee || existing.assignee,
          carryCount: item.carryCount || existing.carryCount,
          carriedFrom: item.carriedFrom || existing.carriedFrom,
          ...(item.doneAt ? { doneAt: item.doneAt } : {}),
          // Снятие ставим, только если трекер сказал это прямо (Rejected / Hold).
          // Обратно флаг импорт не снимает — это остаётся решением тимлида.
          ...(item.dropped ? { dropped: true, dropReason: item.dropReason } : {}),
        });
        updated++;
      } else {
        const task = makeTask(item);
        if (item.carryCount) {
          task.carryCount = item.carryCount;
          task.carriedFrom = item.carriedFrom;
        }
        // Дата закрытия из выгрузки — чтобы burn-down знал реальный день, а не момент импорта
        if (item.doneAt && task.status === 'done') task.doneAt = item.doneAt;
        if (item.dropped) {
          task.dropped = true;
          task.dropReason = item.dropReason || 'carry';
          task.droppedAt = new Date().toISOString();
        }
        created.push(task);
      }
    });

    s.tasks.unshift(...created);
    save();
    return { added: created.length, updated, total: items.length };
  }

  /** Накатывает изменения на задачу, поддерживая doneAt/droppedAt в согласованном состоянии. */
  function applyTaskPatch(task, patch) {
    if (patch.status && patch.status !== task.status) {
      // doneAt проставляем при входе в Done и снимаем при выходе — на нём строится burn-down
      patch.doneAt = patch.status === 'done'
        ? (patch.doneAt || task.doneAt || new Date().toISOString())
        : null;
      // Закрытая задача не может быть снятой — иначе метрики начинают спорить сами с собой
      if (patch.status === 'done' && task.dropped && patch.dropped === undefined) {
        patch.dropped = false;
      }
    }
    if (patch.dropped !== undefined) {
      patch.dropped = !!patch.dropped;
      // droppedAt — день урезания скоупа, по нему падает линия объёма на burn-up
      patch.droppedAt = patch.dropped ? (task.droppedAt || new Date().toISOString()) : null;
      if (!patch.dropped) patch.carriedTo = null;   // вернули в спринт — переноса больше нет
      if (patch.dropped && (patch.status || task.status) === 'done') patch.status = task.status;
    }
    if (patch.dropReason !== undefined && !DROP_REASON_IDS.includes(patch.dropReason)) {
      patch.dropReason = 'carry';
    }
    if (patch.key !== undefined) patch.key = String(patch.key).trim().toUpperCase().slice(0, 24);
    if (patch.type !== undefined) patch.type = String(patch.type).trim().slice(0, 32);
    Object.assign(task, patch);
    return task;
  }

  function updateTask(sprintId, taskId, patch) {
    const s = sprintById(sprintId);
    if (!s) return null;
    const t = s.tasks.find(x => x.id === taskId);
    if (!t) return null;
    applyTaskPatch(t, patch);
    save();
    return t;
  }

  function setTaskStatus(sprintId, taskId, status) {
    if (!STATUS_IDS.includes(status)) return null;
    return updateTask(sprintId, taskId, { status });
  }

  /** Сдвиг по колонкам: dir = -1 (влево) или +1 (вправо). */
  function shiftTaskStatus(sprintId, taskId, dir) {
    const s = sprintById(sprintId);
    const t = s && s.tasks.find(x => x.id === taskId);
    if (!t) return null;
    const idx = STATUS_IDS.indexOf(t.status);
    const next = STATUS_IDS[Math.min(STATUS_IDS.length - 1, Math.max(0, idx + dir))];
    return setTaskStatus(sprintId, taskId, next);
  }

  /**
   * Задачи, которые имеет смысл предлагать к переносу при закрытии спринта:
   * всё незакрытое, кроме отменённого — отменённое переносить незачем.
   */
  function carryCandidates(sprintId) {
    const s = sprintById(sprintId);
    if (!s) return [];
    return s.tasks.filter(t => t.status !== 'done' && !(t.dropped && t.dropReason === 'cancelled'));
  }

  /**
   * Переносит задачи в другой спринт: в исходном они помечаются «Не закроем · Перенос»,
   * в целевом создаются заново с остаточной оценкой, сохранением номера и стадии работы.
   *
   * @param {Array<{taskId:string, points:number|null}>} items остаточные оценки по задачам
   * @returns {number} сколько задач переехало
   */
  function carryTasks(fromSprintId, toSprintId, items) {
    const from = sprintById(fromSprintId);
    const to = sprintById(toSprintId);
    if (!from || !to || from.id === to.id || !items || !items.length) return 0;

    const created = [];
    items.forEach(({ taskId, points }) => {
      const src = from.tasks.find(t => t.id === taskId);
      if (!src || src.status === 'done') return;

      // В закрываемом спринте задача честно уходит из remaining — и помнит, куда уехала
      applyTaskPatch(src, {
        dropped: true,
        dropReason: 'carry',
        carriedTo: { id: to.id, name: to.name },
      });

      const task = makeTask({
        key: src.key,
        title: src.title,
        type: src.type,
        points: points === null || points === undefined || points === '' ? src.points : points,
        status: src.status,      // стадия работы сохраняется: доделывать с того же места
        unplanned: false,        // в новом спринте это плановая работа, взятая осознанно
        assignee: src.assignee,
      });
      task.carriedFrom = { id: from.id, name: from.name };
      task.carryCount = (src.carryCount || 0) + 1;
      created.push(task);
    });

    to.tasks.unshift(...created);
    save();
    return created.length;
  }

  /** Снять задачу со спринта / вернуть обратно. */
  function toggleTaskDropped(sprintId, taskId, reason) {
    const s = sprintById(sprintId);
    const t = s && s.tasks.find(x => x.id === taskId);
    if (!t) return null;
    return updateTask(sprintId, taskId, {
      dropped: !t.dropped,
      dropReason: reason || t.dropReason || 'carry',
    });
  }

  function deleteTask(sprintId, taskId) {
    const s = sprintById(sprintId);
    if (!s) return;
    s.tasks = s.tasks.filter(t => t.id !== taskId);
    save();
  }

  /* ───────────── Экспорт / импорт ───────────── */

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sprint-progress-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Возвращает нормализованное состояние из текста файла либо бросает ошибку. */
  function parseImport(text) {
    const parsed = JSON.parse(text);
    const next = normalize(parsed);
    if (!next) throw new Error('Файл не похож на бэкап Sprint Progress');
    return next;
  }

  function replaceState(next) {
    state = next;
    save();
  }

  return {
    STATUSES, STATUS_IDS, IN_FLIGHT_IDS, SPRINT_DEFAULT_DAYS, TYPE_ALIASES,
    DROP_REASONS, DROP_REASON_IDS, dropReasonById,
    // разбор массового ввода
    parseBulkLine, parseBulkText, matchStatus, matchType, matchDropStatus, resolveStatus,
    // импорт CSV из Jira
    parseCSV, detectCsvMapping, itemsFromCsv, parseDateTime, CSV_FIELDS, CSV_FIELD_LABELS,
    normalizeStatusKey: normalizeWord,
    // утилиты дат
    uid, toISODate, parseDate, addDays, diffDays, today, dateRange, formatDate, formatRange, normalizeDays,
    // состояние
    load, save, get, sprints, sortedSprints, activeSprint, sprintById, setSetting, taskUrl,
    // спринты
    createSprint, updateSprint, archiveSprint, reopenSprint, deleteSprint, selectSprint,
    // задачи
    addTask, addTasksBulk, addTasksFromItems, updateTask, setTaskStatus, shiftTaskStatus, toggleTaskDropped, deleteTask,
    carryCandidates, carryTasks,
    // данные
    exportJSON, parseImport, replaceState,
  };
})();
