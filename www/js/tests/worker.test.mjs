// worker.js protocol tests against the BUILT wasm (P5 round-1 F1).
//
// www/js/worker.js previously had ZERO automated tests — real-transport
// conformance rested on one manual Playwright session. This harness stubs the
// worker global surface (`self` with postMessage/setTimeout/onmessage, plus a
// file:// fetch shim) and drives the REAL worker module's message handler
// against the REAL built wasm (www/pkg, from scripts/build.sh) — the same
// cross-target artifact the browser loads. Covered:
//   - run happy path: progress cadence per chunk + byte-identical result,
//   - cancel between chunks (typed 'cancelled', engine reset, rerun identical),
//   - overlapping run rejected with badState while the first completes,
//   - malformed message type relayed as badState,
//   - engine validation-error envelope relay,
//   - transport swap: IDENTICAL caller code against the fixture stub and the
//     real worker (via createWorkerTransport over this harness) — the claim
//     the stub-vs-stub test in engine-client.test.mjs cannot make,
//   - F3 share loop byte-identity: share → replay → re-share → replay through
//     the real engine, outputs byte-identical, re-share fragment < budget.
//
// www/pkg is a gitignored build product, so this file SKIPS when the wasm is
// not built (the JS-only CI job); the Rust CI job runs scripts/build.sh first
// and then executes this file explicitly, where it runs for real — same
// pattern as cross-target-hash.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createEngineClient, createWorkerTransport, createFixtureTransport, EngineError } from '../engine-client.js';
import { encodeShare, decodeShare, buildReplayConfig, toShareFragment } from '../url-codec.js';
import { buildShareConfig } from '../ui/share.js';

const wasmUrl = new URL('../../pkg/eigenorg_bg.wasm', import.meta.url);
const built = existsSync(wasmUrl);

const configJson = readFileSync('fixtures/hash/crossTarget.json', 'utf8');
const config = JSON.parse(configJson);
const fixtureOutputJson = readFileSync('www/js/tests/fixtures/crossTarget.output.json', 'utf8');

// ---- worker global-surface stub -------------------------------------------------

/** @type {Array<(msg: any) => void>} */
const listeners = [];

const fakeSelf = {
  /** @param {any} msg */
  postMessage(msg) {
    for (const listener of [...listeners]) listener(msg);
  },
  /** @param {() => void} fn @param {number} ms */
  setTimeout(fn, ms) {
    return globalThis.setTimeout(fn, ms);
  },
  /** @type {((event: { data: any }) => void) | null} */
  onmessage: null,
};

let workerLoaded = false;

/** Import the REAL worker module once, with the global surface in place. */
async function loadWorker() {
  if (workerLoaded) return;
  /** @type {any} */ (globalThis).self = fakeSelf;
  // worker.js fetches ../pkg/eigenorg_bg.wasm relative to its module URL —
  // a file:// URL under node, which undici fetch refuses. Serve file: URLs
  // from disk; anything else falls through to the real fetch.
  const realFetch = globalThis.fetch;
  /** @type {any} */ (globalThis).fetch = async (/** @type {any} */ input, /** @type {any} */ init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.protocol === 'file:') {
      return new globalThis.Response(/** @type {any} */ (readFileSync(fileURLToPath(url))));
    }
    return realFetch(input, init);
  };
  await import('../worker.js');
  workerLoaded = true;
}

/** @param {any} msg deliver a protocol message to the worker's handler */
function send(msg) {
  assert.ok(fakeSelf.onmessage, 'worker.js must have installed self.onmessage');
  fakeSelf.onmessage({ data: msg });
}

/**
 * Yield a macrotask. In a real browser postMessage delivery is a macrotask,
 * so the worker's post-run cleanup (`finally { currentRun = null }`) always
 * runs before the next message arrives. This harness delivers messages
 * synchronously, so a follow-up 'run' posted straight after a terminal
 * message could race that cleanup — settle first, exactly like the event
 * loop the worker actually lives on.
 */
const settle = () =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });

/**
 * Collect every message for `id` until its terminal result/error arrives.
 * @param {number} id
 * @returns {{ got: any[], finished: Promise<any> }}
 */
function collectFor(id) {
  /** @type {any[]} */
  const got = [];
  /** @type {(msg: any) => void} */
  let done = () => {};
  const finished = new Promise((resolve) => {
    done = resolve;
  });
  /** @param {any} msg */
  const listener = (msg) => {
    if (msg.id !== id) return;
    got.push(msg);
    if (msg.type === 'result' || msg.type === 'error') {
      listeners.splice(listeners.indexOf(listener), 1);
      done(msg);
    }
  };
  listeners.push(listener);
  return { got, finished };
}

