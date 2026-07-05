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

/** A Faster-Dysfunction-like snapshot: broken org, active AI at step 15. */
function fdSnapshot() {
  const N = 50;
  return {
    scenarioLabel: 'Faster Dysfunction',
    beforeSh: 3,
    afterSh: 7,
    primarySh: 3,
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
