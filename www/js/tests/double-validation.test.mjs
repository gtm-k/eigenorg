// Double-validation — ajv half (PLAN P3 gate).
//
// The mirror of tests/double_validation.rs (serde half): every committed fixture
// must pass BOTH ajv here AND serde+validate() in Rust; a fixture accepted by
// exactly one is a schema/type drift (T3). Valid fixtures (fixtures/scenarios +
// fixtures/hash) must validate; invalid ones (fixtures/invalid) must be rejected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });
const configSchema = JSON.parse(readFileSync('docs/schema/config.v1.schema.json', 'utf8'));
const validateConfig = ajv.compile(configSchema);

/** @param {string} dir */
function jsonFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => `${dir}/${f}`);
}

test('every valid fixture passes the config schema (ajv)', () => {
  const files = [...jsonFiles('fixtures/scenarios'), ...jsonFiles('fixtures/hash')].filter(
    (f) => !f.endsWith('.sha256'),
  );
  assert.ok(files.length >= 12, `expected the full fixture set, saw ${files.length}`);
  for (const file of files) {
    const ok = validateConfig(JSON.parse(readFileSync(file, 'utf8')));
    assert.ok(ok, `valid fixture rejected by ajv: ${file} — ${ajv.errorsText(validateConfig.errors)}`);
  }
});

test('every invalid fixture is rejected by the config schema (ajv)', () => {
  const files = jsonFiles('fixtures/invalid');
  assert.ok(files.length > 0, 'expected invalid fixtures');
  for (const file of files) {
    const ok = validateConfig(JSON.parse(readFileSync(file, 'utf8')));
    assert.ok(!ok, `invalid fixture wrongly accepted by ajv: ${file}`);
  }
});

test('the output schema compiles (authored alongside config schema)', () => {
  const outputSchema = JSON.parse(readFileSync('docs/schema/output.v1.schema.json', 'utf8'));
  // A trivial well-formed output validates; a missing required field does not.
  const validateOutput = ajv.compile(outputSchema);
  const minimal = {
    schemaVersion: '1',
    modelVersion: '2.0.0',
    sim: 'org',
    seed: 42,
    iterations: 500,
    horizon: 1,
    series: { entropy: [{ t: 0, p10: 1, p50: 2, p90: 3 }] },
    resolvedParams: { layerFrictionFactor: 0.35 },
  };
  assert.ok(validateOutput(minimal), ajv.errorsText(validateOutput.errors));
  assert.ok(!validateOutput({ ...minimal, series: undefined }), 'missing series must fail');
});
