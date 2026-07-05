// eigenorg preset picker — configs are FETCHED from www/presets/*.json (the
// same files the Rust plausibility tests read; PLAN P5: "fetched, not
// duplicated"). Only the file list and each preset's primary run key live
// here; a node test pins both against the files on disk so they cannot
// drift.

import { deepCopy } from './runplan.js';

/**
 * @typedef {{ id: string, runKey: string }} PresetRef
 */

/** The five org presets and the run each loads into the controls. */
export const PRESET_REFS = [
  { id: 'fasterDysfunction', runKey: 'sh3' }, // landing default (PLAN P5)
  { id: 'coordinationCollapse', runKey: 'main' },
  { id: 'prioritizationTax', runKey: 'threeLayer' },
  { id: 'dunbarCliff', runKey: 'main' },
  { id: 'layerConfigurator', runKey: 'aiMiddle' },
];

export const DEFAULT_PRESET_ID = 'fasterDysfunction';

/**
 * Fetch one preset file (relative URL — must work under the /eigenorg/
 * Pages subpath).
 * @param {string} id
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<any>} the parsed preset file
 */
export async function fetchPreset(id, fetchImpl) {
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch(`./presets/${id}.json`);
  if (!response.ok) throw new Error(`preset ${id} fetch failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * The primary run config of a fetched preset, deep-copied for editing.
 * @param {any} preset the parsed preset file
 * @param {PresetRef} ref
 * @returns {any}
 */
export function primaryRunConfig(preset, ref) {
  const run = preset?.runs?.[ref.runKey];
  if (!run) throw new Error(`preset ${ref.id} has no run "${ref.runKey}"`);
  return deepCopy(run);
}

// ---- DOM rendering (browser only) --------------------------------------------

/**
 * Render the preset chips. Picking a preset is an explicit "show me this
 * scenario" action, so the caller typically loads AND runs it.
 *
 * @param {HTMLElement} root
 * @param {{ labels: Record<string, string>,
 *           onPick: (ref: PresetRef) => void }} opts
 * @returns {{ setActive: (id: string) => void }}
 */
export function renderPresetPicker(root, opts) {
  /** @type {Map<string, HTMLButtonElement>} */
  const chips = new Map();
  for (const ref of PRESET_REFS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = opts.labels[ref.id] ?? ref.id;
    // Initialize aria-pressed so the chips carry the toggle state even on the
    // replay-boot path, where setActive is not called (P5b-F1 fold).
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => opts.onPick(ref));
    chips.set(ref.id, chip);
    root.appendChild(chip);
  }
  return {
    setActive(id) {
      for (const [chipId, chip] of chips) {
        const active = chipId === id;
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', String(active));
      }
    },
  };
}
