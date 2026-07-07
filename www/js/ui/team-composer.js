// eigenorg Team Composer (P7b polish layer) — the tap-to-assign team builder.
//
// The droppable enhancement on top of the presets-only floor (cut line): pick a
// seat from the palette and it joins the roster (who does the work / who reviews —
// binding delta 3). TAP is primary and keyboard-operable; HTML5 drag is a
// DESKTOP-ONLY enhancement layered on top (drag a palette chip onto the roster —
// same effect as a tap). Plus three guarded team dials (Structural Health,
// review capacity, coordination modality).
//
// Two strata (P5 convention): the pure edit transforms live in ui/team.js
// (node-tested, validate()-safe, numbers preset-sourced); this module is the DOM
// controller only. Edits route through `coordinator.onConfigChange` — the SAME
// hook the preset picker uses — so the single canonical team config stays the one
// write path and the stale/re-run model applies uniformly. Authors no model
// number. Never imports www/pkg.

import {
  roleOf,
  archetypeLabel,
  addEntity,
  removeEntity,
  applyTeamField,
  entitiesOf,
  reviewCapacity,
  TEAM_MODALITIES,
  MAX_ENTITIES,
} from './team.js';

/** @param {string} tag @param {string} [cls] @param {string} [text] @returns {HTMLElement} */
function elc(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The three role buckets, in render order, with plain group headings. */
const ROLE_GROUPS = [
  { role: 'work', heading: 'Doing the work' },
  { role: 'review', heading: 'Reviewing the work' },
  { role: 'lead', heading: 'Leading & coordinating' },
];

/**
 * Mount the team composer into `container`.
 * @param {HTMLElement} container
 * @param {{ getConfig: () => any,
 *           onConfigChange: (config: any) => void,
 *           catalog: Array<{ archetype: string, kind: string, label: string, template: any }> }} coordinator
 * @returns {{ refresh: () => void }}
 */
export function renderTeamComposer(container, coordinator) {
  container.textContent = '';
  const root = elc('div', 'composer');

  // ---- polite announcements (assignments) — run state stays on #team-run-status ----
  const live = elc('div', 'tc-live sr-only');
  live.setAttribute('aria-live', 'polite');
  /** @param {string} msg */
  const announce = (msg) => { live.textContent = msg; };

  const commit = (/** @type {any} */ next, /** @type {string} */ msg) => {
    if (!next) { announce(msg); return; } // a guard blocked the edit — say why, change nothing
    coordinator.onConfigChange(next);
  };

  // ---- palette: add-a-seat (tap primary; drag = desktop enhancement) ----
  const paletteSection = elc('div', 'tc-section');
  paletteSection.append(elc('p', 'eyebrow', 'Add someone to the team'));
  const palette = elc('div', 'tc-palette');
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', 'Add a team member');
  for (const seat of coordinator.catalog) {
    const chip = /** @type {HTMLButtonElement} */ (elc('button', 'tc-add-chip'));
    chip.type = 'button';
    chip.dataset.archetype = seat.archetype;
    chip.setAttribute('aria-label', `Add ${seat.label} (${seat.kind === 'ai' ? 'AI' : 'human'})`);
    const kindBadge = elc('span', `tc-kind tc-kind-${seat.kind}`, seat.kind === 'ai' ? 'AI' : 'human');
    kindBadge.setAttribute('aria-hidden', 'true');
    chip.append(elc('span', 'tc-add-plus', '+'), elc('span', 'tc-add-label', seat.label), kindBadge);
    chip.addEventListener('click', () => addSeat(seat));
    // Desktop enhancement: drag a palette chip onto the roster (same as a tap).
    chip.draggable = true;
    chip.addEventListener('dragstart', (ev) => {
      /** @type {DragEvent} */ (ev).dataTransfer?.setData('text/plain', seat.archetype);
      root.classList.add('tc-dragging');
    });
    chip.addEventListener('dragend', () => root.classList.remove('tc-dragging'));
    palette.append(chip);
  }
  paletteSection.append(palette);

  /** @param {{ archetype: string, label: string, template: any }} seat */
  function addSeat(seat) {
    const next = addEntity(coordinator.getConfig(), seat.template);
    commit(next, `You already have the most a team can hold (${MAX_ENTITIES}). Remove someone first.`);
    if (next) announce(`Added a ${seat.label}.`);
  }

  // ---- roster (rebuilt on refresh; a drop-zone for the desktop drag) ----
  const rosterSection = elc('div', 'tc-section');
  rosterSection.append(elc('p', 'eyebrow', 'Your team'));
  const roster = elc('div', 'tc-roster');
  roster.setAttribute('role', 'group');
  roster.setAttribute('aria-label', 'Team roster');
  // Drop-zone wiring (desktop): accept a dragged palette chip anywhere on the roster.
  roster.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    roster.classList.add('tc-drop-active');
  });
  roster.addEventListener('dragleave', () => roster.classList.remove('tc-drop-active'));
  roster.addEventListener('drop', (ev) => {
    ev.preventDefault();
    roster.classList.remove('tc-drop-active');
    const archetype = /** @type {DragEvent} */ (ev).dataTransfer?.getData('text/plain');
    const seat = coordinator.catalog.find((s) => s.archetype === archetype);
    if (seat) addSeat(seat);
  });
  rosterSection.append(roster);

  /** Rebuild the roster cards from the current config. Focus-safe: only this
   *  subtree is rebuilt; the palette + dials persist. */
  function renderRoster() {
    roster.textContent = '';
    const entities = entitiesOf(coordinator.getConfig());
    for (const group of ROLE_GROUPS) {
      const members = entities.filter((e) => roleOf(e) === group.role);
      if (members.length === 0) continue;
      const col = elc('div', 'tc-role');
      col.append(elc('p', 'tc-role-head', `${group.heading} · ${members.length}`));
      const listEl = elc('ul', 'tc-cards');
      listEl.setAttribute('role', 'list');
      for (const entity of members) {
        const li = elc('li', 'tc-card');
        const label = archetypeLabel(entity.archetype);
        const name = elc('span', 'tc-card-name', label);
        const kind = elc('span', `tc-kind tc-kind-${entity.kind}`, entity.kind === 'ai' ? 'AI' : 'human');
        kind.setAttribute('aria-hidden', 'true');
        const remove = /** @type {HTMLButtonElement} */ (elc('button', 'tc-remove', '×'));
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${label}`);
        remove.addEventListener('click', () => {
          const next = removeEntity(coordinator.getConfig(), entity.id);
          if (!next) {
            announce('A team needs at least two people and someone doing the work — keep this one.');
            return;
          }
          coordinator.onConfigChange(next);
          announce(`Removed a ${label}.`);
          // The roster was rebuilt by the refresh → move focus to a stable anchor
          // (the first palette chip) so keyboard focus never drops to <body>.
          const firstAdd = /** @type {HTMLElement | null} */ (palette.querySelector('button'));
          if (firstAdd) firstAdd.focus();
        });
        li.append(name, kind, remove);
        listEl.append(li);
      }
      col.append(listEl);
      roster.append(col);
    }
  }

  // ---- team dials (SH / review capacity / modality) — updated in place ----
  const dials = elc('div', 'tc-dials');

  // Structural Health (integer 1–10; the team's plain dial).
  const shField = elc('div', 'field');
  const shRow = elc('div', 'field-label-row');
  const shLabel = elc('label', undefined, 'How sound the team’s setup is');
  shLabel.setAttribute('for', 'tc-sh');
  const shOut = /** @type {HTMLOutputElement} */ (document.createElement('output'));
  shOut.className = 'field-value';
  shRow.append(shLabel, shOut);
  const shInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  shInput.id = 'tc-sh';
  shInput.type = 'range';
  shInput.min = '1';
  shInput.max = '10';
  shInput.step = '1';
  shInput.addEventListener('input', () => {
    coordinator.onConfigChange(applyTeamField(coordinator.getConfig(), 'structuralHealth', shInput.value));
  });
  const shAnchors = elc('div', 'field-anchors');
  shAnchors.append(elc('span', 'field-anchor', 'strained'), elc('span', 'field-anchor', 'sound'));
  shField.append(shRow, shInput, shAnchors);

  // Review capacity (No limit ↔ a per-step integer cap; M20).
  const capField = elc('div', 'field');
  capField.append(elc('label', undefined, 'How much review the team can do'));
  const capControls = elc('div', 'tc-cap');
  const capToggle = elc('div', 'segmented');
  capToggle.setAttribute('role', 'group');
  capToggle.setAttribute('aria-label', 'Review capacity');
  const capUnbounded = /** @type {HTMLButtonElement} */ (elc('button', undefined, 'No limit'));
  capUnbounded.type = 'button';
  const capLimited = /** @type {HTMLButtonElement} */ (elc('button', undefined, 'Limited'));
  capLimited.type = 'button';
  capToggle.append(capUnbounded, capLimited);
  const capNumber = /** @type {HTMLInputElement} */ (document.createElement('input'));
  capNumber.type = 'number';
  capNumber.min = '1';
  capNumber.step = '1';
  capNumber.className = 'tc-cap-num';
  capNumber.setAttribute('aria-label', 'Items reviewed per step');
  capUnbounded.addEventListener('click', () => {
    coordinator.onConfigChange(applyTeamField(coordinator.getConfig(), 'reviewCapacityPerStep', null));
  });
  capLimited.addEventListener('click', () => {
    const current = reviewCapacity(coordinator.getConfig()).perStep;
    coordinator.onConfigChange(applyTeamField(coordinator.getConfig(), 'reviewCapacityPerStep', current ?? 1));
  });
  capNumber.addEventListener('change', () => {
    coordinator.onConfigChange(applyTeamField(coordinator.getConfig(), 'reviewCapacityPerStep', capNumber.value));
  });
  capControls.append(capToggle, capNumber);
  capField.append(capControls);

  // Coordination modality (segmented string).
  const modField = elc('div', 'field');
  modField.append(elc('label', undefined, 'How the team coordinates'));
  const modSeg = elc('div', 'segmented');
  modSeg.setAttribute('role', 'group');
  modSeg.setAttribute('aria-label', 'Coordination modality');
  /** @type {HTMLButtonElement[]} */
  const modButtons = [];
  for (const m of TEAM_MODALITIES) {
    const b = /** @type {HTMLButtonElement} */ (elc('button', undefined, m.label));
    b.type = 'button';
    b.dataset.value = m.value;
    b.addEventListener('click', () => {
      coordinator.onConfigChange(applyTeamField(coordinator.getConfig(), 'modality', m.value));
    });
    modButtons.push(b);
    modSeg.append(b);
  }
  modField.append(modSeg);

  dials.append(shField, capField, modField);

  const dialsSection = elc('div', 'tc-section');
  const dialsEyebrow = elc('p', 'eyebrow', 'Team dials ');
  dialsEyebrow.append(elc('span', 'optional-tag', '· optional'));
  dialsSection.append(dialsEyebrow, dials);

  root.append(paletteSection, rosterSection, dialsSection, live);
  container.append(root);

  /** Reflect the current config: rebuild the roster + set the dial values in place. */
  function refresh() {
    const config = coordinator.getConfig();
    if (!config) return;
    renderRoster();
    const sh = Number(config.team?.structuralHealth);
    shInput.value = String(sh);
    shOut.textContent = `${sh} of 10`;
    const cap = reviewCapacity(config);
    capUnbounded.classList.toggle('active', !cap.bounded);
    capUnbounded.setAttribute('aria-pressed', String(!cap.bounded));
    capLimited.classList.toggle('active', cap.bounded);
    capLimited.setAttribute('aria-pressed', String(cap.bounded));
    capNumber.hidden = !cap.bounded;
    if (cap.bounded && cap.perStep !== null) capNumber.value = String(cap.perStep);
    const modality = config.team?.modality ?? 'asyncFirst';
    for (const b of modButtons) {
      const on = b.dataset.value === modality;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  refresh();
  return { refresh };
}
