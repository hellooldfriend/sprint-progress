/* ============================================================
   metrics.js — весь счёт спринта в одном месте.
   Ничего не рендерит и не трогает хранилище: чистые функции.
   ============================================================ */
const Metrics = (() => {
  'use strict';

  /** Вес задачи в выбранной единице: story points или «одна задача = 1». */
  const weight = (task, mode) => (mode === 'tasks' ? 1 : (Number(task.points) || 0));

  const sum = (tasks, mode) => tasks.reduce((acc, t) => acc + weight(t, mode), 0);

  /** Локальная дата (YYYY-MM-DD) из ISO-таймстемпа. */
  const dayOf = iso => Store.toISODate(new Date(iso));

  const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

  /**
   * Полный набор метрик спринта — сразу в обеих единицах,
   * чтобы переключатель «SP / задачи» не требовал пересчёта.
   */
  function sprintMetrics(sprint) {
    const tasks = sprint.tasks || [];
    const planned = tasks.filter(t => !t.unplanned);
    const unplanned = tasks.filter(t => t.unplanned);
    const done = tasks.filter(t => t.status === 'done');
    const doneP = planned.filter(t => t.status === 'done');
    const doneU = unplanned.filter(t => t.status === 'done');
    const inProgress = tasks.filter(t => t.status === 'progress' || t.status === 'review');

    const byStatus = {};
    Store.STATUS_IDS.forEach(id => {
      const list = tasks.filter(t => t.status === id);
      byStatus[id] = { count: list.length, points: sum(list, 'points') };
    });

    const totalTasks = tasks.length;
    const totalPoints = sum(tasks, 'points');
    const doneTasks = done.length;
    const donePoints = sum(done, 'points');

    // Прогресс по времени: сколько дней спринта уже прошло
    const totalDays = Store.diffDays(sprint.startDate, sprint.endDate) + 1;
    const elapsedRaw = Store.diffDays(sprint.startDate, Store.today()) + 1;
    const elapsedDays = Math.min(totalDays, Math.max(0, elapsedRaw));
    const daysLeft = Math.max(0, totalDays - elapsedDays);
    const timePct = pct(elapsedDays, totalDays);

    const remainingTasks = totalTasks - doneTasks;
    const remainingPoints = totalPoints - donePoints;

    // Темп: закрыто в день (по прошедшим дням) и сколько нужно закрывать, чтобы успеть
    const paceTasks = elapsedDays > 0 ? doneTasks / elapsedDays : 0;
    const pacePoints = elapsedDays > 0 ? donePoints / elapsedDays : 0;
    const needTasks = daysLeft > 0 ? remainingTasks / daysLeft : remainingTasks;
    const needPoints = daysLeft > 0 ? remainingPoints / daysLeft : remainingPoints;

    return {
      totalTasks, totalPoints,
      plannedTasks: planned.length,   plannedPoints: sum(planned, 'points'),
      unplannedTasks: unplanned.length, unplannedPoints: sum(unplanned, 'points'),
      doneTasks, donePoints,
      donePlannedTasks: doneP.length, donePlannedPoints: sum(doneP, 'points'),
      doneUnplannedTasks: doneU.length, doneUnplannedPoints: sum(doneU, 'points'),
      inProgressTasks: inProgress.length, inProgressPoints: sum(inProgress, 'points'),
      remainingTasks, remainingPoints,
      pctTasks: pct(doneTasks, totalTasks),
      pctPoints: pct(donePoints, totalPoints),
      unplannedShareTasks: pct(unplanned.length, totalTasks),
      unplannedSharePoints: pct(sum(unplanned, 'points'), totalPoints),
      velocity: donePoints,           // velocity спринта = SP в Done
      byStatus,
      totalDays, elapsedDays, daysLeft, timePct,
      paceTasks, pacePoints, needTasks, needPoints,
      isEmpty: totalTasks === 0,
    };
  }

  /** Значения метрик в текущей единице измерения — чтобы UI не ветвился. */
  function inMode(m, mode) {
    const p = mode === 'points';
    return {
      unit: p ? 'SP' : 'задач',
      total: p ? m.totalPoints : m.totalTasks,
      planned: p ? m.plannedPoints : m.plannedTasks,
      unplanned: p ? m.unplannedPoints : m.unplannedTasks,
      done: p ? m.donePoints : m.doneTasks,
      donePlanned: p ? m.donePlannedPoints : m.donePlannedTasks,
      doneUnplanned: p ? m.doneUnplannedPoints : m.doneUnplannedTasks,
      inProgress: p ? m.inProgressPoints : m.inProgressTasks,
      remaining: p ? m.remainingPoints : m.remainingTasks,
      pct: p ? m.pctPoints : m.pctTasks,
      unplannedShare: p ? m.unplannedSharePoints : m.unplannedShareTasks,
      pace: p ? m.pacePoints : m.paceTasks,
      need: p ? m.needPoints : m.needTasks,
    };
  }

  /**
   * Серии для burn-down / burn-up.
   * История восстанавливается из createdAt (когда задача попала в спринт)
   * и doneAt (когда закрыта) — ручной ввод не нужен.
   *
   * scope[i]     — объём работ на конец дня i (растёт от unplanned-задач)
   * completed[i] — накопленно закрыто к концу дня i
   * remaining[i] — scope - completed
   * ideal[i]     — равномерное сгорание изначального объёма
   * Точки после сегодняшнего дня равны null → линия просто обрывается.
   */
  function burnSeries(sprint, mode) {
    const days = Store.dateRange(sprint.startDate, sprint.endDate);
    const tasks = sprint.tasks || [];
    const todayISO = Store.today();

    // Задачи, заведённые до старта спринта, считаем объёмом нулевого дня
    const bornDay = t => {
      const d = dayOf(t.createdAt);
      return d < sprint.startDate ? sprint.startDate : d;
    };

    const scope = [], completed = [], remaining = [], ideal = [];

    days.forEach((day, i) => {
      const isFuture = day > todayISO;
      const scopeVal = tasks.reduce((acc, t) => acc + (bornDay(t) <= day ? weight(t, mode) : 0), 0);
      const doneVal = tasks.reduce(
        (acc, t) => acc + (t.doneAt && dayOf(t.doneAt) <= day ? weight(t, mode) : 0), 0);

      scope.push(scopeVal);
      completed.push(isFuture ? null : doneVal);
      remaining.push(isFuture ? null : scopeVal - doneVal);
      ideal.push(null); // заполняется ниже, когда известен стартовый объём
    });

    // Идеальная линия: от объёма на старте (плановый scope) до нуля к последнему дню
    const startScope = scope[0] || 0;
    const lastIdx = Math.max(1, days.length - 1);
    for (let i = 0; i < days.length; i++) {
      ideal[i] = Math.max(0, startScope * (1 - i / lastIdx));
    }

    // «Сегодня» на оси X (или -1, если спринт ещё не начался / уже закончился)
    const todayIdx = days.indexOf(todayISO);

    return { days, scope, completed, remaining, ideal, todayIdx, startScope };
  }

  /** Короткое число: 12, 12.5, 0 */
  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  /** Склонение: 3 → «3 задачи» */
  function plural(n, one, few, many) {
    const a = Math.abs(Math.round(n)) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  return { weight, sum, sprintMetrics, inMode, burnSeries, pct, fmt, plural };
})();
