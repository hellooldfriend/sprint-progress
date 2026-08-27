/* ============================================================
   summary.js — текстовая сводка по спринту.
   Чистая функция: на входе спринт, на выходе строка, готовая
   к вставке в чат, комментарий к задаче или письмо.
   ============================================================ */
const Summary = (() => {
  'use strict';

  const n = value => Metrics.fmt(value);
  const tasksWord = count => Metrics.plural(count, 'задача', 'задачи', 'задач');

  /** Ключ и название задачи одной строкой: «DEV-123 Починить экспорт». */
  const label = task => (task.key ? `${task.key} ` : '') + task.title;

  /**
   * Сводка по спринту.
   * Идущий спринт описывается как состояние («где мы сейчас»),
   * закрытый — как результат («чем кончилось»).
   *
   * @param {object} sprint
   * @param {{withTasks?: boolean}} options withTasks — добавить перечень задач
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
    lines.push(sprint.name);
    if (sprint.goal) lines.push(`Цель: ${sprint.goal}`);
    lines.push(archived
      ? `${Store.formatRange(sprint.startDate, sprint.endDate)} · спринт закрыт`
      : `${Store.formatRange(sprint.startDate, sprint.endDate)} · день ${m.elapsedDays} из ${m.totalDays}`);

    if (m.isEmpty) {
      lines.push('', 'Задач в спринте нет.');
      return lines.join('\n');
    }

    /* ── Главная цифра ── */
    const pct = byPoints ? m.pctPoints : m.pctTasks;
    const volume = byPoints
      ? `${n(m.donePoints)} из ${n(m.totalPoints)} SP · ${m.doneTasks} из ${m.totalTasks} задач`
      : `${m.doneTasks} из ${m.totalTasks} задач`;
    lines.push('', `Закрытие ${pct}% — ${volume}`);
    if (byPoints && archived) lines.push(`Velocity ${n(m.velocity)} SP`);

    /* ── Состав работы ── */
    const planned = byPoints ? `${n(m.plannedPoints)} SP` : `${m.plannedTasks} ${tasksWord(m.plannedTasks)}`;
    const unplanned = byPoints ? `${n(m.unplannedPoints)} SP` : `${m.unplannedTasks} ${tasksWord(m.unplannedTasks)}`;
    const unplannedShare = byPoints ? m.unplannedSharePoints : m.unplannedShareTasks;

    lines.push('', m.unplannedTasks
      ? `Планово ${planned}, внепланово ${unplanned} — ${unplannedShare}% объёма`
      : `Планово ${planned}, внеплановой работы не прилетало`);

    if (m.carriedTasks) {
      const carried = byPoints ? `${n(m.carriedPoints)} SP` : `${m.carriedTasks} ${tasksWord(m.carriedTasks)}`;
      lines.push(`Долг из прошлых спринтов: ${carried}`);
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
        ? `Не сделано ${notDone}${tail.length ? ': ' + tail.join(', ') : ''}`
        : 'Закрыли всё, что взяли');
    } else {
      const remaining = byPoints ? `${n(m.remainingPoints)} SP` : `${m.remainingTasks} ${tasksWord(m.remainingTasks)}`;
      const inFlight = byPoints ? `${n(m.inProgressPoints)} SP` : `${m.inProgressTasks} ${tasksWord(m.inProgressTasks)}`;
      lines.push(`Осталось ${remaining}, из них в работе ${inFlight}`);

      if (m.droppedTasks) {
        const dropped = byPoints ? `${n(m.droppedPoints)} SP` : `${m.droppedTasks} ${tasksWord(m.droppedTasks)}`;
        lines.push(`Снято со спринта ${dropped}: ${m.dropByReason.map(r => r.verb).join(', ')}`);
      }
      lines.push(paceLine(m, byPoints));
    }

    /* ── Что требует внимания ── */
    if (m.longRunners) {
      const names = sprint.tasks.filter(t => (t.carryCount || 0) >= 2).map(label);
      const verb = Metrics.plural(names.length, 'Едет', 'Едут', 'Едут');
      lines.push('', `${verb} третий спринт и дольше: ${names.join(', ')} — стоит пересобрать или отменить`);
    }

    /* ── Перечень задач ── */
    if (options.withTasks) lines.push('', ...taskList(sprint, byPoints));

    return lines.join('\n');
  }

  /** Темп и прогноз: успеваем или нет. */
  function paceLine(m, byPoints) {
    const pace = byPoints ? m.pacePoints : m.paceTasks;
    const need = byPoints ? m.needPoints : m.needTasks;
    const unit = byPoints ? 'SP' : 'задач';

    if (m.daysLeft === 0) return `Время спринта вышло, темп был ${n(pace)} ${unit}/день`;

    const delta = (byPoints ? m.pctPoints : m.pctTasks) - m.timePct;
    const verdict = delta >= 5 ? `идём с опережением на ${Math.round(delta)} п.п.`
      : delta <= -12 ? `отстаём от графика на ${Math.abs(Math.round(delta))} п.п.`
      : 'идём примерно по графику';
    return `Темп ${n(pace)} ${unit}/день, нужно ${n(need)} ${unit}/день — ${verdict}`;
  }

  /** Перечень: что закрыто и что нет, с пометками переноса и снятия. */
  function taskList(sprint, byPoints) {
    const out = [];
    const points = t => (byPoints && t.points !== null ? ` — ${n(t.points)} SP` : '');

    const done = sprint.tasks.filter(t => t.status === 'done');
    const rest = sprint.tasks.filter(t => t.status !== 'done');

    if (done.length) {
      out.push(`Сделано (${done.length}):`);
      done.forEach(t => out.push(`  ${label(t)}${points(t)}`));
    }
    if (rest.length) {
      if (done.length) out.push('');
      out.push(`Не сделано (${rest.length}):`);
      rest.forEach(t => {
        const marks = [];
        if (t.carriedTo) marks.push(`перенос → ${t.carriedTo.name}`);
        else if (t.dropped) marks.push(Store.dropReasonById(t.dropReason).short.toLowerCase());
        else marks.push(Store.STATUSES.find(s => s.id === t.status).label);
        if (t.unplanned) marks.push('unplanned');
        out.push(`  ${label(t)}${points(t)} (${marks.join(', ')})`);
      });
    }
    return out;
  }

  return { forSprint };
})();
