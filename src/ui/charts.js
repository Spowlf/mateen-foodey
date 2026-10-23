// Inline SVG charts and meters. Marks carry colour; every value is also readable as text (labels,
// a tooltip that finds the nearest day, and a table).

import { h, fill } from './dom.js';
import { weightScale, weightTick, formatWeight, daysBetween, formatDay, formatDayShort, today } from '../engine/index.js';

const SVG = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

/** A share as a meter: the track is the whole (a target, or everything eaten), full when over. A share above zero shows a sliver. */
export function meter(share) {
  const pct = Math.min(Math.max(share, 0), 1) * 100;
  const fill = share > 0 && h('span', { class: 'meter-fill' });
  if (fill) fill.style.width = `max(4px, ${pct.toFixed(2)}%)`;
  return h('span', { class: 'meter', 'aria-hidden': 'true' }, fill);
}

/**
 * Rows as a table, each with a meter under it the full width of the row, so every meter has the same
 * track: [{ name, value, share, note? }]. caption and
 * head (three column names) are for screen readers.
 */
export function meterTable(rows, { caption, head }) {
  return h('table', { class: 'meter-table' },
    h('caption', { class: 'visually-hidden' }, caption),
    h('thead', { class: 'visually-hidden' }, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('th', { scope: 'row' }, r.name),
      h('td', { class: 'num' }, r.value),
      h('td', { class: 'num share' }, r.note ?? `${Math.round(r.share * 100)}%`),
      h('td', { class: 'meter-cell' }, meter(r.share))))));
}

/** Shows a tooltip centred over a point (a fraction of the chart's width), kept inside the chart. */
function placeTip(tooltip, at) {
  tooltip.hidden = false;
  const room = tooltip.parentElement.clientWidth;
  const w = tooltip.offsetWidth;
  const left = Math.min(Math.max(at * room - w / 2, 0), Math.max(room - w, 0));
  tooltip.style.transform = `translate(${left}px, 0)`;
}

/**
 * Body weight: the trend as a line in ink, each reading as a dot, on an axis that fits them. A
 * crosshair finds the nearest day (pointer, tap, or arrow keys once focused) and the tooltip says
 * its trend and reading; the same days are a table. points: [{ date, trendGrams, readingGrams }],
 * oldest first, at least two.
 */
export function weightChart(points, { unit = 'kg', width = 358, name }) {
  const height = 196;
  const pad = { top: 12, right: 8, bottom: 26, left: unit === 'stlb' ? 64 : 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseline = pad.top + plotH;
  const values = points.flatMap((p) => [p.trendGrams, p.readingGrams]).filter((v) => v != null);
  const scale = weightScale(Math.min(...values), Math.max(...values), unit);
  const first = points[0].date;
  const last = points.at(-1);
  const span = Math.max(daysBetween(first, last.date), 1);
  const x = (date) => pad.left + (daysBetween(first, date) / span) * plotW;
  const y = (g) => baseline - ((g - scale.min) / (scale.max - scale.min)) * plotH;
  const trend = points.filter((p) => p.trendGrams != null);
  const line = trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.trendGrams).toFixed(1)}`).join('');
  const readings = points.filter((p) => p.readingGrams != null);
  const isToday = (d) => d === today();
  const dayName = (d) => (isToday(d) ? 'Today' : formatDay(d));

  const tooltip = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
  const cross = s('line', { y1: pad.top, y2: baseline, class: 'crosshair', visibility: 'hidden' });
  const dot = s('circle', { r: 4, class: 'mark-trend-dot', visibility: 'hidden' });
  const mid = points[Math.floor((points.length - 1) / 2)];
  const dateLabels = [[first, 'start'], [mid.date, 'middle'], [last.date, 'end']]
    .filter(([d], i, all) => i === 0 || d !== all[i - 1][0])
    .map(([d, anchor]) => s('text', { x: anchor === 'start' ? pad.left : anchor === 'end' ? width - pad.right : x(d), y: height - 8, class: 'axis', 'text-anchor': anchor },
      document.createTextNode(isToday(d) ? 'Today' : formatDayShort(d))));

  let at = null;
  const show = (i) => {
    at = Math.max(0, Math.min(points.length - 1, i));
    const p = points[at];
    const px = x(p.date);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', y(p.trendGrams)); dot.setAttribute('visibility', 'visible');
    fill(tooltip,
      h('p', { class: 'tip-title' }, dayName(p.date)),
      h('p', { class: 'tip-row' }, h('span', { class: 'line-key key-trend' }), h('strong', {}, formatWeight(p.trendGrams, unit)), ' trend'),
      p.readingGrams != null && h('p', { class: 'tip-row' }, h('span', { class: 'dot-key' }), h('strong', {}, formatWeight(p.readingGrams, unit)), ' weighed'));
    placeTip(tooltip, px / width);
  };
  const hide = () => { at = null; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tooltip.hidden = true; };
  const nearest = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i; });
    return best;
  };

  const svg = s('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'chart weight-chart', tabindex: '0', role: 'img',
    'aria-label': `Weight, ${name}: trend ${formatWeight(trend[0].trendGrams, unit)} on ${formatDay(first)}, ${formatWeight(last.trendGrams, unit)} ${isToday(last.date) ? 'today' : `on ${formatDay(last.date)}`}. Arrow keys step through the days.`,
  },
  scale.ticks.map((t) => s('g', {},
    s('line', { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), class: 'grid' }),
    s('text', { x: pad.left - 8, y: y(t), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, document.createTextNode(weightTick(t, unit))))),
  dateLabels,
  readings.map((p) => s('circle', { cx: x(p.date).toFixed(1), cy: y(p.readingGrams).toFixed(1), r: 4, class: 'mark-reading' })),
  s('path', { d: line, class: 'mark-trend' }),
  cross, dot,
  s('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, class: 'hit' }));

  svg.addEventListener('pointermove', (e) => show(nearest(e)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('focus', () => show(at ?? points.length - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(points.length - 1);
    else if (step) show((at ?? points.length - 1) + step);
    else return;
    e.preventDefault();
  });

  const legend = h('p', { class: 'legend' },
    h('span', {}, h('span', { class: 'line-key key-trend' }), `Trend, ${unit === 'stlb' ? 'st lb' : 'kg'}`),
    h('span', {}, h('span', { class: 'dot-key' }), 'Weigh-ins'));

  const table = h('details', { class: 'table-view' },
    h('summary', {}, 'Show as a Table'),
    h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col' }, 'Weighed'), h('th', { scope: 'col' }, 'Trend'))),
      h('tbody', {}, [...readings].reverse().map((p) => h('tr', {},
        h('th', { scope: 'row' }, dayName(p.date)),
        h('td', { class: 'num' }, formatWeight(p.readingGrams, unit)),
        h('td', { class: 'num' }, formatWeight(p.trendGrams, unit)))))));

  return h('figure', { class: 'chart-figure' }, legend, h('div', { class: 'chart-wrap' }, svg, tooltip), table);
}
