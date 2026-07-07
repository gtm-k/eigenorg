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
import { buildTermIndex, resolveTerm, uncoveredTerms, createGlossary } from '../ui/glossary.js';
import { dataTermMarkers, missingSpecTerms } from '../../../scripts/check_term_coverage.mjs';

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

test('exactly the three §8.5 sourceless terms carry no assumptionsId (F6.1 pin)', () => {
  // The corrected §8.5 fact: EXACTLY three retell terms have no model item —
  // Structural Health, Throughput, Faster Dysfunction. This strict pin turns RED
  // if an assumptionsId is deleted from a term that should have one (the term
  // would fall into this set) OR if a fourth sourceless term is added without a
  // link — either is a coverage regression the gate's model-link check misses.
  const sourceless = CURATED_TERMS.filter((t) => !t.assumptionsId).map((t) => t.id).sort();
  assert.deepEqual(sourceless, ['fasterDysfunction', 'structuralHealth', 'throughput']);
  for (const t of CURATED_TERMS) {
    if (!t.assumptionsId) assert.ok(t.plain.length > 0, `sourceless term ${t.id} must carry curated plain copy`);
  }
});

test('F6.2: each curated term keeps its distinctive plain-language copy (a swap goes RED)', () => {
  // A distinctive substring per term anchors its exec-voice copy: a copy swap
  // between two terms, or a term losing its lede, fails HERE before it ships an
  // ⓘ that describes the wrong concept. Matches plain + why together.
  /** @type {Record<string, RegExp>} */
  const anchors = {
    entropy: /disorder/i,
    decisionVelocity: /speedometer/i,
    communicationLoad: /communication lines/i,
    aiInjectionDelta: /isolates/i,
    meetingOverhead: /calendars/i,
    multiLevelHealth: /side by side/i,
    structuralHealth: /five things/i,
    approvalStack: /sign-offs/i,
    coordinationTax: /coordinating|meetings/i,
    throughput: /finished|output/i,
    brittleness: /breaks|novel/i,
    fasterDysfunction: /trap|weak points/i,
    cohesion: /trust/i,
    functionCoverage: /essential job|unowned/i,
  };
  // Every registered term must have a defined anchor (a new term forces the pin).
  assert.deepEqual(CURATED_TERMS.map((t) => t.id).sort(), Object.keys(anchors).sort());
  for (const t of CURATED_TERMS) {
    const re = anchors[t.id];
    assert.match(`${t.plain} ${t.why}`, re, `term ${t.id} lost its distinctive copy anchor ${re}`);
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

// (The former `register` runtime-append test was removed with the export in
// P10b-2 repair-1: appending to CURATED_TERMS is the ONLY sanctioned P7b path, so
// there is no runtime registration path left to test.)

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

// ---- decorate(): ⓘ insertion point + summary skip + idempotency (DOM-level) ----
//
// Browser verification (Playwright) was UNAVAILABLE this session (no browser MCP
// tools); this DOM-level test stands in for it on the load-bearing decorate
// wiring — mirroring the inverted `.panel-title` / `.field-lead` structure the
// page ships.

/** A minimal DOM node supporting exactly what glossary.decorate() queries. */
class Node {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    /** @type {Record<string, string>} */ this.dataset = {};
    /** @type {Record<string, string>} */ this.attributes = {};
    /** @type {any[]} */ this.children = [];
    /** @type {any} */ this.parentNode = null;
    this.textContent = '';
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this.attributes[k] = v;
  }
  appendChild(/** @type {any} */ n) {
    if (n && typeof n === 'object') n.parentNode = this;
    this.children.push(n);
    return n;
  }
  append(/** @type {any[]} */ ...ns) {
    for (const n of ns) this.appendChild(n);
  }
  insertBefore(/** @type {any} */ n, /** @type {any} */ ref) {
    if (n && typeof n === 'object') n.parentNode = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  /** @param {string} sel */
  _matches(sel) {
    if (sel === '[data-term]') return this.dataset.term !== undefined;
    if (sel.startsWith('.')) return String(this.className).split(' ').includes(sel.slice(1));
    return false;
  }
  /** @param {string} sel */
  closest(sel) {
    /** @type {any} */ let cur = this;
    while (cur) {
      if (cur.tagName === sel) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  /** @param {string} sel — supports ':scope > .cls' */
  querySelector(sel) {
    const m = /^:scope > (.+)$/.exec(sel);
    const target = m ? m[1] : sel;
    for (const c of this.children) if (c && c._matches && c._matches(target)) return c;
    return null;
  }
  /** @param {string} sel — supports '[data-term]', recursive */
  querySelectorAll(sel) {
    /** @type {any[]} */ const out = [];
    /** @param {any} node */
    const walk = (node) => {
      for (const c of node.children) {
        if (c && c._matches && c._matches(sel)) out.push(c);
        if (c && Array.isArray(c.children)) walk(c);
      }
    };
    walk(this);
    return out;
  }
}

/** Run `fn` with a Node-backed globalThis.document installed. @param {(g: any) => void} fn */
function withNodeDom(fn) {
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement: (/** @type {string} */ t) => new Node(t),
    createTextNode: (/** @type {string} */ t) => ({ nodeType: 3, textContent: t, children: [] }),
  };
  try {
    fn(/** @type {any} */ (globalThis).document);
  } finally {
    /** @type {any} */ (globalThis).document = prev;
  }
}

test('decorate() inserts the ⓘ between the plain lead and the .tech-label, mounts a summary-host ⓘ on the shell, and is idempotent', () => {
  withNodeDom(() => {
    const glossary = createGlossary({ assumptions: liveAssumptions() });

    // Inverted heading: <div .panel-title data-term><h2/><span .tech-label/></div>
    const root = new Node('div');
    const panelTitle = new Node('div');
    panelTitle.className = 'panel-title';
    panelTitle.dataset.term = 'entropy';
    const h2 = new Node('h2');
    const tech = new Node('span');
    tech.className = 'tech-label';
    panelTitle.append(h2, tech);

    // Approval-stack disclosure (F9): data-term ON the <summary>, inside a
    // <details> wrapped by a position:relative `.approval-shell`. The ⓘ must mount
    // on the SHELL (sibling of the details) — never nested in the summary.
    const shell = new Node('div');
    shell.className = 'approval-shell';
    const details = new Node('details');
    const summary = new Node('summary');
    summary.dataset.term = 'approvalStack';
    details.append(summary);
    shell.append(details);
    root.append(panelTitle, shell);

    glossary.decorate(/** @type {any} */ (root));

    const info = panelTitle.querySelector(':scope > .term-pop');
    assert.ok(info, 'ⓘ was inserted into the panel-title');
    assert.ok(
      panelTitle.children.indexOf(info) < panelTitle.children.indexOf(tech),
      'ⓘ sits before the .tech-label',
    );
    // Summary host handled, not skipped: ⓘ on the shell, NOT nested in the summary.
    assert.ok(shell.querySelector(':scope > .term-pop'), 'summary-host ⓘ mounted on the shell');
    assert.equal(summary.querySelector(':scope > .term-pop'), null, 'ⓘ is NOT nested in the summary (valid HTML)');

    // Idempotent: a second decorate must not add a second ⓘ to either host.
    glossary.decorate(/** @type {any} */ (root));
    const paneInfos = panelTitle.children.filter((/** @type {any} */ c) => c && c._matches && c._matches('.term-pop'));
    const shellInfos = shell.children.filter((/** @type {any} */ c) => c && c._matches && c._matches('.term-pop'));
    assert.equal(paneInfos.length, 1, 'decorate is idempotent (panel-title)');
    assert.equal(shellInfos.length, 1, 'decorate is idempotent (approval shell)');
  });
});

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

// ---- term-coverage gate: check-2b (data-term validity) red case (LOW fold e) ---

test('gate check-2b flags a data-term that names no registered term (red case)', () => {
  const termIds = new Set(CURATED_TERMS.map((t) => t.id));
  // A planted bogus marker parses out but resolves to no term → the gate's
  // validity check would push an error and exit 1.
  const bogus = dataTermMarkers('<div data-term="noSuchTerm"></div>');
  assert.equal(bogus.length, 1);
  assert.equal(bogus[0].id, 'noSuchTerm');
  assert.equal(termIds.has(bogus[0].id), false, 'the gate would report this marker as invalid');
  // A real id passes the same check; the JS-form markers parse too.
  assert.ok(termIds.has(dataTermMarkers("el.dataset.term = 'entropy';")[0].id));
  // And check-0 (spec coverage) is satisfied by the live registry.
  assert.deepEqual(missingSpecTerms(termIds), []);
});
