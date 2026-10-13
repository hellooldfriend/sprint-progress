/* ============================================================
   roadmap.js — вкладка «Эпики»: Гант и бэклог с перетаскиванием.
   Рендер и жесты живут вместе: перетаскивание полосы — это и есть интерфейс.
   Запись в Store делает app.js через колбэки из init().

   Жесты:
   - тянуть полосу — сдвиг окна целиком, длительность сохраняется;
   - тянуть край — сдвиг Planned Start или Planned End;
   - тянуть в дорожку другого человека (группировка по исполнителю) — переназначить;
   - клик или протяжка по шкале у эпика без дат — поставить в план окном по HLE;
   - клик по полосе без движения — открыть эпик;
   - тянуть за ручку ⋮⋮ слева от эпика — поменять приоритет (и на Ганте, и в бэклоге).
   ============================================================ */
const Roadmap = (() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const esc = s => UI.esc(s);

  /** Ширина дня в пикселях на каждом масштабе. */
  const ZOOM = {
    week:    { day: 30, label: 'Недели' },
    month:   { day: 11, label: 'Месяцы' },
    quarter: { day: 4,  label: 'Кварталы' },
  };
  /** Ширина колонки с названиями: на телефоне шкале нужно больше места. */
  const leftWidth = () => (window.matchMedia('(max-width: 560px)').matches ? 200 : 340);
  let LEFT_W = 340;
  const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                       'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  /** Локальное состояние вкладки (не сохраняется). */
  const view = {
    query: '',
    stage: null,            // фильтр по стадии готовности из полосы «Готовность бэклога»
    centerOnToday: true,
  };

  let range = null;       // { start, end, days } — текущая шкала
  let dayW = ZOOM.month.day;
  let handlers = { onOpen() {}, onCommit() {}, onReorder() {} };

  const settings = () => Store.get().settings;

  function visibleEpics() {
    const q = view.query.trim().toLowerCase();
    return Store.epics().filter(e => {
      if (!settings().roadmapShowClosed && Store.isEpicClosed(e)) return false;
      if (view.stage && Epics.stage(e) !== view.stage) return false;
      if (!q) return true;
      return [e.key, e.title, e.assignee, e.author, Store.epicStatusById(e.status).label]
        .some(f => String(f || '').toLowerCase().includes(q));
    });
  }

  const x = iso => Store.diffDays(range.start, iso) * dayW;
  const pctLabel = v => `${Math.round(v * 100)}%`;

  /* ═════════════ Рендер ═════════════ */

  function render() {
    const mount = $('#epicsBody');
    if (!mount) return;
    const all = Store.epics();

    if (!all.length) {
      mount.innerHTML = `
        <div class="empty">
          <div class="empty__art" aria-hidden="true">
            <svg viewBox="0 0 120 80" fill="none">
              <rect x="8" y="14" width="56" height="10" rx="5" fill="currentColor" opacity=".3"/>
              <rect x="30" y="34" width="70" height="10" rx="5" fill="var(--accent)" opacity=".7"/>
              <rect x="52" y="54" width="52" height="10" rx="5" fill="currentColor" opacity=".2"/>
              <path d="M44 6v70" stroke="var(--red)" stroke-width="1.5" stroke-dasharray="3 3"/>
            </svg>
          </div>
          <h2>Эпиков пока нет</h2>
          <p>Выгрузите эпики из Jira в CSV — ключ, тему, исполнителя, статус, HLE и плановые даты распознаем сами.
             Потом расставляйте их на шкале перетаскиванием и следите, чтобы никто не был загружен больше чем на 100%.</p>
          <div class="row row--gap">
            <button class="btn btn--ghost" data-epic-act="import">Импорт CSV из Jira</button>
            <button class="btn btn--primary" data-epic-act="new">Новый эпик</button>
          </div>
        </div>`;
      return;
    }

    const today = Store.today();
    const list = visibleEpics();

    if (settings().epicsView === 'backlog') {
      mount.innerHTML = `
        ${readinessHTML(all)}
        ${toolbarHTML(list.length, all.length)}
        ${backlogHTML(list, today)}
        <p class="hint">
          Тяните за ⋮⋮, чтобы поменять приоритет — порядок общий для бэклога и Ганта.
          Готовность считается по статусу и HLE: проставьте оценку эпику в Ready for HLE — и он перейдёт в «Прошли груминг».
        </p>`;
      return;
    }

    const zoom = ZOOM[settings().roadmapZoom] || ZOOM.month;
    dayW = zoom.day;
    LEFT_W = leftWidth();
    range = Epics.timelineRange(all, today);     // шкала по всем эпикам: фильтр не должен её дёргать
    const weeks = Epics.weeksOf(range);
    const load = Epics.weeklyLoad(all, weeks);
    const mode = settings().roadmapGroup;
    const grouped = mode === 'assignee';
    const groups = Epics.groupRows(list, mode);
    const width = range.days * dayW;

    // Сохраняем прокрутку: перерисовка после перетаскивания не должна прыгать
    const old = $('#gantt');
    const scroll = old ? { left: old.scrollLeft, top: old.scrollTop } : null;

    mount.innerHTML = `
      ${readinessHTML(all)}
      ${overviewHTML(Epics.overview(all, today))}
      ${toolbarHTML(list.length, all.length)}
      <div class="gantt ${grouped ? 'is-grouped' : ''}" id="gantt" ${grouped ? 'data-sort-cross' : ''}
           style="--day:${dayW}px;--left:${LEFT_W}px;--track:${width}px">
        ${headHTML(zoom)}
        <div class="gantt__body">
          ${list.length
            ? groups.map(g => groupHTML(g, mode, load, weeks, today)).join('')
            : '<div class="gantt__nothing">Ничего не нашлось — поменяйте поиск или покажите закрытые эпики</div>'}
          ${today >= range.start && today <= range.end
            ? `<div class="gantt__today" style="left:${LEFT_W + x(today) + dayW / 2}px"><span>Сегодня</span></div>` : ''}
        </div>
      </div>
      <p class="hint">
        Тяните полосу, чтобы сдвинуть эпик, за край — чтобы поменять Planned Start или End, за ⋮⋮ — чтобы поменять приоритет.
        ${grouped ? 'Перетащите в строку другого человека — эпик перейдёт к нему.' : ''}
        Пунктирные полосы — эпики, не прошедшие груминг: их даты пока ориентировочные.
        У эпика без дат кликните по шкале — окно поставится по HLE.
        Загрузка считается так: эпик делает один человек, HLE в человеко-днях делится на рабочие дни окна.
      </p>`;

    const gantt = $('#gantt');
    if (view.centerOnToday || !scroll) {
      // Сегодня — на первой пятой видимой шкалы: немного прошлого слева, план справа
      gantt.scrollLeft = Math.max(0, x(today) - (gantt.clientWidth - LEFT_W) * 0.2);
      view.centerOnToday = false;
    } else {
      gantt.scrollLeft = scroll.left;
      gantt.scrollTop = scroll.top;
    }
  }

  /* ── Карточки над Гантом ── */
  function overviewHTML(o) {
    const card = ({ dot, title, value, unit, foot, spark, sparkColor }) => `
      <article class="metric">
        <div class="metric__head"><span class="dot ${dot}"></span>${title}</div>
        <div class="metric__value"><b>${value}</b><span>${unit || ''}</span></div>
        ${spark !== undefined
          ? `<div class="metric__spark"><i style="width:${Math.min(100, spark)}%;background:${sparkColor}"></i></div>` : ''}
        <div class="metric__foot">${foot}</div>
      </article>`;

    const risks = o.squeezed + o.overdue;
    return `<section class="metrics">
      ${card({
        dot: 'dot--accent', title: 'Открытые эпики', value: o.open,
        unit: Metrics.plural(o.open, 'эпик', 'эпика', 'эпиков'),
        spark: Metrics.pct(o.scheduled, o.open), sparkColor: 'var(--accent)',
        foot: o.unscheduled
          ? `В плане ${o.scheduled} · без дат ${o.unscheduled}`
          : o.open ? 'У всех открытых эпиков есть даты' : 'Все эпики закрыты',
      })}
      ${card({
        dot: 'dot--blue', title: 'HLE открытых', value: Metrics.fmt(o.hleTotal), unit: 'п/д',
        foot: o.noHle
          ? `Без оценки ${o.noHle} ${Metrics.plural(o.noHle, 'эпик', 'эпика', 'эпиков')} — в загрузке они не видны`
          : 'У всех открытых эпиков есть оценка',
      })}
      ${card({
        dot: o.overloaded.length ? 'dot--red' : 'dot--green', title: 'Перегруз людей',
        value: o.overloaded.length, unit: `из ${o.people} ${Metrics.plural(o.people, 'человека', 'человек', 'человек')}`,
        foot: o.overloaded.length
          ? o.overloaded.slice(0, 3).map(p => `${esc(p.name)} ${pctLabel(p.peak)}`).join(' · ') + ' — пик с этой недели'
          : 'С текущей недели никто не загружен больше чем на 100%',
      })}
      ${card({
        dot: risks ? 'dot--amber' : 'dot--muted', title: 'Риски по срокам', value: risks,
        unit: Metrics.plural(risks, 'эпик', 'эпика', 'эпиков'),
        foot: risks
          ? [o.squeezed ? `HLE не влезает в окно: ${o.squeezed}` : '', o.overdue ? `Planned End прошёл: ${o.overdue}` : '']
              .filter(Boolean).join(' · ')
          : 'Окна вмещают оценки, просроченных нет',
      })}
    </section>`;
  }

  /* ── Готовность бэклога: прошли груминг или нет ── */
  function readinessHTML(all) {
    const r = Epics.readiness(all);
    // Слева направо — от самого готового к самому сырому: черта груминга посередине
    const ORDER = ['progress', 'ready', 'estimate', 'requirements'];
    const open = ORDER.map(id => r.stages.find(st => st.id === id));
    const total = open.reduce((a, st) => a + st.count, 0);
    if (!total) return '';

    const segment = st => st.count
      ? `<button class="readiness__seg ${view.stage === st.id ? 'is-active' : ''}" data-stage="${st.id}"
                 style="flex:${st.count};--c:${st.color}" title="${esc(st.label)}: ${st.count} · ${esc(st.hint)}"></button>` : '';
    const legend = st => `
      <button class="readiness__item ${view.stage === st.id ? 'is-active' : ''} ${st.count ? '' : 'is-empty'}"
              data-stage="${st.id}" title="${esc(st.hint)} — показать только их">
        <i style="background:${st.color}"></i>
        <span class="readiness__name">${st.label}</span>
        <b>${st.count}</b>
        <span class="readiness__hle">${st.hle ? `${Metrics.fmt(st.hle)} п/д` : st.count ? 'без HLE' : ''}</span>
      </button>`;
    const side = (title, part, cls) => `
      <div class="readiness__side ${cls}">
        <span>${title}</span>
        <b>${part.count}</b>
        <em>${Metrics.pct(part.count, total)}%${part.hle ? ` · ${Metrics.fmt(part.hle)} п/д` : ''}</em>
      </div>`;

    return `
      <section class="card readiness">
        <div class="readiness__top">
          ${side('Прошли груминг', r.groomed, 'is-groomed')}
          <div class="readiness__bar">${open.map(segment).join('')}</div>
          ${side('Не прошли груминг', r.ungroomed, 'is-ungroomed')}
        </div>
        <div class="readiness__legend">
          <span class="readiness__group">Прошли:</span>
          ${open.filter(st => st.groomed).map(legend).join('')}
          <span class="readiness__group">Не прошли:</span>
          ${open.filter(st => !st.groomed).map(legend).join('')}
        </div>
      </section>`;
  }

  /* ── Панель управления ── */
  function toolbarHTML(shown, total) {
    const s = settings();
    const gantt = s.epicsView !== 'backlog';
    return `
      <div class="board-toolbar">
        <div class="segmented" role="group" aria-label="Вид">
          <button data-epics-view="gantt" class="${gantt ? 'is-active' : ''}">Гант</button>
          <button data-epics-view="backlog" class="${!gantt ? 'is-active' : ''}">Бэклог</button>
        </div>
        <label class="search">
          <svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input type="search" id="epicSearch" placeholder="Поиск по эпикам…" value="${esc(view.query)}" />
        </label>
        ${gantt ? `
        <div class="segmented" role="group" aria-label="Масштаб">
          ${Object.entries(ZOOM).map(([id, z]) =>
            `<button data-zoom="${id}" class="${s.roadmapZoom === id ? 'is-active' : ''}">${z.label}</button>`).join('')}
        </div>
        <div class="segmented" role="group" aria-label="Группировка">
          <button data-group="assignee" class="${s.roadmapGroup === 'assignee' ? 'is-active' : ''}">По людям</button>
          <button data-group="readiness" class="${s.roadmapGroup === 'readiness' ? 'is-active' : ''}">По готовности</button>
          <button data-group="none" class="${s.roadmapGroup === 'none' ? 'is-active' : ''}">Списком</button>
        </div>` : ''}
        <button class="btn btn--ghost btn--sm ${s.roadmapShowClosed ? 'is-on' : ''}" data-epic-act="toggle-closed"
                title="Готово и Rejected">${s.roadmapShowClosed ? 'Скрыть закрытые' : 'Показать закрытые'}</button>
        ${gantt ? `<button class="btn btn--ghost btn--sm" data-epic-act="today">Сегодня</button>
        <button class="btn btn--ghost btn--sm" data-epic-act="plan-to-queue"
                title="Разложить эпики по неделям очереди по их Planned Start / End">
          <svg class="ico" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M18 3v4h-4M6 21v-4h4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          В очередь
        </button>` : ''}
        ${view.stage ? `<button class="chip chip--reset" data-stage="">Стадия: ${esc(Epics.stageById(view.stage).label)} ✕</button>` : ''}
        <span class="hint" id="epicCount">${shown === total
          ? `${total} ${Metrics.plural(total, 'эпик', 'эпика', 'эпиков')}`
          : `Показано ${shown} из ${total}`}</span>
      </div>`;
  }

  /* ── Шапка шкалы: месяцы и недели/дни ── */
  function headHTML(zoom) {
    const months = [];
    for (let d = range.start; d <= range.end;) {
      const date = Store.parseDate(d);
      const next = Store.toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 1));
      const end = next > range.end ? Store.addDays(range.end, 1) : next;
      const w = Store.diffDays(d, end) * dayW;
      const label = w > 70 ? `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`
        : w > 26 ? Store.formatDate(d).split(' ')[1] : '';
      months.push(`<span class="gantt__month" style="left:${x(d)}px;width:${w}px">${label}</span>`);
      d = end;
    }

    const today = Store.today();
    let ticks;
    if (zoom === ZOOM.week) {
      ticks = Store.dateRange(range.start, range.end).map(d => {
        const date = Store.parseDate(d);
        const cls = [Store.isWorkingDay(d) ? '' : 'is-weekend', d === today ? 'is-today' : ''].join(' ');
        return `<span class="gantt__tick ${cls}" style="left:${x(d)}px;width:${dayW}px">${date.getDate()}</span>`;
      });
    } else {
      ticks = Epics.weeksOf(range).map(d =>
        `<span class="gantt__tick gantt__tick--week" style="left:${x(d)}px;width:${7 * dayW}px"
               title="Неделя с ${Store.formatDate(d)}">${7 * dayW >= 26 ? Store.parseDate(d).getDate() : ''}</span>`);
    }

    return `
      <div class="gantt__head">
        <div class="gantt__corner">
          <span>Эпик</span>
          <span>${settings().roadmapGroup === 'assignee' ? 'загрузка по неделям →' : ''}</span>
        </div>
        <div class="gantt__scale">
          <div class="gantt__months">${months.join('')}</div>
          <div class="gantt__ticks">${ticks.join('')}</div>
        </div>
      </div>`;
  }

  /* ── Группа: строка человека с загрузкой + его эпики ── */
  function groupHTML(g, mode, load, weeks, today) {
    const grouped = mode === 'assignee';
    const scope = g.key || 'all';
    const rows = g.epics.map(e => rowHTML(e, scope, grouped, today)).join('');
    if (mode === 'none') return rows;

    if (mode === 'readiness') {
      const hle = g.epics.reduce((acc, e) => acc + (e.hle || 0), 0);
      const noHle = g.epics.filter(e => e.hle === null).length;
      return `
        <div class="gantt__row gantt__row--group gantt__row--${g.key}" data-sort-head="${scope}">
          <div class="gantt__label">
            <span class="gl__person">${esc(g.name)}</span>
            <span class="gl__sum">${g.epics.length} ${Metrics.plural(g.epics.length, 'эпик', 'эпика', 'эпиков')}${hle ? ` · ${Metrics.fmt(hle)} п/д` : ''}${noHle && g.key !== 'closed' ? ` · без HLE ${noHle}` : ''}</span>
          </div>
          <div class="gantt__track gantt__track--load"><span class="gantt__note">${esc(g.hint)}</span></div>
        </div>
        ${rows}`;
    }

    const person = g.name ? load.get(Epics.personKey(g.name)) : null;
    const open = g.epics.filter(e => !Store.isEpicClosed(e));
    const hle = open.reduce((acc, e) => acc + (e.hle || 0), 0);
    const peak = person ? Epics.upcomingPeak(person, today) : 0;
    const laneKey = g.key;

    const cells = person ? person.weeks.map(w => {
      if (!w.load) return '';
      const cls = w.load > 1 ? 'is-over' : w.load > Epics.LOAD_WARN ? 'is-warn' : 'is-ok';
      const names = w.epics.map(id => (Store.epicById(id) || {}).key).filter(Boolean).join(', ');
      return `<span class="load ${cls}" style="left:${x(w.week)}px;width:${5 * dayW}px"
                    title="Неделя с ${Store.formatDate(w.week)}: ${pctLabel(w.load)} · ${esc(names)}">${5 * dayW >= 30 ? pctLabel(w.load) : ''}</span>`;
    }).join('') : '';

    return `
      <div class="gantt__row gantt__row--group" data-lane="${esc(laneKey)}" data-lane-name="${esc(g.name || '')}"
           data-sort-head="${esc(scope)}">
        <div class="gantt__label">
          <span class="gl__person">${esc(g.name || 'Без исполнителя')}</span>
          <span class="gl__sum">
            ${g.epics.length} ${Metrics.plural(g.epics.length, 'эпик', 'эпика', 'эпиков')}${hle ? ` · ${Metrics.fmt(hle)} п/д` : ''}
            ${peak > 1 ? `<span class="tag tag--over" title="Пиковая загрузка с текущей недели">пик ${pctLabel(peak)}</span>` : ''}
          </span>
        </div>
        <div class="gantt__track gantt__track--load">${g.name ? cells : '<span class="gantt__note">Назначьте исполнителя — иначе загрузку не посчитать</span>'}</div>
      </div>
      ${rows}`;
  }

  /* ── Строка эпика ── */
  /** Ключ эпика — ссылка в Jira, если задан адрес трекера. */
  function keyHTML(e) {
    if (!e.key) return '';
    const url = Store.taskUrl(e.key);
    return url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener" draggable="false" title="Открыть в Jira">${esc(e.key)}</a>`
      : esc(e.key);
  }

  const GRIP = '<span class="grip" data-grip title="Перетащите, чтобы поменять приоритет" aria-hidden="true"></span>';

  function rowHTML(e, scope, grouped, today) {
    const st = Store.epicStatusById(e.status);
    const stg = Epics.stageById(Epics.stage(e));
    const problems = Epics.issues(e, today);
    const worst = problems.some(p => p.level === 'err') ? 'err' : problems.length ? 'warn' : '';

    return `
      <div class="gantt__row ${Store.isEpicClosed(e) ? 'is-closed' : ''} ${stg.groomed === false ? 'is-ungroomed' : ''}"
           data-epic="${e.id}" data-lane="${esc(scope)}" data-sort-id="${e.id}" data-sort-scope="${esc(scope)}">
        <div class="gantt__label" data-epic-open="${e.id}" title="${esc(e.title)}\n${esc(stg.label)} — ${esc(stg.hint)}"
             style="--stage:${stg.color}">
          ${GRIP}
          <div class="gl__line">
            ${e.key ? `<span class="gl__key">${keyHTML(e)}</span>` : ''}
            <span class="gl__title">${esc(e.title)}</span>
          </div>
          <div class="gl__line gl__meta">
            <span class="tag"><i class="dot ${st.dot}"></i>${esc(st.label)}</span>
            <span class="tag ${e.hle === null ? 'tag--dropped' : 'tag--points'}">${e.hle === null ? 'нет HLE' : `${Metrics.fmt(e.hle)} п/д`}</span>
            ${!grouped && e.assignee ? `<span class="tag tag--assignee">${esc(e.assignee)}</span>` : ''}
            ${worst ? `<span class="gl__warn gl__warn--${worst}" title="${esc(problems.map(p => p.text).join('\n'))}">!</span>` : ''}
          </div>
        </div>
        <div class="gantt__track">
          ${Epics.isScheduled(e) ? barHTML(e, st, problems)
            : `<span class="gantt__place" style="left:${Math.max(0, x(today))}px">Кликните или тяните по шкале, чтобы поставить в план →</span>`}
        </div>
      </div>`;
  }

  function barHTML(e, st, problems) {
    const left = x(e.plannedStart);
    const width = (Store.diffDays(e.plannedStart, e.plannedEnd) + 1) * dayW;
    const days = Epics.windowDays(e);
    const load = Epics.intensity(e);
    const label = [e.key, e.hle !== null ? `${Metrics.fmt(e.hle)} п/д` : '', load ? pctLabel(load) : '']
      .filter(Boolean).join(' · ');
    const title = [
      `${e.key ? e.key + ' — ' : ''}${e.title}`,
      `${Store.formatRange(e.plannedStart, e.plannedEnd)} · ${days} ${Metrics.plural(days, 'рабочий день', 'рабочих дня', 'рабочих дней')}`,
      e.hle !== null ? `HLE ${Metrics.fmt(e.hle)} п/д → загрузка исполнителя ${pctLabel(load)}` : 'HLE не указан',
      ...problems.filter(p => p.id === 'squeezed' || p.id === 'overdue').map(p => '⚠ ' + p.text),
    ].join('\n');
    const cls = [
      problems.some(p => p.id === 'squeezed') ? 'is-squeezed' : '',
      problems.some(p => p.id === 'overdue') ? 'is-overdue' : '',
      width < 56 ? 'is-tiny' : '',
    ].join(' ');

    return `
      <div class="bar ${cls}" data-bar="${e.id}" style="left:${left}px;width:${width}px;--c:${st.color}" title="${esc(title)}">
        <i class="bar__h bar__h--l" data-edge="start"></i>
        <span class="bar__label">${esc(label)}</span>
        <i class="bar__h bar__h--r" data-edge="end"></i>
      </div>`;
  }

  /* ═════════════ Бэклог ═════════════ */

  /**
   * Приоритизированный список, разделённый по готовности. Порядок общий с Гантом.
   * HLE и статус правятся прямо в строке — удобно на самом груминге.
   */
  function backlogHTML(list, today) {
    const sections = Epics.READINESS_GROUPS
      .filter(g => g.key !== 'closed' || settings().roadmapShowClosed)
      .map(g => ({ ...g, epics: Epics.groupRows(list.filter(e => Epics.readinessKey(e) === g.key), 'none')[0].epics }))
      // Пустую секцию с отфильтрованной стадией не показываем, а пустой «Прошли груминг» — показываем: это сигнал
      .filter(g => g.epics.length || (!view.stage && !view.query && g.key !== 'closed'));

    if (!sections.length) return '<div class="gantt__nothing">Ничего не нашлось — поменяйте поиск или фильтр</div>';
    return `<div class="backlog">${sections.map(sec => backlogSection(sec, today)).join('')}</div>`;
  }

  function backlogSection(sec, today) {
    const hle = sec.epics.reduce((acc, e) => acc + (e.hle || 0), 0);
    const noHle = sec.epics.filter(e => e.hle === null).length;
    const noDates = sec.epics.filter(e => !Epics.isScheduled(e)).length;
    let cumulative = 0;
    const rows = sec.epics.map((e, i) => {
      cumulative += e.hle || 0;
      return backlogRowHTML(e, sec.key, today, i + 1, sec.key === 'groomed' ? cumulative : null);
    }).join('');

    const empty = {
      groomed: 'Ни один эпик ещё не прошёл груминг. Проставьте HLE эпикам в Ready for HLE — и они появятся здесь.',
      ungroomed: 'Все открытые эпики прошли груминг 🎉',
      closed: 'Закрытых эпиков нет',
    }[sec.key];

    return `
      <section class="bl-section bl-section--${sec.key}" data-sort-head="${sec.key}">
        <header class="bl-section__head">
          <div>
            <h3>${esc(sec.name)}</h3>
            <p class="hint">${esc(sec.hint)}</p>
          </div>
          <div class="bl-section__stats">
            <span><b>${sec.epics.length}</b> ${Metrics.plural(sec.epics.length, 'эпик', 'эпика', 'эпиков')}</span>
            <span><b>${Metrics.fmt(hle)}</b> п/д</span>
            ${noHle && sec.key !== 'closed' ? `<span class="txt-amber">без HLE ${noHle}</span>` : ''}
            ${noDates && sec.key === 'groomed' ? `<span>без дат ${noDates}</span>` : ''}
          </div>
        </header>
        ${sec.epics.length ? `
        <div class="bl-list">
          <div class="bl-row bl-row--head">
            <span></span><span>#</span><span>Эпик</span><span>Статус</span><span>HLE, п/д</span>
            <span>${sec.key === 'groomed' ? '<span title="HLE нарастающим итогом сверху вниз — видно, где проходит черта ёмкости">Σ п/д</span>' : ''}</span>
          </div>
          ${rows}
        </div>` : `<div class="column__empty">${empty}</div>`}
      </section>`;
  }

  function backlogRowHTML(e, scope, today, position, cumulative) {
    const stg = Epics.stageById(Epics.stage(e));
    const problems = Epics.issues(e, today).filter(p => p.id !== 'no-hle');   // нет HLE и так видно по полю
    const worst = problems.some(p => p.level === 'err') ? 'err' : problems.length ? 'warn' : '';
    const meta = [
      e.key ? `<span class="gl__key">${keyHTML(e)}</span>` : '',
      e.assignee ? `<span>${esc(e.assignee)}</span>` : '<span class="txt-faint">без исполнителя</span>',
      Epics.isScheduled(e) ? `<span>${Store.formatRange(e.plannedStart, e.plannedEnd)}</span>` : '<span class="txt-faint">без дат</span>',
    ].join('<span class="bl-dot">·</span>');

    return `
      <div class="bl-row ${Store.isEpicClosed(e) ? 'is-closed' : ''}" data-sort-id="${e.id}" data-sort-scope="${scope}"
           style="--stage:${stg.color}">
        ${GRIP}
        <span class="bl-rank" title="Общий приоритет ${e.rank} из ${Store.epics().length}">${position}</span>
        <div class="bl-main" data-epic-open="${e.id}">
          <div class="bl-title">
            <span class="bl-stage" title="${esc(stg.hint)}"><i></i>${esc(stg.label)}</span>
            <span class="gl__title">${esc(e.title)}</span>
            ${worst ? `<span class="gl__warn gl__warn--${worst}" title="${esc(problems.map(p => p.text).join('\n'))}">!</span>` : ''}
          </div>
          <div class="bl-meta">${meta}</div>
        </div>
        <select class="input input--sm bl-status" data-inline-status="${e.id}" aria-label="Статус">
          ${Store.EPIC_STATUSES.map(st => `<option value="${st.id}" ${st.id === e.status ? 'selected' : ''}>${st.label}</option>`).join('')}
        </select>
        <input class="input input--mini bl-hle ${stg.id === 'estimate' ? 'is-wanted' : ''}" type="number" min="0" max="9999" step="0.5"
               data-inline-hle="${e.id}" value="${e.hle === null ? '' : e.hle}" placeholder="—" aria-label="HLE"
               title="${stg.id === 'estimate' ? 'Проставьте HLE — эпик пройдёт груминг' : 'HLE, человеко-дней'}" />
        <span class="bl-cum">${cumulative !== null ? Metrics.fmt(cumulative) : ''}</span>
      </div>`;
  }

  /* ═════════════ Сортировка за ручку ═════════════ */

  let sort = null;

  /** Линия, показывающая, куда встанет эпик. */
  function indicator(rect) {
    let el = $('#sortLine');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sortLine';
      el.className = 'sort-line';
      document.body.appendChild(el);
    }
    el.hidden = !rect;
    if (!rect) return;
    el.style.left = `${rect.left}px`;
    el.style.width = `${rect.width}px`;
    el.style.top = `${rect.y - 1}px`;
  }

  function startSort(e) {
    const item = e.target.closest('[data-sort-id]');
    if (!item) return;
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* без захвата тоже работает: слушаем document */ }
    item.classList.add('is-sorting');
    document.body.classList.add('is-sorting');
    sort = {
      id: item.dataset.sortId,
      scope: item.dataset.sortScope,
      item,
      cross: !!item.closest('[data-sort-cross]'),
      scroller: item.closest('.gantt'),
      target: null,
    };
  }

  function onSortMove(e) {
    // У края подкручиваем список: Гант — внутри себя, бэклог — всю страницу
    const box = sort.scroller ? sort.scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const step = e.clientY < box.top + 40 ? -12 : e.clientY > box.bottom - 40 ? 12 : 0;
    if (step) (sort.scroller || document.scrollingElement).scrollTop += step;

    const under = document.elementFromPoint(e.clientX, e.clientY);
    let target = under && under.closest('[data-sort-id]');
    let place;
    if (target) {
      const rect = target.getBoundingClientRect();
      place = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    } else {
      // Над заголовком группы — ставим первым в эту группу
      const head = under && under.closest('[data-sort-head]');
      const scope = head && head.dataset.sortHead;
      target = scope ? document.querySelector(`[data-sort-scope="${CSS.escape(scope)}"]`) : null;
      place = 'before';
    }

    const allowed = target && (target.dataset.sortScope === sort.scope || sort.cross);
    document.body.classList.toggle('is-sort-blocked', !!target && !allowed);
    if (!allowed || target === sort.item) {
      sort.target = null;
      indicator(null);
      return;
    }
    sort.target = { id: target.dataset.sortId, scope: target.dataset.sortScope, place };
    const rect = target.getBoundingClientRect();
    indicator({ left: rect.left, width: rect.width, y: place === 'before' ? rect.top : rect.bottom });
  }

  function finishSort(commit) {
    const s = sort;
    sort = null;
    indicator(null);
    s.item.classList.remove('is-sorting');
    document.body.classList.remove('is-sorting', 'is-sort-blocked');
    if (!commit || !s.target) return;
    // В Ганте по людям перенос в чужую группу — это ещё и смена исполнителя
    const reassign = s.target.scope !== s.scope ? laneName(s.target.scope) : undefined;
    handlers.onReorder(s.id, s.target.id, s.target.place, reassign);
  }

  /* ═════════════ Перетаскивание ═════════════ */

  let drag = null;

  /** Плашка с датами возле курсора — видно, куда встанет эпик, до отпускания кнопки. */
  function tip(text, clientX, clientY) {
    let el = $('#ganttTip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ganttTip';
      el.className = 'gantt-tip';
      document.body.appendChild(el);
    }
    el.hidden = !text;
    if (!text) return;
    el.textContent = text;
    el.style.left = `${clientX + 14}px`;
    el.style.top = `${clientY + 16}px`;
  }

  function dayAt(gantt, clientX) {
    const rect = gantt.getBoundingClientRect();
    const xInTrack = clientX - rect.left + gantt.scrollLeft - LEFT_W;
    return Store.addDays(range.start, Math.floor(xInTrack / dayW));
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('[data-grip]')) { startSort(e); return; }
    const gantt = e.target.closest('#gantt');
    const row = e.target.closest('.gantt__row[data-epic]');
    if (!gantt || !row || e.target.closest('a')) return;
    const epic = Store.epicById(row.dataset.epic);
    if (!epic) return;

    let bar = e.target.closest('.bar');
    let mode, start, end, created = false;

    if (bar) {
      const edge = e.target.closest('[data-edge]');
      mode = edge ? edge.dataset.edge : 'move';
      start = epic.plannedStart;
      end = epic.plannedEnd;
    } else if (!Epics.isScheduled(epic) && e.target.closest('.gantt__track')) {
      // Эпик без дат: ставим окно по HLE с того дня, где нажали, и сразу даём его тянуть
      ({ start, end } = Epics.windowFromHle(dayAt(gantt, e.clientX), epic.hle));
      const st = Store.epicStatusById(epic.status);
      const track = row.querySelector('.gantt__track');
      track.innerHTML = barHTML({ ...epic, plannedStart: start, plannedEnd: end }, st, []);
      bar = track.querySelector('.bar');
      mode = 'move';
      created = true;
    } else {
      return;
    }

    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('is-dragging');
    drag = {
      epic, bar, gantt, mode, created,
      orig: { start, end },
      next: { start, end },
      originX: e.clientX + gantt.scrollLeft,
      originY: e.clientY,
      lane: row.dataset.lane,
      targetLane: row.dataset.lane,
      moved: created,
    };
    onPointerMove(e);
  }

  function onPointerMove(e) {
    if (sort) { onSortMove(e); return; }
    if (!drag) return;
    const { gantt, orig, mode } = drag;

    // У края контейнера подкручиваем шкалу — тянуть эпик на месяц вперёд без отпускания кнопки
    const rect = gantt.getBoundingClientRect();
    if (e.clientX > rect.right - 40) gantt.scrollLeft += dayW;
    else if (e.clientX < rect.left + LEFT_W + 40 && gantt.scrollLeft > 0) gantt.scrollLeft -= dayW;

    const dx = e.clientX + gantt.scrollLeft - drag.originX;
    if (Math.abs(dx) > 3 || Math.abs(e.clientY - drag.originY) > 6) drag.moved = true;
    const shift = Math.round(dx / dayW);

    let { start, end } = orig;
    if (mode === 'move') { start = Store.addDays(orig.start, shift); end = Store.addDays(orig.end, shift); }
    if (mode === 'start') start = Store.addDays(orig.start, Math.min(shift, Store.diffDays(orig.start, orig.end)));
    if (mode === 'end') end = Store.addDays(orig.end, Math.max(shift, -Store.diffDays(orig.start, orig.end)));
    drag.next = { start, end };

    drag.bar.style.left = `${x(start)}px`;
    drag.bar.style.width = `${(Store.diffDays(start, end) + 1) * dayW}px`;

    // Дорожка под курсором — кому достанется эпик при отпускании
    if (gantt.classList.contains('is-grouped') && mode === 'move') {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const laneRow = under && under.closest('#gantt [data-lane]');
      if (laneRow) drag.targetLane = laneRow.dataset.lane;
      gantt.querySelectorAll('.is-lane-target').forEach(r => r.classList.remove('is-lane-target'));
      if (drag.targetLane !== drag.lane) {
        gantt.querySelectorAll(`[data-lane="${CSS.escape(drag.targetLane)}"]`)
          .forEach(r => r.classList.add('is-lane-target'));
      }
    }

    if (!drag.moved) return;
    const days = Store.workingDays(start, end);
    const hle = drag.epic.hle;
    const owner = drag.targetLane !== drag.lane ? ` → ${laneName(drag.targetLane) || 'без исполнителя'}` : '';
    tip(`${Store.formatRange(start, end)} · ${days} р/д` +
        (hle ? ` · HLE ${Metrics.fmt(hle)} → ${pctLabel(days ? hle / days : 0)}` : '') + owner,
        e.clientX, e.clientY);
  }

  function laneName(lane) {
    const head = document.querySelector(`#gantt .gantt__row--group[data-lane="${CSS.escape(lane)}"]`);
    return head ? head.dataset.laneName : '';
  }

  function finish(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    tip('');
    d.bar.classList.remove('is-dragging');
    d.gantt.querySelectorAll('.is-lane-target').forEach(r => r.classList.remove('is-lane-target'));

    if (!commit) { render(); return; }
    if (!d.moved) { handlers.onOpen(d.epic); return; }

    const patch = {};
    if (d.next.start !== d.epic.plannedStart || d.next.end !== d.epic.plannedEnd) {
      patch.plannedStart = d.next.start;
      patch.plannedEnd = d.next.end;
    }
    if (d.targetLane !== d.lane) patch.assignee = laneName(d.targetLane);
    if (!Object.keys(patch).length) { render(); return; }
    handlers.onCommit(d.epic, patch, { created: d.created });
  }

  /* ═════════════ Инициализация ═════════════ */

  function init(opts) {
    handlers = { ...handlers, ...opts };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', () => { if (sort) finishSort(true); else finish(true); });
    document.addEventListener('pointercancel', () => { if (sort) finishSort(false); else finish(false); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (sort) finishSort(false);
      if (drag) finish(false);
    });
  }

  /** Прокрутить шкалу к сегодняшнему дню. */
  function scrollToToday() {
    view.centerOnToday = true;
    render();
  }

  const isDragging = () => !!(drag || sort);

  return { view, init, render, scrollToToday, visibleEpics, isDragging };
})();
