// eigenorg Team lens — pure config/output logic (P7b), node-tested, no DOM.
//
// The Team-door analogue of ui/org.js's pure stratum: it reads a team config
// (roster of entities + work stream + structural health) and a team run output
// (the 12 series + 2 blocks, MODEL.md §7.2) and projects the plain-language
// digests, précis, coverage rows and quality summary the composer, charts and
// card render. It authors NO model number — every value shown is either a plain
// input the user set (an integer count, a structural-health dial) or a number
// read straight from a run's output (the coefficient-literal gate forbids
// hand-typed model coefficients in www/js; percentages are integer ×100 of a
// run/config fraction, never a bare float). Never imports www/pkg.

import { finalP50, deepCopy } from './runplan.js';

/** Normalise a negative zero to a positive zero so no "-0%" ever renders (the
 *  engine can emit -0.0 for a zero coverage score / count). @param {number} n */
function nz(n) {
  return n === 0 ? 0 : n;
}

// ---- the seven essential functions (config.v1.schema.json:164–172, §7.2) -----

/**
 * The seven team functions, in a stable render order, each with a plain-first
 * label and a demoted technical id. The plain lead is what the coverage heatmap
 * and ARIA table show; the technical id is the config/output key. Directional
 * prose only — no magnitudes (those come from the run's functionCoverage block).
 * @type {ReadonlyArray<{ id: string, label: string, plain: string }>}
 */
export const TEAM_FUNCTIONS = [
  { id: 'execution', label: 'Execution', plain: 'Doing the work' },
  { id: 'review', label: 'Review', plain: 'Checking the work' },
  { id: 'prioritization', label: 'Prioritization', plain: 'Deciding what to build' },
  { id: 'coordination', label: 'Coordination', plain: 'Keeping everyone in sync' },
  { id: 'stakeholderCommunication', label: 'Stakeholder updates', plain: 'Talking to stakeholders' },
  { id: 'synthesis', label: 'Synthesis', plain: 'Connecting the pieces' },
  { id: 'ambiguityResolution', label: 'Ambiguity resolution', plain: 'Untangling the unclear' },
];

/**
 * Coverage rating display metadata — a plain word + a non-colour glyph (shape,
 * not colour alone) + a card-legible fill token. `green|amber|red` are the
 * engine's deterministic ratings (functionCoverage block); the reader never sees
 * the raw words.
 * @type {Record<string, { word: string, glyph: string, fill: 'solid' | 'half' | 'open' }>}
 */
export const COVERAGE_RATING_META = {
  green: { word: 'covered', glyph: '●', fill: 'solid' },
  amber: { word: 'thin', glyph: '◐', fill: 'half' },
  red: { word: 'gap', glyph: '○', fill: 'open' },
};

/** @param {string} rating @returns {{ word: string, glyph: string, fill: 'solid' | 'half' | 'open' }} */
export function ratingMeta(rating) {
  return COVERAGE_RATING_META[rating] ?? COVERAGE_RATING_META.red;
}

// ---- roster reads (pure; read-only, never mutate the config) -----------------

/** @param {any} config @returns {any[]} the team roster (entities) */
export function entitiesOf(config) {
  return Array.isArray(config?.team?.entities) ? config.team.entities : [];
}

/** @param {any} entity @param {string} fn @returns {boolean} the entity covers `fn` */
export function entityCovers(entity, fn) {
  return Array.isArray(entity?.functions) && entity.functions.includes(fn);
}

/**
 * Roster composition counts (all integers — plain inputs the user composed).
 * "Workers" cover execution; "reviewers" cover review — the who-does-the-work /
 * who-reviews framing (binding delta 3).
 * @param {any} config
 * @returns {{ total: number, humans: number, ai: number, workers: number,
 *             humanWorkers: number, aiWorkers: number, reviewers: number }}
 */
export function rosterCounts(config) {
  const entities = entitiesOf(config);
  const workers = entities.filter((e) => entityCovers(e, 'execution'));
  const reviewers = entities.filter((e) => entityCovers(e, 'review'));
  return {
    total: entities.length,
    humans: entities.filter((e) => e.kind === 'human').length,
    ai: entities.filter((e) => e.kind === 'ai').length,
    workers: workers.length,
    humanWorkers: workers.filter((e) => e.kind === 'human').length,
    aiWorkers: workers.filter((e) => e.kind === 'ai').length,
    reviewers: reviewers.length,
  };
}

