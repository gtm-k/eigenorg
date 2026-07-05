// eigenorg org controls — config logic (pure, node-tested) + DOM rendering.
//
// PLAN P5 control set: headcount + growth, hierarchy depth, topology,
// ownership layers, modality toggle, Structural Health plain slider.
// Everything else in the config (seed, iterations, horizon, layerTypes …)
// rides along from the loaded preset untouched, except where a control
// change forces a consistency fix (see applyOrgValue).

import { deepCopy } from './runplan.js';

/**
 * @typedef {{ id: string, label: string, kind: 'range' | 'number' | 'segmented',
 *             min?: number, max?: number, step?: number,
 *             options?: Array<{ value: string, label: string }>,
 *             hint?: string }} ControlDef
 */

/** MODEL.md §3.3 input ranges. @type {ControlDef[]} */
export const CONTROL_DEFS = [
  {
    id: 'headcountStart',
    label: 'Headcount',
    kind: 'number',
    min: 4,
    max: 500,
    step: 1,
    hint: 'people at step 0 (4–500)',
  },
  {
    id: 'headcountGrowthPerStep',
    label: 'Growth',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.05,
    hint: 'people added per step (0–2)',
  },
  {
    id: 'hierarchyDepth',
    label: 'Hierarchy depth',
    kind: 'range',
    min: 1,
    max: 6,
    step: 1,
  },
  {
    id: 'ownershipLayers',
    label: 'Ownership layers',
    kind: 'range',
    min: 1,
    max: 5,
    step: 1,
  },
  {
    id: 'topology',
    label: 'Topology',
    kind: 'segmented',
    options: [
      { value: 'flat', label: 'Flat' },
      { value: 'hierarchical', label: 'Hierarchical' },
      { value: 'pods', label: 'Pods' },
      { value: 'federated', label: 'Federated' },
    ],
  },
  {
    id: 'modality',
    label: 'Coordination modality',
    kind: 'segmented',
    options: [
      { value: 'asyncFirst', label: 'Async-first' },
      { value: 'meetingHeavy', label: 'Meeting-heavy' },
    ],
  },
  {
    id: 'structuralHealth',
    label: 'Structural Health',
    kind: 'range',
    min: 1,
    max: 10,
    step: 1,
    hint: 'the five diagnostic questions, folded to one 1–10 slider',
  },
];

/**
 * Current control values off a config.
 * @param {any} config
 * @returns {Record<string, number | string>}
 */
export function readOrgValues(config) {
  const org = config.org;
  return {
    headcountStart: org.headcountStart,
    headcountGrowthPerStep: org.headcountGrowthPerStep,
    hierarchyDepth: org.hierarchyDepth,
    ownershipLayers: org.ownershipLayers,
    topology: org.topology,
    modality: org.modality,
    structuralHealth: org.structuralHealth,
  };
}

/**
 * Drop replay-mode fields: a control edit means the user is AUTHORING a new
 * config, which per CONTRACTS §4 gets full validation on current defaults —
 * carrying a replayed link's full-set paramOverrides (or its replay flag)
 * into an edited run would silently pin old coefficients.
 * @param {any} config
 * @returns {any} the same reference, mutated
 */
export function stripReplay(config) {
  delete config.replay;
  delete config.paramOverrides;
  return config;
}

/**
 * Clamp a numeric control value into its definition's range (steps snapped
 * for integer controls).
 * @param {ControlDef} def
 * @param {number} raw
 * @returns {number}
 */
export function clampControlValue(def, raw) {
  let v = Number.isFinite(raw) ? raw : Number(def.min ?? 0);
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  if (def.step === 1) v = Math.round(v);
  return v;
}

/**
 * Apply one control change immutably. Consistency fixes:
 * - `ownershipLayers` resizes `layerTypes` (pad "humanPm") and
 *   `layerOwnerCount` (pad 1) when present — validate() requires their
 *   length to equal ownershipLayers (MODEL.md §3.3).
 * - a matrix target seat requires layerOwnerCount == 1 at the terminal
 *   layer (§12.1) — enforced after a resize.
 * - every edit strips replay/paramOverrides (authoring mode, see stripReplay).
 *
 * @param {any} config
 * @param {string} id control id
 * @param {number | string} value
 * @returns {any} a new config
 */
