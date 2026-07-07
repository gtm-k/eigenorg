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
  workMix,
  demandingSharePct,
  highStakesSharePct,
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

  // ---- feedback: success announcements (SR-only) + guard blocks (VISIBLE) ----
  // Successful assignments announce to screen readers only (run state stays on
  // #team-run-status). A guard that BLOCKS an edit (roster at the max, the last
  // two members, the last worker) must be observable to EVERY actor, not just SR
  // users (F4 actor-observability) — before this, the block wrote only into the
  // sr-only region, so a sighted user hit a remove/add that visibly did nothing.
  // It now surfaces in a visible role=status note by the controls, cleared on the
  // next successful edit (CSS hides it while empty).
  const live = elc('div', 'tc-live sr-only');
  live.setAttribute('aria-live', 'polite');
  /** @param {string} msg */
  const announce = (msg) => { live.textContent = msg; };

  const guardNote = elc('p', 'tc-guard');
  guardNote.setAttribute('role', 'status');
  guardNote.setAttribute('aria-live', 'polite');
  /** Show a blocked-edit reason visibly AND announce it once. @param {string} msg */
  const blockGuard = (msg) => { guardNote.textContent = msg; };
  /** Clear the guard note after a successful edit. */
  const clearGuard = () => { if (guardNote.textContent) guardNote.textContent = ''; };

  const commit = (/** @type {any} */ next, /** @type {string} */ msg) => {
    if (!next) { blockGuard(msg); return; } // a guard blocked the edit — show why, change nothing
    clearGuard();
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
        const kindWord = entity.kind === 'ai' ? 'AI' : 'human';
        const name = elc('span', 'tc-card-name', label);
        // The human/AI distinction is the composer's core who-does-the-work
        // framing (binding delta 3), so expose it to screen readers too — the
        // visual badge stays aria-hidden, an sr-only span carries the kind so a
        // roster card reads e.g. "Engineer, human" (palette chips already do).
        const srKind = elc('span', 'sr-only', `, ${kindWord}`);
        const kind = elc('span', `tc-kind tc-kind-${entity.kind}`, kindWord);
        kind.setAttribute('aria-hidden', 'true');
        const remove = /** @type {HTMLButtonElement} */ (elc('button', 'tc-remove', '×'));
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${label}`);
        remove.addEventListener('click', () => {
          const next = removeEntity(coordinator.getConfig(), entity.id);
          if (!next) {
            blockGuard('A team needs at least two people and someone doing the work — keep this one.');
            return;
          }
          clearGuard();
          coordinator.onConfigChange(next);
          announce(`Removed a ${label}.`);
          // The roster was rebuilt by the refresh → move focus to a stable anchor
          // (the first palette chip) so keyboard focus never drops to <body>.
          const firstAdd = /** @type {HTMLElement | null} */ (palette.querySelector('button'));
          if (firstAdd) firstAdd.focus();
        });
        li.append(name, srKind, kind, remove);
        listEl.append(li);
      }
      col.append(listEl);
      roster.append(col);
    }
  }

  // ---- work stream (the demand coming in) — the brittleness stressor ----
  // Novel/complex + high-stakes work is exactly what makes a team brittle
  // (MODEL.md team mechanics), so the work profile is the composer's primary
  // stressor, not a preset-only field. Two guarded, validate()-safe integer-
  // percent dials; the mix dial keeps routine+complex+novel == 1.
  const workSection = elc('div', 'tc-section');
  workSection.append(elc('p', 'eyebrow', 'The work coming in'));
  const workDials = elc('div', 'tc-dials');

  // How much of the work is complex or novel (routine takes the rest).
  const mixField = elc('div', 'field');
  const mixRow = elc('div', 'field-label-row');
  const mixLabel = elc('label', undefined, 'How much of the work is complex or novel');
  mixLabel.setAttribute('for', 'tc-mix');
  const mixOut = /** @type {HTMLOutputElement} */ (document.createElement('output'));
  mixOut.className = 'field-value';
  mixRow.append(mixLabel, mixOut);
  const mixInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  mixInput.id = 'tc-mix';
  mixInput.type = 'range';
  mixInput.min = '0';
  mixInput.max = '100';
  mixInput.step = '1';
  mixInput.addEventListener('input', () => {
    coordinator.onConfigChange(applyTeamField(coordinator.getConfig(), 'mix', mixInput.value));
  });
  const mixAnchors = elc('div', 'field-anchors');
  mixAnchors.append(elc('span', 'field-anchor', 'all routine'), elc('span', 'field-anchor', 'all demanding'));
  mixField.append(mixRow, mixInput, mixAnchors);

  // How much of the work is high-stakes (the other brittleness trigger).
  const stakesField = elc('div', 'field');
  const stakesRow = elc('div', 'field-label-row');
  const stakesLabel = elc('label', undefined, 'How much of the work is high-stakes');
  stakesLabel.setAttribute('for', 'tc-stakes');
  const stakesOut = /** @type {HTMLOutputElement} */ (document.createElement('output'));
  stakesOut.className = 'field-value';
  stakesRow.append(stakesLabel, stakesOut);
  const stakesInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  stakesInput.id = 'tc-stakes';
  stakesInput.type = 'range';
  stakesInput.min = '0';
  stakesInput.max = '100';
  stakesInput.step = '1';
  stakesInput.addEventListener('input', () => {
    coordinator.onConfigChange(applyTeamField(coordinator.getConfig(), 'highStakesShare', stakesInput.value));
  });
  const stakesAnchors = elc('div', 'field-anchors');
  stakesAnchors.append(elc('span', 'field-anchor', 'none'), elc('span', 'field-anchor', 'all high-stakes'));
  stakesField.append(stakesRow, stakesInput, stakesAnchors);

  workDials.append(mixField, stakesField);
  workSection.append(workDials);

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
  const capLabel = elc('label', undefined, 'How much review the team can do');
  capLabel.id = 'tc-cap-label';
  capField.append(capLabel);
  const capControls = elc('div', 'tc-cap');
  const capToggle = elc('div', 'segmented');
  capToggle.setAttribute('role', 'group');
  // Point the group at its VISIBLE label (WCAG 2.5.3 label-in-name) instead of a
  // divergent aria-label string that voice-control users can't say.
  capToggle.setAttribute('aria-labelledby', 'tc-cap-label');
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
  const modLabel = elc('label', undefined, 'How the team coordinates');
  modLabel.id = 'tc-mod-label';
  modField.append(modLabel);
  const modSeg = elc('div', 'segmented');
  modSeg.setAttribute('role', 'group');
  modSeg.setAttribute('aria-labelledby', 'tc-mod-label');
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

  root.append(paletteSection, guardNote, rosterSection, workSection, dialsSection, live);
  container.append(root);

  /** Reflect the current config: rebuild the roster + set the dial values in place. */
  function refresh() {
    const config = coordinator.getConfig();
    if (!config) return;
    renderRoster();
    const demanding = demandingSharePct(config);
    mixInput.value = String(demanding);
    mixOut.textContent = `${demanding}% complex or novel · ${workMix(config).label}`;
    const stakes = highStakesSharePct(config);
    stakesInput.value = String(stakes);
    stakesOut.textContent = `${stakes}% high-stakes`;
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
