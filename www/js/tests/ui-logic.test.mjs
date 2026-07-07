// P5b UI logic tests — pure modules only (no DOM): run planning, control
// application, meaning rules, preset refs pinned to the files on disk, and
// share-config normalization.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildRunPlan,
  contrastStructuralHealth,
  hasActiveAiInjection,
  deltaSeries,
  finalP50,
  maxP90,
  headcountAt,
  computeBandCrossings,
  completionPolicy,
  autoRunsOnInteraction,
  stagesGeneration,
} from '../ui/runplan.js';
import { CONTROL_DEFS, readOrgValues, applyOrgValue, stripReplay, clampControlValue } from '../ui/org.js';
import { PRESET_REFS, DEFAULT_PRESET_ID, primaryRunConfig } from '../ui/presets.js';
import { meaningFor, PANEL_IDS, paneHeading } from '../ui/meaning.js';
import { buildShareConfig } from '../ui/share.js';
import { encodeShare, decodeShare, buildReplayConfig } from '../url-codec.js';

const presetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'presets');

/** @returns {any} the fasterDysfunction sh3 config, fresh copy */
function landingConfig() {
  const preset = JSON.parse(readFileSync(path.join(presetsDir, 'fasterDysfunction.json'), 'utf8'));
  return JSON.parse(JSON.stringify(preset.runs.sh3));
}

// ---- run plan -------------------------------------------------------------------

test('landing plan is exactly PLAN P5: same org, AI injected, SH 3 vs 7, plus the AI-off twin', () => {
  const plan = buildRunPlan(landingConfig());
  assert.equal(plan.runCount, 3);
  assert.equal(plan.beforeSh, 3);
  assert.equal(plan.afterSh, 7);
  assert.equal(plan.primaryIsBefore, true);
  assert.equal(plan.primary.org.structuralHealth, 3);
  assert.equal(plan.contrast.org.structuralHealth, 7);
  // The contrast twin differs ONLY in structuralHealth.
  const a = JSON.parse(JSON.stringify(plan.primary));
  const b = JSON.parse(JSON.stringify(plan.contrast));
  a.org.structuralHealth = 0;
  b.org.structuralHealth = 0;
  assert.deepEqual(a, b);
  // The AI-off twin differs ONLY in the injection block.
  assert.deepEqual(plan.aiOff.org.aiInjection, { enabled: false, atStep: 0 });
  const c = JSON.parse(JSON.stringify(plan.aiOff));
  c.org.aiInjection = a.org.aiInjection = { enabled: false, atStep: 0 };
  assert.deepEqual(a, { ...c, org: { ...c.org, structuralHealth: 0 } });
});

test('contrast pole: fragile orgs get SH 7, healthy orgs get SH 3', () => {
  assert.equal(contrastStructuralHealth(3), 7);
  assert.equal(contrastStructuralHealth(5), 7);
  assert.equal(contrastStructuralHealth(6), 3);
  assert.equal(contrastStructuralHealth(10), 3);
});

test('no AI-off twin when the injection is inactive (disabled, or beyond the horizon)', () => {
  const config = landingConfig();
  config.org.aiInjection.enabled = false;
  const plan = buildRunPlan(config);
  assert.equal(plan.aiOff, null);
  assert.equal(plan.runCount, 2);

  const late = landingConfig();
  late.org.aiInjection.atStep = late.horizon; // never fires
  assert.equal(hasActiveAiInjection(late), false);
  assert.equal(buildRunPlan(late).aiOff, null);
});

test('replay machinery rides along into every twin unchanged', () => {
  const config = landingConfig();
  config.replay = true;
  config.paramOverrides = { someParam: 1.5 };
  const plan = buildRunPlan(config);
  for (const twin of [plan.primary, plan.contrast, plan.aiOff]) {
    assert.equal(twin.replay, true);
    assert.deepEqual(twin.paramOverrides, { someParam: 1.5 });
  }
});

