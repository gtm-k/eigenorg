// eigenorg Structural-Health diagnostic (PLAN P8 → re-scoped P10b-2; binding
// delta 4; VISION §9 "Onboarding (locked)").
//
// Five questions VERBATIM from MODEL.md §3.4 — the questions ARE the referents
// (PREMORTEM A6: real-world units, no toy framing). Each is answered 0 (left
// phrase) / 1 (somewhere between) / 2 (right phrase); the score maps to the
// 1–10 Structural Health slider by the PINNED §3.4 formula (do NOT invent a
// different mapping).
//
// P10b-2 RE-SCOPE (decision log "P10b execution — pre-code folds APPLIED"): the
// guided stepper was dropped and the R1 SH-diagnostic decouple resolved by
// RETIRING the P8 post-result auto-offer. The §3.4 questions now power a single,
// USER-INITIATED inline helper next to the SH control (createStructuralHealthHelper
// / DESIGN-ELEVATION §5) — available unconditionally, re-openable on demand, so
// the `presetId=''`-on-edit strand cannot occur and double-onboarding is gone.
// The pure §3.4 referents (DIAGNOSTIC_QUESTIONS, ANSWER_SCORES,
// scoreStructuralHealth) are reused VERBATIM. shouldShowDiagnostic /
// markDiagnosticSeen / STORAGE_KEY are RETAINED FOR BACKCOMPAT / P7b but no
// longer wired to any auto-fire path (a once-only lock would wrongly disable a
// user-initiated control).
//
// Result feedback is non-judgmental and referent-based (global rule): the score
// is reported through #run-status (main.js onScore), never saying an org is
// "broken".

/**
 * @typedef {{ id: string, dimension: string, question: string,
 *             low: string, mid: string, high: string }} DiagnosticQuestion
 */

/**
 * The five diagnostic questions, VERBATIM from MODEL.md §3.4. `low` is the
 * left-phrase (scored 0), `high` the right-phrase (scored 2); `mid` is the
 * "somewhere between" middle option (scored 1). Editing any question text is a
 * review blocker — these are the model's referents, not UI copy.
 * @type {DiagnosticQuestion[]}
 */
export const DIAGNOSTIC_QUESTIONS = [
  {
    id: 'ownership',
    dimension: 'Ownership',
    question: 'For a typical cross-team initiative, could you name the single person who owns the outcome?',
    low: 'Never',
    mid: 'Somewhere in between',
    high: 'Always',
  },
  {
    id: 'wipDiscipline',
    dimension: 'WIP discipline',
    question: 'Do teams finish work before starting new work?',
    low: 'Everything runs in parallel',
    mid: 'Somewhere in between',
    high: 'We finish before we start',
  },
  {
    id: 'asyncNorms',
    dimension: 'Async norms',
    question: 'Can a routine decision get made without a meeting?',
    low: 'Never',
    mid: 'Somewhere in between',
    high: 'Usually',
  },
  {
    id: 'decisionAuthority',
    dimension: 'Decision authority',
    question: 'Do people know which decisions they can make without approval?',
    low: 'Nobody is sure',
    mid: 'Somewhere in between',
    high: 'Everyone knows',
  },
  {
    id: 'recoveryPath',
    dimension: 'Recovery path',
    question: 'When something novel breaks, is there a clear owner for the recovery?',
    low: 'We improvise every time',
    mid: 'Somewhere in between',
    high: 'There is a named owner',
  },
];

/** The three answer options and their scores (0/1/2), shared by every question. */
export const ANSWER_SCORES = [0, 1, 2];

/**
 * The PINNED §3.4 mapping: SH = clamp(1 + round(9 × total / 10), 1, 10), where
 * total ∈ 0..10 is the sum of the five 0/1/2 answers. JS Math.round is half-up,
 * which matches Rust's half-away-from-zero for these non-negative values.
 * @param {number[]} answers five values, each 0/1/2
 * @returns {number} Structural Health 1–10
 */
