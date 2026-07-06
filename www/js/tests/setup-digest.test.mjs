// P10b-1 setup-digest tests (pure, no DOM): the plain-English org précis
// (org.js) and the approval-stack drawer summary (prioritization.js). Both are
// authored from config inputs only — they must NEVER surface a model number, so
// the golden anchor is the real landing preset on disk, read (not re-typed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { orgPrecisSentence } from '../ui/org.js';
import { approvalStackSummary } from '../ui/prioritization.js';

const presetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'presets');
/** @returns {any} the fasterDysfunction sh3 landing config, fresh copy */
function landingConfig() {
  const preset = JSON.parse(readFileSync(path.join(presetsDir, 'fasterDysfunction.json'), 'utf8'));
  return JSON.parse(JSON.stringify(preset.runs.sh3));
}

/** @param {Array<{ text: string }>} parts */
const joinText = (parts) => parts.map((p) => p.text).join('');

// ---- orgPrecisSentence ------------------------------------------------------

test('orgPrecisSentence composes the landing org (40 people, pods, meeting-heavy, 1 layer, AI on)', () => {
  const cfg = landingConfig();
  const parts = orgPrecisSentence(cfg);
  assert.equal(
    joinText(parts),
    "You're testing a 40-person org wired as pods, meeting-heavy, cleared by a 1-layer approval chain, with AI injected partway.",
  );
});

test('orgPrecisSentence emphasizes exactly the editable values (bold ink), never the connective text', () => {
  const parts = orgPrecisSentence(landingConfig());
  const values = parts.filter((p) => p.value).map((p) => p.text);
  assert.deepEqual(values, ['40-person', 'pods', 'meeting-heavy', '1-layer approval chain', 'AI injected partway']);
  // the framing words are NOT emphasized
  assert.ok(parts.some((p) => !p.value && p.text === "You're testing a "));
});

test('orgPrecisSentence drops the AI clause when injection is inactive, and reflects async + topology edits', () => {
  const cfg = landingConfig();
  cfg.org.aiInjection.enabled = false;
  cfg.org.modality = 'asyncFirst';
  cfg.org.topology = 'hierarchical';
  const text = joinText(orgPrecisSentence(cfg));
  assert.doesNotMatch(text, /AI injected/);
  assert.match(text, /wired as a hierarchy, async-first,/);
  assert.ok(text.endsWith('approval chain.'));
});

test('orgPrecisSentence authors no model number — every value maps to a plain config input', () => {
  const cfg = landingConfig();
  // A model coefficient buried in the config must never leak into the sentence.
  const text = joinText(orgPrecisSentence(cfg));
  const numbers = text.match(/\d+/g) ?? [];
  assert.deepEqual(numbers, ['40', '1']); // headcountStart + ownershipLayers ONLY
});

// ---- approvalStackSummary ---------------------------------------------------

test('approvalStackSummary summarizes a single all-human layer', () => {
  assert.equal(approvalStackSummary(landingConfig()), '1 layer · Human PM');
});

test('approvalStackSummary pluralizes and lists a mixed stack', () => {
  const cfg = landingConfig();
  cfg.org.ownershipLayers = 2;
  cfg.org.layerTypes = ['humanPm', 'aiAgent'];
  assert.equal(approvalStackSummary(cfg), '2 layers · Human PM, AI Prioritization Agent');
});

test('approvalStackSummary collapses three+ distinct seat types to a count', () => {
  const cfg = landingConfig();
  cfg.org.ownershipLayers = 3;
  cfg.org.layerTypes = ['humanPm', 'aiAgent', 'committee'];
  assert.equal(approvalStackSummary(cfg), '3 layers · 3 seat types');
});
