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
 * @typedef {{ t: number, label: string }} VerticalMarker
 */

/**
 * Inline plugin: vertical dashed marker lines WITH text labels (band
 * crossings, injection step). Labels are drawn on-canvas so the marker is
 * never color-alone; the panel's "what this means" line repeats them as
 * real text for assistive tech.
 * @type {any}
 */
const markerPlugin = {
  id: 'eigenorgMarkers',
  /** @param {any} chart */
  afterDatasetsDraw(chart) {
    /** @type {VerticalMarker[] | undefined} */
    const markers = chart.$eigenorgMarkers;
    if (!markers || markers.length === 0) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.tick;
    ctx.fillStyle = COLORS.tick;
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (const marker of markers) {
      const index = chart.data.labels.indexOf(marker.t);
      if (index === -1) continue;
      const x = scales.x.getPixelForValue(index);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      const w = ctx.measureText(marker.label).width;
      const tx = Math.min(x + 4, chartArea.right - w - 2);
      ctx.fillText(marker.label, tx, chartArea.top + 2);
    }
    ctx.restore();
  },
};

/**
 * Create the entropy chart on a canvas. Returns the Chart instance; use
 * updatePercentileChart() to feed it new data without re-instantiating.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ label?: string, unit?: string, percent?: boolean }} [opts]
 *   `percent`: series values are fractions 0–1 rendered as % (ticks + tooltip)
 * @returns {any} Chart.js instance
 */
export function createPercentileChart(canvas, opts = {}) {
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  if (!ChartCtor) throw new Error('vendored Chart.js failed to load');
  const label = opts.label ?? 'entropy';
  const pct = Boolean(opts.percent);
  /** @param {number} v */
  const fmtValue = (v) => (pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
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
          // Plain-language legend (beta feedback): "p10–p90 band" read as jargon.
          // The quantitative names live in the ⓘ "Show the numbers" layer.
          label: `${label} — range across runs`,
          data: [],
          borderWidth: 0,
          pointRadius: 0,
          backgroundColor: COLORS.band,
          fill: '-1', // fills down to the p10 dataset → the percentile band
        },
        {
          label: `${label} — typical run`,
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
          ticks: {
            color: COLORS.tick,
            font: { size: 12 },
            callback: pct ? (/** @type {any} */ v) => `${Math.round(Number(v) * 100)}%` : undefined,
          },
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
        tooltip: {
          enabled: true,
          callbacks: {
            label: (/** @type {any} */ item) => `${item.dataset.label}: ${fmtValue(item.parsed.y)}`,
          },
        },
      },
    },
    plugins: [markerPlugin],
  });
}

/**
 * Feed a percentile series into a chart created by createPercentileChart().
 * Uses update('none') — no animation, no re-instantiation.
 *
 * @param {any} chart
 * @param {PercentilePoint[]} series
 * @param {{ markers?: VerticalMarker[], yMax?: number }} [extras]
 *   `markers`: labeled vertical lines (band crossings, injection step);
 *   `yMax`: pin the y-axis max (shared scale across the before/after pane).
 */
export function updatePercentileChart(chart, series, extras = {}) {
  chart.data.labels = series.map((p) => p.t);
  chart.data.datasets[0].data = series.map((p) => p.p10);
  chart.data.datasets[1].data = series.map((p) => p.p90);
  chart.data.datasets[2].data = series.map((p) => p.p50);
  chart.$eigenorgMarkers = extras.markers ?? [];
  chart.options.scales.y.max = extras.yMax;
  chart.options.scales.y.min = 0;
  chart.update('none');
}
