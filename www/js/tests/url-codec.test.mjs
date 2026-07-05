// url-codec contract tests (CONTRACTS §4 / MODEL.md §12.4, PLAN P5a).
//
// - Round-trips EVERY committed preset run config byte-equal (serialized form)
//   with a FULL resolvedParams set (all 108 defaults from model/params.json —
//   the realistic share payload, since resolvedParams is the full effective
//   coefficient set).
// - Asserts every encoded preset fragment stays under 2,000 chars.
// - buildReplayConfig sets replay:true + full-set paramOverrides (the
//   explicit-flag contract; replay-by-cardinality is dead).
// - modelVersion banner hook; unknown codec version; unknown MAJOR
//   schemaVersion rejected gracefully; malformed inputs rejected typed.
//
// Run from the repo root: node --test www/js/tests/url-codec.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import {
  CODEC_VERSION,
  SHARE_FRAGMENT_BUDGET,
  ShareUrlError,
  encodeShare,
  decodeShare,
  buildReplayConfig,
  modelVersionBanner,
  extractShareFragment,
  toShareFragment,
} from '../url-codec.js';

const PRESET_DIR = 'www/presets';
const params = JSON.parse(readFileSync('model/params.json', 'utf8'));

/**
 * The full effective coefficient set: every params.json default, merged with
 * a config's paramOverrides — mirroring the engine's resolvedParams output.
 * @param {any} config
 */
function fullResolvedParams(config) {
  /** @type {Record<string, number | number[]>} */
  const resolved = {};
  for (const p of params.parameters) resolved[p.id] = p.value;
  Object.assign(resolved, config.paramOverrides ?? {});
  return resolved;
}

/** Every run config across every committed preset. */
function allPresetRuns() {
  /** @type {Array<{ presetId: string, runId: string, config: any }>} */
  const runs = [];
  for (const file of readdirSync(PRESET_DIR)) {
    if (!file.endsWith('.json')) continue;
    const preset = JSON.parse(readFileSync(join(PRESET_DIR, file), 'utf8'));
    for (const [runId, config] of Object.entries(preset.runs)) {
      runs.push({ presetId: preset.id, runId, config });
    }
  }
  return runs;
}

test('presets exist and carry runs (the round-trip suite is not vacuous)', () => {
  const runs = allPresetRuns();
  assert.ok(runs.length >= 5, `expected at least 5 preset run configs, found ${runs.length}`);
});

test('every preset run config round-trips byte-equal with full resolvedParams', async () => {
  for (const { presetId, runId, config } of allPresetRuns()) {
    const resolvedParams = fullResolvedParams(config);
    const encoded = await encodeShare({ config, resolvedParams });
    const decoded = await decodeShare(encoded);

    const label = `${presetId}.${runId}`;
    assert.equal(decoded.v, CODEC_VERSION, label);
    assert.equal(decoded.sim, config.sim, label);
    assert.equal(decoded.seed, config.seed, label);
    // Byte-equal on the serialized form (JSON.parse/stringify preserves key
    // insertion order, so this is a byte-level comparison of the config).
    assert.equal(JSON.stringify(decoded.config), JSON.stringify(config), `${label}: config drifted through the codec`);
    assert.equal(
      JSON.stringify(decoded.resolvedParams),
      JSON.stringify(resolvedParams),
      `${label}: resolvedParams drifted through the codec`,
    );
  }
});

test('every encoded preset share fragment is < 2000 chars (URL budget)', async () => {
  for (const { presetId, runId, config } of allPresetRuns()) {
    const encoded = await encodeShare({ config, resolvedParams: fullResolvedParams(config) });
    const fragment = toShareFragment(encoded);
    assert.ok(
      fragment.length < 2000,
      `${presetId}.${runId}: encoded fragment is ${fragment.length} chars (budget 2000)`,
    );
  }
});