test('deltaSeries is the pointwise p50 difference (MODEL.md §7.1)', () => {
  const a = [
    { t: 0, p10: 0, p50: 10, p90: 0 },
    { t: 1, p10: 0, p50: 12, p90: 0 },
  ];
  const b = [
    { t: 0, p10: 0, p50: 4, p90: 0 },
    { t: 1, p10: 0, p50: 13, p90: 0 },
  ];
  assert.deepEqual(deltaSeries(a, b), [
    { t: 0, v: 6 },
    { t: 1, v: -1 },
  ]);
  assert.equal(finalP50(a), 12);
  assert.equal(maxP90([[{ p90: 3 }, { p90: 9 }], [{ p90: 7 }]]), 9);
});

test('band crossings follow n(t) = round(start + growth·t) against the marker centers', () => {
  const config = { horizon: 120, org: { headcountStart: 12, headcountGrowthPerStep: 0.5 } };
  assert.equal(headcountAt(config, 0), 12);
  assert.equal(headcountAt(config, 10), 17);
  const crossings = computeBandCrossings(config, [5, 15, 50, 150]);
  // 5 already crossed at t=0 → excluded; 15 first at round(12+0.5t)>=15 → t=5
  // (14.5 rounds half-up to 15); 50 at t=75 (49.5 rounds half-up to 50).
  assert.deepEqual(
    crossings.map((c) => [c.center, c.t]),
    [
      [15, 5],
      [50, 75],
    ],
  );
  // Static org: no crossings ever.
  assert.deepEqual(computeBandCrossings({ horizon: 60, org: { headcountStart: 40, headcountGrowthPerStep: 0 } }, [5, 15, 50, 150]), []);
});

// ---- org controls -----------------------------------------------------------------

test('applyOrgValue sets simple fields and strips replay machinery (authoring mode, CONTRACTS §4)', () => {
  const config = landingConfig();
  config.replay = true;
  config.paramOverrides = { x: 1 };
  const next = applyOrgValue(config, 'structuralHealth', 8);
  assert.equal(next.org.structuralHealth, 8);
  assert.equal('replay' in next, false);
  assert.equal('paramOverrides' in next, false);
  // input untouched (immutability)
  assert.equal(config.org.structuralHealth, 3);
  assert.equal(config.replay, true);
});

test('ownershipLayers resize keeps layerTypes/layerOwnerCount consistent with validate()', () => {
  const config = landingConfig();
  config.org.ownershipLayers = 3;
  config.org.layerTypes = ['humanPm', 'aiAgent', 'humanPm'];
  config.org.layerOwnerCount = [1, 3, 1];

  const shrunk = applyOrgValue(config, 'ownershipLayers', 2);
  assert.deepEqual(shrunk.org.layerTypes, ['humanPm', 'aiAgent']);
  assert.deepEqual(shrunk.org.layerOwnerCount, [1, 3]);

  const grown = applyOrgValue(config, 'ownershipLayers', 5);
  assert.deepEqual(grown.org.layerTypes, ['humanPm', 'aiAgent', 'humanPm', 'humanPm', 'humanPm']);
  assert.deepEqual(grown.org.layerOwnerCount, [1, 3, 1, 1, 1]);
});

test('matrix target seat forced back to layerOwnerCount 1 after a resize (§12.1)', () => {
  const config = landingConfig();
  config.org.ownershipLayers = 3;
  config.org.layerOwnerCount = [1, 3, 1];
  config.org.matrix = { enabled: true, tiebreaker: 0.5 };
  const shrunk = applyOrgValue(config, 'ownershipLayers', 2);
  assert.deepEqual(shrunk.org.layerOwnerCount, [1, 1]); // seat 2 had μ=3 → forced to 1
});

test('numeric control values clamp to the MODEL.md §3.3 ranges', () => {
  const config = landingConfig();
  assert.equal(applyOrgValue(config, 'headcountStart', 99999).org.headcountStart, 500);
  assert.equal(applyOrgValue(config, 'headcountStart', 1).org.headcountStart, 4);
  assert.equal(applyOrgValue(config, 'headcountGrowthPerStep', 5).org.headcountGrowthPerStep, 2);
  assert.equal(applyOrgValue(config, 'structuralHealth', 0).org.structuralHealth, 1);
  assert.equal(applyOrgValue(config, 'hierarchyDepth', 7).org.hierarchyDepth, 6);
  const def = CONTROL_DEFS.find((d) => d.id === 'ownershipLayers');
  assert.ok(def);
  assert.equal(clampControlValue(def, 3.7), 4); // integer controls snap
});

