/* ============================================================
   ui.js — рендер интерфейса. Читает Store/Metrics, пишет в DOM.
   Обработчики событий живут в app.js.
   ============================================================ */
const UI = (() => {
  'use strict';

  /** Локальное состояние интерфейса (не сохраняется). */
  const view = {
    tab: 'home',           // 'home' | 'dashboard' | 'history' | 'epics' | 'queue'
    query: '',             // поиск по задачам
    kind: 'all',           // 'all' | 'planned' | 'unplanned'
    assignee: null,        // null | имя в нижнем регистре | '__none__' — задачи без исполнителя
  };

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const mode = () => Store.get().settings.metricMode;
  /** Баги подсвечиваем отдельно — их видно на доске с первого взгляда. */
  const isBugType = type => Store.matchType(type) === 'Баг';

  /**
   * Тег переноса. Один раз — просто «откуда приехала»,
   * дальше — счётчик спринтов: задача-долгожитель должна мозолить глаза.
   */
  function carryTag(t) {
    const n = t.carryCount || 0;
    if (!n) return '';
    const from = t.carriedFrom ? t.carriedFrom.name : 'прошлого спринта';
    const title = `Едет ${n + 1}-й спринт подряд · последний раз из «${from}»`;
    const text = n === 1 ? `Перенос из ${from}` : `${n + 1}-й спринт`;
    return `<span class="tag ${n >= 2 ? 'tag--longrun' : 'tag--carry'}" title="${esc(title)}">${esc(text)}</span>`;
  }
  const unitLabel = () => (mode() === 'points' ? 'SP' : 'задач');
  /**
   * Единица рядом с числом склоняется: «2 задачи», а не «2 задач».
   * В связках вроде «из 40 задач» родительный падеж верен всегда, там используется unitLabel.
   */
  const unitFor = value =>
    (mode() === 'points' ? 'SP' : Metrics.plural(value, 'задача', 'задачи', 'задач'));

  /* ═════════════ Иконки ═════════════ */
  const ICONS = {
    left:  '<svg class="ico" viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg class="ico" viewBox="0 0 24 24"><path d="M10 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit:  '<svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>',
    drop:  '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M6.5 6.5l11 11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    trash: '<svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search:'<svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  /* ═════════════ Сайдбар ═════════════ */

  const TABS = ['home', 'dashboard', 'history', 'epics', 'queue'];
  const SPRINT_TABS = ['dashboard', 'history'];

  function renderSidebar() {
    // Список спринтов — навигация внутри раздела спринтов, в остальных разделах он лишний
    const sprintTab = SPRINT_TABS.includes(view.tab);
    $('#sprintSection').hidden = !sprintTab;
    $('#sidebarSpacer').hidden = sprintTab;

    const list = Store.sortedSprints();
    const activeId = Store.get().activeSprintId;
    $('#sprintCount').textContent = list.length;

    if (!list.length) {
      $('#sprintList').innerHTML =
        `<p class="hint" style="padding:8px 4px">Спринтов пока нет. Создайте первый — это займёт 10 секунд.</p>`;
      return;
    }

    $('#sprintList').innerHTML = list.map(s => {
      const m = Metrics.sprintMetrics(s);
      const v = Metrics.inMode(m, mode());
      const isLive = s.status === 'active' && Store.today() >= s.startDate && Store.today() <= s.endDate;
      return `
        <button class="sprint-item ${s.id === activeId ? 'is-active' : ''} ${s.status === 'archived' ? 'is-archived' : ''}"
                data-sprint="${s.id}" title="${esc(s.name)}">
          <span class="sprint-item__top">
            <span class="sprint-item__dot ${isLive ? 'sprint-item__dot--live' : ''}"></span>
            <span class="sprint-item__name">${esc(s.name)}</span>
          </span>
          <span class="sprint-item__bottom">
            <span class="sprint-item__bar"><i style="width:${v.pct}%"></i></span>
            <span>${v.pct}%</span>
          </span>
        </button>`;
    }).join('');
  }

  /* ═════════════ Топбар ═════════════ */

  function renderTopbar() {
    const s = Store.activeSprint();
    const nameEl = $('#sprintName');
    const metaEl = $('#sprintMeta');

    // Эпики живут вне спринтов: у вкладки свои заголовок и действия
    const epicsTab = view.tab === 'epics' || view.tab === 'queue';
    $('#epicActions').hidden = !epicsTab;
    $('#sprintActions').hidden = !SPRINT_TABS.includes(view.tab);
    if (view.tab === 'home') {
      nameEl.textContent = 'Обзор';
      const d = Store.parseDate(Store.today());
      metaEl.innerHTML = `<span>${esc(d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>`;
      return;
    }
    if (view.tab === 'queue') {
      const placed = Store.epics().filter(e => e.queue && !Store.isEpicClosed(e));
      const now = Epics.queueStats(placed, [Store.mondayOf(Store.today())])[0];
      nameEl.textContent = 'Очередь эпиков';
      metaEl.innerHTML = `<span>Сейчас в работе ${now.count} ${Metrics.plural(now.count, 'эпик', 'эпика', 'эпиков')}</span>
        <span>· в очереди ${placed.length}</span>`;
      return;
    }
    if (epicsTab) {
      const all = Store.epics();
      const open = all.filter(e => !Store.isEpicClosed(e));
      const hle = open.reduce((acc, e) => acc + (e.hle || 0), 0);
      nameEl.textContent = 'Планирование эпиков';
      metaEl.innerHTML = all.length
        ? `<span>${open.length} ${Metrics.plural(open.length, 'открытый эпик', 'открытых эпика', 'открытых эпиков')}</span>
           <span>· HLE ${Metrics.fmt(hle)} п/д</span>`
        : '<span>Загрузите эпики из Jira или заведите вручную</span>';
      return;
    }

    // Переключатель единиц
    document.querySelectorAll('#metricMode button').forEach(b =>
      b.classList.toggle('is-active', b.dataset.mode === mode()));

    if (!s) {
      nameEl.textContent = 'Нет активного спринта';
      metaEl.innerHTML = '<span>Создайте спринт, чтобы начать</span>';
      document.querySelectorAll('.sprint-edit-only').forEach(el => el.hidden = true);
      return;
    }

    document.querySelectorAll('.sprint-edit-only').forEach(el => el.hidden = s.status === 'archived');

    const m = Metrics.sprintMetrics(s);
    const archived = s.status === 'archived';
    const notStarted = Store.today() < s.startDate;
    const overdue = Store.today() > s.endDate;

    let pill;
    if (archived) pill = '<span class="pill pill--done">Закрыт</span>';
    else if (notStarted) pill = `<span class="pill">Стартует ${Store.formatDate(s.startDate)}</span>`;
    else if (overdue) pill = '<span class="pill pill--soon">Срок вышел</span>';
    else pill = `<span class="pill pill--live">Идёт · рабочий день ${m.elapsedDays} из ${m.totalDays}</span>`;

    nameEl.textContent = s.name;
    metaEl.innerHTML = [
      pill,
      `<span>${Store.formatRange(s.startDate, s.endDate)}</span>`,
      s.goal ? `<span>· ${esc(s.goal)}</span>` : '',
    ].join('');
  }

  /* ═════════════ Дашборд ═════════════ */

  function renderDashboard() {
    const s = Store.activeSprint();
    const wrap = $('#dashboardBody');
    const dash = $('#view-dashboard');

    $('#noSprint').hidden = !!s;
    $('#archiveBanner').hidden = !s || s.status !== 'archived';
    dash.classList.toggle('is-readonly', !!s && s.status === 'archived');

    if (!s) { wrap.innerHTML = ''; return; }

    const m = Metrics.sprintMetrics(s);
    const v = Metrics.inMode(m, mode());

    // Фильтр по человеку — вещь одного спринта: в другом его может не быть
    if (view.assignee && view.assignee !== '__none__' &&
        !m.byAssignee.some(p => p.name.toLowerCase() === view.assignee)) {
      view.assignee = null;
    }

    wrap.innerHTML = `
      ${heroHTML(s, m, v)}
      ${metricsHTML(m, v, s.status === 'archived')}
      ${splitHTML(m, v)}
      ${chartHTML(s)}
      ${longRunnerBanner(s, m)}
      <div class="section-title">Доска задач</div>
      ${toolbarHTML(s)}
      ${peopleStripHTML(m)}
      <div id="boardMount"></div>
    `;
    renderBoard();
  }

  /* ── Крупный прогресс ── */
  function heroHTML(s, m, v) {
    const doneAll = v.total > 0 && v.pct >= 100;
    const unit = v.unit;
    const archived = s.status === 'archived';
    return `
    <section class="hero">
      <div class="hero__top">
        <div>
          <div class="hero__label">${archived ? 'Спринт закрыт с результатом' : 'Закрытие спринта'} — ${mode() === 'points' ? 'по story points' : 'по задачам'}</div>
          <div class="hero__value">
            <span class="hero__pct">${v.pct}<span class="hero__unit">%</span></span>
            <span class="hero__unit">${Metrics.fmt(v.done)} из ${Metrics.fmt(v.total)} ${unit}</span>
          </div>
        </div>
        <div class="hero__side">
          <div class="hero__stat"><b>${Metrics.fmt(v.total)}</b><span>Объём, ${unit}</span></div>
          <div class="hero__stat"><b style="color:var(--green)">${Metrics.fmt(v.done)}</b><span>Сделано</span></div>
          ${archived
            ? `<div class="hero__stat"><b style="color:${v.notDone ? 'var(--amber)' : 'var(--muted)'}">${Metrics.fmt(v.notDone)}</b><span>Не сделано</span></div>
               ${v.carriedOut > 0 ? `<div class="hero__stat"><b style="color:var(--muted)">${Metrics.fmt(v.carriedOut)}</b><span>Перенесено</span></div>` : ''}
               ${v.rejected > 0 ? `<div class="hero__stat"><b style="color:var(--red)">${Metrics.fmt(v.rejected)}</b><span>Rejected</span></div>` : ''}`
            : `<div class="hero__stat"><b>${Metrics.fmt(v.remaining)}</b><span>Осталось</span></div>
               ${v.dropped > 0 ? `<div class="hero__stat"><b style="color:var(--muted)">${Metrics.fmt(v.dropped)}</b><span>Снято</span></div>` : ''}
               ${v.hold > 0 ? `<div class="hero__stat"><b style="color:var(--amber)">${Metrics.fmt(v.hold)}</b><span>Hold</span></div>` : ''}
               ${v.rejected > 0 ? `<div class="hero__stat"><b style="color:var(--red)">${Metrics.fmt(v.rejected)}</b><span>Rejected</span></div>` : ''}
               <div class="hero__stat"><b>${m.daysLeft}</b><span>${Metrics.plural(m.daysLeft, 'рабочий день', 'рабочих дня', 'рабочих дней')} до конца</span></div>`}
        </div>
      </div>
      <div class="progress">
        <div class="progress__fill ${doneAll ? 'progress__fill--done' : ''}" style="width:${v.pct}%"></div>
        ${s.status === 'active' ? `<div class="progress__marker" style="left:${m.timePct}%"></div>` : ''}
      </div>
      <div class="progress-legend">
        <span><i style="background:var(--accent)"></i>Выполнено ${v.pct}%</span>
        ${s.status === 'active' ? `<span><i style="background:var(--border-strong)"></i>Прошло рабочего времени ${m.timePct}%</span>` : ''}
        <span>${archived ? closedHint(m, v) : statusHint(m, v)}</span>
      </div>
    </section>`;
  }

  /** Задачи, которые едут третий спринт подряд, — повод пересобрать или отменить. */
  function longRunnerBanner(sprint, m) {
    if (!m.longRunners) return '';
    const names = sprint.tasks
      .filter(t => (t.carryCount || 0) >= 2)
      .map(t => (t.key ? `${t.key} ` : '') + t.title);
    return `
      <div class="banner banner--warn">
        <svg class="ico" viewBox="0 0 24 24"><path d="M12 4l9 16H3l9-16zM12 10v4m0 3v.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>
          <strong>${m.longRunners} ${Metrics.plural(m.longRunners, 'задача едет', 'задачи едут', 'задач едут')} третий спринт подряд</strong>
          — обычно это значит, что задача нарезана слишком крупно или заблокирована.
          Стоит разбить её или закрыть как отменённую: ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ' и др.' : ''}
        </span>
      </div>`;
  }

  /** Итог закрытого спринта: что не сделали и куда это уехало. */
  function closedHint(m, v) {
    if (m.isEmpty) return 'В спринте не было задач';
    if (!v.notDone) return '🎉 Закрыли всё, что взяли';
    const dest = m.carryDestinations
      .map(d => `${Metrics.fmt(mode() === 'points' ? d.points : d.count)} ${v.unit} → «${esc(d.name)}»`)
      .join(', ');
    return `Не сделано ${Metrics.fmt(v.notDone)} ${v.unit}` + (dest ? `, из них перенесено ${dest}` : '');
  }

  /** Дружелюбная подсказка «успеваем / отстаём». */
  function statusHint(m, v) {
    if (m.isEmpty) return 'Добавьте задачи — метрики появятся сразу';
    if (v.pct >= 100) return '🎉 Все задачи закрыты';
    if ((v.dropped > 0 || v.rejected > 0) && v.remaining === 0) {
      const parts = [];
      if (v.dropped > 0) parts.push(`снято ${Metrics.fmt(v.dropped)} ${v.unit}`);
      if (v.rejected > 0) parts.push(`rejected ${Metrics.fmt(v.rejected)} ${v.unit}`);
      return `Всё остальное закрыто · ${parts.join(', ')}`;
    }
    const delta = v.pct - m.timePct;
    if (m.daysLeft === 0) return 'Спринт завершён по времени';
    if (delta >= 5) return `Идём с опережением на ${Math.round(delta)} п.п.`;
    if (delta <= -12) return `Отстаём от графика на ${Math.abs(Math.round(delta))} п.п.`;
    return 'Темп примерно по графику';
  }

  /* ── Карточки метрик ── */
  function metricsHTML(m, v, archived) {
    const card = ({ dot, title, value, unit, foot, spark, sparkColor }) => `
      <article class="metric">
        <div class="metric__head"><span class="dot ${dot}"></span>${title}</div>
        <div class="metric__value"><b>${value}</b><span>${unit || ''}</span></div>
        ${spark !== undefined
          ? `<div class="metric__spark"><i style="width:${Math.min(100, spark)}%;background:${sparkColor}"></i></div>` : ''}
        <div class="metric__foot">${foot}</div>
      </article>`;

    const plannedDonePct = Metrics.pct(v.donePlanned, v.planned);
    const unplannedDonePct = Metrics.pct(v.doneUnplanned, v.unplanned);

    return `<section class="metrics">
      ${card({
        dot: 'dot--accent', title: 'Запланировано', value: Metrics.fmt(v.planned), unit: unitFor(v.planned),
        spark: plannedDonePct, sparkColor: 'var(--accent)',
        foot: `Закрыто ${Metrics.fmt(v.donePlanned)} из ${Metrics.fmt(v.planned)} · ${plannedDonePct}%`,
      })}
      ${card({
        dot: 'dot--amber', title: 'Незапланировано', value: Metrics.fmt(v.unplanned), unit: unitFor(v.unplanned),
        spark: unplannedDonePct, sparkColor: 'var(--amber)',
        foot: v.unplanned > 0
          ? `${v.unplannedShare}% объёма спринта · закрыто ${Metrics.fmt(v.doneUnplanned)}`
          : 'Пока ничего не прилетало — отлично',
      })}
      ${card({
        dot: 'dot--green', title: 'Выполнено', value: Metrics.fmt(v.done), unit: unitFor(v.done),
        spark: v.pct, sparkColor: 'var(--green)',
        foot: `${v.pct}% спринта · velocity ${Metrics.fmt(m.velocity)} SP`,
      })}
      ${card({
        dot: 'dot--teal', title: 'Готово к деплою',
        value: mode() === 'points' ? Metrics.fmt(m.byStatus.deploy.points) : String(m.byStatus.deploy.count),
        unit: unitFor(mode() === 'points' ? m.byStatus.deploy.points : m.byStatus.deploy.count),
        foot: deployFoot(m),
      })}
      ${archived
        ? card({
            dot: 'dot--blue', title: 'Не сделано', value: Metrics.fmt(v.notDone), unit: v.unit,
            spark: 100 - v.pct, sparkColor: 'var(--blue)',
            foot: v.carriedOut > 0
              ? `Из них перенесено дальше: ${Metrics.fmt(v.carriedOut)} ${v.unit}`
              : 'Ничего не переносили в следующий спринт',
          })
        : card({
            dot: 'dot--blue', title: 'Remaining work', value: Metrics.fmt(v.remaining), unit: unitFor(v.remaining),
            spark: 100 - v.pct, sparkColor: 'var(--blue)',
            foot: `В работе — от In Progress до Deploy: ${Metrics.fmt(v.inProgress)} ${v.unit}`,
          })}
      ${m.capacity ? card({
        dot: 'dot--muted', title: 'Ёмкость', value: Metrics.fmt(m.capacity), unit: 'п/д',
        foot: capacityFoot(m, archived),
      }) : ''}
      ${m.participants > 0 ? card({
        dot: 'dot--muted', title: 'Участники', value: String(m.participants),
        unit: Metrics.plural(m.participants, 'человек', 'человека', 'человек'),
        foot: peopleFoot(m),
      }) : ''}
      ${v.carried > 0 ? card({
        dot: 'dot--muted', title: 'Перенос из прошлого', value: Metrics.fmt(v.carried), unit: v.unit,
        foot: m.longRunners > 0
          ? `${v.carriedShare}% объёма спринта · ${m.longRunners} ${Metrics.plural(m.longRunners, 'задача едет', 'задачи едут', 'задач едут')} 3-й спринт и дольше`
          : `${v.carriedShare}% объёма спринта — это долг, а не свежая работа`,
      }) : ''}
      ${v.dropped > 0 ? card({
        dot: 'dot--muted', title: archived ? 'Сняли со спринта' : 'Не закроем', value: Metrics.fmt(v.dropped), unit: unitFor(v.dropped),
        foot: `${v.droppedShare}% объёма спринта · ${m.dropByReason.map(r => `${r.short} ${Metrics.fmt(mode() === 'points' ? r.points : r.count)}`).join(' · ')}`,
      }) : ''}
      ${v.hold > 0 ? card({
        dot: 'dot--amber', title: 'Hold', value: Metrics.fmt(v.hold), unit: unitFor(v.hold),
        foot: (mode() === 'points'
          ? `${m.holdTasks} ${Metrics.plural(m.holdTasks, 'задача', 'задачи', 'задач')}`
          : `${Metrics.fmt(m.holdPoints)} SP`) + ' на паузе — входят в remaining, но не двигаются',
      }) : ''}
      ${v.rejected > 0 ? card({
        dot: 'dot--red', title: 'Rejected', value: Metrics.fmt(v.rejected), unit: unitFor(v.rejected),
        foot: `${v.rejectedShare}% объёма спринта · ` + (mode() === 'points'
          ? `${m.rejectedTasks} ${Metrics.plural(m.rejectedTasks, 'задача', 'задачи', 'задач')}`
          : `${Metrics.fmt(m.rejectedPoints)} SP`) + ' — не в remaining и не в velocity',
      }) : ''}
      ${card({
        dot: 'dot--muted', title: archived ? 'Средний темп' : 'Темп', value: Metrics.fmt(v.pace), unit: `${v.unit}/день`,
        foot: archived
          ? `Столько закрывали в среднем за день спринта`
          : m.daysLeft > 0
            ? `Чтобы успеть, нужно ${Metrics.fmt(v.need)} ${v.unit}/день — по рабочим дням`
            : 'Время спринта вышло',
      })}
    </section>`;
  }

  /** Сколько ждёт выкатки: в подписи всегда вторая единица, чтобы число задач было видно в любом режиме. */
  function deployFoot(m) {
    const { count, points } = m.byStatus.deploy;
    if (!count) return 'В колонке Deploy пусто';
    return mode() === 'points'
      ? `${count} ${Metrics.plural(count, 'задача ждёт', 'задачи ждут', 'задач ждут')} выкатки`
      : `${Metrics.fmt(points)} SP ждут выкатки`;
  }

  /**
   * Подпись к ёмкости. До закрытия важен перебор на планировании,
   * после — куда ушла ёмкость и насколько точны были оценки.
   */
  function capacityFoot(m, archived) {
    if (archived) {
      if (!m.spent) return 'Факт не заполнен при закрытии';
      return `Потрачено ${Metrics.fmt(m.spent)} п/д · фокус ${Math.round(m.focusFactor * 100)}% · ` +
             `на 1 п/д закрывали ${Metrics.fmt(m.estimateAccuracy)} SP`;
    }
    const over = Math.round((m.commitRatio - 1) * 100);
    const verdict = over > 5 ? `перебор на ${over}%`
      : over < -5 ? `запас ${Math.abs(over)}%`
      : 'ровно по ёмкости';
    return `Взято ${Metrics.fmt(m.totalPoints)} SP — ${verdict}`;
  }

  /** Номер задачи: ссылка в трекер, если задан базовый адрес. */
  function taskKeyHTML(task) {
    const url = Store.taskUrl(task.key);
    return url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener" draggable="false"
            title="Открыть в трекере">${esc(task.key)}</a>`
      : esc(task.key);
  }

  /** «Марат Ахметов» → «Марат А.»: в карточке метрики полные имена не помещаются. */
  function shortName(name) {
    const parts = String(name).trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
  }

  /** Кто именно работал: имена, а если есть — напоминание про задачи без исполнителя. */
  function peopleFoot(m) {
    const names = m.byAssignee.map(p => shortName(p.name));
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '');
    return m.unassignedTasks
      ? `${shown} · без исполнителя ${m.unassignedTasks} ${Metrics.plural(m.unassignedTasks, 'задача', 'задачи', 'задач')}`
      : shown;
  }

  /* ── Planned vs Unplanned ── */
  function splitHTML(m, v) {
    const cell = (title, dotClass, value, done, pctVal, color, foot) => `
      <div class="split__cell">
        <div class="split__head"><span class="dot ${dotClass}"></span>${title}</div>
        <div class="split__nums"><b>${Metrics.fmt(value)}</b><span>${unitFor(value)} · закрыто ${Metrics.fmt(done)}</span></div>
        <div class="split__bar"><i style="width:${pctVal}%;background:${color}"></i></div>
        <div class="split__foot">${foot}</div>
      </div>`;

    const plannedPct = Metrics.pct(v.donePlanned, v.planned);
    const unplannedPct = Metrics.pct(v.doneUnplanned, v.unplanned);

    return `<section class="split">
      ${cell('Planned — взято на планировании', 'dot--accent', v.planned, v.donePlanned, plannedPct, 'var(--accent)',
        `${plannedPct}% плановой работы закрыто`)}
      ${cell('Unplanned — прилетело в спринте', 'dot--amber', v.unplanned, v.doneUnplanned, unplannedPct, 'var(--amber)',
        v.unplanned > 0
          ? `${v.unplannedShare}% всего объёма спринта — это внеплановая работа`
          : 'Внеплановой работы нет')}
    </section>`;
  }

  /* ── График ── */
  function chartHTML(s) {
    const chartMode = Store.get().settings.chartMode;
    const series = Metrics.burnSeries(s, mode());
    const isDown = chartMode === 'burndown';
    const hasScope = series.scope.some(x => x > 0);

    const legend = isDown
      ? `<span><i style="background:var(--accent)"></i>Остаток работы</span>
         <span><i class="dashed"></i>Идеальное сгорание</span>`
      : `<span><i style="background:var(--green)"></i>Сделано (накопленно)</span>
         <span><i style="background:var(--amber)"></i>Общий объём — растёт от unplanned, падает от снятых</span>`;

    return `
    <section class="card chart-card">
      <div class="card__head">
        <div>
          <div class="card__title">${isDown ? 'Burn-down' : 'Burn-up'}</div>
          <div class="card__sub">${isDown
            ? 'Сколько работы осталось по дням против идеальной линии'
            : 'Сделанное против объёма спринта — видно, где скоуп рос и где его резали'} · в ${unitLabel()}</div>
        </div>
        <div class="segmented" id="chartMode">
          <button data-chart="burndown" class="${isDown ? 'is-active' : ''}">Burn-down</button>
          <button data-chart="burnup" class="${!isDown ? 'is-active' : ''}">Burn-up</button>
        </div>
      </div>
      ${hasScope
        ? `<div class="chart-wrap">${Charts.burnChart(series, chartMode, unitLabel())}</div>
           <div class="chart-legend">${legend}</div>`
        : `<div class="column__empty" style="min-height:160px">
             ${s.tasks.length === 0
               ? 'Добавьте задачи — график построится сам по датам создания и закрытия'
               : 'Ни у одной задачи нет story points — проставьте оценки или переключитесь на режим «Задачи»'}
           </div>`}
    </section>`;
  }

  /* ── Панель фильтров ── */
  function toolbarHTML(s) {
    const total = s.tasks.length;
    const shown = filterTasks(s).length;
    return `
    <div class="board-toolbar">
      <label class="search">
        ${ICONS.search}
        <input type="search" id="taskSearch" placeholder="Поиск по задачам…" value="${esc(view.query)}" />
      </label>
      <div class="segmented" id="kindFilter">
        <button data-kind="all" class="${view.kind === 'all' ? 'is-active' : ''}">Все</button>
        <button data-kind="planned" class="${view.kind === 'planned' ? 'is-active' : ''}">Planned</button>
        <button data-kind="unplanned" class="${view.kind === 'unplanned' ? 'is-active' : ''}">Unplanned</button>
      </div>
      <span class="hint">${shown === total ? `${total} ${Metrics.plural(total, 'задача', 'задачи', 'задач')}` : `Показано ${shown} из ${total}`}</span>
    </div>`;
  }

  function filterTasks(s) {
    const q = view.query.trim().toLowerCase();
    return s.tasks.filter(t => {
      if (view.kind === 'planned' && t.unplanned) return false;
      if (view.kind === 'unplanned' && !t.unplanned) return false;
      const who = String(t.assignee || '').trim().toLowerCase();
      if (view.assignee === '__none__' && who) return false;
      if (view.assignee && view.assignee !== '__none__' && who !== view.assignee) return false;
      if (!q) return true;
      return [t.title, t.key, t.type, t.assignee]
        .some(field => (field || '').toLowerCase().includes(q));
    });
  }

  /**
   * Полоска участников над доской. Клик по человеку оставляет на доске только его задачи —
   * так видно и распределение нагрузки, и кто чем занят, без отдельного экрана.
   */
  function peopleStripHTML(m) {
    if (!m.participants && !m.unassignedTasks) return '';

    const chip = ({ id, label, title, count, points, done, active }) => `
      <button class="chip ${active ? 'is-active' : ''}" data-assignee="${esc(id)}" title="${esc(title)}">
        <span class="chip__name">${esc(label)}</span>
        <span class="chip__meta">${count} · ${Metrics.fmt(points)} SP</span>
        <span class="chip__bar"><i style="width:${Metrics.pct(done, points)}%"></i></span>
      </button>`;

    const chips = m.byAssignee.map(p => chip({
      id: p.name.toLowerCase(),
      label: shortName(p.name),
      title: `${p.name} — ${p.tasks} ${Metrics.plural(p.tasks, 'задача', 'задачи', 'задач')}, ${Metrics.fmt(p.points)} SP, закрыто ${Metrics.fmt(p.donePoints)} SP`,
      count: p.tasks, points: p.points, done: p.donePoints,
      active: view.assignee === p.name.toLowerCase(),
    }));

    if (m.unassignedTasks) {
      chips.push(chip({
        id: '__none__', label: 'Без исполнителя',
        title: `${m.unassignedTasks} ${Metrics.plural(m.unassignedTasks, 'задача', 'задачи', 'задач')} без исполнителя`,
        count: m.unassignedTasks, points: m.unassignedPoints, done: 0,
        active: view.assignee === '__none__',
      }));
    }

    return `
      <div class="people-strip">
        ${chips.join('')}
        ${view.assignee ? '<button class="chip chip--reset" data-assignee="">Показать всех</button>' : ''}
      </div>`;
  }

  /* ── Канбан ── */
  function renderBoard() {
    const s = Store.activeSprint();
    const mount = $('#boardMount');
    if (!s || !mount) return;

    const tasks = filterTasks(s);
    const readonly = s.status === 'archived';

    mount.innerHTML = `<div class="board">${Store.STATUSES.map(col => {
      const list = tasks.filter(t => t.status === col.id);
      const pts = Metrics.sum(list, 'points');
      return `
        <section class="column" data-status="${col.id}">
          <header class="column__head">
            <span class="dot ${col.dot}"></span>
            <span class="column__name">${col.label}</span>
            <span class="column__count">${list.length}${pts ? ` · ${Metrics.fmt(pts)} SP` : ''}</span>
          </header>
          <div class="column__body">
            ${list.length
              ? list.map(t => taskHTML(t, readonly)).join('')
              : `<div class="column__empty">${emptyColumnText(col.id, s)}</div>`}
          </div>
        </section>`;
    }).join('')}</div>`;
  }

  function emptyColumnText(statusId, s) {
    if (s.tasks.length === 0) return 'Пусто';
    if (view.query || view.kind !== 'all') return 'Нет совпадений';
    const texts = {
      backlog: 'Идеи и запас',
      todo: 'Готово к работе',
      progress: 'Никто ничего не начал',
      review: 'Нечего ревьюить',
      ready_to_test: 'Очереди на тест нет',
      testing: 'QA отдыхает',
      deploy: 'Нечего катить',
      done: 'Пока ничего не закрыто',
      hold: 'Ничего не на паузе',
      rejected: 'Ничего не отклонили',
    };
    return texts[statusId] || 'Пусто';
  }

  function taskHTML(t, readonly) {
    // Hold и Rejected стрелками не двигаются: из них и в них — перетаскиванием или через редактирование
    const isRejected = t.status === 'rejected';
    const idx = Store.WORKFLOW_IDS.indexOf(t.status);
    const offFlow = idx === -1;
    const isFirst = offFlow || idx === 0, isLast = offFlow || idx === Store.WORKFLOW_IDS.length - 1;
    return `
    <article class="task ${t.unplanned ? 'is-unplanned' : ''} ${t.status === 'done' ? 'is-done' : ''} ${isRejected ? 'is-rejected' : ''} ${t.status === 'hold' ? 'is-hold' : ''} ${t.dropped ? 'is-dropped' : ''}"
             data-task="${t.id}" ${readonly ? '' : 'draggable="true"'}>
      ${t.key ? `<div class="task__key">${taskKeyHTML(t)}</div>` : ''}
      <div class="task__title">${esc(t.title)}</div>
      <div class="task__meta">
        ${t.points !== null ? `<span class="tag tag--points">${Metrics.fmt(t.points)} SP</span>` : ''}
        ${t.type ? `<span class="tag ${isBugType(t.type) ? 'tag--bug' : 'tag--type'}">${esc(t.type)}</span>` : ''}
        ${t.unplanned ? '<span class="tag tag--unplanned">Unplanned</span>' : ''}
        ${t.carriedTo
          ? `<span class="tag tag--carry" title="Перенесена в «${esc(t.carriedTo.name)}»">→ ${esc(t.carriedTo.name)}</span>`
          : t.dropped ? `<span class="tag tag--dropped">Снято · ${esc(Store.dropReasonById(t.dropReason).short)}</span>` : ''}
        ${carryTag(t)}
        ${t.assignee ? `<span class="tag tag--assignee">${esc(t.assignee)}</span>` : ''}
        <span class="tag" title="Добавлена ${new Date(t.createdAt).toLocaleString('ru-RU')}">${Store.formatDate(Store.toISODate(new Date(t.createdAt)))}</span>
        <span class="spacer"></span>
        <div class="task__actions">
          <button class="task__btn" data-act="prev" ${isFirst ? 'disabled' : ''} title="Назад по статусу">${ICONS.left}</button>
          <button class="task__btn" data-act="next" ${isLast ? 'disabled' : ''} title="Вперёд по статусу">${ICONS.right}</button>
          <button class="task__btn ${t.dropped ? 'is-on' : ''}" data-act="drop"
                  title="${t.dropped ? 'Вернуть в спринт' : 'Не закроем в этом спринте'}"
                  ${Store.isClosedStatus(t.status) ? 'disabled' : ''}>${ICONS.drop}</button>
          <button class="task__btn" data-act="edit" title="Редактировать">${ICONS.edit}</button>
          <button class="task__btn task__btn--del" data-act="delete" title="Удалить">${ICONS.trash}</button>
        </div>
      </div>
    </article>`;
  }

  /* ═════════════ История ═════════════ */

  function renderHistory() {
    const list = Store.sortedSprints();
    const body = $('#historyBody');

    if (!list.length) {
      body.innerHTML = `
        <div class="empty">
          <h2>История пуста</h2>
          <p>Как только вы закроете первый спринт, здесь появится таблица с velocity, процентом закрытия и долей внеплановой работы.</p>
        </div>`;
      return;
    }

    const rows = list.map(s => ({ s, m: Metrics.sprintMetrics(s) }));
    const finished = rows.filter(r => r.s.status === 'archived');
    const base = finished.length ? finished : rows;

    const avg = (arr, f) => (arr.length ? arr.reduce((a, r) => a + f(r), 0) / arr.length : 0);
    const avgVelocity = avg(base, r => r.m.velocity);
    const avgPct = avg(base, r => (mode() === 'points' ? r.m.pctPoints : r.m.pctTasks));
    const avgUnplanned = avg(base, r => (mode() === 'points' ? r.m.unplannedSharePoints : r.m.unplannedShareTasks));
    const avgDropped = avg(base, r => (mode() === 'points' ? r.m.droppedPoints : r.m.droppedTasks));

    // Точность считаем только по спринтам, где заполнен факт
    const measured = rows.filter(r => r.m.estimateAccuracy !== null);
    const avgAccuracy = avg(measured, r => r.m.estimateAccuracy);
    const lastCapacity = (rows.find(r => r.s.capacity) || { s: {} }).s.capacity || null;

    body.innerHTML = `
      <section class="metrics">
        <article class="metric">
          <div class="metric__head"><span class="dot dot--accent"></span>Спринтов всего</div>
          <div class="metric__value"><b>${list.length}</b><span>${finished.length} закрыто</span></div>
          <div class="metric__foot">Статистика ниже — по ${finished.length ? 'закрытым' : 'всем'} спринтам</div>
        </article>
        <article class="metric">
          <div class="metric__head"><span class="dot dot--green"></span>Средняя velocity</div>
          <div class="metric__value"><b>${Metrics.fmt(avgVelocity)}</b><span>SP за спринт</span></div>
          <div class="metric__foot">Ориентир для планирования следующего спринта</div>
        </article>
        <article class="metric">
          <div class="metric__head"><span class="dot dot--blue"></span>Среднее закрытие</div>
          <div class="metric__value"><b>${Math.round(avgPct)}</b><span>%</span></div>
          <div class="metric__foot">По ${mode() === 'points' ? 'story points' : 'задачам'}</div>
        </article>
        <article class="metric">
          <div class="metric__head"><span class="dot dot--amber"></span>Доля unplanned</div>
          <div class="metric__value"><b>${Math.round(avgUnplanned)}</b><span>%</span></div>
          <div class="metric__foot">Сколько объёма съедает внеплановая работа</div>
        </article>
        ${measured.length ? `
        <article class="metric">
          <div class="metric__head"><span class="dot dot--muted"></span>Точность оценки</div>
          <div class="metric__value"><b>${Metrics.fmt(avgAccuracy)}</b><span>SP на человеко-день</span></div>
          <div class="metric__foot">${accuracyHint(avgAccuracy, lastCapacity, measured.length)}</div>
        </article>` : ''}
        <article class="metric">
          <div class="metric__head"><span class="dot dot--muted"></span>Снимаем со спринта</div>
          <div class="metric__value"><b>${Metrics.fmt(avgDropped)}</b><span>${mode() === 'points' ? 'SP' : 'задач'} за спринт</span></div>
          <div class="metric__foot">Систематический перенос — признак перегруженного планирования</div>
        </article>
      </section>

      ${velocitySection(rows)}

      <div class="section-title">Все спринты</div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Спринт</th><th>Даты</th><th>Выполнение</th>
              <th>Planned</th><th>Unplanned</th><th>Снято</th><th>Velocity</th><th></th>
            </tr>
          </thead>
          <tbody>${rows.map(({ s, m }) => historyRow(s, m)).join('')}</tbody>
        </table>
      </div>`;
  }

  /** Из точности оценки следует конкретная рекомендация на планирование. */
  function accuracyHint(accuracy, capacity, sprints) {
    const base = `По ${sprints} ${Metrics.plural(sprints, 'спринту', 'спринтам', 'спринтам')} с заполненным фактом`;
    if (!capacity) return base;
    return `${base}. При ёмкости ${Metrics.fmt(capacity)} п/д берите не больше ~${Metrics.fmt(accuracy * capacity)} SP`;
  }

  /** График velocity: последние спринты слева направо, от старых к новым. */
  function velocitySection(rows) {
    const recent = [...rows].reverse().slice(-12);      // sortedSprints идёт от свежих
    if (recent.length < 2) return '';

    const points = mode() === 'points';
    const data = recent.map(({ s, m }) => {
      const v = Metrics.inMode(m, mode());
      return {
        label: `${Store.parseDate(s.startDate).getDate()}.${String(Store.parseDate(s.startDate).getMonth() + 1).padStart(2, '0')}`,
        title: `${s.name} · взято ${Metrics.fmt(v.total)} ${v.unit}, сделано ${Metrics.fmt(v.done)}` +
               (s.status === 'active' ? ' (спринт ещё идёт)' : ''),
        scope: v.total,
        done: v.done,
        active: s.status === 'active',
      };
    });

    return `
      <section class="card chart-card">
        <div class="card__head">
          <div>
            <div class="card__title">Velocity по спринтам</div>
            <div class="card__sub">Взято против сделанного · в ${unitLabel()}</div>
          </div>
        </div>
        <div class="chart-wrap">${Charts.velocityChart(data, unitLabel())}</div>
        <div class="chart-legend">
          <span><i style="background:var(--green)"></i>Сделано</span>
          <span><i style="background:rgba(255,255,255,.18)"></i>Взято в спринт</span>
          <span><i class="dashed"></i>Средняя velocity по закрытым</span>
        </div>
      </section>`;
  }

  function historyRow(s, m) {
    const v = Metrics.inMode(m, mode());
    const cls = v.pct >= 85 ? 'minibar__fill--good' : v.pct >= 60 ? 'minibar__fill--mid' : '';
    const isActive = s.id === Store.get().activeSprintId;
    return `
      <tr data-sprint-row="${s.id}">
        <td>
          <div class="t-name">${esc(s.name)} ${isActive ? '<span class="pill">текущий</span>' : ''}</div>
          <div class="t-sub">${s.status === 'archived' ? 'Закрыт' : 'В работе'}${s.goal ? ' · ' + esc(s.goal) : ''}</div>
        </td>
        <td class="t-sub" style="white-space:nowrap">${Store.formatRange(s.startDate, s.endDate)}</td>
        <td>
          <div class="minibar">
            <span class="minibar__track"><i class="minibar__fill ${cls}" style="width:${v.pct}%;display:block;height:100%"></i></span>
            <span class="minibar__val">${v.pct}%</span>
          </div>
          <div class="t-sub">${Metrics.fmt(v.done)} из ${Metrics.fmt(v.total)} ${v.unit}</div>
        </td>
        <td class="t-num">
          ${Metrics.fmt(v.planned)}<span class="t-sub"> ${v.unit}</span>
          ${v.carried ? `<div class="t-sub">перенос ${Metrics.fmt(v.carried)} · ${v.carriedShare}%</div>` : ''}
        </td>
        <td class="t-num" style="color:${v.unplanned ? 'var(--amber)' : 'inherit'}">
          ${Metrics.fmt(v.unplanned)}<span class="t-sub"> ${v.unplanned ? `· ${v.unplannedShare}%` : ''}</span>
        </td>
        <td class="t-num">
          ${v.dropped
            ? `${Metrics.fmt(v.dropped)}<span class="t-sub"> · ${v.droppedShare}%</span>
               <div class="t-sub">${m.dropByReason.map(r => `${r.short.toLowerCase()} ${Metrics.fmt(mode() === 'points' ? r.points : r.count)}`).join(', ')}</div>`
            : v.rejected ? '' : '<span class="t-sub">—</span>'}
          ${v.rejected ? `<div class="t-sub" style="color:var(--red)">rejected ${Metrics.fmt(v.rejected)} · ${v.rejectedShare}%</div>` : ''}
        </td>
        <td class="t-num">${Metrics.fmt(m.velocity)}<span class="t-sub"> SP</span></td>
        <td style="text-align:right"><button class="btn btn--ghost btn--sm" data-open-sprint="${s.id}">Открыть</button></td>
      </tr>`;
  }


  /* ═════════════ Обзор ═════════════ */

  const HOME_ICONS = {
    sprint:  '<svg class="ico" viewBox="0 0 24 24"><path d="M4 13h6V4H4v9zm10 7h6v-9h-6v9zM4 20h6v-4H4v4zM14 8h6V4h-6v4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>',
    history: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    epics:   '<svg class="ico" viewBox="0 0 24 24"><path d="M4 6h9M8 12h11M6 18h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    queue:   '<svg class="ico" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="7" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="13.5" y="4.5" width="7" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="3.5" y="13.5" width="17" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
  };

  /** Блок раздела на главной. Все блоки одного размера — ни один раздел не «главнее». */
  function homeCard({ tab, tone, kicker, title, body }) {
    return `
      <button class="home-card home-card--${tone}" data-go="${tab}">
        <span class="home-card__head">
          <span class="home-card__icon">${HOME_ICONS[tone]}</span>
          <span>
            <span class="home-card__kicker">${kicker}</span>
            <span class="home-card__title" style="display:block">${title}</span>
          </span>
          <span class="home-card__go">${ICONS.right}</span>
        </span>
        ${body}
      </button>`;
  }

  const stat = (value, label, warn = false) =>
    `<span class="home-card__stat ${warn ? 'is-warn' : ''}"><b>${value}</b><span>${label}</span></span>`;
  const homeEmpty = text => `<span class="home-card__empty">${text}</span>`;

  function sprintCardBody() {
    const s = Store.activeSprint();
    if (!s) return homeEmpty('Спринта пока нет. Создайте первый и залейте задачи массовым вводом.');
    const m = Metrics.sprintMetrics(s);
    const v = Metrics.inMode(m, mode());
    const when = s.status === 'archived' ? 'закрыт'
      : Store.today() < s.startDate ? `стартует ${Store.formatDate(s.startDate)}`
      : `день ${m.elapsedDays} из ${m.totalDays}`;
    return `
      <span class="home-card__name" title="${esc(s.name)}">${esc(s.name)} · ${when}</span>
      <span class="home-card__value"><b>${v.pct}%</b><span>${Metrics.fmt(v.done)} из ${Metrics.fmt(v.total)} ${unitLabel()}</span></span>
      <span class="home-card__bar"><i style="width:${v.pct}%"></i></span>
      <span class="home-card__stats">
        ${stat(Metrics.fmt(v.inProgress), 'в работе')}
        ${stat(Metrics.fmt(v.unplanned), 'unplanned', v.unplanned > 0)}
        ${stat(s.status === 'archived' ? '—' : m.daysLeft, 'дней осталось')}
      </span>`;
  }

  function historyCardBody() {
    const rows = Store.sortedSprints().map(s => ({ s, m: Metrics.sprintMetrics(s) }));
    const finished = rows.filter(r => r.s.status === 'archived');
    if (!finished.length) return homeEmpty('Закройте первый спринт — здесь появятся velocity и процент закрытия.');
    const avg = f => finished.reduce((a, r) => a + f(r), 0) / finished.length;
    const avgPct = avg(r => (mode() === 'points' ? r.m.pctPoints : r.m.pctTasks));
    const avgUnplanned = avg(r => (mode() === 'points' ? r.m.unplannedSharePoints : r.m.unplannedShareTasks));
    return `
      <span class="home-card__name">${finished.length} ${Metrics.plural(finished.length, 'закрытый спринт', 'закрытых спринта', 'закрытых спринтов')}</span>
      <span class="home-card__value"><b>${Metrics.fmt(avg(r => r.m.velocity))}</b><span>SP — средняя velocity</span></span>
      <span class="home-card__stats">
        ${stat(`${Math.round(avgPct)}%`, 'среднее закрытие')}
        ${stat(`${Math.round(avgUnplanned)}%`, 'доля unplanned')}
        ${stat(Metrics.fmt(finished[0].m.velocity), 'velocity последнего')}
      </span>`;
  }

  function epicsCardBody() {
    const all = Store.epics();
    if (!all.length) return homeEmpty('Загрузите эпики из Jira или заведите вручную.');
    const o = Epics.overview(all, Store.today());
    const r = Epics.readiness(all);
    const inWork = r.stages.find(st => st.id === 'progress').count;
    return `
      <span class="home-card__name">${o.total} ${Metrics.plural(o.total, 'эпик', 'эпика', 'эпиков')} всего</span>
      <span class="home-card__value"><b>${o.open}</b><span>${Metrics.plural(o.open, 'открытый', 'открытых', 'открытых')} · HLE ${Metrics.fmt(o.hleTotal)} п/д</span></span>
      <span class="home-card__stats">
        ${stat(inWork, 'в работе')}
        ${stat(r.ungroomed.count, 'не прошли груминг', r.ungroomed.count > 0)}
        ${stat(o.overdue, 'просрочены', o.overdue > 0)}
      </span>`;
  }

  function queueCardBody() {
    const placed = Store.epics().filter(e => e.queue && !Store.isEpicClosed(e));
    if (!placed.length) return homeEmpty('Расставьте эпики по неделям — увидите загрузку команды наперёд.');
    const thisWeek = Store.mondayOf(Store.today());
    const [now, next] = Epics.queueStats(placed, [thisWeek, Store.addDays(thisWeek, 7)]);
    return `
      <span class="home-card__name">На этой неделе</span>
      <span class="home-card__value"><b>${now.count}</b><span>${Metrics.plural(now.count, 'эпик', 'эпика', 'эпиков')} в работе · ~${Metrics.fmt(now.people)} чел.</span></span>
      <span class="home-card__stats">
        ${stat(placed.length, 'в очереди')}
        ${stat(next.count, 'на след. неделе')}
        ${stat(now.ungroomed, 'без груминга', now.ungroomed > 0)}
      </span>`;
  }

  const SECTION_LABEL = { sprint: 'Спринт', epics: 'Эпики', queue: 'Очередь' };
  const ATTN_EPICS_SHOWN = 4;

  /** «Требует внимания»: всё срочное со всех разделов, с переходом туда, где это чинить. */
  function attentionSection() {
    const items = Attention.collect({
      sprint: Store.activeSprint(), epics: Store.epics(), today: Store.today(), mode: mode(),
    });
    if (!items.length) {
      return `<div class="attn attn--ok"><span class="attn__dot attn__dot--ok"></span>Срочного нет — всё по плану</div>`;
    }
    const epicChips = list => {
      if (!list || !list.length) return '';
      const shown = list.slice(0, ATTN_EPICS_SHOWN).map(e => {
        const due = e.plannedEnd ? ` · ${Store.formatDate(e.plannedEnd)}` : '';
        return `<button class="attn__epic" data-open-epic="${e.id}" title="${esc(e.title)}">${esc(e.key || e.title)}${due}</button>`;
      }).join('');
      const more = list.length > ATTN_EPICS_SHOWN ? `<span class="attn__more">и ещё ${list.length - ATTN_EPICS_SHOWN}</span>` : '';
      return `<div class="attn__epics">${shown}${more}</div>`;
    };
    const actions = it => it.sync
      ? `<button class="btn btn--ghost btn--sm" data-sync="queue-to-plan" title="Planned-даты возьмут из очереди">Очередь → даты</button>
         <button class="btn btn--ghost btn--sm" data-sync="plan-to-queue" title="Очередь переставят по Planned-датам">Даты → очередь</button>`
      : `<button class="btn btn--ghost btn--sm" data-go="${it.go}">Открыть</button>`;

    return `
      <section class="attn">
        <div class="attn__head">
          <span class="section-title">Требует внимания</span>
          <span class="sidebar__count">${items.length}</span>
        </div>
        ${items.map(it => `
          <div class="attn__item attn__item--${it.level}">
            <span class="attn__dot"></span>
            <div class="attn__main">
              <div class="attn__text"><span class="attn__section">${SECTION_LABEL[it.section]}</span>${esc(it.text)}</div>
              ${epicChips(it.epics)}
            </div>
            <div class="attn__actions">${actions(it)}</div>
          </div>`).join('')}
      </section>`;
  }

  function renderHome() {
    $('#homeBody').innerHTML = `${attentionSection()}<div class="home">
      ${homeCard({ tab: 'dashboard', tone: 'sprint', kicker: 'Спринты', title: 'Текущий спринт', body: sprintCardBody() })}
      ${homeCard({ tab: 'history', tone: 'history', kicker: 'Спринты', title: 'История', body: historyCardBody() })}
      ${homeCard({ tab: 'epics', tone: 'epics', kicker: 'Эпики', title: 'Планирование', body: epicsCardBody() })}
      ${homeCard({ tab: 'queue', tone: 'queue', kicker: 'Эпики', title: 'Очередь', body: queueCardBody() })}
    </div>`;
  }

  /* ═════════════ Переключение вкладок и общий рендер ═════════════ */

  /** Вкладка из адреса (#epics) — чтобы перезагрузка и «назад» возвращали в тот же раздел. */
  const tabFromHash = () => {
    const t = location.hash.replace(/^#\/?/, '');
    return TABS.includes(t) ? t : 'home';
  };

  function setTab(tab) {
    if (!TABS.includes(tab)) tab = 'home';
    view.tab = tab;
    const hash = tab === 'home' ? '' : `#${tab}`;
    if (location.hash !== hash) history.pushState(null, '', hash || location.pathname + location.search);
    document.querySelectorAll('.nav__item').forEach(b =>
      b.classList.toggle('is-active', b.dataset.view === tab));
    TABS.forEach(t => { $(`#view-${t}`).hidden = t !== tab; });
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    renderSidebar();
    renderTopbar();
    if (view.tab === 'home') renderHome();
    else if (view.tab === 'dashboard') renderDashboard();
    else if (view.tab === 'epics') Roadmap.render();
    else if (view.tab === 'queue') Queue.render();
    else renderHistory();
  }

  /* ═════════════ Тосты ═════════════ */

  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `<span class="toast__dot"></span><span>${esc(message)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  /**
   * Бейдж приоритета эпика. Стандартный по умолчанию не показываем — иначе он на каждой карточке
   * и глаз перестаёт замечать блокирующие.
   */
  function priorityTag(epic, { showStandard = false } = {}) {
    const p = Store.epicPriorityById(epic.priority);
    if (p.id === 'standard' && !showStandard) return '';
    return `<span class="tag prio prio--${p.id}" title="Приоритет: ${p.label}">${p.label}</span>`;
  }

  return { view, render, renderBoard, renderDashboard, setTab, tabFromHash, toast, esc, filterTasks, priorityTag };
})();
