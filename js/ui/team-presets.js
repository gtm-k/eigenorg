// eigenorg team preset picker (P7b) — the Team-door analogue of ui/presets.js.
//
// INT-2: a static Pages host cannot enumerate www/presets/team/ at runtime, so
// the surfaced team presets + their run keys are committed in
// www/presets/team/manifest.json. This module FETCHES that manifest (subpath-safe
// relative URL, same discipline as ui/presets.js) and then each referenced preset
// file. The team-manifest node test pins the manifest against the files on disk so
// the two cannot drift.
//
// Every team config number lives in the fetched JSON — this module authors NONE
// (the coefficient-literal gate forbids hand-typed model numbers in www/js). It
// never imports www/pkg (UI-thread wasm-isolation gate).

import { deepCopy } from './runplan.js';

/**
 * @typedef {{ id: string, runKey: string, label: string }} TeamPresetRef
 * @typedef {{ default: string, presets: TeamPresetRef[] }} TeamManifest
 */

/**
 * Fetch + normalize the committed team manifest (INT-2).
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ defaultId: string, refs: TeamPresetRef[] }>}
 */
export async function fetchTeamManifest(fetchImpl) {
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch('./presets/team/manifest.json');
  if (!response.ok) throw new Error(`team manifest fetch failed: HTTP ${response.status}`);
  /** @type {any} */
  const raw = await response.json();
  const refs = Array.isArray(raw?.presets) ? raw.presets : [];
  return { defaultId: String(raw?.default ?? refs[0]?.id ?? ''), refs };
}

/**
 * Fetch one team preset file (relative URL — subpath-safe).
 * @param {string} id
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<any>} the parsed preset file
 */
export async function fetchTeamPreset(id, fetchImpl) {
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch(`./presets/team/${id}.json`);
  if (!response.ok) throw new Error(`team preset ${id} fetch failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * The primary run config of a fetched team preset, deep-copied for editing.
 * @param {any} preset the parsed preset file
 * @param {TeamPresetRef} ref
 * @returns {any}
 */
export function teamPrimaryRunConfig(preset, ref) {
  const run = preset?.runs?.[ref.runKey];
  if (!run) throw new Error(`team preset ${ref.id} has no run "${ref.runKey}"`);
  return deepCopy(run);
}

// ---- DOM rendering (browser only) --------------------------------------------

/**
 * Render the team preset chips. Mirrors renderPresetPicker (ui/presets.js): a
 * pick is an explicit "show me this team" action, so the caller loads AND runs.
 * The refs come from the fetched manifest (not a hardcoded list), so this takes
 * them as a parameter.
 *
 * @param {HTMLElement} root
 * @param {{ refs: TeamPresetRef[], onPick: (ref: TeamPresetRef) => void }} opts
 * @returns {{ setActive: (id: string) => void }}
 */
export function renderTeamPresetPicker(root, opts) {
  /** @type {Map<string, HTMLButtonElement>} */
  const chips = new Map();
  root.textContent = '';
  for (const ref of opts.refs) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = ref.label;
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
