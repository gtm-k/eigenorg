// P7b team result card (ui/team-card.js) — the PURE card model, pinned against a
// real committed team output. The canvas renderer + share ladder are browser-only
// (Playwright/manual); this covers the model that drives them. INT-1 is asserted
// structurally: the model carries NO share-link / url field — team = card-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { teamCardModel } from '../ui/team-card.js';
import { encodeShare, ShareUrlError } from '../url-codec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
const bhOut = JSON.parse(readFileSync(path.join(here, 'fixtures/team.balancedHybrid.output.json'), 'utf8'));
const params = JSON.parse(readFileSync(path.join(repoRoot, 'model', 'params.json'), 'utf8'));
const teamCfg = JSON.parse(readFileSync(path.join(repoRoot, 'www', 'presets', 'team', 'balancedHybrid.json'), 'utf8')).runs.main;

/** The full effective coefficient set (mirrors the engine's resolvedParams). @param {any} config */
function fullResolvedParams(config) {
  /** @type {Record<string, number | number[]>} */
  const resolved = {};
  for (const p of params.parameters) resolved[p.id] = p.value;
  Object.assign(resolved, config.paramOverrides ?? {});
  return resolved;
}

test('teamCardModel builds a 1200×628 card whose headline leads with coverage (human units)', () => {
  const model = teamCardModel({ scenarioLabel: 'Balanced hybrid', output: bhOut });
  assert.equal(model.width, 1200);
  assert.equal(model.height, 628);
  assert.equal(model.eyebrow, 'Balanced hybrid');
  assert.equal(model.headline, '5 of 7 essential jobs covered');
  assert.equal(model.cells.length, 7);
  assert.match(model.meta, /model v2\.2\.0/);
  assert.match(model.meta, /seed 42/);
  assert.ok(model.framing.length > 0);
});

test('teamCardModel stat chips are all run-derived (shipped / quality / trust / fragility)', () => {
  const model = teamCardModel({ scenarioLabel: 'Balanced hybrid', output: bhOut });
  const byLabel = Object.fromEntries(model.stats.map((/** @type {any} */ s) => [s.label, s.value]));
  assert.equal(byLabel['Work shipped'], '49 items');
  assert.equal(byLabel['Typical quality'], '80–90'); // median completed-quality bin
  assert.equal(byLabel['Team trust'], '71/100');
  assert.equal(byLabel['Fragility'], '0 breaks'); // no breakage on the healthy hybrid
});

test('teamCardModel subhead names the coverage gaps (non-judgmental register)', () => {
  const model = teamCardModel({ scenarioLabel: 'Balanced hybrid', output: bhOut });
  assert.match(model.subhead, /Connecting the pieces/);
  assert.match(model.subhead, /Untangling the unclear/);
  assert.match(model.subhead, /stalls|degrades/);
  assert.doesNotMatch(model.subhead, /broken|sick/i); // never the shaming register
});

test('INT-1: the team card model carries no share-link / url field (card is the only team share)', () => {
  const model = teamCardModel({ scenarioLabel: 'Balanced hybrid', output: bhOut });
  const keys = Object.keys(model);
  for (const forbidden of ['shareUrl', 'url', 'link', 'replay', 'fragment']) {
    assert.ok(!keys.includes(forbidden), `team card model must not carry "${forbidden}" (INT-1)`);
  }
});

test('INT-1 round-trip: a team share LINK overflows the URL budget → ShareUrlError("budget")', async () => {
  // The team-scoped round-trip that does NOT inherit the org <2000 assertion: a
  // real team preset config + its FULL resolvedParams (the replay contract
  // requires resolvedParams embedded in full, so compression cannot help) exceeds
  // the 2000-char fragment budget, so a team link cannot be minted — which is the
  // empirical basis for "team = card, org = card + link" (INT-1).
  await assert.rejects(
    encodeShare({ config: teamCfg, resolvedParams: fullResolvedParams(teamCfg) }),
    (/** @type {any} */ err) => {
      assert.ok(err instanceof ShareUrlError, 'a budget overflow is a typed ShareUrlError');
      assert.equal(err.code, 'budget');
      return true;
    },
  );
});

test('a full-coverage output reads "7 of 7" with the makeup-holds subhead', () => {
  // Synthetic (allowed: test fixture) full-coverage block over the same series.
  const full = {
    ...bhOut,
    functionCoverage: Object.fromEntries(
      Object.keys(bhOut.functionCoverage).map((k) => [k, { score: 1, rating: 'green' }]),
    ),
  };
  const model = teamCardModel({ scenarioLabel: 'All covered', output: full });
  assert.equal(model.headline, '7 of 7 essential jobs covered');
  assert.match(model.subhead, /holds together/);
});