/**
 * The dominant work-mix descriptor + integer percentages. No float literal: the
 * label is chosen by comparing the three fractions to each other (the largest
 * wins) and the percentages are integer ×100 of the config fractions.
 * @param {any} config
 * @returns {{ label: string, routinePct: number, complexPct: number, novelPct: number }}
 */
export function workMix(config) {
  const mix = config?.team?.workStream?.mix ?? {};
  const routine = Number(mix.routine) || 0;
  const complex = Number(mix.complex) || 0;
  const novel = Number(mix.novel) || 0;
  const top = Math.max(routine, complex, novel);
  let label = 'balanced work';
  if (top === routine && routine > complex && routine > novel) label = 'mostly routine work';
  else if (top === novel && novel > routine && novel > complex) label = 'lots of novel work';
  else if (top === complex && complex > routine && complex > novel) label = 'mostly complex work';
  return {
    label,
    routinePct: Math.round(routine * 100),
    complexPct: Math.round(complex * 100),
    novelPct: Math.round(novel * 100),
  };
}

/**
 * The review-capacity descriptor: an integer per-step cap, or "unbounded" when
 * null/absent (M20). Plain reader units.
 * @param {any} config
 * @returns {{ bounded: boolean, perStep: number | null, label: string }}
 */
export function reviewCapacity(config) {
  const raw = config?.team?.reviewCapacityPerStep;
  const bounded = raw !== null && raw !== undefined;
  const perStep = bounded ? Number(raw) : null;
  return {
    bounded,
    perStep,
    label: bounded ? `${perStep} reviewed / step` : 'no review limit',
  };
}

// ---- setup digest + précis (mirror ui/org.js orgSetupChips / orgPrecis) -------

/**
 * The "Your team" chip summary (spec §6) — a compact human-readable digest of
 * the composed team, shown while the setup panel is collapsed. Pure; reads only
 * config fields the user composed. Authors no model number.
 * @param {any} config
 * @param {string} scenarioLabel
 * @returns {Array<{ label: string, value: string }>}
 */
export function teamSetupChips(config, scenarioLabel) {
  const c = rosterCounts(config);
  const sh = config?.team?.structuralHealth;
  const mix = workMix(config);
  const cap = reviewCapacity(config);
  const highStakes = highStakesSharePct(config);
  const modality = config?.team?.modality === 'meetingHeavy' ? 'Meeting-heavy' : 'Async-first';
  return [
    { label: 'Team', value: scenarioLabel },
    { label: 'Size', value: `${c.total} on the team` },
    { label: 'Doing the work', value: `${c.humanWorkers} human · ${c.aiWorkers} AI` },
    { label: 'Reviewing', value: c.reviewers === 1 ? '1 reviewer' : `${c.reviewers} reviewers` },
    { label: 'Work', value: mix.label },
    { label: 'High-stakes', value: `${highStakes}% high-stakes` },
    { label: 'Structural Health', value: `${sh ?? '—'} of 10` },
    { label: 'Review limit', value: cap.label },
    { label: 'Coordination', value: modality },
  ];
}

/**
 * The plain-English team précis (spec §4b.2) as segments; a `value:true` segment
 * is emphasised (bold ink — the accent stays reserved for Run). Pure; reads only
 * composed inputs, authors no model number.
 * @param {any} config
 * @returns {Array<{ text: string, value?: boolean }>}
 */
export function teamPrecisSentence(config) {
  const c = rosterCounts(config);
  const mix = workMix(config);
  const cap = reviewCapacity(config);
  const workers = `${c.workers} doing the work`;
  const reviewers = c.reviewers === 1 ? '1 reviewing it' : `${c.reviewers} reviewing it`;
  /** @type {Array<{ text: string, value?: boolean }>} */
  const parts = [
    { text: "You're testing a " },
    { text: `${c.total}-person team`, value: true },
    { text: ' — ' },
    { text: workers, value: true },
    { text: ` (${c.humanWorkers} human, ${c.aiWorkers} AI)` },
    { text: ' and ' },
    { text: reviewers, value: true },
    { text: ' — on ' },
    { text: mix.label, value: true },
    { text: ', with ' },
    { text: cap.label, value: true },
    { text: '.' },
  ];
  return parts;
}

// ---- run-output projections (§7.2 series + blocks; read-only) -----------------

