#!/usr/bin/env node
// Term-coverage gate for the plain-language layer (PLAN P10b; spec §8.5).
//
// The plain-language layer inverts every technical heading to a plain lead and
// demotes the jargon to a `.tech-label`, binding each heading to a `data-term`
// that glossary.decorate() turns into an inline ⓘ. This gate is the structural
// tripwire that keeps that wiring honest: a new jargon heading that ships
// WITHOUT a `data-term` (so no ⓘ, no plain lead) fails CI, and a curated term
// that links a renamed/removed model id fails CI.
//
// REGISTRY-DRIVEN, not a natural-language classifier (the coefficient-gate
// discipline): the single source of truth is glossary-terms.js (CURATED_TERMS +
// the derived JARGON_KNOWN_LIST), imported HERE and by glossary.js. Chart axis
// labels are canvas strings, meaning.js builds sentences at runtime, and the
// card is drawn on a canvas — none of that is a DOM heading, so none is swept.
//
// THREE checks:
//   1. NO DANGLING MODEL LINK. Every CURATED_TERMS[].assumptionsId (where
//      present) must EXIST in the live www/assumptions.json. Existence only —
//      the extractor drift gate owns content; this catches a renamed/removed
//      mechanic id that would silently blank a ⓘ deep-dive (risk R7).
//   2. HEADING-SURFACE SWEEP (index.html). Every <h2>/<h3> whose rendered text
//      contains a JARGON_KNOWN_LIST surface MUST carry a `data-term` (or be a
//      documented ALLOWLIST id). A bare jargon heading fails with file:line.
//      Plus DATA-TERM VALIDITY across index.html + www/js/ui/*.js (GLOB, so a
//      new mode's files auto-join — C2, P7b never edits this gate or ci.yml):
//      every `data-term` marker must name a real term id.
//   3. TOTALITY (spec's exact fail condition). uncoveredTerms(JARGON_KNOWN_LIST,
//      index).length === 0 — every on-screen term maps to a curated entry (a
//      registry self-consistency guard against a surface that fails to index).
//
// KNOWN OUT-OF-SCOPE (documented, same bar as the coefficient gate):
//   1. PROSE. meaning.js / onboarding.js sentences legitimately contain
//      "entropy", "coordination", etc. — the sweep is scoped to <h2>/<h3>
//      HEADINGS in index.html, never body prose, stat-row <dt> labels, section
//      eyebrows, chart aria-labels, or preset chips.
//   2. NON-index.html term-bearing surfaces (the SH control label rendered by
//      ui/org.js, the approval-stack <summary>): their coverage is enforced by
//      the data-term VALIDITY check (their marker must name a real id) + the
//      totality check (their surface must resolve), not by heading-text parsing
//      of dynamically-built DOM. This is the same scope trade the coefficient
//      gate makes: catch the common structural case, document the residue.
//
// Usage: node scripts/check_term_coverage.mjs
//   (paths are resolved relative to the repo root; no args.)

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURATED_TERMS, JARGON_KNOWN_LIST } from '../www/js/ui/glossary-terms.js';
import { buildTermIndex, uncoveredTerms } from '../www/js/ui/glossary.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * index.html heading ids allowed to contain a jargon surface WITHOUT a
 * `data-term`. Each is a documented per-run VALUE label, not the concept: the
 * before/after pane titles render "Structural Health 3" / "Structural Health 7"
 * (a run's SH value) — the Structural-Health CONCEPT ⓘ lives on the setup
 * control, not on every value readout.
 */
export const ALLOWLIST_HEADING_IDS = new Set(['pane-before-title', 'pane-after-title']);

/** Count 1-based line number at a character offset. @param {string} src @param {number} offset */
function lineAt(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

/** Strip HTML tags to rendered text. @param {string} html @returns {string} */
export function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Every <h2>/<h3> block in an HTML string.
 * @param {string} html
 * @returns {Array<{ tag: string, attrs: string, text: string, line: number }>}
 */
export function headingBlocks(html) {
  /** @type {Array<{ tag: string, attrs: string, text: string, line: number }>} */
  const out = [];
  const re = /<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ tag: m[1].toLowerCase(), attrs: m[2], text: stripTags(m[3]), line: lineAt(html, m.index) });
  }
  return out;
}

/** The `id="..."` of a heading's attribute string, or ''. @param {string} attrs */
function attrId(attrs) {
  const m = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs);
  return m ? m[1] : '';
}

/**
 * Every `data-term` value declared in a source string, across the HTML attribute
 * form and the two JS forms (dataset.term = '…', setAttribute('data-term', '…')).
 * @param {string} src
 * @returns {Array<{ id: string, line: number }>}
 */
