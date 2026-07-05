// P6 Prioritization Layer Configurator — pure-core tests (no DOM).
//
// The golden anchor is the real www/presets/layerConfigurator.json on disk
// (the same file the Rust plausibility test reads) — base values are fetched,
// never re-typed (S1 no-drift). The wasm-dependent checks (engine validate()
// on a sampled config, the real-engine direction smoke) SKIP when www/pkg is
// unbuilt, exactly like worker.test.mjs / cross-target-hash.test.mjs — they run
// for real in the Rust CI job that builds the wasm first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';

import {
  LAYER_TYPES,
  MIN_LAYERS,
  MAX_LAYERS,
  stackFromConfig,
  clampLayerCount,
  resizeStack,
  assignType,
  isAllHuman,
  hasNonHumanLayer,
  configWithStack,
  allHumanTwin,
  flowRows,
  recoveryOwned,
  settledLatency,
  cumulativeBrittleness,
  legibilitySummary,
  whatThisMeans,
} from '../ui/prioritization.js';
import { encodeShare, decodeShare, buildReplayConfig } from '../url-codec.js';
import { buildShareConfig } from '../ui/share.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
const presetsDir = path.join(repoRoot, 'www', 'presets');
const schemaPath = path.join(repoRoot, 'docs', 'schema', 'config.v1.schema.json');
const paramsPath = path.join(repoRoot, 'model', 'params.json');

const lcPreset = JSON.parse(readFileSync(path.join(presetsDir, 'layerConfigurator.json'), 'utf8'));
/** @returns {any} */
const aiMiddle = () => JSON.parse(JSON.stringify(lcPreset.runs.aiMiddle));
/** @returns {any} */
const allHumanRun = () => JSON.parse(JSON.stringify(lcPreset.runs.allHuman));

