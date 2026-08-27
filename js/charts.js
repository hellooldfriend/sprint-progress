/* ============================================================
   charts.js — кастомные SVG-графики без внешних библиотек.
   Отдаёт разметку строкой; вставкой в DOM занимается ui.js.
   ============================================================ */
const Charts = (() => {
  'use strict';

  const W = 760, H = 280;
  const PAD = { top: 18, right: 18, bottom: 34, left: 46 };
  const PLOT_W = W - PAD.left - PAD.right;
  const PLOT_H = H - PAD.top - PAD.bottom;

  /** Красивая верхняя граница шкалы: 0→5→10→20→25… */
  function niceMax(value) {
    if (!value || value <= 0) return 5;
    const steps = [1, 2, 2.5, 5, 10];
    const mag = Math.pow(10, Math.floor(Math.log10(value)));
    for (const s of steps) {
      const cand = s * mag;
      if (cand >= value) return cand;
    }
    return 10 * mag;
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /**
   * Разбивает серию с null-ами на непрерывные сегменты точек {x, y, i, v}.
   * Нужно, чтобы линия обрывалась на «сегодня», а не падала в ноль.
   */
  function segments(values, xOf, yOf) {
    const out = [];
    let cur = [];
    values.forEach((v, i) => {
      if (v === null || v === undefined) {
        if (cur.length) out.push(cur);
        cur = [];
      } else {
        cur.push({ x: xOf(i), y: yOf(v), i, v });
      }
    });
    if (cur.length) out.push(cur);
    return out;
  }

  const toPath = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  /**
   * Главный рендер.
   * @param {object} series — результат Metrics.burnSeries
   * @param {'burndown'|'burnup'} mode
   * @param {string} unit — подпись единиц ('SP' | 'задач')
   */
  function burnChart(series, mode, unit) {
    const { days, scope, completed, remaining, ideal, todayIdx } = series;
    const n = days.length;
    const isDown = mode === 'burndown';

    const peak = Math.max(
      0,
      ...scope.filter(v => v !== null),
      ...ideal.filter(v => v !== null),
      ...remaining.filter(v => v !== null),
      ...completed.filter(v => v !== null)
    );
    const yMax = niceMax(peak);

    const xOf = i => PAD.left + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
    const yOf = v => PAD.top + PLOT_H - (Math.max(0, v) / yMax) * PLOT_H;

    /* ── Сетка и подписи оси Y ── */
    const TICKS = 4;
    let grid = '';
    for (let k = 0; k <= TICKS; k++) {
      const val = (yMax / TICKS) * k;
      const y = yOf(val);
      grid += `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}"
                 stroke="rgba(255,255,255,.06)" stroke-width="1" />`;
      grid += `<text x="${PAD.left - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end"
                 fill="#6b6b76" font-size="10.5" font-family="ui-monospace, monospace">${Metrics.fmt(val)}</text>`;
    }

    /* ── Подписи оси X (дни спринта) ── */
    const step = n > 16 ? 3 : n > 10 ? 2 : 1;
    let xLabels = '';
    days.forEach((d, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const date = Store.parseDate(d);
      xLabels += `<text x="${xOf(i).toFixed(1)}" y="${H - 12}" text-anchor="middle"
                    fill="#6b6b76" font-size="10.5">${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}</text>`;
    });

    /* ── Вертикаль «сегодня» ── */
    let todayLine = '';
    if (todayIdx >= 0) {
      const x = xOf(todayIdx).toFixed(1);
      todayLine = `
        <line x1="${x}" y1="${PAD.top - 6}" x2="${x}" y2="${PAD.top + PLOT_H}"
              stroke="rgba(255,255,255,.22)" stroke-width="1" stroke-dasharray="3 4" />
        <text x="${x}" y="${PAD.top - 9}" text-anchor="middle" fill="#6b6b76" font-size="10">сегодня</text>`;
    }

    /* ── Серии ── */
    const mainVals = isDown ? remaining : completed;
    const mainColor = isDown ? '#8b5cf6' : '#22c55e';
    const gradId = isDown ? 'gradDown' : 'gradUp';

    let areas = '', lines = '', dots = '';

    segments(mainVals, xOf, yOf).forEach(pts => {
      if (pts.length === 1) {
        // одна точка — линии нет, рисуем только маркер
      } else {
        const base = PAD.top + PLOT_H;
        areas += `<path d="${toPath(pts)} L${pts[pts.length - 1].x.toFixed(1)} ${base} L${pts[0].x.toFixed(1)} ${base} Z"
                    fill="url(#${gradId})" />`;
        lines += `<path d="${toPath(pts)}" fill="none" stroke="${mainColor}" stroke-width="2.25"
                    stroke-linecap="round" stroke-linejoin="round" />`;
      }
      pts.forEach(p => {
        const label = isDown ? 'Остаток' : 'Сделано';
        dots += `<circle class="pt" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2"
                   fill="#0a0a0a" stroke="${mainColor}" stroke-width="2">
                   <title>${esc(Store.formatDate(days[p.i]))} — ${label}: ${Metrics.fmt(p.v)} ${esc(unit)}</title>
                 </circle>`;
      });
    });

    // Вспомогательная линия: идеал (burn-down) либо scope (burn-up)
    const helperVals = isDown ? ideal : scope;
    const helperColor = isDown ? '#6b6b76' : '#f59e0b';
    const helperPts = segments(helperVals, xOf, yOf);
    let helper = '';
    helperPts.forEach(pts => {
      helper += `<path d="${toPath(pts)}" fill="none" stroke="${helperColor}" stroke-width="1.75"
                   stroke-dasharray="${isDown ? '5 5' : '0'}" stroke-linecap="round" opacity="${isDown ? .8 : .95}" />`;
    });
    if (!isDown) {
      // на burn-up подписываем конечный объём работ
      const last = helperPts.length ? helperPts[helperPts.length - 1].slice(-1)[0] : null;
      if (last) {
        dots += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.2"
                   fill="#0a0a0a" stroke="${helperColor}" stroke-width="2">
                   <title>Общий объём: ${Metrics.fmt(last.v)} ${esc(unit)}</title></circle>`;
      }
    }

    return `
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${isDown ? 'Burn-down' : 'Burn-up'} график спринта">
  <defs>
    <linearGradient id="gradDown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#8b5cf6" stop-opacity=".28" />
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="gradUp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#22c55e" stop-opacity=".26" />
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0" />
    </linearGradient>
  </defs>
  ${grid}
  ${todayLine}
  ${helper}
  ${areas}
  ${lines}
  ${dots}
  ${xLabels}
  <line x1="${PAD.left}" y1="${PAD.top + PLOT_H}" x2="${W - PAD.right}" y2="${PAD.top + PLOT_H}"
        stroke="rgba(255,255,255,.12)" stroke-width="1" />
</svg>`;
  }

  return { burnChart };
})();
