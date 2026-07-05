#!/usr/bin/env node
// Coefficient-literal gate for www/js (PLAN Gate-ownership table row
// "Coefficient-literal grep in www/js | ci.yml step | P8"; PREMORTEM Story 3).
//
// The transparency moat depends on ONE source of truth for every model number:
// coefficients are read from `output.resolvedParams` at runtime (the P5/P6
// meaning.js pattern) and the drawer renders www/assumptions.json VERBATIM. A
// bare decimal coefficient hand-typed into UI code is exactly the third-source-
// of-truth drift that PREMORTEM Story 3 calls project-fatal.
//
// Mechanism (mirrors the Rust `tests/mechanics_lint.rs` byte scanner, ratified
// at the P8 gate): scan every browser-loaded file under www/js (tests excluded
// — they legitimately assert against expected numbers) for FLOAT literals (a
// number carrying a fraction dot or an exponent). A bare integer is not treated
// as a coefficient (array indices, canvas dimensions, step counts) — same
// posture as the Rust lint. Every float literal must appear in the commented
// ALLOWED list below (documented structural constants), or the gate fails.
//
// String and comment contents are stripped before scanning, so copy prose and
// rgba() colour alphas never false-match. KNOWN OUT-OF-SCOPE (documented, same
// bar as the pkg-isolation gate's string-concat note): a coefficient smuggled
// through string concatenation or arithmetic on integer literals defeats any
// lexical gate; the derive-from-resolvedParams convention + code review cover
// that residue. This gate is the structural tripwire against the common case.
//
// Usage: node scripts/check_no_coefficient_literals.mjs [root]
//   root defaults to www/js (tests point it at a planted throwaway tree).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural float constants the UI may spell out directly (NOT model
 * coefficients — those all come from resolvedParams / assumptions.json). Each
 * entry is justified by WHERE it appears and WHY it is not a coefficient.
 */
export const ALLOWED = new Set([
  '1.5', // charts/{entropy,lines}.js dataset borderWidth — visual line weight, not a model number
  '0.05', // ui/org.js headcountGrowth control STEP — UI slider increment (authoring granularity), not a coefficient value
]);

/**
 * Extract float numeric literals from a line of already-stripped code (strings
 * and comments removed). A token is a FLOAT only if it carries a fraction dot
 * or an exponent — a bare integer is not a coefficient. Ported from the Rust
 * `float_literals` scanner: a literal starts at a digit (or a `.digit`) that
 * does not continue an identifier or a prior number; `..` ranges and `.name`
 * member access are excluded; underscores are stripped before the compare.
 * @param {string} code
 * @returns {string[]}
 */
export function floatLiterals(code) {
  const b = code;
  /** @type {string[]} */ const out = [];
  let i = 0;
  const isDigit = (/** @type {string} */ c) => c >= '0' && c <= '9';
  const isAlnum = (/** @type {string} */ c) => /[A-Za-z0-9]/.test(c);
  while (i < b.length) {
    const c = b[i];
    const prev = i > 0 ? b[i - 1] : '';
    // A leading `.digit` float (e.g. `.5`), when the dot is not member access
    // on an identifier/number and not part of a `..` range.
    if (c === '.' && i + 1 < b.length && isDigit(b[i + 1]) && !isAlnum(prev) && prev !== '_' && prev !== '.') {
      const start = i;
      i += 1;
      while (i < b.length && (isDigit(b[i]) || b[i] === '_')) i += 1;
      i = consumeExponent(b, i);
      out.push(b.slice(start, i).replace(/_/g, ''));
      continue;
    }
    const startsNumber = isDigit(c) && !(prev && (isAlnum(prev) || prev === '_' || prev === '.'));
    if (!startsNumber) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < b.length && (isDigit(b[i]) || b[i] === '_')) i += 1;
    let isFloat = false;
    if (i < b.length && b[i] === '.') {
      const after = b[i + 1];
      const isRange = after === '.';
      const isAccess = after !== undefined && (/[A-Za-z]/.test(after) || after === '_');
      if (!isRange && !isAccess) {
        isFloat = true;
        i += 1;
        while (i < b.length && (isDigit(b[i]) || b[i] === '_')) i += 1;
      }
    }
    const afterExp = consumeExponent(b, i);
    if (afterExp !== i) {
      isFloat = true;
      i = afterExp;
    }
    if (isFloat) out.push(b.slice(start, i).replace(/_/g, ''));
  }
  return out;
}