/**
 * Rows for the function-coverage heatmap + ARIA table, in TEAM_FUNCTIONS order.
 * Reads the run's functionCoverage block (deterministic ratings/scores). The
 * score is a 0–1 fraction from the engine → integer percent for display.
 * @param {any} output a §7.2 team run output
 * @returns {Array<{ id: string, label: string, plain: string, scorePct: number,
 *                   rating: string, word: string, glyph: string, fill: string }>}
 */
export function functionCoverageRows(output) {
  const block = output?.functionCoverage ?? {};
  return TEAM_FUNCTIONS.map((fn) => {
    const cell = block[fn.id] ?? {};
    const rating = typeof cell.rating === 'string' ? cell.rating : 'red';
    const meta = ratingMeta(rating);
    const score = Number(cell.score);
    return {
      id: fn.id,
      label: fn.label,
      plain: fn.plain,
      scorePct: Number.isFinite(score) ? nz(Math.round(score * 100)) : 0,
      rating,
      word: meta.word,
      glyph: meta.glyph,
      fill: meta.fill,
    };
  });
}

/**
 * The coverage headline: how many of the seven jobs are covered vs have a gap,
 * and the plain labels of the gaps. All integer counts from the ratings block.
 * @param {any} output
 * @returns {{ covered: number, thin: number, gaps: number, total: number,
 *             gapLabels: string[] }}
 */
export function coverageSummary(output) {
  const rows = functionCoverageRows(output);
  const gapRows = rows.filter((r) => r.rating === 'red');
  return {
    covered: rows.filter((r) => r.rating === 'green').length,
    thin: rows.filter((r) => r.rating === 'amber').length,
    gaps: gapRows.length,
    total: rows.length,
    gapLabels: gapRows.map((r) => r.plain),
  };
}

/**
 * The quality histogram as display bars: the 10 engine bins with a total and the
 * integer percent each bin holds (share of completed work). Reads the pooled
 * qualityHistogram block; authors no number.
 * @param {any} output
 * @returns {{ bins: Array<{ lo: number, hi: number, count: number, pct: number }>,
 *             total: number, medianBinLo: number | null }}
 */
export function qualityHistogramModel(output) {
  const raw = /** @type {any[]} */ (Array.isArray(output?.qualityHistogram) ? output.qualityHistogram : []);
  const total = raw.reduce((s, b) => s + (Number(b.count) || 0), 0);
  const bins = raw.map((b) => ({
    lo: Number(b.lo),
    hi: Number(b.hi),
    count: Number(b.count) || 0,
    pct: total > 0 ? Math.round(((Number(b.count) || 0) / total) * 100) : 0,
  }));
  // The bin holding the median completed-task quality (cumulative count crosses
  // half the total) — a plain "most work ships around N" readout, integer math.
  let medianBinLo = null;
  if (total > 0) {
    let cumulative = 0;
    for (const b of bins) {
      cumulative += b.count;
      if (cumulative * 2 >= total) {
        medianBinLo = b.lo;
        break;
      }
    }
  }
  return { bins, total, medianBinLo };
}

/**
 * Settled (final-step p50) reads used by the chips/card/results. Each returns a
 * number straight from the run's series (never authored). Returns null when a
 * series is absent so callers render a pending state, not a guess.
 * @param {any} output
 * @param {string} seriesId
 * @returns {number | null}
 */
export function settledP50(output, seriesId) {
  const s = output?.series?.[seriesId];
  return Array.isArray(s) && s.length > 0 ? finalP50(s) : null;
}

/**
 * The card/results stat set, all run-derived. throughput total (cumThroughput
 * end), settled cohesion, settled coordination tax (fraction), settled review
 * wait, settled routine-decision latency (the recovery-cost signal, MODEL.md
 * §7.2), and cumulative brittleness — plus the coverage summary.
 * @param {any} output
 * @returns {{ shipped: number | null, cohesion: number | null,
 *             coordinationTaxPct: number | null, reviewWaitDays: number | null,
 *             decisionLatencyDays: number | null, brittleness: number | null,
 *             coverage: ReturnType<typeof coverageSummary> }}
 */
export function teamRunStats(output) {
  const tax = settledP50(output, 'coordinationTax');
  return {
    shipped: settledP50(output, 'cumThroughput'),
    cohesion: settledP50(output, 'cohesion'),
    coordinationTaxPct: tax === null ? null : Math.round(tax * 100),
    reviewWaitDays: settledP50(output, 'reviewWaitDays'),
    decisionLatencyDays: settledP50(output, 'decisionLatencyRoutine'),
    brittleness: settledP50(output, 'cumulativeBrittleness'),
    coverage: coverageSummary(output),
  };
}