export function scoreStructuralHealth(answers) {
  const total = answers.reduce((a, b) => a + b, 0); // 0..10
  const sh = 1 + Math.round((9 * total) / 10);
  return Math.min(10, Math.max(1, sh));
}

// ---- once-only storage flag (localStorage; try/catch for private browsing) --------

/** The namespaced flag key. localStorage is local-only — zero external requests. */
export const STORAGE_KEY = 'eigenorg.diagnosticSeen';

/**
 * Whether the diagnostic has been shown before. A storage read that throws
 * (private-browsing / disabled storage) is treated as "not seen" and must never
 * break the page — the diagnostic then simply shows this session.
 * @param {Pick<Storage, 'getItem'>} [storage]
 * @returns {boolean}
 */
export function readDiagnosticSeen(storage) {
  try {
    return (storage ?? localStorage).getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Record that the diagnostic was shown. A storage write that throws is
 * swallowed (the once-only guarantee degrades to once-per-session, never an
 * error).
 * @param {Pick<Storage, 'setItem'>} [storage]
 */
export function markDiagnosticSeen(storage) {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, '1');
  } catch {
    // storage unavailable — acceptable; the panel already showed this session.
  }
}

/**
 * RETAINED FOR BACKCOMPAT / P7b (no longer wired — the auto-fire path is retired
 * in P10b-2; the SH diagnostic is now the user-initiated inline helper). Kept
 * pure + node-tested so the retired preset-gating semantics stay documented for a
 * future mode that might re-adopt an offered flow.
 *
 * Gate for the once-only Structural-Health diagnostic (triage default 3): it
 * shows after the FIRST genuine PRESET result only. A replay arrival reproduces a
 * specific shared run (an onboarding interrupt mid-replay is intrusive), and a
 * CUSTOM-authored first run must NOT trigger OR consume the once-only flag — only
 * a non-empty preset id (a real preset selection the user did not edit) qualifies.
 * @param {{ replay: boolean, presetId: string, alreadyHandled: boolean }} ctx
 *   `replay` — this paint is a shared-link replay; `presetId` — the preset id
 *   captured at RUN LAUNCH ('' for a custom-authored run); `alreadyHandled` —
 *   the diagnostic already showed this session or a prior one.
 * @returns {boolean}
 */
export function shouldShowDiagnostic(ctx) {
  if (ctx.replay) return false;
  if (ctx.alreadyHandled) return false;
  return Boolean(ctx.presetId);
}

// ---- DOM controller (browser only) -----------------------------------------------

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Build the five VERBATIM §3.4 question fieldsets into `form` (radio groups in
 * fieldset/legend for keyboard + screen-reader operability; nothing signals by
 * colour alone). Returns one answer reader per question. Shared by the inline
 * SH helper (and reusable by any future offered flow).
 * @param {HTMLElement} form
 * @returns {Array<() => number>}
 */
function renderQuestionFieldsets(form) {
  /** @type {Array<() => number>} */
  const readers = [];
  DIAGNOSTIC_QUESTIONS.forEach((q) => {
    const fs = make('fieldset', 'diagnostic-q');
    const legend = make('legend', 'diagnostic-legend');
    legend.append(make('span', 'diagnostic-dim', q.dimension), make('span', 'diagnostic-question', q.question));
    fs.appendChild(legend);

    const opts3 = [
      { label: q.low, score: ANSWER_SCORES[0] },
      { label: q.mid, score: ANSWER_SCORES[1] },
      { label: q.high, score: ANSWER_SCORES[2] },
    ];
    const groupName = `diag-${q.id}`;
    /** @type {HTMLInputElement[]} */
    const inputs = [];
    const optionsRow = make('div', 'diagnostic-options');
    opts3.forEach((opt, oi) => {
      const id = `${groupName}-${oi}`;
      const wrap = /** @type {HTMLLabelElement} */ (make('label', 'diagnostic-option'));
      wrap.htmlFor = id;
      const input = /** @type {HTMLInputElement} */ (make('input'));
      input.type = 'radio';
      input.name = groupName;
      input.id = id;
      input.value = String(opt.score);
      if (oi === 1) input.defaultChecked = true; // neutral default = "somewhere between"
      inputs.push(input);
      wrap.append(input, make('span', 'diagnostic-option-label', opt.label));
      optionsRow.appendChild(wrap);
    });
    fs.appendChild(optionsRow);
    form.appendChild(fs);

    readers.push(() => {
      const chosen = inputs.find((inp) => inp.checked);
      return chosen ? Number(chosen.value) : ANSWER_SCORES[1];
    });
  });
  return readers;
}

