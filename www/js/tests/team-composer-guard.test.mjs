// P7b F4 — composer guard-blocked edits must be OBSERVABLE to a sighted actor,
// not only to screen-reader users (actor-observability). renderTeamComposer is a
// DOM controller, so this exercises it against a minimal DOM stub (the same
// posture as team-charts.test.mjs) and asserts that a blocked add/remove writes
// a VISIBLE .tc-guard note — and that a successful edit clears it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { renderTeamComposer } from '../ui/team-composer.js';
import { buildCatalog, addEntity, entitiesOf, MAX_ENTITIES } from '../ui/team.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
/** @param {string} rel @returns {any} */
const loadPreset = (rel) => JSON.parse(readFileSync(path.join(repoRoot, 'www', 'presets', 'team', rel), 'utf8'));
const bh = loadPreset('balancedHybrid.json').runs.main;
const catalog = buildCatalog([bh]);

// ---- minimal DOM stub (enough for renderTeamComposer + its handlers) -----------

class Node {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    /** @type {Record<string, string>} */ this.dataset = {};
    /** @type {Record<string, string>} */ this.attributes = {};
    /** @type {any[]} */ this.children = [];
    /** @type {Record<string, Function[]>} */ this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (/** @type {string} */ c) => { classes.add(c); this.className = [...classes].join(' '); },
      remove: (/** @type {string} */ c) => { classes.delete(c); this.className = [...classes].join(' '); },
      toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => {
        const want = on ?? !classes.has(c);
        if (want) classes.add(c); else classes.delete(c);
        this.className = [...classes].join(' ');
      },
      contains: (/** @type {string} */ c) => classes.has(c),
    };
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attributes[k] = String(v); }
  getAttribute(/** @type {string} */ k) { return this.attributes[k] ?? null; }
  addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  append(/** @type {any[]} */ ...ns) { for (const n of ns) this.children.push(n); }
  appendChild(/** @type {any} */ n) { this.children.push(n); return n; }
  focus() {}
  querySelector(/** @type {string} */ sel) { return firstByTag(this, sel) ?? null; }
}

/** @param {any} root @param {string} tag @returns {any} */
function firstByTag(root, tag) {
  for (const c of root.children ?? []) {
    if (c.tagName === tag) return c;
    const nested = firstByTag(c, tag);
    if (nested) return nested;
  }
  return null;
}

/** @param {any} root @param {string} cls @returns {any[]} */
function allByClass(root, cls) {
  /** @type {any[]} */ const out = [];
  const walk = (/** @type {any} */ n) => {
    for (const c of n.children ?? []) {
      if (String(c.className).split(/\s+/).includes(cls)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** @param {any} node @param {string} type */
function fire(node, type) {
  for (const fn of node.listeners[type] ?? []) fn({ preventDefault() {}, dataTransfer: { setData() {}, getData: () => '' } });
}

/** @param {() => void} fn */
function withDom(fn) {
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new Node(t) };
  try { fn(); } finally { /** @type {any} */ (globalThis).document = prev; }
}

/** Grow a config to the roster maximum so the next add is blocked. @param {any} config */
function atMax(config) {
  let cfg = config;
  const seat = catalog.find((c) => c.archetype === 'engineer');
  assert.ok(seat, 'catalog has an engineer template');
  while (entitiesOf(cfg).length < MAX_ENTITIES) cfg = addEntity(cfg, seat.template);
  return cfg;
}

// ---- the guard is visible (F4) -------------------------------------------------

test('a blocked ADD (roster at the max) surfaces a VISIBLE guard note, not a silent no-op', () => {
  withDom(() => {
    let config = atMax(bh);
    const container = new Node('div');
    renderTeamComposer(/** @type {any} */ (container), {
      getConfig: () => config,
      onConfigChange: (/** @type {any} */ next) => { config = next; },
      catalog,
    });
    const guard = allByClass(container, 'tc-guard')[0];
    assert.ok(guard, 'the composer renders a .tc-guard note element');
    assert.equal(guard.getAttribute('role'), 'status', 'the guard note is a role=status live region (announced to SR too)');
    assert.equal(guard.textContent, '', 'no guard message before any blocked edit');

    // Click an add chip while at the max → addEntity returns null → guard fires.
    const addChip = allByClass(container, 'tc-add-chip')[0];
    fire(addChip, 'click');
    assert.match(guard.textContent, /most a team can hold/, 'the blocked add shows a visible reason');
  });
});

test('a blocked REMOVE (last two members) surfaces a VISIBLE guard note', () => {
  withDom(() => {
    // A real 2-entity roster: any remove hits the min-2 guard.
    let config = { ...bh, team: { ...bh.team, entities: entitiesOf(bh).slice(0, 2), recoveryOwner: null } };
    const container = new Node('div');
    renderTeamComposer(/** @type {any} */ (container), {
      getConfig: () => config,
      onConfigChange: (/** @type {any} */ next) => { config = next; },
      catalog,
    });
    const guard = allByClass(container, 'tc-guard')[0];
    const removeBtn = allByClass(container, 'tc-remove')[0];
    assert.ok(removeBtn, 'the roster renders remove buttons');
    fire(removeBtn, 'click');
    assert.match(guard.textContent, /at least two people/, 'the blocked remove shows a visible reason');
  });
});

test('a successful edit CLEARS a prior guard note', () => {
  withDom(() => {
    let config = atMax(bh);
    const container = new Node('div');
    renderTeamComposer(/** @type {any} */ (container), {
      getConfig: () => config,
      onConfigChange: (/** @type {any} */ next) => { config = next; },
      catalog,
    });
    const guard = allByClass(container, 'tc-guard')[0];
    // Block first (at max), then remove one → a successful edit clears the note.
    fire(allByClass(container, 'tc-add-chip')[0], 'click');
    assert.notEqual(guard.textContent, '', 'guard is showing after the blocked add');
    fire(allByClass(container, 'tc-remove')[0], 'click'); // a valid remove (12 → 11)
    assert.equal(guard.textContent, '', 'a successful edit cleared the guard note');
  });
});
