// eigenorg engine client — a promise API over the chunked worker protocol
// (CONTRACTS.md §2). The client speaks ONLY the frozen message protocol
// { id, type: run|progress|result|error|cancel, payload? } against a
// *transport*, so the real module worker and the fixture stub are perfectly
// interchangeable: swapping transports requires zero caller changes.
//
// Serialization guarantee (CONTRACTS §2): exactly ONE in-flight run per
// worker. run() calls are queued on an internal promise chain — the next run
// is not posted until the previous one settles. The P5 before/after pane is
// two sequential runs through this queue.
//
// This module NEVER imports www/pkg (ci.yml grep gate) — only worker.js does.

/**
 * @typedef {{ id: number, type: string, payload?: any }} ProtocolMessage
 * @typedef {{ post: (msg: ProtocolMessage) => void,
 *             onMessage: (handler: (msg: ProtocolMessage) => void) => void }} Transport
 * @typedef {{ completedCount: number, totalIterations: number }} Progress
 * @typedef {{ sim?: string,
 *             config: any,
 *             seed?: number | bigint,
 *             chunkSize?: number,
 *             onProgress?: (p: Progress) => void }} RunOptions
 * @typedef {{ output: any, outputJson: string }} RunResult
 */

/** Error raised for engine/worker error envelopes and cancellations. */
export class EngineError extends Error {
  /**
   * @param {string} type engine envelope type (validation | notImplemented |
   *   badState) or worker-level type (cancelled | internal | init | fixtureMissing)
   * @param {string} message
   */
  constructor(type, message) {
    super(message);
    this.name = 'EngineError';
    this.type = type;
    this.cancelled = type === 'cancelled';
  }
}

/**
 * Wrap a real module Worker as a transport.
 * @param {Worker} worker
 * @returns {Transport}
 */
export function createWorkerTransport(worker) {
  return {
    post: (msg) => worker.postMessage(msg),
    onMessage: (handler) => {
      worker.addEventListener('message', (event) => {
        handler(/** @type {MessageEvent} */ (event).data);
      });
    },
  };
}

/**
 * Fixture-stub transport: serves committed fixture outputs through the SAME
 * protocol the worker speaks, including synthetic progress events and
 * between-"chunk" cancellation — so engine-client behavior (serialization,
 * progress, cancel) is testable without a wasm build or a browser.
 *
 * @param {Array<{ sim: string, seed: number | bigint, configJson?: string,
 *                 config?: any, outputJson: string }>} fixtures
 * @param {{ syntheticChunks?: number }} [opts]
 * @returns {Transport}
 */
export function createFixtureTransport(fixtures, opts = {}) {
  const syntheticChunks = opts.syntheticChunks ?? 4;
  /** @type {Map<string, string>} */
  const byKey = new Map();
  for (const f of fixtures) {
    const configJson = f.configJson ?? JSON.stringify(f.config);
    byKey.set(`${f.sim}\n${String(f.seed)}\n${configJson}`, f.outputJson);
  }

  /** @type {Array<(msg: ProtocolMessage) => void>} */
  const handlers = [];
  /** @type {(msg: ProtocolMessage) => void} */
  const emit = (msg) => {
    for (const h of handlers) h(msg);
  };
  /** @type {Set<number>} */
  const cancelledIds = new Set();

  const yieldToEventLoop = () =>
    new Promise((resolve) => {
      globalThis.setTimeout(resolve, 0);
    });

  /**
   * @param {number} id
   * @param {{ sim: string, configJson: string, seed: number | bigint }} payload
   */
  async function serve(id, payload) {
    const outputJson = byKey.get(`${payload.sim}\n${String(payload.seed)}\n${payload.configJson}`);
    if (outputJson === undefined) {
      emit({ id, type: 'error', payload: { type: 'fixtureMissing', message: 'no committed fixture output for this (sim, seed, config)' } });
      return;
    }
    const totalIterations = Number(JSON.parse(outputJson).iterations);
    const step = Math.max(1, Math.ceil(totalIterations / syntheticChunks));
    emit({ id, type: 'progress', payload: { completedCount: 0, totalIterations } });
    let completed = 0;
    while (completed < totalIterations) {
      await yieldToEventLoop(); // lets a queued 'cancel' land between chunks
      if (cancelledIds.has(id)) {
        emit({ id, type: 'error', payload: { type: 'cancelled', message: 'run cancelled' } });
        return;
      }
      completed = Math.min(totalIterations, completed + step);
      emit({ id, type: 'progress', payload: { completedCount: completed, totalIterations } });
    }
    emit({ id, type: 'result', payload: outputJson });
  }

  return {
    post: (msg) => {
      if (msg.type === 'cancel') {
        cancelledIds.add(msg.id);
        return;
      }
      if (msg.type === 'run') {
        void serve(msg.id, msg.payload);
      }
    },
    onMessage: (handler) => {
      handlers.push(handler);
    },
  };
}

