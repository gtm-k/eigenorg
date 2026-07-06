// P8 output/share card — pure card MODEL tests (the canvas render + download +
// share paths are covered by the Playwright acceptance probe). Pins the §3.5
// human-units rules: decision latency in working days LEADS, entropy never
// does, and the Faster-Dysfunction story shows BOTH the throughput-up seduction
// and the dysfunction-up cost.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cardModel,
  cardHeadline,
  canShareFiles,
  downloadAttributeSupported,
  CARD_WIDTH,
  CARD_HEIGHT,
  HEADLINE_FONT_PX,
  STAT_VALUE_FONT_PX,
} from '../share/card.js';

/** Build a tidy percentile series t=0..n-1 from a p50 function.
 * @param {number} n @param {(t: number) => number} p50Fn @returns {any[]} */
function series(n, p50Fn) {
  return Array.from({ length: n }, (_, t) => {
    const p50 = p50Fn(t);
    return { t, p10: p50, p50, p90: p50 + 2 };
  });
}

/** A Faster-Dysfunction-like snapshot: strained org (SH below threshold), active AI at step 15. */
function fdSnapshot() {
  const N = 50;
  return {
    scenarioLabel: 'Faster Dysfunction',
    beforeSh: 3,
    afterSh: 7,
    primarySh: 3,
    shRiskThreshold: 4, // from resolvedParams: primarySh 3 <= 4 → fragile structure
    beforeEntropy: series(N, (t) => 30 + t),
    afterEntropy: series(N, () => 28),
    decisionLatency: series(N, (t) => 10 + t / 3), // final p50 ≈ 26.3
    throughput: series(N, (t) => (t < 15 ? 2 : 3)), // post-injection window higher
    coordinationTax: series(N, () => 0.31),
    entropy: series(N, (t) => 30 + t), // rises after injection
    aiActive: true,
    injectStep: 15,
    aiOffThroughput: series(N, () => 2),
    aiOffEntropy: series(N, () => 30),
    modelVersion: '2.1.0',
    seed: 42,
  };
}

/**
 * A high-Structural-Health AI run where AI HELPS: SH is above the risk threshold
 * and entropy does NOT rise after the injection (M9 guardrail + coordination
 * relief). The subhead must NOT claim faster dysfunction on this run.
 */
function highShSnapshot() {
  const N = 50;
  return {
    ...fdSnapshot(),
    scenarioLabel: 'AI adoption',
    beforeSh: 3,
    afterSh: 9,
    primarySh: 9, // above shRiskThreshold (4) → structure is not fragile
    entropy: series(N, () => 40), // flat: entropy does NOT rise after AI
  };
}

test('card is EXACTLY 1200×628 and the headline leads with decision latency in working days', () => {
  const m = cardModel(fdSnapshot());
  assert.equal(m.width, CARD_WIDTH);
  assert.equal(m.height, CARD_HEIGHT);
  assert.equal(m.width, 1200);
  assert.equal(m.height, 628);
  assert.match(m.headline, /working days/);
  assert.match(m.headline, /\d/);
});

test('entropy is NEVER the lead metric (§3.5) — the headline names days, not entropy', () => {
  const m = cardModel(fdSnapshot());
  assert.ok(!/entropy/i.test(m.headline), `headline must not lead with entropy: "${m.headline}"`);
});

test('the Faster-Dysfunction card shows BOTH throughput-up AND dysfunction-up (fdSeductiveThroughput)', () => {
  const m = cardModel(fdSnapshot());
  const labels = m.stats.map((/** @type {any} */ s) => s.label);
  assert.ok(labels.includes('Throughput after AI'), 'a throughput chip must be present');
  assert.ok(labels.includes('Entropy after AI'), 'an entropy chip must be present');
  const tp = m.stats.find((/** @type {any} */ s) => s.label === 'Throughput after AI');
  const ent = m.stats.find((/** @type {any} */ s) => s.label === 'Entropy after AI');
  // Both rose: throughput +% (seduction) and entropy + pts (dysfunction).
  assert.match(tp.value, /^\+\d+%$/, `throughput should be up: ${tp.value}`);
  assert.match(ent.value, /^\+\d+ pts$/, `entropy should be up: ${ent.value}`);
});

test('the headline human-unit text is ≥2× the metric-text size', () => {
  assert.ok(HEADLINE_FONT_PX >= 2 * STAT_VALUE_FONT_PX, `${HEADLINE_FONT_PX} !>= 2×${STAT_VALUE_FONT_PX}`);
});

test('a non-AI run drops the after-AI chips and keeps latency as the lead', () => {
  const snap = { ...fdSnapshot(), aiActive: false, injectStep: null };
  const m = cardModel(snap);
  const labels = m.stats.map((/** @type {any} */ s) => s.label);
  assert.ok(!labels.includes('Throughput after AI'));
  assert.ok(labels.includes('Coordination tax'));
  assert.match(m.headline, /working days/);
});

