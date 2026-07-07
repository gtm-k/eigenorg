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
    hint: 'starting people (4–500)',
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

/** Plain topology nouns for the "Your setup" chip summary. @type {Record<string, string>} */
const TOPOLOGY_LABELS = {
  flat: 'Flat',
  hierarchical: 'Hierarchical',
  pods: 'Pods',
  federated: 'Federated',
};

/** Topology nouns for the plain-English précis ("wired as …"). @type {Record<string, string>} */
const TOPOLOGY_PRECIS = {
  flat: 'a flat org',
  hierarchical: 'a hierarchy',
  pods: 'pods',
  federated: 'a federation',
};

/**
 * The "Your setup" chip summary (spec §6): a compact, human-readable digest of
 * the current org configuration, shown at the top of the results while the setup
 * panel is collapsed. Pure (node-tested); reads only config fields and authors no
 * model number (every value is a plain input the user set).
 * @param {any} config the current org config
 * @param {string} scenarioLabel the active scenario / preset label
 * @returns {Array<{ label: string, value: string }>}
 */
export function orgSetupChips(config, scenarioLabel) {
  const org = config?.org ?? {};
  const topology = TOPOLOGY_LABELS[org.topology] ?? String(org.topology ?? '—');
  const modality = org.modality === 'meetingHeavy' ? 'Meeting-heavy' : 'Async-first';
  const layers = Number(org.ownershipLayers);
  const aiOn =
    Boolean(org.aiInjection?.enabled) && Number(org.aiInjection?.atStep) < Number(config?.horizon ?? 0);
  return [
    { label: 'Scenario', value: scenarioLabel },
    { label: 'People', value: String(org.headcountStart ?? '—') },
    { label: 'Shape', value: topology },
    { label: 'Structural Health', value: `${org.structuralHealth ?? '—'} of 10` },
    { label: 'Approval layers', value: Number.isFinite(layers) ? String(layers) : '—' },
    { label: 'Coordination', value: modality },
    { label: 'AI injection', value: aiOn ? 'on' : 'off' },
  ];
}

/**
 * The plain-English setup précis (spec §4b.2) as an array of segments. A segment
 * with `value:true` is an editable value the renderer emphasizes (bold ink — the
 * accent stays reserved for Run, §C6). Pure (node-tested); reads only the fields
 * `orgSetupChips()` reads (people / topology / modality / ownershipLayers /
 * aiInjection) and authors NO model number — every value is a plain input the
 * user set. (No scenarioLabel arg: the scenario is already the eyebrow + first
 * chip; the sentence describes the configuration, not its preset name.)
 * @param {any} config the current org config
 * @returns {Array<{ text: string, value?: boolean }>}
 */
export function orgPrecisSentence(config) {
  const org = config?.org ?? {};
  const people = String(org.headcountStart ?? '—');
  const topology = TOPOLOGY_PRECIS[org.topology] ?? 'a custom shape';
  const modality = org.modality === 'meetingHeavy' ? 'meeting-heavy' : 'async-first';
  const layers = Number(org.ownershipLayers);
  const layerText = Number.isFinite(layers) ? `${layers}-layer approval chain` : 'a custom approval chain';
  const aiOn =
    Boolean(org.aiInjection?.enabled) && Number(org.aiInjection?.atStep) < Number(config?.horizon ?? 0);
  /** @type {Array<{ text: string, value?: boolean }>} */
  const parts = [
    { text: "You're testing a " },
    { text: `${people}-person`, value: true },
    { text: ' org wired as ' },
    { text: topology, value: true },
    { text: ', ' },
    { text: modality, value: true },
    { text: ', cleared by a ' },
    { text: layerText, value: true },
  ];
  if (aiOn) parts.push({ text: ', with ' }, { text: 'AI injected partway', value: true });
  parts.push({ text: '.' });
  return parts;
}

// ---- DOM rendering (browser only) --------------------------------------------

/**
 * Render the org précis into `host`, emphasizing the editable values (bold ink).
 * Text-node only (no innerHTML). @param {HTMLElement} host @param {any} config
 */