// One engine client over the REAL worker module for the client-level tests
// (exactly one client per worker — CONTRACTS §2).
/** @type {ReturnType<typeof createEngineClient> | null} */
let realClient = null;

/** @returns {Promise<ReturnType<typeof createEngineClient>>} */
async function loadRealClient() {
  await loadWorker();
  if (!realClient) {
    const workerLike = {
      /** @param {any} msg */
      postMessage: (msg) => send(msg),
      /** @param {string} type @param {(event: { data: any }) => void} handler */
      addEventListener: (type, handler) => {
        if (type === 'message') listeners.push((msg) => handler({ data: msg }));
      },
    };
    realClient = createEngineClient(createWorkerTransport(/** @type {any} */ (workerLike)));
  }
  return realClient;
}

// ---- protocol-level tests --------------------------------------------------------

test('run happy path: per-chunk progress cadence + byte-identical result', { skip: !built }, async () => {
  await loadWorker();
  const chunkSize = 31; // deliberately non-default, mirrors cross-target-hash
  const { got, finished } = collectFor(1);
  send({ id: 1, type: 'run', payload: { sim: config.sim, configJson, seed: config.seed, chunkSize } });
  const terminal = await finished;

  assert.equal(terminal.type, 'result');
  assert.equal(terminal.payload, fixtureOutputJson, 'worker result must be byte-identical to the committed cross-target output');

  const progress = got.filter((m) => m.type === 'progress').map((m) => m.payload);
  const total = Number(config.iterations);
  assert.equal(progress.length, 1 + Math.ceil(total / chunkSize), 'one initial progress + one per chunk');
  assert.equal(progress[0].completedCount, 0);
  for (const p of progress) assert.equal(p.totalIterations, total);
  for (let i = 1; i < progress.length; i += 1) {
    assert.ok(progress[i].completedCount > progress[i - 1].completedCount, 'progress is strictly monotonic');
  }
  assert.equal(progress[progress.length - 1].completedCount, total);
});

test('cancel between chunks: typed cancelled error, no result, rerun byte-identical', { skip: !built }, async () => {
  await loadWorker();
  await settle(); // prior test's run may still be clearing currentRun
  const { got, finished } = collectFor(2);
  // Post the cancel the moment the first real chunk completes — strictly
  // between chunks, exactly the CONTRACTS §2 cancellation point.
  let cancelSent = false;
  /** @param {any} msg */
  const canceller = (msg) => {
    if (msg.id === 2 && msg.type === 'progress' && msg.payload.completedCount > 0 && !cancelSent) {
      cancelSent = true;
      send({ id: 2, type: 'cancel' });
    }
  };
  listeners.push(canceller);
  send({ id: 2, type: 'run', payload: { sim: config.sim, configJson, seed: config.seed, chunkSize: 20 } });
  const terminal = await finished;
  listeners.splice(listeners.indexOf(canceller), 1);

  assert.equal(terminal.type, 'error');
  assert.equal(terminal.payload.type, 'cancelled');
  assert.ok(cancelSent, 'the cancel must have been posted mid-run');
  assert.equal(got.filter((m) => m.type === 'result').length, 0, 'a cancelled run must never deliver a result');
  const progress = got.filter((m) => m.type === 'progress').map((m) => m.payload);
  assert.ok(
    progress[progress.length - 1].completedCount < Number(config.iterations),
    'cancellation must land between chunks, before the run completes',
  );

  // Cancel = drop + begin again (engine reset): a fresh run reproduces the
  // committed output byte-for-byte.
  await settle();
  const rerun = collectFor(3);
  send({ id: 3, type: 'run', payload: { sim: config.sim, configJson, seed: config.seed } });
  const rerunTerminal = await rerun.finished;
  assert.equal(rerunTerminal.type, 'result');
  assert.equal(rerunTerminal.payload, fixtureOutputJson);
});

test('overlapping run is rejected with badState while the first run completes', { skip: !built }, async () => {
  await loadWorker();
  await settle(); // prior test's run may still be clearing currentRun
  const first = collectFor(4);
  const second = collectFor(5);
  send({ id: 4, type: 'run', payload: { sim: config.sim, configJson, seed: config.seed } });
  send({ id: 5, type: 'run', payload: { sim: config.sim, configJson, seed: config.seed } });

  const secondTerminal = await second.finished;
  assert.equal(secondTerminal.type, 'error');
  assert.equal(secondTerminal.payload.type, 'badState');
  assert.match(secondTerminal.payload.message, /already in flight/);

  const firstTerminal = await first.finished;
  assert.equal(firstTerminal.type, 'result', 'the in-flight run must be unaffected by the rejected overlap');
  assert.equal(firstTerminal.payload, fixtureOutputJson);
});

