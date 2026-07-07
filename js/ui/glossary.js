// eigenorg glossary — mode-agnostic term lookup + the inline ⓘ affordance
// (P10b §8.5 / DESIGN-ELEVATION-spec §4d).
//
// TWO LAYERS the spec asks for, ONE mechanism:
//   (i)  the drift-gated param/mechanic deep-dive — the `plainLanguage` of the
//        linked assumptions.json item (`assumptionsId`), surfaced as the opt-in
//        "Show the numbers" reveal inside the popover. Its freshness is already
//        guaranteed by the extractor drift gate; this module only reads it.
//   (ii) the curated exec ⓘ lede — `plain` + `why` from glossary-terms.js.
//
// MODE-AGNOSTIC by construction (P7b reuse contract, §2b): this file contains
// ZERO 'org' / 'team' / '#org-' / '#team-' / preset-id literals. The DOM path is
// entirely `[data-term]`-driven, so P10b decorates org labels and P7b decorates
// team labels through the SAME createGlossary({...}).decorate(mount) — no edit
// here. buildTermIndex/resolveTerm never branch on mode.
//
// Never imports www/pkg (UI-thread wasm-isolation gate). Authors no model number
// (the coefficient-literal gate stays green — every number a reader sees is the
// drift-gated `plainLanguage` string, not a literal).

import { CURATED_TERMS } from './glossary-terms.js';

// ---- pure core (node-tested; no DOM) ----------------------------------------

/**
 * @typedef {{ id: string, label: string, surfaces: string[], plain: string,
 *             why: string, source: 'model' | 'curated',
 *             assumptionsId: string | null, deepDive: string | null }} TermEntry
 */

/**
 * Index one curated term into `index`, keyed by BOTH its id (the `data-term`
 * value) and every surface string, so resolveTerm works for a heading's
 * `data-term` AND for a raw on-screen surface (the gate's totality check).
 * Concept-first (C10): a display label resolves to its curated concept blurb,
 * never a raw coefficient — the `assumptionsId` link is the deep-dive only.
 * @param {Map<string, TermEntry>} index
 * @param {import('./glossary-terms.js').CuratedTerm} term
 * @param {Map<string, any>} itemsById parsed assumptions items, keyed by id
 */
function indexTerm(index, term, itemsById) {
  const assumptionsId = term.assumptionsId ?? null;
  const item = assumptionsId ? itemsById.get(assumptionsId) : null;
  /** @type {TermEntry} */
  const entry = {
    id: term.id,
    label: term.label,
    surfaces: term.surfaces,
    plain: term.plain,
    why: term.why,
    source: assumptionsId ? 'model' : 'curated',
    assumptionsId,
    // The deep-dive is the drift-gated model text; absent when the term is
    // sourceless OR when assumptions failed to load (graceful — the ⓘ then
    // simply omits the "Show the numbers" reveal).
    deepDive: item && typeof item.plainLanguage === 'string' ? item.plainLanguage : null,
  };
  index.set(term.id, entry);
  for (const surface of term.surfaces) index.set(surface, entry);
}

/**
 * Build the term index from the curated list + the parsed assumptions.
 * @param {{ assumptions?: any, curated?: import('./glossary-terms.js').CuratedTerm[] }} opts
 * @returns {Map<string, TermEntry>}
 */
export function buildTermIndex(opts = {}) {
  const curated = opts.curated ?? CURATED_TERMS;
  const items = Array.isArray(opts.assumptions?.items) ? opts.assumptions.items : [];
  /** @type {Map<string, any>} */
  const itemsById = new Map();
  for (const it of items) if (it && typeof it.id === 'string') itemsById.set(it.id, it);
  /** @type {Map<string, TermEntry>} */
  const index = new Map();
  for (const term of curated) indexTerm(index, term, itemsById);
  return index;
}

/**
 * Resolve a term key (a `data-term` id OR an on-screen surface string).
 * @param {Map<string, TermEntry>} index
 * @param {string} termKey
 * @returns {TermEntry | null}
 */
export function resolveTerm(index, termKey) {
  return index.get(termKey) ?? null;
}

/**
 * The gate's core assertion: which jargon surfaces resolve to NO term. Empty ⇒
 * every on-screen term maps to a curated entry (whose `assumptionsId`, when
 * present, is separately existence-checked against assumptions.json).
 * @param {string[]} jargonList
 * @param {Map<string, TermEntry>} index
 * @returns {string[]}
 */
export function uncoveredTerms(jargonList, index) {
  return jargonList.filter((surface) => !index.has(surface));
}

// THE ONE SANCTIONED P7b PATH (reuse contract): a new mode adds its terms by
// APPENDING entries to CURATED_TERMS in glossary-terms.js — nothing else.
// buildTermIndex reads that list, so the new terms auto-join the index, the
// derived JARGON_KNOWN_LIST, the coverage gate, and decorate(). There is
// deliberately NO runtime `register()` escape-hatch: a second registration path
// would let terms enter the index WITHOUT the gate seeing them (they would not be
// in CURATED_TERMS / JARGON_KNOWN_LIST), silently defeating the coverage gate.
// (The earlier `register()` export had zero production call sites and was removed
// in P10b-2 repair-1 to close that parallel path.)

// ---- DOM controller (browser only) ------------------------------------------