const ajv = new Ajv({ allErrors: true, strict: false });
// Cast away ajv's type-predicate signature so calling it does not narrow the
// argument to `unknown` (the compiled validator's default generic).
const validateConfig = /** @type {(data: any) => boolean} */ (ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8'))));

// ---- 1. preset round-trip (the golden anchor — G5) --------------------------

test('1. preset round-trip: configWithStack∘stackFromConfig is identity on aiMiddle; allHumanTwin(aiMiddle) === allHuman', () => {
  const cfg = aiMiddle();
  const rebuilt = configWithStack(cfg, stackFromConfig(cfg));
  assert.deepEqual(rebuilt, aiMiddle(), 'hydrate → re-emit preserves the aiMiddle config byte-for-byte');
  assert.deepEqual(allHumanTwin(aiMiddle()), allHumanRun(), 'allHumanTwin(aiMiddle) deep-equals the preset allHuman run');
});

// ---- 2. builder × schema property sweep (A1–A3, A5) -------------------------

test('2. builder sweep: every reachable stack emits an ajv-valid, url-codec-round-tripping config', async () => {
  const base = aiMiddle();
  const samples = [];
  // Corners: every layer count × every single-type-filled stack, plus the
  // preset's mixed stack and a maximal mixed stack.
  for (let L = MIN_LAYERS; L <= MAX_LAYERS; L += 1) {
    for (const type of LAYER_TYPES) {
      samples.push(Array.from({ length: L }, () => type));
    }
  }
  samples.push(['humanPm', 'aiAgent', 'humanPm']);
  samples.push(['humanDirector', 'aiAgent', 'committee', 'humanPm', 'humanDirector']);

  for (const stack of samples) {
    const cfg = configWithStack(base, stack);
    const valid = validateConfig(cfg);
    assert.ok(valid, `ajv rejects a reachable stack ${JSON.stringify(stack)}: ${ajv.errorsText(/** @type {any} */ (validateConfig).errors)}`);
    // Length invariant holds whenever layerTypes is present (A1, serde-only).
    if (Array.isArray(cfg.org.layerTypes)) {
      assert.equal(cfg.org.layerTypes.length, cfg.org.ownershipLayers, 'layerTypes.length === ownershipLayers');
    }
    // url-codec byte-equal round-trip (G6): the layer stack survives the share codec.
    const resolvedParams = { seedParam: 1 };
    const shareConfig = buildShareConfig(cfg, { modelVersion: '2.1.0', resolvedParams });
    const encoded = await encodeShare({ config: shareConfig, resolvedParams });
    const payload = await decodeShare(encoded);
    assert.deepEqual(payload.config, shareConfig, `codec round-trip drops fields for ${JSON.stringify(stack)}`);
  }
});

// ---- 3. neutral identity (§9.9) --------------------------------------------

test('3. neutral identity: absent layerTypes reads all-humanPm and an untouched all-human stack does not add the field', () => {
  const bare = aiMiddle();
  delete bare.org.layerTypes; // a config that never declared types
  assert.deepEqual(stackFromConfig(bare), ['humanPm', 'humanPm', 'humanPm']);
  const reemitted = configWithStack(bare, stackFromConfig(bare));
  assert.equal('layerTypes' in reemitted.org, false, 'no layerTypes field materialized (byte-preservation, A5)');
  assert.equal(reemitted.org.ownershipLayers, 3);
});

// ---- 4. length invariant across every transition (A1) ----------------------

test('4. length invariant: resizeStack pads humanPm / truncates, clamps [1,5], and configWithStack stays in lockstep', () => {
  const start = ['humanPm', 'aiAgent', 'committee'];
  // grow to 5
  assert.deepEqual(resizeStack(start, 5), ['humanPm', 'aiAgent', 'committee', 'humanPm', 'humanPm']);
  // shrink to 1
  assert.deepEqual(resizeStack(start, 1), ['humanPm']);
  // clamp out of range
  assert.equal(resizeStack(start, 99).length, MAX_LAYERS);
  assert.equal(resizeStack(start, 0).length, MIN_LAYERS);
  assert.equal(clampLayerCount(3.7), 4);
  assert.equal(clampLayerCount(-2), MIN_LAYERS);

  // configWithStack keeps ownershipLayers and layerTypes.length equal for every count.
  const base = aiMiddle();
  for (let L = MIN_LAYERS; L <= MAX_LAYERS; L += 1) {
    const cfg = configWithStack(base, resizeStack(start, L));
    assert.equal(cfg.org.ownershipLayers, L);
    assert.equal(cfg.org.layerTypes.length, L);
  }
});

test('4b. configWithStack resizes a present layerOwnerCount and enforces the §12.1 matrix-terminal rule', () => {
  const cfg = aiMiddle();
  cfg.org.layerOwnerCount = [1, 3, 1];
  cfg.org.matrix = { enabled: true, tiebreaker: 0.5 };
  const shrunk = configWithStack(cfg, ['humanPm', 'committee']); // L 3 → 2, μ=3 becomes terminal
  assert.deepEqual(shrunk.org.layerOwnerCount, [1, 1], 'terminal seat μ forced to 1 under matrix');
  assert.equal(shrunk.org.ownershipLayers, 2);
});

// ---- 5. type enum closed ---------------------------------------------------

test('5. type enum is closed: only the four §9.9 values are assignable', () => {
  assert.deepEqual([...LAYER_TYPES], ['humanPm', 'humanDirector', 'aiAgent', 'committee']);
  const stack = ['humanPm', 'humanPm'];
  assert.deepEqual(assignType(stack, 1, 'committee'), ['humanPm', 'committee']);
  assert.throws(() => assignType(stack, 0, 'robot'), /unknown layer type/);
  assert.throws(() => assignType(stack, 9, 'aiAgent'), /out of range/);
  assert.equal(isAllHuman(['humanPm', 'humanPm']), true);
  assert.equal(isAllHuman(['humanPm', 'aiAgent']), false);
  assert.equal(hasNonHumanLayer(aiMiddle()), true);
  assert.equal(hasNonHumanLayer(allHumanRun()), false);
});

// ---- 6. recoveryOwned (A4) — threshold from resolvedParams, no literal ------

test('6. recoveryOwned reads SH ≥ resolvedParams.recoveryOwnershipThreshold; flips with either input', () => {
  const cfg = aiMiddle(); // SH 5
  assert.equal(recoveryOwned(cfg, { recoveryOwnershipThreshold: 5 }), true); // 5 ≥ 5
  assert.equal(recoveryOwned(cfg, { recoveryOwnershipThreshold: 6 }), false); // 5 < 6
  const healthier = JSON.parse(JSON.stringify(cfg));
  healthier.org.structuralHealth = 8;
  assert.equal(recoveryOwned(healthier, { recoveryOwnershipThreshold: 6 }), true); // 8 ≥ 6
  assert.equal(recoveryOwned(cfg, undefined), null, 'pending before a run — no guess');
  assert.equal(recoveryOwned(cfg, {}), null, 'missing threshold → pending, never a hardcoded fallback');
});

// ---- 7. rendering fidelity (G1–G3, flowRows mapping) -----------------------

test('7. flowRows maps perLayer fields faithfully; layer-1 zero override share and all-zero cases survive', () => {
  const output = {
    perLayer: [
      { layer: 1, layerType: 'humanPm', meanLatencyDays: 2.1, meanQueue: 0.4, utilization: 0.45, overrideShare: 0, distortion: 0, ownerMultiplicity: 1, diffusionFactor: 1, bottleneck: false },
      { layer: 2, layerType: 'aiAgent', meanLatencyDays: 0.9, meanQueue: 1.2, utilization: 0.93, overrideShare: 0.6, distortion: 0.3, ownerMultiplicity: 1, diffusionFactor: 1, bottleneck: true },
      { layer: 3, layerType: 'humanPm', meanLatencyDays: 3.0, meanQueue: 0.8, utilization: 0.7, overrideShare: 0.4, distortion: 0.8, ownerMultiplicity: 1, diffusionFactor: 1, bottleneck: false },
    ],
  };
  const rows = flowRows(output);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].overrideShare, 0, 'layer 1 override share passes through as 0 (never NaN)');
  assert.equal(rows[1].bottleneck, true, 'the busiest seat is flagged (max utilization)');
  assert.equal(rows[1].meanQueue, 1.2);
  assert.equal(rows[2].distortion, 0.8);
  // an all-zero override output stays 0, not NaN
  const zero = flowRows({ perLayer: [{ layer: 1, layerType: 'humanPm', meanLatencyDays: 2, meanQueue: 0, utilization: 0.2, overrideShare: 0, distortion: 0, ownerMultiplicity: 1, diffusionFactor: 1, bottleneck: true }] });
  assert.equal(zero[0].overrideShare, 0);
  assert.deepEqual(flowRows({}), [], 'no perLayer → empty (pending), never a throw');
});