// ---- guarded config edits (composer polish; validate()-safe) -----------------

/**
 * A clone of a config with the team roster replaced. Structural composition edits
 * (add/remove entity clones) route through here so the single canonical config is
 * the only write path. Strips replay/paramOverrides (an edit is authoring — the
 * same discipline as ui/org.js stripReplay) and re-points recoveryOwner to a
 * surviving entity when the prior owner was removed (validate() requires
 * recoveryOwner to name an existing entity, or be null).
 * @param {any} config
 * @param {any[]} entities the new roster
 * @returns {any} a new config
 */
export function configWithRoster(config, entities) {
  const next = deepCopy(config);
  delete next.replay;
  delete next.paramOverrides;
  next.team.entities = deepCopy(entities);
  const ids = new Set(entities.map((e) => e.id));
  if (next.team.recoveryOwner !== null && !ids.has(next.team.recoveryOwner)) {
    // The recovery owner was removed → re-point to the first surviving entity so
    // the config stays valid rather than silently dangling (M16 recovery owner).
    next.team.recoveryOwner = entities.length > 0 ? entities[0].id : null;
  }
  return next;
}

// ---- composer structural edits (validate()-safe; numbers preset-sourced) ------

/** Schema bounds on the roster (config.v1.schema.json team.entities). */
export const MIN_ENTITIES = 2;
export const MAX_ENTITIES = 12;

/** The two team coordination modalities (config schema enum). @type {ReadonlyArray<{ value: string, label: string }>} */
export const TEAM_MODALITIES = [
  { value: 'asyncFirst', label: 'Async-first' },
  { value: 'meetingHeavy', label: 'Meeting-heavy' },
];

/** Plain archetype labels for the roster + palette (strings, never model numbers). @type {Record<string, string>} */
export const ARCHETYPE_LABELS = {
  pm: 'Product manager',
  engineer: 'Engineer',
  aiExecution: 'AI executor',
  reviewer: 'Reviewer',
  director: 'Director',
};

