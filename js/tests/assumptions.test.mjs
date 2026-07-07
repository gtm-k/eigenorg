// P8 Assumptions-drawer field test (PLAN P8 acceptance bullet 2; MODEL.md §12.7).
//
// The drawer renders www/assumptions.json VERBATIM (PREMORTEM Story 3: the
// drawer must never carry hand-copied model copy). This test pins the shape the
// drawer depends on against the LIVE extracted artifact: every required field
// exists per item type, so a later amendment that drops a field fails here
// before it can silently blank a drawer row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  REQUIRED_PARAM_FIELDS,
  REQUIRED_MECHANIC_FIELDS,
  ALLOWED_TIERS,
  partitionItems,
  validateAssumptions,
  renderAssumptionsDrawer,
} from '../ui/assumptions.js';

const assumptionsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assumptions.json',
);

/** @returns {any} the live extracted artifact the drawer renders */
function liveAssumptions() {
  return JSON.parse(readFileSync(assumptionsPath, 'utf8'));
}

test('assumptions.json carries the modelVersion + generatedBy header and a non-empty items array', () => {
  const data = liveAssumptions();
  assert.equal(typeof data.modelVersion, 'string');
  assert.match(data.generatedBy, /extract_params\.mjs/);
  assert.ok(Array.isArray(data.items) && data.items.length > 0);
});

test('every parameter item has every P8-required field (formula, plainLanguage, tier, limitation, anchor) plus the §12.7 shape (value, range, unit, distribution)', () => {
  const { parameters } = partitionItems(liveAssumptions().items);
  assert.ok(parameters.length > 0, 'expected at least one parameter');
  for (const p of parameters) {
    for (const field of REQUIRED_PARAM_FIELDS) {
      assert.ok(field in p, `parameter ${p.id} is missing required field "${field}"`);
    }
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.plainLanguage, 'string');
    assert.ok(p.plainLanguage.length > 0, `parameter ${p.id} has empty plainLanguage`);
    assert.equal(typeof p.formula, 'string');
    assert.ok(ALLOWED_TIERS.includes(p.tier), `parameter ${p.id} has an unknown tier "${p.tier}"`);
    assert.equal(typeof p.limitation, 'string');
    assert.equal(typeof p.anchor, 'string');
    assert.ok(Array.isArray(p.range) && p.range.length === 2, `parameter ${p.id} range is not a 2-tuple`);
    assert.equal(typeof p.unit, 'string');
    assert.equal(typeof p.distribution, 'string');
    // value is a scalar (point) or an array (triangular) — both must be present.
    assert.ok('value' in p, `parameter ${p.id} is missing value`);
  }
});

test('every mechanic item has every P8-required field (formula, plainLanguage, citations, limitations)', () => {
  const { mechanics } = partitionItems(liveAssumptions().items);
  assert.ok(mechanics.length > 0, 'expected at least one mechanic');
  for (const m of mechanics) {
    for (const field of REQUIRED_MECHANIC_FIELDS) {
      assert.ok(field in m, `mechanic ${m.id} is missing required field "${field}"`);
    }
    assert.equal(typeof m.id, 'string');
    assert.equal(typeof m.plainLanguage, 'string');
    assert.ok(m.plainLanguage.length > 0, `mechanic ${m.id} has empty plainLanguage`);
    assert.equal(typeof m.formula, 'string');
    assert.ok(Array.isArray(m.citations) && m.citations.length > 0, `mechanic ${m.id} has no citations`);
    assert.ok(Array.isArray(m.limitations) && m.limitations.length > 0, `mechanic ${m.id} has no limitations`);
  }
});

test('validateAssumptions returns zero problems for the live artifact', () => {
  const problems = validateAssumptions(liveAssumptions());
  assert.deepEqual(problems, [], `unexpected drawer-shape problems:\n${problems.join('\n')}`);
});

test('validateAssumptions catches a dropped required field (guards against silent drawer blanks)', () => {
  const data = liveAssumptions();
  const broken = { ...data, items: data.items.map((/** @type {any} */ it) => ({ ...it })) };
  // Drop `limitation` from the first parameter.
  const firstParam = broken.items.find((/** @type {any} */ it) => it.type === 'parameter');
  delete firstParam.limitation;
  const problems = validateAssumptions(broken);
  assert.ok(
    problems.some((p) => p.includes('limitation')),
    'expected a problem naming the dropped "limitation" field',
  );
});

