// P7b INT-2 — the committed team preset manifest pins to the files on disk.
// A static Pages host cannot enumerate www/presets/team/ at runtime, so the
// picker reads www/presets/team/manifest.json; this test guarantees the manifest
// and the preset files cannot drift (every surfaced id has a file, every runKey
// exists in that file, and the default names a surfaced preset).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const teamDir = path.join(here, '..', '..', 'presets', 'team');
/** @type {any} */
const manifest = JSON.parse(readFileSync(path.join(teamDir, 'manifest.json'), 'utf8'));

test('manifest shape: a non-empty presets list + a string default', () => {
  assert.ok(Array.isArray(manifest.presets) && manifest.presets.length > 0);
  assert.equal(typeof manifest.default, 'string');
  assert.ok(manifest.default.length > 0);
});

test('every manifest entry has a unique id, a runKey and a non-empty label', () => {
  const ids = manifest.presets.map((/** @type {any} */ p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate preset id in the manifest');
  for (const p of manifest.presets) {
    assert.equal(typeof p.id, 'string');
    assert.ok(p.id.length > 0);
    assert.equal(typeof p.runKey, 'string');
    assert.ok(p.runKey.length > 0);
    assert.equal(typeof p.label, 'string');
    assert.ok(p.label.length > 0, `preset ${p.id} has an empty label`);
  }
});

test('every manifest id → a file on disk whose runs carry the referenced runKey', () => {
  for (const p of manifest.presets) {
    const file = path.join(teamDir, `${p.id}.json`);
    assert.ok(existsSync(file), `manifest references missing preset file ${p.id}.json`);
    /** @type {any} */
    const preset = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(preset.id, p.id, `preset file ${p.id}.json has a mismatched id`);
    assert.ok(preset.runs && preset.runs[p.runKey], `preset ${p.id} has no run "${p.runKey}"`);
    // The referenced run is a real team config (sim:"team").
    assert.equal(preset.runs[p.runKey].sim, 'team', `${p.id}.${p.runKey} is not a team run`);
  }
});

test('the default names a surfaced preset', () => {
  const ids = new Set(manifest.presets.map((/** @type {any} */ p) => p.id));
  assert.ok(ids.has(manifest.default), `manifest default "${manifest.default}" is not a surfaced preset`);
});
