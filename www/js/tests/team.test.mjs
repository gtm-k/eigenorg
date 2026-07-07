// P7b team core (ui/team.js) — pure projections pinned against REAL committed
// team run outputs (fixtures/team.*.output.json, generated from the frozen wasm)
// and the real team preset configs. No DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  TEAM_FUNCTIONS,
  rosterCounts,
  workMix,
  reviewCapacity,
  demandingSharePct,
  highStakesSharePct,
  teamSetupChips,
  teamPrecisSentence,
  functionCoverageRows,
  coverageSummary,
  qualityHistogramModel,
  teamRunStats,
  configWithRoster,
  applyTeamField,
} from '../ui/team.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** @param {string} p @returns {any} */
const load = (p) => JSON.parse(readFileSync(path.join(here, p), 'utf8'));

const bhOut = load('fixtures/team.balancedHybrid.output.json');
const rbOut = load('fixtures/team.reviewBottleneck.output.json');
const bhCfg = load('../../presets/team/balancedHybrid.json').runs.main;
const rbCfg = load('../../presets/team/reviewBottleneck.json').runs.bottleneck;

// ---- roster reads --------------------------------------------------------------

test('rosterCounts classifies the balancedHybrid roster (who works / who reviews)', () => {
  const c = rosterCounts(bhCfg);
  assert.equal(c.total, 7);
  assert.equal(c.humans, 5);
  assert.equal(c.ai, 2);
  assert.equal(c.workers, 4); // eng1, eng2, aiExec1, aiExec2 cover execution
  assert.equal(c.humanWorkers, 2);
  assert.equal(c.aiWorkers, 2);
  assert.equal(c.reviewers, 2); // rev, dir cover review
});

test('workMix picks the dominant mix by comparison (no float literal) + integer percents', () => {
  const m = workMix(bhCfg); // 0.6 / 0.25 / 0.15
  assert.equal(m.label, 'mostly routine work');
  assert.equal(m.routinePct, 60);
  assert.equal(m.complexPct, 25);
  assert.equal(m.novelPct, 15);
  // Equal fractions → the neutral "balanced" label.
  const balanced = workMix({ team: { workStream: { mix: { routine: 1, complex: 1, novel: 1 } } } });
  assert.equal(balanced.label, 'balanced work');
});

test('reviewCapacity reads bounded vs unbounded', () => {
  assert.deepEqual(reviewCapacity(bhCfg), { bounded: false, perStep: null, label: 'no review limit' });
  const rb = reviewCapacity(rbCfg);
  assert.equal(rb.bounded, true);
  assert.equal(rb.perStep, 1);
  assert.equal(rb.label, '1 reviewed / step');
});

test('work-stream dial readers report the demanding + high-stakes shares (F2)', () => {
  // bh: routine 0.6 / complex 0.25 / novel 0.15 → 40% demanding; highStakesShare 0.2 → 20%.
  assert.equal(demandingSharePct(bhCfg), 40);
  assert.equal(highStakesSharePct(bhCfg), 20);
  // reviewBottleneck: routine 0.8 / complex 0.15 / novel 0.05 → 20% demanding.
  assert.equal(demandingSharePct(rbCfg), 20);
  // Absent highStakesShare reads as 0, never NaN.
  assert.equal(highStakesSharePct({ team: { workStream: { mix: { routine: 1, complex: 0, novel: 0 } } } }), 0);
});

// ---- setup digest + précis -----------------------------------------------------

test('teamSetupChips leads with the scenario and carries the SH + work-split chips', () => {
  const chips = teamSetupChips(bhCfg, 'Balanced hybrid');
  assert.equal(chips[0].label, 'Team');
  assert.equal(chips[0].value, 'Balanced hybrid');
  const sh = chips.find((c) => c.label === 'Structural Health');
  assert.equal(sh?.value, '7 of 10');
  const work = chips.find((c) => c.label === 'Doing the work');
  assert.equal(work?.value, '2 human · 2 AI');
  // The high-stakes share is surfaced when the setup is collapsed (F2 — the dial
  // value stays observable, not only editable).
  const stakes = chips.find((c) => c.label === 'High-stakes');
  assert.equal(stakes?.value, '20% high-stakes');
});

test('teamPrecisSentence emphasises the team size + composition (bold value segments)', () => {
  const parts = teamPrecisSentence(bhCfg);
  const values = parts.filter((p) => p.value).map((p) => p.text);
  assert.ok(values.includes('7-person team'));
  assert.ok(values.some((v) => v.includes('doing the work')));
  assert.equal(parts.at(-1)?.text, '.');
});

// ---- run-output projections ----------------------------------------------------

test('functionCoverageRows returns the 7 functions in order with real ratings/scores', () => {
  const rows = functionCoverageRows(bhOut);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.id), TEAM_FUNCTIONS.map((f) => f.id));
  const exec = rows.find((r) => r.id === 'execution');
  assert.equal(exec?.rating, 'green');
  assert.equal(exec?.scorePct, 100);
  assert.equal(exec?.word, 'covered');
  const synth = rows.find((r) => r.id === 'synthesis');
  assert.equal(synth?.rating, 'red');
  assert.equal(synth?.scorePct, 0);
  assert.equal(synth?.word, 'gap');
  const amb = rows.find((r) => r.id === 'ambiguityResolution');
  assert.equal(amb?.scorePct, 46); // 0.46 → 46%
});

