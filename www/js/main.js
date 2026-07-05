// eigenorg UI thread — P5a minimal vertical slice.
// One preset (fasterDysfunction), one chart (entropy), a run button and live
// progress: proves worker → engine-client → chart end-to-end on the
// subpath-emulating server. P5b adds the full controls, charts, share UI and
// landing flow on top of these modules.
//
// This file must never import www/pkg (ci.yml grep gate) — only worker.js
// talks to the wasm.

import { createEngineClient, createWorkerTransport } from './engine-client.js';
import { createPercentileChart, updatePercentileChart } from './charts/entropy.js';

/** @param {string} sel @returns {HTMLElement} */
function el(sel) {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`missing element: ${sel}`);
  return /** @type {HTMLElement} */ (node);
}

/** @param {HTMLElement} node @param {string} text @param {'ok' | 'error' | ''} tone */
function setStatus(node, text, tone = '') {
  node.textContent = text;
  node.classList.remove('ok', 'error');
  if (tone) node.classList.add(tone);
}

// ---- engine wiring (real worker transport) -----------------------------------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const client = createEngineClient(createWorkerTransport(worker));

// ---- page flow -----------------------------------------------------------------

const runButton = /** @type {HTMLButtonElement} */ (el('#run-button'));
const progressBar = /** @type {HTMLProgressElement} */ (el('#run-progress'));
const statusEl = el('#run-status');
const chart = createPercentileChart(
  /** @type {HTMLCanvasElement} */ (el('#entropy-chart')),
  { label: 'entropy', unit: 'entropy index (0–100)' },
);

/** @type {any} */
let presetConfig = null;

async function loadPreset() {
  // Relative fetch — must work under the /eigenorg/ Pages subpath.
  const response = await fetch('./presets/fasterDysfunction.json');
  if (!response.ok) throw new Error(`preset fetch failed: HTTP ${response.status}`);
  const preset = await response.json();
  presetConfig = preset.runs.sh3; // broken org (SH 3) + AI injection at step 15
  el('#preset-label').textContent = preset.label;
  runButton.disabled = false;
  setStatus(statusEl, 'ready — 500 Monte Carlo iterations, nothing leaves your browser', '');
}

async function runOnce() {
  if (client.busy) {
    client.cancel();
    return;
  }
  runButton.textContent = 'Cancel';
  progressBar.value = 0;
  setStatus(statusEl, 'running…', '');
  const t0 = performance.now();
  try {
    const { output } = await client.run({
      config: presetConfig,
      onProgress: ({ completedCount, totalIterations }) => {
        progressBar.max = totalIterations;
        progressBar.value = completedCount;
        setStatus(statusEl, `running… ${completedCount}/${totalIterations} iterations`, '');
      },
    });
    const elapsedMs = performance.now() - t0;
    updatePercentileChart(chart, output.series.entropy);
    el('#model-version').textContent = `model v${output.modelVersion}`;
    setStatus(
      statusEl,
      `${output.iterations} iterations in ${(elapsedMs / 1000).toFixed(2)} s — entropy p50 ends at ${output.series.entropy.at(-1).p50.toFixed(1)}`,
      'ok',
    );
  } catch (err) {
    if (/** @type {any} */ (err).cancelled) {
      setStatus(statusEl, 'run cancelled', '');
    } else {
      setStatus(statusEl, `run failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  } finally {
    runButton.textContent = 'Run simulation';
    progressBar.value = 0;
  }
}

runButton.addEventListener('click', () => void runOnce());

loadPreset().catch((err) => {
  setStatus(statusEl, `failed to load preset: ${err instanceof Error ? err.message : String(err)}`, 'error');
});
