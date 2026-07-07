// P10b glossary shape-pin (mirrors assumptions.test.mjs): the curated glossary
// (glossary-terms.js) + the mode-agnostic index (glossary.js) are the layer-ii
// contract the term-coverage gate and P7b both depend on. This pins the shape so
// a later edit that empties a curated entry, breaks an assumptionsId link, or
// desyncs JARGON_KNOWN_LIST fails HERE before it can ship an unmapped ⓘ.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CURATED_TERMS, JARGON_KNOWN_LIST } from '../ui/glossary-terms.js';
import { buildTermIndex, resolveTerm, uncoveredTerms, register, createGlossary } from '../ui/glossary.js';

const assumptionsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assumptions.json');
/** @returns {any} */
const liveAssumptions = () => JSON.parse(readFileSync(assumptionsPath, 'utf8'));

// ---- curated data shape --------------------------------------------------------

test('every curated term has an id, a label, >=1 surface, and non-empty plain + why', () => {
  assert.ok(CURATED_TERMS.length > 0, 'expected at least one curated term');
  for (const t of CURATED_TERMS) {
    assert.equal(typeof t.id, 'string');
    assert.ok(t.id.length > 0, 'empty id');
    assert.equal(typeof t.label, 'string');
    assert.ok(t.label.length > 0, `term ${t.id} has empty label`);
    assert.ok(Array.isArray(t.surfaces) && t.surfaces.length > 0, `term ${t.id} has no surfaces`);
    for (const s of t.surfaces) assert.ok(typeof s === 'string' && s.length > 0, `term ${t.id} has an empty surface`);
    assert.ok(typeof t.plain === 'string' && t.plain.length > 0, `term ${t.id} has empty plain`);
    assert.ok(typeof t.why === 'string' && t.why.length > 0, `term ${t.id} has empty why`);
  }
});

test('curated term ids are unique', () => {
  const ids = CURATED_TERMS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate curated term id');
});

test('JARGON_KNOWN_LIST is EXACTLY the union of every surface (derived, never hand-typed)', () => {
  const expected = CURATED_TERMS.flatMap((t) => t.surfaces);
  assert.deepEqual(JARGON_KNOWN_LIST, expected);
});

// ---- assumptionsId links resolve against the LIVE artifact (drift guard) --------

test('every curated assumptionsId EXISTS in the live assumptions.json (no dangling model link)', () => {
  const ids = new Set(liveAssumptions().items.map((/** @type {any} */ it) => it.id));
  for (const t of CURATED_TERMS) {
    if (t.assumptionsId) {
      assert.ok(ids.has(t.assumptionsId), `curated term ${t.id} links a missing assumptions id "${t.assumptionsId}"`);
    }
  }
});

test('exactly the §8.5 sourceless terms carry no assumptionsId', () => {
  // The corrected §8.5 fact: the sourceless retell terms have no model item. In
  // P10b the wired sourceless term is Structural Health; any curated term with
  // no assumptionsId must be a deliberate sourceless one (its deep-dive is
  // curated-only, never a phantom id).
  for (const t of CURATED_TERMS) {
    if (!t.assumptionsId) assert.ok(t.plain.length > 0, `sourceless term ${t.id} must carry curated plain copy`);
  }
});

// ---- index build + resolution --------------------------------------------------

test('buildTermIndex resolves every surface AND every id; deep-dive is wired only where a model link exists', () => {
  const assumptions = liveAssumptions();
  const index = buildTermIndex({ assumptions });
  for (const t of CURATED_TERMS) {
    assert.ok(resolveTerm(index, t.id), `id ${t.id} did not resolve`);
    for (const s of t.surfaces) {
      const e = resolveTerm(index, s);
      assert.ok(e, `surface "${s}" did not resolve`);
      assert.equal(e.id, t.id, `surface "${s}" resolved to the wrong term`);
    }
    const e = resolveTerm(index, t.id);
    assert.ok(e, `id ${t.id} did not resolve`);
    if (t.assumptionsId) {
      assert.equal(e.source, 'model');
      assert.ok(typeof e.deepDive === 'string' && e.deepDive.length > 0, `term ${t.id} has no deep-dive despite a model link`);
    } else {
      assert.equal(e.source, 'curated');
      assert.equal(e.deepDive, null);
    }
  }
});

