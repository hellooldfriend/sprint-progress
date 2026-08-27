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
       tasks: [{ id, title, points:number|null, status, unplanned:boolean,
                 assignee:string, createdAt:ISO, doneAt:ISO|null }]
     }]
   }
   ============================================================ */
const Store = (() => {
  'use strict';

  const KEY = 'sprint-progress:v1';
  const SPRINT_DEFAULT_DAYS = 14;

  /** Колонки канбана. Порядок задаёт и порядок перемещения стрелками. */
  const STATUSES = [
    { id: 'backlog',  label: 'Backlog',     color: 'var(--faint)',  dot: 'dot--muted'  },
    { id: 'todo',     label: 'To Do',       color: 'var(--muted)',  dot: 'dot--muted'  },
    { id: 'progress', label: 'In Progress', color: 'var(--blue)',   dot: 'dot--blue'   },
    { id: 'review',   label: 'Review',      color: 'var(--accent)', dot: 'dot--accent' },
    { id: 'done',     label: 'Done',        color: 'var(--green)',  dot: 'dot--green'  },
  ];
  const STATUS_IDS = STATUSES.map(s => s.id);

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

  /* ───────────── Демо-данные для первого запуска ───────────── */

  function demoSprint() {
    const start = addDays(today(), -5);
    const end = addDays(start, SPRINT_DEFAULT_DAYS - 1);
    const at = (dayOffset, hour = 14) => {
      const d = parseDate(addDays(start, dayOffset));
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    };

    // [название, SP, статус, unplanned, исполнитель, день создания, день закрытия]
    const rows = [
      ['Дизайн новой страницы онбординга',      5, 'done',     false, 'Аня',   0, 1],
      ['API: эндпоинт /v2/sprints',             8, 'done',     false, 'Марат', 0, 3],
      ['Мобильная вёрстка дашборда',            5, 'done',     false, 'Лена',  0, 4],
      ['Миграция БД на новую схему',            5, 'progress', false, 'Марат', 0, null],
      ['Рефакторинг компонента TaskCard',       3, 'review',   false, 'Лена',  0, null],
      ['Интеграционные тесты для биллинга',     8, 'todo',     false, 'Дима',  0, null],
      ['Аналитика: события воронки регистрации',3, 'todo',     false, 'Аня',   0, null],
      ['Обновить документацию API',             2, 'backlog',  false, '',      0, null],
      ['Хотфикс: падение при экспорте CSV',     2, 'done',     true,  'Дима',  2, 2],
      ['Поднять лимиты на проде',               1, 'done',     true,  'Марат', 4, 4],
      ['Запрос от поддержки: выгрузка логов',   3, 'progress', true,  'Дима',  4, null],
    ];

    return {
      id: uid(),
      name: 'Спринт 24 — Онбординг',
      goal: 'Раскатить новый онбординг на 100% трафика',
      startDate: start,
      endDate: end,
      status: 'active',
      createdAt: at(0, 10),
      archivedAt: null,
      tasks: rows.map(([title, points, status, unplanned, assignee, born, closed]) => ({
        id: uid(),
        title,
        points,
        status,
        unplanned,
        assignee,
        createdAt: at(born, unplanned ? 11 : 10),
        doneAt: closed === null ? null : at(closed, 17),
      })),
    };
  }

  function demoState() {
    const sprint = demoSprint();
    return {
      version: 1,
      activeSprintId: sprint.id,
      settings: { metricMode: 'points', chartMode: 'burndown' },
      sprints: [sprint],
    };
  }

  function emptyState() {
    return {
      version: 1,
      activeSprintId: null,
      settings: { metricMode: 'points', chartMode: 'burndown' },
      sprints: [],
    };
  }

  /* ───────────── Загрузка / сохранение ───────────── */

  let state = null;

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
        tasks: Array.isArray(s.tasks) ? s.tasks.filter(Boolean).map(t => {
          const status = STATUS_IDS.includes(t.status) ? t.status : 'todo';
          const points = Number.isFinite(Number(t.points)) && t.points !== null && t.points !== ''
            ? Math.max(0, Number(t.points)) : null;
          return {
            id: t.id || uid(),
            title: String(t.title || 'Без названия').slice(0, 200),
            points,
            status,
            unplanned: !!t.unplanned,
            assignee: String(t.assignee || '').slice(0, 60),
            createdAt: t.createdAt || new Date().toISOString(),
            doneAt: status === 'done' ? (t.doneAt || new Date().toISOString()) : null,
          };
        }) : [],
      };
    });

    const settings = {
      metricMode: raw.settings && raw.settings.metricMode === 'tasks' ? 'tasks' : 'points',
      chartMode: raw.settings && raw.settings.chartMode === 'burnup' ? 'burnup' : 'burndown',
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
    if (!state) {            // первый запуск или битые данные — показываем демо
      state = demoState();
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

  function setSetting(key, value) {
    state.settings[key] = value;
    save();
  }

  /* ───────────── CRUD: спринты ───────────── */

  function createSprint({ name, goal, startDate, endDate }) {
    const sprint = {
      id: uid(),
      name: name.trim(),
      goal: (goal || '').trim(),
      startDate,
      endDate,
      status: 'active',
      createdAt: new Date().toISOString(),
      archivedAt: null,
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

  /* ───────────── CRUD: задачи ───────────── */

  function makeTask({ title, points, status, unplanned, assignee }) {
    const st = STATUS_IDS.includes(status) ? status : 'todo';
    const now = new Date().toISOString();
    return {
      id: uid(),
      title: title.trim(),
      points: points === '' || points === null || points === undefined || isNaN(Number(points))
        ? null : Math.max(0, Number(points)),
      status: st,
      unplanned: !!unplanned,
      assignee: (assignee || '').trim(),
      createdAt: now,
      doneAt: st === 'done' ? now : null,
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

  /** Массовый ввод: «!Название | 5» → задача unplanned на 5 SP. */
  function addTasksBulk(sprintId, text, { status, unplanned }) {
    const s = sprintById(sprintId);
    if (!s) return 0;

    const created = text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        let forceUnplanned = false;
        if (line.startsWith('!')) { forceUnplanned = true; line = line.slice(1).trim(); }

        let points = null;
        const parts = line.split('|');
        if (parts.length > 1) {
          const tail = parts.pop().trim().replace(',', '.');
          const num = parseFloat(tail);
          if (!isNaN(num)) { points = Math.max(0, num); line = parts.join('|').trim(); }
        }
        if (!line) return null;
        return makeTask({ title: line, points, status, unplanned: unplanned || forceUnplanned });
      })
      .filter(Boolean);

    s.tasks.unshift(...created);
    save();
    return created.length;
  }

  function updateTask(sprintId, taskId, patch) {
    const s = sprintById(sprintId);
    if (!s) return null;
    const t = s.tasks.find(x => x.id === taskId);
    if (!t) return null;

    if (patch.status && patch.status !== t.status) {
      // doneAt проставляем при входе в Done и снимаем при выходе — на нём строится burn-down
      patch.doneAt = patch.status === 'done' ? (t.doneAt || new Date().toISOString()) : null;
    }
    Object.assign(t, patch);
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
    STATUSES, STATUS_IDS, SPRINT_DEFAULT_DAYS,
    // утилиты дат
    uid, toISODate, parseDate, addDays, diffDays, today, dateRange, formatDate, formatRange,
    // состояние
    load, save, get, sprints, sortedSprints, activeSprint, sprintById, setSetting,
    // спринты
    createSprint, updateSprint, archiveSprint, reopenSprint, deleteSprint, selectSprint,
    // задачи
    addTask, addTasksBulk, updateTask, setTaskStatus, shiftTaskStatus, deleteTask,
    // данные
    exportJSON, parseImport, replaceState,
  };
})();