test('partitionItems preserves document order within each group (parameters then mechanics — §12.7)', () => {
  const data = liveAssumptions();
  const { parameters, mechanics } = partitionItems(data.items);
  // The extracted artifact lists all parameters, then all mechanics.
  const firstMechanicIndex = data.items.findIndex((/** @type {any} */ it) => it.type === 'mechanic');
  const lastParamIndex = data.items.reduce(
    (/** @type {number} */ acc, /** @type {any} */ it, /** @type {number} */ i) => (it.type === 'parameter' ? i : acc),
    -1,
  );
  assert.ok(lastParamIndex < firstMechanicIndex, 'parameters must all precede mechanics in document order');
  assert.equal(parameters.length + mechanics.length, data.items.length);
});

// ---- MED-1: the tier badge renders assumptions.json VERBATIM (the drift moat) ----
//
// The drawer must render every tier value EXACTLY as the extracted artifact holds
// it (PREMORTEM Story 3: no value rewriting, or three sources of truth drift). A
// prior label map rewrote 'industry-report' → 'industry report' in the badge text;
// these tests pin the badge text to the raw tier string via a minimal DOM stub.

/** A minimal DOM element stub sufficient for assumptions.js `make()` + drawer append. */
function fakeElement(/** @type {string} */ tag) {
  return {
    tagName: tag,
    className: '',
    textContent: '',
    /** @type {Record<string, string>} */ dataset: {},
    hidden: false,
    /** @type {any[]} */ children: [],
    setAttribute() {},
    appendChild(/** @type {any} */ n) {
      this.children.push(n);
      return n;
    },
    append(/** @type {any[]} */ ...ns) {
      for (const n of ns) this.children.push(n);
    },
  };
}

/**
 * Run `fn(doc)` with a minimal `globalThis.document` installed (assumptions.js
 * `make()` reads the global), restoring the prior value after. The same stub is
 * passed to `fn` so callers never reference the browser global directly.
 * @param {(doc: any) => void} fn
 */
function withFakeDom(fn) {
  const prev = /** @type {any} */ (globalThis).document;
  const doc = {
    createElement: (/** @type {string} */ t) => fakeElement(t),
    createTextNode: (/** @type {string} */ t) => ({ nodeType: 3, textContent: t, children: [] }),
  };
  /** @type {any} */ (globalThis).document = doc;
  try {
    fn(doc);
  } finally {
    /** @type {any} */ (globalThis).document = prev;
  }
}

/** Depth-first collect every node whose className === cls. */
function collectByClass(/** @type {any} */ node, /** @type {string} */ cls, /** @type {any[]} */ out = []) {
  if (node && node.className === cls) out.push(node);
  if (node && Array.isArray(node.children)) for (const c of node.children) collectByClass(c, cls, out);
  return out;
}

test('MED-1: the tier badge text is the RAW assumptions.json tier string (no rewriting)', () => {
  // A synthetic parameter whose tier is one the old label map rewrote
  // ('industry-report' → 'industry report'): the badge must show it verbatim.
  const data = {
    modelVersion: '9.9.9',
    items: [
      {
        type: 'parameter',
        id: 'p_probe',
        plainLanguage: 'probe',
        formula: 'x',
        tier: 'industry-report',
        limitation: 'x',
        anchor: 'x',
        value: 1,
        range: [0, 2],
        unit: 'u',
        distribution: 'point',
      },
    ],
  };
  withFakeDom((doc) => {
    const root = doc.createElement('div');
    renderAssumptionsDrawer(/** @type {any} */ (root), data);
    const badges = collectByClass(root, 'assum-tier');
    assert.equal(badges.length, 1);
    assert.equal(badges[0].textContent, 'industry-report'); // VERBATIM, NOT "industry report"
    assert.equal(badges[0].dataset.tier, 'industry-report');
  });
});

test('MED-1: every rendered tier badge equals its parameter\'s raw tier in the live artifact', () => {
  const data = liveAssumptions();
  const { parameters } = partitionItems(data.items);
  withFakeDom((doc) => {
    const root = doc.createElement('div');
    renderAssumptionsDrawer(/** @type {any} */ (root), data);
    const badges = collectByClass(root, 'assum-tier');
    assert.equal(badges.length, parameters.length, 'one tier badge per parameter');
    parameters.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
      assert.equal(badges[i].textContent, p.tier, `badge ${i} must render the raw tier "${p.tier}" verbatim`);
    });
  });
});
