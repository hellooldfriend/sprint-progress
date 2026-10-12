/* ============================================================
   epics.js — расчёты для планирования эпиков (чистые функции).
   Окно эпика, длительность по HLE, загрузка людей, предупреждения.

   Модель простая и честная: эпик делает один исполнитель, HLE — человеко-дни.
   Тогда интенсивность эпика = HLE / рабочих дней окна (доля ставки),
   а загрузка человека в день = сумма интенсивностей его эпиков в этот день.
   Больше 100% — человек физически не успевает всё, что ему запланировали.
   ============================================================ */
const Epics = (() => {
  'use strict';

  /** Длительность по умолчанию, когда эпик ставят в план без оценки: две рабочие недели. */
  const DEFAULT_WINDOW_DAYS = 10;
  /** Порог «почти на пределе» — выше него загрузка подсвечивается жёлтым. */
  const LOAD_WARN = 0.8;
  const NONE_KEY = '__none__';

  const isScheduled = e => !!(e.plannedStart && e.plannedEnd);

  /**
   * Готовность эпика — прошёл ли он груминг. Считается по статусу и HLE, а не отдельным флагом:
   * статус приезжает из Jira, и два источника правды разъехались бы на первом же импорте.
   *
   *   requirements — Backlog, Requirements definition: требования ещё не понятны;
   *   estimate     — Ready for HLE без оценки: требования понятны, ждём HLE;
   *   ready        — Ready for HLE с оценкой: можно брать в работу;
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
  const IN_WORK = ['development', 'ready_for_testing', 'testing', 'ready_for_deploy'];

  function stage(e) {
    if (Store.isEpicClosed(e)) return 'closed';
    if (IN_WORK.includes(e.status)) return 'progress';
    if (e.status === 'ready_for_hle') return e.hle ? 'ready' : 'estimate';
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

  /** Доля ставки, которую эпик съедает у исполнителя: 1 — весь человек целиком. */
  function intensity(e) {
    const days = windowDays(e);
    return e.hle && days ? e.hle / days : 0;
  }

  /** Имя → ключ человека: «Марат» и «марат» — один исполнитель (как в метриках спринта). */
  const personKey = name => String(name || '').trim().toLowerCase() || NONE_KEY;

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
   * Загрузка людей по неделям. Закрытые эпики (Готово, Rejected) людей уже не занимают.
   * @returns {Map<string, {name, weeks: Array<{week, load, epics:string[]}>, peak:number}>}
   */
  function weeklyLoad(list, weeks) {
    const people = new Map();
    list.forEach(e => {
      if (!isScheduled(e) || Store.isEpicClosed(e) || !e.assignee) return;
      const key = personKey(e.assignee);
      if (!people.has(key)) {
        people.set(key, { name: e.assignee.trim(), weeks: weeks.map(week => ({ week, load: 0, epics: [] })), peak: 0 });
      }
    });

    people.forEach((person, key) => {
      const mine = list.filter(e => isScheduled(e) && !Store.isEpicClosed(e) && personKey(e.assignee) === key);
      person.weeks.forEach(cell => {
        let total = 0, workdays = 0;
        for (let i = 0; i < 5; i++) {                 // пн–пт
          const day = Store.addDays(cell.week, i);
          workdays++;
          mine.forEach(e => {
            if (day >= e.plannedStart && day <= e.plannedEnd) {
              total += intensity(e);
              if (!cell.epics.includes(e.id)) cell.epics.push(e.id);
            }
          });
        }
        cell.load = total / workdays;
        person.peak = Math.max(person.peak, cell.load);
      });
    });
    return people;
  }

  /** Пиковая загрузка человека с текущей недели и дальше — прошлые перегрузы уже не исправить. */
  function upcomingPeak(person, today) {
    const from = weekStart(today);
    return person.weeks.filter(w => w.week >= from).reduce((max, w) => Math.max(max, w.load), 0);
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
    if (!e.assignee) out.push({ id: 'no-assignee', text: 'Не назначен исполнитель', level: 'warn' });
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
    const weeks = weeksOf(timelineRange(list, today));
    const load = weeklyLoad(list, weeks);
    const overloaded = [...load.values()]
      .map(p => ({ name: p.name, peak: upcomingPeak(p, today) }))
      .filter(p => p.peak > 1)
      .sort((a, b) => b.peak - a.peak);

    const has = id => open.filter(e => issues(e, today).some(i => i.id === id));
    return {
      total: list.length,
      open: open.length,
      scheduled: open.filter(isScheduled).length,
      unscheduled: has('unscheduled').length,
      hleTotal: open.reduce((acc, e) => acc + (e.hle || 0), 0),
      noHle: has('no-hle').length,
      noAssignee: has('no-assignee').length,
      squeezed: has('squeezed').length,
      overdue: has('overdue').length,
      overloaded,
      people: load.size,
    };
  }

  /**
   * Группы строк Ганта. По исполнителю — люди по алфавиту, «Без исполнителя» в конце;
   * внутри группы — по дате старта, незапланированные внизу.
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
    if (mode !== 'assignee') return [{ key: null, name: null, epics: [...list].sort(byStart) }];

    const groups = new Map();
    list.forEach(e => {
      const key = personKey(e.assignee);
      if (!groups.has(key)) groups.set(key, { key, name: key === NONE_KEY ? null : e.assignee.trim(), epics: [] });
      groups.get(key).epics.push(e);
    });
    return [...groups.values()]
      .sort((a, b) => (a.key === NONE_KEY) - (b.key === NONE_KEY) || a.name.localeCompare(b.name, 'ru'))
      .map(g => ({ ...g, epics: g.epics.sort(byStart) }));
  }

  return {
    DEFAULT_WINDOW_DAYS, LOAD_WARN, NONE_KEY,
    STAGES, stageById, stage, isGroomed, READINESS_GROUPS, readinessKey, readiness,
    isScheduled, nextWorkingDay, windowFromHle, windowDays, intensity, personKey, weekStart,
    timelineRange, weeksOf, weeklyLoad, upcomingPeak, issues, overview, groupRows,
  };
})();