test('the before/after visual carries both Structural-Health poles with a shared y scale', () => {
  const m = cardModel(fdSnapshot());
  assert.equal(m.before.sh, 3);
  assert.equal(m.after.sh, 7);
  assert.ok(m.yMax > 0 && m.yMax <= 100);
  assert.match(m.before.label, /Structural Health 3/);
  assert.match(m.after.label, /Structural Health 7/);
});

test('the framing line is part of the card model (it travels on the PNG — VISION §5)', () => {
  const m = cardModel(fdSnapshot());
  assert.match(m.framing, /thinking aid/);
  assert.match(m.framing, /not a prediction engine/);
});

test('cardHeadline is the single swappable copy string', () => {
  assert.equal(cardHeadline({ latencyDays: 9 }), '9 working days to clear one decision');
});

// ---- MED-4: the AI subhead is DERIVED from the run (never self-contradicting) ----

test('MED-4: the low-SH Faster-Dysfunction run reads the faster-dysfunction subhead', () => {
  const m = cardModel(fdSnapshot());
  assert.match(m.subhead, /faster dysfunction/i);
  assert.match(m.subhead, /more disordered/i);
});

test('MED-4: a high-SH AI run does NOT claim "more disordered" when entropy did not rise', () => {
  const m = cardModel(highShSnapshot());
  assert.ok(!/more disordered/i.test(m.subhead), `high-SH subhead must not claim more disorder: "${m.subhead}"`);
  assert.ok(!/faster dysfunction/i.test(m.subhead), `high-SH subhead must not claim faster dysfunction: "${m.subhead}"`);
  // …and it reads as relief / guardrailed improvement instead.
  assert.match(m.subhead, /in check|absorb|governed/i);
});

test('MED-4: the subhead never contradicts the "Entropy after AI" chip sign', () => {
  const m = cardModel(highShSnapshot());
  const ent = m.stats.find((/** @type {any} */ s) => s.label === 'Entropy after AI');
  assert.ok(ent, 'an entropy chip must be present on an AI run');
  // Flat entropy → chip is not positive, so the subhead must not claim a rise.
  assert.ok(!/^\+[1-9]/.test(ent.value), `entropy chip should not be positive here: ${ent.value}`);
  assert.ok(!/more disordered/i.test(m.subhead));
});

test('MED-4: high SH but entropy rose — names the rise as governed, not dysfunction', () => {
  // fdSnapshot entropy rises, but primarySh 9 is above the threshold → not fragile.
  const m = cardModel({ ...fdSnapshot(), primarySh: 9 });
  assert.ok(!/faster dysfunction/i.test(m.subhead), `not fragile → not dysfunction: "${m.subhead}"`);
  assert.match(m.subhead, /governed|stays/i);
});

test('MED-4: shRiskThreshold is read from the run (no hardcoded threshold) — a missing threshold fails safe', () => {
  // No shRiskThreshold on the snapshot → fragileStructure is false → no over-claim,
  // even though entropy rose. (The card never invents the boundary.)
  const { shRiskThreshold, ...noThreshold } = fdSnapshot();
  void shRiskThreshold;
  const m = cardModel(noThreshold);
  assert.ok(!/faster dysfunction/i.test(m.subhead), `missing threshold must not claim dysfunction: "${m.subhead}"`);
});

// ---- MED-3: export / share feature detection (DOM paths are Playwright-covered) --

test('MED-3: canShareFiles requires share AND canShare to be functions (not canShare alone)', () => {
  const File = function () {};
  assert.equal(canShareFiles({ share() {}, canShare() { return true; } }, File), true);
  // The exact bug: canShare present but share() ABSENT must NOT read as shareable.
  assert.equal(canShareFiles({ canShare() { return true; } }, File), false);
  assert.equal(canShareFiles({ share() {} }, File), false); // canShare absent
  assert.equal(canShareFiles({ share() {}, canShare() {} }, undefined), false); // no File ctor
  assert.equal(canShareFiles(null, File), false);
});

test('MED-3: downloadAttributeSupported detects the <a download> attribute', () => {
  const withDownload = { createElement: () => ({ download: '' }) };
  const withoutDownload = { createElement: () => ({}) };
  assert.equal(downloadAttributeSupported(withDownload), true);
  assert.equal(downloadAttributeSupported(withoutDownload), false); // no download attr → open() fallback
  assert.equal(downloadAttributeSupported(null), false);
});

// ---- MED-5: neutral structural descriptors (BINDING non-judgmental register) -----

test('MED-5: the before/after legend uses neutral descriptors (no "broken"/"healthy")', () => {
  const m = cardModel(fdSnapshot());
  assert.equal(m.before.legend, 'Structural Health 3 (strained)');
  assert.equal(m.after.legend, 'Structural Health 7 (sound)');
  for (const legend of [m.before.legend, m.after.legend]) {
    assert.ok(!/broken|healthy/i.test(legend), `legend must be non-judgmental: "${legend}"`);
  }
});