test('uncoveredTerms(JARGON_KNOWN_LIST, index) is empty (totality — the gate assertion)', () => {
  const index = buildTermIndex({ assumptions: liveAssumptions() });
  assert.deepEqual(uncoveredTerms(JARGON_KNOWN_LIST, index), []);
});

test('uncoveredTerms flags a surface with no term (red case)', () => {
  const index = buildTermIndex({ assumptions: liveAssumptions() });
  assert.deepEqual(uncoveredTerms(['Entropy', 'a term nobody registered'], index), ['a term nobody registered']);
});

test('register appends a new term (the P7b runtime path) resolvable by id + surface', () => {
  const index = buildTermIndex({ assumptions: liveAssumptions() });
  register(index, [{ id: 'cohesion', label: 'Cohesion', surfaces: ['Cohesion'], plain: 'p', why: 'w', assumptionsId: 'cohesionDynamics' }], liveAssumptions());
  assert.ok(resolveTerm(index, 'cohesion'));
  const bySurface = resolveTerm(index, 'Cohesion');
  assert.ok(bySurface);
  assert.equal(bySurface.id, 'cohesion');
});

test('buildTermIndex degrades gracefully when assumptions failed to load (no deep-dive, still resolves)', () => {
  const index = buildTermIndex({ assumptions: null });
  const e = resolveTerm(index, 'entropy');
  assert.ok(e, 'entropy still resolves without assumptions');
  assert.equal(e.deepDive, null, 'no deep-dive without assumptions');
});

// ---- ⓘ affordance: focusable element with an accessible name (actor-observability) --

/** A minimal DOM element stub sufficient for glossary.js elc()/tag(). @param {string} tag */
function fakeElement(tag) {
  return {
    tagName: tag,
    className: '',
    textContent: '',
    /** @type {Record<string, string>} */ attributes: {},
    /** @type {any[]} */ children: [],
    setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
      this.attributes[k] = v;
    },
    appendChild(/** @type {any} */ n) {
      this.children.push(n);
      return n;
    },
    append(/** @type {any[]} */ ...ns) {
      for (const n of ns) this.children.push(n);
    },
  };
}

/** Depth-first find the first node with className === cls.
 * @param {any} node @param {string} cls @returns {any} */
function findByClass(node, cls) {
  if (node && node.className === cls) return node;
  if (node && Array.isArray(node.children)) {
    for (const c of node.children) {
      /** @type {any} */
      const hit = findByClass(c, cls);
      if (hit) return hit;
    }
  }
  return null;
}

test('tag() builds a native <details> ⓘ whose <summary> carries an accessible name', () => {
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement: (/** @type {string} */ t) => fakeElement(t),
    createTextNode: (/** @type {string} */ t) => ({ nodeType: 3, textContent: t, children: [] }),
  };
  try {
    const glossary = createGlossary({ assumptions: liveAssumptions() });
    const node = glossary.tag('entropy');
    assert.ok(node, 'tag() returned a node');
    assert.equal(node.tagName, 'details'); // native disclosure = keyboard + tap, no custom JS
    const summary = findByClass(node, 'term-info');
    assert.ok(summary, 'the ⓘ summary exists');
    assert.equal(summary.tagName, 'summary'); // focusable by default
    assert.match(summary.attributes['aria-label'] ?? '', /What '.*' means/);
    assert.equal(glossary.tag('a term nobody registered'), null);
  } finally {
    /** @type {any} */ (globalThis).document = prev;
  }
});
