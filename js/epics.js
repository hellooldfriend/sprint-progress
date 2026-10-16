/* ============================================================
   epics.js — расчёты для планирования эпиков (чистые функции).
   Готовность, окно эпика, длительность по HLE, очередь по неделям, предупреждения.

   HLE — человеко-дни. Сколько людей нужно эпику = HLE / рабочих дней окна:
   10 п/д на две недели — один человек, на одну — двое. Исполнитель в расчётах
   не участвует: эпики ведёт один ответственный, а делает их команда.
   ============================================================ */
const Epics = (() => {
  'use strict';

  /** Длительность по умолчанию, когда эпик ставят в план без оценки: две рабочие недели. */
  const DEFAULT_WINDOW_DAYS = 10;

  const isScheduled = e => !!(e.plannedStart && e.plannedEnd);

  /**
   * Готовность эпика — прошёл ли он груминг. Считается по статусу и HLE, а не отдельным флагом:
   * статус приезжает из Jira, и два источника правды разъехались бы на первом же импорте.
   *
   *   requirements — Backlog, Requirements definition: требования ещё не понятны;
   *   estimate     — Ready for HLE / Готов к разработке без оценки: требования понятны, ждём HLE;
   *   ready        — Ready for HLE / Готов к разработке с оценкой: можно брать в работу;
   *   progress     — Development … Ready for Deploy: уже делаем;
   *   closed       — Готово, Rejected.
   *
   * Первые две — «не прошли груминг», ready и progress — «прошли».
   */
  const STAGES = [
    { id: 'requirements', label: 'Требования',        hint: 'Требования ещё не понятны',            groomed: false, color: 'var(--amber)' },
    { id: 'estimate',     label: 'Ждут HLE',          hint: 'Требования понятны, нет оценки',       groomed: false, color: 'var(--accent)' },
    { id: 'ready',        label: 'Готовы к работе',   hint: 'Требования понятны, HLE проставлен',   groomed: true,  color: 'var(--green)' },
    { id: 'progress',     label: 'В работе',          hint: 'Development, тестирование, деплой',    groomed: true,  color: 'var(--blue)' },
    { id: 'closed',       label: 'Закрыты',           hint: 'Готово и Rejected',                    groomed: null,  color: 'var(--faint)' },
  ];
  const stageById = id => STAGES.find(s => s.id === id);
  const GROOMING = ['ready_for_hle', 'ready_for_dev'];
  const IN_WORK = ['development', 'ready_for_testing', 'testing', 'ready_for_deploy'];

  function stage(e) {
    if (Store.isEpicClosed(e)) return 'closed';
    if (IN_WORK.includes(e.status)) return 'progress';
    if (GROOMING.includes(e.status)) return e.hle ? 'ready' : 'estimate';
    return 'requirements';
  }
  /** true — прошёл груминг, false — нет, null — закрыт (вопрос уже не стоит). */
  const isGroomed = e => stageById(stage(e)).groomed;

  /** Секции бэклога и группы Ганта «по готовности». */
  const READINESS_GROUPS = [
    { key: 'groomed',   name: 'Прошли груминг',    hint: 'Требования понятны, HLE проставлен — готовы к работе или уже в ней' },
    { key: 'ungroomed', name: 'Не прошли груминг', hint: 'Требования не понятны или нет оценки HLE' },
    { key: 'closed',    name: 'Закрытые',          hint: 'Готово и Rejected' },
  ];
  const readinessKey = e => {
    const g = isGroomed(e);
    return g === null ? 'closed' : g ? 'groomed' : 'ungroomed';
  };

  /**
   * Сводка по готовности: сколько эпиков и HLE на каждой стадии.
   * @returns {{stages: Array<{id,label,hint,color,count,hle,noHle}>, groomed, ungroomed}}
   */
  function readiness(list) {
    const stages = STAGES.map(st => {
      const mine = list.filter(e => stage(e) === st.id);
      return { ...st, count: mine.length, hle: mine.reduce((a, e) => a + (e.hle || 0), 0),
               noHle: mine.filter(e => e.hle === null).length };
    });
    const sum = flag => stages.filter(s => s.groomed === flag)
      .reduce((acc, s) => ({ count: acc.count + s.count, hle: acc.hle + s.hle }), { count: 0, hle: 0 });
    return { stages, groomed: sum(true), ungroomed: sum(false) };
  }

  /** Ближайший рабочий день, начиная с данного. */
  function nextWorkingDay(iso) {
    let day = iso;
    while (!Store.isWorkingDay(day)) day = Store.addDays(day, 1);
    return day;
  }

  /**
   * Окончание по HLE: старт + столько рабочих дней, сколько человеко-дней в оценке.
   * Старт в выходной сдвигается на понедельник — в субботу эпик никто не начнёт.
   * @returns {{start:string, end:string}}
   */
  function windowFromHle(start, hle) {
    const from = nextWorkingDay(start);
    const need = Math.max(1, Math.ceil(hle > 0 ? hle : DEFAULT_WINDOW_DAYS));
    let end = from, counted = 1;
    while (counted < need) {
      end = Store.addDays(end, 1);
      if (Store.isWorkingDay(end)) counted++;
    }
    return { start: from, end };
  }

  /** Рабочих дней в окне эпика. */
  const windowDays = e => (isScheduled(e) ? Store.workingDays(e.plannedStart, e.plannedEnd) : 0);

  /** Сколько людей нужно, чтобы уложить HLE в окно: 1 — один человек целиком. */
  function intensity(e) {
    const days = windowDays(e);
    return e.hle && days ? e.hle / days : 0;
  }

  /** Понедельник недели, в которую попадает дата. */
  function weekStart(iso) {
    const day = Store.parseDate(iso).getDay();       // 0 — воскресенье
    return Store.addDays(iso, day === 0 ? -6 : 1 - day);
  }

  /**
   * Диапазон шкалы: от понедельника перед самым ранним стартом (или за 2 недели до сегодня)
   * до воскресенья после самого позднего окончания (или через ~3 месяца от сегодня).
   */
  function timelineRange(list, today) {
    const scheduled = list.filter(isScheduled);
    let start = Store.addDays(today, -14);
    let end = Store.addDays(today, 91);
    scheduled.forEach(e => {
      if (e.plannedStart < start) start = Store.addDays(e.plannedStart, -7);
      if (e.plannedEnd > end) end = Store.addDays(e.plannedEnd, 21);
    });
    start = weekStart(start);
    end = Store.addDays(weekStart(end), 6);
    return { start, end, days: Store.diffDays(start, end) + 1 };
  }

  /** Понедельники диапазона. */
  function weeksOf(range) {
    const out = [];
    for (let d = range.start; d <= range.end; d = Store.addDays(d, 7)) out.push(d);
    return out;
  }

  /**
   * Что не так с эпиком — для подсветки на Ганте и счётчиков над ним.
   * @returns {Array<{id:string, text:string, level:'warn'|'err'}>}
   */
  function issues(e, today) {
    if (Store.isEpicClosed(e)) return [];
    const out = [];
    if (!isScheduled(e)) out.push({ id: 'unscheduled', text: 'Нет Planned Start / End', level: 'warn' });
    if (e.hle === null) out.push({ id: 'no-hle', text: 'Нет оценки HLE', level: 'warn' });
    if (isScheduled(e) && e.hle) {
      const days = windowDays(e);
      if (e.hle > days) {
        out.push({
          id: 'squeezed', level: 'err',
          text: `HLE ${Metrics.fmt(e.hle)} п/д не влезает в окно ${days} ${Metrics.plural(days, 'рабочий день', 'рабочих дня', 'рабочих дней')} для одного человека`,
        });
      }
    }
    if (isScheduled(e) && e.plannedEnd < today) {
      out.push({ id: 'overdue', text: `Planned End прошёл ${Store.formatDate(e.plannedEnd)}, а эпик не закрыт`, level: 'err' });
    }
    return out;
  }

  /**
   * Сводка для карточек над Гантом. Считается по открытым эпикам: закрытые — история, а не план.
   */
  function overview(list, today) {
    const open = list.filter(e => !Store.isEpicClosed(e));

    const has = id => open.filter(e => issues(e, today).some(i => i.id === id));
    return {
      total: list.length,
      open: open.length,
      scheduled: open.filter(isScheduled).length,
      unscheduled: has('unscheduled').length,
      hleTotal: open.reduce((acc, e) => acc + (e.hle || 0), 0),
      noHle: has('no-hle').length,
      squeezed: has('squeezed').length,
      overdue: has('overdue').length,
    };
  }

  /**
   * Группы строк Ганта: по готовности («прошли / не прошли груминг») или одним списком.
   * Внутри — по ручному приоритету.
   */
  function groupRows(list, mode) {
    // Порядок — ручной приоритет; без него (данные тестов, сырой импорт) — по дате старта
    const byStart = (a, b) => {
      const ra = a.rank ?? Infinity, rb = b.rank ?? Infinity;
      if (ra !== rb) return ra - rb;
      if (isScheduled(a) !== isScheduled(b)) return isScheduled(a) ? -1 : 1;
      if (isScheduled(a) && a.plannedStart !== b.plannedStart) return a.plannedStart < b.plannedStart ? -1 : 1;
      return a.key.localeCompare(b.key, 'ru', { numeric: true });
    };
    if (mode === 'readiness') {
      return READINESS_GROUPS
        .map(g => ({ ...g, epics: list.filter(e => readinessKey(e) === g.key).sort(byStart) }))
        .filter(g => g.epics.length);
    }
    return [{ key: null, name: null, epics: [...list].sort(byStart) }];
  }

  /* ───────────── Очередь: эпики по неделям ───────────── */

  /** Сколько недель занять эпику по умолчанию: HLE / 5 рабочих дней, без оценки — две недели. */
  function defaultSpan(hle) {
    if (!hle) return 2;
    return Math.min(Store.QUEUE_MAX_SPAN, Math.max(1, Math.ceil(hle / 5)));
  }

  /** Последний понедельник, который занимает эпик в очереди. */
  const queueLastWeek = e => Store.addDays(e.queue.week, (e.queue.span - 1) * 7);
  const inQueueWeek = (e, week) => !!e.queue && week >= e.queue.week && week <= queueLastWeek(e);

  /**
   * Недели доски: с текущей (или с самой ранней занятой, если что-то осталось в прошлом)
   * и минимум на квартал вперёд, с запасом в пару недель за последним эпиком.
   */
  function queueWeeks(list, today, minWeeks = 12) {
    const now = weekStart(today);
    let first = now, last = Store.addDays(now, (minWeeks - 1) * 7);
    list.filter(e => e.queue).forEach(e => {
      if (e.queue.week < first) first = e.queue.week;
      const end = Store.addDays(queueLastWeek(e), 14);
      if (end > last) last = end;
    });
    const out = [];
    for (let w = first; w <= last; w = Store.addDays(w, 7)) out.push(w);
    return out;
  }

  /**
   * Что взято на каждую неделю: сколько эпиков и сколько примерно нужно людей.
   * Человек на эпик = HLE / (недель × 5 дней) — та же модель, что и в загрузке Ганта.
   * Закрытые эпики неделю не занимают.
   */
  function queueStats(list, weeks) {
    return weeks.map(week => {
      const here = list.filter(e => !Store.isEpicClosed(e) && inQueueWeek(e, week));
      return {
        week,
        count: here.length,
        people: here.reduce((acc, e) => acc + (e.hle ? e.hle / (e.queue.span * 5) : 0), 0),
        unknown: here.filter(e => !e.hle).length,
        ungroomed: here.filter(e => isGroomed(e) === false).length,
      };
    });
  }

  /**
   * Что получится, если перенести очередь в Planned Start / End:
   * старт — понедельник первой недели, окончание — пятница последней.
   * Закрытые эпики не трогаем: их даты — уже история.
   *
   * @returns {{changes: Array<{epic, start, end, overwrite:boolean}>, same:number}}
   */
  function queueToPlan(list) {
    const changes = [];
    let same = 0;
    list.filter(e => e.queue && !Store.isEpicClosed(e)).forEach(e => {
      const start = e.queue.week;
      const end = Store.addDays(queueLastWeek(e), 4);
      if (e.plannedStart === start && e.plannedEnd === end) { same++; return; }
      changes.push({ epic: e, start, end, overwrite: !!(e.plannedStart || e.plannedEnd) });
    });
    return { changes, same };
  }

  /**
   * Обратный перенос: Planned Start / End → очередь. Неделя — понедельник недели старта,
   * длина — сколько календарных недель задевает окно. Так круг «очередь → Гант → очередь»
   * ничего не сдвигает: пн–пт трёх недель снова становятся тремя неделями.
   * Эпики без дат и закрытые не трогаем.
   *
   * @returns {{changes: Array<{epic, week, span, overwrite:boolean}>, same:number}}
   */
  function planToQueue(list) {
    const changes = [];
    let same = 0;
    list.filter(e => isScheduled(e) && !Store.isEpicClosed(e)).forEach(e => {
      const week = weekStart(e.plannedStart);
      const span = Math.min(Store.QUEUE_MAX_SPAN, Store.diffDays(week, weekStart(e.plannedEnd)) / 7 + 1);
      if (e.queue && e.queue.week === week && e.queue.span === span) { same++; return; }
      changes.push({ epic: e, week, span, overwrite: !!e.queue });
    });
    return { changes, same };
  }

  return {
    defaultSpan, queueLastWeek, inQueueWeek, queueWeeks, queueStats, queueToPlan, planToQueue,
    DEFAULT_WINDOW_DAYS,
    STAGES, stageById, stage, isGroomed, READINESS_GROUPS, readinessKey, readiness,
    isScheduled, nextWorkingDay, windowFromHle, windowDays, intensity, weekStart,
    timelineRange, weeksOf, issues, overview, groupRows,
  };
})();
