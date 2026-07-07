// eigenorg two-altitude nav shell (P10a).
//
// Owns the STRUCTURAL legibility fix diagnosed in REDESIGN-two-altitudes-spec.md:
// the landing "two doors" (Organization Building / Team Building), the persistent
// segmented altitude toggle, Start over, and the mode-agnostic content mounts.
// Feature code stays in ui/*.js; main.js wires this shell to the org run flow.
// Pure DOM orchestration — this module NEVER imports the engine (www worker owns
// wasm) and authors no model number (no coefficient literals).
//
// P7b reuse contract: a door is registered as { id, label, question, desc, icon,
// mount }. The shell shows/hides mounts by id and drives the toggle from the door
// list, so P7b adds the Team door's real content by populating its mount (and
// passing a richer door) — WITHOUT editing this file.
//
// Also exports createSetupStrip: the mode-agnostic "Your setup → Edit in place →
// Run again → stale" re-run affordance (spec §6). Org Building wires it in P10a;
// Team Building reuses it unchanged in P7b.

/** @param {string} tag @param {string} [cls] @param {string} [text] @returns {HTMLElement} */
function elc(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @typedef {{ id: string, label: string, question: string, desc: string,
 *             icon: string, mount: HTMLElement }} Door
 */

/**
 * Mount the two-altitude shell. Builds the landing door cards and the persistent
 * segmented toggle from the door list, then shows/hides each door's content mount
 * by id. The active altitude carries a NON-COLOR cue (aria-current + weight +
 * underline in CSS), so state never reads by colour alone (spec §8 a11y).
 *
 * @param {{
 *   landing: HTMLElement,
 *   doorGrid: HTMLElement,
 *   shell: HTMLElement,
 *   toggle: HTMLElement,
 *   startOver: HTMLButtonElement,
 *   doors: Door[],
 *   onEnter?: (id: string) => void,
 *   onStartOver?: () => void,
 * }} opts
 * @returns {{ enter: (id: string, opts?: { focus?: boolean }) => void,
 *             showLanding: (opts?: { focusFirstDoor?: boolean }) => void,
 *             activeDoor: () => string | null }}
 */
export function createNavShell(opts) {
  /** @type {string | null} */
  let active = null;

  /** @type {Map<string, HTMLButtonElement>} */
  const segButtons = new Map();
  /** @type {HTMLButtonElement[]} */
  const doorButtons = [];

  // ---- landing door cards (double as the explainer, spec §4) ----
  for (const door of opts.doors) {
    const card = /** @type {HTMLButtonElement} */ (elc('button', 'door'));
    card.type = 'button';
    card.dataset.door = door.id;
    card.setAttribute('aria-label', `${door.label}: ${door.question}`);

    const icon = elc('span', 'door-icon', door.icon);
    icon.setAttribute('aria-hidden', 'true');
    const eyebrow = elc('span', 'door-label', door.label);
    const question = elc('span', 'door-question', door.question);
    const desc = elc('span', 'door-desc', door.desc);
    const enter = elc('span', 'door-enter', 'Enter');
    enter.setAttribute('aria-hidden', 'true');

    card.append(icon, eyebrow, question, desc, enter);
    card.addEventListener('click', () => enterDoor(door.id));
    doorButtons.push(card);
    opts.doorGrid.append(card);
  }

  // ---- persistent segmented toggle (both altitudes visible, spec §4) ----
  opts.toggle.setAttribute('role', 'group');
  opts.toggle.setAttribute('aria-label', 'Switch altitude');
  opts.doors.forEach((door, index) => {
    const seg = /** @type {HTMLButtonElement} */ (elc('button', 'altitude-seg'));
    seg.type = 'button';
    seg.dataset.door = door.id;
    const segIcon = elc('span', 'altitude-seg-icon', door.icon);
    segIcon.setAttribute('aria-hidden', 'true');
    // Short altitude noun for the compact toggle; full label stays the aria name.
    seg.append(segIcon, elc('span', 'altitude-seg-label', door.label));
    seg.setAttribute('aria-label', door.label);
    seg.addEventListener('click', () => enterDoor(door.id));
    // Roving-tabindex arrow navigation across the segment group.
    seg.addEventListener('keydown', (ev) => {
      const key = /** @type {KeyboardEvent} */ (ev).key;
      let delta = 0;
      if (key === 'ArrowRight' || key === 'ArrowDown') delta = 1;
      else if (key === 'ArrowLeft' || key === 'ArrowUp') delta = -1;
      if (delta === 0) return;
      ev.preventDefault();
      const next = opts.doors[(index + delta + opts.doors.length) % opts.doors.length];
      const btn = segButtons.get(next.id);
      if (btn) btn.focus();
    });
    segButtons.set(door.id, seg);
    opts.toggle.append(seg);
  });

  /** @param {string | null} id reflect the active altitude on the toggle */
  function paintToggle(id) {
    for (const [doorId, btn] of segButtons) {
      const on = doorId === id;
      btn.classList.toggle('active', on);
      // Non-color cue: aria-current marks the live altitude for assistive tech.
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
      btn.tabIndex = on ? 0 : -1;
    }
  }

  /**
   * @param {string} id
   * @param {{ focus?: boolean }} [opts2] move focus to the active toggle segment
   *   on entry — true for a USER-initiated entry (door click / toggle switch),
   *   false for the boot-time replay entry so nothing steals focus on load.
   */
  function enterDoor(id, opts2 = {}) {
    const { focus = true } = opts2;
    const door = opts.doors.find((d) => d.id === id);
    if (!door) return;
    active = id;
    opts.landing.hidden = true;
    opts.shell.hidden = false;
    for (const d of opts.doors) {
      const isActive = d.id === id;
      d.mount.hidden = !isActive;
      if (isActive) {
        // Re-trigger the CSS entry fade-up on every (re-)entry: drop the class,
        // force a reflow, re-add. Pure CSS motion (honours prefers-reduced-motion).
        d.mount.classList.remove('entered');
        void d.mount.offsetWidth;
        d.mount.classList.add('entered');
      }
    }
    paintToggle(id);
    const seg = segButtons.get(id);
    // Announce the active altitude to keyboard/AT users on a user-initiated
    // entry; preventScroll so a programmatic focus never yanks the page.
    if (focus && seg) seg.focus({ preventScroll: true });
    opts.onEnter?.(id);
  }

  /**
   * @param {{ focusFirstDoor?: boolean }} [opts2] focus the first door — true
   *   only for the Start-over click (a user action); false on the boot-time
   *   fresh-visit call, so the reader lands on the h1 + lede, not a focus ring.
   */
  function showLanding(opts2 = {}) {
    active = null;
    opts.shell.hidden = true;
    opts.landing.hidden = false;
    paintToggle(null);
    if (opts2.focusFirstDoor && doorButtons[0]) doorButtons[0].focus({ preventScroll: true });
  }

  opts.startOver.addEventListener('click', () => {
    showLanding({ focusFirstDoor: true });
    opts.onStartOver?.();
  });

  // Landing is the initial view; main.js calls enter('org') for a replay boot.
  paintToggle(null);

  return { enter: enterDoor, showLanding, activeDoor: () => active };
}

// ---- setup strip: Your setup → Edit in place → Run again → stale (spec §6) ----

/**
 * @typedef {{ label: string, value: string }} SetupChip
 */

/**
 * Wire the mode-agnostic re-run affordance around a collapsible setup region.
 * The controls live in `body`; when collapsed, `summary` shows the "Your setup"
 * chips + an Edit button that reopens the controls IN PLACE (no scroll-back).
 * A staged edit shows `staleBadge` (icon + text — never colour alone) until the
 * next run; a completed run collapses back to the chips.
 *
 * @param {{
 *   body: HTMLElement,
 *   summary: HTMLElement,
 *   chipHost: HTMLElement,
 *   editButton: HTMLButtonElement,
 *   staleBadge: HTMLElement,
 *   focusTarget?: () => (HTMLElement | null),
 * }} opts
 * @returns {{ setChips: (chips: SetupChip[]) => void,
 *             markStale: () => void, markFresh: () => void,
 *             expand: () => void, collapse: () => void,
 *             isExpanded: () => boolean }}
 */
export function createSetupStrip(opts) {
  let expanded = true;

  function reflect() {
    opts.body.hidden = !expanded;
    opts.summary.hidden = expanded;
    opts.editButton.setAttribute('aria-expanded', String(expanded));
  }

  function expand() {
    expanded = true;
    reflect();
    opts.body.scrollIntoView({ block: 'nearest' });
    const target = opts.focusTarget?.();
    if (target) target.focus();
  }

  function collapse() {
    expanded = false;
    reflect();
  }

  opts.editButton.addEventListener('click', expand);
  reflect();

  return {
    setChips(chips) {
      opts.chipHost.textContent = '';
      for (const chip of chips) {
        const pill = elc('span', 'setup-chip');
        pill.append(elc('span', 'setup-chip-key', chip.label), document.createTextNode(` ${chip.value}`));
        opts.chipHost.append(pill);
      }
    },
    markStale() {
      opts.staleBadge.hidden = false;
    },
    markFresh() {
      opts.staleBadge.hidden = true;
      collapse();
    },
    expand,
    collapse,
    isExpanded: () => expanded,
  };
}
