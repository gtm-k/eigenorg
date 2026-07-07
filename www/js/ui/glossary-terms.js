// eigenorg curated glossary terms — the DATA module (P10b §8.5 layer-ii).
//
// This is the single source of truth for the curated, exec-voice ⓘ copy that
// sits on top of the drift-gated model layer. Both the DOM controller
// (glossary.js) and the term-coverage gate (scripts/check_term_coverage.mjs)
// import from HERE — never inline this data into either, so the two stay in
// lockstep off one list.
//
// THE P7b ESCAPE-HATCH (reuse contract): a NEW mode (P7b's Team lens) adds its
// concept terms by APPENDING entries to CURATED_TERMS in THIS file — and adds
// ONLY this file to its shared-files list. glossary.js, the gate script, and
// .github/workflows/ci.yml stay byte-untouched: P7b's new surfaces auto-join
// JARGON_KNOWN_LIST, the glob-scanning gate auto-covers its files, and
// glossary.decorate() decorates its `data-term` labels with the same mechanism.
// "Add a mode = append data here." This is the ONLY sanctioned way to register a
// term — there is deliberately NO runtime register() alternative (it was removed
// in P10b-2 repair-1); a second path would let a term skip the coverage gate.
//
// Voice (spec §8.5 + AUTONOMY WINDOW #2 defaults, 2026-07-07):
//   - plain-first, human units, non-judgmental (strained / sound — never
//     "broken"/"sick"), no AI-slop self-labeling;
//   - the two lines per term are the short exec ⓘ: `plain` (what it is) +
//     `why` (why it matters). The drift-gated `plainLanguage` of the linked
//     `assumptionsId` is the deeper "Show the numbers" layer, surfaced at
//     runtime by glossary.js — so the curated copy stays a lede, not a
//     duplicate of the model text.
//   - §8.5 sourceless correction: only THREE curated terms have no
//     assumptions.json item (Structural Health, Throughput, Faster Dysfunction);
//     every other term carries an `assumptionsId` linking it to the mechanic
//     whose `plainLanguage` is its deep-dive. All three sourceless terms are now
//     wired on-screen in P10b — Structural Health on the SH control, Throughput
//     on the before/after pane stat, Faster Dysfunction on the preset note ⓘ.
//     `functionCoverage` is registered but present-but-unwired until P7b renders
//     its surface (§8.5 allows this).
//
// SPEC COVERAGE: the ten §8.5 layer-ii terms — structuralHealth, entropy,
// decisionVelocity, throughput, cohesion, brittleness, fasterDysfunction,
// approvalStack, functionCoverage, coordinationTax — are ALL registered here.
// The term-coverage gate pins that set (its SPEC_TERMS constant), so
// de-registering any of them fails CI. communicationLoad / aiInjectionDelta /
// meetingOverhead / multiLevelHealth are additional curated terms this UI renders.
//
// SHAPE (each entry): { id, label, surfaces, plain, why, assumptionsId? }
//   id         — the `data-term` value a heading/control carries (NOT a surface).
//   label      — the human name for the ⓘ accessible name ("What '<label>' means").
//   surfaces   — the exact on-screen technical strings (incl. aliases). These are
//                what the coverage gate sweeps for and what JARGON_KNOWN_LIST is
//                derived from. NEVER a plain-language lead — only the jargon.
//   plain      — one exec-voice sentence: what it is, in human units.
//   why        — one exec-voice sentence: why it matters / how to read it.
//   assumptionsId — optional link to the model item whose plainLanguage is the
//                deep-dive; absent = a curated-only (sourceless) term.

/**
 * @typedef {{ id: string, label: string, surfaces: string[],
 *             plain: string, why: string, assumptionsId?: string }} CuratedTerm
 */