test('re-share loop (encode→decode→buildReplayConfig→re-encode) stays < 2000 for EVERY preset run', async () => {
  // Re-sharing an UNEDITED replayed run used to double-carry the 108-param
  // set (config.paramOverrides + resolvedParams) and measurably overflow the
  // budget: layerConfigurator.aiMiddle re-share = 2005 > 2000 chars (P5
  // round-1 F3). encodeShare now strips the replay machinery from the
  // embedded config when it is exactly the resolvedParams being embedded.
  for (const { presetId, runId, config } of allPresetRuns()) {
    const label = `${presetId}.${runId}`;
    const resolvedParams = fullResolvedParams(config);

    // First share → replay boot (what a recipient's browser runs).
    const encoded1 = await encodeShare({ config, resolvedParams });
    const payload1 = await decodeShare(encoded1);
    const replayConfig = buildReplayConfig(payload1);

    // Re-share of the UNEDITED replayed run: the config as run IS the replay
    // config, and the replay run's resolvedParams are the embedded set.
    const encoded2 = await encodeShare({ config: replayConfig, resolvedParams: payload1.resolvedParams });
    const fragment2 = toShareFragment(encoded2);
    assert.ok(
      fragment2.length < 2000,
      `${label}: re-share fragment is ${fragment2.length} chars (budget 2000)`,
    );

    // Round-trip semantics preserved: the re-shared link reconstructs the
    // exact same replay config (full-set paramOverrides + replay:true), and
    // the embedded config carries no replay machinery.
    const payload2 = await decodeShare(encoded2);
    assert.equal(payload2.config.paramOverrides, undefined, `${label}: re-share must not embed the full-set paramOverrides`);
    assert.equal(payload2.config.replay, undefined, `${label}: re-share must not embed the replay flag`);
    assert.equal(
      JSON.stringify(payload2.config),
      JSON.stringify(payload1.config),
      `${label}: re-shared embedded config drifted from the original share`,
    );
    assert.equal(
      JSON.stringify(payload2.resolvedParams),
      JSON.stringify(payload1.resolvedParams),
      `${label}: re-shared resolvedParams drifted`,
    );
    assert.equal(
      JSON.stringify(buildReplayConfig(payload2)),
      JSON.stringify(replayConfig),
      `${label}: re-shared link does not reconstruct the identical replay config`,
    );
  }
});

test('encodeShare preserves AUTHORED partial paramOverrides (strip fires only on the full replay set)', async () => {
  const { config } = allPresetRuns()[0];
  const resolvedParams = fullResolvedParams(config);
  const someKey = Object.keys(resolvedParams)[0];
  const authored = { ...config, paramOverrides: { [someKey]: resolvedParams[someKey] } };
  const payload = await decodeShare(await encodeShare({ config: authored, resolvedParams }));
  assert.deepEqual(payload.config.paramOverrides, authored.paramOverrides, 'partial overrides must survive the codec');
});

test('encodeShare does not mutate the caller config when stripping the replay set', async () => {
  const { config } = allPresetRuns()[0];
  const resolvedParams = fullResolvedParams(config);
  const replayConfig = buildReplayConfig(await decodeShare(await encodeShare({ config, resolvedParams })));
  const before = JSON.stringify(replayConfig);
  await encodeShare({ config: replayConfig, resolvedParams });
  assert.equal(JSON.stringify(replayConfig), before, 'caller config was mutated by encodeShare');
});

test('encodeShare over the 2000-char budget throws a typed ShareUrlError(budget), never a silent overlong link', async () => {
  const { config } = allPresetRuns()[0];
  const resolvedParams = fullResolvedParams(config);
  // Deterministic low-compressibility ballast pushes the fragment over budget.
  const ballast = Array.from({ length: 800 }, (_, i) => Math.sin(i + 1));
  const oversized = { ...config, ballast };
  await assert.rejects(
    encodeShare({ config: oversized, resolvedParams }),
    (/** @type {any} */ err) => {
      assert.ok(err instanceof ShareUrlError);
      assert.equal(err.code, 'budget');
      assert.match(err.message, new RegExp(String(SHARE_FRAGMENT_BUDGET)));
      return true;
    },
  );
});

test('encoding is deterministic (same payload → same fragment)', async () => {
  const { config } = allPresetRuns()[0];
  const resolvedParams = fullResolvedParams(config);
  const a = await encodeShare({ config, resolvedParams });
  const b = await encodeShare({ config, resolvedParams });
  assert.equal(a, b);
});

test('buildReplayConfig sets replay:true and the FULL-set paramOverrides', async () => {
  const { config } = allPresetRuns()[0];
  const resolvedParams = fullResolvedParams(config);
  const payload = await decodeShare(await encodeShare({ config, resolvedParams }));

  const replayConfig = buildReplayConfig(payload);
  assert.equal(replayConfig.replay, true, 'replay flag must be the explicit boolean (CONTRACTS §4)');
  assert.equal(
    JSON.stringify(replayConfig.paramOverrides),
    JSON.stringify(resolvedParams),
    'paramOverrides must be the embedded resolvedParams, full set',
  );
  assert.equal(
    Object.keys(replayConfig.paramOverrides).length,
    params.parameters.length,
    'full-set override covers every parameter',
  );
  // Everything else survives byte-equal.
  const rest = { ...replayConfig };
  delete rest.replay;
  delete rest.paramOverrides;
  const origRest = { ...payload.config };
  delete origRest.paramOverrides;
  assert.equal(JSON.stringify(rest), JSON.stringify(origRest));
  // The decoded payload is NOT mutated (pure function).
  assert.equal(payload.config.replay, undefined);
  assert.notEqual(replayConfig.paramOverrides, payload.resolvedParams, 'must deep-copy, not alias');
});

