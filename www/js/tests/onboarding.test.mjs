// Structural-Health diagnostic — pure logic (scoring, storage flag, verbatim
// questions). DOM behaviour is covered by the Playwright acceptance probe; this
// pins the model-facing invariants.
//
// P10b-2 DELIBERATE PIN UPDATE (decision log "P10b execution — pre-code folds
// APPLIED"): the P8 post-result auto-offer is RETIRED and the §3.4 questions now
// power a user-initiated inline SH helper (createStructuralHealthHelper). The
// PURE §3.4 referents (DIAGNOSTIC_QUESTIONS, ANSWER_SCORES, scoreStructuralHealth)
// are unchanged and still pinned VERBATIM here — the helper reuses them, so these
// invariants are MORE load-bearing, not less. shouldShowDiagnostic / the storage
// flag are RETAINED FOR BACKCOMPAT / P7b (no longer wired to any auto-fire path);
// their tests below now document the retired preset-gating semantics rather than
// a live code path (see the section header before them).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DIAGNOSTIC_QUESTIONS,
  ANSWER_SCORES,
  scoreStructuralHealth,
  readDiagnosticSeen,
  markDiagnosticSeen,
  shouldShowDiagnostic,
  STORAGE_KEY,
  createStructuralHealthHelper,
} from '../ui/onboarding.js';

const modelPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'MODEL.md');

// ---- SH mapping (PINNED §3.4) --------------------------------------------------

test('SH mapping is the pinned §3.4 formula: total 0→1, total 10→10, and a mid value', () => {
  assert.equal(scoreStructuralHealth([0, 0, 0, 0, 0]), 1); // total 0
  assert.equal(scoreStructuralHealth([2, 2, 2, 2, 2]), 10); // total 10
  assert.equal(scoreStructuralHealth([1, 1, 1, 1, 1]), 6); // total 5 → 1 + round(4.5) = 6
  assert.equal(scoreStructuralHealth([2, 1, 0, 0, 0]), 4); // total 3 → 1 + round(2.7) = 4
  assert.equal(scoreStructuralHealth([2, 2, 2, 1, 0]), 7); // total 7 → 1 + round(6.3) = 7
});

test('SH mapping stays clamped inside 1..10 for every reachable answer set', () => {
  for (let a = 0; a <= 2; a += 1) {
    for (let b = 0; b <= 2; b += 1) {
      const sh = scoreStructuralHealth([a, b, 2, 2, 2]);
      assert.ok(sh >= 1 && sh <= 10, `SH ${sh} out of range`);
    }
  }
});

// ---- questions are the §3.4 referents, VERBATIM --------------------------------

test('there are exactly five questions scored 0/1/2', () => {
  assert.equal(DIAGNOSTIC_QUESTIONS.length, 5);
  assert.deepEqual(ANSWER_SCORES, [0, 1, 2]);
  for (const q of DIAGNOSTIC_QUESTIONS) {
    for (const field of ['id', 'dimension', 'question', 'low', 'mid', 'high']) {
      assert.equal(typeof (/** @type {any} */ (q)[field]), 'string');
    }
  }
});

test('each question text + anchor phrases appear VERBATIM in MODEL.md §3.4 (drift guard)', () => {
  // §3.4 wraps questions across lines with indentation; normalize whitespace so
  // the content match is line-wrap-independent (the TEXT is what must be verbatim).
  const norm = (/** @type {string} */ s) => s.replace(/\s+/g, ' ').toLowerCase();
  const model = norm(readFileSync(modelPath, 'utf8'));
  for (const q of DIAGNOSTIC_QUESTIONS) {
    assert.ok(model.includes(norm(q.question)), `question not found verbatim in MODEL.md: "${q.question}"`);
    assert.ok(model.includes(norm(q.low)), `low anchor not found in MODEL.md: "${q.low}"`);
    assert.ok(model.includes(norm(q.high)), `high anchor not found in MODEL.md: "${q.high}"`);
  }
});

// ---- once-only storage flag (private-browsing safe) ----------------------------

/** A Map-backed Storage stub. @returns {any} */
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (/** @type {string} */ k) => (m.has(k) ? m.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => m.set(k, v),
  };
}

/** A Storage stub that throws on access (private browsing). @returns {any} */
function throwingStorage() {
  return {
    getItem() {
      throw new Error('storage disabled');
    },
    setItem() {
      throw new Error('storage disabled');
    },
  };
}

test('diagnostic-seen flag round-trips through storage', () => {
  const s = fakeStorage();
  assert.equal(readDiagnosticSeen(s), false);
  markDiagnosticSeen(s);
  assert.equal(readDiagnosticSeen(s), true);
  assert.equal(s.getItem(STORAGE_KEY), '1');
});

test('storage errors (private browsing) never throw — read is false, write is a no-op', () => {
  const s = throwingStorage();
  assert.doesNotThrow(() => markDiagnosticSeen(s));
  assert.equal(readDiagnosticSeen(s), false);
});

// ---- shouldShowDiagnostic — RETAINED FOR BACKCOMPAT / P7b (no longer wired) ----
//
// The P10b-2 re-scope RETIRED the auto-fire path (the SH diagnostic is now the
// user-initiated inline helper). These tests are DELIBERATELY KEPT to pin the
// retired preset-gating semantics for a future mode that might re-adopt an
// offered flow — the function stays pure + exported, so its contract stays
// documented even though main.js no longer calls it.

