// eigenorg team charts (P7b) — the two team-specific renderers that the org
// charts (charts/entropy.js band + charts/lines.js dual-axis / two-level) do not
// already cover:
//   * the quality histogram (a vendored Chart.js BAR over the 10 quality bins),
//   * the function-coverage heatmap (a semantic <table> = the ARIA fallback, with
//     text labels + glyph + pattern fills so a GRAYSCALE screenshot stays fully
//     readable — never colour alone; §7.2 / spec §7).
// The throughput band, cohesion trend, coordination-tax and multi-level-health
// panels reuse createPercentileChart / createHealthChart unchanged.
//
// Perf discipline (PREMORTEM T5, mirrored from the org charts): animation off,
// update('none'); the payload is horizon-/bin-sized, never iteration-sized.
// Authors no model number (coefficient-literal gate): every value comes from the
// run output the caller passes in. Never imports www/pkg.

/** DESIGN.md (Linear) tokens — mirror charts/entropy.js so the two cohere. */
const COLORS = {
  line: '#828fff',
  band: 'rgba(94, 106, 210, 0.42)',
  grid: 'rgba(247, 248, 248, 0.07)',
  tick: '#8a8f98',
};

/**
 * Create the quality-histogram bar chart. Bars are completed-task counts per
 * 10-wide quality bin (0–100). Returns the Chart instance; feed it via
 * updateQualityChart().
 * @param {HTMLCanvasElement} canvas
 * @returns {any} Chart.js instance
 */
export function createQualityChart(canvas) {
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  if (!ChartCtor) throw new Error('vendored Chart.js failed to load');
  return new ChartCtor(canvas, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'completed tasks',
          data: [],
          backgroundColor: COLORS.band,
          borderColor: COLORS.line,
          borderWidth: 1,
          borderRadius: 3,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'quality score (0–100)', color: COLORS.tick, font: { size: 12 } },
          grid: { display: false },
          ticks: { color: COLORS.tick, font: { size: 12 } },
        },
        y: {
          title: { display: true, text: 'completed tasks', color: COLORS.tick, font: { size: 12 } },
          grid: { color: COLORS.grid },
          ticks: { color: COLORS.tick, font: { size: 12 }, precision: 0 },
          beginAtZero: true,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            title: (/** @type {any[]} */ items) => `quality ${items[0]?.label ?? ''}`,
            label: (/** @type {any} */ item) => `${item.parsed.y} tasks`,
          },
        },
      },
    },
  });
}

/**
 * Feed a quality-histogram model (ui/team.js qualityHistogramModel) into the bar
 * chart. update('none') — no animation, no re-instantiation.
 * @param {any} chart
 * @param {{ bins: Array<{ lo: number, hi: number, count: number }> }} model
 */
export function updateQualityChart(chart, model) {
  const bins = model?.bins ?? [];
  chart.data.labels = bins.map((b) => `${b.lo}–${b.hi}`);
  chart.data.datasets[0].data = bins.map((b) => b.count);
  chart.update('none');
}

// ---- function-coverage heatmap (semantic table = ARIA fallback) --------------

/** @param {string} tag @param {string} [cls] @param {string} [text] @returns {HTMLElement} */
function elc(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Render the function-coverage heatmap into `mount` as a semantic table (which IS
 * the ARIA-table fallback). Each row names an essential job and its coverage: a
 * shape GLYPH (●/◐/○) + a plain WORD (covered/thin/gap) + the integer score,
 * plus a rating CSS class for colour. Because the state is carried by glyph +
 * word + number, a grayscale screenshot stays fully readable (no colour-alone).
 * Rebuilds in place (textContent clear) — the rows are small and static per run.
 *
 * @param {HTMLElement} mount
 * @param {Array<{ id: string, label: string, plain: string, scorePct: number,
 *                 rating: string, word: string, glyph: string, fill: string }>} rows
 */
export function renderFunctionCoverage(mount, rows) {
  mount.textContent = '';
  if (!rows || rows.length === 0) {
    mount.append(elc('p', 'fc-pending', 'Run the team to see which essential jobs are covered.'));
    return;
  }
  const table = elc('table', 'fc-table');
  const caption = elc('caption', 'fc-caption', 'Whether each essential job has enough qualified attention on it. Covered, thin, or a gap — read by shape and label, not colour.');
  table.append(caption);

  const thead = elc('thead');
  const htr = document.createElement('tr');
  for (const label of ['Essential job', 'Coverage', 'Attention']) {
    const th = elc('th', undefined, label);
    th.setAttribute('scope', 'col');
    htr.append(th);
  }
  thead.append(htr);

  const tbody = elc('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.className = `fc-row fc-${r.rating}`;

    const jobTh = elc('th');
    jobTh.setAttribute('scope', 'row');
    jobTh.append(elc('span', 'fc-job-plain', r.plain), elc('span', 'fc-job-tech', r.label));

    const coverage = elc('td', 'fc-cov');
    const glyph = elc('span', `fc-glyph fc-fill-${r.fill}`, r.glyph);
    glyph.setAttribute('aria-hidden', 'true');
    coverage.append(glyph, elc('span', 'fc-word', r.word));

    const attention = elc('td', 'fc-att', `${r.scorePct}%`);

    tr.append(jobTh, coverage, attention);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  mount.append(table);
}
