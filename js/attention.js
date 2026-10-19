/* ============================================================
   attention.js — «Требует внимания»: проблемы со всех разделов
   одним списком. Только считает, в DOM не пишет.
   ============================================================ */
const Attention = (() => {
  'use strict';

  /** За сколько рабочих дней до Planned End эпик считается «скоро срок». */
  const DUE_SOON_DAYS = 5;
  /** Порог «отстаём» — тот же, что в подсказке дашборда и в текстовой сводке. */
  const BEHIND_PP = -12;

  const LEVEL_ORDER = { err: 0, warn: 1, info: 2 };
  const epicsWord = n => `${n} ${Metrics.plural(n, 'эпик', 'эпика', 'эпиков')}`;
  const byEnd = (a, b) => (a.plannedEnd || '').localeCompare(b.plannedEnd || '');

  function sprintItems(s, today, mode) {
    if (!s || s.status === 'archived' || !(s.tasks || []).length) return [];
    const out = [];
    const m = Metrics.sprintMetrics(s);
    const v = Metrics.inMode(m, mode);

    if (today > s.endDate) {
      out.push({
        id: 'sprint-expired', level: 'warn', section: 'sprint', go: 'dashboard',
        text: `Срок спринта «${s.name}» вышел ${Store.formatDate(s.endDate)} — пора закрыть и перенести хвосты`,
      });
    } else if (today >= s.startDate && m.daysLeft > 0 && v.pct - m.timePct <= BEHIND_PP) {
      out.push({
        id: 'sprint-behind', level: 'err', section: 'sprint', go: 'dashboard',
        text: `Спринт отстаёт от графика на ${Math.abs(Math.round(v.pct - m.timePct))} п.п.: ` +
              `закрыто ${v.pct}%, прошло ${m.timePct}% времени`,
      });
    }

    const longRunners = s.tasks.filter(t => (t.carryCount || 0) >= 2 && !Store.isClosedStatus(t.status) && !t.dropped);
    if (longRunners.length) {
      const n = longRunners.length;
      out.push({
        id: 'long-runners', level: 'warn', section: 'sprint', go: 'dashboard',
        text: `${n} ${Metrics.plural(n, 'задача едет', 'задачи едут', 'задач едут')} 3-й спринт и дольше`,
      });
    }
    return out;
  }

  function epicItems(epics, today) {
    const open = epics.filter(e => !Store.isEpicClosed(e));
    const out = [];

    const overdue = open.filter(e => Epics.isScheduled(e) && e.plannedEnd < today).sort(byEnd);
    if (overdue.length) {
      out.push({
        id: 'epics-overdue', level: 'err', section: 'epics', go: 'epics', epics: overdue,
        text: `${epicsWord(overdue.length)} ${Metrics.plural(overdue.length, 'просрочен', 'просрочены', 'просрочены')}: Planned End прошёл, а эпик не закрыт`,
      });
    }

    const dueSoon = open
      .filter(e => Epics.isScheduled(e) && e.plannedEnd >= today && Store.workingDays(today, e.plannedEnd) <= DUE_SOON_DAYS)
      .sort(byEnd);
    if (dueSoon.length) {
      out.push({
        id: 'epics-due-soon', level: 'warn', section: 'epics', go: 'epics', epics: dueSoon,
        text: `${epicsWord(dueSoon.length)} — Planned End в ближайшие ${DUE_SOON_DAYS} рабочих дней`,
      });
    }

    // Без HLE в бэклоге — нормально; плохо, когда эпик уже в работе или в плане
    const noHle = open.filter(e => e.hle === null && (e.queue || Epics.isScheduled(e) || Epics.stage(e) === 'progress'));
    if (noHle.length) {
      out.push({
        id: 'epics-no-hle', level: 'warn', section: 'epics', go: 'epics', epics: noHle,
        text: `${epicsWord(noHle.length)} в работе или в плане без оценки HLE`,
      });
    }

    const thisWeek = Epics.weekStart(today);
    const nextWeek = Store.addDays(thisWeek, 7);
    const ungroomed = open.filter(e => e.queue && Epics.isGroomed(e) === false &&
      (Epics.inQueueWeek(e, thisWeek) || Epics.inQueueWeek(e, nextWeek)));
    if (ungroomed.length) {
      out.push({
        id: 'queue-ungroomed', level: 'warn', section: 'queue', go: 'queue', epics: ungroomed,
        text: `${epicsWord(ungroomed.length)} в очереди на эту или следующую неделю, но не ${Metrics.plural(ungroomed.length, 'прошёл', 'прошли', 'прошли')} груминг`,
      });
    }

    const mismatch = Epics.planMismatch(epics);
    if (mismatch.length) {
      out.push({
        id: 'queue-plan-mismatch', level: 'info', section: 'queue', go: 'queue', epics: mismatch, sync: true,
        text: `У ${mismatch.length} ${Metrics.plural(mismatch.length, 'эпика', 'эпиков', 'эпиков')} место в очереди не совпадает с Planned Start / End`,
      });
    }
    return out;
  }

  /**
   * @returns {Array<{id, level:'err'|'warn'|'info', section, go, text, epics?:Array, sync?:boolean}>}
   *          самые срочные сверху
   */
  function collect({ sprint, epics, today, mode }) {
    return [...sprintItems(sprint, today, mode), ...epicItems(epics || [], today)]
      .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  }

  return { collect, DUE_SOON_DAYS };
})();
