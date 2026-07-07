// P7b team preset loader (ui/team-presets.js) — the fetch/normalize/reject paths
// behind the picker. The fetchImpl injection parameter exists for exactly this:
// exercise the failure modes (HTTP error, malformed manifest, unknown runKey)
// that a committed tree makes unreachable but a runtime fetch failure would hit,
// so a load failure is observable (surfaced on the team status line) and never
// silently blank. Plus the off-schema all-null defensive path of teamRunStats.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { fetchTeamManifest, fetchTeamPreset, teamPrimaryRunConfig } from '../ui/team-presets.js';
import { teamRunStats } from '../ui/team.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bhOut = JSON.parse(readFileSync(path.join(here, 'fixtures/team.balancedHybrid.output.json'), 'utf8'));

/** A stub fetch returning a scripted response. @param {{ ok?: boolean, status?: number, json?: any }} r */
function stubFetch(r) {
  return async () => ({ ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json });
}

// ---- loader rejection paths ----------------------------------------------------

test('fetchTeamManifest throws on a non-ok response (HTTP error surfaced, not swallowed)', async () => {
  await assert.rejects(fetchTeamManifest(/** @type {any} */ (stubFetch({ ok: false, status: 500 }))), /HTTP 500/);
});

test('fetchTeamManifest normalizes a malformed manifest (non-array presets → [])', async () => {
  const { refs, defaultId } = await fetchTeamManifest(/** @type {any} */ (stubFetch({ json: { default: 'x', presets: 'nope' } })));
  assert.deepEqual(refs, []);
  assert.equal(defaultId, 'x'); // still reports the declared default id
});

test('fetchTeamPreset throws on a 404 (unknown preset id)', async () => {
  await assert.rejects(fetchTeamPreset('nope', /** @type {any} */ (stubFetch({ ok: false, status: 404 }))), /HTTP 404/);
});

test('teamPrimaryRunConfig throws when the referenced runKey is missing', () => {
  assert.throws(
    () => teamPrimaryRunConfig({ runs: {} }, { id: 'x', runKey: 'main', label: 'X' }),
    /no run "main"/,
  );
});

// ---- teamRunStats defensive all-null path (off-schema output) ------------------

test('teamRunStats returns all-null on an empty series block (never guesses a number)', () => {
  const s = teamRunStats({ series: {}, functionCoverage: {} });
  assert.equal(s.shipped, null);
  assert.equal(s.cohesion, null);
  assert.equal(s.coordinationTaxPct, null);
  assert.equal(s.reviewWaitDays, null);
  assert.equal(s.decisionLatencyDays, null);
  assert.equal(s.brittleness, null);
});

// ---- series contract (chart-wiring rename guard) -------------------------------

test('the team output fixture exposes every series the charts + meaning lines consume', () => {
  // paintTeamResults feeds these series into the 7 charts + the recovery/review
  // meaning lines; a rename in the engine output would silently blank a chart, so
  // pin the exact keys the wiring depends on.
  const consumed = [
    'throughput', 'coordinationTax', 'cohesion', 'cumulativeBrittleness',
    'orgHealthProxy', 'reviewQueueDepth', 'decisionLatencyRoutine',
    'reviewWaitDays', 'cumThroughput',
  ];
  for (const key of consumed) {
    assert.ok(Array.isArray(bhOut.series[key]), `series "${key}" must be present for the team wiring`);
  }
  assert.ok(Array.isArray(bhOut.qualityHistogram), 'qualityHistogram block present');
  assert.ok(bhOut.functionCoverage && typeof bhOut.functionCoverage === 'object', 'functionCoverage block present');
});
