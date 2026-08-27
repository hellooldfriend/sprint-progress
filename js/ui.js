/* ============================================================
   ui.js — рендер интерфейса. Читает Store/Metrics, пишет в DOM.
   Обработчики событий живут в app.js.
   ============================================================ */
const UI = (() => {
  'use strict';

  /** Локальное состояние интерфейса (не сохраняется). */
  const view = {
    tab: 'dashboard',      // 'dashboard' | 'history'
    query: '',             // поиск по задачам
    kind: 'all',           // 'all' | 'planned' | 'unplanned'
  };

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const mode = () => Store.get().settings.metricMode;
  const unitLabel = () => (mode() === 'points' ? 'SP' : 'задач');

  /* ═════════════ Иконки ═════════════ */
  const ICONS = {
    left:  '<svg class="ico" viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg class="ico" viewBox="0 0 24 24"><path d="M10 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit:  '<svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>',
    trash: '<svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search:'<svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  /* ═════════════ Сайдбар ═════════════ */

  function renderSidebar() {
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
    else pill = `<span class="pill pill--live">Идёт · день ${m.elapsedDays} из ${m.totalDays}</span>`;

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

    wrap.innerHTML = `
      ${heroHTML(s, m, v)}
      ${metricsHTML(m, v)}
      ${splitHTML(m, v)}
      ${chartHTML(s)}
      <div class="section-title">Доска задач</div>
      ${toolbarHTML(s)}
      <div id="boardMount"></div>
    `;
    renderBoard();
  }

  /* ── Крупный прогресс ── */
  function heroHTML(s, m, v) {
    const doneAll = v.total > 0 && v.pct >= 100;
    const unit = v.unit;
    return `
    <section class="hero">
      <div class="hero__top">
        <div>
          <div class="hero__label">Закрытие спринта — ${mode() === 'points' ? 'по story points' : 'по задачам'}</div>
          <div class="hero__value">
            <span class="hero__pct">${v.pct}<span class="hero__unit">%</span></span>
            <span class="hero__unit">${Metrics.fmt(v.done)} из ${Metrics.fmt(v.total)} ${unit}</span>
          </div>
        </div>
        <div class="hero__side">
          <div class="hero__stat"><b>${Metrics.fmt(v.total)}</b><span>Объём, ${unit}</span></div>
          <div class="hero__stat"><b style="color:var(--green)">${Metrics.fmt(v.done)}</b><span>Сделано</span></div>
          <div class="hero__stat"><b>${Metrics.fmt(v.remaining)}</b><span>Осталось</span></div>
          <div class="hero__stat"><b>${m.daysLeft}</b><span>${Metrics.plural(m.daysLeft, 'день', 'дня', 'дней')} до конца</span></div>
        </div>
      </div>
      <div class="progress">
        <div class="progress__fill ${doneAll ? 'progress__fill--done' : ''}" style="width:${v.pct}%"></div>
        ${s.status === 'active' ? `<div class="progress__marker" style="left:${m.timePct}%"></div>` : ''}
      </div>
      <div class="progress-legend">
        <span><i style="background:var(--accent)"></i>Выполнено ${v.pct}%</span>
        ${s.status === 'active' ? `<span><i style="background:var(--border-strong)"></i>Прошло времени ${m.timePct}%</span>` : ''}
        <span>${statusHint(m, v)}</span>
      </div>
    </section>`;
  }

  /** Дружелюбная подсказка «успеваем / отстаём». */
  function statusHint(m, v) {
    if (m.isEmpty) return 'Добавьте задачи — метрики появятся сразу';
    if (v.pct >= 100) return '🎉 Все задачи закрыты';
    const delta = v.pct - m.timePct;
    if (m.daysLeft === 0) return 'Спринт завершён по времени';
    if (delta >= 5) return `Идём с опережением на ${Math.round(delta)} п.п.`;
    if (delta <= -12) return `Отстаём от графика на ${Math.abs(Math.round(delta))} п.п.`;
    return 'Темп примерно по графику';
  }

  /* ── Карточки метрик ── */
  function metricsHTML(m, v) {
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
        dot: 'dot--accent', title: 'Запланировано', value: Metrics.fmt(v.planned), unit: v.unit,
        spark: plannedDonePct, sparkColor: 'var(--accent)',
        foot: `Закрыто ${Metrics.fmt(v.donePlanned)} из ${Metrics.fmt(v.planned)} · ${plannedDonePct}%`,
      })}
      ${card({
        dot: 'dot--amber', title: 'Незапланировано', value: Metrics.fmt(v.unplanned), unit: v.unit,
        spark: unplannedDonePct, sparkColor: 'var(--amber)',
        foot: v.unplanned > 0
          ? `${v.unplannedShare}% объёма спринта · закрыто ${Metrics.fmt(v.doneUnplanned)}`
          : 'Пока ничего не прилетало — отлично',
      })}
      ${card({
        dot: 'dot--green', title: 'Выполнено', value: Metrics.fmt(v.done), unit: v.unit,
        spark: v.pct, sparkColor: 'var(--green)',
        foot: `${v.pct}% спринта · velocity ${Metrics.fmt(m.velocity)} SP`,
      })}
      ${card({
        dot: 'dot--blue', title: 'Remaining work', value: Metrics.fmt(v.remaining), unit: v.unit,
        spark: 100 - v.pct, sparkColor: 'var(--blue)',
        foot: `В работе и на ревью: ${Metrics.fmt(v.inProgress)} ${v.unit}`,
      })}
      ${card({
        dot: 'dot--muted', title: 'Темп', value: Metrics.fmt(v.pace), unit: `${v.unit}/день`,
        foot: m.daysLeft > 0
          ? `Чтобы успеть, нужно ${Metrics.fmt(v.need)} ${v.unit}/день`
          : 'Время спринта вышло',
      })}
    </section>`;
  }

  /* ── Planned vs Unplanned ── */
  function splitHTML(m, v) {
    const cell = (title, dotClass, value, done, pctVal, color, foot) => `
      <div class="split__cell">
        <div class="split__head"><span class="dot ${dotClass}"></span>${title}</div>
        <div class="split__nums"><b>${Metrics.fmt(value)}</b><span>${v.unit} · закрыто ${Metrics.fmt(done)}</span></div>
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
         <span><i style="background:var(--amber)"></i>Общий объём (растёт от unplanned)</span>`;

    return `
    <section class="card chart-card">
      <div class="card__head">
        <div>
          <div class="card__title">${isDown ? 'Burn-down' : 'Burn-up'}</div>
          <div class="card__sub">${isDown
            ? 'Сколько работы осталось по дням против идеальной линии'
            : 'Сделанное против объёма спринта — виден scope creep'} · в ${unitLabel()}</div>
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
      if (!q) return true;
      return t.title.toLowerCase().includes(q) || (t.assignee || '').toLowerCase().includes(q);
    });
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
      done: 'Пока ничего не закрыто',
    };
    return texts[statusId] || 'Пусто';
  }

  function taskHTML(t, readonly) {
    const idx = Store.STATUS_IDS.indexOf(t.status);
    const isFirst = idx === 0, isLast = idx === Store.STATUS_IDS.length - 1;
    return `
    <article class="task ${t.unplanned ? 'is-unplanned' : ''} ${t.status === 'done' ? 'is-done' : ''}"
             data-task="${t.id}" ${readonly ? '' : 'draggable="true"'}>
      <div class="task__title">${esc(t.title)}</div>
      <div class="task__meta">
        ${t.points !== null ? `<span class="tag tag--points">${Metrics.fmt(t.points)} SP</span>` : ''}
        ${t.unplanned ? '<span class="tag tag--unplanned">Unplanned</span>' : ''}
        ${t.assignee ? `<span class="tag tag--assignee">${esc(t.assignee)}</span>` : ''}
        <span class="tag" title="Добавлена ${new Date(t.createdAt).toLocaleString('ru-RU')}">${Store.formatDate(Store.toISODate(new Date(t.createdAt)))}</span>
        <span class="spacer"></span>
        <div class="task__actions">
          <button class="task__btn" data-act="prev" ${isFirst ? 'disabled' : ''} title="Назад по статусу">${ICONS.left}</button>
          <button class="task__btn" data-act="next" ${isLast ? 'disabled' : ''} title="Вперёд по статусу">${ICONS.right}</button>
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
      </section>

      <div class="section-title">Все спринты</div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Спринт</th><th>Даты</th><th>Выполнение</th>
              <th>Planned</th><th>Unplanned</th><th>Velocity</th><th></th>
            </tr>
          </thead>
          <tbody>${rows.map(({ s, m }) => historyRow(s, m)).join('')}</tbody>
        </table>
      </div>`;
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
        <td class="t-num">${Metrics.fmt(v.planned)}<span class="t-sub"> ${v.unit}</span></td>
        <td class="t-num" style="color:${v.unplanned ? 'var(--amber)' : 'inherit'}">
          ${Metrics.fmt(v.unplanned)}<span class="t-sub"> ${v.unplanned ? `· ${v.unplannedShare}%` : ''}</span>
        </td>
        <td class="t-num">${Metrics.fmt(m.velocity)}<span class="t-sub"> SP</span></td>
        <td style="text-align:right"><button class="btn btn--ghost btn--sm" data-open-sprint="${s.id}">Открыть</button></td>
      </tr>`;
  }

  /* ═════════════ Переключение вкладок и общий рендер ═════════════ */

  function setTab(tab) {
    view.tab = tab;
    document.querySelectorAll('.nav__item').forEach(b =>
      b.classList.toggle('is-active', b.dataset.view === tab));
    $('#view-dashboard').hidden = tab !== 'dashboard';
    $('#view-history').hidden = tab !== 'history';
    render();
  }

  function render() {
    renderSidebar();
    renderTopbar();
    if (view.tab === 'dashboard') renderDashboard();
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

  return { view, render, renderBoard, renderDashboard, setTab, toast, esc, filterTasks };
})();
