// engine-client contract tests (CONTRACTS §2 worker protocol, PLAN P5a).
//
// The fixture-stub transport serves the COMMITTED fixture output
// (www/js/tests/fixtures/crossTarget.output.json — the sha256-pinned
// cross-target run) through the same { id, type, payload } protocol the real
// worker speaks, so serialization, progress, cancellation and error handling
// are provable under node --test without a wasm build or a browser.
// Transport swap requires zero caller changes — asserted by running the SAME
// caller code against two independently-created transports.
//
// Run from the repo root: node --test www/js/tests/engine-client.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { createEngineClient, createFixtureTransport, EngineError } from '../engine-client.js';

const FIXTURE_CONFIG_PATH = 'fixtures/hash/crossTarget.json';
const FIXTURE_OUTPUT_PATH = 'www/js/tests/fixtures/crossTarget.output.json';

const config = JSON.parse(readFileSync(FIXTURE_CONFIG_PATH, 'utf8'));
const outputJson = readFileSync(FIXTURE_OUTPUT_PATH, 'utf8');

/** A fresh stub transport serving the committed crossTarget output. */
function fixtureTransport() {
  return createFixtureTransport([
    { sim: config.sim, seed: config.seed, config, outputJson },
  ]);
}

test('committed fixture output IS the cross-target run (sha256-pinned)', () => {
  const expected = readFileSync('fixtures/hash/crossTarget.sha256', 'utf8').trim();
  const got = createHash('sha256').update(outputJson).digest('hex');
  assert.equal(
    got,
    expected,
    'the stub-transport fixture drifted from the committed cross-target hash — regenerate it from the built wasm',
  );
});

test('run() resolves with the fixture output and reports progress', async () => {
  const client = createEngineClient(fixtureTransport());
  /** @type {Array<{ completedCount: number, totalIterations: number }>} */
  const progress = [];
  const result = await client.run({ config, onProgress: (p) => progress.push(p) });

  assert.equal(result.outputJson, outputJson, 'raw output JSON is byte-identical to the fixture');
  assert.equal(result.output.sim, 'org');
  assert.ok(Array.isArray(result.output.series.entropy), 'parsed output exposes the entropy series');

  assert.ok(progress.length >= 2, 'at least initial + final progress events');
  assert.equal(progress[0].completedCount, 0);
  const last = progress[progress.length - 1];
  assert.equal(last.completedCount, last.totalIterations);
  assert.equal(last.totalIterations, config.iterations);
  for (let i = 1; i < progress.length; i++) {
    assert.ok(progress[i].completedCount >= progress[i - 1].completedCount, 'progress is monotonic');
  }
});

test('exactly one in-flight run: concurrent run() calls serialize', async () => {
  // Order-recording transport: wraps the fixture stub and logs when each
  // protocol message crosses the boundary.
  const inner = fixtureTransport();
  /** @type {string[]} */
  const events = [];
  /** @type {import('../engine-client.js').Transport} */
  const recording = {
    post: (msg) => {
      events.push(`post:${msg.type}:${msg.id}`);
      inner.post(msg);
    },
    onMessage: (handler) => {
      inner.onMessage((msg) => {
        if (msg.type === 'result' || msg.type === 'error') events.push(`recv:${msg.type}:${msg.id}`);
        handler(msg);
      });
    },
  };

  const client = createEngineClient(recording);
  const [a, b] = await Promise.all([client.run({ config }), client.run({ config })]);
  assert.equal(a.outputJson, outputJson);
  assert.equal(b.outputJson, outputJson);

  // The second 'run' must not be posted until the first one's result arrived.
  assert.deepEqual(events, ['post:run:1', 'recv:result:1', 'post:run:2', 'recv:result:2']);
});

