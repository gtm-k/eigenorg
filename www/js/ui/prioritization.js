// eigenorg Prioritization Layer Configurator (P6, the signature feature).
//
// Two strata in one module (P5 convention — node --test imports the pure
// stratum without a DOM):
//   (a) PURE CORE  — exported, DOM-free: the stack ⇄ config transforms, the
//       all-human twin, the flow-diagram projection, the recovery-owned
//       reading, and the rule-based "what this means" sentences. Every number
//       shown to the user comes from a run's `output` (series / perLayer /
//       resolvedParams, MODEL.md §7.1/§12.3) — NEVER a coefficient literal or a
//       golden bound (model/goldens.json is not browser-served; that absence is
//       deliberate — PREMORTEM S1). The §9.9 layer TYPES are the whole surface:
//       µ/matrix (M19) stay config-only in v1 (PLAN decision log 2026-07-05).
//   (b) DOM COMPONENT — `renderConfigurator(container, coordinator)`: the tap-
//       first stack builder, the recovery badge, the flow-diagram table, and
//       the all-human legibility comparison. Update-in-place (no innerHTML
//       nuke) so focus survives an edit-triggered re-render (F2).
//
// This module NEVER imports www/pkg — every run goes through P5's engine-client
// via the coordinator (main.js). It adds NO url-codec changes: the layer stack
// lives on the single canonical config, so share/replay work for free.

import { deepCopy, finalP50 } from './runplan.js';
import { stripReplay } from './org.js';

// ---- the four §9.9 ownership-seat types (the P6 model surface) --------------

/**
 * The closed enum of ownership-seat types (MODEL.md §9.9 / config schema).
 * `humanPm` is the neutral identity (factors 1,1,1,0 — hardcoded no-op, §9.9).
 * @type {ReadonlyArray<'humanPm' | 'humanDirector' | 'aiAgent' | 'committee'>}
 */
export const LAYER_TYPES = ['humanPm', 'humanDirector', 'aiAgent', 'committee'];

/** The neutral identity type appended when a stack grows (§9.9). */
export const DEFAULT_LAYER_TYPE = 'humanPm';

// Schema bounds on `org.ownershipLayers` (MODEL.md §12.2 / config.v1.schema).
// These are STRUCTURAL bounds on the layer count — not params.json
// coefficients (the P8 no-coefficient-literal gate targets the §9.9 editorial
// factors, which never appear in this file — every model number is read from a
// run's resolvedParams/series at render time).
export const MIN_LAYERS = 1;
export const MAX_LAYERS = 5;

/**
 * Per-type display metadata: a short label, a shape glyph (a non-color
 * distinguisher, F3), and a one-line meaning. The meaning is DIRECTIONAL prose
 * from §9.9 — it carries NO magnitudes (no "40% faster"); magnitudes belong to
 * the run outputs, not to authored copy (failure G4).
 * @type {Record<string, { label: string, glyph: string, desc: string }>}
 */
export const LAYER_TYPE_META = {
  humanPm: {
    label: 'Human PM',
    glyph: '●',
    desc: 'Baseline PM seat — the neutral approval layer.',
  },
  humanDirector: {
    label: 'Human Director',
    glyph: '◆',
    desc: 'Senior seat: deliberates longer per item and reviews fewer, concentrating the queue at the top of the stack.',
  },
  aiAgent: {
    label: 'AI Prioritization Agent',
    glyph: '▲',
    desc: 'AI approval seat: routes routine decisions faster and adds bandwidth with clean relay — but exposes novel work to brittleness.',
  },
  committee: {
    label: 'Committee',
    glyph: '■',
    desc: 'Group seat: slower and lower-bandwidth, but many eyes garble less relayed context, so it triggers fewer distortion-driven overrides.',
  },
};

/**
 * @param {string} type
 * @returns {{ label: string, glyph: string, desc: string }}
 */
export function typeMeta(type) {
  return LAYER_TYPE_META[type] ?? LAYER_TYPE_META.humanPm;
}

// ---- stack ⇄ config (the single-owner mutation path that closes A1) ---------

