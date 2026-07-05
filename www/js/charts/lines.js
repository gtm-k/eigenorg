// eigenorg line charts — the two non-band panels:
//   * AI injection delta (UI-computed pointwise p50 difference, MODEL.md §7.1)
//     — entropy Δ on the left axis, throughput Δ on the right axis.
//   * Multi-level health — team cohesion vs org health p50 lines.
//
// Same perf discipline as the percentile charts (PREMORTEM T5): animations
// off, update('none'), horizon-sized data. Line identity is NEVER color
// alone: the second line is dashed and both carry explicit legend labels.

const COLORS = {
  accent: '#828fff', // primary-hover
  contrast: '#d0d6e0', // ink-muted — pairs with a dash pattern, not color-alone
  grid: 'rgba(247, 248, 248, 0.07)',
  zero: 'rgba(247, 248, 248, 0.35)',
  tick: '#8a8f98',
};

const TICKS = { color: COLORS.tick, font: { size: 12 } };

/**
 * @typedef {{ t: number, v: number }} Point
 */

/**
 * Dual-axis delta chart. Left axis: entropy Δ (index points); right axis:
 * throughput Δ (items/step). The zero gridline is emphasized — above zero
 * the injection ADDED disorder.
 * @param {HTMLCanvasElement} canvas
 * @returns {any}
 */
export function createDeltaChart(canvas) {
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  if (!ChartCtor) throw new Error('vendored Chart.js failed to load');
  return new ChartCtor(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'entropy Δ (AI − no AI), index points',
          data: [],
          borderColor: COLORS.accent,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          yAxisID: 'y',
        },
        {
          label: 'throughput Δ (AI − no AI), items/step — dashed',
          data: [],
          borderColor: COLORS.contrast,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'step (working day)', color: COLORS.tick, font: { size: 12 } },
          grid: { color: COLORS.grid },
          ticks: { ...TICKS, maxTicksLimit: 13 },
        },
        y: {
          title: { display: true, text: 'entropy Δ', color: COLORS.tick, font: { size: 12 } },
          grid: {
            color: (/** @type {any} */ ctx) => (ctx.tick?.value === 0 ? COLORS.zero : COLORS.grid),
          },
          ticks: TICKS,
        },
        y1: {
          position: 'right',
          title: { display: true, text: 'throughput Δ', color: COLORS.tick, font: { size: 12 } },
          grid: { drawOnChartArea: false },
          ticks: TICKS,
        },
      },
      plugins: {
        legend: { labels: { color: COLORS.tick, font: { size: 12 } } },
        tooltip: { enabled: true },
      },
    },
  });
}

/**
 * @param {any} chart
 * @param {Point[]} entropyDelta
 * @param {Point[]} throughputDelta
 */
export function updateDeltaChart(chart, entropyDelta, throughputDelta) {
  chart.data.labels = entropyDelta.map((p) => p.t);
  chart.data.datasets[0].data = entropyDelta.map((p) => p.v);
  chart.data.datasets[1].data = throughputDelta.map((p) => p.v);
  chart.update('none');
}

/**
 * Two-level health chart: org health (solid accent) vs mean team cohesion
 * (dashed) — the divergence IS the story (healthy teams, sick org).
 * @param {HTMLCanvasElement} canvas
 * @returns {any}
 */
export function createHealthChart(canvas) {
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  if (!ChartCtor) throw new Error('vendored Chart.js failed to load');
  return new ChartCtor(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'org health p50',
          data: [],
          borderColor: COLORS.accent,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'team cohesion p50 — dashed',
          data: [],
          borderColor: COLORS.contrast,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'step (working day)', color: COLORS.tick, font: { size: 12 } },
          grid: { color: COLORS.grid },
          ticks: { ...TICKS, maxTicksLimit: 13 },
        },
        y: {
          title: { display: true, text: 'index 0–100', color: COLORS.tick, font: { size: 12 } },
          grid: { color: COLORS.grid },
          ticks: TICKS,
          min: 0,
          max: 100,
        },
      },
      plugins: {
        legend: { labels: { color: COLORS.tick, font: { size: 12 } } },
        tooltip: { enabled: true },
      },
    },
  });
}

/**
 * @param {any} chart
 * @param {Array<{t: number, p50: number}>} orgHealth
 * @param {Array<{t: number, p50: number}>} cohesion
 */
export function updateHealthChart(chart, orgHealth, cohesion) {
  chart.data.labels = orgHealth.map((p) => p.t);
  chart.data.datasets[0].data = orgHealth.map((p) => p.p50);
  chart.data.datasets[1].data = cohesion.map((p) => p.p50);
  chart.update('none');
}