export function applyOrgValue(config, id, value) {
  const def = CONTROL_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown control: ${id}`);
  const next = deepCopy(config);
  stripReplay(next);
  const org = next.org;

  if (def.kind === 'segmented') {
    org[id] = String(value);
    return next;
  }

  const v = clampControlValue(def, Number(value));
  org[id] = v;

  if (id === 'ownershipLayers') {
    const layers = v;
    if (Array.isArray(org.layerTypes)) {
      org.layerTypes = org.layerTypes.slice(0, layers);
      while (org.layerTypes.length < layers) org.layerTypes.push('humanPm');
    }
    if (Array.isArray(org.layerOwnerCount)) {
      org.layerOwnerCount = org.layerOwnerCount.slice(0, layers);
      while (org.layerOwnerCount.length < layers) org.layerOwnerCount.push(1);
      if (org.matrix?.enabled && org.layerOwnerCount[layers - 1] !== 1) {
        org.layerOwnerCount[layers - 1] = 1; // §12.1 matrix target seat rule
      }
    }
  }
  return next;
}

// ---- DOM rendering (browser only) --------------------------------------------

/**
 * Render the control grid into `root`. Controls stay ENABLED during runs
 * (PLAN P5: UI interactive mid-run); changes apply to the next run.
 *
 * @param {HTMLElement} root
 * @param {{ getConfig: () => any, onConfigChange: (config: any) => void }} opts
 * @returns {{ refresh: () => void }}
 */
export function renderControls(root, opts) {
  /** @type {Array<() => void>} */
  const refreshers = [];

  /**
   * @param {string} id
   * @param {number | string} value
   */
  const change = (id, value) => {
    opts.onConfigChange(applyOrgValue(opts.getConfig(), id, value));
  };

  for (const def of CONTROL_DEFS) {
    const field = document.createElement('div');
    field.className = 'field';

    const labelRow = document.createElement('div');
    labelRow.className = 'field-label-row';
    const label = document.createElement('label');
    label.textContent = def.label;
    label.htmlFor = `ctl-${def.id}`;
    labelRow.appendChild(label);

    if (def.kind === 'segmented') {
      const group = document.createElement('div');
      group.className = 'segmented';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', def.label);
      /** @type {HTMLButtonElement[]} */
      const buttons = [];
      for (const opt of def.options ?? []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt.label;
        b.dataset.value = opt.value;
        b.addEventListener('click', () => change(def.id, opt.value));
        buttons.push(b);
        group.appendChild(b);
      }
      // The first button carries the label target for keyboard users.
      buttons[0].id = `ctl-${def.id}`;
      refreshers.push(() => {
        const current = String(readOrgValues(opts.getConfig())[def.id]);
        for (const b of buttons) {
          const active = b.dataset.value === current;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', String(active));
        }
      });
      field.appendChild(labelRow);
      field.appendChild(group);
    } else {
      const input = document.createElement('input');
      input.id = `ctl-${def.id}`;
      input.type = def.kind === 'range' ? 'range' : 'number';
      if (def.min !== undefined) input.min = String(def.min);
      if (def.max !== undefined) input.max = String(def.max);
      if (def.step !== undefined) input.step = String(def.step);
      const valueOut = document.createElement('output');
      valueOut.className = 'field-value';
      valueOut.htmlFor.add(input.id);
      labelRow.appendChild(valueOut);
      // Ranges commit live (discrete integer steps); numbers commit on change.
      input.addEventListener(def.kind === 'range' ? 'input' : 'change', () => {
        change(def.id, input.value);
      });
      refreshers.push(() => {
        const current = readOrgValues(opts.getConfig())[def.id];
        input.value = String(current);
        valueOut.textContent = String(current);
      });
      field.appendChild(labelRow);
      field.appendChild(input);
    }

    if (def.hint) {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = def.hint;
      field.appendChild(hint);
    }
    root.appendChild(field);
  }

  const refresh = () => {
    if (!opts.getConfig()) return; // config not loaded yet (pre-boot)
    for (const r of refreshers) r();
  };
  refresh();
  return { refresh };
}
