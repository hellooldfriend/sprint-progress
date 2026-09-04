/* ============================================================
   summary.js — текстовая сводка по спринту.
   Чистая функция: на входе спринт, на выходе строка, готовая
   к вставке в чат, комментарий к задаче или письмо.
   ============================================================ */
const Summary = (() => {
  'use strict';

  const n = value => Metrics.fmt(value);
  const tasksWord = count => Metrics.plural(count, 'задача', 'задачи', 'задач');

  /**
   * Ключ и название задачи одной строкой: «DEV-123 Починить экспорт».
   * Если в настройках задан адрес трекера, вместо номера подставляется ссылка —
   * чаты и вики превращают её в кликабельную сами, разметка для этого не нужна.
   */
  const label = task => {
    const key = task.key ? (Store.taskUrl(task.key) || task.key) : '';
    return key ? `${key} ${task.title}` : task.title;
  };

  /**
   * Сводка по спринту.
   * Идущий спринт описывается как состояние («где мы сейчас»),
   * закрытый — как результат («чем кончилось»).
   *
   * @param {object} sprint
   * @param {{withTasks?: boolean, withPeople?: boolean, withPace?: boolean}} options
   *        withTasks — перечень задач по колонкам, withPeople — участники и их нагрузка,
   *        withPace — темп и прогноз «успеваем / нет»
   * @returns {string}
   */
  function forSprint(sprint, options = {}) {
    if (!sprint) return '';

    const m = Metrics.sprintMetrics(sprint);
    const archived = sprint.status === 'archived';
    // Если оценок нет вообще, считать в SP бессмысленно — переходим на задачи
    const byPoints = m.totalPoints > 0;
    const lines = [];

    /* ── Шапка ── */
    lines.push(`${archived ? '🏁' : '🏃'} ${sprint.name}`);
    if (sprint.goal) lines.push(`🎯 Цель: ${sprint.goal}`);
    lines.push(archived
      ? `📅 ${Store.formatRange(sprint.startDate, sprint.endDate)} · спринт закрыт`
      : `📅 ${Store.formatRange(sprint.startDate, sprint.endDate)} · рабочий день ${m.elapsedDays} из ${m.totalDays}`);

    if (m.isEmpty) {
      lines.push('', '🫙 Задач в спринте нет.');
      return lines.join('\n');
    }

    /* ── Главная цифра ── */
    const pct = byPoints ? m.pctPoints : m.pctTasks;
    const volume = byPoints
      ? `${n(m.donePoints)} из ${n(m.totalPoints)} SP · ${m.doneTasks} из ${m.totalTasks} задач`
      : `${m.doneTasks} из ${m.totalTasks} задач`;
    lines.push('', `✅ Закрытие ${pct}% — ${volume}`);
    if (byPoints && archived) lines.push(`⚡ Velocity ${n(m.velocity)} SP`);

    /* ── Состав работы ── */
    const planned = byPoints ? `${n(m.plannedPoints)} SP` : `${m.plannedTasks} ${tasksWord(m.plannedTasks)}`;
    const unplanned = byPoints ? `${n(m.unplannedPoints)} SP` : `${m.unplannedTasks} ${tasksWord(m.unplannedTasks)}`;
    const unplannedShare = byPoints ? m.unplannedSharePoints : m.unplannedShareTasks;

    lines.push('', m.unplannedTasks
      ? `🧩 Планово ${planned}, внепланово ${unplanned} — ${unplannedShare}% объёма`
      : `🧩 Планово ${planned}, внеплановой работы не прилетало`);

    if (m.capacity) {
      if (archived && m.spent) {
        lines.push(`📐 Ёмкость ${n(m.capacity)} п/д, потрачено ${n(m.spent)} п/д ` +
          `(фокус ${Math.round(m.focusFactor * 100)}%) — на 1 п/д закрывали ${n(m.estimateAccuracy)} SP`);
      } else {
        const over = Math.round((m.commitRatio - 1) * 100);
        const verdict = over > 5 ? `перебор на ${over}%` : over < -5 ? `запас ${Math.abs(over)}%` : 'ровно по ёмкости';
        lines.push(`📐 Ёмкость ${n(m.capacity)} п/д, взято ${n(m.totalPoints)} SP — ${verdict}`);
      }
    }

    if (m.participants && options.withPeople) {
      const names = m.byAssignee.map(p => p.name).join(', ');
      const unassigned = m.unassignedTasks
        ? `, без исполнителя ${m.unassignedTasks} ${tasksWord(m.unassignedTasks)}`
        : '';
      lines.push(`👥 Участники: ${m.participants} — ${names}${unassigned}`);
    }

    if (m.carriedTasks) {
      const carried = byPoints ? `${n(m.carriedPoints)} SP` : `${m.carriedTasks} ${tasksWord(m.carriedTasks)}`;
      lines.push(`♻️ Долг из прошлых спринтов: ${carried}`);
    }

    /* ── Итог или текущее состояние ── */
    if (archived) {
      const notDone = byPoints ? `${n(m.notDonePoints)} SP` : `${m.notDoneTasks} ${tasksWord(m.notDoneTasks)}`;
      const tail = [];
      m.carryDestinations.forEach(d => {
        tail.push(`перенесено ${byPoints ? `${n(d.points)} SP` : `${d.count} ${tasksWord(d.count)}`} → «${d.name}»`);
      });
      const cancelled = m.dropByReason.filter(r => r.id !== 'carry');
      cancelled.forEach(r => {
        tail.push(`${r.verb} ${byPoints ? `${n(r.points)} SP` : `${r.count} ${tasksWord(r.count)}`}`);
      });
      lines.push(m.notDoneTasks
        ? `📤 Не сделано ${notDone}${tail.length ? ': ' + tail.join(', ') : ''}`
        : '🎉 Закрыли всё, что взяли');
    } else {
      const remaining = byPoints ? `${n(m.remainingPoints)} SP` : `${m.remainingTasks} ${tasksWord(m.remainingTasks)}`;
      const inFlight = byPoints ? `${n(m.inProgressPoints)} SP` : `${m.inProgressTasks} ${tasksWord(m.inProgressTasks)}`;
      lines.push(`⏳ Осталось ${remaining}, из них в работе ${inFlight}`);

      if (m.droppedTasks) {
        const dropped = byPoints ? `${n(m.droppedPoints)} SP` : `${m.droppedTasks} ${tasksWord(m.droppedTasks)}`;
        lines.push(`🚫 Снято со спринта ${dropped}: ${m.dropByReason.map(r => r.verb).join(', ')}`);
      }
      if (options.withPace) lines.push(paceLine(m, byPoints));
    }

    /* ── Что требует внимания ── */
    if (m.longRunners) {
      const names = sprint.tasks.filter(t => (t.carryCount || 0) >= 2).map(label);
      const verb = Metrics.plural(names.length, 'Едет', 'Едут', 'Едут');
      lines.push('', `🔁 ${verb} третий спринт и дольше: ${names.join(', ')} — стоит пересобрать или отменить`);
    }

    /* ── Перечень задач ── */
    if (options.withTasks) {
      lines.push('', ...taskList(sprint, byPoints, archived));
    }
    if (options.withPeople && m.participants) {
      lines.push('', ...peopleList(m, byPoints));
    }

    return lines.join('\n');
  }

  /** Темп и прогноз: успеваем или нет. */
  function paceLine(m, byPoints) {
    const pace = byPoints ? m.pacePoints : m.paceTasks;
    const need = byPoints ? m.needPoints : m.needTasks;
    const unit = byPoints ? 'SP' : 'задач';

    if (m.daysLeft === 0) return `⌛️ Время спринта вышло, темп был ${n(pace)} ${unit}/день`;

    const delta = (byPoints ? m.pctPoints : m.pctTasks) - m.timePct;
    const ahead = delta >= 5, behind = delta <= -12;
    const verdict = ahead ? `идём с опережением на ${Math.round(delta)} п.п.`
      : behind ? `отстаём от графика на ${Math.abs(Math.round(delta))} п.п.`
      : 'идём примерно по графику';
    const icon = ahead ? '🚀' : behind ? '⚠️' : '📈';
    return `${icon} Темп ${n(pace)} ${unit}/день, нужно ${n(need)} ${unit}/день — ${verdict}`;
  }

  /**
   * Перечень задач.
   * У идущего спринта — разбивка по колонкам доски: команде важно, что в работе,
   * что на тестировании, а до чего не дошли. У закрытого — «сделали / не сделали»,
   * потому что там вопрос другой: что получилось и куда делось остальное.
   */
  function taskList(sprint, byPoints, archived) {
    return archived ? resultList(sprint, byPoints) : statusList(sprint, byPoints);
  }

  /** Заголовок группы: «In Progress (2 · 21 SP)». */
  function groupHead(icon, title, tasks, byPoints) {
    const points = Metrics.sum(tasks, 'points');
    const size = byPoints && points > 0 ? `${tasks.length} · ${n(points)} SP` : String(tasks.length);
    return `${icon} ${title} (${size})`;
  }

  /** Строка задачи с пометками, которых не видно из группы. */
  function taskLine(task, byPoints, marks = []) {
    const points = byPoints && task.points !== null ? ` — ${n(task.points)} SP` : '';
    const extra = [...marks];
    if (task.unplanned) extra.push('unplanned');
    if ((task.carryCount || 0) >= 2) extra.push(`${task.carryCount + 1}-й спринт`);
    return `  ${label(task)}${points}${extra.length ? ` (${extra.join(', ')})` : ''}`;
  }

  /** Разбивка по колонкам: сначала закрытое, дальше — по мере удаления от финиша. */
  function statusList(sprint, byPoints) {
    const out = [];
    const live = sprint.tasks.filter(t => !t.dropped);

    // Порядок обратный доске: сперва то, что ближе к готовности
    [...Store.STATUS_IDS].reverse().forEach(statusId => {
      const group = live.filter(t => t.status === statusId);
      if (!group.length) return;
      const status = Store.STATUSES.find(s => s.id === statusId);
      if (out.length) out.push('');
      out.push(groupHead(status.icon, status.label, group, byPoints) + ':');
      group.forEach(t => out.push(taskLine(t, byPoints)));
    });

    // Снятое живёт отдельно: иначе задача в To Do выглядит как та, которую ещё сделают
    const dropped = sprint.tasks.filter(t => t.dropped);
    if (dropped.length) {
      if (out.length) out.push('');
      out.push(groupHead('🚫', 'Снято со спринта', dropped, byPoints) + ':');
      dropped.forEach(t => out.push(taskLine(t, byPoints,
        [t.carriedTo ? `перенос → ${t.carriedTo.name}` : Store.dropReasonById(t.dropReason).verb])));
    }
    return out;
  }

  /** Итог закрытого спринта: что сделали и что нет, с адресом переноса. */
  function resultList(sprint, byPoints) {
    const out = [];
    const done = sprint.tasks.filter(t => t.status === 'done');
    const rest = sprint.tasks.filter(t => t.status !== 'done');

    if (done.length) {
      out.push(groupHead('✅', 'Сделано', done, byPoints) + ':');
      done.forEach(t => out.push(taskLine(t, byPoints)));
    }
    if (rest.length) {
      if (done.length) out.push('');
      out.push(groupHead('📤', 'Не сделано', rest, byPoints) + ':');
      rest.forEach(t => {
        const mark = t.carriedTo
          ? `перенос → ${t.carriedTo.name}`
          : t.dropped
            ? Store.dropReasonById(t.dropReason).verb
            : Store.STATUSES.find(s => s.id === t.status).label;
        out.push(taskLine(t, byPoints, [mark]));
      });
    }
    return out;
  }

  /** Нагрузка по людям: сколько взял и сколько из этого закрыл. */
  function peopleList(m, byPoints) {
    const out = [`👥 Участники (${m.participants}):`];
    m.byAssignee.forEach(p => {
      const volume = byPoints && p.points > 0
        ? `${p.tasks} ${tasksWord(p.tasks)} · ${n(p.points)} SP`
        : `${p.tasks} ${tasksWord(p.tasks)}`;
      const done = byPoints && p.points > 0
        ? `закрыто ${n(p.donePoints)} SP`
        : `закрыто ${p.doneTasks}`;
      out.push(`  ${p.name} — ${volume}, ${done}`);
    });
    if (m.unassignedTasks) {
      out.push(`  Без исполнителя — ${m.unassignedTasks} ${tasksWord(m.unassignedTasks)}` +
        (byPoints && m.unassignedPoints > 0 ? ` · ${n(m.unassignedPoints)} SP` : ''));
    }
    return out;
  }

  return { forSprint };
})();