test('malformed message type is relayed as badState', { skip: !built }, async () => {
  await loadWorker();
  const { finished } = collectFor(6);
  send({ id: 6, type: 'frobnicate' });
  const terminal = await finished;
  assert.equal(terminal.type, 'error');
  assert.equal(terminal.payload.type, 'badState');
  assert.match(terminal.payload.message, /unknown message type/);
});

test('engine validation error is relayed through the typed error envelope', { skip: !built }, async () => {
  await loadWorker();
  await settle(); // prior test's run may still be clearing currentRun
  const { got, finished } = collectFor(7);
  send({ id: 7, type: 'run', payload: { sim: 'org', configJson: JSON.stringify({ nonsense: true }), seed: 1 } });
  const terminal = await finished;
  assert.equal(terminal.type, 'error');
  assert.equal(terminal.payload.type, 'validation', 'engine envelope type must pass through unchanged');
  assert.equal(typeof terminal.payload.message, 'string');
  assert.equal(got.filter((m) => m.type === 'result').length, 0);
});

// ---- client-level: the REAL transport swap --------------------------------------

test('transport swap, real worker vs fixture stub: identical caller code, byte-identical output', { skip: !built }, async () => {
  // The SAME caller function the stub-vs-stub test uses — here one transport
  // is the REAL worker module over createWorkerTransport, driving the REAL
  // built wasm. This is the real-transport conformance claim.
  /** @param {ReturnType<typeof createEngineClient>} client */
  async function caller(client) {
    /** @type {number[]} */
    const seen = [];
    const { output, outputJson } = await client.run({
      config,
      onProgress: (p) => seen.push(p.completedCount),
    });
    return { modelVersion: output.modelVersion, outputJson, progressEvents: seen.length };
  }

  const viaStub = await caller(
    createEngineClient(createFixtureTransport([{ sim: config.sim, seed: config.seed, config, outputJson: fixtureOutputJson }])),
  );
  const viaRealWorker = await caller(await loadRealClient());

  assert.equal(viaRealWorker.outputJson, viaStub.outputJson, 'real worker and fixture stub must deliver byte-identical output');
  assert.equal(viaRealWorker.outputJson, fixtureOutputJson);
  assert.equal(viaRealWorker.modelVersion, viaStub.modelVersion);
  assert.ok(viaRealWorker.progressEvents > 0 && viaStub.progressEvents > 0, 'both transports report progress');
});

test('client cancel over the real worker rejects with .cancelled and the engine recovers', { skip: !built }, async () => {
  const client = await loadRealClient();
  const running = client.run({
    config,
    chunkSize: 20,
    onProgress: ({ completedCount, totalIterations }) => {
      if (completedCount > 0 && completedCount < totalIterations) client.cancel();
    },
  });
  await assert.rejects(running, (/** @type {any} */ err) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.cancelled, true);
    return true;
  });
  const rerun = await client.run({ config });
  assert.equal(rerun.outputJson, fixtureOutputJson);
});

// ---- F3: share → replay → re-share → replay byte-identity via the REAL engine ----

test('share loop byte-identity: replay and re-share replay reproduce the run byte-for-byte, re-share within budget', { skip: !built }, async () => {
  const client = await loadRealClient();

  // Original run (the committed cross-target run).
  const original = await client.run({ config });
  assert.equal(original.outputJson, fixtureOutputJson);

  // Share it exactly the way the UI does (modelVersion normalized to the
  // engine stamp; resolvedParams from the run's output).
  const share1 = await encodeShare({
    config: buildShareConfig(config, original.output),
    resolvedParams: original.output.resolvedParams,
  });
  const payload1 = await decodeShare(share1);
  const replayConfig1 = buildReplayConfig(payload1);

  // Replay through the REAL engine: byte-identical output (CONTRACTS §4).
  const replay1 = await client.run({ config: replayConfig1 });
  assert.equal(replay1.outputJson, original.outputJson, 'replay must reproduce the original run byte-for-byte');

  // Re-share the UNEDITED replayed run — the F3 overflow path. The fragment
  // must stay within budget and must not embed the replay machinery.
  const share2 = await encodeShare({
    config: buildShareConfig(replayConfig1, replay1.output),
    resolvedParams: replay1.output.resolvedParams,
  });
  assert.ok(
    toShareFragment(share2).length < 2000,
    `re-share fragment is ${toShareFragment(share2).length} chars (budget 2000)`,
  );
  const payload2 = await decodeShare(share2);
  assert.equal(payload2.config.paramOverrides, undefined);
  assert.equal(payload2.config.replay, undefined);

  // The re-shared link replays byte-identically too.
  const replay2 = await client.run({ config: buildReplayConfig(payload2) });
  assert.equal(replay2.outputJson, original.outputJson, 're-shared replay must reproduce the original run byte-for-byte');
});