export function dataTermMarkers(src) {
  /** @type {Array<{ id: string, line: number }>} */
  const out = [];
  const patterns = [
    /\bdata-term\s*=\s*["']([A-Za-z][\w-]*)["']/g, // HTML attr + JS template attr
    /\bdataset\.term\s*=\s*["']([A-Za-z][\w-]*)["']/g, // el.dataset.term = 'x'
    /setAttribute\(\s*["']data-term["']\s*,\s*["']([A-Za-z][\w-]*)["']/g, // setAttribute('data-term','x')
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) out.push({ id: m[1], line: lineAt(src, m.index) });
  }
  return out;
}

/**
 * Sweep index.html headings for jargon surfaces not bound to a data-term.
 * @param {string} html
 * @param {string[]} jargonList
 * @returns {Array<{ line: number, surface: string, text: string }>}
 */
export function sweepHeadings(html, jargonList) {
  /** @type {Array<{ line: number, surface: string, text: string }>} */
  const violations = [];
  for (const block of headingBlocks(html)) {
    const hasDataTerm = /\bdata-term\s*=/.test(block.attrs);
    if (hasDataTerm || ALLOWLIST_HEADING_IDS.has(attrId(block.attrs))) continue;
    for (const surface of jargonList) {
      if (block.text.includes(surface)) {
        violations.push({ line: block.line, surface, text: block.text });
        break; // one violation per unbound heading is enough to fix it
      }
    }
  }
  return violations;
}

/**
 * Curated terms whose assumptionsId links a model item that does not exist in
 * `assumptionIds` (Check 1). Existence only — the drift gate owns content.
 * @param {import('../www/js/ui/glossary-terms.js').CuratedTerm[]} curated
 * @param {Set<string>} assumptionIds
 * @returns {string[]} the offending term ids
 */
export function danglingLinks(curated, assumptionIds) {
  /** @type {string[]} */
  const out = [];
  for (const t of curated) if (t.assumptionsId && !assumptionIds.has(t.assumptionsId)) out.push(t.id);
  return out;
}

/** Collect www/js/ui/*.js (glob; a new mode's files auto-join). @param {string} root */
export function collectUiFiles(root) {
  return readdirSync(root)
    .filter((n) => /\.(js|mjs)$/.test(n) && !/\.test\./.test(n))
    .map((n) => path.join(root, n));
}

// ---- CLI ----------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const htmlPath = path.join(repoRoot, 'www', 'index.html');
  const assumptionsPath = path.join(repoRoot, 'www', 'assumptions.json');
  const uiDir = path.join(repoRoot, 'www', 'js', 'ui');

  const html = readFileSync(htmlPath, 'utf8');
  /** @type {any} */
  const assumptions = JSON.parse(readFileSync(assumptionsPath, 'utf8'));
  const assumptionIds = new Set((assumptions.items ?? []).map((/** @type {any} */ it) => it.id));
  const index = buildTermIndex({ assumptions });
  const termIds = new Set(CURATED_TERMS.map((t) => t.id));

  /** @type {string[]} */
  const errors = [];

  // Check 1 — no dangling model link.
  for (const id of danglingLinks(CURATED_TERMS, assumptionIds)) {
    const t = CURATED_TERMS.find((c) => c.id === id);
    errors.push(`glossary-terms.js: term "${id}" links assumptionsId "${t?.assumptionsId}" which is not in www/assumptions.json`);
  }

  // Check 2a — heading-surface sweep (index.html).
  for (const v of sweepHeadings(html, JARGON_KNOWN_LIST)) {
    errors.push(
      `www/index.html:${v.line}: heading "${v.text}" carries the jargon surface "${v.surface}" but no data-term — ` +
        `add data-term="<id>" so glossary.decorate() attaches the ⓘ (or allowlist a value-label heading id)`,
    );
  }

  // Check 2b — data-term validity (index.html + www/js/ui/*.js glob).
  const markerSources = [{ file: 'www/index.html', src: html }];
  for (const file of collectUiFiles(uiDir)) markerSources.push({ file: path.relative(repoRoot, file).replace(/\\/g, '/'), src: readFileSync(file, 'utf8') });
  for (const { file, src } of markerSources) {
    for (const marker of dataTermMarkers(src)) {
      if (!termIds.has(marker.id)) {
        errors.push(`${file}:${marker.line}: data-term "${marker.id}" names no term in glossary-terms.js CURATED_TERMS`);
      }
    }
  }

  // Check 3 — totality.
  const uncovered = uncoveredTerms(JARGON_KNOWN_LIST, index);
  if (uncovered.length > 0) {
    errors.push(`glossary-terms.js: ${uncovered.length} on-screen surface(s) resolve to no term: ${uncovered.join(', ')}`);
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    console.error(`FAIL: ${errors.length} term-coverage issue(s)`);
    process.exit(1);
  }
  console.log(`term-coverage gate clean: ${CURATED_TERMS.length} curated terms, ${JARGON_KNOWN_LIST.length} surfaces, all headings bound + all model links live`);
}