test('segmented controls write strings; readOrgValues round-trips every control', () => {
  const config = landingConfig();
  const next = applyOrgValue(config, 'topology', 'federated');
  assert.equal(next.org.topology, 'federated');
  const values = readOrgValues(next);
  for (const def of CONTROL_DEFS) {
    assert.ok(def.id in values, `readOrgValues covers ${def.id}`);
  }
});

test('stripReplay is idempotent on configs without replay fields', () => {
  const config = landingConfig();
  const before = JSON.stringify(config);
  stripReplay(config);
  assert.equal(JSON.stringify(config), before);
});

// ---- presets pinned to disk ---------------------------------------------------------

test('PRESET_REFS matches www/presets/ exactly (fetched, not duplicated)', () => {
  const files = readdirSync(presetsDir).filter((f) => f.endsWith('.json'));
  assert.deepEqual(
    PRESET_REFS.map((r) => `${r.id}.json`).sort(),
    files.sort(),
    'every preset file has exactly one picker entry',
  );
  for (const ref of PRESET_REFS) {
    const preset = JSON.parse(readFileSync(path.join(presetsDir, `${ref.id}.json`), 'utf8'));
    assert.equal(preset.id, ref.id);
    assert.ok(preset.runs[ref.runKey], `${ref.id} has primary run "${ref.runKey}"`);
    const config = primaryRunConfig(preset, ref);
    assert.equal(config.sim, 'org');
    // deep copy, not a reference into the parsed file
    config.org.structuralHealth = -1;
    assert.notEqual(preset.runs[ref.runKey].org.structuralHealth, -1);
  }
  assert.ok(PRESET_REFS.some((r) => r.id === DEFAULT_PRESET_ID));
  assert.equal(DEFAULT_PRESET_ID, 'fasterDysfunction'); // PLAN P5 landing
});

// ---- meaning rules --------------------------------------------------------------------

test('every panel has a meaning rule and returns a non-empty sentence for the landing config', () => {
  const config = landingConfig();
  assert.deepEqual(
    PANEL_IDS.sort(),
    ['communication', 'delta', 'entropy', 'health', 'meetings', 'pane', 'velocity'].sort(),
  );
  for (const id of PANEL_IDS) {
    const text = meaningFor(id, { config, beforeSh: 3, afterSh: 7 });
    assert.ok(text.length > 20, `${id} meaning is a real sentence`);
  }
});

test('meaning rules are BOUND to the config (sentences change when the config changes)', () => {
  const broken = landingConfig(); // SH 3, AI on, meetingHeavy, static
  const healthy = applyOrgValue(broken, 'structuralHealth', 8);
  assert.notEqual(meaningFor('entropy', { config: broken }), meaningFor('entropy', { config: healthy }));
  assert.match(meaningFor('entropy', { config: broken }), /fragile|accelerates/);
  assert.match(meaningFor('entropy', { config: healthy }), /absorbs/);

  const async = applyOrgValue(broken, 'modality', 'asyncFirst');
  assert.match(meaningFor('meetings', { config: broken }), /Meeting-heavy/);
  assert.match(meaningFor('meetings', { config: async }), /Async-first/);

  const noAi = JSON.parse(JSON.stringify(broken));
  noAi.org.aiInjection.enabled = false;
  assert.match(meaningFor('delta', { config: noAi }), /off in this scenario/);
  assert.match(meaningFor('delta', { config: broken, entropyDeltaPeak: 12.3 }), /\+12\.3/);

  const growing = applyOrgValue(broken, 'headcountGrowthPerStep', 0.5);
  assert.match(
    meaningFor('communication', { config: growing, crossings: [{ t: 20, center: 50 }] }),
    /~50 people at step 20/,
  );
  assert.match(meaningFor('communication', { config: broken, crossings: [] }), /holds at 40/);
});