// ---- 8. whatThisMeans rules + coefficient-literal grep (G4) -----------------

test('8. whatThisMeans is directional per stack class and computes magnitudes only from outputs', () => {
  const aiCfg = aiMiddle();
  // no outputs → mechanism direction, no numbers
  assert.match(whatThisMeans(aiCfg), /exposes novel work to brittleness/);
  assert.doesNotMatch(whatThisMeans(aiCfg), /\d/, 'the no-output AI sentence carries no digits');
  // with both outputs → computed magnitudes (engine numbers, legal)
  const primary = { series: { decisionLatency: [{ t: 59, p10: 0, p50: 4.2, p90: 0 }], cumulativeBrittleness: [{ t: 59, p10: 0, p50: 3, p90: 0 }] } };
  const twin = { series: { decisionLatency: [{ t: 59, p10: 0, p50: 6.0, p90: 0 }], cumulativeBrittleness: [{ t: 59, p10: 0, p50: 0, p90: 0 }] } };
  const sentence = whatThisMeans(aiCfg, primary, twin);
  assert.match(sentence, /4\.2 days/);
  assert.match(sentence, /6\.0 days/);
  assert.match(sentence, /3 events/);
  assert.match(sentence, /0 events/);
  // committee / director / tax / single-layer classes
  const committee = configWithStack(aiMiddle(), ['humanPm', 'committee', 'humanPm']);
  assert.match(whatThisMeans(committee), /committee seat/);
  const director = configWithStack(aiMiddle(), ['humanDirector', 'humanPm', 'humanPm']);
  assert.match(whatThisMeans(director), /director seat/);
  assert.match(whatThisMeans(allHumanRun()), /prioritization tax/);
  const single = configWithStack(aiMiddle(), ['humanPm']);
  assert.match(whatThisMeans(single), /single all-human approval layer/);
});

