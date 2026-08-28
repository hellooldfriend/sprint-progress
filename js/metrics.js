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
    // Снятые со спринта: в объём обязательства входят, в remaining и в темп — нет
    const dropped = tasks.filter(t => t.dropped);
    // Приехали из прошлых спринтов: это долг, а не свежевзятая работа
    const carried = tasks.filter(t => (t.carryCount || 0) > 0);
    // Уехали дальше: для закрытого спринта это ответ на вопрос «куда делось несделанное»
    const carriedOut = tasks.filter(t => t.carriedTo);
    // Долгожители: carryCount >= 2 значит задача идёт третий спринт подряд
    const longRunners = tasks.filter(t => (t.carryCount || 0) >= 2);
    const doneP = planned.filter(t => t.status === 'done');
    const doneU = unplanned.filter(t => t.status === 'done');
    // «В работе» — всё, что начали, но ещё не закрыли: от In Progress до Deploy
    const inProgress = tasks.filter(t => Store.IN_FLIGHT_IDS.includes(t.status) && !t.dropped);

    /**
     * Кто работал над спринтом. Имена приходят из поля «Исполнитель» выгрузки,
     * поэтому сравниваем без учёта регистра и лишних пробелов, а показываем
     * то написание, которое встретилось первым.
     */
    const people = new Map();
    tasks.forEach(t => {
      const name = String(t.assignee || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      const entry = people.get(key) || { name, tasks: 0, points: 0, doneTasks: 0, donePoints: 0 };
      // Из разных написаний одного имени показываем самое опрятное: «Марат» лучше «МАРАТ» и «марат»
      if (nameScore(name) > nameScore(entry.name)) entry.name = name;
      entry.tasks++;
      entry.points += Number(t.points) || 0;
      if (t.status === 'done') {
        entry.doneTasks++;
        entry.donePoints += Number(t.points) || 0;
      }
      people.set(key, entry);
    });
    const byAssignee = [...people.values()].sort((a, b) =>
      b.points - a.points || b.tasks - a.tasks || a.name.localeCompare(b.name, 'ru'));

    const unassigned = tasks.filter(t => !String(t.assignee || '').trim());

    const byStatus = {};
    Store.STATUS_IDS.forEach(id => {
      const list = tasks.filter(t => t.status === id);
      byStatus[id] = { count: list.length, points: sum(list, 'points') };
    });

    const totalTasks = tasks.length;
    const totalPoints = sum(tasks, 'points');
    const doneTasks = done.length;
    const donePoints = sum(done, 'points');

    /**
     * Ёмкость и факт в человеко-днях. Заполняются вручную и только если команда
     * этого хочет — все производные метрики ниже становятся null, если данных нет.
     */
    const capacity = sprint.capacity || null;
    const spent = sprint.spent || null;
    // Сколько взяли относительно ёмкости: 1.38 значит перебор на 38%
    const commitRatio = capacity ? totalPoints / capacity : null;
    // Фокус-фактор: какая доля ёмкости реально ушла в задачи спринта, а не в митинги и поддержку
    const focusFactor = capacity && spent ? spent / capacity : null;
    // Точность оценки: сколько SP закрывали на один потраченный человеко-день
    const estimateAccuracy = spent ? donePoints / spent : null;

    // Прогресс по времени: сколько дней спринта уже прошло
    const totalDays = Store.diffDays(sprint.startDate, sprint.endDate) + 1;
    const elapsedRaw = Store.diffDays(sprint.startDate, Store.today()) + 1;
    const elapsedDays = Math.min(totalDays, Math.max(0, elapsedRaw));
    const daysLeft = Math.max(0, totalDays - elapsedDays);
    const timePct = pct(elapsedDays, totalDays);

    const droppedTasks = dropped.length;
    const droppedPoints = sum(dropped, 'points');

    // Не сделано = всё, что не в Done, включая снятое. Для закрытого спринта это главная цифра
    const notDoneTasks = totalTasks - doneTasks;
    const notDonePoints = totalPoints - donePoints;

    // Куда уехало несделанное: [{ name, count, points }]
    const carryDestinations = Object.values(
      carriedOut.reduce((acc, t) => {
        const key = t.carriedTo.id || t.carriedTo.name;
        acc[key] = acc[key] || { name: t.carriedTo.name, count: 0, points: 0 };
        acc[key].count++;
        acc[key].points += Number(t.points) || 0;
        return acc;
      }, {})
    );

    // Реально осталось работы = всё минус закрытое минус снятое
    const remainingTasks = totalTasks - doneTasks - droppedTasks;
    const remainingPoints = totalPoints - donePoints - droppedPoints;

    // Разбивка снятого по причинам — для подписи на карточке и разговора на ретро
    const dropByReason = Store.DROP_REASONS
      .map(r => ({
        ...r,
        count: dropped.filter(t => t.dropReason === r.id).length,
        points: sum(dropped.filter(t => t.dropReason === r.id), 'points'),
      }))
      .filter(r => r.count > 0);

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
      droppedTasks, droppedPoints, dropByReason,
      notDoneTasks, notDonePoints,
      carriedOutTasks: carriedOut.length, carriedOutPoints: sum(carriedOut, 'points'),
      carryDestinations,
      carriedTasks: carried.length, carriedPoints: sum(carried, 'points'),
      carriedShareTasks: pct(carried.length, totalTasks),
      carriedSharePoints: pct(sum(carried, 'points'), totalPoints),
      longRunners: longRunners.length,
      maxCarryCount: carried.reduce((max, t) => Math.max(max, t.carryCount || 0), 0),
      droppedShareTasks: pct(droppedTasks, totalTasks),
      droppedSharePoints: pct(droppedPoints, totalPoints),
      donePlannedTasks: doneP.length, donePlannedPoints: sum(doneP, 'points'),
      doneUnplannedTasks: doneU.length, doneUnplannedPoints: sum(doneU, 'points'),
      inProgressTasks: inProgress.length, inProgressPoints: sum(inProgress, 'points'),
      remainingTasks, remainingPoints,
      pctTasks: pct(doneTasks, totalTasks),
      pctPoints: pct(donePoints, totalPoints),
      unplannedShareTasks: pct(unplanned.length, totalTasks),
      unplannedSharePoints: pct(sum(unplanned, 'points'), totalPoints),
      velocity: donePoints,           // velocity спринта = SP в Done
      capacity, spent, commitRatio, focusFactor, estimateAccuracy,
      byStatus,
      participants: byAssignee.length,
      byAssignee,
      unassignedTasks: unassigned.length,
      unassignedPoints: sum(unassigned, 'points'),
      totalDays, elapsedDays, daysLeft, timePct,
      paceTasks, pacePoints, needTasks, needPoints,
      isEmpty: totalTasks === 0,
    };
  }

  /** Насколько «нормально» выглядит написание имени: 2 — Марат, 1 — МАРАТ, 0 — марат. */
  function nameScore(name) {
    const first = name[0] || '';
    if (first !== first.toLowerCase()) {
      const rest = name.slice(1);
      return rest === rest.toUpperCase() && rest !== rest.toLowerCase() ? 1 : 2;
    }
    return 0;
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
      dropped: p ? m.droppedPoints : m.droppedTasks,
      droppedShare: p ? m.droppedSharePoints : m.droppedShareTasks,
      notDone: p ? m.notDonePoints : m.notDoneTasks,
      carriedOut: p ? m.carriedOutPoints : m.carriedOutTasks,
      carried: p ? m.carriedPoints : m.carriedTasks,
      carriedShare: p ? m.carriedSharePoints : m.carriedShareTasks,
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

    /**
     * День, с которого задача входит в объём спринта.
     * Плановая — это обязательство, взятое на планировании: она в объёме с первого дня,
     * когда бы её физически ни завели в инструменте (например, импортом в середине спринта).
     * Внеплановая входит в объём в день, когда появилась.
     */
    const bornDay = t => {
      if (!t.unplanned) return sprint.startDate;
      const d = dayOf(t.createdAt);
      return d < sprint.startDate ? sprint.startDate : d;
    };
    // Задача в объёме дня, если уже заведена и ещё не снята со спринта
    const inScope = (t, day) =>
      bornDay(t) <= day && !(t.dropped && t.droppedAt && dayOf(t.droppedAt) <= day);

    const scope = [], completed = [], remaining = [], ideal = [];

    days.forEach((day, i) => {
      const isFuture = day > todayISO;
      const scopeVal = tasks.reduce((acc, t) => acc + (inScope(t, day) ? weight(t, mode) : 0), 0);
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