test('velocity meaning names the bottleneck layer from perLayer', () => {
  const config = landingConfig();
  const output = {
    perLayer: [
      { layer: 1, layerType: 'humanPm', utilization: 0.5, bottleneck: false },
      { layer: 2, layerType: 'committee', utilization: 0.93, bottleneck: true },
    ],
  };
  assert.match(meaningFor('velocity', { config, output }), /layer 2 \(committee\) at 93% utilization/);
});

test('health meaning switches on the sign and size of the final health gap', () => {
  const config = landingConfig();
  const mk = (/** @type {number} */ gap) => ({
    series: { healthGap: [{ t: 0, p50: gap }] },
  });
  assert.match(meaningFor('health', { config, output: mk(15) }), /sound-teams-strained-org/);
  assert.match(meaningFor('health', { config, output: mk(-15) }), /teams inside are eroding/);
  assert.match(meaningFor('health', { config, output: mk(2) }), /roughly agree/);
});

// ---- share config normalization ----------------------------------------------------------

test('buildShareConfig stamps the engine modelVersion so same-build shares never banner (P5a note)', async () => {
  const config = landingConfig();
  assert.equal(config.modelVersion, '2.0.0'); // preset authored against 2.0.0
  const output = { modelVersion: '2.1.0', resolvedParams: { a: 1, b: [1, 2] } };
  const shareConfig = buildShareConfig(config, output);
  assert.equal(shareConfig.modelVersion, '2.1.0');
  assert.equal(config.modelVersion, '2.0.0'); // input untouched

  // Round-trip through the frozen codec: replay config carries the flag +
  // the full-set overrides (CONTRACTS §4).
  const encoded = await encodeShare({ config: shareConfig, resolvedParams: output.resolvedParams });
  const payload = await decodeShare(encoded);
  assert.deepEqual(payload.config, shareConfig);
  const replay = buildReplayConfig(payload);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.paramOverrides, output.resolvedParams);
});

// ---- P5 repair-2: band-crossing bound + meaning threshold + branches -----------------------

test('band crossings never annotate beyond the last series index (t in 0..horizon-1)', () => {
  // The series has `horizon` points at t = 0..horizon-1; a crossing reported at
  // t = horizon would annotate off the right edge of the chart. (repair-2 fold)
  const config = { horizon: 10, org: { headcountStart: 10, headcountGrowthPerStep: 1 } };
  // center 19 first crosses at t=9 (= horizon-1, the LAST valid index) → kept.
  // center 20 would first cross at t=10 (= horizon, off the chart) → dropped.
  assert.deepEqual(
    computeBandCrossings(config, [19, 20]).map((c) => [c.center, c.t]),
    [[19, 9]],
  );
});

test('entropy meaning derives the fragile/absorbs boundary from resolvedParams.shRiskThreshold (no hardcoded 4)', () => {
  const config = landingConfig(); // SH 3, AI active
  // With the model threshold (4), SH 3 sits at/below it → fragile.
  assert.match(
    meaningFor('entropy', { config, output: { resolvedParams: { shRiskThreshold: 4 } } }),
    /fragile|accelerates/,
  );
  // Lower the threshold to 2: SH 3 is now ABOVE it → the structure absorbs.
  assert.match(
    meaningFor('entropy', { config, output: { resolvedParams: { shRiskThreshold: 2 } } }),
    /absorbs/,
  );
});

test('delta meaning: a negative peak reads "stays at or below" (structure converted AI to order)', () => {
  const config = landingConfig();
  assert.match(meaningFor('delta', { config, entropyDeltaPeak: -3.2 }), /stays at or below -3\.2/);
});

test('pane meaning drops the AI clause when the pair has no active injection', () => {
  const noAi = landingConfig();
  noAi.org.aiInjection.enabled = false;
  assert.match(meaningFor('pane', { config: noAi, beforeSh: 3, afterSh: 7 }), /no AI in this scenario/);
});