test('MED-2: a first PRESET result SHOWS the diagnostic', () => {
  assert.equal(shouldShowDiagnostic({ replay: false, presetId: 'fasterDysfunction', alreadyHandled: false }), true);
});

test('MED-2: a custom-authored first run does NOT show/consume the diagnostic (empty preset id)', () => {
  // The regression the fix closes: editing a control before the first run makes
  // this a CUSTOM run (presetId ''), which must not fire OR consume the once-only flag.
  assert.equal(shouldShowDiagnostic({ replay: false, presetId: '', alreadyHandled: false }), false);
});

test('MED-2: a share-link replay never shows the diagnostic (even for a non-empty id)', () => {
  assert.equal(shouldShowDiagnostic({ replay: true, presetId: 'fasterDysfunction', alreadyHandled: false }), false);
  assert.equal(shouldShowDiagnostic({ replay: true, presetId: '', alreadyHandled: false }), false);
});

test('MED-2: once handled (this session or a prior one), it never shows again', () => {
  assert.equal(shouldShowDiagnostic({ replay: false, presetId: 'fasterDysfunction', alreadyHandled: true }), false);
});

// ---- inline SH helper: Start-over reset (DOM-level) ----------------------------
//
// F5 (P10b-2 repair-1): the helper's collapse() — the ONLY external caller is
// resetToDefault (Start over) — must reset the radios to their defaultChecked
// neutrals, so a fresh boot and a post-Start-over boot present identical answers.
// (An in-session Close/Apply keeps answers; those call setExpanded directly.)

/** A minimal DOM node supporting exactly what the SH helper + form.reset() touch. */
class El {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.className = '';
    this.textContent = '';
    this.id = '';
    this.type = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    this._defaultChecked = false;
    this.hidden = false;
    this.htmlFor = '';
    /** @type {Record<string, string>} */ this.attributes = {};
    /** @type {any[]} */ this.children = [];
  }
  // Real DOM: setting defaultChecked (the `checked` content attribute) also sets
  // the initial checkedness, until the user (or reset()) changes it.
  get defaultChecked() {
    return this._defaultChecked;
  }
  set defaultChecked(/** @type {boolean} */ v) {
    this._defaultChecked = v;
    this.checked = v;
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this.attributes[k] = String(v);
  }
  appendChild(/** @type {any} */ n) {
    this.children.push(n);
    return n;
  }
  append(/** @type {any[]} */ ...ns) {
    for (const n of ns) this.children.push(n);
  }
  addEventListener() {}
  focus() {}
  /** HTMLFormElement.reset(): restore controls to their defaults (radios → defaultChecked). */
  reset() {
    for (const input of this.querySelectorAll('input')) input.checked = Boolean(input.defaultChecked);
  }
  /** @param {string} sel supports 'input' and 'input[type="radio"]' */
  querySelectorAll(sel) {
    const m = /^(\w+)(?:\[type="(\w+)"\])?$/.exec(sel);
    const tag = m ? m[1] : sel;
    const type = m ? m[2] : undefined;
    /** @type {any[]} */ const out = [];
    /** @param {any} node */
    const walk = (node) => {
      for (const c of node.children) {
        if (c && c.tagName === tag && (!type || c.type === type)) out.push(c);
        if (c && Array.isArray(c.children)) walk(c);
      }
    };
    walk(this);
    return out;
  }
  /** @param {string} sel */
  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length ? all[0] : null;
  }
}

/** Run `fn` with an El-backed globalThis.document. @param {() => void} fn */
function withDom(fn) {
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new El(t) };
  try {
    fn();
  } finally {
    /** @type {any} */ (globalThis).document = prev;
  }
}

test('F5: SH helper collapse() (Start over) resets the diagnostic answers to their fresh-boot defaults', () => {
  withDom(() => {
    const mount = new El('div');
    const helper = createStructuralHealthHelper(/** @type {any} */ (mount), { onScore: () => {} });

    const radios = mount.querySelectorAll('input[type="radio"]');
    assert.equal(radios.length, DIAGNOSTIC_QUESTIONS.length * ANSWER_SCORES.length, 'three options per question');

    // Fresh boot: exactly the neutral (defaultChecked) mid option of each question.
    const freshChecked = radios.map((/** @type {any} */ r) => r.checked);
    assert.equal(freshChecked.filter(Boolean).length, DIAGNOSTIC_QUESTIONS.length, 'one default per question');

    // Simulate answering Q1 with a non-default option (radio-group semantics:
    // uncheck its default mid, check its high). radios[1] is Q1 mid (oi===1).
    radios[1].checked = false;
    radios[2].checked = true;
    assert.notDeepEqual(radios.map((/** @type {any} */ r) => r.checked), freshChecked, 'the answer changed from fresh');

    // Start over collapses the helper → must reset the form to its defaults.
    helper.collapse();
    assert.deepEqual(
      radios.map((/** @type {any} */ r) => r.checked),
      freshChecked,
      'post-Start-over answers equal fresh boot',
    );
  });
});