/**
 * The optional inline Structural-Health helper (spec §5; DESIGN-ELEVATION §5) —
 * the single SH-configuration surface after the P8 auto-offer's retirement. A
 * "Not sure? Answer 5 quick questions" button that expands the SAME verbatim
 * §3.4 questions INLINE below the SH control; Apply scores via
 * scoreStructuralHealth and hands the score to `opts.onScore` (which writes the
 * plain slider through the standard authoring path — NO auto-run). This is a
 * USER-INITIATED control, so it carries NO once-only lock: it is re-openable on
 * demand (a lock would wrongly disable it after one use).
 *
 * @param {HTMLElement} mount the container under the SH control
 * @param {{ onScore: (score: number) => void }} opts
 * @returns {{ collapse: () => void, isExpanded: () => boolean }}
 */
export function createStructuralHealthHelper(mount, opts) {
  mount.textContent = '';
  const panelId = 'sh-helper-panel';

  const toggle = /** @type {HTMLButtonElement} */ (make('button', 'link-btn sh-helper-toggle', 'Not sure? Answer 5 quick questions'));
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panelId);

  const panel = make('div', 'sh-helper-panel');
  panel.id = panelId;
  panel.hidden = true;

  const intro = make(
    'p',
    'diagnostic-intro',
    'Five observable questions define Structural Health. Answer them to set the slider — or close this and use the slider directly.',
  );
  const form = /** @type {HTMLFormElement} */ (make('form', 'diagnostic-form'));
  const readers = renderQuestionFieldsets(form);

  const actions = make('div', 'diagnostic-actions');
  const applyBtn = /** @type {HTMLButtonElement} */ (make('button', undefined, 'Set my Structural Health'));
  applyBtn.type = 'submit';
  const closeBtn = /** @type {HTMLButtonElement} */ (make('button', 'ghost', 'Close'));
  closeBtn.type = 'button';
  actions.append(applyBtn, closeBtn);
  form.appendChild(actions);
  panel.append(intro, form);
  mount.append(toggle, panel);

  let expanded = false;
  /** @param {boolean} on */
  function setExpanded(on) {
    expanded = on;
    panel.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
  }

  toggle.addEventListener('click', () => {
    setExpanded(!expanded);
    if (expanded) {
      const first = /** @type {HTMLElement | null} */ (form.querySelector('input[type="radio"]'));
      if (first) first.focus();
    } else {
      toggle.focus();
    }
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const score = scoreStructuralHealth(readers.map((r) => r()));
    opts.onScore(score); // writes the plain slider; NO auto-run (main.js prompts a re-run)
    setExpanded(false);
    toggle.focus();
  });

  closeBtn.addEventListener('click', () => {
    setExpanded(false);
    toggle.focus();
  });

  return {
    // Start over (resetToDefault → shHelper.collapse) must return the diagnostic
    // to a fresh-boot state, so it resets the radios to their defaultChecked
    // neutrals as well as collapsing. An in-session Close/Apply keeps the user's
    // answers — those paths call setExpanded(false) directly, never this.
    collapse: () => {
      form.reset();
      setExpanded(false);
    },
    isExpanded: () => expanded,
  };
}