test('velocity meaning omits bottleneck text when no layer is a bottleneck', () => {
  const config = landingConfig();
  const output = { perLayer: [{ layer: 1, layerType: 'humanPm', utilization: 0.4, bottleneck: false }] };
  const text = meaningFor('velocity', { config, output });
  assert.match(text, /speedometer/);
  assert.doesNotMatch(text, /bottleneck is layer/);
});

// ---- P5b-F1: plan/config generation policy (pure decisions) --------------------------------

test('completionPolicy: a matching generation is fresh (arms share); a bumped one is stale (never arms)', () => {
  // A plan captures the generation at start. If it still matches when the plan
  // finishes, the charts describe the config the controls still show → paint +
  // arm share. If the generation advanced (an edit/preset/share-boot bumped it),
  // the completion is STALE → never paint over the current view, never arm share.
  assert.deepEqual(completionPolicy(5, 5), { stale: false, armShare: true });
  const stale = completionPolicy(5, 6);
  assert.equal(stale.stale, true);
  assert.equal(stale.armShare, false);
});

test('MED-1: a compare toggle mid-run stages a generation bump, so the in-flight plan completes stale (compare panel not painted, share not armed)', () => {
  // MED-1: toggling "compare to all-human" during an in-flight run flips the
  // NEXT run's SHAPE (adds/drops the sequential all-human twin), but the
  // in-flight plan captured the OLD shape. Before the fix onCompareToggle only
  // set a status string and did NOT bump the generation, so the plan completed
  // FRESH and painted the compare/legibility panel for the stale shape (the
  // no-twin note under a checked box) while its success status overwrote the
  // "comparison changed — run to update" prompt. The fix routes the compare
  // toggle through the SAME generation guard as a config edit (stagesGeneration
  // mirrors P5b-F1's stageConfigChange bump).
  assert.equal(stagesGeneration('compareToggle'), true, 'a compare toggle stages a generation bump (MED-1)');
  assert.equal(stagesGeneration('edit'), true);
  assert.equal(stagesGeneration('preset'), true);
  assert.equal(stagesGeneration('shareBoot'), true);
  assert.equal(stagesGeneration('run'), false, 'a plain Run/Cancel toggle stages nothing');

  // Model runAll's guard end to end: a plan captures the generation at start; a
  // mid-run compare toggle bumps it; the completion is then STALE, so runAll
  // skips paintResults — the sole caller of configurator.renderRun(primary,
  // twin) — and never arms share.
  let generation = 7;
  const planGeneration = generation; // runAll captures at plan start
  if (stagesGeneration('compareToggle')) generation += 1; // onCompareToggle bumps
  const decision = completionPolicy(planGeneration, generation);
  assert.equal(decision.stale, true, 'the in-flight plan is stale after a compare toggle → compare panel not painted for the stale shape');
  assert.equal(decision.armShare, false, 'a stale compare-toggled completion never arms share');

  // Contrast: with no compare toggle the generation is unchanged, so a normal
  // completion is fresh and DOES paint + arm (the byte-identical landing path).
  const fresh = completionPolicy(3, 3);
  assert.deepEqual(fresh, { stale: false, armShare: true });
});

test('decision 6: a preset pick auto-runs after a mid-run cancel; a plain edit / Run-toggle never auto-runs', () => {
  // The busy-path bug the reconciliation documented: a preset chip clicked
  // mid-run cancelled the in-flight plan and returned WITHOUT re-running, so the
  // declared "preset chip auto-runs" decision was violated. Only a preset pick
  // schedules an auto-rerun; a control edit stages config silently and a
  // Run/Cancel click is a plain toggle.
  assert.equal(autoRunsOnInteraction('preset'), true);
  assert.equal(autoRunsOnInteraction('edit'), false);
  assert.equal(autoRunsOnInteraction('run'), false);
});

test('pane heading names AI only when the pair actually has an active injection', () => {
  const noAi = landingConfig();
  noAi.org.aiInjection.enabled = false;
  assert.equal(paneHeading(landingConfig()), 'Same org, same AI — structure decides');
  assert.equal(paneHeading(noAi), 'Same org — structure decides');
});