test('cancel() rejects the in-flight run with .cancelled and the next run still works', async () => {
  const client = createEngineClient(fixtureTransport());

  const running = client.run({
    config,
    onProgress: ({ completedCount, totalIterations }) => {
      // Cancel mid-run, strictly between synthetic chunks.
      if (completedCount > 0 && completedCount < totalIterations) client.cancel();
    },
  });

  await assert.rejects(running, (/** @type {any} */ err) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.cancelled, true);
    assert.equal(err.type, 'cancelled');
    return true;
  });

  // Cancel = drop + begin again: a fresh run reproduces the output.
  const rerun = await client.run({ config });
  assert.equal(rerun.outputJson, outputJson);
});

test('cancel() when idle is a no-op', async () => {
  const client = createEngineClient(fixtureTransport());
  client.cancel();
  const result = await client.run({ config });
  assert.equal(result.outputJson, outputJson);
});

test('same-tick run(); cancel() cancels the just-queued run (never silently lost)', async () => {
  // run() posts on a microtask (behind the serialization chain), so a cancel()
  // issued in the SAME tick used to find inFlightId === null and no-op — the
  // run then completed as if never cancelled (P5 round-1 LOW, empirically
  // confirmed). The cancel-requested flag must be honored before the post.
  const client = createEngineClient(fixtureTransport());
  const running = client.run({ config });
  client.cancel(); // same tick — the run message has NOT been posted yet
  await assert.rejects(running, (/** @type {any} */ err) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.cancelled, true);
    assert.equal(err.type, 'cancelled');
    return true;
  });
  // The client is not wedged: a fresh run still works.
  const rerun = await client.run({ config });
  assert.equal(rerun.outputJson, outputJson);
});

test('a missing fixture rejects with a typed EngineError and does not block later runs', async () => {
  const client = createEngineClient(fixtureTransport());
  const unknownConfig = { ...config, seed: config.seed + 1 };
  await assert.rejects(client.run({ config: unknownConfig }), (/** @type {any} */ err) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.type, 'fixtureMissing');
    assert.equal(err.cancelled, false);
    return true;
  });
  const ok = await client.run({ config });
  assert.equal(ok.outputJson, outputJson);
});

test('engine error envelopes surface as typed EngineErrors (scripted transport)', async () => {
  // A transport scripted to reply exactly like the worker relaying an engine
  // validation envelope (CONTRACTS §2 error shape).
  /** @type {(msg: any) => void} */
  let deliver = () => {};
  /** @type {import('../engine-client.js').Transport} */
  const scripted = {
    post: (msg) => {
      if (msg.type === 'run') {
        globalThis.setTimeout(() => {
          deliver({ id: msg.id, type: 'error', payload: { type: 'validation', message: 'unknown paramOverrides key' } });
        }, 0);
      }
    },
    onMessage: (handler) => {
      deliver = handler;
    },
  };
  const client = createEngineClient(scripted);
  await assert.rejects(client.run({ config }), (/** @type {any} */ err) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.type, 'validation');
    assert.match(err.message, /paramOverrides/);
    return true;
  });
});

test('transport swap requires zero caller changes', async () => {
  // The SAME caller function runs against two different transport instances.
  /** @param {import('../engine-client.js').Transport} transport */
  async function caller(transport) {
    const client = createEngineClient(transport);
    /** @type {number[]} */
    const seen = [];
    const { output, outputJson: raw } = await client.run({
      config,
      onProgress: (p) => seen.push(p.completedCount),
    });
    return { modelVersion: output.modelVersion, bytes: raw.length, progressEvents: seen.length };
  }

  const viaStubA = await caller(fixtureTransport());
  const viaStubB = await caller(createFixtureTransport([{ sim: config.sim, seed: config.seed, config, outputJson }], { syntheticChunks: 8 }));
  assert.equal(viaStubA.modelVersion, viaStubB.modelVersion);
  assert.equal(viaStubA.bytes, viaStubB.bytes);
  assert.ok(viaStubA.progressEvents > 0 && viaStubB.progressEvents > 0);
  // (The real-worker transport speaks the identical protocol; it is exercised
  //  end-to-end in the browser slice + cross-target-hash wasm test.)
});