test('coverageSummary counts covered vs gaps + names the gaps in render order', () => {
  const cov = coverageSummary(bhOut);
  assert.equal(cov.total, 7);
  assert.equal(cov.covered, 5);
  assert.equal(cov.gaps, 2);
  assert.deepEqual(cov.gapLabels, ['Connecting the pieces', 'Untangling the unclear']);
});

test('qualityHistogramModel totals the bins + finds the median quality bin', () => {
  const q = qualityHistogramModel(bhOut);
  assert.equal(q.bins.length, 10);
  assert.equal(q.total, 24287); // 1943 + 13593 + 8751
  assert.equal(q.medianBinLo, 80); // cumulative crosses half in the 80–90 bin
  const pctSum = q.bins.reduce((s, b) => s + b.pct, 0);
  assert.ok(pctSum >= 99 && pctSum <= 101); // integer-rounded percents ≈ 100
});

test('teamRunStats reads settled series (balancedHybrid: unbounded review, no breakage)', () => {
  const s = teamRunStats(bhOut);
  assert.equal(s.shipped, 49); // cumThroughput final p50
  assert.equal(Math.round(Number(s.cohesion)), 71);
  assert.equal(s.coordinationTaxPct, 13); // round(0.1339 × 100)
  assert.equal(s.reviewWaitDays, 1);
  assert.equal(Math.round(Number(s.decisionLatencyDays)), 2); // decisionLatencyRoutine final p50 — the recovery-cost read (F3)
  assert.equal(s.brittleness, 0);
  assert.equal(s.coverage.gaps, 2);
});

test('teamRunStats surfaces the review bottleneck (reviewBottleneck: queue binds, wait rises)', () => {
  const s = teamRunStats(rbOut);
  assert.ok(s.reviewWaitDays !== null && s.reviewWaitDays > 1, 'review wait should have risen above the unbounded floor');
  // reviewQueueDepth final p50 is the queue signal.
  const q = rbOut.series.reviewQueueDepth.at(-1).p50;
  assert.ok(q > 0, 'a bound review capacity grows the queue');
});

// ---- guarded roster edit (composer polish precondition) ------------------------

test('configWithRoster strips replay + keeps recoveryOwner valid', () => {
  const withReplay = { ...bhCfg, replay: true, paramOverrides: { qualityBase: 1 } };
  const dropDir = bhCfg.team.entities.filter((/** @type {any} */ e) => e.id !== 'dir');
  const next = configWithRoster(withReplay, dropDir);
  assert.equal(next.replay, undefined);
  assert.equal(next.paramOverrides, undefined);
  assert.equal(next.team.entities.length, 6);
  assert.equal(next.team.recoveryOwner, 'pm'); // pm survived → owner unchanged

  // Removing the recovery owner re-points to the first surviving entity.
  const dropPm = bhCfg.team.entities.filter((/** @type {any} */ e) => e.id !== 'pm');
  const next2 = configWithRoster(bhCfg, dropPm);
  assert.equal(next2.team.recoveryOwner, dropPm[0].id);
  assert.notEqual(next2.team.recoveryOwner, 'pm');
});

// ---- round-2 repair-2 pins (dial read-back + mix sum + non-finite guards) -------

const ALL_TEAM_PRESETS = [
  'allHumanBaseline.json',
  'autonomousSquad.json',
  'balancedHybrid.json',
  'hollowMiddle.json',
  'reviewBottleneck.json',
].map((f) => /** @type {any} */ (Object.values(load(`../../presets/team/${f}`).runs)[0]));

test('mix dial round-trips EXACTLY for every preset x every integer percent (round-2 MED pin: "101%" read-back)', () => {
  for (const cfg of ALL_TEAM_PRESETS) {
    for (let v = 0; v <= 100; v += 1) {
      const next = applyTeamField(cfg, 'mix', v);
      assert.equal(demandingSharePct(next), v, `read-back != dial at v=${v}`);
    }
  }
});

test('mix fractions stay non-negative and sum to 1 within 1 ulp for every preset x dial value (round-2 Codex pin)', () => {
  for (const cfg of ALL_TEAM_PRESETS) {
    for (let v = 0; v <= 100; v += 1) {
      const m = applyTeamField(cfg, 'mix', v).team.workStream.mix;
      const sum = m.routine + m.complex + m.novel;
      assert.ok(Math.abs(sum - 1) <= Number.EPSILON, `sum drift ${sum - 1} at v=${v}`);
      assert.ok(m.routine >= 0 && m.complex >= 0 && m.novel >= 0, `negative fraction at v=${v}`);
    }
  }
});

test('non-finite mix / highStakesShare edits keep the previous values (the reviewCapacity guard pattern)', () => {
  const cfg = ALL_TEAM_PRESETS[2]; // balancedHybrid
  for (const bad of [NaN, Infinity, -Infinity, 'oops']) {
    const m = applyTeamField(cfg, 'mix', /** @type {any} */ (bad));
    assert.deepEqual(m.team.workStream.mix, cfg.team.workStream.mix, `mix mutated by ${bad}`);
    const h = applyTeamField(cfg, 'highStakesShare', /** @type {any} */ (bad));
    assert.equal(h.team.workStream.highStakesShare, cfg.team.workStream.highStakesShare, `stakes mutated by ${bad}`);
  }
});