/** @param {string} archetype @returns {string} a plain label, humanising unknown archetypes */
export function archetypeLabel(archetype) {
  if (ARCHETYPE_LABELS[archetype]) return ARCHETYPE_LABELS[archetype];
  const spaced = String(archetype).replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The role bucket an entity belongs to for the composer's who-does-what grouping:
 * anyone covering execution is "work"; else review → "review"; else "lead".
 * @param {any} entity @returns {'work' | 'review' | 'lead'}
 */
export function roleOf(entity) {
  if (entityCovers(entity, 'execution')) return 'work';
  if (entityCovers(entity, 'review')) return 'review';
  return 'lead';
}

/**
 * Build the add-a-seat catalog from the fetched team preset CONFIGS — one
 * representative entity template per archetype (first seen). Every number in a
 * template comes from the preset JSON (no coefficient literal is authored here);
 * addEntity clones a template and assigns a fresh id.
 * @param {any[]} configs team configs (each preset's primary run)
 * @returns {Array<{ archetype: string, kind: string, label: string, template: any }>}
 */
export function buildCatalog(configs) {
  /** @type {Map<string, any>} */
  const byArchetype = new Map();
  for (const config of configs) {
    for (const entity of entitiesOf(config)) {
      if (!byArchetype.has(entity.archetype)) byArchetype.set(entity.archetype, entity);
    }
  }
  return [...byArchetype.entries()].map(([archetype, entity]) => ({
    archetype,
    kind: entity.kind,
    label: archetypeLabel(archetype),
    template: entity,
  }));
}

/**
 * Add a clone of a catalog template to the roster with a fresh unique id. Returns
 * a new config, or null when the roster is already at MAX_ENTITIES.
 * @param {any} config @param {any} template a catalog entity template
 * @returns {any | null}
 */
export function addEntity(config, template) {
  const entities = entitiesOf(config).map((e) => deepCopy(e));
  if (entities.length >= MAX_ENTITIES) return null;
  const ids = new Set(entities.map((e) => e.id));
  const clone = deepCopy(template);
  let n = 1;
  let id = `${clone.archetype}${n}`;
  while (ids.has(id)) {
    n += 1;
    id = `${clone.archetype}${n}`;
  }
  clone.id = id;
  entities.push(clone);
  return configWithRoster(config, entities);
}

/**
 * Remove an entity by id. Guards the schema minimum (≥2 entities) and keeps at
 * least one entity doing the work (execution) so the team can still run. Returns
 * a new config, or null when a guard blocks the removal.
 * @param {any} config @param {string} id
 * @returns {any | null}
 */
export function removeEntity(config, id) {
  const entities = entitiesOf(config).filter((e) => e.id !== id);
  if (entities.length < MIN_ENTITIES) return null;
  if (!entities.some((e) => entityCovers(e, 'execution'))) return null;
  return configWithRoster(config, entities);
}

/**
 * The demanding-work share (complex + novel, as an integer percent) — what the
 * "how much of the work is complex or novel" dial reads/writes. Routine is the
 * remainder. Reads the config's mix; authors no number.
 * @param {any} config @returns {number} 0–100
 */
export function demandingSharePct(config) {
  const m = workMix(config);
  return m.complexPct + m.novelPct;
}

/**
 * The high-stakes work share as an integer percent (0–100) — what the high-stakes
 * dial reads/writes. Reads workStream.highStakesShare (0 when absent).
 * @param {any} config @returns {number}
 */
export function highStakesSharePct(config) {
  const raw = Number(config?.team?.workStream?.highStakesShare);
  return Number.isFinite(raw) ? Math.round(raw * 100) : 0;
}

/**
 * Apply one guarded team-level field edit (SH / review capacity / modality /
 * work-stream mix / high-stakes share). All validate()-safe: the numeric fields
 * clamp to their schema bounds, and the work-mix edit always keeps the three
 * fractions summing to 1 (validate() requires sum == 1 +/- 0.001) with every
 * fraction non-negative. Strips replay (an edit is authoring — the ui/org.js
 * stripReplay discipline).
 * @param {any} config
 * @param {'structuralHealth' | 'reviewCapacityPerStep' | 'modality' | 'mix' | 'highStakesShare'} field
 * @param {number | string | null} value
 * @returns {any} a new config
 */
export function applyTeamField(config, field, value) {
  const next = deepCopy(config);
  delete next.replay;
  delete next.paramOverrides;
  if (field === 'structuralHealth') {
    next.team.structuralHealth = Math.max(1, Math.min(10, Math.round(Number(value))));
  } else if (field === 'reviewCapacityPerStep') {
    if (value === null) {
      next.team.reviewCapacityPerStep = null;
    } else {
      // A non-finite entry (e.g. the number input accepts '1e999' → Infinity)
      // must NOT silently become UNBOUNDED: JSON.stringify(Infinity) === null,
      // which the engine reads as "no review limit" — the exact inverse of a
      // user-entered cap. Keep the previous finite cap (or 1) instead.
      const n = Math.round(Number(value));
      const prev = Math.round(Number(config?.team?.reviewCapacityPerStep));
      next.team.reviewCapacityPerStep = Number.isFinite(n)
        ? Math.max(1, n)
        : (Number.isFinite(prev) ? Math.max(1, prev) : 1);
    }
  } else if (field === 'modality') {
    const v = String(value);
    if (TEAM_MODALITIES.some((m) => m.value === v)) next.team.modality = v;
  } else if (field === 'mix') {
    // The user sets how much of the work is complex or novel — the "demanding"
    // share, an integer percent; routine takes the rest. The demanding share is
    // split between complex and novel preserving the config's current
    // complex:novel ratio (preset-sourced — no authored fractions), so routine +
    // complex + novel always == 1 exactly (validate()-safe) and each stays >= 0.
    const ws = next.team.workStream;
    const mix = ws.mix ?? {};
    const demanding = Math.max(0, Math.min(100, Math.round(Number(value)))) / 100;
    const c0 = Number(mix.complex) || 0;
    const n0 = Number(mix.novel) || 0;
    const denom = c0 + n0;
    const complexShare = denom > 0 ? c0 / denom : 1 / 2;
    ws.mix = {
      routine: 1 - demanding,
      complex: demanding * complexShare,
      novel: demanding * (1 - complexShare),
    };
  } else if (field === 'highStakesShare') {
    // Integer percent (0–100) → 0–1 fraction; a plain input the user sets.
    next.team.workStream.highStakesShare = Math.max(0, Math.min(100, Math.round(Number(value)))) / 100;
  }
  return next;
}
