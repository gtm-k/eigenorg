// eigenorg module worker — owns wasm init and every wasm call.
// The UI thread never imports www/pkg (ci.yml grep gate, PLAN P5).
//
// MIME-IMMUNE wasm loading (PLAN P2 / PREMORTEM T2): fetch the .wasm with an
// explicitly-constructed URL, take arrayBuffer(), and hand the BYTES to the
// wasm-bindgen init — never WebAssembly.instantiateStreaming, which dies on
// any host that serves .wasm without the application/wasm MIME type.
//
// Chunked worker protocol (CONTRACTS.md §2, frozen shape):
//   in:  { id, type: 'run',    payload: { sim, configJson, seed, chunkSize? } }
//   in:  { id, type: 'cancel' }            // id = the run to cancel
//   out: { id, type: 'progress', payload: { completedCount, totalIterations } }
//   out: { id, type: 'result',   payload: <output JSON string> }
//   out: { id, type: 'error',    payload: { type, message } }
//        payload.type ∈ { validation, notImplemented, badState }  (engine envelope,
//        CONTRACTS §2) ∪ { cancelled, internal, init }             (worker-level)
//   plus an unsolicited { id: 0, type: 'error' } if wasm init itself fails.
//
// Exactly ONE in-flight run per worker: the engine-client serializes run
// requests (CONTRACTS §2); this worker additionally REJECTS an overlapping
// 'run' with a badState error rather than silently replacing the in-flight
// run, so a protocol violation is loud.
//
// Cancellation happens BETWEEN chunks: the chunk loop macro-yields to the
// event loop after every run_chunk so a pending 'cancel' message can be
// delivered and observed before the next chunk starts.

/** Default iterations per chunk (500-iteration default run → 10 progress events). */
const DEFAULT_CHUNK_SIZE = 50;

/** @type {(msg: { id: number, type: string, payload?: unknown }) => void} */
const post = (msg) => /** @type {any} */ (self).postMessage(msg);

/** Yield a macrotask so queued messages (e.g. 'cancel') get delivered. */
const yieldToEventLoop = () =>
  new Promise((resolve) => {
    self.setTimeout(resolve, 0);
  });

/** Resolve pkg assets relative to THIS module so it works under any subpath. */
async function initWasm() {
  // Dynamic import keeps the generated bindings out of the typecheck graph
  // (www/pkg is a gitignored build product) while remaining a plain relative
  // module load at runtime.
  const bindingsUrl = new URL('../pkg/eigenorg.js', import.meta.url);
  const bindings = await import(bindingsUrl.href);

  const wasmUrl = new URL('../pkg/eigenorg_bg.wasm', import.meta.url);
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`wasm fetch failed: HTTP ${response.status} for ${wasmUrl.href}`);
  }
  const bytes = await response.arrayBuffer();
  await bindings.default({ module_or_path: bytes });
  return bindings;
}

const wasmReady = initWasm();
wasmReady.catch((err) => {
  post({ id: 0, type: 'error', payload: { type: 'init', message: String(err) } });
});

/**
 * The single in-flight run, or null. `cancelled` is flipped by a 'cancel'
 * message and observed by the chunk loop between chunks.
 * @type {{ id: number, cancelled: boolean } | null}
 */
let currentRun = null;

/**
 * Parse an engine JSON reply; returns the parsed value or posts an error and
 * returns null. Every wasm export returns either a success payload or an
 * error envelope { error: { type, message } } (CONTRACTS §2).
 * @param {number} id
 * @param {string} raw
 * @returns {any | null}
 */
function parseEngineReply(id, raw) {
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    post({ id, type: 'error', payload: { type: 'internal', message: `engine reply was not JSON: ${String(err)}` } });
    return null;
  }
  if (parsed && typeof parsed === 'object' && parsed.error) {
    post({ id, type: 'error', payload: { type: parsed.error.type, message: parsed.error.message } });
    return null;
  }
  return parsed;
}

/**
 * Execute one chunked run: begin_run → run_chunk(n)* → finalize, emitting a
 * progress message after every chunk and checking for cancellation between
 * chunks.
 * @param {number} id
 * @param {{ sim: string, configJson: string, seed: number | bigint, chunkSize?: number }} payload
 */
async function executeRun(id, payload) {
  const wasm = await wasmReady;
  const { sim, configJson, seed } = payload;
  const chunkSize = payload.chunkSize && payload.chunkSize > 0 ? Math.floor(payload.chunkSize) : DEFAULT_CHUNK_SIZE;

  const begin = parseEngineReply(id, wasm.begin_run(sim, configJson, BigInt(seed)));
  if (begin === null) return;
  const totalIterations = Number(begin.totalIterations);
  post({ id, type: 'progress', payload: { completedCount: 0, totalIterations } });

  let completedCount = 0;
  while (completedCount < totalIterations) {
    // Cancellation is observed between chunks (CONTRACTS §2: cancel = drop
    // the in-flight run; a fresh begin_run reproduces output byte-for-byte).
    if (currentRun?.id === id && currentRun.cancelled) {
      wasm.cancel();
      post({ id, type: 'error', payload: { type: 'cancelled', message: 'run cancelled' } });
      return;
    }
    const chunk = parseEngineReply(id, wasm.run_chunk(chunkSize));
    if (chunk === null) return;
    completedCount = Number(chunk.completedCount);
    post({ id, type: 'progress', payload: { completedCount, totalIterations } });
    await yieldToEventLoop();
  }

  // Late cancel: every iteration has run but the output was never delivered.
  if (currentRun?.id === id && currentRun.cancelled) {
    wasm.cancel();
    post({ id, type: 'error', payload: { type: 'cancelled', message: 'run cancelled' } });
    return;
  }

  const outputJson = wasm.finalize();
  // finalize() returns the output JSON or an error envelope. Parse it
  // UNCONDITIONALLY — probing the raw string for '{"error"' would couple the
  // check to one exact serialization and ship any differently-formatted
  // envelope as a false success. The RAW string still travels in the result
  // message (byte-identity carrier for the share/replay contract).
  if (parseEngineReply(id, outputJson) === null) return;
  post({ id, type: 'result', payload: outputJson });
}

self.onmessage = async (event) => {
  const { id, type, payload } = /** @type {{ id: number, type: string, payload?: any }} */ (
    event.data
  );
  if (type === 'cancel') {
    if (currentRun && currentRun.id === id) currentRun.cancelled = true;
    // cancel for an unknown/finished id is a no-op (the run already ended).
    return;
  }
  if (type !== 'run') {
    post({ id, type: 'error', payload: { type: 'badState', message: `unknown message type: ${type}` } });
    return;
  }
  if (currentRun !== null) {
    post({
      id,
      type: 'error',
      payload: { type: 'badState', message: 'a run is already in flight — the engine-client must serialize runs' },
    });
    return;
  }
  currentRun = { id, cancelled: false };
  try {
    await executeRun(id, payload);
  } catch (err) {
    post({ id, type: 'error', payload: { type: 'internal', message: String(err) } });
  } finally {
    currentRun = null;
  }
};
