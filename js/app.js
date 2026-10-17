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
      $('#epicMenu').hidden = true;
      $('#sprintMenu').hidden = true;
      $('#epicsMenu').hidden = true;
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
    $('#epicStatusSelect').innerHTML = Store.EPIC_STATUSES
      .map(s => `<option value="${s.id}" ${s.id === 'backlog' ? 'selected' : ''}>${s.label}</option>`).join('');
    $('#epicPrioritySelect').innerHTML = Store.EPIC_PRIORITIES
      .map(p => `<option value="${p.id}">${p.label}</option>`).join('');
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
      form.capacity.value = sprint.capacity === null ? '' : sprint.capacity;
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
    const working = Store.workingDays(startDate.value, endDate.value);
    $('#sprintDurationHint').textContent = days > 0
      ? `Длительность: ${days} ${Metrics.plural(days, 'день', 'дня', 'дней')}, из них ${working} ${Metrics.plural(working, 'рабочий', 'рабочих', 'рабочих')}` +
        `${days === 14 ? ' — стандартный двухнедельный спринт' : ''}.`
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
      capacity: form.capacity.value === '' ? null : Number(form.capacity.value),
    };
    if (!data.name || !data.startDate || !data.endDate) return;
    if (Store.diffDays(data.startDate, data.endDate) < 0) {
      UI.toast('Дата окончания раньше даты начала', 'err');
      return;
    }

    const editing = !!form.dataset.editId;
    if (editing) {
      Store.updateSprint(form.dataset.editId, data);
      UI.toast('Спринт обновлён', 'ok');
    } else {
      Store.createSprint(data);
      UI.toast('Спринт создан — добавьте задачи', 'ok');
    }
    closeModal('sprintModal');
    // Новый спринт открываем сразу, откуда бы его ни создали
    if (editing) UI.render();
    else UI.setTab('dashboard');
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
          ${item.dropped ? `<span class="tag tag--dropped">снято · ${Store.dropReasonById(item.dropReason).verb}</span>` : ''}
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

  // Обзор: блок раздела ведёт в раздел
  $('#homeBody').addEventListener('click', e => {
    const epicBtn = e.target.closest('[data-open-epic]');
    if (epicBtn) return openEpicModal(Store.epicById(epicBtn.dataset.openEpic));
    const sync = e.target.closest('[data-sync]');
    if (sync) return sync.dataset.sync === 'queue-to-plan' ? queueToPlan() : planToQueue();
    const card = e.target.closest('[data-go]');
    if (card) UI.setTab(card.dataset.go);
  });

  // Кнопки «назад/вперёд» браузера переключают разделы
  window.addEventListener('popstate', () => UI.setTab(UI.tabFromHash()));

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
    // Закрытый спринт — только просмотр, как и вся его доска
    const clear = menu.querySelector('[data-act="clear-tasks"]');
    clear.hidden = s.status === 'archived';
    clear.disabled = !s.tasks.length;
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

    if (btn.dataset.act === 'clear-tasks') {
      const n = s.tasks.length;
      if (!n) return;
      const ok = await confirmDialog({
        title: `Удалить все задачи спринта?`,
        text: `Из «${s.name}» будут удалены все ${n} ${Metrics.plural(n, 'задача', 'задачи', 'задач')} — ` +
              `вместе с метриками, burn-down и отметками переноса. Сам спринт останется пустым. ` +
              `Действие необратимо: если данные нужны, сначала нажмите «Экспорт» в боковой панели.` +
              (FileSync.state().status === 'on' ? ' Файл автосохранения тоже перезапишется.' : ''),
        okLabel: `Удалить ${n} ${Metrics.plural(n, 'задачу', 'задачи', 'задач')}`,
      });
      if (!ok) return;
      const removed = Store.clearSprintTasks(s.id);
      UI.render();
      return UI.toast(`Удалено ${removed} ${Metrics.plural(removed, 'задача', 'задачи', 'задач')} из «${s.name}»`);
    }

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
      return;
    }
    const personChip = e.target.closest('[data-assignee]');
    if (personChip) {
      const id = personChip.dataset.assignee;
      UI.view.assignee = !id || UI.view.assignee === id ? null : id;   // повторный клик снимает фильтр
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

    if (e.target.closest('a')) return;    // клик по ссылке на номер — уходим в трекер

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

    $('#closeSprintForm').spent.value = sprint.spent !== null ? sprint.spent
      : sprint.capacity !== null ? sprint.capacity : '';
    $('#spentField').querySelector('.field__label em').textContent = sprint.capacity
      ? `— ёмкость была ${Metrics.fmt(sprint.capacity)} п/д`
      : '— сколько реально ушло на задачи спринта';

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
    Store.updateSprint(sprint.id, { spent: form.spent.value === '' ? null : Number(form.spent.value) });
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

  /* ═════════════ Эпики ═════════════ */

  /** Все известные люди — из эпиков и из задач спринтов: подсказка в поле исполнителя. */
  function knownPeople() {
    const names = new Map();
    const add = n => { const v = String(n || '').trim(); if (v && !names.has(v.toLowerCase())) names.set(v.toLowerCase(), v); };
    Store.epics().forEach(e => { add(e.assignee); add(e.author); });
    Store.sprints().forEach(sp => sp.tasks.forEach(t => add(t.assignee)));
    return [...names.values()].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function openEpicModal(epic) {
    const form = $('#epicForm');
    form.reset();
    form.dataset.editId = epic ? epic.id : '';
    $('#epicModalTitle').textContent = epic ? (epic.key || 'Эпик') : 'Новый эпик';
    $('#btnDeleteEpic').hidden = !epic;
    $('#btnUnplanEpic').hidden = !epic || !Epics.isScheduled(epic);
    $('#epicPeople').innerHTML = knownPeople().map(n => `<option value="${UI.esc(n)}"></option>`).join('');

    if (epic) {
      ['title', 'key', 'issueId', 'assignee', 'author', 'status', 'priority'].forEach(f => { form[f].value = epic[f] || ''; });
      form.hle.value = epic.hle === null ? '' : epic.hle;
      form.plannedStart.value = epic.plannedStart || '';
      form.plannedEnd.value = epic.plannedEnd || '';
      $('#epicCreatedHint').textContent = `Создано ${new Date(epic.createdAt).toLocaleDateString('ru-RU')}`;
    } else {
      form.status.value = 'backlog';
      form.priority.value = 'standard';
      $('#epicCreatedHint').textContent = '';
    }
    updateEpicWindowHint();
    openModal('epicModal');
  }

  /** Живая подсказка: сколько рабочих дней в окне и сколько людей нужно, чтобы в него уложиться. */
  function updateEpicWindowHint() {
    const form = $('#epicForm');
    const start = form.plannedStart.value, end = form.plannedEnd.value;
    const hle = form.hle.value === '' ? null : Number(form.hle.value);
    const hint = $('#epicWindowHint');
    hint.classList.remove('txt-amber');

    if (!start || !end) {
      hint.textContent = hle
        ? `Без дат эпик не попадёт на Гант. По HLE окно займёт ${Math.ceil(hle)} ${Metrics.plural(Math.ceil(hle), 'рабочий день', 'рабочих дня', 'рабочих дней')} — нажмите кнопку справа.`
        : 'Без дат эпик не попадёт на Гант — его можно поставить и прямо на шкале.';
      return;
    }
    if (Store.diffDays(start, end) < 0) {
      hint.textContent = 'Planned End раньше Planned Start.';
      hint.classList.add('txt-amber');
      return;
    }
    const days = Store.workingDays(start, end);
    const base = `Окно: ${days} ${Metrics.plural(days, 'рабочий день', 'рабочих дня', 'рабочих дней')}`;
    if (!hle) { hint.textContent = `${base}. Укажите HLE — увидите, сколько людей нужно.`; return; }
    const load = days ? hle / days : Infinity;
    const people = Number.isFinite(load) ? (Math.round(load * 10) / 10).toString().replace('.', ',') : '∞';
    hint.textContent = `${base} · HLE ${Metrics.fmt(hle)} п/д → нужно ≈${people} чел` +
      (load > 1 ? ' — одному человеку не успеть' : '');
    if (load > 1) hint.classList.add('txt-amber');
  }

  $('#epicForm').addEventListener('input', e => {
    const form = e.currentTarget;
    // Сдвинули старт за окончание — тянем окончание за собой, сохраняя его смысл «не раньше старта»
    if (e.target.name === 'plannedStart' && form.plannedStart.value &&
        (!form.plannedEnd.value || form.plannedEnd.value < form.plannedStart.value)) {
      form.plannedEnd.value = Epics.windowFromHle(form.plannedStart.value, Number(form.hle.value) || 0).end;
    }
    updateEpicWindowHint();
  });

  $('#btnEpicFitHle').addEventListener('click', () => {
    const form = $('#epicForm');
    const hle = Number(form.hle.value) || 0;
    const w = Epics.windowFromHle(form.plannedStart.value || Store.today(), hle);
    form.plannedStart.value = w.start;
    form.plannedEnd.value = w.end;
    updateEpicWindowHint();
    if (!hle) UI.toast(`HLE не указан — поставили окно по умолчанию, ${Epics.DEFAULT_WINDOW_DAYS} рабочих дней`);
  });

  $('#epicForm').addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target;
    const data = {
      title: form.title.value.trim(),
      key: form.key.value.trim().toUpperCase(),
      issueId: form.issueId.value.trim(),
      assignee: form.assignee.value.trim(),
      author: form.author.value.trim(),
      status: form.status.value,
      priority: form.priority.value,
      hle: form.hle.value === '' ? null : Number(form.hle.value),
      plannedStart: form.plannedStart.value || null,
      plannedEnd: form.plannedEnd.value || null,
    };
    if (!data.title) return;
    if (data.plannedStart && data.plannedEnd && data.plannedEnd < data.plannedStart) {
      UI.toast('Planned End раньше Planned Start', 'err');
      return;
    }
    // По ключу работает повторный импорт — два эпика с одним ключом склеились бы при следующей заливке
    const id = form.dataset.editId;
    if (data.key && Store.epics().some(x => x.key === data.key && x.id !== id)) {
      UI.toast(`Эпик ${data.key} уже есть`, 'err');
      return;
    }

    if (id) {
      const before = Epics.isGroomed(Store.epicById(id));
      const epic = Store.updateEpic(id, data);
      if (!announceReadiness(before, epic)) UI.toast('Эпик сохранён', 'ok');
    } else {
      Store.addEpic(data);
      UI.toast(data.plannedStart ? 'Эпик добавлен в план' : 'Эпик добавлен — поставьте его на шкале', 'ok');
    }
    closeModal('epicModal');
    UI.render();
  });

  $('#btnDeleteEpic').addEventListener('click', async () => {
    const id = $('#epicForm').dataset.editId;
    const epic = id && Store.epicById(id);
    if (!epic) return;
    const ok = await confirmDialog({
      title: 'Удалить эпик?',
      text: `«${epic.key ? epic.key + ' ' : ''}${epic.title}» исчезнет из плана. В Jira он останется — повторный импорт вернёт его.`,
      okLabel: 'Удалить',
    });
    if (!ok) return;
    Store.deleteEpic(id);
    closeModal('epicModal');
    UI.render();
    UI.toast('Эпик удалён');
  });

  $('#btnUnplanEpic').addEventListener('click', () => {
    const id = $('#epicForm').dataset.editId;
    if (!id) return;
    Store.updateEpic(id, { plannedStart: null, plannedEnd: null });
    closeModal('epicModal');
    UI.render();
    UI.toast('Эпик снят с плана');
  });

  /** Итог перетаскивания на Ганте. */
  function commitEpicDrag(epic, patch, { created }) {
    const updated = Store.updateEpic(epic.id, patch);
    UI.render();
    if (!updated) return;
    const name = updated.key || `«${updated.title}»`;
    const dates = Store.formatRange(updated.plannedStart, updated.plannedEnd);
    UI.toast(created ? `${name} в плане: ${dates}` : `${name}: ${dates}`, 'ok');
  }

  /** Итог сортировки за ручку: новый приоритет. */
  function reorderEpic(id, targetId, place) {
    const moved = Store.moveEpic(id, targetId, place);
    UI.render();
    const epic = Store.epicById(id);
    if (!epic || !moved) return;
    UI.toast(`${epic.key || `«${epic.title}»`}: ${epic.rank}-й в порядке`, 'ok');
  }

  /** Тост, если правка перевела эпик через черту груминга — это главное событие на груминге. */
  function announceReadiness(before, epic) {
    const after = Epics.isGroomed(epic);
    if (before === after || after === null) return false;
    const name = epic.key || `«${epic.title}»`;
    UI.toast(after ? `${name} прошёл груминг ✓` : `${name} вернулся в «Не прошли груминг»`, after ? 'ok' : 'info');
    return true;
  }

  Roadmap.init({ onOpen: openEpicModal, onCommit: commitEpicDrag, onReorder: reorderEpic });

  async function epicAction(act) {
    if (act === 'new') return openEpicModal(null);
    if (act === 'import') return openEpicImport();
    if (act === 'export') {
      if (!Store.epics().length) return UI.toast('Эпиков пока нет', 'err');
      Store.exportEpicsCsv(Roadmap.visibleEpics());
      return UI.toast('CSV с планом скачан — его можно залить в Jira', 'ok');
    }
    if (act === 'today') return UI.view.tab === 'queue' ? Queue.scrollToNow() : Roadmap.scrollToToday();
    if (act === 'queue-to-plan') return queueToPlan();
    if (act === 'delete-all') return deleteAllEpics();
    if (act === 'plan-to-queue') return planToQueue();
    if (act === 'sort-priority') {
      const changed = Store.sortEpicsByPriority();
      UI.render();
      return UI.toast(changed ? 'Порядок перестроен: блокирующие наверху, низкие внизу' : 'Порядок уже по приоритету', changed ? 'ok' : 'info');
    }
    if (act === 'toggle-closed') {
      Store.setSetting('roadmapShowClosed', !Store.get().settings.roadmapShowClosed);
      return UI.render();
    }
  }

  /* ── Очередь эпиков ── */

  /** Итог перетаскивания на доске очереди: неделя, длина, приоритет — или обратно в пул. */
  function placeInQueue(epic, { week, span, before, ref, place }) {
    if (before) Store.moveEpic(epic.id, before, 'before');
    if (ref) Store.moveEpic(epic.id, ref, place || 'before');     // вернули в пул на конкретное место
    const wasQueued = !!epic.queue;
    const oldWeek = wasQueued ? epic.queue.week : null;
    const updated = Store.setEpicQueue(epic.id, week, span || (wasQueued ? null : Epics.defaultSpan(epic.hle)));
    UI.render();
    if (!updated) return;
    const name = updated.key || `«${updated.title}»`;
    if (!week) return UI.toast(`${name} убран из очереди`);
    const target = before && Store.epicById(before);
    // Бросили на соседа в той же неделе — это смена порядка, а не переезд
    if (target && oldWeek === updated.queue.week) {
      return UI.toast(`${name} выше, чем ${target.key || `«${target.title}»`}`, 'ok');
    }
    const weeksText = `${updated.queue.span} ${Metrics.plural(updated.queue.span, 'неделя', 'недели', 'недель')}`;
    UI.toast(`${name}: с ${Store.formatDate(updated.queue.week)} · ${weeksText}`, 'ok');
  }

  Queue.init({ onOpen: openEpicModal, onPlace: placeInQueue, onReorder: reorderEpic });

  /* ── Меню эпика по правой кнопке ── */

  let menuEpicId = null;

  function closeEpicMenu() {
    $('#epicMenu').hidden = true;
    menuEpicId = null;
  }

  document.addEventListener('contextmenu', e => {
    const target = e.target.closest('#queueBody [data-qcard], #epicsBody [data-sort-id]');
    if (!target || e.target.closest('a, input, select')) return;   // на ссылке и поле — обычное меню браузера
    const epic = Store.epicById(target.dataset.qcard || target.dataset.sortId);
    if (!epic) return;
    e.preventDefault();
    menuEpicId = epic.id;

    const ranks = Store.epics().map(x => x.rank);
    const menu = $('#epicMenu');
    const inQueueTab = UI.view.tab === 'queue';
    $('#epicMenuTitle').textContent = epic.key ? `${epic.key} · ${epic.title}` : epic.title;
    menu.querySelector('[data-ctx="top"]').disabled = epic.rank === Math.min(...ranks);
    menu.querySelector('[data-ctx="bottom"]').disabled = epic.rank === Math.max(...ranks);
    // Действия очереди — только на её вкладке, там они ожидаемы
    const thisWeek = Store.mondayOf(Store.today());
    menu.querySelector('[data-ctx-queue-sep]').hidden = !inQueueTab;
    menu.querySelector('[data-ctx="take"]').hidden = !inQueueTab || (epic.queue && epic.queue.week === thisWeek);
    menu.querySelector('[data-ctx="unqueue"]').hidden = !inQueueTab || !epic.queue;

    menu.hidden = false;
    // Не даём меню вылезти за край окна
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - width - 8)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - height - 8)}px`;
  });

  $('#epicMenu').addEventListener('click', e => {
    const btn = e.target.closest('[data-ctx]');
    if (!btn || btn.disabled) return;
    const epic = Store.epicById(menuEpicId);
    closeEpicMenu();
    if (!epic) return;
    const name = epic.key || `«${epic.title}»`;
    const act = btn.dataset.ctx;

    if (act === 'open') return openEpicModal(epic);
    if (act === 'top' || act === 'bottom') {
      Store.moveEpicToEdge(epic.id, act);
      UI.render();
      return UI.toast(act === 'top' ? `${name} — в самом верху` : `${name} — в самом низу`, 'ok');
    }
    if (act === 'take') return placeInQueue(epic, { week: Store.mondayOf(Store.today()) });
    if (act === 'unqueue') return placeInQueue(epic, { week: null });
  });

  // Закрытие: клик мимо, прокрутка, Esc, смена размера окна
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#epicMenu')) closeEpicMenu(); });
  document.addEventListener('scroll', closeEpicMenu, true);
  window.addEventListener('resize', closeEpicMenu);

  /** Planned Start / End → очередь. Как и прямой перенос — с подтверждением, если что-то перезапишется. */
  async function planToQueue() {
    const { changes, same } = Epics.planToQueue(Store.epics());
    if (!changes.length) {
      return UI.toast(same ? 'Очередь уже совпадает с Planned-датами' : 'Ни у одного открытого эпика нет Planned Start / End',
        same ? 'ok' : 'err');
    }
    const plural = n => `${n} ${Metrics.plural(n, 'эпик', 'эпика', 'эпиков')}`;
    const ofPlural = n => `${n} ${Metrics.plural(n, 'эпика', 'эпиков', 'эпиков')}`;
    const weeksText = n => `${n} ${Metrics.plural(n, 'неделя', 'недели', 'недель')}`;
    const fresh = changes.filter(c => !c.overwrite).length;
    const over = changes.filter(c => c.overwrite);
    const sample = over.slice(0, 3)
      .map(c => `${c.epic.key || c.epic.title}: с ${Store.formatDate(c.epic.queue.week)}, ${weeksText(c.epic.queue.span)} → ` +
                `с ${Store.formatDate(c.week)}, ${weeksText(c.span)}`)
      .join('; ');

    const ok = await confirmDialog({
      title: 'Разложить очередь по Planned-датам?',
      text: [
        fresh ? `${plural(fresh)} ${Metrics.plural(fresh, 'встанет', 'встанут', 'встанут')} в очередь впервые.` : '',
        over.length ? `У ${ofPlural(over.length)} место в очереди поменяется: ${sample}${over.length > 3 ? ' и др.' : ''}.` : '',
        same ? `Ещё у ${ofPlural(same)} всё уже совпадает.` : '',
        'Неделя — та, где Planned Start, длина — сколько недель задевает окно. Эпики без дат и закрытые не тронем.',
      ].filter(Boolean).join(' '),
      okLabel: 'Разложить',
      danger: over.length > 0,
    });
    if (!ok) return;
    const applied = Store.applyPlanToQueue(changes);
    UI.render();
    UI.toast(`В очереди обновлено ${plural(applied)}`, 'ok');
  }

  /** Очередь → Planned Start / End. Перезапись чужих дат — только после подтверждения. */
  async function queueToPlan() {
    const { changes, same } = Epics.queueToPlan(Store.epics());
    if (!changes.length) {
      return UI.toast(same ? 'Planned-даты уже совпадают с очередью' : 'В очереди нет открытых эпиков', same ? 'ok' : 'err');
    }
    const fresh = changes.filter(c => !c.overwrite).length;
    const over = changes.filter(c => c.overwrite);
    const plural = n => `${n} ${Metrics.plural(n, 'эпик', 'эпика', 'эпиков')}`;
    const ofPlural = n => `${n} ${Metrics.plural(n, 'эпика', 'эпиков', 'эпиков')}`;   // «у 1 эпика», «у 5 эпиков»
    const sample = over.slice(0, 3)
      .map(c => `${c.epic.key || c.epic.title}: ${Store.formatRange(c.epic.plannedStart || c.epic.plannedEnd, c.epic.plannedEnd || c.epic.plannedStart)} → ${Store.formatRange(c.start, c.end)}`)
      .join('; ');

    const ok = await confirmDialog({
      title: 'Перенести очередь в Planned Start/End?',
      text: [
        fresh ? `${plural(fresh)} ${Metrics.plural(fresh, 'получит', 'получат', 'получат')} даты впервые.` : '',
        over.length ? `У ${ofPlural(over.length)} даты перезапишутся: ${sample}${over.length > 3 ? ' и др.' : ''}.` : '',
        same ? `Ещё у ${ofPlural(same)} даты уже совпадают.` : '',
        'Старт — понедельник первой недели, окончание — пятница последней. Эпики вне очереди и закрытые не тронем.',
      ].filter(Boolean).join(' '),
      okLabel: 'Перенести',
      danger: over.length > 0,
    });
    if (!ok) return;
    const applied = Store.applyQueuePlan(changes);
    UI.render();
    UI.toast(`Planned-даты обновлены у ${ofPlural(applied)} — видно на Ганте и в выгрузке CSV`, 'ok');
  }

  $('#queueBody').addEventListener('click', e => {
    const prio = e.target.closest('[data-queue-prio]');
    if (prio) {
      Queue.view.prio = prio.dataset.queuePrio;
      return Queue.render();
    }
    const act = e.target.closest('[data-epic-act]');
    if (act) epicAction(act.dataset.epicAct);
  });

  $('#queueBody').addEventListener('input', e => {
    if (e.target.id !== 'queueSearch') return;
    Queue.view.query = e.target.value;
    Queue.render();
    const input = $('#queueSearch');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  $('#queueBody').addEventListener('change', e => {
    if (e.target.id !== 'queueTeam') return;
    Store.setSetting('queueTeamSize', Store.normalizeDays(e.target.value));
    Queue.render();
  });

  $('#epicActions').addEventListener('click', e => {
    const btn = e.target.closest('[data-epic-act]');
    if (!btn) return;
    $('#epicsMenu').hidden = true;
    epicAction(btn.dataset.epicAct);
  });

  // Меню ⋯ эпиков: редкие и опасные действия, чтобы не мозолили глаза
  $('#btnEpicsMenu').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('#epicsMenu');
    menu.querySelector('[data-epic-act="delete-all"]').disabled = !Store.epics().length;
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#epicsMenu') && !e.target.closest('#btnEpicsMenu')) $('#epicsMenu').hidden = true;
  });

  /** Удалить все эпики — только после явного предупреждения с цифрами. */
  async function deleteAllEpics() {
    const all = Store.epics();
    if (!all.length) return UI.toast('Эпиков нет', 'err');
    const n = all.length;
    const queued = all.filter(e => e.queue).length;
    const ok = await confirmDialog({
      title: 'Удалить все эпики?',
      text: `Будут удалены все ${n} ${Metrics.plural(n, 'эпик', 'эпика', 'эпиков')}` +
            (queued ? `, из них ${queued} ${Metrics.plural(queued, 'стоит', 'стоят', 'стоят')} в очереди` : '') + `. ` +
            `Вместе с ними пропадут порядок, приоритеты, раскладка по неделям, HLE и плановые даты. ` +
            `Повторный импорт из Jira вернёт сами эпики, но не то, что вы настроили здесь. ` +
            `Действие необратимо: если данные нужны, сначала нажмите «Экспорт» в боковой панели.` +
            (FileSync.state().status === 'on' ? ' Файл автосохранения тоже перезапишется.' : ''),
      okLabel: `Удалить ${n} ${Metrics.plural(n, 'эпик', 'эпика', 'эпиков')}`,
    });
    if (!ok) return;
    const removed = Store.deleteAllEpics();
    UI.render();
    UI.toast(`Удалено ${removed} ${Metrics.plural(removed, 'эпик', 'эпика', 'эпиков')}`);
  }

  $('#epicsBody').addEventListener('click', e => {
    const act = e.target.closest('[data-epic-act]');
    if (act) return epicAction(act.dataset.epicAct);
    const viewBtn = e.target.closest('[data-epics-view]');
    if (viewBtn) {
      Store.setSetting('epicsView', viewBtn.dataset.epicsView);
      Roadmap.view.centerOnToday = true;
      return Roadmap.render();
    }
    const stageBtn = e.target.closest('[data-stage]');
    if (stageBtn) {
      const id = stageBtn.dataset.stage;
      Roadmap.view.stage = !id || Roadmap.view.stage === id ? null : id;   // повторный клик снимает фильтр
      return Roadmap.render();
    }
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) {
      Store.setSetting('roadmapZoom', zoom.dataset.zoom);
      return Roadmap.scrollToToday();
    }
    const group = e.target.closest('[data-group]');
    if (group) {
      Store.setSetting('roadmapGroup', group.dataset.group);
      return Roadmap.render();
    }
    if (e.target.closest('a')) return;      // ключ эпика — ссылка в Jira
    if (e.target.closest('[data-grip], input, select')) return;
    const label = e.target.closest('[data-epic-open]');
    if (label) {
      const epic = Store.epicById(label.dataset.epicOpen);
      if (epic) openEpicModal(epic);
    }
  });

  // Правки прямо в строке бэклога: статус и HLE — то, что меняется на груминге, и приоритет
  $('#epicsBody').addEventListener('change', e => {
    const prioId = e.target.dataset.inlinePriority;
    if (prioId) {
      const epic = Store.updateEpic(prioId, { priority: e.target.value });
      UI.render();
      if (epic) UI.toast(`${epic.key || `«${epic.title}»`}: ${Store.epicPriorityById(epic.priority).label.toLowerCase()} приоритет`, 'ok');
      return;
    }
    const statusId = e.target.dataset.inlineStatus;
    const hleId = e.target.dataset.inlineHle;
    const id = statusId || hleId;
    const epic = id && Store.epicById(id);
    if (!epic) return;
    const before = Epics.isGroomed(epic);
    if (statusId) Store.updateEpic(id, { status: e.target.value });
    else Store.updateEpic(id, { hle: e.target.value === '' ? null : Number(e.target.value) });
    UI.render();
    if (!announceReadiness(before, epic)) UI.toast(statusId ? 'Статус обновлён' : 'HLE обновлён', 'ok');
  });

  $('#epicsBody').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.inlineHle) e.target.blur();   // Enter фиксирует оценку
  });

  $('#epicsBody').addEventListener('input', e => {
    if (e.target.id !== 'epicSearch') return;
    Roadmap.view.query = e.target.value;
    Roadmap.render();
    // Перерисовка пересоздаёт поле поиска — возвращаем фокус и курсор
    const input = $('#epicSearch');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  /* ── Импорт эпиков из CSV ── */

  let epicRows = null;      // разобранный CSV
  let epicMapping = null;   // { key: индекс колонки, … }
  let epicStatusSignature = '';

  function openEpicImport() {
    const form = $('#epicImportForm');
    form.reset();
    epicRows = null; epicMapping = null; epicStatusSignature = '';
    $('#epicMappingBlock').hidden = true;
    $('#epicStatusMapBlock').hidden = true;
    renderEpicPreview();
    openModal('epicImportModal');
  }

  $('#epicCsvPick').addEventListener('click', () => $('#epicCsvFile').click());
  $('#epicCsvFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) loadEpicCsv(await file.text());
  });
  ['dragover', 'dragenter'].forEach(ev => $('#epicCsvDrop').addEventListener(ev, e => {
    e.preventDefault();
    $('#epicCsvDrop').classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(ev => $('#epicCsvDrop').addEventListener(ev, () => $('#epicCsvDrop').classList.remove('is-over')));
  $('#epicCsvDrop').addEventListener('drop', async e => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadEpicCsv(await file.text());
  });

  function loadEpicCsv(text) {
    $('#epicImportForm').csvText.value = text;
    parseEpicCsv();
  }

  function parseEpicCsv() {
    const text = $('#epicImportForm').csvText.value.trim();
    epicRows = text ? Store.parseCSV(text) : null;
    if (!epicRows || epicRows.length < 2) {
      epicMapping = null;
      $('#epicMappingBlock').hidden = true;
      renderEpicPreview();
      return;
    }
    const headers = epicRows[0];
    epicMapping = Store.detectCsvMapping(headers, Store.EPIC_CSV_HINTS);
    // Ручные правки раскладки запоминаются по именам колонок
    const saved = Store.get().settings.epicCsvMapping;
    if (saved) {
      Store.EPIC_CSV_FIELDS.forEach(field => {
        const idx = headers.findIndex(h => h === saved[field]);
        if (idx !== -1) epicMapping[field] = idx;
      });
    }
    $('#epicMappingBlock').hidden = false;
    $('#epicMapping').innerHTML = Store.EPIC_CSV_FIELDS.map(field => `
      <label class="map-row">
        <span class="map-row__label">${Store.EPIC_CSV_LABELS[field]}</span>
        <select class="input input--sm" data-epic-field="${field}">
          <option value="-1">— нет —</option>
          ${headers.map((h, i) =>
            `<option value="${i}" ${epicMapping[field] === i ? 'selected' : ''}>${UI.esc(h || `Колонка ${i + 1}`)}</option>`).join('')}
        </select>
      </label>`).join('');
    renderEpicPreview();
  }

  function collectEpicItems() {
    if (!epicRows || !epicMapping) return { items: [], unknownStatuses: [], skipped: 0 };
    return Store.epicItemsFromCsv(epicRows, epicMapping);
  }

  function renderEpicStatusMap(unknown) {
    const block = $('#epicStatusMapBlock');
    block.hidden = !unknown.length;
    if (block.hidden) { epicStatusSignature = ''; return; }
    const signature = unknown.join('|');
    if (signature === epicStatusSignature) return;
    epicStatusSignature = signature;
    $('#epicStatusMapList').innerHTML = unknown.map(name => `
      <label class="map-row">
        <span class="map-row__label" title="${UI.esc(name)}">${UI.esc(name)}</span>
        <select class="input input--sm" data-epic-status-from="${UI.esc(name)}">
          ${Store.EPIC_STATUSES.map(st => `<option value="${st.id}">${st.label}</option>`).join('')}
        </select>
      </label>`).join('');
  }

  function renderEpicPreview() {
    const box = $('#epicPreview');
    const { items, unknownStatuses, skipped } = collectEpicItems();
    renderEpicStatusMap(unknownStatuses);

    if (!items.length) {
      box.innerHTML = '<div class="bulk-preview__empty">Выберите файл или вставьте CSV — здесь появится разбор</div>';
      $('#epicImportSubmit').disabled = true;
      return;
    }

    const overwrite = $('#epicImportForm').overwritePlan.checked;
    let willUpdate = 0, planConflicts = 0;
    const rows = items.map(item => {
      const existing = item.key && Store.epics().find(e => e.key === item.key);
      if (existing) willUpdate++;
      // Даты в файле отличаются от плана здесь — без галки останутся наши
      const conflict = existing && Epics.isScheduled(existing) && item.plannedStart && item.plannedEnd &&
        (item.plannedStart !== existing.plannedStart || item.plannedEnd !== existing.plannedEnd);
      if (conflict) planConflicts++;
      const st = Store.epicStatusById(item.status);
      return `
        <div class="bulk-row">
          ${item.key ? `<span class="bulk-row__key">${UI.esc(item.key)}</span>` : '<span class="bulk-row__key is-empty">—</span>'}
          <span class="bulk-row__title">${UI.esc(item.title)}</span>
          <span class="tag"><i class="dot ${st.dot}"></i>${st.label}</span>
          ${item.priority ? UI.priorityTag(item) : ''}
          ${item.hle !== null ? `<span class="tag tag--points">${Metrics.fmt(item.hle)} п/д</span>` : ''}
          ${item.plannedStart && item.plannedEnd ? `<span class="tag">${Store.formatRange(item.plannedStart, item.plannedEnd)}</span>` : ''}
          ${conflict ? `<span class="tag tag--longrun" title="Здесь: ${Store.formatRange(existing.plannedStart, existing.plannedEnd)}">${overwrite ? 'даты из файла' : 'даты оставим наши'}</span>` : ''}
          ${existing ? '<span class="tag tag--update">обновит</span>' : ''}
        </div>`;
    }).join('');

    const summary = [
      `Распознано ${items.length} ${Metrics.plural(items.length, 'эпик', 'эпика', 'эпиков')}`,
      willUpdate ? `${willUpdate} обновит существующие` : '',
      planConflicts ? `у ${planConflicts} даты отличаются от плана` : '',
      skipped ? `${skipped} ${Metrics.plural(skipped, 'строка пропущена', 'строки пропущено', 'строк пропущено')}` : '',
    ].filter(Boolean).join(' · ');

    const noKey = items.filter(i => !i.key).length;
    const warn = noKey
      ? `<div class="bulk-preview__warn">У ${noKey} ${Metrics.plural(noKey, 'строки', 'строк', 'строк')} нет ключа — повторный импорт их задвоит. Проверьте колонку «Ключ проблемы».</div>`
      : '';
    box.innerHTML = `<div class="bulk-preview__list">${rows}</div>${warn}<div class="bulk-preview__sum">${summary}</div>`;
    $('#epicImportSubmit').disabled = false;
  }

  $('#epicImportForm').addEventListener('input', e => {
    if (e.target.name === 'csvText') parseEpicCsv();
  });

  $('#epicImportForm').addEventListener('change', e => {
    if (e.target.dataset.epicField) {
      epicMapping[e.target.dataset.epicField] = Number(e.target.value);
      const headers = epicRows ? epicRows[0] : [];
      const saved = {};
      Store.EPIC_CSV_FIELDS.forEach(f => { saved[f] = epicMapping[f] >= 0 ? headers[epicMapping[f]] : null; });
      Store.setSetting('epicCsvMapping', saved);
    }
    if (e.target.dataset.epicStatusFrom) {
      const map = { ...Store.get().settings.epicStatusMap };
      map[Store.normalizeStatusKey(e.target.dataset.epicStatusFrom)] = e.target.value;
      Store.setSetting('epicStatusMap', map);
    }
    renderEpicPreview();
  });

  $('#epicImportForm').addEventListener('submit', e => {
    e.preventDefault();
    const { items } = collectEpicItems();
    if (!items.length) return UI.toast('Нечего импортировать', 'err');
    // Нераспознанные статусы, которые так и не тронули, сохраняем по видимому выбору
    $$('[data-epic-status-from]').forEach(sel => {
      const map = { ...Store.get().settings.epicStatusMap };
      const key = Store.normalizeStatusKey(sel.dataset.epicStatusFrom);
      if (!map[key]) { map[key] = sel.value; Store.setSetting('epicStatusMap', map); }
    });
    const res = Store.upsertEpics(collectEpicItems().items, { overwritePlan: e.target.overwritePlan.checked });
    closeModal('epicImportModal');
    UI.setTab('epics');
    const parts = [];
    if (res.added) parts.push(`добавлено ${res.added}`);
    if (res.updated) parts.push(`обновлено ${res.updated}`);
    UI.toast(('Эпики: ' + parts.join(', ')), 'ok');
  });

  /* ═════════════ Сводка по спринту ═════════════ */

  function renderSummary() {
    const sprint = Store.activeSprint();
    if (!sprint) return;
    $('#summaryText').value = Summary.forSprint(sprint, {
      withTasks: $('#summaryWithTasks').checked,
      withPeople: $('#summaryWithPeople').checked,
      withPace: $('#summaryWithPace').checked,
    });
    renderBaseUrlHint();
  }

  /** Живой пример ссылки: сразу видно, что получится из номера задачи. */
  function renderBaseUrlHint() {
    const sprint = Store.activeSprint();
    const sample = (sprint && sprint.tasks.find(t => t.key)) || { key: 'DEV-123' };
    const url = Store.taskUrl(sample.key);
    $('#taskBaseUrlHint').textContent = url
      ? `${sample.key} → ${url}`
      : 'Пусто — в сводке останутся просто номера задач';
  }

  $('#btnSummary').addEventListener('click', () => {
    if (!Store.activeSprint()) return UI.toast('Сначала создайте спринт', 'err');
    const settings = Store.get().settings;
    $('#summaryWithTasks').checked = settings.summaryWithTasks;
    $('#summaryWithPeople').checked = settings.summaryWithPeople;
    $('#summaryWithPace').checked = settings.summaryWithPace;
    $('#taskBaseUrl').value = settings.taskBaseUrl;
    renderSummary();
    openModal('summaryModal');
    // Текст сразу выделен: можно копировать привычным Cmd+C, не целясь в кнопку
    setTimeout(() => $('#summaryText').select(), 40);
  });

  // Настройки сводки запоминаются: не переставлять галки при каждом открытии
  $('#summaryWithTasks').addEventListener('change', e => {
    Store.setSetting('summaryWithTasks', e.target.checked);
    renderSummary();
  });
  $('#summaryWithPeople').addEventListener('change', e => {
    Store.setSetting('summaryWithPeople', e.target.checked);
    renderSummary();
  });
  $('#summaryWithPace').addEventListener('change', e => {
    Store.setSetting('summaryWithPace', e.target.checked);
    renderSummary();
  });
  $('#taskBaseUrl').addEventListener('input', e => {
    Store.setSetting('taskBaseUrl', e.target.value.trim());
    renderSummary();
    UI.renderBoard();          // на карточках номер тоже становится ссылкой
  });

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
        text: `В файле ${next.sprints.length} ${Metrics.plural(next.sprints.length, 'спринт', 'спринта', 'спринтов')}` +
              (next.epics.length ? ` и ${next.epics.length} ${Metrics.plural(next.epics.length, 'эпик', 'эпика', 'эпиков')}` : '') + '. ' +
              `Текущие данные в этом браузере будут перезаписаны — сделайте экспорт, если они нужны.`,
        okLabel: 'Импортировать', danger: false,
      });
      if (!ok) return;
      Store.replaceState(next);
      UI.setTab('home');
      UI.toast('Данные импортированы', 'ok');
    } catch (err) {
      console.error(err);
      UI.toast('Не удалось прочитать файл: ' + err.message, 'err');
    }
  });

  /* ═════════════ Автосохранение в файл ═════════════ */

  const FILE_SYNC_LABELS = {
    off: 'Автосохранение в файл',
    on: 'Автосохранение включено',
    'needs-permission': 'Подтвердить доступ к файлу',
    error: 'Файл недоступен — переподключить',
  };

  function renderFileSync(state) {
    const block = $('#fileSync');
    block.hidden = !state.supported;
    // Где API нет, честно оставляем прежнюю подсказку про экспорт
    $('#storageHint').hidden = state.supported && state.status === 'on';
    if (!state.supported) return;

    block.className = `filesync filesync--${state.status}`;
    $('#fileSyncLabel').textContent = FILE_SYNC_LABELS[state.status];
    $('#fileSyncHint').innerHTML = {
      off: 'Состояние будет писаться в файл на диске. Положите его в синхронизируемую папку — получите доступ с других машин.',
      on: `Пишем в <span class="filesync__name">${UI.esc(state.fileName)}</span>`,
      'needs-permission': `Браузер просит подтвердить доступ к <span class="filesync__name">${UI.esc(state.fileName)}</span> после перезагрузки`,
      error: 'Последняя запись не удалась: файл переместили, удалили или отозвали доступ',
    }[state.status];
  }

  $('#btnFileSync').addEventListener('click', async () => {
    const { status } = FileSync.state();

    if (status === 'on') {
      const ok = await confirmDialog({
        title: 'Отключить автосохранение?',
        text: 'Файл останется на диске со всеми данными, но обновляться перестанет. Данные продолжат жить в браузере.',
        okLabel: 'Отключить', danger: false,
      });
      if (ok) { await FileSync.disconnect(); UI.toast('Автосохранение выключено'); }
      return;
    }

    if (status === 'needs-permission') {
      const granted = await FileSync.grantPermission();
      UI.toast(granted ? 'Доступ подтверждён, пишем в файл' : 'Браузер не дал доступ к файлу', granted ? 'ok' : 'err');
      return;
    }

    const connected = await FileSync.connect(async existing => confirmDialog({
      title: 'В файле уже есть данные',
      text: `Загрузить их в приложение? В файле ${existing.sprints.length} ` +
            `${Metrics.plural(existing.sprints.length, 'спринт', 'спринта', 'спринтов')}. ` +
            `Если нет — файл будет перезаписан текущими данными.`,
      okLabel: 'Загрузить из файла', danger: false,
    }));

    if (connected) {
      UI.render();
      UI.toast('Автосохранение включено', 'ok');
    }
  });

  /* ═════════════ Боковая панель ═════════════ */

  const NARROW = '(max-width: 900px)';
  const isNarrow = () => window.matchMedia(NARROW).matches;

  /**
   * Одна кнопка на два режима: на узком экране панель выдвижная,
   * на десктопе — сворачивается, освобождая ширину под доску.
   */
  function toggleSidebar() {
    if (isNarrow()) {
      document.body.classList.toggle('nav-open');
      return;
    }
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    Store.setSetting('sidebarCollapsed', collapsed);
    syncSidebarButton();
  }

  function syncSidebarButton() {
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    const btn = $('#btnMenu');
    if (isNarrow()) {
      btn.title = 'Меню';
      btn.setAttribute('aria-label', 'Меню');
      return;
    }
    btn.title = collapsed ? 'Показать панель (b)' : 'Скрыть панель (b)';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-expanded', String(!collapsed));
  }

  $('#btnMenu').addEventListener('click', toggleSidebar);
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  window.matchMedia(NARROW).addEventListener('change', syncSidebarButton);

  /* ═════════════ Горячие клавиши ═════════════ */

  document.addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement.tagName);
    const modalOpen = $$('.modal').some(m => !m.hidden);
    if (typing || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;

    const epicTab = UI.view.tab === 'epics' || UI.view.tab === 'queue';
    if (epicTab && (e.key === 'n' || e.key === 'т')) {   // новый эпик
      e.preventDefault();
      openEpicModal(null);
    } else if (epicTab && e.key === '/') {
      const input = $(UI.view.tab === 'queue' ? '#queueSearch' : '#epicSearch');
      if (input) { e.preventDefault(); input.focus(); }
    } else if (e.key === 'n' || e.key === 'т') {           // новая задача
      const s = Store.activeSprint();
      if (s && s.status !== 'archived') { e.preventDefault(); openTaskModal(null); }
    } else if (e.key === 'b' || e.key === 'и') {    // свернуть/показать панель
      e.preventDefault();
      toggleSidebar();
    } else if (e.key === 's' || e.key === 'ы') {    // сводка по спринту
      if (Store.activeSprint()) { e.preventDefault(); $('#btnSummary').click(); }
    } else if (e.key === '/') {                     // фокус в поиск
      const input = $('#taskSearch');
      if (input) { e.preventDefault(); input.focus(); }
    }
  });

  /* ═════════════ Старт ═════════════ */

  Store.load();
  FileSync.init(renderFileSync);
  fillStatusSelects();
  document.body.classList.toggle('sidebar-collapsed', !!Store.get().settings.sidebarCollapsed);
  syncSidebarButton();
  UI.setTab(UI.tabFromHash());
})();