/**
 * The UI stack for a config: an array of `L = org.ownershipLayers` seat types.
 * When `org.layerTypes` is absent every seat reads `humanPm` (§9.9 neutral
 * identity). Read-only — does NOT mutate or add fields to the config.
 * @param {any} config
 * @returns {string[]}
 */
export function stackFromConfig(config) {
  const L = clampLayerCount(Number(config?.org?.ownershipLayers));
  const types = Array.isArray(config?.org?.layerTypes) ? config.org.layerTypes : null;
  const stack = [];
  for (let i = 0; i < L; i += 1) {
    stack.push(types && typeof types[i] === 'string' ? types[i] : DEFAULT_LAYER_TYPE);
  }
  return stack;
}

/**
 * Clamp a layer count into the §12.2 range and snap to an integer.
 * @param {number} raw
 * @returns {number}
 */
export function clampLayerCount(raw) {
  const v = Number.isFinite(raw) ? Math.round(raw) : MIN_LAYERS;
  return Math.max(MIN_LAYERS, Math.min(MAX_LAYERS, v));
}

/**
 * Grow (pad `humanPm`) or shrink (truncate) a stack to `newL`, clamped to
 * [1,5]. Maintains the serde-only length invariant by construction (A1): the
 * stack IS the length, so there is no second write path to drift.
 * @param {string[]} stack
 * @param {number} newL
 * @returns {string[]}
 */
export function resizeStack(stack, newL) {
  const L = clampLayerCount(newL);
  const out = stack.slice(0, L);
  while (out.length < L) out.push(DEFAULT_LAYER_TYPE);
  return out;
}

/**
 * Assign `type` to seat `index` (0-based), returning a NEW stack. Unknown
 * types are rejected (the enum is closed, §9.9) so the DOM layer can never emit
 * an off-enum value.
 * @param {string[]} stack
 * @param {number} index
 * @param {string} type
 * @returns {string[]}
 */
export function assignType(stack, index, type) {
  if (!LAYER_TYPES.includes(/** @type {any} */ (type))) {
    throw new Error(`unknown layer type: ${type}`);
  }
  if (index < 0 || index >= stack.length) {
    throw new Error(`seat index out of range: ${index}`);
  }
  const out = stack.slice();
  out[index] = type;
  return out;
}

/** @param {string[]} stack @returns {boolean} every seat is the neutral humanPm identity */
export function isAllHuman(stack) {
  return stack.every((t) => t === DEFAULT_LAYER_TYPE);
}

/** @param {any} config @returns {boolean} the config's stack has a non-humanPm seat (an all-human twin would differ) */
export function hasNonHumanLayer(config) {
  return !isAllHuman(stackFromConfig(config));
}

/**
 * Write a stack back onto a config (the single P6 config writer). Authoring
 * semantics, mirroring P5's ui/org.js pattern exactly:
 *   - strips replay/paramOverrides (a stack edit is AUTHORING — CONTRACTS §4;
 *     forwarding replay:true would launder an authored config past range
 *     validation, the B2 contract violation),
 *   - keeps `ownershipLayers` and `layerTypes.length` in lockstep (A1),
 *   - resizes `layerOwnerCount` / re-applies the §12.1 matrix-terminal rule
 *     when those (config-only, v1) fields are present on a hydrated config,
 *   - PRESERVES field absence: an untouched all-`humanPm` stack on a config
 *     that never had `layerTypes` does NOT gain the field (byte-preservation
 *     for hydrated/replayed configs; §9.9 neutral identity, A5 no-null rule).
 * @param {any} config
 * @param {string[]} stack
 * @returns {any} a new config
 */
