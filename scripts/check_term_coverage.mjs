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
// FOUR checks:
//   0. SPEC COVERAGE (registry vs the fixed §8.5 set). Every id in SPEC_TERMS —
//      a HARDCODED constant, NOT derived from CURATED_TERMS — must be registered
//      in CURATED_TERMS. This is the non-tautological guard: it catches a future
//      de-registration (a §8.5 term dropped from glossary-terms.js) that the
//      derived totality check (check 3), being self-referential, cannot. A
//      present-but-unwired term (functionCoverage, whose on-screen surface
//      arrives with P7b) still satisfies this — it need only be registered.
//   1. NO DANGLING MODEL LINK. Every CURATED_TERMS[].assumptionsId (where
//      present) must EXIST in the live www/assumptions.json. Existence only —
//      the extractor drift gate owns content; this catches a renamed/removed
//      mechanic id that would silently blank a ⓘ deep-dive (risk R7).
//   2. HEADING-SURFACE SWEEP (index.html) + DATA-TERM VALIDITY. Every <h2>/<h3>
//      or `.panel-title` in index.html whose rendered text contains a
//      JARGON_KNOWN_LIST surface MUST carry a `data-term` (or be a documented
//      ALLOWLIST id) — a bare jargon heading fails with file:line. And every
//      `data-term` marker across index.html + www/js/main.js + www/js/ui/*.js
//      (the ui GLOB so a new mode's files auto-join — C2; P7b never edits this
//      gate or ci.yml) must name a real term id.
//   3. TOTALITY (registry self-consistency). uncoveredTerms(JARGON_KNOWN_LIST,
//      index).length === 0. NOTE: JARGON_KNOWN_LIST is DERIVED from the same
//      CURATED_TERMS the index is built from, so this can only fail if indexing
//      drops a surface — it is a self-consistency guard, NOT (as the earlier
//      comment over-claimed) "every on-screen term maps to a term". The real
//      "no bare term ships" assurance is: the data-term marker convention (a
//      surface's plain lead carries data-term) + check 2's validity + spec
//      coverage (check 0), backed by the handoff jargon-sweep walkthrough.
//
// KNOWN OUT-OF-SCOPE (documented, same bar as the coefficient gate):
//   1. PROSE. meaning.js / onboarding.js sentences legitimately contain
//      "entropy", "coordination", etc. — the heading sweep is scoped to <h2>/<h3>
//      + `.panel-title` in index.html, never body prose, section eyebrows, chart
//      aria-labels, or preset chips.
//   2. RUNTIME-BUILT term labels (the pane-stat <dt> "Coordination tax" /
//      "Throughput", the legibility "Novel-task brittleness" row, the SH control
//      label, the Faster-Dysfunction preset note): these are NOT in static
//      index.html, so the heading-text sweep cannot see them.
//      Their coverage is instead enforced STRUCTURALLY — the data-term VALIDITY
//      check reads their markers from www/js/main.js + www/js/ui/*.js (their id
//      must be real) and the totality check keeps their surfaces resolvable. Same
//      scope trade the coefficient gate makes: catch the common structural case
//      by marker, document the residue. (The approval-stack term IS static in
//      index.html: data-term="approvalStack" sits on the drawer <summary>; a
//      <details> i-popover can't nest in a <summary>, so glossary.decorate mounts
//      the i on the summary's `.approval-shell` sibling instead — the data-term
//      marker is still swept by check 2b.)
//   3. SURFACE INVENTORY — remaining term-bearing surfaces, each with its
//      reader-path justification (reviewed at the P10b gate):
//      a. PRESET CHIP labels ("Faster Dysfunction", ...): reader path = the
//         preset note directly under the chips carries data-term=fasterDysfunction
//         and its inline i (wired at P10b repair F1/F2); other chip labels are
//         neutral scenario names (binding delta 7).
//      b. CARD CANVAS labels (www/js/share/card.js): canvas-rendered strings in
//         a FROZEN file (byte-identical share-card replay contract, P8-reviewed);
//         every term on the card mirrors an on-screen decorated pane surface.
//      c. CHART aria-labels: spoken descriptions for AT, not visual labels; the
//         visible heading above each chart is the decorated surface.
//      d. MODE-INTRO / placeholder prose: plain-language by construction (P10b
//         copy pass); jargon-swept at the phase-gate walkthrough, not by regex.
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

/**
 * The ten §8.5 layer-ii curated terms — the spec's FIXED set, hardcoded here on
 * PURPOSE (never derived from CURATED_TERMS) so the registry-vs-spec check
 * (check 0) is non-tautological: it fails if any of these is dropped from
 * glossary-terms.js. functionCoverage is registered but present-but-unwired
 * until P7b renders its surface — registration alone satisfies this check.
 * @type {string[]}
 */
export const SPEC_TERMS = [
  'approvalStack',
  'brittleness',
  'cohesion',
  'coordinationTax',
  'decisionVelocity',
  'entropy',
  'fasterDysfunction',
  'functionCoverage',
  'structuralHealth',
  'throughput',
];