/**
 * Promise API over a transport. One client per worker.
 * @param {Transport} transport
 */
export function createEngineClient(transport) {
  let nextId = 1;
  /** @type {number | null} */
  let inFlightId = null;
  /** @type {Map<number, { resolve: (v: RunResult) => void, reject: (e: Error) => void, onProgress?: (p: Progress) => void }>} */
  const pending = new Map();
  /** @type {Promise<unknown>} serialization chain — next run waits for this */
  let tail = Promise.resolve();
  /** Runs requested but not yet posted (they sit behind the chain). */
  let queuedNotPosted = 0;
  /** cancel() arrived while nothing was in flight but a run was queued —
   *  honored before the next post (a same-tick run();cancel() must never be
   *  silently lost). */
  let cancelNextQueued = false;

  transport.onMessage((msg) => {
    const { id, type, payload } = msg;
    if (id === 0 && type === 'error') {
      // Unsolicited init failure: fail the in-flight run if any; later runs
      // will fail the same way when posted.
      const entry = inFlightId !== null ? pending.get(inFlightId) : undefined;
      if (entry && inFlightId !== null) {
        pending.delete(inFlightId);
        inFlightId = null;
        entry.reject(new EngineError(payload?.type ?? 'init', payload?.message ?? 'worker init failed'));
      }
      return;
    }
    const entry = pending.get(id);
    if (!entry) return; // stale message for a settled run (e.g. post-cancel)
    if (type === 'progress') {
      entry.onProgress?.(payload);
      return;
    }
    pending.delete(id);
    if (inFlightId === id) inFlightId = null;
    if (type === 'result') {
      entry.resolve({ output: JSON.parse(payload), outputJson: payload });
    } else if (type === 'error') {
      entry.reject(new EngineError(payload?.type ?? 'internal', payload?.message ?? 'engine error'));
    } else {
      entry.reject(new EngineError('internal', `unexpected message type: ${type}`));
    }
  });

  return {
    /**
     * Run one simulation. Queued behind any in-flight run (one in-flight run
     * per worker, CONTRACTS §2). `sim` and `seed` default from the config.
     * @param {RunOptions} options
     * @returns {Promise<RunResult>}
     */
    run(options) {
      const { config } = options;
      const sim = options.sim ?? config.sim;
      const seed = options.seed ?? config.seed;
      const configJson = JSON.stringify(config);
      queuedNotPosted += 1;
      const result = tail.then(
        () =>
          new Promise((resolve, reject) => {
            queuedNotPosted -= 1;
            if (cancelNextQueued) {
              // A cancel() raced ahead of this run's post — honor it here
              // instead of posting a run nobody can cancel any more.
              cancelNextQueued = false;
              reject(new EngineError('cancelled', 'run cancelled'));
              return;
            }
            const id = nextId++;
            inFlightId = id;
            pending.set(id, { resolve, reject, onProgress: options.onProgress });
            transport.post({
              id,
              type: 'run',
              payload: { sim, configJson, seed, chunkSize: options.chunkSize },
            });
          }),
      );
      // The chain absorbs rejections so one failed run never blocks the next.
      tail = result.catch(() => {});
      return result;
    },

    /**
     * Cancel the in-flight run, or — when nothing has been posted yet but a
     * run is already queued (the same-tick run(); cancel() window) — the next
     * run to post. No-op when fully idle. The cancelled run's promise rejects
     * with an EngineError whose `.cancelled` is true. Runs already queued
     * behind it still execute.
     */
    cancel() {
      if (inFlightId !== null) {
        transport.post({ id: inFlightId, type: 'cancel' });
        return;
      }
      if (queuedNotPosted > 0) cancelNextQueued = true;
    },

    /** @returns {boolean} whether a run is currently in flight */
    get busy() {
      return inFlightId !== null;
    },
  };
}
