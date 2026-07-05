// eigenorg entropy chart — renders one tidy percentile series
// (metric → [{t, p10, p50, p90}], MODEL.md §7) as a p50 line inside a
// p10–p90 band, using the vendored Chart.js UMD bundle (no CDN).
//
// Perf discipline (PREMORTEM T5): animations off, updates via
// chart.update('none'); the payload is already percentile-aggregated in Rust
// so the dataset is horizon-sized (≤ 600 points), never iteration-sized.

/** DESIGN.md (Linear) tokens used by the chart. */
const COLORS = {
  line: '#828fff', // primary-hover: readable accent on the near-black canvas
  band: 'rgba(94, 106, 210, 0.22)', // primary @ low alpha
  grid: 'rgba(247, 248, 248, 0.07)',
  tick: '#8a8f98', // ink-subtle
};

/**
 * @typedef {{ t: number, p10: number, p50: number, p90: number }} PercentilePoint
 */

/**
 * Create the entropy chart on a canvas. Returns the Chart instance; use
 * updatePercentileChart() to feed it new data without re-instantiating.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ label?: string, unit?: string }} [opts]
 * @returns {any} Chart.js instance
 */
export function createPercentileChart(canvas, opts = {}) {
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  if (!ChartCtor) throw new Error('vendored Chart.js failed to load');
  const label = opts.label ?? 'entropy';
  return new ChartCtor(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: `${label} p10`,
          data: [],
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
        },
        {
          label: `${label} p10–p90 band`,
          data: [],
          borderWidth: 0,
          pointRadius: 0,
          backgroundColor: COLORS.band,
          fill: '-1', // fills down to the p10 dataset → the percentile band
        },
        {
          label: `${label} p50`,
          data: [],
          borderColor: COLORS.line,
          borderWidth: 2,
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
          ticks: { color: COLORS.tick, font: { size: 12 }, maxTicksLimit: 13 },
        },
        y: {
          title: { display: true, text: opts.unit ?? 'index 0–100', color: COLORS.tick, font: { size: 12 } },
          grid: { color: COLORS.grid },
          ticks: { color: COLORS.tick, font: { size: 12 } },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: COLORS.tick,
            font: { size: 12 },
            // The p10 helper dataset exists only to anchor the band fill.
            filter: (/** @type {any} */ item) => !String(item.text).endsWith('p10'),
          },
        },
        tooltip: { enabled: true },
      },
    },
  });
}

/**
 * Feed a percentile series into a chart created by createPercentileChart().
 * Uses update('none') — no animation, no re-instantiation.
 *
 * @param {any} chart
 * @param {PercentilePoint[]} series
 */
export function updatePercentileChart(chart, series) {
  chart.data.labels = series.map((p) => p.t);
  chart.data.datasets[0].data = series.map((p) => p.p10);
  chart.data.datasets[1].data = series.map((p) => p.p90);
  chart.data.datasets[2].data = series.map((p) => p.p50);
  chart.update('none');
}
