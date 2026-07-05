// P8 onboarding diagnostic — pure logic (scoring, storage flag, verbatim
// questions). DOM behaviour (once-only, focus, skip) is covered by the
// Playwright acceptance probe; this pins the model-facing invariants.

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
  STORAGE_KEY,
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
