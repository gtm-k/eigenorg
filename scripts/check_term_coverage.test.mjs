// scripts/check_term_coverage.test.mjs
// Self-test for the P10b term-coverage gate (scripts/check_term_coverage.mjs).
//
// Proves the pieces the review needs (PLAN P10b / spec §8.5): (1) the heading
// sweep FIRES on a bare jargon heading and IGNORES prose + data-term-bound +
// allowlisted headings; (2) the data-term marker scan finds all three
// declaration forms; (3) a renamed/removed model id is caught (danglingLinks);
// (4) the gate EXITS ZERO on the real committed tree (the clean state). Planted
// fixtures are pure-string — no temp files needed for the unit checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stripTags,
  headingBlocks,
  panelTitleBlocks,
  dataTermMarkers,
  sweepHeadings,
  danglingLinks,
  ALLOWLIST_HEADING_IDS,
} from './check_term_coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const gateScript = join(here, 'check_term_coverage.mjs');

// ---- heading parsing -----------------------------------------------------------

test('headingBlocks parses multi-line h2/h3 and strips nested tags', () => {
  const html = '<h2 id="x" data-term="entropy">How chaotic things get\n  <span class="tech-label">Disorder · entropy, 0–100</span>\n</h2>';
  const blocks = headingBlocks(html);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tag, 'h2');
  assert.match(blocks[0].text, /How chaotic things get Disorder · entropy/);
  assert.match(blocks[0].attrs, /data-term="entropy"/);
});

test('stripTags flattens nested markup to text', () => {
  assert.equal(stripTags('<h3><span>Structural Health 3</span> <span class="tag">your org</span></h3>'), 'Structural Health 3 your org');
});

// ---- the heading sweep ---------------------------------------------------------

test('sweep FIRES on a bare jargon heading (no wrapper, no data-term)', () => {
  const html = '<h2>Decision velocity</h2>';
  const v = sweepHeadings(html, ['Decision velocity']);
  assert.equal(v.length, 1);
  assert.equal(v[0].surface, 'Decision velocity');
});

test('sweep IGNORES an inverted heading bound via its .panel-title wrapper', () => {
  const html =
    '<div class="panel-title" data-term="decisionVelocity"><h2>How fast decisions get made</h2><span class="tech-label">Decision velocity · 0–100</span></div>';
  assert.deepEqual(sweepHeadings(html, ['Decision velocity']), []);
});

test('sweep FIRES on a .panel-title whose tech-label carries a surface but has no data-term', () => {
  const html = '<div class="panel-title"><h2>How fast decisions get made</h2><span class="tech-label">Decision velocity · 0–100</span></div>';
  const v = sweepHeadings(html, ['Decision velocity']);
  assert.equal(v.length, 1);
  assert.equal(v[0].surface, 'Decision velocity');
});

test('panelTitleBlocks captures the wrapper attrs + flattened text', () => {
  const blocks = panelTitleBlocks('<div class="panel-title" data-term="entropy"><h2>How chaotic things get</h2><span class="tech-label">Disorder · entropy, 0–100</span></div>');
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].attrs, /data-term="entropy"/);
  assert.match(blocks[0].text, /Disorder · entropy/);
});

test('sweep IGNORES prose (only h2/h3 are swept — meaning.js sentences are out of scope)', () => {
  const html = '<p class="meaning">Decision velocity is a 0–100 speedometer.</p><p class="eyebrow">Decisions</p>';
  assert.deepEqual(sweepHeadings(html, ['Decision velocity', 'Decisions']), []);
});

test('sweep IGNORES an allowlisted value-label heading id', () => {
  const html = '<h3 id="pane-before-title"><span>Structural Health 3</span></h3>';
  assert.ok(ALLOWLIST_HEADING_IDS.has('pane-before-title'));
  assert.deepEqual(sweepHeadings(html, ['Structural Health']), []);
});

// ---- data-term marker scan (all three forms; P7b glob join) --------------------

test('dataTermMarkers finds the HTML attr, dataset.term, and setAttribute forms', () => {
  const src = [
    '<h2 data-term="entropy">x</h2>',
    "label.dataset.term = 'structuralHealth';",
    "el.setAttribute('data-term', 'cohesion');",
  ].join('\n');
  const ids = dataTermMarkers(src).map((m) => m.id).sort();
  assert.deepEqual(ids, ['cohesion', 'entropy', 'structuralHealth']);
});

// ---- Check 1: renamed/removed model id (drift, risk R7) -------------------------

test('danglingLinks catches a curated term whose assumptionsId was renamed away', () => {
  const curated = [
    { id: 'entropy', label: 'Disorder', surfaces: ['Entropy'], plain: 'p', why: 'w', assumptionsId: 'entropyComposite' },
    { id: 'x', label: 'X', surfaces: ['X'], plain: 'p', why: 'w', assumptionsId: 'renamedAwayId' },
  ];
  const scratchIds = new Set(['entropyComposite']); // renamedAwayId removed
  assert.deepEqual(danglingLinks(curated, scratchIds), ['x']);
});

test('danglingLinks passes a sourceless term (no assumptionsId to dangle)', () => {
  const curated = [{ id: 'structuralHealth', label: 'Structural Health', surfaces: ['Structural Health'], plain: 'p', why: 'w' }];
  assert.deepEqual(danglingLinks(curated, new Set()), []);
});

// ---- CLI: the real committed tree is CLEAN -------------------------------------

test('CLI: the gate EXITS ZERO on the real committed tree', () => {
  const res = spawnSync(process.execPath, [gateScript], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0; got ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, /term-coverage gate clean/);
});
