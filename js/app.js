/* ============================================================
   app.js — связывание: события, модалки, drag & drop, бутстрап.
   ============================================================ */
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* ═════════════ Модалки ═════════════ */

  let lastFocused = null;

  function openModal(id) {
    lastFocused = document.activeElement;
    const el = $('#' + id);
    el.hidden = false;
    const first = el.querySelector('input:not([type=hidden]), textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function closeModal(id) {
    const el = id ? $('#' + id) : null;
    (el ? [el] : $$('.modal')).forEach(m => (m.hidden = true));
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  // Закрытие по бэкдропу / кнопкам [data-close]
  document.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = $$('.modal').find(m => !m.hidden);
      if (open) { closeModal(open.id); return; }
      $('#sprintMenu').hidden = true;
      document.body.classList.remove('nav-open');
    }
  });

  /** Промис-обёртка над диалогом подтверждения. */
  function confirmDialog({ title, text, okLabel = 'Подтвердить', danger = true }) {
    return new Promise(resolve => {
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      const ok = $('#confirmOk');
      ok.textContent = okLabel;
      ok.className = danger ? 'btn btn--danger' : 'btn btn--primary';
      openModal('confirmModal');

      const finish = value => {
        ok.removeEventListener('click', onOk);
        $('#confirmModal').removeEventListener('click', onBackdrop);
        closeModal('confirmModal');
        resolve(value);
      };
      const onOk = () => finish(true);
      const onBackdrop = e => { if (e.target.closest('[data-close]')) finish(false); };

      ok.addEventListener('click', onOk);
      $('#confirmModal').addEventListener('click', onBackdrop);
    });
  }

  /* ═════════════ Спринты ═════════════ */

  function fillStatusSelects() {
    // selected прописываем в разметке: иначе form.reset() скидывает значение на первую опцию
    const options = Store.STATUSES
      .map(s => `<option value="${s.id}" ${s.id === 'todo' ? 'selected' : ''}>${s.label}</option>`).join('');
    $('#taskStatusSelect').innerHTML = options;
    $('#bulkStatusSelect').innerHTML = options;
    $('#taskTypes').innerHTML = Object.keys(Store.TYPE_ALIASES)
      .map(t => `<option value="${t}"></option>`).join('');
    $('#dropReasonSelect').innerHTML = Store.DROP_REASONS
      .map(r => `<option value="${r.id}">${r.label}</option>`).join('');
  }

  function openSprintModal(sprint) {
    const form = $('#sprintForm');
    form.reset();
    form.dataset.editId = sprint ? sprint.id : '';
    $('#sprintModalTitle').textContent = sprint ? 'Редактировать спринт' : 'Новый спринт';

    if (sprint) {
      form.name.value = sprint.name;
      form.goal.value = sprint.goal || '';
      form.startDate.value = sprint.startDate;
      form.endDate.value = sprint.endDate;
    } else {
      const start = Store.today();
      form.name.value = suggestSprintName();
      form.startDate.value = start;
      form.endDate.value = Store.addDays(start, Store.SPRINT_DEFAULT_DAYS - 1);
    }
    updateDurationHint();
    openModal('sprintModal');
  }

  /** «Спринт 25» — продолжаем нумерацию, если она читается из названий. */
  function suggestSprintName() {
    const nums = Store.sprints()
      .map(s => (s.name.match(/(\d+)/) || [])[1])
      .filter(Boolean).map(Number);
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `Спринт ${next}`;
  }

  function updateDurationHint() {
    const form = $('#sprintForm');
    const { startDate, endDate } = form;
    if (!startDate.value || !endDate.value) return;
    const days = Store.diffDays(startDate.value, endDate.value) + 1;
    $('#sprintDurationHint').textContent = days > 0
      ? `Длительность: ${days} ${Metrics.plural(days, 'день', 'дня', 'дней')}${days === 14 ? ' — стандартный двухнедельный спринт' : ''}.`
      : 'Дата окончания должна быть не раньше даты начала.';
  }

  $('#sprintForm').addEventListener('input', e => {
    const form = e.currentTarget;
    // Сдвинули старт — тянем за собой окончание, сохраняя длительность
    if (e.target.name === 'startDate' && form.startDate.value) {
      if (!form.endDate.value || Store.diffDays(form.startDate.value, form.endDate.value) < 0) {
        form.endDate.value = Store.addDays(form.startDate.value, Store.SPRINT_DEFAULT_DAYS - 1);
      }
    }
    updateDurationHint();
  });

  $('#sprintForm').addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target;
    const data = {
      name: form.name.value.trim(),
      goal: form.goal.value.trim(),
      startDate: form.startDate.value,
      endDate: form.endDate.value,
    };
    if (!data.name || !data.startDate || !data.endDate) return;
    if (Store.diffDays(data.startDate, data.endDate) < 0) {
      UI.toast('Дата окончания раньше даты начала', 'err');
      return;
    }

    if (form.dataset.editId) {
      Store.updateSprint(form.dataset.editId, data);
      UI.toast('Спринт обновлён', 'ok');
    } else {
      Store.createSprint(data);
      UI.toast('Спринт создан — добавьте задачи', 'ok');
    }
    closeModal('sprintModal');
    UI.render();
  });

  /* ═════════════ Задачи ═════════════ */

  function openTaskModal(task) {
    const form = $('#taskForm');
    form.reset();
    form.dataset.editId = task ? task.id : '';
    $('#taskModalTitle').textContent = task ? 'Задача' : 'Новая задача';
    $('#btnDeleteTask').hidden = !task;

    if (task) {
      form.key.value = task.key || '';
      form.title.value = task.title;
      form.type.value = task.type || '';
      form.points.value = task.points === null ? '' : task.points;
      form.status.value = task.status;
      form.assignee.value = task.assignee || '';
      form.unplanned.checked = !!task.unplanned;
      form.dropped.checked = !!task.dropped;
      form.dropReason.value = task.dropReason || 'carry';
    } else {
      form.status.value = 'todo';
      // Спринт уже идёт → по умолчанию считаем задачу внеплановой
      const s = Store.activeSprint();
      form.unplanned.checked = !!s && Store.today() > s.startDate;
    }
    syncDropReason();
    openModal('taskModal');
  }

  /** Причина нужна только если задачу действительно снимают со спринта. */
  function syncDropReason() {
    const form = $('#taskForm');
    $('#dropReasonField').hidden = !form.dropped.checked;
    // Закрытая задача не может быть снятой — блокируем переключатель, чтобы не спорил с метриками
    const isDone = form.status.value === 'done';
    form.dropped.disabled = isDone;
    if (isDone) form.dropped.checked = false;
    $('.switch--drop').classList.toggle('is-disabled', isDone);
  }

  $('#taskForm').addEventListener('change', e => {
    if (e.target.name === 'dropped' || e.target.name === 'status') syncDropReason();
  });

  $('#taskForm').addEventListener('submit', e => {
    e.preventDefault();
    const s = Store.activeSprint();
    if (!s) return;
    const form = e.target;
    const data = {
      key: form.key.value.trim().toUpperCase(),
      title: form.title.value.trim(),
      type: form.type.value.trim(),
      points: form.points.value === '' ? null : Number(form.points.value),
      status: form.status.value,
      assignee: form.assignee.value.trim(),
      unplanned: form.unplanned.checked,
      dropped: form.dropped.checked,
      dropReason: form.dropReason.value,
    };
    if (!data.title) return;

    if (form.dataset.editId) {
      Store.updateTask(s.id, form.dataset.editId, data);
      UI.toast('Задача сохранена', 'ok');
    } else {
      Store.addTask(s.id, data);
      UI.toast(data.unplanned ? 'Добавлена внеплановая задача' : 'Задача добавлена', 'ok');
    }
    closeModal('taskModal');
    UI.render();
  });

  $('#btnDeleteTask').addEventListener('click', async () => {
    const s = Store.activeSprint();
    const id = $('#taskForm').dataset.editId;
    if (!s || !id) return;
    const task = s.tasks.find(t => t.id === id);
    const ok = await confirmDialog({
      title: 'Удалить задачу?',
      text: `«${task ? task.title : ''}» исчезнет из спринта и из метрик. Действие необратимо.`,
      okLabel: 'Удалить',
    });
    if (!ok) return;
    Store.deleteTask(s.id, id);
    closeModal('taskModal');
    UI.render();
    UI.toast('Задача удалена');
  });

  /* ── Импорт задач: строками или CSV из Jira ── */

  let bulkMode = 'text';       // 'text' | 'csv'
  let csvRows = null;          // разобранный CSV: [[заголовки], [строка], …]
  let csvMapping = null;       // { key: индекс колонки, title: …, … }

  function switchBulkMode(mode) {
    bulkMode = mode;
    $$('#bulkMode button').forEach(b => b.classList.toggle('is-active', b.dataset.bulkMode === mode));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== mode; });
    renderBulkPreview();
  }

  $('#bulkMode').addEventListener('click', e => {
    const btn = e.target.closest('[data-bulk-mode]');
    if (btn) switchBulkMode(btn.dataset.bulkMode);
  });

  /* Чтение файла: кнопка и перетаскивание */
  $('#csvPick').addEventListener('click', () => $('#csvFile').click());
  $('#csvFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) loadCsvText(await file.text());
  });
  ['dragover', 'dragenter'].forEach(ev => $('#csvDrop').addEventListener(ev, e => {
    e.preventDefault();
    $('#csvDrop').classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(ev => $('#csvDrop').addEventListener(ev, () => $('#csvDrop').classList.remove('is-over')));
  $('#csvDrop').addEventListener('drop', async e => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadCsvText(await file.text());
  });

  function loadCsvText(text) {
    $('#bulkForm').csvText.value = text;
    parseCsvInput();
  }

  /** Разбирает содержимое CSV и строит маппинг колонок. */
  function parseCsvInput() {
    const text = $('#bulkForm').csvText.value.trim();
    csvRows = text ? Store.parseCSV(text) : null;

    if (!csvRows || csvRows.length < 2) {
      csvMapping = null;
      $('#csvMappingBlock').hidden = true;
      $('#statusMapBlock').hidden = true;
      renderBulkPreview();
      return;
    }

    const headers = csvRows[0];
    csvMapping = Store.detectCsvMapping(headers);

    // Если раскладку уже правили руками — восстанавливаем её по именам колонок
    const saved = Store.get().settings.csvMapping;
    if (saved) {
      Store.CSV_FIELDS.forEach(field => {
        const idx = headers.findIndex(h => h === saved[field]);
        if (idx !== -1) csvMapping[field] = idx;
      });
    }

    renderCsvMapping(headers);
    renderBulkPreview();
  }

  function renderCsvMapping(headers) {
    $('#csvMappingBlock').hidden = false;
    $('#csvMapping').innerHTML = Store.CSV_FIELDS.map(field => `
      <label class="map-row">
        <span class="map-row__label">${Store.CSV_FIELD_LABELS[field]}</span>
        <select class="input input--sm" data-csv-field="${field}">
          <option value="-1">— нет —</option>
          ${headers.map((h, i) =>
            `<option value="${i}" ${csvMapping[field] === i ? 'selected' : ''}>${UI.esc(h || `Колонка ${i + 1}`)}</option>`).join('')}
        </select>
      </label>`).join('');
  }

  /** Собирает задачи из активного режима — общая точка для предпросмотра и импорта. */
  function collectBulkItems() {
    const form = $('#bulkForm');
    const defaults = { status: form.status.value, unplanned: form.unplanned.value === '1' };

    if (bulkMode === 'text') {
      return { items: Store.parseBulkText(form.text.value, defaults), unknownStatuses: [], skipped: 0 };
    }
    if (!csvRows || !csvMapping) return { items: [], unknownStatuses: [], skipped: 0 };
    return Store.itemsFromCsv(csvRows, csvMapping, defaults);
  }

  /** Нераспознанные статусы Jira — сопоставляются вручную и запоминаются. */
  let statusMapSignature = '';

  function renderStatusMap(unknown) {
    const block = $('#statusMapBlock');
    block.hidden = bulkMode !== 'csv' || !unknown.length;
    if (block.hidden) { statusMapSignature = ''; return; }

    // Пересобираем список, только если изменился набор статусов
    const signature = unknown.join('|');
    if (signature === statusMapSignature) return;
    statusMapSignature = signature;

    $('#statusMapList').innerHTML = unknown.map(name => `
      <label class="map-row">
        <span class="map-row__label" title="${UI.esc(name)}">${UI.esc(name)}</span>
        <select class="input input--sm" data-status-from="${UI.esc(name)}">
          ${Store.STATUSES.map(st => {
            const current = Store.get().settings.statusMap[Store.normalizeStatusKey(name)] || $('#bulkForm').status.value;
            return `<option value="${st.id}" ${st.id === current ? 'selected' : ''}>${st.label}</option>`;
          }).join('')}
        </select>
      </label>`).join('');
  }

  /** Живой предпросмотр разбора: видно, что именно приедет в спринт. */
  function renderBulkPreview() {
    const box = $('#bulkPreview');
    const sprint = Store.activeSprint();
    const { items, unknownStatuses, skipped } = collectBulkItems();

    renderStatusMap(unknownStatuses);

    if (!items.length) {
      box.innerHTML = `<div class="bulk-preview__empty">${bulkMode === 'csv'
        ? 'Выберите файл или вставьте CSV — здесь появится разбор'
        : 'Вставьте строки — здесь появится разбор: номер, название, тип, статус и оценка'}</div>`;
      $('#bulkSubmit').disabled = true;
      return;
    }

    const existingKeys = new Set((sprint ? sprint.tasks : []).map(t => t.key).filter(Boolean));
    let willUpdate = 0;

    const rows = items.map(item => {
      const isUpdate = item.key && existingKeys.has(item.key);
      if (isUpdate) willUpdate++;
      const st = Store.STATUSES.find(x => x.id === item.status);
      return `
        <div class="bulk-row">
          ${item.key ? `<span class="bulk-row__key">${UI.esc(item.key)}</span>` : '<span class="bulk-row__key is-empty">—</span>'}
          <span class="bulk-row__title">${UI.esc(item.title)}</span>
          ${item.type ? `<span class="tag">${UI.esc(item.type)}</span>` : ''}
          <span class="tag"><i class="dot ${st.dot}"></i>${st.label}</span>
          ${item.points !== null ? `<span class="tag tag--points">${Metrics.fmt(item.points)} SP</span>` : ''}
          ${item.carryCount ? `<span class="tag ${item.carryCount >= 2 ? 'tag--longrun' : 'tag--carry'}">${item.carryCount + 1}-й спринт</span>` : ''}
          ${item.unplanned ? '<span class="tag tag--unplanned">Unplanned</span>' : ''}
          ${isUpdate ? '<span class="tag tag--update">обновит</span>' : ''}
        </div>`;
    }).join('');

    const summary = [
      `Распознано ${items.length} ${Metrics.plural(items.length, 'задача', 'задачи', 'задач')}`,
      willUpdate ? `${willUpdate} обновит существующие` : '',
      skipped ? `${skipped} ${Metrics.plural(skipped, 'строка пропущена', 'строки пропущено', 'строк пропущено')} без названия` : '',
    ].filter(Boolean).join(' · ');

    // Импорт ничего не удаляет: если задачу убрали из спринта в трекере, здесь она останется
    const fileKeys = new Set(items.map(i => i.key).filter(Boolean));
    const orphans = (sprint ? sprint.tasks : []).filter(t => t.key && !fileKeys.has(t.key));
    const orphanNote = orphans.length && willUpdate
      ? `<div class="bulk-preview__warn">
           В спринте ${orphans.length} ${Metrics.plural(orphans.length, 'задача', 'задачи', 'задач')}, ${Metrics.plural(orphans.length, 'которой', 'которых', 'которых')} нет в файле —
           ${UI.esc(orphans.slice(0, 3).map(t => t.key).join(', '))}${orphans.length > 3 ? ' и др.' : ''}.
           Импорт ничего не удаляет: если их убрали из спринта в трекере, снимите их здесь вручную.
         </div>`
      : '';

    box.innerHTML = `<div class="bulk-preview__list">${rows}</div>${orphanNote}<div class="bulk-preview__sum">${summary}</div>`;
    $('#bulkSubmit').disabled = false;
  }

  $('#bulkForm').addEventListener('input', e => {
    if (e.target.name === 'csvText') parseCsvInput();
    else renderBulkPreview();
  });

  $('#bulkForm').addEventListener('change', e => {
    // Правка раскладки колонок — запоминаем по именам, чтобы пережила перезагрузку
    if (e.target.dataset.csvField) {
      csvMapping[e.target.dataset.csvField] = Number(e.target.value);
      const headers = csvRows ? csvRows[0] : [];
      const saved = {};
      Store.CSV_FIELDS.forEach(f => { saved[f] = csvMapping[f] >= 0 ? headers[csvMapping[f]] : null; });
      Store.setSetting('csvMapping', saved);
    }
    // Сопоставление статуса Jira с нашей колонкой — тоже запоминаем
    if (e.target.dataset.statusFrom) {
      const map = { ...Store.get().settings.statusMap };
      map[Store.normalizeStatusKey(e.target.dataset.statusFrom)] = e.target.value;
      Store.setSetting('statusMap', map);
    }
    renderBulkPreview();
  });

  $('#bulkForm').addEventListener('submit', e => {
    e.preventDefault();
    const s = Store.activeSprint();
    if (!s) return;
    const { items } = collectBulkItems();
    if (!items.length) { UI.toast('Нечего добавлять', 'err'); return; }

    const res = Store.addTasksFromItems(s.id, items);

    closeModal('bulkModal');
    $('#bulkForm').reset();
    csvRows = null; csvMapping = null;
    $('#csvMappingBlock').hidden = true;
    $('#statusMapBlock').hidden = true;
    UI.render();

    const parts = [];
    if (res.added) parts.push(`добавлено ${res.added}`);
    if (res.updated) parts.push(`обновлено ${res.updated}`);
    UI.toast(parts.join(', ').replace(/^./, c => c.toUpperCase()), 'ok');
  });

  /* ═════════════ Клики по интерфейсу ═════════════ */

  // Сайдбар: выбор спринта
  $('#sprintList').addEventListener('click', e => {
    const btn = e.target.closest('[data-sprint]');
    if (!btn) return;
    Store.selectSprint(btn.dataset.sprint);
    document.body.classList.remove('nav-open');
    UI.setTab('dashboard');
  });

  // Навигация по вкладкам
  $$('.nav__item').forEach(btn => btn.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    UI.setTab(btn.dataset.view);
  }));

  // История: открыть спринт
  $('#historyBody').addEventListener('click', e => {
    const btn = e.target.closest('[data-open-sprint]');
    if (!btn) return;
    Store.selectSprint(btn.dataset.openSprint);
    UI.setTab('dashboard');
  });

  // Кнопки создания
  $('#btnNewSprint').addEventListener('click', () => openSprintModal(null));
  $('#btnNewSprintEmpty').addEventListener('click', () => openSprintModal(null));
  $('#btnNewTask').addEventListener('click', () => {
    if (!Store.activeSprint()) return UI.toast('Сначала создайте спринт', 'err');
    openTaskModal(null);
  });
  $('#btnBulkAdd').addEventListener('click', () => {
    if (!Store.activeSprint()) return UI.toast('Сначала создайте спринт', 'err');
    const sprint = Store.activeSprint();
    $('#bulkForm').unplanned.value = sprint && Store.today() > sprint.startDate ? '1' : '0';
    switchBulkMode('text');
    openModal('bulkModal');
  });

  // Меню спринта
  $('#btnSprintMenu').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('#sprintMenu');
    const s = Store.activeSprint();
    if (!s) return UI.toast('Нет активного спринта', 'err');
    menu.querySelector('[data-act="archive"]').hidden = s.status === 'archived';
    menu.querySelector('[data-act="reopen"]').hidden = s.status !== 'archived';
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#sprintMenu') && !e.target.closest('#btnSprintMenu')) $('#sprintMenu').hidden = true;
  });

  $('#sprintMenu').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    $('#sprintMenu').hidden = true;
    const s = Store.activeSprint();
    if (!s) return;

    if (btn.dataset.act === 'edit') return openSprintModal(s);

    if (btn.dataset.act === 'archive') return openCloseSprintModal();

    if (btn.dataset.act === 'reopen') return reopenActive();

    if (btn.dataset.act === 'delete') {
      const ok = await confirmDialog({
        title: 'Удалить спринт?',
        text: `«${s.name}» и все его задачи (${s.tasks.length}) будут удалены навсегда. Действие необратимо.`,
        okLabel: 'Удалить',
      });
      if (!ok) return;
      Store.deleteSprint(s.id);
      UI.render();
      UI.toast('Спринт удалён');
    }
  });

  function reopenActive() {
    const s = Store.activeSprint();
    if (!s) return;
    Store.reopenSprint(s.id);
    UI.render();
    UI.toast('Спринт снова в работе', 'ok');
  }
  $('#btnReopenInline').addEventListener('click', reopenActive);

  // Переключатель единиц измерения
  $('#metricMode').addEventListener('click', e => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    Store.setSetting('metricMode', btn.dataset.mode);
    UI.render();
  });

  // График, фильтры и поиск живут внутри перерисовываемого блока → делегирование
  $('#dashboardBody').addEventListener('click', e => {
    const chartBtn = e.target.closest('[data-chart]');
    if (chartBtn) {
      Store.setSetting('chartMode', chartBtn.dataset.chart);
      UI.renderDashboard();
      return;
    }
    const kindBtn = e.target.closest('[data-kind]');
    if (kindBtn) {
      UI.view.kind = kindBtn.dataset.kind;
      UI.renderDashboard();
    }
  });

  $('#dashboardBody').addEventListener('input', e => {
    if (e.target.id !== 'taskSearch') return;
    UI.view.query = e.target.value;
    UI.renderBoard();                     // перерисовываем только доску — фокус в поиске сохраняется
    const s = Store.activeSprint();
    const hint = $('.board-toolbar .hint');
    if (s && hint) {
      const shown = UI.filterTasks(s).length, total = s.tasks.length;
      hint.textContent = shown === total
        ? `${total} ${Metrics.plural(total, 'задача', 'задачи', 'задач')}`
        : `Показано ${shown} из ${total}`;
    }
  });

  // Действия на карточке задачи
  $('#dashboardBody').addEventListener('click', async e => {
    const actBtn = e.target.closest('.task__btn');
    const card = e.target.closest('.task');
    if (!card) return;
    const s = Store.activeSprint();
    if (!s || s.status === 'archived') return;
    const taskId = card.dataset.task;

    if (!actBtn) {                        // клик по телу карточки — открыть редактирование
      const task = s.tasks.find(t => t.id === taskId);
      if (task) openTaskModal(task);
      return;
    }

    const act = actBtn.dataset.act;
    if (act === 'prev' || act === 'next') {
      Store.shiftTaskStatus(s.id, taskId, act === 'next' ? 1 : -1);
      UI.render();
    } else if (act === 'drop') {
      const task = Store.toggleTaskDropped(s.id, taskId);
      UI.render();
      if (task) {
        UI.toast(task.dropped
          ? `Снято со спринта: ${Store.dropReasonById(task.dropReason).short.toLowerCase()}`
          : 'Задача вернулась в спринт', task.dropped ? 'info' : 'ok');
      }
    } else if (act === 'edit') {
      const task = s.tasks.find(t => t.id === taskId);
      if (task) openTaskModal(task);
    } else if (act === 'delete') {
      const task = s.tasks.find(t => t.id === taskId);
      const ok = await confirmDialog({
        title: 'Удалить задачу?',
        text: `«${task ? task.title : ''}» исчезнет из спринта и из метрик.`,
        okLabel: 'Удалить',
      });
      if (!ok) return;
      Store.deleteTask(s.id, taskId);
      UI.render();
      UI.toast('Задача удалена');
    }
  });

  /* ═════════════ Закрытие спринта с переносом ═════════════ */

  /** Строит модалку закрытия: цифры спринта + список незакрытых задач + цель переноса. */
  function openCloseSprintModal() {
    const sprint = Store.activeSprint();
    if (!sprint) return;

    const m = Metrics.sprintMetrics(sprint);
    const v = Metrics.inMode(m, Store.get().settings.metricMode);
    const candidates = Store.carryCandidates(sprint.id);

    $('#closeSummary').innerHTML = `
      <div class="close-summary__row">
        <span><b>${v.pct}%</b> закрытие спринта</span>
        <span><b>${Metrics.fmt(m.velocity)}</b> SP velocity</span>
        <span><b>${Metrics.fmt(v.remaining)}</b> ${v.unit} не закрыто</span>
      </div>
      <div class="hint">«${UI.esc(sprint.name)}» уедет в историю. Вернуть в работу можно в любой момент.</div>`;

    // Список незакрытых задач с полем остаточной оценки
    $('#carryBlock').hidden = candidates.length === 0;
    $('#carryTargetBlock').hidden = candidates.length === 0;
    $('#carryTargetHint').hidden = candidates.length === 0;

    $('#carryList').innerHTML = candidates.map(t => {
      const st = Store.STATUSES.find(x => x.id === t.status);
      const carry = t.carryCount || 0;
      return `
        <label class="carry-row">
          <input type="checkbox" class="carry-check" data-task="${t.id}" checked />
          <span class="carry-row__main">
            ${t.key ? `<span class="bulk-row__key">${UI.esc(t.key)}</span>` : ''}
            <span class="bulk-row__title">${UI.esc(t.title)}</span>
            <span class="tag"><i class="dot ${st.dot}"></i>${st.label}</span>
            ${carry ? `<span class="tag ${carry >= 2 ? 'tag--longrun' : 'tag--carry'}">${carry + 1}-й спринт</span>` : ''}
          </span>
          <span class="carry-row__points">
            <input class="input input--mini" type="number" min="0" max="999" step="0.5"
                   data-points="${t.id}" value="${t.points === null ? '' : t.points}" placeholder="—" />
            <span class="hint hint--tiny">SP</span>
          </span>
        </label>`;
    }).join('');

    // Куда переносить: другой активный спринт или новый
    const others = Store.sortedSprints().filter(x => x.id !== sprint.id && x.status === 'active');
    $('#carryTarget').innerHTML = [
      '<option value="__new__">Создать новый спринт</option>',
      ...others.map(x => `<option value="${x.id}">${UI.esc(x.name)}</option>`),
      '<option value="__none__">Не переносить</option>',
    ].join('');
    $('#carryTarget').value = others.length ? others[0].id : '__new__';
    $('#closeSprintForm').newName.value = suggestSprintName();

    syncCarryTarget();
    updateCarrySummary();
    openModal('closeSprintModal');
  }

  /** Показывает поле названия только когда создаём новый спринт. */
  function syncCarryTarget() {
    const form = $('#closeSprintForm');
    const sprint = Store.activeSprint();
    const isNew = form.carryTo.value === '__new__';
    const isNone = form.carryTo.value === '__none__';

    $('#carryNewNameField').hidden = !isNew;
    $('#carryList').classList.toggle('is-off', isNone);
    $('.carry-actions').hidden = isNone;

    if (!sprint) return;
    const start = Store.addDays(sprint.endDate, 1);
    const end = Store.addDays(start, Store.SPRINT_DEFAULT_DAYS - 1);
    $('#carryTargetHint').textContent = isNone
      ? 'Незакрытые задачи останутся в закрытом спринте как невыполненные.'
      : isNew
        ? `Новый спринт: ${Store.formatRange(start, end)} — 14 дней, сразу станет текущим.`
        : 'Задачи приедут с сохранением номера, типа и текущей стадии работы.';
  }

  function updateCarrySummary() {
    const checked = $$('.carry-check').filter(c => c.checked);
    const points = checked.reduce((acc, c) => {
      const input = $(`[data-points="${c.dataset.task}"]`);
      return acc + (parseFloat(input.value) || 0);
    }, 0);
    $('#carrySummary').textContent = checked.length
      ? `Перенесём ${checked.length} ${Metrics.plural(checked.length, 'задачу', 'задачи', 'задач')} · ${Metrics.fmt(points)} SP`
      : 'Ничего не переносим';
  }

  $('#closeSprintForm').addEventListener('change', e => {
    if (e.target.name === 'carryTo') syncCarryTarget();
    updateCarrySummary();
  });
  $('#closeSprintForm').addEventListener('input', e => {
    if (e.target.dataset.points !== undefined) updateCarrySummary();
  });
  $('#closeSprintForm').addEventListener('click', e => {
    const all = e.target.closest('[data-carry-all]');
    if (!all) return;
    $$('.carry-check').forEach(c => { c.checked = all.dataset.carryAll === '1'; });
    updateCarrySummary();
  });

  $('#closeSprintForm').addEventListener('submit', e => {
    e.preventDefault();
    const sprint = Store.activeSprint();
    if (!sprint) return;
    const form = e.target;
    const target = form.carryTo.value;

    const items = target === '__none__' ? [] : $$('.carry-check')
      .filter(c => c.checked)
      .map(c => {
        const raw = $(`[data-points="${c.dataset.task}"]`).value;
        return { taskId: c.dataset.task, points: raw === '' ? null : Math.max(0, Number(raw)) };
      });

    let targetSprint = null;
    if (items.length) {
      if (target === '__new__') {
        const start = Store.addDays(sprint.endDate, 1);
        targetSprint = Store.createSprint({
          name: form.newName.value.trim() || suggestSprintName(),
          goal: '',
          startDate: start,
          endDate: Store.addDays(start, Store.SPRINT_DEFAULT_DAYS - 1),
        });
      } else {
        targetSprint = Store.sprintById(target);
      }
    }

    const moved = targetSprint ? Store.carryTasks(sprint.id, targetSprint.id, items) : 0;
    Store.archiveSprint(sprint.id);
    if (targetSprint) Store.selectSprint(targetSprint.id);

    closeModal('closeSprintModal');
    UI.render();
    UI.toast(moved
      ? `Спринт закрыт · ${moved} ${Metrics.plural(moved, 'задача переехала', 'задачи переехали', 'задач переехало')} в «${targetSprint.name}»`
      : 'Спринт закрыт и добавлен в историю', 'ok');
  });

  /* ═════════════ Drag & drop ═════════════ */

  let draggedId = null;

  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.task');
    if (!card) return;
    draggedId = card.dataset.task;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
  });

  document.addEventListener('dragend', () => {
    draggedId = null;
    $$('.task.is-dragging').forEach(c => c.classList.remove('is-dragging'));
    $$('.column.is-over').forEach(c => c.classList.remove('is-over'));
  });

  document.addEventListener('dragover', e => {
    const col = e.target.closest('.column');
    if (!col || !draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    $$('.column.is-over').forEach(c => { if (c !== col) c.classList.remove('is-over'); });
    col.classList.add('is-over');
  });

  document.addEventListener('dragleave', e => {
    const col = e.target.closest('.column');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
  });

  document.addEventListener('drop', e => {
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    const id = draggedId || e.dataTransfer.getData('text/plain');
    const s = Store.activeSprint();
    col.classList.remove('is-over');
    if (!id || !s || s.status === 'archived') return;

    const task = s.tasks.find(t => t.id === id);
    if (!task || task.status === col.dataset.status) return;
    Store.setTaskStatus(s.id, id, col.dataset.status);
    UI.render();
    if (col.dataset.status === 'done') UI.toast('Задача закрыта 🎉', 'ok');
  });

  /* ═════════════ Сводка по спринту ═════════════ */

  function renderSummary() {
    const sprint = Store.activeSprint();
    if (!sprint) return;
    $('#summaryText').value = Summary.forSprint(sprint, { withTasks: $('#summaryWithTasks').checked });
  }

  $('#btnSummary').addEventListener('click', () => {
    if (!Store.activeSprint()) return UI.toast('Сначала создайте спринт', 'err');
    renderSummary();
    openModal('summaryModal');
    // Текст сразу выделен: можно копировать привычным Cmd+C, не целясь в кнопку
    setTimeout(() => $('#summaryText').select(), 40);
  });

  $('#summaryWithTasks').addEventListener('change', renderSummary);

  /**
   * Копирование в буфер. Из file:// страница не является secure context,
   * и navigator.clipboard там недоступен — поэтому нужен запасной путь.
   */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('[copy] clipboard API недоступен, пробуем execCommand:', err);
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(helper);
    helper.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    helper.remove();
    return ok;
  }

  $('#btnCopySummary').addEventListener('click', async () => {
    const ok = await copyToClipboard($('#summaryText').value);
    if (ok) {
      UI.toast('Сводка скопирована', 'ok');
      closeModal('summaryModal');
    } else {
      $('#summaryText').select();
      UI.toast('Браузер не дал доступ к буферу — текст выделен, нажмите Cmd/Ctrl+C', 'err');
    }
  });

  /* ═════════════ Экспорт / импорт ═════════════ */

  $('#btnExport').addEventListener('click', () => {
    Store.exportJSON();
    UI.toast('Файл с бэкапом скачан', 'ok');
  });

  $('#btnImport').addEventListener('click', () => $('#importFile').click());

  $('#importFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                  // чтобы повторный выбор того же файла сработал
    if (!file) return;
    try {
      const text = await file.text();
      const next = Store.parseImport(text);
      const ok = await confirmDialog({
        title: 'Заменить текущие данные?',
        text: `В файле ${next.sprints.length} ${Metrics.plural(next.sprints.length, 'спринт', 'спринта', 'спринтов')}. ` +
              `Текущие данные в этом браузере будут перезаписаны — сделайте экспорт, если они нужны.`,
        okLabel: 'Импортировать', danger: false,
      });
      if (!ok) return;
      Store.replaceState(next);
      UI.setTab('dashboard');
      UI.toast('Данные импортированы', 'ok');
    } catch (err) {
      console.error(err);
      UI.toast('Не удалось прочитать файл: ' + err.message, 'err');
    }
  });

  /* ═════════════ Мобильное меню ═════════════ */

  $('#btnMenu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

  /* ═════════════ Горячие клавиши ═════════════ */

  document.addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement.tagName);
    const modalOpen = $$('.modal').some(m => !m.hidden);
    if (typing || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'n' || e.key === 'т') {           // новая задача
      const s = Store.activeSprint();
      if (s && s.status !== 'archived') { e.preventDefault(); openTaskModal(null); }
    } else if (e.key === 's' || e.key === 'ы') {    // сводка по спринту
      if (Store.activeSprint()) { e.preventDefault(); $('#btnSummary').click(); }
    } else if (e.key === '/') {                     // фокус в поиск
      const input = $('#taskSearch');
      if (input) { e.preventDefault(); input.focus(); }
    }
  });

  /* ═════════════ Старт ═════════════ */

  Store.load();
  fillStatusSelects();
  UI.render();
})();
