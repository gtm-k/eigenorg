// Cross-target output hash — wasm half (PLAN P3 gate / T6).
//
// Loads the BUILT wasm (www/pkg, from scripts/build.sh), runs the committed hash
// fixture through the frozen chunked API with a deliberately non-default chunk
// size, and asserts the output sha256 equals fixtures/hash/crossTarget.sha256 —
// the SAME hash tests/cross_target.rs asserts natively. Native == wasm, proven.
//
// www/pkg is a gitignored build product, so this test SKIPS when the wasm is not
// built (e.g. the JS-only CI job); the Rust CI job runs scripts/build.sh first
// and then executes this file explicitly, where it runs for real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';

const wasmUrl = new URL('../../pkg/eigenorg_bg.wasm', import.meta.url);
const jsUrl = new URL('../../pkg/eigenorg.js', import.meta.url);
const built = existsSync(wasmUrl);

test('wasm output hash matches the committed cross-target hash', { skip: !built }, async () => {
  // Dynamic import via a string href so tsc/eslint do not follow the gitignored
  // build product at analysis time (same pattern as www/js/worker.js).
  const wasm = await import(jsUrl.href);
  await wasm.default({ module_or_path: readFileSync(wasmUrl) });

  const cfg = readFileSync('fixtures/hash/crossTarget.json', 'utf8');
  const begin = JSON.parse(wasm.begin_run('org', cfg, 1729n));
  assert.ok(begin.ok, `begin_run failed: ${JSON.stringify(begin)}`);

  let completed = 0;
  while (completed < begin.totalIterations) {
    // Deliberately non-default chunk size for chunk-boundary coverage.
    completed = JSON.parse(wasm.run_chunk(31)).completedCount;
  }
  const outJson = wasm.finalize();

  const expected = readFileSync('fixtures/hash/crossTarget.sha256', 'utf8').trim();
  const got = createHash('sha256').update(outJson).digest('hex');
  assert.equal(got, expected, 'wasm output hash drifted from the committed cross-target hash');

  // The wasm output also satisfies the authored output schema (output-side
  // double-validation).
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync('docs/schema/output.v1.schema.json', 'utf8')));
  assert.ok(validate(JSON.parse(outJson)), ajv.errorsText(validate.errors));
});

test('the frozen chunked API reports typed errors', { skip: !built }, async () => {
  const wasm = await import(jsUrl.href);
  await wasm.default({ module_or_path: readFileSync(wasmUrl) });
  // The wasm module is a cached singleton across tests; reset any in-flight run
  // (cancel = drop the run) so this exercises the before-begin_run state.
  wasm.cancel();
  // run_chunk before begin_run is a BadState error envelope.
  const before = JSON.parse(wasm.run_chunk(1));
  assert.equal(before.error?.type, 'badState');
  // A team config is a typed NotImplemented until P7a.
  const teamCfg = readFileSync('fixtures/scenarios/reviewBottleneck__bottleneck.json', 'utf8');
  const team = JSON.parse(wasm.begin_run('team', teamCfg, 42n));
  assert.equal(team.error?.type, 'notImplemented');
});
