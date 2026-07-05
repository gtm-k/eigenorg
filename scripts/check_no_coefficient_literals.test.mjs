// scripts/check_no_coefficient_literals.test.mjs
// Self-test for the P8 coefficient-literal gate (scripts/check_no_coefficient_literals.mjs).
//
// Proves three things the review needs (PLAN P8): (1) the float scanner is
// accurate — it finds real decimal literals and skips integers, ranges, member
// access and evasion forms; (2) comment/string stripping keeps prose and rgba
// alphas out but scans `${}` interpolations; (3) the gate FIRES on a seeded
// coefficient literal and stays CLEAN on the real www/js tree (the committed
// clean state). Throwaway probes live in an OS temp dir — never committed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  floatLiterals,
  stripCommentsAndStrings,
  scanFile,
  scanTree,
  ALLOWED,
} from './check_no_coefficient_literals.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const wwwJs = join(repoRoot, 'www', 'js');

// ---- scanner accuracy ----------------------------------------------------------

test('floatLiterals finds decimals and skips integers, ranges and member access', () => {
  assert.deepEqual(floatLiterals('const x = 0.036 * a[0] - 2;'), ['0.036']);
  assert.deepEqual(floatLiterals('for (let t = 0; t < horizon; t += 1) {}'), []);
  assert.deepEqual(floatLiterals('return arr.length + obj.p50;'), []);
  assert.deepEqual(floatLiterals('const r = [1, 10];'), []); // bare integers are not coefficients
});

test('floatLiterals catches evasion forms (leading dot, trailing dot, exponent, underscores)', () => {
  assert.deepEqual(floatLiterals('const a = .5;'), ['.5']);
  assert.deepEqual(floatLiterals('const b = 2.;'), ['2.']);
  assert.deepEqual(floatLiterals('const c = 1e-2;'), ['1e-2']);
  assert.deepEqual(floatLiterals('const d = 6.02E23;'), ['6.02E23']);
  assert.deepEqual(floatLiterals('const e = 1_000.5;'), ['1000.5']);
});

test('stripCommentsAndStrings removes comment + string floats but keeps ${} interpolation code', () => {
  assert.deepEqual(floatLiterals(stripCommentsAndStrings('const x = 1; // 0.35 in a comment')), []);
  assert.deepEqual(floatLiterals(stripCommentsAndStrings("const s = 'rgba(0,0,0,0.22)';")), []);
  assert.deepEqual(floatLiterals(stripCommentsAndStrings('const s = "at least 1.5x faster";')), []);
  // A coefficient inside a template interpolation is still code → still scanned.
  assert.deepEqual(floatLiterals(stripCommentsAndStrings('const s = `x=${0.35 * n}`;')), ['0.35']);
  // Block comments are stripped too.
  assert.deepEqual(floatLiterals(stripCommentsAndStrings('const x = 1; /* 0.42 */ const y = 2;')), []);
});

// ---- gate behaviour ------------------------------------------------------------

test('the gate FIRES on a seeded coefficient literal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eigenorg-coef-'));
  try {
    const file = join(dir, 'smuggled.js');
    writeFileSync(file, 'export const shRelief = 0.135; // hand-typed coefficient\n', 'utf8');
    const violations = scanFile(file);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].literal, '0.135');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the gate EXCLUDES a tests/ dir (expected numbers there are not coefficients)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eigenorg-coef-'));
  try {
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'x.test.mjs'), 'assert.equal(v, 0.42);\n', 'utf8');
    writeFileSync(join(dir, 'ok.js'), 'const n = 5;\n', 'utf8');
    assert.deepEqual(scanTree(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('allowed structural constants pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eigenorg-coef-'));
  try {
    const file = join(dir, 'chart.js');
    writeFileSync(file, 'const opts = { borderWidth: 1.5 };\n', 'utf8');
    assert.deepEqual(scanFile(file), []);
    assert.ok(ALLOWED.has('1.5'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real www/js tree is CLEAN (the committed clean state)', () => {
  const violations = scanTree(wwwJs);
  assert.deepEqual(
    violations,
    [],
    `unexpected coefficient literals in www/js:\n${violations.map((v) => `${v.file}:${v.line} ${v.literal} — ${v.text}`).join('\n')}`,
  );
});