/** @param {string} tag @param {string} [cls] @param {string} [text] @returns {HTMLElement} */
function elc(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mount the glossary. The ⓘ is the codebase's proven native-<details> popover
 * (the why-eigen idiom): keyboard + tap, never hover-only, no new JS event
 * wiring. buildTermIndex runs once here from the shared, fetched-once
 * assumptions.
 * @param {{ assumptions?: any, curated?: import('./glossary-terms.js').CuratedTerm[] }} opts
 * @returns {{ tag: (termKey: string) => HTMLElement | null,
 *             decorate: (root: HTMLElement) => void,
 *             renderConsolidated: (mount: HTMLElement) => void,
 *             lookup: (termKey: string) => TermEntry | null }}
 */
export function createGlossary(opts = {}) {
  const index = buildTermIndex(opts);

  /**
   * The inline ⓘ: a <details> whose <summary> is a CSS-drawn serif "i" in a
   * hairline circle (never an emoji — emoji picks up a system colour and breaks
   * the single accent). The body is a surface-2 hairline card: the curated
   * plain + why, and (when a model deep-dive exists) an opt-in nested
   * "Show the numbers" reveal carrying the drift-gated `plainLanguage`.
   * @param {string} termKey
   * @returns {HTMLElement | null}
   */
  function tag(termKey) {
    const entry = resolveTerm(index, termKey);
    if (!entry) return null;

    const pop = elc('details', 'term-pop');
    const summary = /** @type {HTMLElement} */ (elc('summary', 'term-info', 'i'));
    // Accessible name is required (actor-observability — the reader can't act on
    // an unlabeled control). The visible "i" is decorative styling.
    summary.setAttribute('aria-label', `What '${entry.label}' means`);
    pop.appendChild(summary);

    // A <div> (not <span>): the body can hold the nested "Show the numbers"
    // <details>, and a <details> inside a <span> is invalid HTML. .term-pop-body
    // is already display:block, so this is a no-op visually.
    const body = elc('div', 'term-pop-body');
    body.setAttribute('role', 'note');
    body.appendChild(elc('span', 'term-pop-plain', entry.plain));
    const why = elc('span', 'term-pop-why');
    why.append(elc('strong', undefined, 'Why it matters: '), document.createTextNode(entry.why));
    body.appendChild(why);

    if (entry.deepDive) {
      const more = elc('details', 'term-pop-more');
      more.appendChild(elc('summary', 'term-pop-more-summary', 'Show the numbers'));
      more.appendChild(elc('span', 'term-pop-more-body', entry.deepDive));
      body.appendChild(more);
    }
    pop.appendChild(body);
    return pop;
  }

  /**
   * Walk `root` for `[data-term]` hosts and attach a ⓘ to each. Idempotent (a
   * re-decorate skips hosts already carrying a `.term-pop`). A host inside a
   * <summary> host (the approval-stack disclosure) is handled EXPLICITLY, never
   * silently skipped: a <details> ⓘ can't nest inside a <summary>, and an ⓘ
   * placed as a sibling AFTER the summary but INSIDE the drawer <details> would be
   * hidden while the drawer is closed (content-visibility on the details content).
   * So the ⓘ is mounted as a sibling of the drawer <details>, inside its
   * position:relative `.approval-shell`; CSS floats it into the summary row so it
   * stays visible open or closed, and clicking it toggles only the ⓘ (a sibling of
   * the drawer, not nested in it), never the drawer.
   * @param {HTMLElement} root
   */
  function decorate(root) {
    const hosts = /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-term]'));
    for (const host of hosts) {
      const key = host.dataset.term;
      if (!key) continue;

      const summaryEl = host.closest('summary');
      if (summaryEl) {
        // Summary host: mount the ⓘ on the enclosing shell (sibling of the
        // <details>), idempotent per shell. If the shell is missing (a data-term
        // on a bare summary), there is nowhere valid to mount — skip rather than
        // build invalid HTML.
        const details = summaryEl.closest('details');
        const shell = /** @type {HTMLElement | null} */ (details && details.parentNode);
        if (!shell || shell.querySelector(':scope > .term-pop')) continue;
        const info = tag(key);
        if (info) shell.appendChild(info);
        continue;
      }

      if (host.querySelector(':scope > .term-pop')) continue; // idempotent (flow hosts)
      const info = tag(key);
      if (!info) continue;
      // Place the ⓘ between the plain lead and the demoted tech-label (§4d).
      const techLabel = /** @type {HTMLElement | null} */ (host.querySelector(':scope > .tech-label'));
      if (techLabel) host.insertBefore(info, techLabel);
      else host.appendChild(info);
    }
  }

  /**
   * A supplementary consolidated glossary (NOT a substitute for the inline ⓘ):
   * one <details> per distinct term, plain + why, model-linked deep-dive inline.
   * Deduped by term id so aliased surfaces list once.
   * @param {HTMLElement} mount
   */
  function renderConsolidated(mount) {
    mount.textContent = '';
    /** @type {Set<string>} */
    const seen = new Set();
    const list = elc('div', 'glossary-list');
    for (const entry of index.values()) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const item = elc('details', 'glossary-item');
      item.appendChild(elc('summary', 'glossary-term', entry.label));
      const body = elc('div', 'glossary-body');
      body.appendChild(elc('p', 'glossary-plain', entry.plain));
      const why = elc('p', 'glossary-why');
      why.append(elc('strong', undefined, 'Why it matters: '), document.createTextNode(entry.why));
      body.appendChild(why);
      if (entry.deepDive) body.appendChild(elc('p', 'glossary-deep', entry.deepDive));
      item.appendChild(body);
      list.appendChild(item);
    }
    mount.appendChild(list);
  }

  return { tag, decorate, renderConsolidated, lookup: (termKey) => resolveTerm(index, termKey) };
}
