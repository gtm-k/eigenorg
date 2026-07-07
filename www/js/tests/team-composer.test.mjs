// P7b team composer (ui/team.js composer edits) — the pure, validate()-safe
// transforms behind the tap-to-assign UI. Every produced config is validated
// against the REAL config JSON schema (ajv) so a composed team can never emit an
// off-schema config (deny_unknown_fields, capabilities ⊆ functions, entity
// bounds, recoveryOwner back-ref, modality enum).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';

import {
  buildCatalog,
  addEntity,
  removeEntity,
  applyTeamField,
  roleOf,
  archetypeLabel,
  entitiesOf,
  MAX_ENTITIES,
} from '../ui/team.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
/** @param {string} rel @returns {any} */
const loadPreset = (rel) => JSON.parse(readFileSync(path.join(repoRoot, 'www', 'presets', 'team', rel), 'utf8'));

const bh = loadPreset('balancedHybrid.json').runs.main;
const allHuman = loadPreset('allHumanBaseline.json').runs.main;
const squad = loadPreset('autonomousSquad.json').runs.main;
const hollow = loadPreset('hollowMiddle.json').runs.hollow;
const bottleneck = loadPreset('reviewBottleneck.json').runs.bottleneck;
const catalog = buildCatalog([bh, allHuman, squad, hollow, bottleneck]);

const ajv = new Ajv({ allErrors: true, strict: false });
const validateConfig = ajv.compile(JSON.parse(readFileSync(path.join(repoRoot, 'docs', 'schema', 'config.v1.schema.json'), 'utf8')));
/** @param {any} config @param {string} msg */
function assertValid(config, msg) {
  const ok = validateConfig(config);
  assert.ok(ok, `${msg}: ${ajv.errorsText(validateConfig.errors)}`);
}

// ---- catalog -------------------------------------------------------------------

test('buildCatalog collects one template per archetype across the presets', () => {
  const archetypes = catalog.map((c) => c.archetype).sort();
  // Across the five presets: pm, engineer, aiExecution, reviewer, director.
  for (const expected of ['pm', 'engineer', 'aiExecution', 'reviewer', 'director']) {
    assert.ok(archetypes.includes(expected), `catalog missing ${expected}`);
  }
  for (const seat of catalog) {
    assert.ok(seat.template && typeof seat.template.throughput === 'number', 'template carries preset-sourced numbers');
    assert.ok(['human', 'ai'].includes(seat.kind));
    assert.ok(seat.label.length > 0);
  }
});

test('archetypeLabel humanises known + unknown archetypes', () => {
  assert.equal(archetypeLabel('aiExecution'), 'AI executor');
  assert.equal(archetypeLabel('engineer'), 'Engineer');
  assert.equal(archetypeLabel('someNewArchetype'), 'Some New Archetype');
});

test('roleOf buckets by who-does-what', () => {
  const byId = Object.fromEntries(entitiesOf(bh).map((e) => [e.id, e]));
  assert.equal(roleOf(byId.eng1), 'work'); // execution
  assert.equal(roleOf(byId.rev), 'review'); // review, no execution
  assert.equal(roleOf(byId.pm), 'lead'); // neither execution nor review
});

// ---- addEntity -----------------------------------------------------------------

test('addEntity clones a template with a fresh id and stays schema-valid', () => {
  const engineerSeat = catalog.find((c) => c.archetype === 'engineer');
  assert.ok(engineerSeat);
  const before = entitiesOf(bh).length;
  const next = addEntity(bh, engineerSeat.template);
  assert.equal(entitiesOf(next).length, before + 1);
  const ids = entitiesOf(next).map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids stay unique');
  assertValid(next, 'a composed roster (added engineer) validates');
});

test('addEntity refuses to exceed the roster maximum', () => {
  const seat = catalog.find((c) => c.archetype === 'engineer');
  assert.ok(seat);
  let cfg = bh;
  // Grow to MAX_ENTITIES.
  while (entitiesOf(cfg).length < MAX_ENTITIES) {
    const grown = addEntity(cfg, seat.template);
    assert.ok(grown, 'should add until the max');
    cfg = grown;
  }
  assert.equal(entitiesOf(cfg).length, MAX_ENTITIES);
  assert.equal(addEntity(cfg, seat.template), null, 'no add past the maximum');
});

// ---- removeEntity --------------------------------------------------------------

test('removeEntity drops a member and stays schema-valid; re-points recoveryOwner', () => {
  const next = removeEntity(bh, 'dir');
  assert.ok(next);
  assert.ok(!entitiesOf(next).some((e) => e.id === 'dir'));
  assert.equal(next.team.recoveryOwner, 'pm'); // pm survived
  assertValid(next, 'a composed roster (removed reviewer) validates');

  // Removing the recovery owner re-points to a survivor and stays valid.
  const droppedOwner = removeEntity(bh, 'pm');
  assert.ok(droppedOwner);
  assert.notEqual(droppedOwner.team.recoveryOwner, 'pm');
  assert.ok(entitiesOf(droppedOwner).some((e) => e.id === droppedOwner.team.recoveryOwner));
  assertValid(droppedOwner, 'recovery-owner re-point validates');
});