export function configWithStack(config, stack) {
  const next = deepCopy(config);
  stripReplay(next);
  const L = stack.length;
  next.org.ownershipLayers = L;

  const wasAbsent = !Array.isArray(config?.org?.layerTypes);
  if (wasAbsent && isAllHuman(stack)) {
    // Neutral identity on a config that never declared layerTypes → leave it
    // absent (deepCopy already omitted it): byte-identical to the base model.
    delete next.org.layerTypes;
  } else {
    next.org.layerTypes = stack.slice();
  }

  if (Array.isArray(next.org.layerOwnerCount)) {
    next.org.layerOwnerCount = next.org.layerOwnerCount.slice(0, L);
    while (next.org.layerOwnerCount.length < L) next.org.layerOwnerCount.push(1);
    if (next.org.matrix?.enabled && next.org.layerOwnerCount[L - 1] !== 1) {
      next.org.layerOwnerCount[L - 1] = 1; // §12.1 matrix target seat rule
    }
  }
  return next;
}

/**
 * The all-`humanPm` counterfactual of a config (§10.6 `allHuman` run) — the
 * baseline that makes the AI seat's brittleness attributable (§11.7). Keeps
 * EVERYTHING else, INCLUDING any replay/paramOverrides, so a replayed config's
 * twin runs on the same coefficients (twin philosophy — runplan.js). Only
 * `org.layerTypes` becomes an explicit all-`humanPm` array of length L.
 * @param {any} config
 * @returns {any}
 */
export function allHumanTwin(config) {
  const twin = deepCopy(config);
  const L = clampLayerCount(Number(config?.org?.ownershipLayers));
  twin.org.layerTypes = Array.from({ length: L }, () => DEFAULT_LAYER_TYPE);
  return twin;
}

// ---- flow-diagram projection (from perLayer, §7.1) --------------------------

/**
 * @typedef {{ layer: number, layerType: string, meanLatencyDays: number,
 *             meanQueue: number, utilization: number, overrideShare: number,
 *             distortion: number, bottleneck: boolean }} FlowRow
 */

/**
 * The Flow-Diagram render model from a run's `perLayer` block (§7.1). A pure
 * projection — the renderer displays these fields with honest labels (share of
 * overrides, NOT rate — G1; queued items, NOT WIP — G3; busiest seat, NOT an
 * alarm — G2).
 * @param {any} output a §12.3-shaped run output
 * @returns {FlowRow[]}
 */
export function flowRows(output) {
  const perLayer = Array.isArray(output?.perLayer) ? output.perLayer : [];
  return perLayer.map((/** @type {any} */ l) => ({
    layer: l.layer,
    layerType: l.layerType,
    meanLatencyDays: l.meanLatencyDays,
    meanQueue: l.meanQueue,
    utilization: l.utilization,
    overrideShare: l.overrideShare,
    distortion: l.distortion,
    bottleneck: Boolean(l.bottleneck),
  }));
}

// ---- recovery ownership (M10, SH-derived — read-only, A4) -------------------

/**
 * Whether AI-failure recovery is OWNED for an org config: `SH ≥
 * recoveryOwnershipThreshold` (M10). The threshold is read from the run's
 * effective coefficient set (`resolvedParams`, §12.3) — never a JS literal, so
 * it stays correct under paramOverrides/replay and can never drift from
 * MODEL.md. Returns `null` when no run output is available yet (pending) — the
 * caller renders a pending state, not a guess.
 * @param {any} config
 * @param {any} resolvedParams the run output's resolvedParams (or undefined pre-run)
 * @returns {boolean | null}
 */
export function recoveryOwned(config, resolvedParams) {
  const threshold = Number(resolvedParams?.recoveryOwnershipThreshold);
  const sh = Number(config?.org?.structuralHealth);
  if (!Number.isFinite(threshold) || !Number.isFinite(sh)) return null;
  return sh >= threshold;
}

// ---- legibility summary + "what this means" (directional; outputs only) -----

/**
 * Settled first-pass decision latency (days): the last-step p50 of the
 * `decisionLatency` series — the settled value the §11.7 predicate reads. No
 * window literal: the final step IS the settled reading for these static
 * configs. Returns null when the series is absent.
 * @param {any} output
 * @returns {number | null}
 */
export function settledLatency(output) {
  const s = output?.series?.decisionLatency;
  return Array.isArray(s) && s.length > 0 ? finalP50(s) : null;
}

