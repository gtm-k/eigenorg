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

// =====================================================================
// (b) DOM COMPONENT — browser only. Never touches `document` at import
//     time; every reference lives inside renderConfigurator's closures
//     (so node --test can import the pure stratum above). Update-in-place
//     throughout: rows/radios are mutated, never innerHTML-nuked, so focus
//     survives an edit-triggered re-render (F2) and the flow diagram keeps
//     its subtree (D2).
// =====================================================================

/** @param {string} tag @param {string} [cls] @param {string} [text] @returns {HTMLElement} */
function elc(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {number} share 0..1 to an integer percent, never NaN (G1 all-zero case) @returns {string} */
function pct(share) {
  const v = Number(share);
  return `${Number.isFinite(v) ? Math.round(v * 100) : 0}%`;
}

/**
 * Mount the configurator into `container`. The coordinator owns the single
 * canonical config + the run pipeline (main.js); this component only reads it
 * (stackFromConfig) and writes edits back through `onConfigChange` — the SAME
 * hook P5's org controls use, so there is one editing surface for layer
 * structure (subsumes P5's ownership-layers control; closes B5) and share/
 * replay stay free.
 *
 * @param {HTMLElement} container
 * @param {{ getConfig: () => any,
 *           onConfigChange: (config: any) => void,
 *           onCompareToggle: () => void }} coordinator
 * @returns {{ refresh: () => void,
 *             renderRun: (primaryRun: any, twinRun: any | null) => void,
 *             setPending: () => void,
 *             getCompareOn: () => boolean,
 *             setCompareDefault: (on: boolean) => void }}
 */
export function renderConfigurator(container, coordinator) {
  let compareOn = false;

  // ---- toolbar: add / remove / compare ----
  const toolbar = elc('div', 'cfg-toolbar');
  const countLabel = elc('span', 'cfg-count');
  const addBtn = /** @type {HTMLButtonElement} */ (elc('button', 'cfg-btn'));
  addBtn.type = 'button';
  addBtn.textContent = 'Add layer';
  const removeBtn = /** @type {HTMLButtonElement} */ (elc('button', 'cfg-btn'));
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove layer';

  const compareWrap = elc('label', 'cfg-compare');
  const compareBox = /** @type {HTMLInputElement} */ (document.createElement('input'));
  compareBox.type = 'checkbox';
  compareBox.id = 'cfg-compare-toggle';
  const compareText = elc('span', undefined, 'Compare to all-human stack');
  compareWrap.append(compareBox, compareText);

  toolbar.append(countLabel, addBtn, removeBtn, compareWrap);

  // ---- the stack (an ordered list; work enters at layer 1) ----
  const stackList = /** @type {HTMLOListElement} */ (document.createElement('ol'));
  stackList.className = 'cfg-stack';
  stackList.setAttribute('role', 'list');

  // ---- recovery indicator (read-only, M10 SH-derived; A4) ----
  const recovery = elc('div', 'cfg-recovery');
  const recoveryIcon = elc('span', 'cfg-recovery-icon', '○');
  recoveryIcon.setAttribute('aria-hidden', 'true');
  const recoveryText = elc('span', 'cfg-recovery-text', 'Recovery of AI failures: run to evaluate');
  recovery.append(recoveryIcon, recoveryText);

  // ---- flow diagram (semantic table; D2/G1-G3) ----
  const flowWrap = elc('div', 'cfg-flow');
  const flowHeading = elc('h3', 'cfg-subhead', 'Prioritization flow');
  const flowScroll = elc('div', 'cfg-flow-scroll'); // own overflow-x, never the page (E3)
  const flowPending = elc('p', 'cfg-pending', 'Run the simulation to see per-layer latency, queues, overrides and the busiest seat.');
  flowWrap.append(flowHeading, flowPending, flowScroll);

  // ---- legibility panel (all-human comparison + the sentence) ----
  const legWrap = elc('div', 'cfg-legibility');
  const legHeading = elc('h3', 'cfg-subhead', 'AI seat vs all-human');
  const legBody = elc('div', 'cfg-leg-body');
  const legSentence = elc('p', 'cfg-leg-sentence');
  legWrap.append(legHeading, legBody, legSentence);

  // ---- polite announcements for assignments (F1/F4; run state stays on #run-status) ----
  const live = elc('div', 'cfg-live sr-only');
  live.setAttribute('aria-live', 'polite');

  container.append(toolbar, stackList, recovery, flowWrap, legWrap, live);

  /** @param {string} msg */
  const announce = (msg) => { live.textContent = msg; };

  // ---- row bookkeeping (update-in-place; rows only append/remove at the end) ----
  /** @type {Array<{ li: HTMLElement, radios: HTMLButtonElement[], desc: HTMLElement }>} */
  const rows = [];

  /** Apply a stack edit: build the new config and hand it to the coordinator. @param {string[]} stack */
  const commit = (stack) => {
    coordinator.onConfigChange(configWithStack(coordinator.getConfig(), stack));
  };

  /** Current stack, straight off the canonical config. @returns {string[]} */
  const currentStack = () => stackFromConfig(coordinator.getConfig());

  /** @param {number} index @param {HTMLElement} li @param {HTMLButtonElement[]} radios */
  const wireKeyboard = (index, li, radios) => {
    li.addEventListener('keydown', (ev) => {
      const key = /** @type {KeyboardEvent} */ (ev).key;
      const focused = radios.findIndex((r) => r === document.activeElement);
      if (focused < 0) return;
      let next = -1;
      if (key === 'ArrowRight' || key === 'ArrowDown') next = (focused + 1) % radios.length;
      else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (focused - 1 + radios.length) % radios.length;
      if (next < 0) return;
      ev.preventDefault();
      radios[next].focus();
      const type = radios[next].dataset.type ?? DEFAULT_LAYER_TYPE;
      commit(assignType(currentStack(), index, type)); // arrow selects (standard radiogroup)
      announce(`Layer ${index + 1} set to ${typeMeta(type).label}`);
    });
  };

  /** Append one layer row at index `index` (== current length). @param {number} index */
  const appendRow = (index) => {
    const li = elc('li', 'cfg-layer');
    const head = elc('div', 'cfg-layer-head');
    const num = elc('span', 'cfg-layer-num', `Layer ${index + 1}`);
    head.append(num);
    if (index === 0) head.append(elc('span', 'cfg-layer-flow', 'work enters here'));

    const group = elc('div', 'cfg-types');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', `Layer ${index + 1} seat type`);
    /** @type {HTMLButtonElement[]} */
    const radios = [];
    for (const type of LAYER_TYPES) {
      const meta = typeMeta(type);
      const b = /** @type {HTMLButtonElement} */ (elc('button', 'cfg-type'));
      b.type = 'button';
      b.dataset.type = type;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', `${meta.label}: ${meta.desc}`);
      b.tabIndex = -1;
      const glyph = elc('span', 'cfg-type-glyph', meta.glyph);
      glyph.setAttribute('aria-hidden', 'true');
      b.append(glyph, elc('span', 'cfg-type-label', meta.label));
      b.addEventListener('click', () => {
        commit(assignType(currentStack(), index, type));
        announce(`Layer ${index + 1} set to ${meta.label}`);
      });
      radios.push(b);
      group.append(b);
    }
    wireKeyboard(index, li, radios);

    const desc = elc('p', 'cfg-layer-desc');
    li.append(head, group, desc);
    stackList.append(li);
    rows.push({ li, radios, desc });
  };

  const removeLastRow = () => {
    const row = rows.pop();
    if (row) row.li.remove();
  };

  /** Update a row's selected type in place (no rebuild -> focus survives; F2). @param {number} index @param {string} type */
  const setRowType = (index, type) => {
    const row = rows[index];
    if (!row) return;
    for (const r of row.radios) {
      const on = r.dataset.type === type;
      r.setAttribute('aria-checked', String(on));
      r.classList.toggle('active', on);
      r.tabIndex = on ? 0 : -1;
    }
    row.desc.textContent = typeMeta(type).desc;
  };

  /** Reconcile the rows to a stack: append/remove at the end, then set types. @param {string[]} stack */
  const syncRows = (stack) => {
    while (rows.length < stack.length) appendRow(rows.length);
    while (rows.length > stack.length) removeLastRow();
    stack.forEach((type, i) => setRowType(i, type));
    countLabel.textContent = `${stack.length} of ${MAX_LAYERS} layers`;
    stackList.setAttribute('aria-label', `Prioritization stack: ${stack.length} approval layer${stack.length === 1 ? '' : 's'}, layer 1 first`);
    addBtn.disabled = stack.length >= MAX_LAYERS;
    removeBtn.disabled = stack.length <= MIN_LAYERS;
  };

  // ---- toolbar wiring ----
  addBtn.addEventListener('click', () => {
    const stack = currentStack();
    if (stack.length >= MAX_LAYERS) return;
    commit(resizeStack(stack, stack.length + 1));
    announce(`Added layer ${stack.length + 1}`);
  });
  removeBtn.addEventListener('click', () => {
    const stack = currentStack();
    if (stack.length <= MIN_LAYERS) return;
    commit(resizeStack(stack, stack.length - 1));
    announce(`Removed layer ${stack.length}`);
  });
  compareBox.addEventListener('change', () => {
    compareOn = compareBox.checked;
    renderLegibility(null, null); // reflect the toggle immediately (applies on next run)
    coordinator.onCompareToggle();
  });

  // ---- flow-diagram render (semantic table; honest labels G1-G3) ----
  /** @param {any} output */
  const renderFlow = (output) => {
    const data = flowRows(output);
    flowScroll.textContent = '';
    if (data.length === 0) { flowPending.hidden = false; return; }
    flowPending.hidden = true;
    const table = elc('table', 'cfg-flow-table');
    const caption = elc('caption', 'cfg-flow-caption', 'Per-layer statistics from the run. Work enters at layer 1 and clears upward through the stack.');
    table.append(caption);
    const thead = elc('thead');
    const htr = document.createElement('tr');
    for (const label of ['Layer', 'Seat', 'Latency (days)', 'Queued items', 'Share of overrides', 'Distortion', 'Utilization']) {
      const th = elc('th', undefined, label);
      th.setAttribute('scope', 'col');
      htr.append(th);
    }
    thead.append(htr);
    const tbody = elc('tbody');
    for (const r of data) {
      const tr = document.createElement('tr');
      if (r.bottleneck) tr.className = 'cfg-flow-busiest';
      const rowHead = elc('th', undefined, `${r.layer}`);
      rowHead.setAttribute('scope', 'row');
      const seat = elc('td');
      seat.append(elc('span', 'cfg-flow-seat', typeMeta(r.layerType).label));
      if (r.bottleneck) seat.append(elc('span', 'cfg-busiest-badge', 'busiest seat'));
      const util = elc('td', 'cfg-flow-util');
      const bar = elc('span', 'cfg-util-bar');
      bar.style.width = pct(r.utilization);
      bar.setAttribute('aria-hidden', 'true');
      util.append(elc('span', 'cfg-util-num', pct(r.utilization)), bar);
      tr.append(
        rowHead,
        seat,
        elc('td', undefined, Number(r.meanLatencyDays).toFixed(1)),
        elc('td', undefined, Number(r.meanQueue).toFixed(1)),
        elc('td', undefined, pct(r.overrideShare)),
        elc('td', undefined, Number(r.distortion).toFixed(2)),
        util,
      );
      tbody.append(tr);
    }
    table.append(thead, tbody);
    flowScroll.append(table);
  };

  // ---- recovery indicator ----
  /** @param {any} config @param {any} resolvedParams */
  const renderRecovery = (config, resolvedParams) => {
    const owned = recoveryOwned(config, resolvedParams);
    if (owned === null) {
      recoveryIcon.textContent = '○';
      recoveryText.textContent = 'Recovery of AI failures: run to evaluate';
      recovery.classList.remove('owned', 'unowned');
      return;
    }
    recoveryIcon.textContent = owned ? '✓' : '○';
    recoveryText.textContent = owned
      ? 'Recovery of AI failures: owned — this org clears an AI failure fast (set by Structural Health).'
      : 'Recovery of AI failures: unowned — an AI failure lingers with no clear owner (set by Structural Health).';
    recovery.classList.toggle('owned', owned);
    recovery.classList.toggle('unowned', !owned);
  };

  // ---- legibility panel (comparison + sentence, from run snapshots; B4) ----
  /** @param {any} primaryRun @param {any} twinRun */
  const renderLegibility = (primaryRun, twinRun) => {
    const config = primaryRun ? primaryRun.config : coordinator.getConfig();
    const primaryOutput = primaryRun ? primaryRun.output : undefined;
    const twinOutput = twinRun ? twinRun.output : undefined;
    legBody.textContent = '';

    if (primaryOutput && twinOutput) {
      const s = legibilitySummary(primaryOutput, twinOutput);
      legBody.append(
        comparisonRow('Settled decision latency', fmtDays(s.primary.latency), fmtDays(s.twin && s.twin.latency)),
        comparisonRow('Novel-task brittleness (events)', fmtEvents(s.primary.brittleness), fmtEvents(s.twin && s.twin.brittleness)),
      );
    } else if (primaryOutput) {
      const stack = stackFromConfig(config);
      const note = isAllHuman(stack)
        ? 'This stack is already all-human — there is no AI seat to contrast, so no brittleness events occur.'
        : 'Turn on "Compare to all-human stack" and run to see the AI seat effect against the all-human baseline.';
      legBody.append(elc('p', 'cfg-pending', note));
    } else {
      legBody.append(elc('p', 'cfg-pending',
        compareOn
          ? 'Comparison is on — it updates on the next run.'
          : 'Run the simulation to read this stack behavior.'));
    }
    legSentence.textContent = whatThisMeans(config, primaryOutput, twinOutput);
  };

  /** @param {string} label @param {string} primary @param {string} twin */
  const comparisonRow = (label, primary, twin) => {
    const row = elc('div', 'cfg-cmp-row');
    row.append(
      elc('span', 'cfg-cmp-label', label),
      pill('This stack', primary, 'ai'),
      pill('All-human', twin, 'human'),
    );
    return row;
  };
  /** @param {string} tag @param {string} value @param {string} kind */
  const pill = (tag, value, kind) => {
    const p = elc('span', `cfg-cmp-pill cfg-cmp-${kind}`);
    p.append(elc('span', 'cfg-cmp-tag', tag), elc('span', 'cfg-cmp-val', value));
    return p;
  };
  /** @param {number | null | undefined} v */
  const fmtDays = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} days`);
  /** @param {number | null | undefined} v */
  const fmtEvents = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}`);

  // ---- public surface ----
  const refresh = () => {
    if (!coordinator.getConfig()) return; // pre-boot
    syncRows(currentStack());
  };

  refresh();

  return {
    refresh,
    getCompareOn: () => compareOn,
    setCompareDefault(on) {
      compareOn = on;
      compareBox.checked = on;
    },
    setPending() {
      flowScroll.textContent = '';
      flowPending.hidden = false;
      renderRecovery(coordinator.getConfig(), undefined);
      renderLegibility(null, null);
    },
    renderRun(primaryRun, twinRun) {
      renderFlow(primaryRun.output);
      renderRecovery(primaryRun.config, primaryRun.output.resolvedParams);
      renderLegibility(primaryRun, twinRun);
      announce(`Simulation complete — ${twinRun ? '2 runs (this stack and all-human)' : '1 run'}`);
    },
  };
}
