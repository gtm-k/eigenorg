// eigenorg Structural-Health onboarding diagnostic (PLAN P8; binding delta 4;
// VISION §9 "Onboarding (locked)").
//
// Five questions VERBATIM from MODEL.md §3.4 — the questions ARE the referents
// (PREMORTEM A6: real-world units, no toy framing). Each is answered 0 (left
// phrase) / 1 (somewhere between) / 2 (right phrase); the score maps to the
// 1–10 Structural Health slider by the PINNED §3.4 formula (do NOT invent a
// different mapping). Shown ONCE after the first result, skippable to the plain
// slider (which stays the standing control), never blocking landing (A2).
//
// Result framing is non-judgmental and referent-based (global rule): it reports
// the score against the diagnostic, it never says an org is "broken".

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
 * Non-judgmental result sentence: reports the score against the diagnostic, and
 * says what happens next (the slider is set; re-run to apply). No shaming, no
 * "your org is broken" (global rule).
 * @param {number} score 1–10
 * @returns {string}
 */
export function resultSentence(score) {
  return `Based on your five answers, this org sits at Structural Health ${score} of 10. We set the slider to ${score} — run the simulation to see how this structure behaves.`;
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
 * Build the diagnostic UI into `root` (kept hidden until show()). Radio groups
 * live in fieldset/legend for keyboard + screen-reader operability; nothing
 * signals by colour alone.
 *
 * @param {HTMLElement} root the mount (a <section>, initially hidden)
 * @param {{ onComplete: (score: number) => void, onSkip: () => void,
 *           storage?: Storage }} opts
 * @returns {{ show: () => void, hide: () => void, isShown: () => boolean }}
 */
export function renderOnboarding(root, opts) {
  root.textContent = '';
  root.classList.add('diagnostic');

  const heading = make('h2', 'diagnostic-title', 'Two-minute Structural Health check');
  heading.id = 'diagnostic-title';
  heading.tabIndex = -1; // focus target on show (announced, not focus-trapped)
  root.setAttribute('aria-labelledby', 'diagnostic-title');

  const intro = make(
    'p',
    'diagnostic-intro',
    'Five observable questions define Structural Health. Answer them to set the slider — or skip and use the slider directly. This appears once.',
  );

  const form = make('form', 'diagnostic-form');
  /** @type {Array<() => number>} */
  const readers = [];

  DIAGNOSTIC_QUESTIONS.forEach((q, qi) => {
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

    if (qi === 0) fs.dataset.first = 'true';
  });

  const actions = make('div', 'diagnostic-actions');
  const applyBtn = /** @type {HTMLButtonElement} */ (make('button', undefined, 'Set my Structural Health'));
  applyBtn.type = 'submit';
  const skipBtn = /** @type {HTMLButtonElement} */ (make('button', 'ghost', 'Skip — use the slider'));
  skipBtn.type = 'button';
  actions.append(applyBtn, skipBtn);

  const resultEl = make('p', 'diagnostic-result status');
  resultEl.setAttribute('role', 'status');
  resultEl.setAttribute('aria-live', 'polite');

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const answers = readers.map((r) => r());
    const score = scoreStructuralHealth(answers);
    resultEl.textContent = resultSentence(score);
    markDiagnosticSeen(opts.storage);
    opts.onComplete(score);
    hide();
  });

  skipBtn.addEventListener('click', () => {
    markDiagnosticSeen(opts.storage);
    opts.onSkip();
    hide();
  });

  form.appendChild(actions);
  root.append(heading, intro, form, resultEl);
  root.hidden = true;

  let shown = false;
  function show() {
    root.hidden = false;
    shown = true;
    markDiagnosticSeen(opts.storage); // once it has appeared, it has been "shown"
    // Announce + move focus to the panel heading (a response to the user's Run
    // click — not a focus trap; Tab still leaves freely, so landing is never
    // blocked).
    heading.focus();
  }
  function hide() {
    root.hidden = true;
    shown = false;
  }
  return { show, hide, isShown: () => shown };
}