test('removeEntity guards the minimum roster + at-least-one-worker', () => {
  // Reduce a two-person team → null (min 2).
  const twoPerson = { ...allHuman, team: { ...allHuman.team, entities: entitiesOf(allHuman).slice(0, 2) } };
  // twoPerson may or may not have execution in the first 2; test the min guard on a real 2-entity roster.
  const minGuarded = removeEntity(twoPerson, entitiesOf(twoPerson)[0].id);
  assert.equal(minGuarded, null, 'cannot drop below two entities');

  // Removing every execution entity is refused (someone must do the work).
  let cfg = bh;
  for (const e of entitiesOf(bh).filter((x) => x.functions.includes('execution'))) {
    const attempt = removeEntity(cfg, e.id);
    if (attempt === null) {
      // The guard fired before we removed the last worker — acceptable.
      break;
    }
    cfg = attempt;
  }
  assert.ok(entitiesOf(cfg).some((e) => e.functions.includes('execution')), 'a worker always remains');
});

// ---- applyTeamField ------------------------------------------------------------

test('applyTeamField clamps SH to an integer 1–10 and stays valid', () => {
  assert.equal(applyTeamField(bh, 'structuralHealth', 0).team.structuralHealth, 1);
  assert.equal(applyTeamField(bh, 'structuralHealth', 15).team.structuralHealth, 10);
  assert.equal(applyTeamField(bh, 'structuralHealth', 7).team.structuralHealth, 7);
  assertValid(applyTeamField(bh, 'structuralHealth', 3), 'SH edit validates');
});

test('applyTeamField sets review capacity (null or integer ≥1) and stays valid', () => {
  const unbounded = applyTeamField(bottleneck, 'reviewCapacityPerStep', null);
  assert.equal(unbounded.team.reviewCapacityPerStep, null);
  assertValid(unbounded, 'unbounded review validates');
  const bounded = applyTeamField(bh, 'reviewCapacityPerStep', 2);
  assert.equal(bounded.team.reviewCapacityPerStep, 2);
  assertValid(bounded, 'bounded review validates');
});

test('applyTeamField switches modality within the enum and ignores off-enum values', () => {
  const meeting = applyTeamField(bh, 'modality', 'meetingHeavy');
  assert.equal(meeting.team.modality, 'meetingHeavy');
  assertValid(meeting, 'modality edit validates');
  const ignored = applyTeamField(bh, 'modality', 'nonsense');
  assert.equal(ignored.team.modality, bh.team.modality, 'off-enum modality is ignored');
});

test('applyTeamField strips replay/paramOverrides (authoring discipline)', () => {
  const withReplay = { ...bh, replay: true, paramOverrides: { qualityBase: 1 } };
  const next = applyTeamField(withReplay, 'structuralHealth', 5);
  assert.equal(next.replay, undefined);
  assert.equal(next.paramOverrides, undefined);
});

// ---- work-stream dials (F2: mix + high-stakes — the brittleness stressor) -------

/** @param {any} config @param {string} msg Assert the mix sums to 1 (engine tol +/-0.001) with non-negative fractions. */
function assertMixValid(config, msg) {
  const m = config.team.workStream.mix;
  const sum = m.routine + m.complex + m.novel;
  assert.ok(Math.abs(sum - 1) <= 0.001, `${msg}: mix sums to ${sum}, not 1`);
  assert.ok(m.routine >= 0 && m.complex >= 0 && m.novel >= 0, `${msg}: fractions must be non-negative`);
}

test('applyTeamField mix sets the demanding (complex+novel) share; routine takes the rest, sum stays 1', () => {
  // bh mix: routine 0.6, complex 0.25, novel 0.15 → 40% demanding by default.
  const next = applyTeamField(bh, 'mix', 60); // push demanding to 60%
  assert.equal(Math.round(next.team.workStream.mix.routine * 100), 40);
  // The complex:novel ratio (0.25:0.15) is preserved through the redistribution.
  const m = next.team.workStream.mix;
  assert.ok(Math.abs(m.complex / (m.complex + m.novel) - 0.25 / 0.4) < 1e-9, 'complex:novel ratio preserved');
  assertMixValid(next, '60% demanding');
  assertValid(next, 'a demanding-share edit validates against the real schema');
});

test('applyTeamField mix clamps 0..100 and stays valid at both extremes', () => {
  const allRoutine = applyTeamField(bh, 'mix', -10);
  assert.deepEqual(allRoutine.team.workStream.mix, { routine: 1, complex: 0, novel: 0 });
  assertMixValid(allRoutine, 'clamped low');
  assertValid(allRoutine, 'all-routine validates');

  const allDemanding = applyTeamField(bh, 'mix', 150);
  assert.equal(allDemanding.team.workStream.mix.routine, 0);
  assertMixValid(allDemanding, 'clamped high');
  assertValid(allDemanding, 'all-demanding validates');
});

test('applyTeamField highStakesShare sets an integer-percent → 0..1 fraction, clamped + valid', () => {
  const s = applyTeamField(bh, 'highStakesShare', 35);
  assert.equal(s.team.workStream.highStakesShare, 35 / 100);
  assertValid(s, 'a high-stakes edit validates');
  assert.equal(applyTeamField(bh, 'highStakesShare', 150).team.workStream.highStakesShare, 1);
  assert.equal(applyTeamField(bh, 'highStakesShare', -5).team.workStream.highStakesShare, 0);
});

test('applyTeamField mix strips replay/paramOverrides (authoring discipline)', () => {
  const withReplay = { ...bh, replay: true, paramOverrides: { qualityBase: 1 } };
  const next = applyTeamField(withReplay, 'mix', 50);
  assert.equal(next.replay, undefined);
  assert.equal(next.paramOverrides, undefined);
});