/** Consume an `[eE][+-]?digit+` exponent starting at i; returns the new index (== i if none). */
function consumeExponent(/** @type {string} */ b, /** @type {number} */ i) {
  if (i >= b.length || (b[i] !== 'e' && b[i] !== 'E')) return i;
  let j = i + 1;
  if (j < b.length && (b[j] === '+' || b[j] === '-')) j += 1;
  if (j < b.length && b[j] >= '0' && b[j] <= '9') {
    j += 1;
    while (j < b.length && ((b[j] >= '0' && b[j] <= '9') || b[j] === '_')) j += 1;
    return j;
  }
  return i;
}

/**
 * Blank out comment and string/template contents, replacing them with spaces
 * (positions preserved so line numbers stay accurate). Template `${...}`
 * expressions re-enter code mode so a coefficient inside an interpolation is
 * still scanned.
 * @param {string} src
 * @returns {string}
 */
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  /** @type {number[]} */ const templateStack = []; // brace depths at each nested template
  let braceDepth = 0;
  while (i < n) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < n && src[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (two === '/*') {
      while (i < n && src.slice(i, i + 2) !== '*/') { out += src[i] === '\n' ? '\n' : ' '; i += 1; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      out += ' ';
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) { out += ' '; i += 1; }
      continue;
    }
    if (c === '`') {
      out += ' ';
      i += 1;
      // Scan template text, blanking it, until the closing backtick or a `${`.
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src.slice(i, i + 2) === '${') {
          templateStack.push(braceDepth);
          braceDepth += 1;
          out += ' ${'; // re-enter code mode; keep chars so scanning resumes
          i += 2;
          break;
        }
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n && src[i] === '`') { out += ' '; i += 1; }
      continue;
    }
    if (c === '{') { braceDepth += 1; out += c; i += 1; continue; }
    if (c === '}') {
      braceDepth -= 1;
      out += c;
      i += 1;
      // Closing a `${...}` returns to template-string text mode.
      if (templateStack.length > 0 && braceDepth === templateStack[templateStack.length - 1]) {
        templateStack.pop();
        while (i < n && src[i] !== '`') {
          if (src[i] === '\\') { out += '  '; i += 2; continue; }
          if (src.slice(i, i + 2) === '${') {
            templateStack.push(braceDepth);
            braceDepth += 1;
            out += ' ${';
            i += 2;
            break;
          }
          out += src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
        if (i < n && src[i] === '`') { out += ' '; i += 1; }
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Scan one file. Returns the list of disallowed float literals with line info.
 * @param {string} filePath
 * @returns {Array<{ line: number, literal: string, text: string }>}
 */
export function scanFile(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const stripped = stripCommentsAndStrings(src);
  const strippedLines = stripped.split('\n');
  const rawLines = src.split('\n');
  /** @type {Array<{ line: number, literal: string, text: string }>} */ const violations = [];
  for (let n = 0; n < strippedLines.length; n += 1) {
    for (const lit of floatLiterals(strippedLines[n])) {
      if (!ALLOWED.has(lit)) {
        violations.push({ line: n + 1, literal: lit, text: (rawLines[n] ?? '').trim() });
      }
    }
  }
  return violations;
}

/** Recursively collect *.js / *.mjs under root, excluding any `tests` dir. @param {string} root */
export function collectFiles(root) {
  /** @type {string[]} */ const files = [];
  const walk = (/** @type {string} */ dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === 'tests') continue;
        walk(full);
      } else if (/\.(js|mjs)$/.test(name)) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Scan a whole tree. Returns per-file violations.
 * @param {string} root
 * @returns {Array<{ file: string, line: number, literal: string, text: string }>}
 */
export function scanTree(root) {
  /** @type {Array<{ file: string, line: number, literal: string, text: string }>} */ const all = [];
  for (const file of collectFiles(root)) {
    for (const v of scanFile(file)) all.push({ file, ...v });
  }
  return all;
}

// ---- CLI ----------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www', 'js');
  const violations = scanTree(root);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${v.file}:${v.line}: bare float coefficient \`${v.literal}\` in www/js — read it from output.resolvedParams (or add a documented structural constant to ALLOWED)\n  ${v.text}`);
    }
    console.error(`FAIL: ${violations.length} coefficient-like literal(s) in ${root}`);
    process.exit(1);
  }
  console.log(`coefficient-literal gate clean: no bare float coefficients in ${root}`);
}