test('8b. no §9.9 coefficient literal appears in www/js (P8 no-coefficient-literal gate, run now)', () => {
  // The §9.9 editorial layer factors + the recovery threshold are the values a
  // "legibility" build is tempted to hard-code (G4). They must appear NOWHERE
  // in browser-served JS — every model number is read from a run's
  // resolvedParams/series at render time. (Structural integers like the 1–5
  // layer bounds are not coefficients and are out of scope; this gate targets
  // the distinctive editorial coefficients that could only be a hard-copied
  // model value.)
  const params = JSON.parse(readFileSync(paramsPath, 'utf8'));
  const byId = new Map((Array.isArray(params) ? params : params.parameters ?? []).map((/** @type {any} */ p) => [p.id, p]));
  const coeffIds = [
    'layerLatencyFactorDirector', 'layerCapacityFactorDirector',
    'layerLatencyFactorAiAgent', 'layerCapacityFactorAiAgent', 'layerDistortionFactorAiAgent', 'layerNovelExposureAiAgent',
    'layerLatencyFactorCommittee', 'layerCapacityFactorCommittee', 'layerDistortionFactorCommittee',
  ];
  const values = coeffIds
    .map((id) => byId.get(id)?.value)
    .filter((v) => typeof v === 'number')
    // distinctive decimals only (a bare "1" or "5" is structural, not a coefficient)
    .filter((v) => !Number.isInteger(v));
  assert.ok(values.length >= 6, 'sanity: found the §9.9 editorial float coefficients in params.json');

  // Browser-served JS, relative to www/js/ (= here/..). The P6 module plus the
  // P5 modules it composes with — none may hard-code a §9.9 coefficient.
  const jsFiles = ['ui/prioritization.js', 'ui/org.js', 'ui/runplan.js', 'ui/meaning.js', 'ui/presets.js', 'ui/share.js', 'main.js', 'url-codec.js'];
  for (const rel of jsFiles) {
    const src = readFileSync(path.join(here, '..', rel), 'utf8');
    // strip block/line comments so prose mentioning a value is not a false hit
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const v of values) {
      const re = new RegExp(`(?<![\\d.])${String(v).replace('.', '\\.')}(?![\\d])`);
      assert.doesNotMatch(code, re, `${rel} contains the §9.9 coefficient literal ${v}`);
    }
  }
});

// ---- 9. share-snapshot / replay authoring (B1, B2) --------------------------

test('9. a stack edit is authoring: it strips replay + paramOverrides so the run is fully validated (B2)', () => {
  // A replay config (opened from a share link) then edited: replay must clear.
  const replay = buildReplayConfig(/** @type {any} */ ({
    config: { ...aiMiddle(), modelVersion: '2.1.0' },
    resolvedParams: { recoveryOwnershipThreshold: 5 },
  }));
  assert.equal(replay.replay, true);
  assert.ok(replay.paramOverrides);
  const edited = configWithStack(replay, ['humanPm', 'aiAgent', 'aiAgent']);
  assert.equal('replay' in edited, false, 'replay flag cleared on edit (contract-forced)');
  assert.equal('paramOverrides' in edited, false, 'authoring strips paramOverrides — mirrors P5 ui/org.js');
  assert.deepEqual(edited.org.layerTypes, ['humanPm', 'aiAgent', 'aiAgent']);
});

// ---- summary helper --------------------------------------------------------

test('legibilitySummary reads settled latency + cumulative brittleness from both runs', () => {
  const primary = { series: { decisionLatency: [{ t: 0, p50: 5 }, { t: 1, p50: 4 }], cumulativeBrittleness: [{ t: 1, p50: 3 }] } };
  const twin = { series: { decisionLatency: [{ t: 1, p50: 6 }], cumulativeBrittleness: [{ t: 1, p50: 0 }] } };
  assert.equal(settledLatency(primary), 4);
  assert.equal(cumulativeBrittleness(primary), 3);
  const s = legibilitySummary(primary, twin);
  assert.deepEqual(s.primary, { latency: 4, brittleness: 3 });
  assert.deepEqual(s.twin, { latency: 6, brittleness: 0 });
  assert.equal(legibilitySummary(primary).twin, null);
  assert.equal(settledLatency({}), null);
});