/** @type {CuratedTerm[]} */
export const CURATED_TERMS = [
  {
    id: 'entropy',
    label: 'Disorder',
    surfaces: ['Entropy', 'Disorder'],
    plain:
      'A 0–100 read on how much disorder the org is carrying — slow decisions, strained coordination, breakages and stuck work, folded into one number.',
    why: "It's the headline symptom you're keeping low; the everyday numbers — days, % — stay the levers, and this is the score they add up to.",
    assumptionsId: 'entropyComposite',
  },
  {
    id: 'decisionVelocity',
    label: 'Decision velocity',
    surfaces: ['Decision velocity'],
    plain: 'How fast decisions get made, on a 0–100 speedometer — 100 is one sign-off with no waiting.',
    why: 'Every extra approval layer and every queue drags it down, so it shows the cost of your sign-off chain at a glance.',
    assumptionsId: 'decisionVelocityScore',
  },
  {
    id: 'communicationLoad',
    label: 'Communication load',
    surfaces: ['Communication load', 'open channels'],
    plain: 'How many working communication lines the org keeps open — the count climbs fast as teams and headcount grow.',
    why: 'More open lines means more time spent coordinating and less spent on the work itself.',
    assumptionsId: 'brooksIntraTeamChannels',
  },
  {
    id: 'aiInjectionDelta',
    label: 'AI injection delta',
    surfaces: ['AI injection delta'],
    plain: 'This org with AI minus the same org without it — exactly what adding the AI changed, and nothing else.',
    why: "It isolates the AI's effect, so you can see whether AI added order or disorder on this specific structure.",
    assumptionsId: 'aiTaskTypeCapability',
  },
  {
    id: 'meetingOverhead',
    label: 'Meeting overhead',
    surfaces: ['Meeting overhead'],
    plain: 'The slice of coordination time that lands on calendars as meetings — shown as a share of capacity.',
    why: 'That capacity is time in the room instead of on the work; async-heavy orgs pay less of it for the same structure.',
    assumptionsId: 'meetingOverhead',
  },
  {
    id: 'multiLevelHealth',
    label: 'Multi-level health',
    surfaces: ['Multi-level health', 'Teams vs the org'],
    plain: 'Two views side by side — the org as a whole versus how the teams inside it are doing.',
    why: 'When they diverge, sound teams can live inside a strained org (or the reverse) — which a single org-level number would hide.',
    assumptionsId: 'cohesionDynamics',
  },
  {
    id: 'structuralHealth',
    label: 'Structural Health',
    surfaces: ['Structural Health'],
    // §8.5 sourceless term (no assumptions.json item): the 1–10 diagnostic scale
    // lives in MODEL.md §3.4 via onboarding.js, not as a coefficient. Trimmed to
    // two sentences per the AUTONOMY WINDOW #2 voice default.
    plain:
      "How sound your org's setup is, on a 1–10 scale — folding five things you can watch: clear ownership, finishing before starting, deciding without a meeting, knowing who can decide, and someone owning recovery.",
    why: 'The same move — adding AI, growing headcount — steadies a sound setup and strains a strained one, so this is the dial that decides which way you go.',
  },
  {
    id: 'approvalStack',
    label: 'Approval stack',
    surfaces: ['Approval stack'],
    plain: 'The chain of sign-offs a decision clears before it can move — 1 to 5 seats, each a person, a committee, or an AI agent.',
    why: 'This chain is what sets your decision-latency number: more seats, and slower seats, mean more working days per decision.',
    assumptionsId: 'decisionPipeline',
  },
  {
    id: 'coordinationTax',
    label: 'Coordination tax',
    // Near-synonym split (AUTONOMY WINDOW #2): tax = the TIME share; the door
    // copy "coordination cost" is an alias of the same concept. Distinct from
    // communication load (the channel COUNT) and meeting overhead (the calendar
    // slice) — those are separate terms.
    surfaces: ['Coordination tax', 'coordination cost'],
    plain:
      "The share of everyone's time spent coordinating — meetings, messages, handoffs — instead of doing the work, shown as a share of capacity.",
    why: 'The higher it climbs, the less of each day reaches the actual backlog; meeting-heavy structures pay more of it for the same work.',
    assumptionsId: 'coordinationTax',
  },
  {
    id: 'throughput',
    label: 'Throughput',
    // §8.5 sourceless term: assumptions.json holds only conversions
    // (execPointsPerThroughputPoint), never a definition of the output metric.
    surfaces: ['Throughput'],
    plain: 'How much work actually gets finished — the output side of the org, counted in items per step.',
    why: 'Worth reading next to quality: pushing more through a strained structure faster can lift this number while disorder climbs underneath it.',
  },
  {
    id: 'brittleness',
    label: 'Brittleness',
    // Borderline term (AUTONOMY WINDOW #2): curated short label; the recovery-
    // focused mechanic `brittlenessRecovery` is the "Show the numbers" deep-dive.
    // "Novel-task brittleness" is the legibility comparison-row surface.
    surfaces: ['Brittleness', 'Novel-task brittleness'],
    plain: "How easily work breaks when it hits something novel or high-stakes that an AI agent can't handle on its own.",
    why: 'What turns one breakage into a wider slowdown is whether someone clearly owns the recovery.',
    assumptionsId: 'brittlenessRecovery',
  },
  {
    id: 'fasterDysfunction',
    label: 'Faster Dysfunction',
    // §8.5 sourceless scenario label (the phrase lives inside
    // structuralHealthAmplification.plainLanguage, which has no id of its own).
    // KEEPS the editorial edge per binding delta 7 (AUTONOMY WINDOW #2) — this is
    // the one term allowed a pointed reading; the provenance rides in the ⓘ copy.
    surfaces: ['Faster Dysfunction'],
    plain: 'When AI is added to an already-strained org, it pushes work through the same weak points faster — throughput can rise while disorder rises with it.',
    why: 'It names the trap the model warns about: speed without the structure to support it, so faster is not the same as better (MODEL.md §10.3).',
  },
  {
    id: 'cohesion',
    label: 'Cohesion',
    surfaces: ['Cohesion'],
    plain: 'Team trust — the shared context and willingness to flag problems early that holds a team together.',
    why: 'It frays as teams outgrow the size where everyone knows everyone, or as more of the team is AI than people.',
    assumptionsId: 'cohesionDynamics',
  },
  {
    id: 'functionCoverage',
    label: 'Function coverage',
    // The on-screen surface for this term arrives with P7b (the team lens seeds
    // the coverage read); P10b registers the curated entry now so the term is
    // covered the moment P7b renders it. Present-but-unwired is allowed (§8.5).
    surfaces: ['Function coverage'],
    plain: 'Whether each essential job — building, reviewing, resolving ambiguity — actually has enough qualified attention on it.',
    why: 'A gap means a job is effectively unowned, so work that needs it stalls or quietly degrades.',
    assumptionsId: 'functionCoverage',
  },
];

/**
 * The union of every on-screen jargon surface, DERIVED (never hand-typed) so a
 * term's surfaces and the coverage gate can never drift. The gate's totality
 * check asserts every entry here resolves to a term, and its label-surface sweep
 * asserts every entry that appears as an index.html heading is bound to a
 * `data-term`. glossary.test.mjs pins this equality.
 * @type {string[]}
 */
export const JARGON_KNOWN_LIST = CURATED_TERMS.flatMap((t) => t.surfaces);