test('modelVersion banner hook: mismatch and match', async () => {
  const { config } = allPresetRuns()[0];
  const payload = await decodeShare(await encodeShare({ config, resolvedParams: fullResolvedParams(config) }));

  const same = modelVersionBanner(payload, String(config.modelVersion));
  assert.equal(same.mismatch, false);
  assert.equal(same.message, null);

  const differs = modelVersionBanner(payload, '99.0.0');
  assert.equal(differs.mismatch, true);
  assert.equal(differs.linkVersion, String(config.modelVersion));
  assert.equal(differs.currentVersion, '99.0.0');
  assert.match(String(differs.message), /replays its embedded parameters/);
});

test('unknown codec version is rejected gracefully', async () => {
  // Forge a v:2 payload through the same compression path by round-tripping a
  // v:1 fragment and re-encoding its JSON with v bumped.
  const { config } = allPresetRuns()[0];
  const resolvedParams = fullResolvedParams(config);
  const good = await decodeShare(await encodeShare({ config, resolvedParams }));
  const forged = { ...good, v: 2 };
  // node:zlib raw deflate is decodable by the codec's DecompressionStream path.
  const encoded = deflateRawSync(JSON.stringify(forged)).toString('base64url');

  await assert.rejects(decodeShare(encoded), (/** @type {any} */ err) => {
    assert.ok(err instanceof ShareUrlError);
    assert.equal(err.code, 'unsupportedCodecVersion');
    return true;
  });
});

test('unknown MAJOR schemaVersion is rejected gracefully', async () => {
  const { config } = allPresetRuns()[0];
  const futureConfig = { ...config, schemaVersion: '2' };
  const encoded = await encodeShare({ config: futureConfig, resolvedParams: fullResolvedParams(config) });
  await assert.rejects(decodeShare(encoded), (/** @type {any} */ err) => {
    assert.ok(err instanceof ShareUrlError);
    assert.equal(err.code, 'unsupportedSchemaVersion');
    assert.match(err.message, /schema/i);
    return true;
  });
});

test('malformed inputs are rejected with typed errors, never crashes', async () => {
  for (const bad of ['', '!!!not-base64url!!!', 'AAAA', 'abcde']) {
    await assert.rejects(decodeShare(bad), (/** @type {any} */ err) => {
      assert.ok(err instanceof ShareUrlError, `expected ShareUrlError for ${JSON.stringify(bad)}`);
      assert.equal(err.code, 'malformed');
      return true;
    });
  }
});

test('decodeShare rejects payloads with missing, mistyped, or config-divergent sim/seed', async () => {
  const { config } = allPresetRuns()[0];
  const good = await decodeShare(await encodeShare({ config, resolvedParams: fullResolvedParams(config) }));

  /** @param {any} forged */
  const forge = (forged) => deflateRawSync(JSON.stringify(forged)).toString('base64url');

  const cases = [
    ['missing sim', (() => { const p = /** @type {any} */ ({ ...good }); delete p.sim; return p; })()],
    ['non-string sim', { ...good, sim: 7 }],
    ['missing seed', (() => { const p = /** @type {any} */ ({ ...good }); delete p.seed; return p; })()],
    ['non-number seed', { ...good, seed: String(good.seed) }],
    ['non-finite seed', { ...good, seed: null }],
    ['sim disagreeing with config.sim', { ...good, sim: 'team' }],
    ['seed disagreeing with config.seed', { ...good, seed: good.seed + 1 }],
  ];
  for (const [name, forged] of cases) {
    await assert.rejects(decodeShare(forge(forged)), (/** @type {any} */ err) => {
      assert.ok(err instanceof ShareUrlError, `${name}: expected ShareUrlError`);
      assert.equal(err.code, 'malformed', `${name}: expected code 'malformed'`);
      return true;
    });
  }
});

test('encodeShare validates sim/seed consistency with the config', async () => {
  const { config } = allPresetRuns()[0];
  const resolvedParams = fullResolvedParams(config);
  await assert.rejects(encodeShare({ config, resolvedParams, sim: 'team' }), ShareUrlError);
  await assert.rejects(encodeShare({ config, resolvedParams, seed: config.seed + 1 }), ShareUrlError);
});

test('fragment helpers: extract + render', () => {
  assert.equal(extractShareFragment('#s=abc-DEF_123'), 'abc-DEF_123');
  assert.equal(extractShareFragment('#other=1'), null);
  assert.equal(extractShareFragment(''), null);
  assert.equal(extractShareFragment('#s='), null);
  assert.equal(toShareFragment('xyz'), '#s=xyz');
});