export function renderOrgPrecis(host, config) {
  host.textContent = '';
  for (const seg of orgPrecisSentence(config)) {
    if (seg.value) {
      const strong = document.createElement('strong');
      strong.textContent = seg.text;
      host.appendChild(strong);
    } else {
      host.appendChild(document.createTextNode(seg.text));
    }
  }
}

/**
 * Build the Structural-Health control (P10b §4d/§5): plain-lead heading +
 * demoted `.tech-label` + `data-term` (so glossary.decorate attaches the ⓘ),
 * the value as "N of 10", strained/sound anchors (a bare "N" carries no
 * direction), and — when `structuralHealthHelper` is supplied — the inline
 * "Answer 5 quick questions" helper mount. `data-term` sits on a NON-label
 * wrapper so the ⓘ (a <details>) is a sibling of the <label>, never nested
 * inside it.
 * @param {HTMLElement} root
 * @param {ControlDef} def
 * @param {{ getConfig: () => any, onConfigChange: (config: any) => void,
 *           structuralHealthHelper?: (mount: HTMLElement) => void }} opts
 * @param {Array<() => void>} refreshers
 */
function buildStructuralHealthField(root, def, opts, refreshers) {
  const field = document.createElement('div');
  field.className = 'field field-sh';

  const labelRow = document.createElement('div');
  labelRow.className = 'field-label-row';
  const lead = document.createElement('span');
  lead.className = 'field-lead';
  lead.dataset.term = 'structuralHealth';
  const label = document.createElement('label');
  label.textContent = 'How sound your org’s setup is';
  label.htmlFor = 'ctl-structuralHealth';
  const tech = document.createElement('span');
  tech.className = 'tech-label';
  tech.textContent = 'Structural Health · 1–10';
  lead.append(label, tech); // decorate() inserts the ⓘ between the label and .tech-label
  const valueOut = document.createElement('output');
  valueOut.className = 'field-value';
  valueOut.htmlFor.add('ctl-structuralHealth');
  labelRow.append(lead, valueOut);

  const input = document.createElement('input');
  input.id = 'ctl-structuralHealth';
  input.type = 'range';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.addEventListener('input', () => {
    opts.onConfigChange(applyOrgValue(opts.getConfig(), 'structuralHealth', input.value));
  });

  // Directional anchors (§5) — non-judgmental (strained / sound, never broken).
  const anchors = document.createElement('div');
  anchors.className = 'field-anchors';
  const strained = document.createElement('span');
  strained.className = 'field-anchor';
  strained.textContent = 'strained';
  const sound = document.createElement('span');
  sound.className = 'field-anchor';
  sound.textContent = 'sound';
  anchors.append(strained, sound);

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Clear ownership, finishing before starting, deciding without a meeting.';

  const helperMount = document.createElement('div');
  helperMount.className = 'sh-helper';

  refreshers.push(() => {
    const current = readOrgValues(opts.getConfig()).structuralHealth;
    input.value = String(current);
    valueOut.textContent = `${current} of 10`;
  });

  field.append(labelRow, input, anchors, hint, helperMount);
  root.appendChild(field);

  if (opts.structuralHealthHelper) opts.structuralHealthHelper(helperMount);
}

/**
 * Render the control grid into `root`. Controls stay ENABLED during runs
 * (PLAN P5: UI interactive mid-run); changes apply to the next run.
 *
 * @param {HTMLElement} root
 * @param {{ getConfig: () => any, onConfigChange: (config: any) => void,
 *           structuralHealthHelper?: (mount: HTMLElement) => void }} opts
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
    // SUBSUMPTION (P6, PLAN decision log 2026-07-05 #4): the Prioritization
    // Layer Configurator is the single editing surface for layer structure, so
    // it owns `ownershipLayers` (+ layerTypes). Skip rendering the duplicate
    // slider here to prevent two widgets editing one field (failure B5). The
    // CONTROL_DEFS entry + applyOrgValue('ownershipLayers') stay (still the
    // canonical range for clamping, still node-tested) — only the DOM widget
    // moves to ui/prioritization.js.
    if (def.id === 'ownershipLayers') continue;

    // The Structural-Health control gets the plain-language + inline-helper
    // treatment (§4d/§5) — a bespoke build, not the generic field path.
    if (def.id === 'structuralHealth') {
      buildStructuralHealthField(root, def, opts, refreshers);
      continue;
    }

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
