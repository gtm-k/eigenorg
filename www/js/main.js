// eigenorg UI thread — walking skeleton.
// Talks to the module worker (which owns the wasm) and renders results.
// This file must never import www/pkg directly (P5 wires a grep gate).

const ECHO_INPUT = 'eigenorg round-trip ✓';

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

// ---- worker client (tiny id-correlated request/response) --------------------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

let nextId = 1;
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, sentAt: number }>} */
const pending = new Map();

/**
 * @param {string} type
 * @param {unknown} [payload]
 * @returns {Promise<{ payload: any, roundTripMs: number }>}
 */
function call(type, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, sentAt: performance.now() });
    worker.postMessage({ id, type, payload });
  });
}

/** @type {Promise<void>} */
const workerReady = new Promise((resolve, reject) => {
  pending.set(0, {
    resolve: () => resolve(undefined),
    reject,
    sentAt: performance.now(),
  });
});

worker.onmessage = (/** @type {MessageEvent} */ event) => {
  const { id, type, payload } = event.data;
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  if (type === 'error') {
    entry.reject(new Error(String(payload)));
  } else {
    entry.resolve({ payload, roundTripMs: performance.now() - entry.sentAt });
  }
};

worker.onerror = (/** @type {ErrorEvent} */ event) => {
  const err = new Error(event.message || 'worker error');
  for (const entry of pending.values()) entry.reject(err);
  pending.clear();
  setStatus(el('#engine-status'), `worker error: ${err.message}`, 'error');
};

// ---- page flow ---------------------------------------------------------------

async function run() {
  const statusEl = el('#engine-status');
  try {
    await workerReady;
    setStatus(statusEl, 'wasm initialized in module worker', 'ok');

    const version = await call('version');
    setStatus(el('#model-version'), String(version.payload), 'ok');

    const echo = await call('echo', ECHO_INPUT);
    const echoOk = echo.payload === ECHO_INPUT;
    setStatus(
      el('#echo-result'),
      echoOk ? `"${echo.payload}" — identical` : `MISMATCH: got "${echo.payload}"`,
      echoOk ? 'ok' : 'error',
    );

    const probe = await call('probe', { iterations: 500, seed: 42 });
    const { estimate, iterations, computeMs } = probe.payload;
    setStatus(el('#pi-result'), `π ≈ ${estimate.toFixed(4)} (${iterations} iterations)`, 'ok');
    setStatus(
      el('#pi-timing'),
      `${computeMs.toFixed(2)} ms compute in wasm · ${probe.roundTripMs.toFixed(2)} ms worker round-trip`,
      'ok',
    );
  } catch (err) {
    setStatus(statusEl, `engine failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

function renderPlaceholderChart() {
  // Vendored Chart.js UMD bundle (no CDN) attaches a global; jsconfig has no
  // type declarations for it, hence the localized any-cast.
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  if (!ChartCtor) {
    setStatus(el('#engine-status'), 'vendored Chart.js failed to load', 'error');
    return;
  }
  const canvas = el('#placeholder-chart');
  new ChartCtor(canvas, {
    type: 'line',
    data: {
      labels: [0, 5, 10, 15, 20, 25, 30],
      datasets: [
        {
          label: 'placeholder series (static demo data)',
          data: [12, 19, 14, 22, 18, 27, 24],
          borderColor: '#4c6ef5',
          backgroundColor: 'rgba(76, 110, 245, 0.12)',
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
    },
  });
}

renderPlaceholderChart();
run();