/**
 * SPEC_TERMS ids missing from the registry (the term ids present in CURATED_TERMS).
 * @param {Set<string>} termIds
 * @returns {string[]}
 */
export function missingSpecTerms(termIds) {
  return SPEC_TERMS.filter((id) => !termIds.has(id));
}

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

/**
 * Every `.panel-title` wrapper block. The inverted headings put the plain lead in
 * the <h2> and the jargon in a sibling `.tech-label`, both inside this FLOW
 * wrapper that carries the `data-term` (so the inserted ⓘ <details> is valid).
 * Scanning the wrapper (not just the <h2>) is what keeps the surface — which now
 * lives OUTSIDE the h2 — inside the coverage sweep.
 * @param {string} html
 * @returns {Array<{ tag: string, attrs: string, text: string, line: number }>}
 */
export function panelTitleBlocks(html) {
  /** @type {Array<{ tag: string, attrs: string, text: string, line: number }>} */
  const out = [];
  // Match `panel-title` as a class TOKEN in any position (e.g.
  // class="reveal-item panel-title"), not only as the whole/first class — so a
  // future utility class on the wrapper cannot slip a jargon surface past the
  // sweep. The non-greedy body assumes panel-titles hold only their <h2> + a
  // <span> (no nested <div>), which holds across the page.
  const re = /<div\b([^>]*\bclass\s*=\s*["'][^"']*\bpanel-title\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ tag: 'panel-title', attrs: m[1], text: stripTags(m[2]), line: lineAt(html, m.index) });
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
 * Sweep index.html headings + `.panel-title` wrappers for jargon surfaces not
 * bound to a data-term. Both are scanned: a bare `<h2>Jargon</h2>` (a new heading
 * that forgot the wrapper + ⓘ) AND a `.panel-title` whose tech-label carries a
 * surface but whose wrapper has no data-term.
 * @param {string} html
 * @param {string[]} jargonList
 * @returns {Array<{ line: number, surface: string, text: string }>}
 */
export function sweepHeadings(html, jargonList) {
  /** @type {Array<{ line: number, surface: string, text: string }>} */
  const violations = [];
  for (const block of [...headingBlocks(html), ...panelTitleBlocks(html)]) {
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

/**
 * Collect www/js/ui/*.js (glob; a new mode's files auto-join — C2). FLAT-ONLY BY
 * DESIGN: ui/ is a flat directory of mode modules; the readdir is not recursive,
 * so a term-bearing file must live directly in ui/ (mirrored in the
 * glossary-terms.js escape-hatch note). If ui/ ever grows subdirectories, make
 * this recursive.
 * @param {string} root
 */
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
  const mainPath = path.join(repoRoot, 'www', 'js', 'main.js');

  const html = readFileSync(htmlPath, 'utf8');
  /** @type {any} */
  const assumptions = JSON.parse(readFileSync(assumptionsPath, 'utf8'));
  const assumptionIds = new Set((assumptions.items ?? []).map((/** @type {any} */ it) => it.id));
  const index = buildTermIndex({ assumptions });
  const termIds = new Set(CURATED_TERMS.map((t) => t.id));

  /** @type {string[]} */
  const errors = [];

  // Check 0 — registry covers the fixed §8.5 spec set (catches de-registration).
  for (const id of missingSpecTerms(termIds)) {
    errors.push(`glossary-terms.js: spec §8.5 term "${id}" (SPEC_TERMS) is not registered in CURATED_TERMS`);
  }

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

  // Check 2b — data-term validity (index.html + www/js/main.js + www/js/ui/*.js
  // glob). main.js is included explicitly because it renders the pane-stat labels
  // + the Faster-Dysfunction note marker; the ui/*.js glob is what lets a new
  // mode's files auto-join (C2).
  const markerSources = [
    { file: 'www/index.html', src: html },
    { file: 'www/js/main.js', src: readFileSync(mainPath, 'utf8') },
  ];
  for (const file of collectUiFiles(uiDir)) markerSources.push({ file: path.relative(repoRoot, file).replace(/\\/g, '/'), src: readFileSync(file, 'utf8') });
  for (const { file, src } of markerSources) {
    for (const marker of dataTermMarkers(src)) {
      if (!termIds.has(marker.id)) {
        errors.push(`${file}:${marker.line}: data-term "${marker.id}" names no term in glossary-terms.js CURATED_TERMS`);
      }
    }
  }

  // Check 3 — totality (registry self-consistency; see the header note — this
  // only trips if indexing drops a derived surface).
  const uncovered = uncoveredTerms(JARGON_KNOWN_LIST, index);
  if (uncovered.length > 0) {
    errors.push(`glossary-terms.js: ${uncovered.length} surface(s) failed to index (registry self-consistency): ${uncovered.join(', ')}`);
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    console.error(`FAIL: ${errors.length} term-coverage issue(s)`);
    process.exit(1);
  }
  console.log(
    `term-coverage gate clean: all ${SPEC_TERMS.length} §8.5 spec terms registered ` +
      `(${CURATED_TERMS.length} curated total, ${JARGON_KNOWN_LIST.length} surfaces), ` +
      `every data-term marker valid, all model links live`,
  );
}
