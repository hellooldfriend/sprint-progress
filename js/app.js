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
    const options = Store.STATUSES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
    $('#taskStatusSelect').innerHTML = options;
    $('#bulkStatusSelect').innerHTML = options;
    $('#taskStatusSelect').value = 'todo';
    $('#bulkStatusSelect').value = 'todo';
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
      form.title.value = task.title;
      form.points.value = task.points === null ? '' : task.points;
      form.status.value = task.status;
      form.assignee.value = task.assignee || '';
      form.unplanned.checked = !!task.unplanned;
    } else {
      form.status.value = 'todo';
      // Спринт уже идёт → по умолчанию считаем задачу внеплановой
      const s = Store.activeSprint();
      form.unplanned.checked = !!s && Store.today() > s.startDate;
    }
    openModal('taskModal');
  }

  $('#taskForm').addEventListener('submit', e => {
    e.preventDefault();
    const s = Store.activeSprint();
    if (!s) return;
    const form = e.target;
    const data = {
      title: form.title.value.trim(),
      points: form.points.value === '' ? null : Number(form.points.value),
      status: form.status.value,
      assignee: form.assignee.value.trim(),
      unplanned: form.unplanned.checked,
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

  /* ── Массовый ввод ── */
  $('#bulkForm').addEventListener('submit', e => {
    e.preventDefault();
    const s = Store.activeSprint();
    if (!s) return;
    const form = e.target;
    const count = Store.addTasksBulk(s.id, form.text.value, {
      status: form.status.value,
      unplanned: form.unplanned.value === '1',
    });
    closeModal('bulkModal');
    form.reset();
    UI.render();
    UI.toast(count ? `Добавлено ${count} ${Metrics.plural(count, 'задача', 'задачи', 'задач')}` : 'Нечего добавлять',
             count ? 'ok' : 'err');
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

    if (btn.dataset.act === 'archive') {
      const m = Metrics.sprintMetrics(s);
      const ok = await confirmDialog({
        title: 'Закрыть спринт?',
        text: `«${s.name}» уйдёт в архив: ${m.pctPoints}% по story points, velocity ${Metrics.fmt(m.velocity)} SP, ` +
              `${m.remainingTasks} ${Metrics.plural(m.remainingTasks, 'задача', 'задачи', 'задач')} не закрыто. ` +
              `Спринт можно будет вернуть в работу.`,
        okLabel: 'Закрыть спринт', danger: false,
      });
      if (!ok) return;
      Store.archiveSprint(s.id);
      UI.render();
      UI.toast('Спринт закрыт и добавлен в историю', 'ok');
      return;
    }

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
