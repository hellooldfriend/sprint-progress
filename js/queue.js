/* ============================================================
   queue.js — вкладка «Очередь»: конструктор порядка эпиков.

   Доска из недель, эпики — большие карточки. Карточка стоит на неделе старта
   и тянется на столько недель, сколько займёт. В одной неделе может быть
   сколько угодно эпиков — так видно, что взято сейчас, а что потом.
   Planned Start/End здесь не участвуют: это черновик порядка, а не календарный план.

   Жесты:
   - тянуть карточку на неделю — поставить в очередь (из пула или с другой недели);
   - бросить на карточку, стартующую в ту же неделю, — встать перед ней по приоритету;
   - тянуть за правый край — сколько недель занимает эпик;
   - бросить в пул слева — убрать из очереди;
   - клик без движения — открыть эпик.
   ============================================================ */
const Queue = (() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const esc = s => UI.esc(s);

  const COL = 228;            // ширина недели, px — карточка на неделю должна быть «большим квадратом»
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const view = { query: '', scrollToNow: true };
  let weeks = [];
  let handlers = { onOpen() {}, onPlace() {} };

  const settings = () => Store.get().settings;
  const fmtPeople = v => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace('.', ',');

  /** Номер недели по ISO 8601 — так её называют в календарях и в Jira. */
  function isoWeek(iso) {
    const d = Store.parseDate(iso);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));     // четверг этой недели
    const jan4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  }

  function weekLabel(week, nowWeek) {
    const diff = Store.diffDays(nowWeek, week) / 7;
    if (diff === 0) return 'Эта неделя';
    if (diff === 1) return 'Следующая';
    if (diff === -1) return 'Прошлая';
    return `${Store.parseDate(week).getDate()} ${MONTHS[Store.parseDate(week).getMonth()]}`;
  }

  function weekRange(week) {
    const a = Store.parseDate(week), b = Store.parseDate(Store.addDays(week, 4));
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
      : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  }

  function matches(e) {
    const q = view.query.trim().toLowerCase();
    if (!q) return true;
    return [e.key, e.title, e.assignee, Store.epicStatusById(e.status).label]
      .some(f => String(f || '').toLowerCase().includes(q));
  }

  /* ═════════════ Рендер ═════════════ */

  function render() {
    const mount = $('#queueBody');
    if (!mount) return;
    const all = Store.epics();

    if (!all.length) {
      mount.innerHTML = `
        <div class="empty">
          <h2>Эпиков пока нет</h2>
          <p>Загрузите эпики из Jira или заведите вручную — и раскладывайте их по неделям большими карточками:
             что берём сейчас, что следующим, что потом.</p>
          <div class="row row--gap">
            <button class="btn btn--ghost" data-epic-act="import">Импорт CSV из Jira</button>
            <button class="btn btn--primary" data-epic-act="new">Новый эпик</button>
          </div>
        </div>`;
      return;
    }

    const today = Store.today();
    const nowWeek = Store.mondayOf(today);
    const showClosed = settings().roadmapShowClosed;
    const visible = all.filter(e => showClosed || !Store.isEpicClosed(e));
    const byRank = (a, b) => a.rank - b.rank;
    const placed = visible.filter(e => e.queue).sort(byRank);
    const pool = visible.filter(e => !e.queue).sort(byRank);

    weeks = Epics.queueWeeks(placed, today);
    const stats = Epics.queueStats(placed, weeks);
    const team = settings().queueTeamSize;
    const nowIdx = weeks.indexOf(nowWeek);

    const old = $('#queueBoard');
    const scroll = old ? { left: old.scrollLeft, top: old.scrollTop } : null;

    mount.innerHTML = `
      ${toolbarHTML(stats[nowIdx], team)}
      <div class="queue">
        ${poolHTML(pool)}
        <div class="queue__board" id="queueBoard" style="--col:${COL}px;--weeks:${weeks.length}">
          <div class="queue__head">
            ${weeks.map((w, i) => headHTML(w, stats[i], nowWeek, team)).join('')}
          </div>
          <div class="queue__grid" data-queue-grid>
            ${nowIdx > 0 ? `<div class="queue__past" style="width:${nowIdx * COL}px"></div>` : ''}
            ${nowIdx >= 0 ? `<div class="queue__now" style="left:${nowIdx * COL}px"></div>` : ''}
            ${placed.map(e => cardHTML(e, weeks.indexOf(e.queue.week))).join('')}
            ${placed.length ? '' : `<div class="queue__hint" style="left:${Math.max(0, nowIdx) * COL + 16}px">
              ← Перетащите эпик из списка слева на неделю, когда его берёте</div>`}
            <div class="queue__drop" id="queueDrop" hidden></div>
          </div>
        </div>
      </div>
      <p class="hint">
        Карточка стоит на неделе старта и тянется за правый край на нужное число недель — по умолчанию HLE / 5 дней.
        Бросьте карточку на другую, начинающуюся в ту же неделю, — встанет перед ней (выше). Обратно в список слева — убрать из очереди.
        «≈ чел» — сколько людей нужно на неделю: HLE эпика делится на его недели по 5 рабочих дней.
        Planned Start и End эта доска сама не трогает — перенесите раскладку кнопкой «В Planned Start/End»:
        старт — понедельник первой недели, окончание — пятница последней. Обратно — кнопкой «Из Ганта».
      </p>`;

    const board = $('#queueBoard');
    if (view.scrollToNow || !scroll) {
      board.scrollLeft = Math.max(0, (nowIdx - 1) * COL);
      view.scrollToNow = false;
    } else {
      board.scrollLeft = scroll.left;
      board.scrollTop = scroll.top;
    }
  }

  function toolbarHTML(now, team) {
    const nowText = now && now.count
      ? `Сейчас в работе <b>${now.count}</b> ${Metrics.plural(now.count, 'эпик', 'эпика', 'эпиков')}` +
        (now.people ? ` · нужно ≈<b>${fmtPeople(now.people)}</b> чел` : '') +
        (team && now.people > team ? ' <span class="tag tag--over">больше команды</span>' : '')
      : 'На эту неделю ничего не взято';
    return `
      <div class="board-toolbar">
        <label class="search">
          <svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input type="search" id="queueSearch" placeholder="Найти эпик…" value="${esc(view.query)}" />
        </label>
        <label class="queue__team" title="Сколько людей в команде — недели, где нужно больше, подсветятся">
          Команда
          <input class="input input--mini" type="number" min="0" max="999" step="1" id="queueTeam"
                 value="${team === null ? '' : team}" placeholder="—" />
          чел
        </label>
        <button class="btn btn--ghost btn--sm ${settings().roadmapShowClosed ? 'is-on' : ''}" data-epic-act="toggle-closed">
          ${settings().roadmapShowClosed ? 'Скрыть закрытые' : 'Показать закрытые'}</button>
        <button class="btn btn--ghost btn--sm" data-epic-act="today">К этой неделе</button>
        <button class="btn btn--ghost btn--sm" data-epic-act="plan-to-queue"
                title="Разложить эпики по неделям по их Planned Start / End с Ганта">
          <svg class="ico" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M18 3v4h-4M6 21v-4h4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Из Ганта
        </button>
        <button class="btn btn--ghost btn--sm" data-epic-act="queue-to-plan"
                title="Записать недели очереди в Planned Start / End — для Ганта и выгрузки в Jira">
          <svg class="ico" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15h6m-2-2l2 2-2 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          В Planned Start/End
        </button>
        <span class="hint queue__now-text">${nowText}</span>
      </div>`;
  }

  function headHTML(week, st, nowWeek, team) {
    const cls = [
      week === nowWeek ? 'is-now' : '',
      week < nowWeek ? 'is-past' : '',
      team && st.people > team ? 'is-over' : '',
    ].join(' ');
    const load = team ? Math.min(100, Metrics.pct(st.people, team)) : null;
    const tip = [
      `Неделя ${isoWeek(week)}: ${weekRange(week)}`,
      `${st.count} ${Metrics.plural(st.count, 'эпик', 'эпика', 'эпиков')} в работе`,
      st.people ? `≈ ${fmtPeople(st.people)} чел по HLE` : '',
      st.unknown ? `${st.unknown} без HLE — в людях не учтены` : '',
      st.ungroomed ? `${st.ungroomed} не прошли груминг` : '',
    ].filter(Boolean).join('\n');

    return `
      <div class="qh ${cls}" title="${esc(tip)}">
        <div class="qh__top"><b>${weekLabel(week, nowWeek)}</b><span>нед ${isoWeek(week)}</span></div>
        <div class="qh__range">${weekRange(week)}</div>
        <div class="qh__stats">
          ${st.count
            ? `${st.count} ${Metrics.plural(st.count, 'эпик', 'эпика', 'эпиков')}${st.people ? ` · ≈${fmtPeople(st.people)} чел` : ''}${st.unknown ? ` · ${st.unknown}?` : ''}`
            : '<span class="txt-faint">свободно</span>'}
        </div>
        ${load !== null ? `<div class="qh__bar"><i style="width:${load}%"></i></div>` : ''}
      </div>`;
  }

  function poolHTML(pool) {
    const groups = [
      { key: 'groomed', name: 'Прошли груминг', list: pool.filter(e => Epics.isGroomed(e) === true) },
      { key: 'ungroomed', name: 'Не прошли груминг', list: pool.filter(e => Epics.isGroomed(e) === false) },
      { key: 'closed', name: 'Закрытые', list: pool.filter(e => Epics.isGroomed(e) === null) },
    ].filter(g => g.list.length);

    return `
      <aside class="queue__pool" data-queue-pool>
        <div class="queue__pool-head">
          <b>Не в очереди</b>
          <span>${pool.length}</span>
        </div>
        ${groups.length
          ? groups.map(g => `
              <div class="qp-group qp-group--${g.key}">${g.name} · ${g.list.length}</div>
              ${g.list.map(e => cardHTML(e, null)).join('')}`).join('')
          : '<div class="queue__pool-empty">Все эпики разложены по неделям. Перетащите карточку сюда, чтобы убрать из очереди.</div>'}
      </aside>`;
  }

  function cardHTML(e, col) {
    const st = Store.epicStatusById(e.status);
    const stg = Epics.stageById(Epics.stage(e));
    const span = e.queue ? e.queue.span : Epics.defaultSpan(e.hle);
    const url = Store.taskUrl(e.key);
    const key = e.key
      ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener" draggable="false">${esc(e.key)}</a>` : esc(e.key))
      : '';
    const people = e.hle && e.queue ? e.hle / (span * 5) : null;
    const cls = [
      stg.groomed === false ? 'is-ungroomed' : '',
      Store.isEpicClosed(e) ? 'is-closed' : '',
      matches(e) ? '' : 'is-dim',
    ].join(' ');
    const place = col === null ? '' : `grid-column:${col + 1} / span ${span};`;

    return `
      <article class="qcard ${cls}" data-qcard="${e.id}" data-span="${span}"
               style="${place}--stage:${stg.color};--c:${st.color}"
               title="${esc(e.title)}\n${esc(stg.label)} — ${esc(stg.hint)}">
        <div class="qcard__top">
          <span class="gl__key">${key}</span>
          <span class="bl-stage"><i></i>${esc(stg.label)}</span>
        </div>
        <div class="qcard__title">${esc(e.title)}</div>
        <div class="qcard__meta">
          <span class="tag"><i class="dot ${st.dot}"></i>${esc(st.label)}</span>
          <span class="tag ${e.hle === null ? 'tag--dropped' : 'tag--points'}">${e.hle === null ? 'нет HLE' : `${Metrics.fmt(e.hle)} п/д`}</span>
          ${e.assignee ? `<span class="tag tag--assignee">${esc(e.assignee)}</span>` : ''}
        </div>
        <div class="qcard__foot">
          <span>${span} ${Metrics.plural(span, 'неделя', 'недели', 'недель')}</span>
          ${people !== null ? `<span title="Сколько людей нужно, чтобы уложиться">≈${fmtPeople(people)} чел</span>` : ''}
        </div>
        ${col !== null ? '<i class="qcard__resize" data-qresize title="Тяните, чтобы поменять число недель"></i>' : ''}
      </article>`;
  }

  /* ═════════════ Перетаскивание ═════════════ */

  let drag = null;

  function tip(text, x, y) {
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
    el.style.left = `${x + 14}px`;
    el.style.top = `${y + 16}px`;
  }

  /** Индекс недели под левым краем карточки — так карточка «встаёт» туда, где её видно. */
  function weekIndexAt(left) {
    const grid = $('[data-queue-grid]');
    const rect = grid.getBoundingClientRect();
    const idx = Math.round((left - rect.left) / COL);
    return Math.max(0, Math.min(weeks.length - 1, idx));
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const card = e.target.closest('#queueBody .qcard');
    if (!card || e.target.closest('a')) return;
    const epic = Store.epicById(card.dataset.qcard);
    if (!epic) return;
    e.preventDefault();

    const rect = card.getBoundingClientRect();
    const span = Number(card.dataset.span) || 1;
    drag = {
      epic, card, span,
      mode: e.target.closest('[data-qresize]') ? 'resize' : 'move',
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      height: rect.height,
      moved: false,
      target: null,
    };
  }

  function startGhost() {
    const ghost = drag.card.cloneNode(true);
    ghost.classList.add('qcard--ghost');
    ghost.removeAttribute('style');
    ghost.style.setProperty('--stage', drag.card.style.getPropertyValue('--stage'));
    ghost.style.setProperty('--c', drag.card.style.getPropertyValue('--c'));
    ghost.style.width = `${drag.span * COL - 12}px`;
    ghost.style.height = `${drag.height}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.card.classList.add('is-lifted');
    document.body.classList.add('is-sorting');
  }

  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) < 4 && Math.abs(e.clientY - drag.startY) < 4) return;
      drag.moved = true;
      if (drag.mode === 'move') startGhost();
    }

    const board = $('#queueBoard');
    const bRect = board.getBoundingClientRect();
    // У краёв доски подкручиваем недели — тянуть эпик на квартал вперёд, не отпуская
    if (e.clientX > bRect.right - 50) board.scrollLeft += 14;
    else if (e.clientX < bRect.left + 50 && e.clientX > bRect.left) board.scrollLeft -= 14;

    if (drag.mode === 'resize') {
      const span = Math.max(1, Math.min(Store.QUEUE_MAX_SPAN,
        drag.span + Math.round((e.clientX - drag.startX) / COL)));
      const col = weeks.indexOf(drag.epic.queue.week);
      drag.card.style.gridColumn = `${col + 1} / span ${span}`;
      drag.target = { span };
      tip(`${span} ${Metrics.plural(span, 'неделя', 'недели', 'недель')}` +
          (drag.epic.hle ? ` · ≈${fmtPeople(drag.epic.hle / (span * 5))} чел` : ''), e.clientX, e.clientY);
      return;
    }

    const left = e.clientX - drag.offsetX;
    drag.ghost.style.left = `${left}px`;
    drag.ghost.style.top = `${e.clientY - drag.offsetY}px`;

    const drop = $('#queueDrop');
    const pool = $('[data-queue-pool]');
    const pRect = pool.getBoundingClientRect();
    const overPool = e.clientX >= pRect.left && e.clientX <= pRect.right && e.clientY >= pRect.top && e.clientY <= pRect.bottom;
    const overBoard = e.clientX >= bRect.left && e.clientX <= bRect.right && e.clientY >= bRect.top && e.clientY <= bRect.bottom;
    pool.classList.toggle('is-target', overPool && !!drag.epic.queue);

    if (overPool) {
      drag.target = { pool: true };
      drop.hidden = true;
      tip(drag.epic.queue ? 'Убрать из очереди' : '', e.clientX, e.clientY);
      return;
    }
    if (!overBoard) {
      drag.target = null;
      drop.hidden = true;
      tip('', 0, 0);
      return;
    }

    const idx = weekIndexAt(left);
    // Бросили на карточку, которая стартует в ту же неделю, — встаём перед ней по приоритету.
    // Длинная карточка из прошлых недель порядок не меняет: иначе она прыгала бы вниз от любого броска
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const other = under && under.closest('[data-queue-grid] .qcard');
    const otherEpic = other && other.dataset.qcard !== drag.epic.id ? Store.epicById(other.dataset.qcard) : null;
    const before = otherEpic && otherEpic.queue && otherEpic.queue.week === weeks[idx] ? otherEpic.id : null;

    drag.target = { week: weeks[idx], before };
    drop.hidden = false;
    drop.style.left = `${idx * COL}px`;
    drop.style.width = `${drag.span * COL}px`;
    const end = Store.addDays(weeks[idx], (drag.span - 1) * 7 + 4);
    tip(`${weekLabel(weeks[idx], Store.mondayOf(Store.today()))} · до ${Store.formatDate(end)}` +
        (before ? ` · перед ${Store.epicById(before).key || 'эпиком'}` : ''), e.clientX, e.clientY);
  }

  function finish(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    tip('');
    if (d.ghost) d.ghost.remove();
    d.card.classList.remove('is-lifted');
    document.body.classList.remove('is-sorting');
    const pool = $('[data-queue-pool]');
    if (pool) pool.classList.remove('is-target');
    const drop = $('#queueDrop');
    if (drop) drop.hidden = true;

    if (!commit) { render(); return; }
    if (!d.moved) { handlers.onOpen(d.epic); return; }
    if (!d.target) { render(); return; }

    if (d.mode === 'resize') {
      if (d.target.span === d.span) return render();
      return handlers.onPlace(d.epic, { week: d.epic.queue.week, span: d.target.span });
    }
    if (d.target.pool) {
      if (!d.epic.queue) return render();
      return handlers.onPlace(d.epic, { week: null });
    }
    const same = d.epic.queue && d.epic.queue.week === d.target.week && !d.target.before;
    if (same) return render();
    handlers.onPlace(d.epic, { week: d.target.week, span: d.span, before: d.target.before });
  }

  function init(opts) {
    handlers = { ...handlers, ...opts };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', () => finish(true));
    document.addEventListener('pointercancel', () => finish(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) finish(false); });
  }

  function scrollToNow() {
    view.scrollToNow = true;
    render();
  }

  return { view, init, render, scrollToNow, isoWeek };
})();