/**
 * Cumulative novel-task brittleness at run end (events): the last-step p50 of
 * `cumulativeBrittleness` (0 unless an aiAgent seat or org injection is present
 * — §7.1). Returns null when the series is absent.
 * @param {any} output
 * @returns {number | null}
 */
export function cumulativeBrittleness(output) {
  const s = output?.series?.cumulativeBrittleness;
  return Array.isArray(s) && s.length > 0 ? finalP50(s) : null;
}

/**
 * The comparison summary the legibility panel renders: settled latency and
 * cumulative brittleness for the current stack and (when present) its all-human
 * twin. Every number is read from a run output — none is authored.
 * @param {any} primaryOutput
 * @param {any} [twinOutput]
 * @returns {{ primary: { latency: number | null, brittleness: number | null },
 *             twin: { latency: number | null, brittleness: number | null } | null }}
 */
export function legibilitySummary(primaryOutput, twinOutput) {
  return {
    primary: { latency: settledLatency(primaryOutput), brittleness: cumulativeBrittleness(primaryOutput) },
    twin: twinOutput
      ? { latency: settledLatency(twinOutput), brittleness: cumulativeBrittleness(twinOutput) }
      : null,
  };
}

/** @param {number} v @param {number} [dp] */
const fmt = (v, dp = 1) => v.toFixed(dp);
/** @param {number} v */
const evt = (v) => `${Math.round(v)} event${Math.round(v) === 1 ? '' : 's'}`;

/**
 * One directional, rule-based sentence for the current stack. When both a
 * primary and an all-human twin output are given, magnitudes are COMPUTED from
 * the two runs (legal — engine numbers). With no outputs it states the
 * mechanism direction only. It never emits a coefficient value or a golden
 * bound (G4) — enforced by test 8's literal grep.
 * @param {any} config
 * @param {any} [primaryOutput]
 * @param {any} [twinOutput]
 * @returns {string}
 */
export function whatThisMeans(config, primaryOutput, twinOutput) {
  const stack = stackFromConfig(config);
  const L = stack.length;
  const hasAi = stack.includes('aiAgent');
  const hasCommittee = stack.includes('committee');
  const hasDirector = stack.includes('humanDirector');

  if (hasAi && primaryOutput && twinOutput) {
    const latA = settledLatency(primaryOutput);
    const latH = settledLatency(twinOutput);
    const britA = cumulativeBrittleness(primaryOutput);
    const britH = cumulativeBrittleness(twinOutput);
    if (latA !== null && latH !== null && britA !== null && britH !== null) {
      return (
        `With an AI agent in an approval seat, settled first-pass decisions land at ${fmt(latA)} days ` +
        `versus ${fmt(latH)} days for the all-human stack, and the AI-seat stack logs ${evt(britA)} of ` +
        `novel-task brittleness against the all-human stack's ${evt(britH)} — the routing speed-up arrives ` +
        `bundled with novel exposure.`
      );
    }
  }
  if (hasAi) {
    return (
      'This stack puts an AI agent in an approval seat: it routes routine decisions faster and adds approval ' +
      'bandwidth, but it exposes novel work to brittleness. Turn on the all-human comparison and run to see ' +
      'both effects side by side.'
    );
  }
  if (hasCommittee) {
    return (
      'A committee seat trades speed for fidelity — it sits on each decision longer and clears fewer per day, ' +
      'but its many eyes garble less relayed context, so it triggers fewer distortion-driven overrides.'
    );
  }
  if (hasDirector) {
    return (
      'A director seat deliberates longer per item and reviews fewer, concentrating the queue at the top of ' +
      'the stack and slowing the decisions that pass through it.'
    );
  }
  if (L > 1) {
    return (
      `An all-human stack of ${L} approval layers carries a prioritization tax: every added seat lengthens ` +
      'latency and adds a fresh chance to override and reset in-progress work. There are no novel-task ' +
      'brittleness events — no AI seat is present.'
    );
  }
  return (
    'A single all-human approval layer: latency and overrides are set by one human relay, and there are no ' +
    'novel-task brittleness events because no AI seat is present.'
  );
}
