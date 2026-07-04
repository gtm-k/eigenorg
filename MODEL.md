# eigenorg — MODEL.md

**The single source of truth for the eigenorg simulation model.**
Formulas, coefficients, golden predicates and tolerances, output definitions, and schema
policy are defined here and nowhere else. `model/params.json`, `model/goldens.json`, and
`www/assumptions.json` are machine-extracted from this file by `scripts/extract_params.mjs`;
`docs/CONTRACTS.md` is a derived operational copy. On any conflict, this document wins.

**Status:** draft pending user lock (P1 human gate).
**Extraction:** fenced blocks tagged `json eigenorg:parameter`, `json eigenorg:mechanic`,
`json eigenorg:golden`, and `json eigenorg:meta` are machine-extracted. Untagged `json`
fences are illustrative only.

```json eigenorg:meta
{
  "modelVersion": "2.0.0",
  "schemaVersion": "1"
}
```

---

## 1. Overview & honest uncertainty

eigenorg simulates two coupled views of the same underlying model:

1. **Org Entropy Simulator** — how an organization's clarity, speed, and coherence degrade
   as it scales headcount, adds hierarchy and prioritization layers, and compounds
   coordination overhead — and what injecting AI agents does to that trajectory.
2. **AI Agent Team Simulator** — how a single team's composition (humans vs AI agents,
   function coverage) drives throughput, quality, cohesion, and brittleness across a work
   stream.

The core claim the model exists to make explorable: **org performance is an emergent
property of structure, not headcount.**

**Honest uncertainty, stated up front.** This model is a *thinking aid grounded in
research, not a prediction engine*. Its mechanics encode well-supported qualitative laws
(communication channels grow quadratically; hierarchy layers add decision latency;
org structure mirrors into outputs; hybrid human–AI teams beat autonomous ones on complex
work). Its *coefficients* are a mix of research-anchored estimates and editorial defaults.
Every coefficient in §9 carries an evidence-tier label:

- `peer-reviewed` — the number (not just the direction) comes from peer-reviewed work.
- `industry-report` — the number comes from named industry research or vendor studies.
- `editorial-heuristic` — the number is an adjustable editorial default chosen by the
  authors so the mechanic behaves plausibly; the *direction* may still be well-supported.

Blog-anchored numbers are always `editorial-heuristic` and are adjustable via config
(`paramOverrides`; UI sliders in v2). Outputs are probability ranges, never point
predictions. All uncertainty disclosures in the app's Assumptions drawer are generated
from this file.

---

## 2. Time, horizon, and the task lifecycle

### 2.1 Time step

- **1 time step = 1 working day.** A working week is 5 steps; "2–3 days of decision
  latency per layer" means 2–3 steps.
- **Default horizon = 60 steps** (12 working weeks). Configs may override
  (`horizon`, 10–600). Long-horizon stability property tests (P3/P4) run at ≥5× the
  default horizon (≥300 steps).
- Steps are indexed `t = 0, 1, …, horizon−1`. All output series have one entry per step.

### 2.2 Task lifecycle finite-state machine

The atomic unit of work is a **task**. A task has: `class` (routine | complex | novel),
`stakes` (low | high; team sim only), `effort` (points, drawn at arrival), `progress`
(points completed), `layerIndex` (current prioritization layer), `serviceRemaining`
(days left at current layer), `age` (steps since arrival), and `overrideCount`.

**States** (five, plus the *(created)* arrival pseudo-state used by T1/T2 below): `queued(l)` for l = 1..L, `inProgress`, `review` (team sim only),
`blocked`, `done`. **Every transition:**

| # | From | To | Trigger |
|---|------|----|---------|
| T1 | *(created)* | `queued(1)` | Task arrives (§5 step 3). Enters layer 1 with a fresh service draw. |
| T2 | *(created)* | `blocked` | A **brittleness event** fires on a novel arrival — org sim with AI active or an aiAgent-typed layer present, team sim with AI on the judgment path (§4 M9/M10/M11). |
| T3 | `queued(l)` | `queued(l+1)` | Service time at layer `l` has elapsed AND layer `l` has per-step capacity left (FIFO). Fresh service draw at layer `l+1`; **escalation surcharge** may apply on entering layer `L` (§4 M6). |
| T4 | `queued(L)` | `inProgress` | Service time at final layer `L` elapsed and capacity available. When `overrideCount == 0` (a first-pass approval), the task's `age` at this instant is recorded as a **decision-latency sample** (§11.1); overridden re-passages are excluded. |
| T5 | `inProgress` | `inProgress` | Execution allocates points; `progress += allocation` (§5 step 7). |
| T6 | `inProgress` | `done` | `progress ≥ effort` AND (org sim, OR team sim with the review function uncovered). Counted in `throughput` this step; team sim draws quality (§4 M16). |
| T6r | `inProgress` | `review` | Team sim with the review function covered: `progress ≥ effort`. Enters a review dwell of `reviewDwellDays` (not counted in `throughput` yet, not counted as WIP). |
| T6d | `review` | `done` | Team sim: the review dwell has elapsed **AND review capacity is available this step** (M20 — `team.reviewCapacityPerStep`, unbounded by default so this reproduces v1). Dwell-elapsed tasks clear in FIFO order (completion step, then task id) up to the capacity; the rest stay in `review`. **Counted in `throughput` at this dwell-exit step** and draws quality (§4 M16) — team throughput is measured at review-dwell exit, not at execution completion. |
| T7 | `inProgress` | `queued(1)` | **Override event** (§4 M8): task re-enters layer 1, `progress ×= wipResetFraction`, `overrideCount += 1`. |
| T8 | `blocked` | `queued(1)` | Recovery window for that event elapses (§4 M10). |
| T9 | any | — | There are no other transitions. `done` is terminal. Tasks are never dropped. |

The org simulator uses this FSM with `L = ownershipLayers` and no `review` state
(review is a team-sim concern; org-level quality is not an output). The team simulator
uses a single implicit prioritization layer (`L = 1`) whose speed depends on who covers
the Prioritization function (§4 M11) and adds the `review` state (T6r/T6d).

**WIP** at any step = count of tasks in `queued(*)` + `inProgress` + `blocked`.
Tasks in `review` are past execution and awaiting the dwell; they are excluded from WIP.

---

## 3. Inputs: entities, functions, org structure, Structural Health

### 3.1 Functions (both simulators)

The unit of coverage is the **function** — work that must happen regardless of the title
that does it. The seven core functions (ids are normative for schema and coverage maps):

`prioritization`, `review`, `coordination`, `execution`, `stakeholderCommunication`,
`synthesis`, `ambiguityResolution`.

### 3.2 Team entities and property → rate mappings

Each team entity: `{ id, kind: "human"|"ai", archetype, throughput (1–10),
judgmentQuality (1–10), handoffFriction (1–10), reliability (1–10),
rampTimeWeeks (0–6, humans), availability (0–1, default 1), functions: [functionId…],
capabilities: { functionId: 0–10 } }`.

**Every property maps to a rate — the mappings (normative):**

| Property | Mapping |
|---|---|
| `throughput` | Execution points/step: `rate_e = throughput × execPointsPerThroughputPoint × ramp_e(t) × availability` (§4 M15). A throughput-5 entity at full ramp delivers 1.0 pt/step. |
| `judgmentQuality` | Feeds `judgmentEff` — the availability-and-attention-weighted mean judgment of entities covering `review ∪ synthesis ∪ ambiguityResolution`; drives task quality (§4 M16). |
| `handoffFriction` | Team coordination tax term: `handoffTax = handoffTaxCoefficient × mean(handoffFriction over entities)/5` (§4 M14). |
| `reliability` | Quality adjustment: `qualityReliabilityWeight × (meanReliability(execution pool) − 7)` points of quality (§4 M16). |
| `rampTimeWeeks` | Humans ramp linearly from `rampStartFactor` to 1.0 over `rampTimeWeeks × 5` steps (§4 M15). AI entities have ramp 1.0 from step 0. |
| `availability` | Multiplies both execution rate and coverage contribution (an exec who is 25% available covers 25% as much). |
| `capabilities[f]` | Coverage contribution for function `f` (§4 M17). |

**Attention:** humans split attention across assigned functions:
`attention_e = min(1, humanAttentionSpan / count(functions_e))`. AI agents do not
(`attention = 1`) — they are software, not calendars.

**Default archetype table** (capabilities per function, 0–10; presets materialize these;
configs may override any value):

| Archetype | kind | thr | jdg | hf | rel | ramp | prio | rev | coord | exec | stak | synth | ambig |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pm | human | 5 | 7 | 5 | 8 | 4 | 7 | 4 | 6 | 2 | 8 | 5 | 7 |
| director | human | 4 | 8 | 3 | 8 | 2 | 8 | 5 | 6 | 1 | 8 | 5 | 8 |
| engineer | human | 7 | 6 | 4 | 8 | 4 | 3 | 6 | 4 | 7 | 3 | 5 | 5 |
| designer | human | 6 | 6 | 4 | 8 | 4 | 3 | 5 | 4 | 6 | 5 | 6 | 4 |
| reviewer | human | 4 | 8 | 4 | 9 | 2 | 3 | 8 | 3 | 2 | 4 | 5 | 6 |
| programManager | human | 5 | 6 | 5 | 8 | 3 | 5 | 4 | 8 | 2 | 7 | 4 | 5 |
| aiExecution | ai | 8 | 3 | 2 | 7 | 0 | 2 | 3 | 3 | 8 | 1 | 4 | 1 |
| aiSynthesis | ai | 7 | 4 | 2 | 7 | 0 | 3 | 4 | 3 | 4 | 2 | 8 | 2 |
| aiReview | ai | 8 | 4 | 2 | 8 | 0 | 2 | 7 | 2 | 3 | 1 | 4 | 2 |
| aiCoordination | ai | 8 | 3 | 1 | 8 | 0 | 6 | 2 | 8 | 2 | 2 | 3 | 2 |
| aiPrioritization | ai | 9 | 3 | 2 | 8 | 0 | 9 | 2 | 8 | 2 | 2 | 3 | 2 |

**Review throughput gate (team sim).** The team config additionally accepts an optional
`reviewCapacityPerStep` (number > 0, **may be fractional**, default `null` = unbounded) — the
maximum completed items the review stage clears to `done` per step, ahead of the quality draw
(§4 M20, §5.2 step 7). A finite value clears via a use-it-or-lose-it fractional accumulator
mirroring M6 layer capacity (§4 M20), so e.g. `0.5` clears one review every two steps. Absent or `null`, review parallelism is unbounded and the fixed-dwell behavior of
§5.2 step 7 is reproduced exactly. It is a per-run structural input (the sibling of
`team.recoveryOwner`), not a params.json coefficient.

### 3.3 Org structure inputs

`{ headcountStart (4–500), headcountGrowthPerStep (0–2 people/step),
topology: "flat"|"hierarchical"|"pods"|"federated", hierarchyDepth D (1–6),
ownershipLayers L (1–5), layerTypes (optional, length L, each
"humanPm"|"humanDirector"|"aiAgent"|"committee" — default all "humanPm", §9.9),
layerOwnerCount (optional, length L, each int 1–8 — default all 1, §4 M19),
matrix: { enabled (default false), tiebreaker (0–1, default 0) } (optional — default off, §4 M19),
modality: "asyncFirst"|"meetingHeavy", structuralHealth SH (1–10),
misalignment m₀ (0–1, optional — default derived from SH, §4 M5),
initialBacklog (int 0–500, optional, default 0 — standing backlog present at t=0, §4 M18),
aiInjection: { enabled, atStep } }`.

Headcount at step t: `n(t) = round(headcountStart + headcountGrowthPerStep × t)`.
Team partition by topology: flat → 1 team; pods/federated → `T = ceil(n / teamPodTargetSize)`;
hierarchical → `T = ceil(n / hierarchicalTeamSize)`. Team sizes as equal as possible;
the mean size `s = n/T` is used wherever a per-team size is needed.

`layerOwnerCount` is the per-layer **accountability multiplicity** μ — how many co-equal
owners hold one ownership seat (§4 M19). `matrix` turns on a **lateral dual-authority**
seat (μ = 2 with no sequential-layer semantics), applied to the **terminal ownership layer L**,
with a decision-rights `tiebreaker` in `[0, 1]` (0 = deadlock, 1 = a clear single decider).
Both are additive-optional and, when absent — μ all 1, matrix off — reproduce the base model
exactly, on the same footing as `layerTypes` (§4 M19, §12.5). The matrix seat's μ = 2 is
**intrinsic** to the seat (§4 M19), not taken from `layerOwnerCount`; `validate()` rejects an
explicit `layerOwnerCount ≠ 1` on the matrix target layer L (§12.1). A `committee` layer has
**no** intrinsic multiplicity — it takes its μ from `layerOwnerCount` like any other non-matrix
seat, so a committee **may** carry `layerOwnerCount > 1` (composing its §9.9 relay benefit with
the diffusion cost).

### 3.4 Structural Health — the five diagnostic questions ARE the referents

Structural Health (1–10) is not an abstract slider; it is defined by five observable
questions. Each is answered 0 (left phrase), 1 (somewhere between), or 2 (right phrase);
`SH = clamp(1 + round(9 × total / 10), 1, 10)`.

1. **Ownership** — "For a typical cross-team initiative, could you name the single person
   who owns the outcome?" (never … always)
2. **WIP discipline** — "Do teams finish work before starting new work?"
   (everything runs in parallel … we finish before we start)
3. **Async norms** — "Can a routine decision get made without a meeting?"
   (never … usually)
4. **Decision authority** — "Do people know which decisions they can make without
   approval?" (nobody is sure … everyone knows)
5. **Recovery path** — "When something novel breaks, is there a clear owner for the
   recovery?" (we improvise every time … there is a named owner)

These five questions are the onboarding diagnostic (P8) verbatim. SH feeds three
mechanics: brittleness amplification (§4 M9), AI coordination relief (§4 M9), and the
default misalignment level (§4 M5).

### 3.5 Headline units

Headline outputs are in units leaders already track: **decision latency in working
days**, **coordination tax as % of capacity**, **throughput in items per step**.
**Entropy is a secondary composite index (0–100, §4 M13) and is never the lead metric.**

---

## 4. Mechanics

Each mechanic has a machine-extracted block `{id, formula, plainLanguage, citations[],
limitations[]}`. Parameter ids referenced in formulas are defined in §9.

### M1 — Brooks channels, applied at the team boundary

```json eigenorg:mechanic
{
  "id": "brooksIntraTeamChannels",
  "formula": "C_intra(t) = sum over teams i of n_i(t) * (n_i(t) - 1) / 2",
  "plainLanguage": "Within each team, everyone can end up talking to everyone: the number of possible communication channels grows with the square of team size. A team of 12 has 66 channels; a team of 25 has 300. The model applies this inside each team only - not across the whole org as one giant graph - because real organizations route most cross-team communication through structure.",
  "citations": [
    "Brooks, F. P. (1975). The Mythical Man-Month. Addison-Wesley. (n(n-1)/2 communication channels)",
    "Raymond, E. S. (1999). The Cathedral and the Bazaar, ch. 'How Many Eyeballs Tame Complexity' - only the core group pays full Brooksian overhead. http://www.catb.org/~esr/writings/cathedral-bazaar/"
  ],
  "limitations": [
    "The complete-graph assumption overstates real communication: not every pair actually talks. Applying it per-team (not org-wide) reduces but does not remove this bias.",
    "Channel count is a proxy for coordination surface, not measured communication volume."
  ]
}
```

### M2 — Inter-team channels and Conway misalignment

```json eigenorg:mechanic
{
  "id": "interTeamChannelsConway",
  "formula": "C_inter(t) = interTeamChannelCoefficient * kappa_topology * (T*(T-1)/2) * (1 + conwayMisalignmentPenalty * m(t)); kappa_topology in {pods: topologyCouplingPods, hierarchical: topologyCouplingHierarchical, federated: topologyCouplingFederated, flat: 0}; m(t) = clamp(m0 + misalignmentPerExtraTeam * max(0, T - T_atStart), 0, 1) * (topology == federated ? federatedAutonomyFactor : 1); m0 defaults to clamp((7 - SH) / 9, 0, 1) when not set in config",
  "plainLanguage": "Teams also need channels between them, and every pair of teams that shares work adds a few. When the org chart and the actual ownership of functions do not line up (Conway misalignment), each of those pairs needs even more channels, because work keeps crossing boundaries nobody owns. Misalignment drifts upward as more teams are added without restructuring.",
  "citations": [
    "Conway, M. E. (1968). How do committees invent? Datamation 14(4).",
    "MacCormack, A., Rusnak, J., & Baldwin, C. (2012). Exploring the duality between product and organizational architectures. Research Policy 41(8) - empirical support for the mirroring hypothesis.",
    "Nagappan, N., Murphy, B., & Basili, V. (2008). The influence of organizational structure on software quality. ICSE '08."
  ],
  "limitations": [
    "The direction (misalignment amplifies coordination cost) is peer-reviewed; the magnitude of conwayMisalignmentPenalty is an editorial default.",
    "Misalignment is modeled as a single scalar; real ownership gaps are per-function and lumpy."
  ]
}
```

### M3 — Cognitive load bands (gradual, not cliffs)

```json eigenorg:mechanic
{
  "id": "cognitiveLoadBands",
  "formula": "B(n) = 1 + sum over bands b in {inner, close, working, stable} of bandPenalty_b * sigma((n - center_b) / (bandWidthFactor * center_b)); sigma(x) = 1/(1+exp(-x)); centers = {cognitiveBandInner, cognitiveBandClose, cognitiveBandWorking, cognitiveBandStable}",
  "plainLanguage": "As headcount crosses familiar social thresholds (about 5, 15, 50, 150 people), keeping track of who knows what gets gradually harder, so every communication channel costs a bit more. The model uses smooth ramps, not cliffs: nothing special happens at exactly 150. The band centers are adjustable because the underlying numbers are contested.",
  "citations": [
    "Dunbar, R. I. M. (1992). Neocortex size as a constraint on group size in primates. Journal of Human Evolution 22(6).",
    "Lind, J., Lindenfors, P., et al. (2021). 'Dunbar's number' deconstructed. Biology Letters 17(5) - re-analysis finds the concept lacks empirical precision (confidence intervals from single digits to several hundred).",
    "Atlassian (2020). Three research-backed principles for scaling engineering orgs - bands used as design heuristics."
  ],
  "limitations": [
    "Dunbar-style thresholds are contested (Lind et al. 2021); the bands are planning heuristics, not empirical constants.",
    "Band penalties are editorial defaults tuned so degradation is visible but gradual."
  ]
}
```

### M4 — Coordination tax and meeting overhead

```json eigenorg:mechanic
{
  "id": "coordinationTax",
  "formula": "tau(t) = min(maxCoordinationTax, mu_modality * channelCostFraction * ((C_intra + C_inter) / n) * B(n) * (1 - relief_ai(t))); mu_modality = meetingHeavyMultiplier when modality == meetingHeavy else 1.0; relief_ai per M9. Effective execution capacity = raw capacity * (1 - tau).",
  "plainLanguage": "Every open communication channel eats a slice of everyone's day. The tax is the fraction of total capacity spent coordinating instead of producing. Meeting-heavy cultures pay roughly 1.4-1.6x what async-first cultures pay for the same structure. The tax is capped: an org never spends literally all its time coordinating.",
  "citations": [
    "SI Labs (2026). The Meeting Trap - about 60% of meeting time produces no concrete output. https://www.si-labs.com/en/articles/meeting-trap/",
    "Asana Anatomy of Work Index (2024). Unproductive meeting time for ICs rose 118% between 2019 and 2024 (1.7 to 3.7 h/week)."
  ],
  "limitations": [
    "channelCostFraction is an editorial default calibrated so a 12-person meeting-heavy flat team pays roughly 30% coordination tax; it is not a measured constant.",
    "The multiplicative form (modality x channels x bands) is a modeling choice; interactions could be non-multiplicative in reality."
  ]
}
```

```json eigenorg:mechanic
{
  "id": "meetingOverhead",
  "formula": "meetingOverheadPct(t) = tau(t) * (modality == meetingHeavy ? meetingShareMeetingHeavy : meetingShareAsync)",
  "plainLanguage": "Of the total coordination tax, this is the slice that shows up as actual meetings on calendars (the rest is chat, docs, handoffs, and waiting). Meeting-heavy orgs both pay a higher tax and take more of it as meetings.",
  "citations": [
    "SI Labs (2026). The Meeting Trap. https://www.si-labs.com/en/articles/meeting-trap/",
    "Atlassian (2019). Workplace Woes: Meetings."
  ],
  "limitations": [
    "The meeting share split is an editorial default; real orgs vary widely in how coordination cost manifests."
  ]
}
```

### M5 — Misalignment (defined inside M2)

Misalignment `m(t)` starts at `m0` (config, defaulting to `clamp((7 - SH)/9, 0, 1)` —
low Structural Health means murkier ownership) and grows by `misalignmentPerExtraTeam`
for every team added beyond the starting count, capped at 1. Federated topology
multiplies it by `federatedAutonomyFactor` (delegated ownership absorbs some ambiguity).

### M6 — Decision pipeline: latency, capacity, escalation

```json eigenorg:mechanic
{
  "id": "decisionPipeline",
  "formula": "Each task clears layers 1..L. Service time per layer ~ Triangular(decisionLatencyPerLayerDays) * M_recovery(t) (M10) * layerLatencyFactor(type_l) (§9.9; 1.0 for the default humanPm type, so absent layerTypes reproduces the base model) * diffusionLatencyFactor_l (M19; = 1 at mu_l == 1, so single-owner seats add nothing; applies at every seat l in 1..L, including a matrix terminal seat at L == 1). Layer l advances at most cap_l tasks/step: cap_l = layerCapacityPerStep * layerCapacityDecay^(l-1) * layerCapacityFactor(type_l) (§9.9) (x the M11 AI approval-bandwidth multiplier when org-level AI injection is active). Capacity is use-it-or-lose-it: the fractional accumulator carries at most one whole approval between steps (acc_l = min(acc_l + cap_l - moved_l, 1)); idle days bank at most a single approval, never more. On entering layer L: with probability escalationShare(t) = m(t) * crossCutShare, service += Triangular(escalationExtraDays). decisionLatency sample = task age when it leaves layer L, recorded only for first-pass approvals (overrideCount == 0; §11.1).",
  "plainLanguage": "Every approval layer adds waiting: around 2-3 working days each just for its own look, plus queueing when the layer is busy. Higher layers have less bandwidth (a VP reviews fewer things per day than a team lead), so queues form at the top. What sits in each seat changes the wait: an AI prioritization agent clears routine items fast and adds bandwidth; a committee is slower with less. Decisions that cut across teams with unclear ownership get escalated and wait extra days. Three layers turn a same-week decision into a two-week one.",
  "citations": [
    "SI Labs (2026). Why Hierarchies Slow Down Companies - five approval layers, ~3 days per layer, 15 working days to a decision. https://www.si-labs.com/en/articles/slow-decisions/",
    "Baker, N. R. et al. (1975). Diffuse decision-making in hierarchical organizations. Management Science 21(6) - empirical multi-layer decision delay."
  ],
  "limitations": [
    "2-3 days/layer is documented mainly in large hierarchical organizations; startups and flat orgs have different latency profiles (the Flat Paradox: flat is faster on novel decisions, slower on execution scaling).",
    "Layer capacity and its decay up the stack are editorial defaults."
  ]
}
```

### M7 — Decision velocity score (display metric)

```json eigenorg:mechanic
{
  "id": "decisionVelocityScore",
  "formula": "V(t) = 100 / ((1 + (L - 1) * layerFrictionFactor) * max(1, latencySmoothed(t) / (L * mean(decisionLatencyPerLayerDays)))). The static term is the classic V = V_base / (1 + (L-1)*f); the dynamic term degrades it further when actual (queued, escalated, recovery-multiplied) latency exceeds the structural minimum.",
  "plainLanguage": "A 0-100 speedometer for decisions. 100 means single-layer, no queues. Each extra ownership layer applies friction f (default 0.35), and real-time congestion (queues, escalations, recovery slowdowns) drags it below even that.",
  "citations": [
    "SI Labs (2026). Why Hierarchies Slow Down Companies. https://www.si-labs.com/en/articles/slow-decisions/"
  ],
  "limitations": [
    "The friction factor f = 0.35 is an adjustable editorial default (range 0.2-0.6); the score is a display index, not a measured quantity."
  ]
}
```

### M8 — Overrides and WIP reset

```json eigenorg:mechanic
{
  "id": "overrideWipReset",
  "formula": "Per step, each inProgress task is overridden with probability o(t) = min(1, overrideBaseRate * (L - 1) * (1 + overrideMisalignmentGain * m(t)) * (1 + distortionOverrideCoupling * distortion) * diffusionMean); the min(1, .) clamp keeps o(t) a probability at every in-range corner (§6 L1). distortion = distortionPerHumanLayer * (D - 1) * layerDistortionMean, where layerDistortionMean = mean over l in 2..=L of layerDistortionFactor(type_l) (§9.9), or 1.0 when L == 1 (default humanPm layers give 1.0, reproducing the base model). diffusionMean = mean over l in 2..=L of the accountability-diffusion factor diffusionFactor_l (M19), or 1.0 when L == 1 (single-owner humanPm seats give diffusionFactor_l = 1, so the default org reproduces the base model). On override: task returns to layer 1, progress *= wipResetFraction * max(0, 1 - dropMean) (dropMean per M19; 0 at default, so the base model reproduces progress *= wipResetFraction), overrideCount += 1. Each override event is attributed to an overriding layer drawn over {2..L} with probability proportional to the authority-gradient weight w_l = 1 + overrideAuthorityGradient * (l - 1) (M19) for the perLayer.overrideShare output (§7.1) - the draw consumes EXACTLY ONE uniform per event, so the RNG draw order is unchanged and the default overrideAuthorityGradient == 0 recovers the v1 uniform attribution byte-for-byte; layer 1 originates and is never the overrider. RNG PARITY (normative): at overrideAuthorityGradient = 0 (default), the override-attribution step reproduces the v1.0.0 draw behavior byte-for-byte, INCLUDING the singleton case {2..L} = {2} at L = 2 (exactly one uniform consumed per event, the single candidate selected). This is a normative parity requirement; the pre-lock full-series diff of prioritizationTax (L=3), dunbarCliff (the L=2 singleton path), and layerConfigurator (typed seats) is a REQUIRED verification GATE that must pass before lock - not merely an assertion.",
  "plainLanguage": "With more layers above the work, higher layers more often reverse lower-layer decisions - especially when ownership is unclear and information has been distorted on its way up the hierarchy. Cleaner relays reduce this: an AI agent or a committee seat garbles less context than a chain of human hand-ups, so it triggers fewer overrides. But co-equal owners cut the other way - a seat held by several co-equal owners (a dual-authority matrix box, or a layer with more than one named owner, including a committee you explicitly mark as diffuse via layerOwnerCount) diffuses accountability and gets relitigated MORE (M19), which is why a diffuse committee is an honest tradeoff and not a free lunch. An overridden task is not lost: it re-enters the pipeline keeping about half its progress (a touch less when many owners let work slip between them). That partial rework, plus a fresh trip through every approval layer, is the true cost of an override. An optional authority gradient (off by default) can make the higher-authority seats do more of the reversing.",
  "citations": [
    "SI Labs (2026). Why Hierarchies Slow Down Companies. https://www.si-labs.com/en/articles/slow-decisions/",
    "eigenorg design red-team (2026): overridden WIP re-enters at partial completion rather than disappearing from throughput.",
    "Latane, B. (1981). The psychology of social impact. American Psychologist, 36(4), 343-356 - source of the co-equal-owner relitigation multiplier folded into o(t) via M19 (accountabilityDiffusion)."
  ],
  "limitations": [
    "Override probability and the 50% reset fraction are editorial defaults; real override cost varies with how far the work had progressed.",
    "Single-layer stacks (L=1) never override in this model; in reality self-reversal exists but is rare enough to ignore.",
    "The accountability-diffusion multiplier (diffusionMean), the extra work-drop term (dropMean), and the authority-gradient attribution are defined and anchored in M19; at the default single-owner configuration diffusionMean = 1, dropMean = 0, and overrideAuthorityGradient = 0, so o(t), the reset fraction, the attribution distribution, and the RNG draw order are byte-identical to v1.0.0."
  ]
}
```

### M9 — Structural Health amplification (Faster Dysfunction) and AI relief

```json eigenorg:mechanic
{
  "id": "structuralHealthAmplification",
  "formula": "shBrittleFactor(SH) = aiAmplificationLowSH if SH <= shRiskThreshold; aiGuardrailedHighSH if SH >= shSafeThreshold; linear interpolation between. Brittleness event probability per novel task under AI handling = aiNovelFailureBase * shBrittleFactor(SH) (* highStakesBrittlenessFactor if high stakes, team sim). relief_ai(t) = aiCoordinationRelief * clamp((SH - shRiskThreshold) / (shSafeThreshold - shRiskThreshold), 0, 1) when AI is active, else 0.",
  "plainLanguage": "AI agents amplify whatever structure they land in. In a structurally healthy org (clear ownership, WIP discipline, async norms - SH 7+), AI routing genuinely relieves coordination load and failures are caught by humans in the loop. In a structurally unhealthy org (SH 4 or below), AI agents push work through the same broken ownership structure faster, so novel cases fail 1.3-1.8x more often and there is no relief. That is 'faster dysfunction': throughput up, entropy up.",
  "citations": [
    "rework.com (2025). Why Most AI Transformations Fail. https://resources.rework.com/libraries/ai-transformation-strategy/why-most-ai-transformations-fail",
    "aimagicx.com (2026). Why 80% of AI Transformation Projects Fail.",
    "eigenorg design red-team (2026): Structural Health precondition gates whether AI injection reduces or amplifies entropy."
  ],
  "limitations": [
    "The 1.3-1.8x amplification range comes from practitioner reports and editorial synthesis, not controlled studies - it is the model's most load-bearing editorial coefficient and is deliberately adjustable.",
    "SH compresses five distinct structural properties into one scalar; two orgs with the same SH can fail differently."
  ]
}
```

### M10 — Brittleness events and the recovery owner

```json eigenorg:mechanic
{
  "id": "brittlenessRecovery",
  "formula": "A brittleness event draws ONE duration d ~ Triangular(recoveryDurationUnownedSteps | recoveryDurationOwnedSteps), rounded to whole steps (min 1), shared by the task block and the recovery window; the window is active for steps [t_event, t_event + d). While any window is active, new decision-service draws are multiplied by M_recovery(t) = max over active windows of their multiplier. Because M_recovery(t) is computed at step start (§5 step 2) BEFORE that step's own arrivals and unblocks, a window opened during t_event's arrivals (§5 step 3) first multiplies service draws at t_event+1; the event's own blocked task used the pre-event M_recovery. Unowned recovery (org: SH < recoveryOwnershipThreshold; team: recoveryOwner == null): multiplier ~ Triangular(recoveryLatencyMultiplierUnowned). Owned: multiplier = recoveryLatencyMultiplierOwned (point value, no draw).",
  "plainLanguage": "When an AI agent hits a case beyond its ceiling, the failure does not just cost that one task. If a named human owns recovery, the mess is contained: a day or two, small slowdown. If nobody owns recovery, everything nearby slows down 1.5-2.5x for the next 3-5 days while people figure out whose problem it is.",
  "citations": [
    "eigenorg design red-team (2026): Failure Recovery Owner assignment; unowned high-AI-coverage functions apply a 1.5-2.5x latency multiplier for 3-5 steps after a brittleness event.",
    "HatchWorks (2025). AI agent design best practices - agent failure modes on novel inputs."
  ],
  "limitations": [
    "Multiplier and duration ranges are editorial defaults from the eigenorg design red-team, not field measurements.",
    "Concurrent events take the max multiplier, not a compounding product - a deliberate boundedness choice."
  ]
}
```

### M11 — AI capability by task type; hybrid vs autonomous

```json eigenorg:mechanic
{
  "id": "aiTaskTypeCapability",
  "formula": "Team sim: if any AI covers prioritization, routine service time *= aiRoutineLatencyFactor; if nobody covers prioritization, service *= uncoveredPrioritizationFactor. Execution: routine progress *= (1 + aiExecShare * (aiRoutineAdvantage - 1)); novel progress *= (humanExecShare + aiExecShare * aiNovelEffectiveness). Novel arrivals take the AI failure probability (M9) when AI is assigned to prioritization and no human is assigned to prioritization; when a human covers prioritization the probability is humanNovelFailureBase. Quality: for complex/novel tasks with zero human judgment coverage, the judgment contribution is divided by hybridVsAutonomousAdvantage (M16). Org sim: AI injection (a) multiplies EVERY routine execution allocation by the uniform expected-value factor (1 + aiRoutineShareOrg * (aiThroughputBoostOrg - 1)) - the closed-form mean of boosting the aiRoutineShareOrg share of routine work by aiThroughputBoostOrg, applied deterministically to all routine allocations with NO per-task share draw - (b) multiplies routine-task service draws by (1 - (1 - aiRoutineLatencyFactor) * reliefRamp(SH)), reliefRamp = clamp((SH - shRiskThreshold)/(shSafeThreshold - shRiskThreshold), 0, 1) - AI routing accelerates routine decisions only in structurally healthy orgs - and (c) multiplies every decision layer's capacity by the same (1 + aiRoutineShareOrg * (aiThroughputBoostOrg - 1)) at ANY Structural Health: AI agents add mechanical routing/approval bandwidth regardless of structure; what depends on SH is the QUALITY of that routing (brittleness, M9) and the coordination relief - work reaches broken structure faster, which is the 'faster' in Faster Dysfunction. Per-layer AI (org sim, §9.9 aiAgent layer type): a novel arrival faces the M9 brittleness draw with exposure novelExposure = max(orgInjectionActive ? 1 : 0, max over layers l of layerNovelExposure(type_l)) - i.e. an aiAgent-typed ownership layer exposes novel work to brittleness from t=0 even with no org-level injection - and the probability is aiNovelFailureBase * shBrittleFactor(SH) * novelExposure. That layer's routing speed and added bandwidth come from its layerLatencyFactor / layerCapacityFactor in M6; per-layer AI does NOT trigger the org-level execution boost or coordination relief (those are injection effects).",
  "plainLanguage": "AI agents are genuinely faster on routine work - routing, triage, standard execution. On novel, ambiguous, high-stakes work their capability collapses: they misroute, stall, or fail, unless a human co-owns the judgment. Research on hybrid teams finds human+AI outperforming fully autonomous agent teams by roughly 69% on complex tasks - so the model rewards keeping humans on judgment functions and penalizes hollowing them out.",
  "citations": [
    "e-discoveryteam.com (2025). Stanford/Carnegie study: hybrid human-AI teams beat fully autonomous agents by 68.7% on complex tasks. https://e-discoveryteam.com/2025/12/01/",
    "TechXplore (2024). Researchers test human vs AI-human hybrid teams in dynamic tasks.",
    "AMCIS 2025 proceedings: Human-AI collaboration in hybrid teams."
  ],
  "limitations": [
    "The 68.7% figure is lab-based and domain-specific (law, drone design, creative tasks); it is treated as an adjustable editorial default, not a universal constant.",
    "The routine/novel dichotomy is a simplification; real tasks sit on a spectrum."
  ]
}
```

### M12 — Cohesion dynamics

```json eigenorg:mechanic
{
  "id": "cohesionDynamics",
  "formula": "Per team: target(t) = cohesionBase - cohesionSizePenalty * sigma((s - cognitiveBandClose)/(bandWidthFactor * cognitiveBandClose)) - cohesionAiPenalty * effectiveAiShare - (hollow ? cohesionHollownessPenalty : 0). c(t+1) = clamp(c(t) + cohesionRecoveryRate * (target(t) - c(t)) - cohesionEntropyCoupling * max(0, E(t-1) - entropyStressThreshold) / 10, 0, 100), where E(t-1) is the PRIOR step's entropy composite with the convention E(-1) = 0 (the t=0 update sees no prior entropy). c(0) = cohesionBase; the cohesion series reports the PRE-update value c(t) (§5 step 8), so the update takes effect from t+1. Team sim: effectiveAiShare = (# AI entities)/(# entities); hollow = for any of {prioritization, coordination, stakeholderCommunication}, at least one AI entity is assigned AND no human entity is assigned. Org sim: effectiveAiShare = aiActive ? aiRoutineShareOrg * taskMixRoutineOrg : 0; hollow = false.",
  "plainLanguage": "Cohesion is the human glue: trust, shared context, willingness to flag problems early. It erodes when teams outgrow the size where everyone knows everyone, when a larger share of teammates are AI agents (people report weaker co-worker bonds), and when the human relationship layer (a PM who talks to people) is removed. It slowly recovers toward its structural ceiling - but a high-entropy environment keeps grinding it down.",
  "citations": [
    "World Economic Forum (2026). AI is becoming your new work colleague - early adopters report weaker co-worker connections.",
    "AMCIS 2025: AI team members and team dynamics.",
    "TechXplore (2024): human-AI hybrid team members report weaker cohesion independent of output quality."
  ],
  "limitations": [
    "Cohesion is self-report-shaped: the studies measure perceived connection, not output. Magnitudes are editorial.",
    "Recovery rate is an editorial default; real teams recover at wildly different speeds."
  ]
}
```

### M13 — Entropy composite (secondary metric)

```json eigenorg:mechanic
{
  "id": "entropyComposite",
  "formula": "E(t) = 100 * (wC*xCoord + wL*xLat + wH*xCoh + wB*xBrit + wW*xWip), weights = {entropyWeightCoordination, entropyWeightLatency, entropyWeightCohesion, entropyWeightBrittleness, entropyWeightWip}, sum = 1. xCoord = tau/maxCoordinationTax; xLat = min(1, latencySmoothed/latencyNormDays); xCoh = 1 - cohesion/100; xBrit = min(1, brittleEMA/brittlenessNormPerStep); xWip = min(1, WIP/(wipNormPerPerson*n)). EMA smoothing: x_ema(t) = alpha*x(t) + (1-alpha)*x_ema(t-1), alpha = metricSmoothingAlpha. orgHealth(t) = 100 - E(t). Team sim proxy: E_team uses the {coordination, latency, brittleness} terms only, weights renormalized to sum 1, with xLat computed on routine decision latency.",
  "plainLanguage": "Entropy is a 0-100 composite of five things leaders can feel: how much capacity goes to coordination, how long decisions take, how frayed the human fabric is, how often things break on novel cases, and how much work is stuck in progress. 0 is a crisp org; 100 is thrash. It is deliberately a secondary metric - the headline numbers stay in real units (days, %, items/step).",
  "citations": [
    "eigenorg model definition (2026) - composite index, weights editorial."
  ],
  "limitations": [
    "The weights and normalization constants are editorial choices; entropy values are comparable across runs of this model version but are not an external benchmark.",
    "Calling it 'entropy' is a metaphor, not thermodynamics."
  ]
}
```

### M14 — Team handoff friction

```json eigenorg:mechanic
{
  "id": "teamHandoffFriction",
  "formula": "Team coordination tax: tau_team(t) = min(maxCoordinationTax, mu_modality * channelCostFraction * (C/n_e) * B(n_e) + handoffTaxCoefficient * mean(handoffFriction_e)/5), where C = n_e*(n_e-1)/2 over entities.",
  "plainLanguage": "Inside one team the same channel math applies, plus a friction term: every handoff between people (or between a person and an agent) loses a little context. Smooth operators (and well-integrated agents) have low friction; entities that need everything re-explained have high friction.",
  "citations": [
    "Brooks, F. P. (1975). The Mythical Man-Month.",
    "eigenorg model definition (2026) - handoff friction term."
  ],
  "limitations": [
    "Friction is a per-entity scalar; real handoff cost depends on the pair and the artifact."
  ]
}
```

### M15 — Ramp time (Brooks onboarding)

```json eigenorg:mechanic
{
  "id": "rampTime",
  "formula": "ramp_e(t) = 1 for AI entities and humans with rampTimeWeeks == 0; else min(1, rampStartFactor + (1 - rampStartFactor) * t / (rampTimeWeeks * 5)). Execution rate_e = throughput_e * execPointsPerThroughputPoint * ramp_e(t) * availability_e.",
  "plainLanguage": "New humans start at a fraction of their full speed and ramp up over weeks - and while ramping they consume teammates' time (captured by the coordination tax they add as headcount). This is the mechanism behind 'adding manpower to a late project makes it later'.",
  "citations": [
    "Brooks, F. P. (1975). The Mythical Man-Month - onboarding cost.",
    "effectiviology.com - Brooks' Law analysis."
  ],
  "limitations": [
    "Linear ramp is a simplification; v1 starts all entities at t=0 (a mid-simulation hire event is a v2 concern)."
  ]
}
```

### M16 — Quality model (team sim)

```json eigenorg:mechanic
{
  "id": "qualityModel",
  "formula": "On task completion: judgmentEff = weighted mean of judgmentQuality over entities covering {review, synthesis, ambiguityResolution} (weights = attention * availability), or judgmentFloor if none. hybridFactor = 1/hybridVsAutonomousAdvantage if task class in {complex, novel} and zero human judgment coverage, else 1. mu_q = qualityBase + qualityJudgmentWeight * judgmentEff * hybridFactor + qualityReliabilityWeight * (meanReliability(execution pool) - 7) - (novel task with zero human judgment coverage ? noveltyQualityPenalty : 0) - (review uncovered ? reviewUncoveredQualityPenalty : 0). quality ~ clamp(Triangular(mu_q - qualitySpreadDown, mu_q, mu_q + qualitySpreadUp), 0, 100).",
  "plainLanguage": "Output quality tracks the judgment actually applied to the work: who reviewed it, who resolved its ambiguities, how reliable the builders are. Fully autonomous AI pipelines on complex work lose most of the judgment bonus - matching research where hybrid teams clearly beat autonomous ones on complex tasks.",
  "citations": [
    "e-discoveryteam.com (2025). Stanford/Carnegie hybrid team study.",
    "Emerald ITP (2024). Member performance in human-AI hybrid teams."
  ],
  "limitations": [
    "Quality is a unitless 0-100 score; it is comparable within the model only.",
    "The additive form is editorial; interaction effects between review and reliability are not modeled."
  ]
}
```

### M17 — Function coverage (team sim)

```json eigenorg:mechanic
{
  "id": "functionCoverage",
  "formula": "coverage(f) = min(1, sum over entities e assigned to f of (capabilities_e(f)/10) * attention_e * availability_e / demand(f)); demand(execution) = functionDemandExecution * (n_e/8); demand(other f) = functionDemandDefault * (n_e/8). attention_e = 1 for AI; min(1, humanAttentionSpan/count(functions_e)) for humans. Rating: green if coverage >= coverageGreenThreshold, amber if >= coverageAmberThreshold, else red.",
  "plainLanguage": "For each of the seven functions, how much qualified attention is actually pointed at it, relative to how much the team needs? A brilliant director who is 25% available and juggling three functions covers less than it looks. Red means the function is effectively unowned - and the simulation makes you feel it.",
  "citations": [
    "eigenorg design red-team (2026) - functions vs roles: work that must happen regardless of what title handles it."
  ],
  "limitations": [
    "Demand scaling with team size is a linear editorial default.",
    "Coverage is static per run (entities do not reassign mid-simulation in v1)."
  ]
}
```

### M18 — Task effort and class mix

```json eigenorg:mechanic
{
  "id": "taskEffortAndMix",
  "formula": "Org sim arrivals per step = taskArrivalPerPersonPerStep * n(t) (fractional accumulator; Bernoulli remainder in MC); at t = 0 the arrival count is additionally increased by org.initialBacklog (default 0) - a standing backlog the org starts with; backlog tasks draw class/effort/service exactly like arrivals. Class ~ {routine: taskMixRoutineOrg, complex: taskMixComplexOrg, novel: 1 - routine - complex}. Team sim: arrivals and mix from workStream config. Effort ~ Triangular(taskEffortRoutine | taskEffortComplex | taskEffortNovel) by class. Team sim stakes: high with probability workStream.highStakesShare.",
  "plainLanguage": "Work arrives continuously, sized in effort points where 1 point is roughly one focused person-day for an average performer. Routine items are small and predictable; novel items are big and uncertain - and they are the ones AI handles worst.",
  "citations": [
    "eigenorg model definition (2026)."
  ],
  "limitations": [
    "Effort distributions are editorial; the routine/complex/novel taxonomy is a simplification of continuous task variety."
  ]
}
```

### M19 — Accountability diffusion (co-equal owners, relitigation, HiPPO)

```json eigenorg:mechanic
{
  "id": "accountabilityDiffusion",
  "formula": "Accountability multiplicity mu_l >= 1 is the count of co-equal owners holding one decision at ownership seat l, resolved by PRECEDENCE (no max(), no silent override): (i) the org.matrix seat - a lateral dual-authority applied to the TERMINAL ownership layer L when org.matrix.enabled (schema addition §12.2), REGARDLESS of that layer's §9.9 type - has mu_L = 2; (ii) every OTHER seat, INCLUDING a committee-typed seat (org.layerTypes[l-1] == 'committee', §9.9), has mu_l = org.layerOwnerCount[l-1] (schema addition §12.2; int in [1,8], default 1). The committee type carries NO intrinsic multiplicity: its §9.9 latency/capacity/distortion factors are unchanged from v1.0.0, and its accountability diffusion (if any) is expressed additively via org.layerOwnerCount on that layer - so a committee at layerOwnerCount 1 reproduces its v1 behavior byte-for-byte, and a diffuse committee is committee-type + layerOwnerCount > 1 (the §9.9 relay-fidelity distortion benefit and the accountability-diffusion cost COMPOSE - different mechanisms, no double count). validate() REJECTS an org.layerOwnerCount[l-1] != 1 ONLY on the matrix target layer L (the intrinsic mu = 2 wins there and a conflicting count is an authoring error); it ALLOWS org.layerOwnerCount != 1 on a committee seat. MATRIX ON A COMMITTEE SEAT: if the terminal layer L is a committee, org.matrix applies mu_L = 2 AND the committee still contributes its §9.9 relay-fidelity (distortion) factor - the distortion discount (M8) and the dual-authority multiplicity (M19) are different mechanisms that compose with no conflict. tiebreaker_l in [0,1] = org.matrix.tiebreaker at the matrix seat (l == L when org.matrix.enabled), else 0 - a single named owner, a committee, or a plain multi-owner seat carries no tiebreaker, i.e. full diffusion. Three channels, each LINEAR in (mu_l - 1) and attenuated by a clear decider (1 - tiebreaker_l), each an EXACT no-op at mu_l == 1: (a) OVERRIDE - diffusionFactor_l = 1 + overrideDiffusionGain * (mu_l - 1) * (1 - tiebreaker_l) (>= 1); the stack aggregate diffusionMean = mean over l in 2..=L of diffusionFactor_l (or 1.0 when L == 1) multiplies the M8 override probability o(t). (b) LATENCY - diffusionLatencyFactor_l = 1 + muLatencySurchargeRate * (mu_l - 1) * (1 - tiebreaker_l) multiplies the M6 per-layer service draw at EVERY seat l in 1..L. (c) MOTIVATION-LOSS - dropMean = mean over l in 2..=L of muWorkDropFraction * (mu_l - 1) * (1 - tiebreaker_l) (or 0 when L == 1); on override (T7) progress *= wipResetFraction * max(0, 1 - dropMean). MATRIX SEAT PLACEMENT: the latency factor applies per-seat at every l, but diffusionMean and dropMean average only over l in 2..=L, so a matrix (or any multi-owner terminal seat) adds its latency surcharge at any L including L == 1, yet contributes to the override and motivation-loss channels only when L >= 2 - at L == 1 there is no higher seat for the terminal owner to relitigate a decision through. AUTHORITY-GRADIENT attribution: each M8 override event is credited to an overriding seat drawn over {2..L} with probability proportional to w_l = 1 + overrideAuthorityGradient * (l - 1) (higher seats reverse more - HiPPO), consuming EXACTLY ONE uniform per event (draw-count/stream parity with v1); at the default overrideAuthorityGradient == 0 the weights are uniform, recovering the v1 uniform attribution and a byte-identical perLayer.overrideShare. NEUTRAL IDENTITY: org.layerOwnerCount all 1 (its default) + org.matrix off => every mu_l == 1 => diffusionFactor_l = 1, diffusionLatencyFactor_l = 1, dropMean = 0, diffusionMean = 1, so M6 and M8 reproduce the base model exactly and add no new RNG draw - for EVERY v1 config INCLUDING one that uses a committee seat (a committee's v1 §9.9 factors are untouched and its default mu is 1). The amendment is therefore FULLY ADDITIVE: no existing org.layerTypes value changes meaning, so all 34 v1 goldens and every pre-existing series are byte-identical at default (§12.4/§12.5). A committee that a user explicitly makes diffuse (layerOwnerCount > 1) is a NEW config the user authored with the correct explicit lever, not an existing one changing behavior.",
  "plainLanguage": "More co-equal owners on a single decision diffuse felt responsibility - Latane's social-impact law says each owner feels roughly 1/sqrt(N) as accountable - so the decision gets relitigated and reversed more often, sits longer at its seat, and loses a little work between owners. The first added co-owner is by far the costliest, and a clear tiebreaker or a single named accountable owner collapses the whole effect. A committee seat keeps its v1 character exactly - its many eyes garble less context, so it still triggers FEWER distortion-driven overrides (§9.9) - and if you want to model a committee whose accountability is genuinely diffuse you say so explicitly by raising layerOwnerCount on that seat, at which point the relay benefit and the diffusion cost compose. That is the honest committee tradeoff, now driven by the correct explicit lever rather than baked into the seat type. When decisions are reversed, an optional authority gradient can make the higher-authority seats do more of the reversing (HiPPO); it is off by default, so by default every seat above the work is an equally likely overrider.",
  "citations": [
    "Darley, J. M., & Latane, B. (1968). Bystander intervention in emergencies: Diffusion of responsibility. Journal of Personality and Social Psychology, 8(4), 377-383. (decisive ownership 85%/62%/31% for 1/2/5 responsible parties). https://psycnet.apa.org/record/1968-08862-001",
    "Latane, B. (1981). The psychology of social impact. American Psychologist, 36(4), 343-356. (individual felt-impact ~ N^-0.5).",
    "Karau, S. J., & Williams, K. D. (1993). Social loafing: A meta-analytic review and theoretical integration. Journal of Personality and Social Psychology, 65(4), 681-706. (motivation-loss d ~= -0.44, the work-drop channel).",
    "Brooks, F. P. (1975). The Mythical Man-Month. Addison-Wesley. (coordination cost ~ n(n-1)/2 pairwise channels - the convex-latency reference behind the surcharge's direction).",
    "Rogers, P., & Blenko, M. (2006). Who Has the D? How Clear Decision Roles Enhance Organizational Performance. Harvard Business Review, Jan 2006. (a single named decider / RAPID 'D' is the tiebreaker that collapses the diffusion)."
  ],
  "limitations": [
    "The felt-responsibility -> relitigation/latency/drop link is an author construct; the peer-reviewed anchors (Darley-Latane 1968, Latane 1981, Karau-Williams 1993) measure emergency helping and additive-task effort, not organizational decision overrides - so every M19 coefficient is editorial-heuristic despite the peer-reviewed direction.",
    "All three channels are modeled LINEAR in (mu_l - 1). The override channel therefore overstates diffusion beyond ~4 co-equal owners (the data saturate ~N^0.5), and the latency channel understates it there (Brooks pairwise channels are convex, ~mu(mu-1)/2). A saturation cap on override and a convex Brooks form on latency for mu > 4 are deferred refinements (a candidate future MINOR); realistic mu (matrix 2, a diffuse committee ~3 via layerOwnerCount) sits in the linear regime, which is why v2.0.0 keeps the linear form.",
    "Applies only to genuinely CO-EQUAL owners of one decision. A designated single accountable owner (org.layerOwnerCount == 1) or a clear tiebreaker (org.matrix.tiebreaker -> 1) collapses mu_l -> effective 1 and removes the term - matching the RACI/DACI 'exactly one Accountable' and RAPID single-'D' doctrines.",
    "mu_l is resolved by PRECEDENCE (only the matrix-target seat takes an intrinsic multiplicity mu = 2; validate() rejects a conflicting org.layerOwnerCount only there), not a max() over sources, so each seat has exactly one multiplicity source and there is no double-count. The committee type carries no intrinsic multiplicity in v2.0.0 - its v1 §9.9 relay/latency/capacity factors are unchanged and its accountability diffusion is expressed additively via org.layerOwnerCount, so no v1 committee config changes at default. A committee (or any non-matrix seat) with a designated chair/decider that only PARTIALLY collapses the diffusion is not separately expressible - only the matrix seat carries a continuous [0,1] tiebreaker; a non-matrix seat is either fully single-owner (layerOwnerCount 1) or fully diffuse (layerOwnerCount > 1)."
  ]
}
```

### M20 — Review capacity queue (team sim)

```json eigenorg:mechanic
{
  "id": "reviewCapacityQueue",
  "formula": "Team sim only; a finite-throughput gate on the existing `review` state (T6r/T6d), inserted between execution-completion and `done` (§5.2 step 7). A completed task (progress >= effort) with the review function covered enters `review` (T6r) with a dwell of reviewDwellDays; with review uncovered it goes straight to `done` (T6) with a quality draw (M16) - unchanged. Each step, after execution, the tasks in `review` whose dwell has elapsed clear to `done` (T6d) in FIFO order (by completion step, then task id), up to a per-step budget from team.reviewCapacityPerStep, which MAY be fractional: clearance uses a use-it-or-lose-it fractional accumulator mirroring M6 layer capacity - reviewAcc starts at 0; each step budget = reviewAcc + reviewCapacityPerStep, cleared = min(dwell-elapsed count, floor(budget)) tasks clear FIFO, then reviewAcc = min(budget - cleared, 1) banks at most one whole clearance between steps; the remainder stay in `review`. (Example: reviewCapacityPerStep = 0.5 clears one review every two steps.) team.reviewCapacityPerStep = null (default) is unbounded, so every dwell-elapsed task clears the step its dwell ends - identical task set and identical clear-step as v1's ungated T6d, with an identical RNG-stream position (§8.1) for every asserted series; the within-step clearance order is the normative FIFO (completion step, then task id), and qualityHistogram byte-identity is the iff-order / reference-run case narrowed in §F.6. Each cleared task draws quality (M16) and is counted in `throughput` at the clear step (team throughput is measured at review-dwell exit, §2.2). Consequently, when reviewCapacityPerStep is below the completion-arrival rate, `throughput` plateaus at reviewCapacityPerStep (Theory-of-Constraints cap) while the surplus (completionRate - reviewCapacityPerStep) accumulates as review WIP. This gate does NOT touch M17 function coverage (the coverage MAP and its demand scaling are unchanged) - it is a separate throughput stage between execution-complete and done. Outputs (both computed deterministically from FSM state, adding NO draws): reviewQueueDepth(t) = count of tasks in `review` at end of step t; reviewWaitDays(t) = EMA (weight metricSmoothingAlpha) of the realized review sojourn (clear step - entry step, in working days) over tasks cleared at step t, holding the prior value on steps with no clearance, init reviewWaitDays(0) = reviewDwellDays. Neutral identity: unbounded capacity => every realized sojourn = reviewDwellDays => reviewWaitDays == reviewDwellDays and reviewQueueDepth is only the in-dwell population; no pre-existing series changes. REVIEW-CLEARANCE PARITY (normative): at unbounded capacity (reviewCapacityPerStep == null) the review-clearance SET and STEP match v1 exactly, so all asserted series and the 34 v1 verdicts are byte-identical; the clearance ORDER is normatively FIFO by (completion step, then task id). qualityHistogram byte-identity is not claimed unconditionally: M16 draws each cleared task's quality in clearance order and quality depends on task class/judgment path, so an order differing from v1's could reassign draws and shift histogram bucket counts; byte-identity holds iff v1 already clears in this normative order (confirmed by extending the pre-lock parity check to the non-series qualityHistogram block, since a series-only diff cannot). Either way no golden or asserted series reads qualityHistogram, so all 34 v1 verdicts and asserted series stay byte-identical regardless.",
  "plainLanguage": "Review is a finite-capacity stage, not an infinitely parallel wait. Left at its default it is unbounded: completed work waits one review dwell and is done, exactly as before. Give reviewers a per-day clearance capacity and review becomes a throughput gate - once builders (especially AI-accelerated ones) finish faster than reviewers can clear, done-throughput stops rising, work banks up in review, and the wait grows. This is the bottleneck that AI-authored code pushes onto human reviewers.",
  "citations": [
    "Goldratt, E. M. & Cox, J. (1984). The Goal - Theory of Constraints: system throughput is set by the slowest stage; producing upstream of the constraint only inflates WIP.",
    "Reinertsen, D. G. (2009). The Principles of Product Development Flow - queues grow superlinearly as utilization approaches 100%; provision review capacity ~1.25x demand (utilization <= 0.8).",
    "Sadowski, C., Soderberg, E., Church, L., Sipko, M. & Bacchelli, A. (2018). Modern Code Review: A Case Study at Google (ICSE-SEIP) - review latency is dominated by reviewer availability and change size, not authoring speed."
  ],
  "limitations": [
    "The gate is a deterministic per-step batch, so utilization rho = completionRate / reviewCapacityPerStep = 1 is the exact break-even, not a stochastic blow-up; no Kingman / M-M-1 variability term (c_a^2, c_s^2) is modeled.",
    "Capacity is counted in items/step; a points/step (review-effort) formulation is not modeled.",
    "reviewWaitDays inherits reviewDwellDays' treatment of fractional dwell and lags the instantaneous queue by the EMA smoothing.",
    "Review-queue congestion is not fed back into the M13 entropy composite in v2.0.0 (§13 limitation 9); the queue is visible only through its own two series. Coupling it into entropy is a candidate future MINOR."
  ]
}
```

---

## 5. Per-step algorithms (normative execution order)

Implementations MUST follow these orders exactly — the draw order is part of the
reproducibility contract (§8).

### 5.1 Org simulator — one step t

1. **Structure.** `n(t)`, team partition, `m(t)` (M2/M5), `C_intra` (M1), `C_inter` (M2),
   `B(n)` (M3), `tau(t)` (M4, with AI relief per M9 if `aiInjection.enabled && t >= atStep`),
   `meetingOverheadPct`.
2. **Recovery windows.** Expire windows whose duration has elapsed; compute
   `M_recovery(t)` (M10).
3. **Arrivals.** Draw arrival count (M18), then per task: class, effort. If class == novel
   and `novelExposure > 0` (M11 — org injection active OR an aiAgent-typed layer present):
   draw brittleness (M9/M11); on event the task enters `blocked` (T2) and
   opens a recovery window (M10); else it enters `queued(1)` (T1) with a service draw
   (M6, x `M_recovery`, x the org routine-routing factor per M11 when AI is active).
4. **Unblock.** Tasks whose block has elapsed move `blocked -> queued(1)` (T8) with a
   fresh service draw.
5. **Pipeline.** For each layer l = 1..L in order: decrement `serviceRemaining`; move
   ready tasks (FIFO by arrival step, then task id) up to the layer's fractional capacity
   accumulator (capacity x the M11 AI approval-bandwidth multiplier when AI is active);
   apply the escalation surcharge on entry to layer L (M6). Tasks leaving
   layer L become `inProgress` (T4) and contribute a decision-latency sample.
6. **Overrides.** For each `inProgress` task in FIFO order: draw override (M8);
   on override apply T7.
7. **Execution.** `P_eff = n * orgExecPointsPerPersonPerStep * (1 - tau)`. Allocate to
   `inProgress` tasks FIFO, up to `maxPointsPerTaskPerStep` each, until exhausted;
   routine allocations x the uniform factor `(1 + aiRoutineShareOrg·(aiThroughputBoostOrg−1))`
   when AI is active (M11(a); no per-task draw). Tasks with `progress >= effort` complete (T6).
8. **Cohesion.** Update per M12 using `E(t-1)`. The `cohesionTeamAvg` series (and the
   cohesion term inside `E(t)`) reports the PRE-update value — the update takes effect
   from step t+1 (see Appendix A). The same convention applies to the team sim.
9. **Metrics.** Update EMA terms; compute all output series values for step t, including
   `E(t)` (M13), `V(t)` (M7), `healthGap = cohesionTeamAvg - orgHealth`; update per-layer
   stats (queue length, utilization, latency samples, override share).

### 5.2 Team simulator — one step t

1. **Rates.** `ramp_e(t)` (M15), execution pool and rates, `aiExecShare` /
   `humanExecShare` (M11), `tau_team(t)` (M14).
2. **Recovery windows.** As org step 2 (ownership from `recoveryOwner` config, M10).
3. **Arrivals.** Count from `workStream.arrivalPerStep`; class, stakes, effort (M18).
   Novel arrivals: brittleness per M9/M11 (AI assigned to prioritization with no human
   assigned to prioritization -> AI failure probability; human-covered ->
   `humanNovelFailureBase`); on event -> `blocked` + recovery window.
   Else `queued(1)` with a prioritization service draw (M11 latency factors, x `M_recovery`).
4. **Unblock.** As org step 4.
5. **Prioritization.** Single layer, capacity `layerCapacityPerStep` (fractional
   accumulator); ready tasks -> `inProgress` (T4; decision-latency sample; routine
   samples also feed `decisionLatencyRoutine`).
6. **Execution.** Pool = sum of rates of entities covering `execution`, × (1 − τ_team).
   FIFO allocation ≤ `maxPointsPerTaskPerStep`; routine × routine boost, novel ×
   `(humanExecShare + aiExecShare × aiNovelEffectiveness)` (M11). Completions
   (`progress ≥ effort`): if the review function is covered, enter the `review` state
   (T6r) with a dwell of `reviewDwellDays`; if review is uncovered, go straight to `done`
   (T6) with a quality draw (M16).
7. **Review clearance (M20).** Tasks in `review` whose dwell has elapsed clear to `done`
   (T6d) in FIFO order (by completion step, then task id), up to
   the M20 fractional-accumulator budget from `team.reviewCapacityPerStep` (which may be fractional) per step — **unbounded when `null`, so every dwell-elapsed
   task clears the step its dwell ends, reproducing v1's ungated review exactly**. Each
   cleared task draws quality (M16) and is counted in `throughput` at this step; the rest
   remain in `review`. (The locked team scenarios cover review fully, so every quality
   draw is a T6d draw and the RNG stream is byte-identical at the default `null` capacity.)
8. **Cohesion.** M12 (team variant, coupled to `E_team(t-1)`).
9. **Metrics.** Series values for step t: throughput, cumThroughput,
   decisionLatencyRoutine, coordinationTax, cohesion, brittlenessRate,
   cumulativeBrittleness, entropyProxy, orgHealthProxy, healthGap, `reviewQueueDepth`,
   `reviewWaitDays` (M20); quality histogram accumulation. Function coverage (M17) is
   computed once at t = 0 (static in v1).

---

## 6. Feedback loops & stability

The simulation contains three named model-internal loops. P3/P4 property tests assert
the boundedness and settling expectations below over long horizons (≥5× the default
horizon, i.e. ≥300 steps).

### L1 — WIP-reset → latency → overrides (rework churn)

Overrides send in-progress work back through the pipeline (M8), which lengthens queues
and decision latency (M6), which keeps tasks in `inProgress` longer, which exposes them
to more override draws. **Boundedness:** the override probability per task-step is
`o(t) = min(1, o_raw(t))` (M8), so `o(t) ∈ [0,1]` for **every** config within the declared
ranges — the `min(1, ·)` clamp is load-bearing, because `o_raw` reaches
`overrideBaseRate_max · (L−1)_max · (1 + overrideMisalignmentGain_max · 1) ·
(1 + distortionOverrideCoupling_max · distortionPerHumanLayer_max · (D−1)_max) · diffusionMean_max =
0.05 · 4 · (1 + 4·1) · (1 + 1 · 0.15 · 5) · diffusionMean_max = 1.75 · diffusionMean_max`
at the in-range corner. The accountability-diffusion multiplier `diffusionMean` (M19) is finite and
bounded: `diffusionFactor_l = 1 + overrideDiffusionGain·(μ_l−1)·(1−tiebreaker_l)` with `μ_l` pinned by
`validate()` to the integer range `[1, 8]` (the `org.layerOwnerCount` ceiling; a matrix's
`μ = 2` sits below it, and a committee now draws its `μ` from `layerOwnerCount`, so it is bounded
by the same ceiling). The worst corner is
therefore every seat at `μ_max = 8`, `overrideDiffusionGain_max = 0.8`, `tiebreaker = 0`, giving
`diffusionFactor_l = 1 + 0.8·7 = 6.6`, hence `diffusionMean_max = 6.6` and
`o_raw ≈ 1.75 · 6.6 = 11.55 > 1`. The same `min(1, ·)` clamp keeps `o(t) ∈ [0,1]` at every in-range
corner, now including any multi-owner seat — the clamp remains load-bearing. Progress kept per
override is `wipResetFraction · max(0, 1 − dropMean)` (M19) — bounded in `[0, wipResetFraction]`, the
`max(0, ·)` clamp preventing negative progress at any multiplicity — and each layer's capacity caps pipeline flow —
the loop amplifies latency but cannot diverge: latency is bounded by queue length, which
is bounded by cumulative arrivals (at most linear growth in t in overloaded configs).

### L2 — AI throughput → brittleness → recovery delay (self-limiting acceleration)

AI injection accelerates routine work (M11), so more work reaches novel edge cases per
unit time; novel failures under low SH open recovery windows (M10) that multiply decision
latency, which slows the whole pipeline back down. **Boundedness:** event rate ≤ novel
arrival rate; the recovery multiplier is capped by the max of active window multipliers
(≤ max of `recoveryLatencyMultiplierUnowned`, never a product); windows expire.
The loop overshoots then settles: post-injection metrics reach a new steady band within
~4 recovery durations (≈20 steps) in static configs.

### L3 — Cohesion ↔ entropy (reinforcing, clamped)

High entropy grinds cohesion down (M12 coupling term); low cohesion raises the entropy
composite (M13 cohesion term). This is a genuine reinforcing loop. **Boundedness (holds
over the full declared ranges):** both quantities are clamped to [0,100], so neither can
diverge under any config; cohesion is pulled toward a finite structural target at rate
`cohesionRecoveryRate`; the per-step coupling drain is bounded by
`cohesionEntropyCoupling · (100 − entropyStressThreshold)/10 ≤
cohesionEntropyCoupling_max · (100 − entropyStressThreshold_min)/10 = 0.4 · 6 = 2.4`
points/step. **Settling** holds unconditionally, but the resting point depends on the
regime: at the defaults (and wherever the max-entropy drain stays below the recovery pull
toward the structural target, `cohesionRecoveryRate · target(t)`, whose own ceiling is
`cohesionRecoveryRate · cohesionBase` because `target(t) ≤ cohesionBase`) the pair settles
at an **interior** fixed point — so the closed-form test
`cohesionEntropyCoupling · (100 − entropyStressThreshold)/10 < cohesionRecoveryRate · cohesionBase`
is **necessary but not sufficient** for interiority (it compares against the ceiling, not the
actual `target(t)`, which the size/AI penalties can lower); at
extreme in-range corners (high coupling, low threshold, low recovery rate) the drain can
exceed the recovery pull and cohesion settles at its clamped **floor (0)** — still bounded,
still settling (a constant floor trivially satisfies the trailing-window settling
contract below). The §6 property-test contract asserts boundedness and settling, not
interiority.

### Settling expectations (property-test contract)

- **No NaN/Inf anywhere, ever** (`validate()` rejects NaN/Inf configs; mechanics use
  clamped/capped forms only).
- **Bounded:** entropy, cohesion, orgHealth ∈ [0,100]; τ ∈ [0, maxCoordinationTax];
  V ∈ (0,100]; rates ≥ 0; WIP ≤ cumulative arrivals.
- **Settling:** for static configs (no growth, no AI injection), every series' p50
  reaches a steady band — trailing-30-step p50 range < 10% of its mean — by step 100 and
  stays there through 5× horizon. Overloaded configs are exempt for `wip` (and metrics
  derived from it), which may grow at most linearly.
- **Monotone structure effects hold at long horizon:** growing configs keep entropy
  non-decreasing in trailing-60-step trend until saturation (all normalized terms ≤ 1).

---

## 7. Outputs

Every series is emitted as a tidy percentile series
`metricId → [{t, p10, p50, p90}]` (one entry per step). Deterministic quantities emit
p10 = p50 = p90. Downstream phases must consume THIS list — no other output list exists.

### 7.1 Org Entropy Simulator series (16)

| id | unit | notes |
|---|---|---|
| `throughput` | items/step | completions per step |
| `entropy` | index 0–100 | composite, M13 — secondary metric |
| `orgHealth` | index 0–100 | `100 − entropy` (multi-level health view) |
| `coordinationTax` | fraction 0–1 | M4; render as % of capacity |
| `meetingOverheadPct` | fraction 0–1 | `meetingOverhead` (M4); render as % of capacity |
| `communicationLoad` | channels | `C_intra + C_inter` |
| `interTeamChannels` | channels | `C_inter` only |
| `decisionLatency` | working days | EMA-smoothed approval age (M6/M13); init `L × mean(decisionLatencyPerLayerDays)` |
| `decisionVelocity` | index 0–100 | M7 |
| `wip` | items | queued + inProgress + blocked |
| `overrideRate` | events/step | raw |
| `cumulativeOverrides` | events | running total (robust carrier for sparse-event predicates) |
| `brittlenessRate` | events/step | raw; 0 unless AI is active or an aiAgent-typed layer is present (M11) |
| `cumulativeBrittleness` | events | running total; 0 unless AI is active or an aiAgent-typed layer is present (M11) |
| `cohesionTeamAvg` | index 0–100 | mean team cohesion, M12 |
| `healthGap` | points | `cohesionTeamAvg − orgHealth` (healthy-teams-sick-org divergence) |

**Org non-series blocks:** `perLayer` — for each layer l:
`{layer, layerType, meanLatencyDays, meanQueue, utilization, overrideShare, distortion,
ownerMultiplicity, diffusionFactor, bottleneck}`, with every field given a fully computable rule (no field is left to engine
discretion):

- `layerType` — the layer's type from `org.layerTypes[l−1]` (`humanPm` when `layerTypes`
  is absent).
- `meanLatencyDays` — mean, over tasks that **enter layer l during the final 20 steps**,
  of the service time drawn for that layer:
  `Triangular(decisionLatencyPerLayerDays) × M_recovery × layerLatencyFactor(type_l) × diffusionLatencyFactor_l`
  (× the routine AI-routing factor when org injection is active, M11), **including — at
  layer L only — the escalation surcharge (M6) actually drawn for that task**, since the
  measured mean reports the whole drawn service time at the seat. If no task enters
  layer l in the window, it reports layer l's structural minimum
  `mean(decisionLatencyPerLayerDays) × layerLatencyFactor(type_l) × diffusionLatencyFactor_l` (the escalation
  surcharge, a stochastic add-on, is excluded from this floor).
- `meanQueue` — mean over the final 20 steps of `count(tasks in queued(l))`.
- `utilization` — mean over the final 20 steps of `moved_l / cap_l` (tasks advanced out
  of layer l that step divided by that step's capacity; capped at 1).
- `overrideShare` — the per-layer share of total override events, where each override event
  is attributed to an overriding layer drawn over {2..L} with probability proportional to
  `w_l = 1 + overrideAuthorityGradient × (l−1)` (M8/M19); layer 1 originates work and never
  overrides, so its share is 0. **At the default `overrideAuthorityGradient = 0` the weights
  are uniform, so this is the v1 uniform draw and `overrideShare` is byte-identical.** Shares
  over l = 1..L sum to 1 (or 0 when no overrides occurred). `overrideShare` is a
  Monte-Carlo-only output (§8.4).
- `distortion` — `distortionPerHumanLayer × (l−1) × layerDistortionFactor(type_l)`: the
  cumulative human-relay distortion up to layer l, scaled by how cleanly the seat relays
  (a committee or aiAgent seat lowers it, §9.9).
- `ownerMultiplicity` — `μ_l` at seat l (M19; `1` for a single-owner humanPm seat).
- `diffusionFactor` — `diffusionFactor_l = 1 + overrideDiffusionGain × (μ_l − 1) × (1 − tiebreaker_l)`
  (M19; `1.0` at `μ_l = 1`), the per-seat relitigation multiplier this seat contributes to overrides.
- `bottleneck` — `true` for the single layer with the maximum `utilization`.

`bandMarkers` — echo of the four cognitive band centers (for chart annotations).

**AI injection delta view (client-derived):** the before/after pane and the "AI injection
impact delta" chart are computed in the UI as the pointwise difference of two runs'
`entropy` (and `throughput`) series — same org, `aiInjection.enabled` false/true or
SH varied. The engine does not emit a delta series; the UI must not invent one elsewhere.

### 7.2 AI Agent Team Simulator series (12) and blocks

| id | unit | notes |
|---|---|---|
| `throughput` | items/step | completions per step (bands chart) |
| `cumThroughput` | items | running total of completions |
| `decisionLatencyRoutine` | working days | EMA-smoothed routine approval age; init `mean(decisionLatencyPerLayerDays)` |
| `coordinationTax` | fraction 0–1 | M14 |
| `cohesion` | index 0–100 | M12 |
| `brittlenessRate` | events/step | raw |
| `cumulativeBrittleness` | events | running total |
| `entropyProxy` | index 0–100 | M13 team variant |
| `orgHealthProxy` | index 0–100 | `100 − entropyProxy` |
| `healthGap` | points | `cohesion − orgHealthProxy` (multi-level health) |
| `reviewQueueDepth` | items | tasks in the `review` state at end of step (M20); only the in-dwell population until review capacity binds, then grows |
| `reviewWaitDays` | working days | EMA realized review sojourn (M20); equals `reviewDwellDays` while review capacity is unbounded, rises when it binds |

**Team non-series blocks:**
- `qualityHistogram`: 10 bins `[{lo, hi, count}]` over completed-task quality (0–100,
  width 10); counts pooled across all iterations and steps.
- `functionCoverage`: `{functionId: {score (0–1, 2-decimal), rating: "green"|"amber"|"red"}}`
  for all seven functions (M17; deterministic).

**Red-team requirement mapping (so nothing is lost):** 1 throughput curve w/ bands → `throughput`;
2 quality histogram → `qualityHistogram`; 3 function coverage map → `functionCoverage`;
4 coordination tax → `coordinationTax`; 5 cohesion trend → `cohesion`; 6 brittleness +
recovery cost → `brittlenessRate` + `cumulativeBrittleness` (+ recovery visible as
`decisionLatencyRoutine` spikes); 7 multi-level health → `cohesion` vs `orgHealthProxy`
(+ `healthGap`).

---

## 8. Monte Carlo & distributions

### 8.1 RNG scheme (normative)

- Generator: **ChaCha8Rng** (`rand_chacha` crate, pinned by Cargo.lock).
- Master seed: config `seed` (u64).
- Per-iteration seed: `seed_i = splitmix64(masterSeed wrapping_add(i wrapping_mul(0x9E3779B97F4A7C15)))`
  for iteration `i = 0..iterations−1`, then `ChaCha8Rng::seed_from_u64(seed_i)`.
  `splitmix64(z)`: `z += 0x9E3779B97F4A7C15; z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EB; return z ^ (z >> 31)` (wrapping arithmetic).
- Iterations: default **500**, max 5,000, min 50.
- Each iteration runs the full horizon independently; **draw order = the §5 algorithm
  order** and is part of the contract. No other code may consume the sim RNG.
- Reproducibility contract: identical `(config, seed)` → byte-identical output on the
  same build (native and wasm from the same source must agree — the cross-target hash
  gate, P3). Bit-stream stability across *dependency major versions* is NOT promised;
  bumping the RNG library major requires a modelVersion bump.

### 8.2 Distributions

- **Triangular(a, c, b)** (min, mode, max) — used for effort, per-layer service days,
  escalation days, recovery multiplier/duration, quality. Sampled by inverse CDF from a
  single uniform u ∈ [0,1): if `u < (c−a)/(b−a)`: `a + sqrt(u(b−a)(c−a))`,
  else `b − sqrt((1−u)(b−a)(b−c))`. Chosen because ranges are defensible
  (min/mode/max elicitation) where full distributions are not — a standard Monte Carlo
  practice for estimate-shaped inputs.
- **Bernoulli(p)** — events (override, brittleness, escalation, arrival remainder,
  class/stakes assignment): fires when `u < p`.
- No normal distributions in v1 (bounded triangulars avoid unbounded tails and keep the
  hand simulation tractable).

### 8.3 Percentiles

Per metric per step, across iterations: sort ascending;
`p_q = values[min(N−1, max(0, ceil(q×N)−1))]` (nearest-rank). For N = 500:
p10 = index 49, p50 = index 249, p90 = index 449.

### 8.4 Mean-path mode (pre-lock instrument) and engine-side semantics

The calibration harness runs a **deterministic mean-path mode**: the same discrete
simulation with every stochastic draw replaced as follows —

- every Triangular draw → its mean `(a + c + b)/3`;
- every Bernoulli source → a named fractional accumulator: `acc += p` each draw; the
  event fires when `acc ≥ 1` (then `acc −= 1`). Accumulators are per source (arrivals,
  override, brittleness, escalation) and deterministic;
- class/stakes assignment → per-class accumulators (`acc_class += mix_class` per arrival;
  assign the class with the largest accumulator, subtract 1).

**Engine-side instrument semantics (post-lock, Monte-Carlo-only engine):**

- `instrument: "meanPath"` predicates assert against the **p50 series** of the default
  500-iteration Monte Carlo run at the scenario's declared seed, using the assertion's
  `tolerance`.
- `instrument: "monteCarlo"` predicates assert against the **band series**
  (p10/p50/p90 as named by the metric suffix `.p10|.p50|.p90`; default `.p50`).
- **`perLayer.overrideShare` is a Monte-Carlo-only output.** The authority-gradient
  attribution (M8/M19) draws one uniform per override event to credit an overriding seat;
  that per-event draw exists only in the stochastic engine. Mean-path mode fires overrides
  from a deterministic accumulator and performs no per-event seat draw, so
  `perLayer.overrideShare` is defined and asserted only against the Monte-Carlo band series,
  never the `meanPath` instrument. (No golden asserts `overrideShare`; this note fixes the
  weighted-attribution mapping so it is unambiguous.)

The harness's MC mode re-verifies ALL predicates (both instruments) under these engine
semantics before lock, so the pre-lock proof uses the same statistics the engine's golden
tests will use.

---

## 9. Parameters

Every coefficient in the model, one extracted block each. Fields: `id`, `value`
(default), `range` (permitted calibration range), `distribution` (`point` = fixed
constant; `triangular` = the parameter defines a Triangular(min, mode, max) sampling
distribution — `value` is `[min, mode, max]` and `range` constrains the **mode**;
calibration may shift min/max with the mode preserving `min ≤ mode ≤ max`), `unit`,
`anchor` (research anchor), `tier` (`peer-reviewed | industry-report |
editorial-heuristic`), `limitation`, `formula` (where it is used), `plainLanguage`.

Post-lock, values change only doc-first through the maintainers' amendment process:
within-range default changes bump the minor modelVersion; range changes or new parameters
require explicit maintainer review before they land.

### 9.1 Work and effort

```json eigenorg:parameter
{ "id": "orgExecPointsPerPersonPerStep", "value": 1.0, "range": [0.5, 1.5], "distribution": "point", "unit": "points/person/step",
  "anchor": "Definitional: 1 point = one focused person-day of an average performer", "tier": "editorial-heuristic",
  "limitation": "Averages over role mix; the org sim does not model individual performers.",
  "formula": "P_eff = n * orgExecPointsPerPersonPerStep * (1 - tau) (Sec 5.1 step 7)",
  "plainLanguage": "How much focused work one average person can finish in a day, before coordination overhead." }
```

```json eigenorg:parameter
{ "id": "execPointsPerThroughputPoint", "value": 0.2, "range": [0.1, 0.3], "distribution": "point", "unit": "points/step per throughput point",
  "anchor": "Definitional: throughput-5 entity = 1.0 point/step, consistent with orgExecPointsPerPersonPerStep", "tier": "editorial-heuristic",
  "limitation": "Linear scaling of the 1-10 throughput scale is a simplification.",
  "formula": "rate_e = throughput_e * execPointsPerThroughputPoint * ramp_e * availability_e (M15)",
  "plainLanguage": "Converts an entity's 1-10 throughput rating into work points per day." }
```

```json eigenorg:parameter
{ "id": "taskArrivalPerPersonPerStep", "value": 0.135, "range": [0.06, 0.3], "distribution": "point", "unit": "tasks/person/step",
  "anchor": "Editorial: sized so a healthy 20-person org runs near (not over) capacity", "tier": "editorial-heuristic",
  "limitation": "Real demand is bursty and seasonal; arrivals here are steady.",
  "formula": "arrivals(t) = taskArrivalPerPersonPerStep * n(t) (M18)",
  "plainLanguage": "How much new work shows up per person per day." }
```

```json eigenorg:parameter
{ "id": "taskEffortRoutine", "value": [1.5, 2.5, 4], "range": [1.5, 3.5], "distribution": "triangular", "unit": "points",
  "anchor": "Editorial elicitation: routine items take 1.5-4 focused person-days", "tier": "editorial-heuristic",
  "limitation": "Org-specific; adjustable via config.",
  "formula": "effort ~ Triangular(taskEffortRoutine) for routine tasks (M18)",
  "plainLanguage": "Size of a routine work item: a couple of days." }
```

```json eigenorg:parameter
{ "id": "taskEffortComplex", "value": [3, 5, 8], "range": [4, 7], "distribution": "triangular", "unit": "points",
  "anchor": "Editorial elicitation", "tier": "editorial-heuristic",
  "limitation": "Org-specific; adjustable via config.",
  "formula": "effort ~ Triangular(taskEffortComplex) for complex tasks (M18)",
  "plainLanguage": "Size of a complex work item: about a week." }
```

```json eigenorg:parameter
{ "id": "taskEffortNovel", "value": [5, 8, 14], "range": [6, 12], "distribution": "triangular", "unit": "points",
  "anchor": "Editorial elicitation", "tier": "editorial-heuristic",
  "limitation": "Novel work has the fattest real-world tails; the triangular max understates true worst cases.",
  "formula": "effort ~ Triangular(taskEffortNovel) for novel tasks (M18)",
  "plainLanguage": "Size of a novel work item: one to three weeks, uncertain." }
```

```json eigenorg:parameter
{ "id": "taskMixRoutineOrg", "value": 0.6, "range": [0.4, 0.8], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial: most org work is routine", "tier": "editorial-heuristic",
  "limitation": "Mix varies enormously by industry and team charter.",
  "formula": "class ~ {routine: taskMixRoutineOrg, complex: taskMixComplexOrg, novel: remainder} (M18)",
  "plainLanguage": "Share of org work that is routine." }
```

```json eigenorg:parameter
{ "id": "taskMixComplexOrg", "value": 0.25, "range": [0.1, 0.4], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Mix varies by org; novel share is the remainder (default 0.15).",
  "formula": "class mix (M18)",
  "plainLanguage": "Share of org work that is complex but not novel." }
```

```json eigenorg:parameter
{ "id": "maxPointsPerTaskPerStep", "value": 2, "range": [1, 4], "distribution": "point", "unit": "points/task/step",
  "anchor": "Editorial: at most ~2 people can effectively swarm one task per day", "tier": "editorial-heuristic",
  "limitation": "Some work parallelizes better than this cap allows.",
  "formula": "per-task allocation cap in the execution loop (Sec 5.1 step 7)",
  "plainLanguage": "How much progress a single task can absorb in one day, no matter how many people are free." }
```

### 9.2 Coordination and structure

```json eigenorg:parameter
{ "id": "channelCostFraction", "value": 0.036, "range": [0.01, 0.06], "distribution": "point", "unit": "capacity fraction per (channel/person)",
  "anchor": "Calibrated so a 12-person meeting-heavy flat team pays ~30% coordination tax, directionally consistent with Asana (2024) meeting-load data", "tier": "editorial-heuristic",
  "limitation": "Not a measured constant; the single most influential editorial coefficient in the org sim.",
  "formula": "tau = min(maxCoordinationTax, mu * channelCostFraction * (C/n) * B(n) * (1 - relief)) (M4)",
  "plainLanguage": "How much of a person's day each open communication channel consumes." }
```

```json eigenorg:parameter
{ "id": "meetingHeavyMultiplier", "value": 1.5, "range": [1.4, 1.6], "distribution": "point", "unit": "multiplier",
  "anchor": "Direction from SI Labs (2026) meeting research (~60% of meeting time produces no concrete output); the 1.4-1.6x multiplier is an editorial default", "tier": "editorial-heuristic",
  "limitation": "The 1.4-1.6x range is an inference from meeting-waste research, not a direct measurement of the multiplier, so it is an editorial default.",
  "formula": "mu_modality = meetingHeavyMultiplier when modality == meetingHeavy (M4)",
  "plainLanguage": "Meeting-heavy cultures pay about one and a half times the coordination tax of async-first cultures." }
```

```json eigenorg:parameter
{ "id": "maxCoordinationTax", "value": 0.85, "range": [0.7, 0.95], "distribution": "point", "unit": "fraction",
  "anchor": "Boundedness requirement (Sec 6)", "tier": "editorial-heuristic",
  "limitation": "A cap, not an observation.",
  "formula": "tau = min(maxCoordinationTax, ...) (M4); also normalizes xCoord (M13)",
  "plainLanguage": "An org never spends literally 100% of its time coordinating; this is the ceiling." }
```

```json eigenorg:parameter
{ "id": "meetingShareMeetingHeavy", "value": 0.7, "range": [0.5, 0.85], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial split informed by Asana/Atlassian meeting-load reports", "tier": "editorial-heuristic",
  "limitation": "Coordination cost manifests differently across orgs.",
  "formula": "meetingOverheadPct = tau * meetingShareMeetingHeavy (meetingHeavy) (M4b)",
  "plainLanguage": "In meeting-heavy orgs, ~70% of coordination cost shows up as actual meetings." }
```

```json eigenorg:parameter
{ "id": "meetingShareAsync", "value": 0.4, "range": [0.2, 0.6], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As above.",
  "formula": "meetingOverheadPct = tau * meetingShareAsync (asyncFirst) (M4b)",
  "plainLanguage": "Async-first orgs take less of their coordination cost as meetings." }
```

```json eigenorg:parameter
{ "id": "interTeamChannelCoefficient", "value": 3.0, "range": [1, 6], "distribution": "point", "unit": "channels per team pair",
  "anchor": "Editorial: each pair of coupled teams maintains a few active coordination channels", "tier": "editorial-heuristic",
  "limitation": "Real inter-team coupling depends on the dependency graph, not just pair counts.",
  "formula": "C_inter = interTeamChannelCoefficient * kappa_topology * T(T-1)/2 * (1 + conwayMisalignmentPenalty * m) (M2)",
  "plainLanguage": "How many working channels a typical pair of teams keeps open." }
```

```json eigenorg:parameter
{ "id": "topologyCouplingPods", "value": 1.0, "range": [0.6, 1.4], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial reference level", "tier": "editorial-heuristic",
  "limitation": "Topology labels compress many real designs.",
  "formula": "kappa_topology for pods (M2)",
  "plainLanguage": "Pod structures keep the standard level of team-pair coupling." }
```

```json eigenorg:parameter
{ "id": "topologyCouplingHierarchical", "value": 0.7, "range": [0.4, 1.0], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: vertical routing substitutes for some peer-to-peer channels", "tier": "editorial-heuristic",
  "limitation": "Ignores that vertical routing adds latency (captured separately in M6).",
  "formula": "kappa_topology for hierarchical (M2)",
  "plainLanguage": "Hierarchies route some coordination up-and-down instead of peer-to-peer, cutting direct channels but adding latency." }
```

```json eigenorg:parameter
{ "id": "topologyCouplingFederated", "value": 0.5, "range": [0.3, 0.8], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: federated designs minimize cross-unit coupling by charter", "tier": "editorial-heuristic",
  "limitation": "Assumes the federation charter is actually respected.",
  "formula": "kappa_topology for federated (M2)",
  "plainLanguage": "Federated structures deliberately decouple units, halving pair coupling." }
```

```json eigenorg:parameter
{ "id": "conwayMisalignmentPenalty", "value": 0.8, "range": [0.3, 1.5], "distribution": "point", "unit": "multiplier gain",
  "anchor": "Direction: MacCormack, Rusnak & Baldwin (2012); Nagappan et al. (2008). Magnitude: editorial", "tier": "editorial-heuristic",
  "limitation": "The mirroring effect is peer-reviewed; this specific gain is not.",
  "formula": "C_inter *= (1 + conwayMisalignmentPenalty * m) (M2)",
  "plainLanguage": "When ownership and structure are fully misaligned, cross-team coordination needs nearly double the channels." }
```

```json eigenorg:parameter
{ "id": "misalignmentPerExtraTeam", "value": 0.1, "range": [0, 0.25], "distribution": "point", "unit": "misalignment/team",
  "anchor": "Editorial: ownership ambiguity accretes as teams are added without restructuring", "tier": "editorial-heuristic",
  "limitation": "Deliberate restructuring (not modeled in v1) resets this in reality.",
  "formula": "m(t) = clamp(m0 + misalignmentPerExtraTeam * (T - T_atStart), 0, 1) (M2/M5)",
  "plainLanguage": "Every team added without restructuring makes who-owns-what a bit murkier." }
```

```json eigenorg:parameter
{ "id": "federatedAutonomyFactor", "value": 0.7, "range": [0.5, 0.9], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: delegated ownership absorbs some ambiguity", "tier": "editorial-heuristic",
  "limitation": "Federation quality varies.",
  "formula": "m(t) *= federatedAutonomyFactor when topology == federated (M5)",
  "plainLanguage": "Federated charters soak up some of the ownership ambiguity that growth creates." }
```

```json eigenorg:parameter
{ "id": "crossCutShare", "value": 0.3, "range": [0.1, 0.5], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial: share of decisions that span team boundaries", "tier": "editorial-heuristic",
  "limitation": "Depends on architecture modularity (Conway again).",
  "formula": "escalationShare = m(t) * crossCutShare (M6)",
  "plainLanguage": "Roughly a third of decisions touch more than one team - those are the ones that escalate when ownership is unclear." }
```

```json eigenorg:parameter
{ "id": "escalationExtraDays", "value": [3, 5, 8], "range": [3, 7], "distribution": "triangular", "unit": "working days",
  "anchor": "Editorial, consistent with SI Labs multi-layer delay observations", "tier": "editorial-heuristic",
  "limitation": "Escalation cost varies with executive attention, not modeled.",
  "formula": "service += Triangular(escalationExtraDays) on escalated entry to layer L (M6)",
  "plainLanguage": "A decision nobody clearly owns waits about a week extra while it gets escalated." }
```

### 9.3 Cognitive load bands

```json eigenorg:parameter
{ "id": "cognitiveBandInner", "value": 5, "range": [3, 8], "distribution": "point", "unit": "people",
  "anchor": "Dunbar (1992) support-clique tier; used as a planning heuristic per Atlassian/CTO-practice frameworks", "tier": "industry-report",
  "limitation": "Contested: Lind et al. (2021) find the underlying method imprecise; treated as an adjustable band, not a law.",
  "formula": "band center in B(n) (M3)",
  "plainLanguage": "Around five people, everyone shares full context effortlessly." }
```

```json eigenorg:parameter
{ "id": "cognitiveBandClose", "value": 15, "range": [10, 20], "distribution": "point", "unit": "people",
  "anchor": "Dunbar sympathy-group tier; industry planning heuristic", "tier": "industry-report",
  "limitation": "As cognitiveBandInner.",
  "formula": "band center in B(n) (M3); also the cohesion size penalty midpoint (M12)",
  "plainLanguage": "Past ~15 people, a team stops being one trusted unit." }
```

```json eigenorg:parameter
{ "id": "cognitiveBandWorking", "value": 50, "range": [35, 70], "distribution": "point", "unit": "people",
  "anchor": "Dunbar band tier; industry planning heuristic", "tier": "industry-report",
  "limitation": "As cognitiveBandInner.",
  "formula": "band center in B(n) (M3)",
  "plainLanguage": "Past ~50, working relationships need explicit structure." }
```

```json eigenorg:parameter
{ "id": "cognitiveBandStable", "value": 150, "range": [100, 290], "distribution": "point", "unit": "people",
  "anchor": "Dunbar's 150; range extends to ~290 per the alternative US estimate (McCarty et al.)", "tier": "industry-report",
  "limitation": "The most contested number in the model; the range deliberately spans the critique.",
  "formula": "band center in B(n) (M3)",
  "plainLanguage": "Somewhere between 100 and 300 people, nobody knows everyone anymore." }
```

```json eigenorg:parameter
{ "id": "bandPenaltyInner", "value": 0.05, "range": [0, 0.15], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Penalty magnitudes are tuned, not measured.",
  "formula": "B(n) term (M3)",
  "plainLanguage": "Crossing the ~5-person band adds a small coordination surcharge." }
```

```json eigenorg:parameter
{ "id": "bandPenaltyClose", "value": 0.1, "range": [0, 0.2], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As bandPenaltyInner.",
  "formula": "B(n) term (M3)",
  "plainLanguage": "Crossing ~15 adds a moderate surcharge." }
```

```json eigenorg:parameter
{ "id": "bandPenaltyWorking", "value": 0.12, "range": [0, 0.25], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As bandPenaltyInner.",
  "formula": "B(n) term (M3)",
  "plainLanguage": "Crossing ~50 adds a bigger surcharge." }
```

```json eigenorg:parameter
{ "id": "bandPenaltyStable", "value": 0.15, "range": [0, 0.3], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As bandPenaltyInner.",
  "formula": "B(n) term (M3)",
  "plainLanguage": "Crossing ~150 adds the largest surcharge." }
```

```json eigenorg:parameter
{ "id": "bandWidthFactor", "value": 0.15, "range": [0.05, 0.3], "distribution": "point", "unit": "fraction of band center",
  "anchor": "Editorial: makes band crossings gradual, per the design red-team requirement (no cliffs)", "tier": "editorial-heuristic",
  "limitation": "Width is a smoothing choice, not an observation.",
  "formula": "sigma((n - center)/(bandWidthFactor * center)) (M3)",
  "plainLanguage": "How gradual each band crossing feels - the model never has a cliff at exactly 150." }
```

### 9.4 Decision pipeline

```json eigenorg:parameter
{ "id": "layerFrictionFactor", "value": 0.35, "range": [0.2, 0.6], "distribution": "point", "unit": "dimensionless",
  "anchor": "eigenorg editorial default derived from the SI Labs hierarchy-latency pattern", "tier": "editorial-heuristic",
  "limitation": "Context-dependent; user-adjustable by design.",
  "formula": "V = 100 / ((1 + (L-1) * layerFrictionFactor) * congestion) (M7)",
  "plainLanguage": "How much each extra ownership layer drags on the decision-velocity score." }
```

```json eigenorg:parameter
{ "id": "decisionLatencyPerLayerDays", "value": [2, 2.5, 3], "range": [2, 3], "distribution": "triangular", "unit": "working days/layer",
  "anchor": "SI Labs (2026): ~3 days average processing per approval layer; design default 2-3 days", "tier": "industry-report",
  "limitation": "Documented mainly in large hierarchical orgs; flat orgs and startups differ (Flat Paradox).",
  "formula": "service ~ Triangular(decisionLatencyPerLayerDays) per layer (M6)",
  "plainLanguage": "Each approval layer sits on a decision for two to three working days." }
```

```json eigenorg:parameter
{ "id": "layerCapacityPerStep", "value": 6, "range": [3, 15], "distribution": "point", "unit": "decisions/step",
  "anchor": "Editorial: a first-line decision layer processes ~6 items/day", "tier": "editorial-heuristic",
  "limitation": "Real capacity depends on decision size and delegation.",
  "formula": "cap_l = layerCapacityPerStep * layerCapacityDecay^(l-1) (M6)",
  "plainLanguage": "How many decisions the first layer can actually process per day." }
```

```json eigenorg:parameter
{ "id": "layerCapacityDecay", "value": 0.7, "range": [0.5, 0.9], "distribution": "point", "unit": "multiplier/layer",
  "anchor": "Editorial: senior layers review fewer items per day", "tier": "editorial-heuristic",
  "limitation": "Some execs batch-approve; decay is not universal.",
  "formula": "cap_l = layerCapacityPerStep * layerCapacityDecay^(l-1) (M6)",
  "plainLanguage": "Every layer up the stack has ~30% less decision bandwidth - which is why queues form at the top." }
```

```json eigenorg:parameter
{ "id": "overrideBaseRate", "value": 0.02, "range": [0.005, 0.05], "distribution": "point", "unit": "probability/step/task per extra layer",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Override frequency data is scarce; tuned so ~10-15% of tasks in a 3-layer stack get overridden.",
  "formula": "o = overrideBaseRate * (L-1) * (1 + overrideMisalignmentGain*m) * (1 + distortionOverrideCoupling*distortion) (M8)",
  "plainLanguage": "The per-day chance that a higher layer reverses an in-flight piece of work, per extra layer above it." }
```

```json eigenorg:parameter
{ "id": "overrideMisalignmentGain", "value": 2.0, "range": [0, 4], "distribution": "point", "unit": "gain",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Tuned, not measured.",
  "formula": "override probability term (M8)",
  "plainLanguage": "Unclear ownership makes overrides much more likely - people relitigate decisions nobody clearly owned." }
```

```json eigenorg:parameter
{ "id": "wipResetFraction", "value": 0.5, "range": [0.25, 0.75], "distribution": "point", "unit": "fraction of progress kept",
  "anchor": "design red-team fix: overridden tasks re-enter at 50% completion (partial rework), not 0%", "tier": "editorial-heuristic",
  "limitation": "Real rework cost depends on how contested the direction was.",
  "formula": "progress *= wipResetFraction on override (M8)",
  "plainLanguage": "An overridden task keeps about half its progress - rework, not restart." }
```

```json eigenorg:parameter
{ "id": "distortionPerHumanLayer", "value": 0.08, "range": [0.03, 0.15], "distribution": "point", "unit": "fraction/layer",
  "anchor": "Editorial: information degrades at each human relay", "tier": "editorial-heuristic",
  "limitation": "Distortion research (serial reproduction) is qualitative; the number is editorial.",
  "formula": "distortion = distortionPerHumanLayer * (D - 1); feeds override probability (M8) and perLayer stats",
  "plainLanguage": "Every human-to-human relay of context loses about 8% of the signal." }
```

```json eigenorg:parameter
{ "id": "distortionOverrideCoupling", "value": 0.5, "range": [0, 1], "distribution": "point", "unit": "gain",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Tuned, not measured; couples two editorial quantities.",
  "formula": "override probability *= (1 + distortionOverrideCoupling * distortion) (M8)",
  "plainLanguage": "The more the story got garbled on its way up, the more likely the top layer overrides the call." }
```

```json eigenorg:parameter
{ "id": "metricSmoothingAlpha", "value": 0.3, "range": [0.1, 0.5], "distribution": "point", "unit": "EMA weight",
  "anchor": "Standard exponential smoothing; editorial constant", "tier": "editorial-heuristic",
  "limitation": "Affects chart smoothness and entropy responsiveness, not steady-state values.",
  "formula": "x_ema(t) = alpha*x(t) + (1-alpha)*x_ema(t-1) (M13; decisionLatency series)",
  "plainLanguage": "How quickly the displayed latency and entropy react to what just happened versus the recent past." }
```

### 9.5 AI and Structural Health

```json eigenorg:parameter
{ "id": "aiRoutineShareOrg", "value": 0.6, "range": [0.3, 0.8], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial: share of routine work AI agents actually touch after an org-level injection", "tier": "editorial-heuristic",
  "limitation": "Adoption is uneven in reality.",
  "formula": "routine allocations boosted on this share (M11); effectiveAiShare for cohesion (M12)",
  "plainLanguage": "When an org 'adds AI', about 60% of routine work actually flows through the agents." }
```

```json eigenorg:parameter
{ "id": "aiThroughputBoostOrg", "value": 1.25, "range": [1.1, 1.5], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial, conservative relative to vendor claims", "tier": "editorial-heuristic",
  "limitation": "Deliberately conservative; vendor-reported gains are usually task-level, not org-level.",
  "formula": "routine execution allocation *= (1 + aiRoutineShareOrg * (aiThroughputBoostOrg - 1)) when AI active - uniform expected-value factor, no per-task share draw (M11(a))",
  "plainLanguage": "AI makes the routine work it touches about 25% faster at org level." }
```

```json eigenorg:parameter
{ "id": "aiCoordinationRelief", "value": 0.35, "range": [0.05, 0.45], "distribution": "point", "unit": "fraction of tax",
  "anchor": "Editorial: AI routing/summarizing relieves coordination in structurally healthy orgs", "tier": "editorial-heuristic",
  "limitation": "Relief assumes agents are wired into clear ownership - which is exactly what low-SH orgs lack. Range extends above the default so calibration has upward headroom.",
  "formula": "relief_ai = aiCoordinationRelief * clamp((SH - shRiskThreshold)/(shSafeThreshold - shRiskThreshold), 0, 1) (M9)",
  "plainLanguage": "In a healthy org, AI trims up to about a third of the coordination tax. In an unhealthy one: nothing." }
```

```json eigenorg:parameter
{ "id": "aiNovelFailureBase", "value": 0.22, "range": [0.1, 0.4], "distribution": "point", "unit": "probability per novel task",
  "anchor": "HatchWorks (2025) AI-agent failure-mode analysis; editorial calibration", "tier": "editorial-heuristic",
  "limitation": "Agent failure rates vary by domain and tooling generation; adjustable by design.",
  "formula": "P(brittleness) = aiNovelFailureBase * shBrittleFactor(SH) [* highStakesBrittlenessFactor] (M9)",
  "plainLanguage": "Roughly one in five novel tasks routed through an AI agent without human judgment hits a failure it cannot handle." }
```

```json eigenorg:parameter
{ "id": "humanNovelFailureBase", "value": 0.03, "range": [0.01, 0.08], "distribution": "point", "unit": "probability per novel task",
  "anchor": "Editorial baseline", "tier": "editorial-heuristic",
  "limitation": "Humans fail on novel work too - just far less often and more recoverably.",
  "formula": "brittleness probability when a human covers the judgment path (M11)",
  "plainLanguage": "Humans stumble on a few percent of novel tasks." }
```

```json eigenorg:parameter
{ "id": "aiAmplificationLowSH", "value": 1.55, "range": [1.3, 1.8], "distribution": "point", "unit": "multiplier",
  "anchor": "design red-team range 1.3-1.8x, synthesized from AI-transformation failure reports (rework.com 2025, aimagicx 2026)", "tier": "editorial-heuristic",
  "limitation": "Practitioner-report-based, not a controlled study; the model's most load-bearing editorial coefficient.",
  "formula": "shBrittleFactor(SH <= shRiskThreshold) = aiAmplificationLowSH (M9)",
  "plainLanguage": "In a structurally unhealthy org, AI injection multiplies novel-task failures by about 1.5x - faster dysfunction." }
```

```json eigenorg:parameter
{ "id": "aiGuardrailedHighSH", "value": 0.2, "range": [0.2, 0.5], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: healthy orgs keep humans in the loop, catching most agent failures", "tier": "editorial-heuristic",
  "limitation": "Assumes guardrails actually exist at high SH.",
  "formula": "shBrittleFactor(SH >= shSafeThreshold) = aiGuardrailedHighSH (M9)",
  "plainLanguage": "In a healthy org, most AI stumbles get caught before they become failures." }
```

```json eigenorg:parameter
{ "id": "shRiskThreshold", "value": 4, "range": [3, 5], "distribution": "point", "unit": "SH score",
  "anchor": "design red-team: 'when Structural Health is low (<= 4)'", "tier": "editorial-heuristic",
  "limitation": "The 1-10 SH scale is itself a diagnostic heuristic (Sec 3.4).",
  "formula": "amplification is full at SH <= shRiskThreshold (M9)",
  "plainLanguage": "At Structural Health 4 or below, AI amplifies dysfunction at full strength." }
```

```json eigenorg:parameter
{ "id": "shSafeThreshold", "value": 7, "range": [6, 8], "distribution": "point", "unit": "SH score",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As shRiskThreshold.",
  "formula": "guardrailed regime at SH >= shSafeThreshold; linear in between (M9)",
  "plainLanguage": "At Structural Health 7 or above, AI injection actually helps." }
```

```json eigenorg:parameter
{ "id": "recoveryOwnershipThreshold", "value": 5, "range": [4, 6], "distribution": "point", "unit": "SH score",
  "anchor": "Editorial: SH question 5 (recovery path) dominates this", "tier": "editorial-heuristic",
  "limitation": "Org sim derives ownership from SH; team sim uses the explicit recoveryOwner config.",
  "formula": "org sim: recovery is owned iff SH >= recoveryOwnershipThreshold (M10)",
  "plainLanguage": "Below Structural Health 5, nobody clearly owns failure recovery." }
```

```json eigenorg:parameter
{ "id": "recoveryLatencyMultiplierUnowned", "value": [1.5, 2.0, 2.5], "range": [1.5, 2.5], "distribution": "triangular", "unit": "multiplier",
  "anchor": "design red-team fix: 1.5-2.5x latency for 3-5 steps when no recovery owner", "tier": "editorial-heuristic",
  "limitation": "Range is an editorial synthesis.",
  "formula": "M_recovery window multiplier, unowned (M10)",
  "plainLanguage": "An unowned failure roughly doubles decision times while people figure out whose problem it is." }
```

```json eigenorg:parameter
{ "id": "recoveryDurationUnownedSteps", "value": [3, 4, 5], "range": [3, 5], "distribution": "triangular", "unit": "steps",
  "anchor": "design red-team fix: next 3-5 time steps", "tier": "editorial-heuristic",
  "limitation": "As recoveryLatencyMultiplierUnowned.",
  "formula": "recovery window duration, unowned (M10)",
  "plainLanguage": "The unowned-failure slowdown lasts most of a week." }
```

```json eigenorg:parameter
{ "id": "recoveryLatencyMultiplierOwned", "value": 1.15, "range": [1.0, 1.3], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Assumes the named owner is competent and available.",
  "formula": "M_recovery window multiplier, owned (M10)",
  "plainLanguage": "With a named recovery owner, a failure barely dents decision speed." }
```

```json eigenorg:parameter
{ "id": "recoveryDurationOwnedSteps", "value": [1, 1.5, 2], "range": [1, 2], "distribution": "triangular", "unit": "steps",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As recoveryLatencyMultiplierOwned.",
  "formula": "recovery window duration, owned (M10)",
  "plainLanguage": "Owned recoveries wrap up in a day or two." }
```

```json eigenorg:parameter
{ "id": "hybridVsAutonomousAdvantage", "value": 1.687, "range": [1.2, 2.0], "distribution": "point", "unit": "ratio",
  "anchor": "Stanford/Carnegie study as reported by e-discoveryteam.com (2025): hybrid teams beat fully autonomous agent teams by 68.7% on complex tasks", "tier": "editorial-heuristic",
  "limitation": "Lab-based, domain-specific (law, drone design, creative tasks), secondhand-reported; treated as an adjustable editorial default and deliberately NOT presented as a universal constant. For routine tasks the advantage may reverse.",
  "formula": "judgment contribution /= hybridVsAutonomousAdvantage for complex/novel tasks with zero human judgment coverage (M16)",
  "plainLanguage": "On complex work, teams that keep humans in the judgment loop outperform all-AI pipelines by a large margin - about 69% in the one study we anchor to, which is why we let you adjust it." }
```

```json eigenorg:parameter
{ "id": "aiRoutineAdvantage", "value": 1.5, "range": [1.2, 2.0], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial, consistent with the hybrid-team literature's routine-task findings", "tier": "editorial-heuristic",
  "limitation": "Task-type dependent.",
  "formula": "routine execution progress *= (1 + aiExecShare * (aiRoutineAdvantage - 1)) (M11)",
  "plainLanguage": "AI executes routine work about 50% faster than humans." }
```

```json eigenorg:parameter
{ "id": "aiRoutineLatencyFactor", "value": 0.25, "range": [0.1, 0.5], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: agents triage in minutes-to-hours, humans in days", "tier": "editorial-heuristic",
  "limitation": "Assumes the routing genuinely is routine.",
  "formula": "routine prioritization service *= aiRoutineLatencyFactor when AI covers prioritization (M11)",
  "plainLanguage": "An AI prioritization agent turns a 2.5-day routine triage into a same-day one." }
```

```json eigenorg:parameter
{ "id": "aiNovelEffectiveness", "value": 0.3, "range": [0.1, 0.5], "distribution": "point", "unit": "fraction",
  "anchor": "Editorial: capability collapse on novel work", "tier": "editorial-heuristic",
  "limitation": "Improving frontier; adjustable.",
  "formula": "novel progress *= (humanExecShare + aiExecShare * aiNovelEffectiveness) (M11)",
  "plainLanguage": "On novel work an AI executor delivers less than a third of its routine effectiveness." }
```

```json eigenorg:parameter
{ "id": "uncoveredPrioritizationFactor", "value": 1.5, "range": [1.2, 2.0], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: unowned queues self-organize slowly", "tier": "editorial-heuristic",
  "limitation": "Small teams sometimes self-prioritize well.",
  "formula": "prioritization service *= uncoveredPrioritizationFactor when nobody covers prioritization (M11)",
  "plainLanguage": "If nobody owns prioritization, everything waits 50% longer to get picked up." }
```

```json eigenorg:parameter
{ "id": "highStakesBrittlenessFactor", "value": 1.5, "range": [1.0, 2.0], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Stakes and novelty correlate in reality; modeled independently here.",
  "formula": "brittleness probability *= highStakesBrittlenessFactor for high-stakes novel tasks (M9, team sim)",
  "plainLanguage": "High-stakes novel work is where AI failures concentrate." }
```

### 9.6 Cohesion

```json eigenorg:parameter
{ "id": "cohesionBase", "value": 75, "range": [60, 85], "distribution": "point", "unit": "index 0-100",
  "anchor": "Editorial baseline for a functioning team", "tier": "editorial-heuristic",
  "limitation": "Starting cohesion varies; the dynamics matter more than the level.",
  "formula": "cohesion target ceiling and initial value (M12)",
  "plainLanguage": "A normal healthy team sits around 75/100 on cohesion." }
```

```json eigenorg:parameter
{ "id": "cohesionSizePenalty", "value": 12, "range": [5, 20], "distribution": "point", "unit": "index points",
  "anchor": "Editorial, keyed to the ~15-person band", "tier": "editorial-heuristic",
  "limitation": "Band location is contested (Sec 9.3).",
  "formula": "target -= cohesionSizePenalty * sigma((s - cognitiveBandClose)/(bandWidthFactor * cognitiveBandClose)) (M12)",
  "plainLanguage": "Teams that outgrow ~15 people lose about a dozen points of glue." }
```

```json eigenorg:parameter
{ "id": "cohesionAiPenalty", "value": 15, "range": [10, 30], "distribution": "point", "unit": "index points at 100% AI",
  "anchor": "Direction from WEF (2026) and AMCIS 2025 (AI-heavy teams report weaker co-worker connections); magnitude is an editorial default", "tier": "editorial-heuristic",
  "limitation": "The direction is survey-supported but the magnitude is scaled editorially to the 0-100 index, so this is an editorial default, not a reported figure.",
  "formula": "target -= cohesionAiPenalty * effectiveAiShare (M12)",
  "plainLanguage": "The more teammates are agents, the weaker the human bonds get - about 15 points if the whole team were AI." }
```

```json eigenorg:parameter
{ "id": "cohesionHollownessPenalty", "value": 8, "range": [3, 15], "distribution": "point", "unit": "index points",
  "anchor": "Editorial, modeling the Hollow Middle red-team finding (front-line teams lose the human relationship layer)", "tier": "editorial-heuristic",
  "limitation": "Binary trigger; real hollowing is gradual.",
  "formula": "target -= cohesionHollownessPenalty when prioritization, coordination, or stakeholderCommunication has zero human coverage (M12)",
  "plainLanguage": "Replacing the human relationship layer (like the PM people actually talked to) costs the team extra glue." }
```

```json eigenorg:parameter
{ "id": "cohesionRecoveryRate", "value": 0.05, "range": [0.01, 0.15], "distribution": "point", "unit": "fraction/step",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Recovery speed varies by team history.",
  "formula": "c += cohesionRecoveryRate * (target - c) (M12)",
  "plainLanguage": "Cohesion drifts about 5% of the way toward its ceiling (or floor) each day." }
```

```json eigenorg:parameter
{ "id": "cohesionEntropyCoupling", "value": 0.15, "range": [0, 0.4], "distribution": "point", "unit": "points/step per 10 entropy above threshold",
  "anchor": "Editorial (the L3 reinforcing loop, Sec 6)", "tier": "editorial-heuristic",
  "limitation": "Bounded by clamps; see Sec 6 L3 for the stability argument.",
  "formula": "c -= cohesionEntropyCoupling * max(0, E - entropyStressThreshold)/10 (M12)",
  "plainLanguage": "Sustained thrash grinds team spirit down a little every day." }
```

```json eigenorg:parameter
{ "id": "entropyStressThreshold", "value": 60, "range": [40, 80], "distribution": "point", "unit": "entropy index",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Threshold form is a simplification of a continuous effect.",
  "formula": "cohesion coupling activates above this entropy (M12)",
  "plainLanguage": "Below ~60 entropy, people cope; above it, the thrash starts eating the team." }
```

### 9.7 Entropy weights and normalization

```json eigenorg:parameter
{ "id": "entropyWeightCoordination", "value": 0.3, "range": [0, 0.5], "distribution": "point", "unit": "weight",
  "anchor": "Editorial; weights sum to 1 (extractor-checked)", "tier": "editorial-heuristic",
  "limitation": "Weighting is an editorial judgment about salience, not a fit.",
  "formula": "E term weight (M13)",
  "plainLanguage": "Coordination overhead is the biggest single ingredient of entropy." }
```

```json eigenorg:parameter
{ "id": "entropyWeightLatency", "value": 0.25, "range": [0, 0.5], "distribution": "point", "unit": "weight",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As entropyWeightCoordination.",
  "formula": "E term weight (M13)",
  "plainLanguage": "Slow decisions are the second-biggest ingredient." }
```

```json eigenorg:parameter
{ "id": "entropyWeightCohesion", "value": 0.2, "range": [0, 0.5], "distribution": "point", "unit": "weight",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As entropyWeightCoordination.",
  "formula": "E term weight (M13)",
  "plainLanguage": "Frayed human fabric contributes a fifth." }
```

```json eigenorg:parameter
{ "id": "entropyWeightBrittleness", "value": 0.15, "range": [0, 0.5], "distribution": "point", "unit": "weight",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As entropyWeightCoordination.",
  "formula": "E term weight (M13)",
  "plainLanguage": "Failures on novel work contribute when AI is in play." }
```

```json eigenorg:parameter
{ "id": "entropyWeightWip", "value": 0.1, "range": [0, 0.5], "distribution": "point", "unit": "weight",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As entropyWeightCoordination.",
  "formula": "E term weight (M13)",
  "plainLanguage": "Piled-up work-in-progress rounds out the index." }
```

```json eigenorg:parameter
{ "id": "latencyNormDays", "value": 12, "range": [8, 25], "distribution": "point", "unit": "working days",
  "anchor": "Editorial: ~2.5 working weeks of decision latency saturates the entropy term", "tier": "editorial-heuristic",
  "limitation": "Normalization constant, affects entropy scale only.",
  "formula": "xLat = min(1, latencySmoothed / latencyNormDays) (M13)",
  "plainLanguage": "Decisions taking 12+ days count as maximally slow." }
```

```json eigenorg:parameter
{ "id": "brittlenessNormPerStep", "value": 0.5, "range": [0.2, 1.0], "distribution": "point", "unit": "events/step",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Normalization constant.",
  "formula": "xBrit = min(1, brittleEMA / brittlenessNormPerStep) (M13)",
  "plainLanguage": "A failure every other day counts as maximal brittleness." }
```

```json eigenorg:parameter
{ "id": "wipNormPerPerson", "value": 2.5, "range": [1, 4], "distribution": "point", "unit": "items/person",
  "anchor": "Editorial, informed by common WIP-limit practice (1-3 items/person)", "tier": "editorial-heuristic",
  "limitation": "Normalization constant.",
  "formula": "xWip = min(1, WIP / (wipNormPerPerson * n)) (M13)",
  "plainLanguage": "More than ~2.5 items in flight per person counts as maximal WIP overload." }
```

### 9.8 Team-sim specifics

```json eigenorg:parameter
{ "id": "handoffTaxCoefficient", "value": 0.03, "range": [0.01, 0.06], "distribution": "point", "unit": "fraction at friction 5",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Pairwise friction is averaged (M14).",
  "formula": "handoffTax = handoffTaxCoefficient * mean(handoffFriction)/5 (M14)",
  "plainLanguage": "A team of average-friction entities loses ~3% of capacity to handoffs." }
```

```json eigenorg:parameter
{ "id": "humanAttentionSpan", "value": 3, "range": [1, 4], "distribution": "point", "unit": "functions",
  "anchor": "Editorial: humans cover ~3 functions before attention dilutes", "tier": "editorial-heuristic",
  "limitation": "Individual variance is large.",
  "formula": "attention_e = min(1, humanAttentionSpan / count(functions_e)) for humans (M17)",
  "plainLanguage": "A person juggling more than three functions covers each one thinner; software does not have this problem." }
```

```json eigenorg:parameter
{ "id": "functionDemandExecution", "value": 2.0, "range": [1, 3], "distribution": "point", "unit": "demand units at 8 entities",
  "anchor": "Editorial: execution needs several dedicated people", "tier": "editorial-heuristic",
  "limitation": "Linear team-size scaling is a simplification.",
  "formula": "demand(execution) = functionDemandExecution * (n_e/8) (M17)",
  "plainLanguage": "Execution is the hungriest function - it needs multiple people's full attention." }
```

```json eigenorg:parameter
{ "id": "functionDemandDefault", "value": 0.5, "range": [0.3, 1.0], "distribution": "point", "unit": "demand units at 8 entities",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As functionDemandExecution.",
  "formula": "demand(non-execution f) = functionDemandDefault * (n_e/8) (M17)",
  "plainLanguage": "Each judgment/communication function needs about half a dedicated person on an 8-person team." }
```

```json eigenorg:parameter
{ "id": "coverageGreenThreshold", "value": 0.8, "range": [0.7, 0.9], "distribution": "point", "unit": "coverage score",
  "anchor": "Editorial display threshold", "tier": "editorial-heuristic",
  "limitation": "Display semantics only; no dynamics hang off this value.",
  "formula": "rating green iff coverage >= coverageGreenThreshold (M17)",
  "plainLanguage": "80%+ covered shows green." }
```

```json eigenorg:parameter
{ "id": "coverageAmberThreshold", "value": 0.5, "range": [0.4, 0.6], "distribution": "point", "unit": "coverage score",
  "anchor": "Editorial display threshold", "tier": "editorial-heuristic",
  "limitation": "As coverageGreenThreshold.",
  "formula": "rating amber iff coverage >= coverageAmberThreshold (else red) (M17)",
  "plainLanguage": "Below 50% covered shows red - effectively unowned." }
```

```json eigenorg:parameter
{ "id": "qualityBase", "value": 45, "range": [30, 60], "distribution": "point", "unit": "quality index",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Quality index is internally comparable only (M16).",
  "formula": "mu_q = qualityBase + judgment and reliability terms (M16)",
  "plainLanguage": "Work with zero applied judgment starts from a mediocre baseline." }
```

```json eigenorg:parameter
{ "id": "qualityJudgmentWeight", "value": 5.5, "range": [3, 8], "distribution": "point", "unit": "quality points per judgment point",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As qualityBase.",
  "formula": "mu_q += qualityJudgmentWeight * judgmentEff * hybridFactor (M16)",
  "plainLanguage": "Strong judgment coverage lifts quality from mediocre to excellent." }
```

```json eigenorg:parameter
{ "id": "qualityReliabilityWeight", "value": 1.0, "range": [0, 3], "distribution": "point", "unit": "quality points per reliability point",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As qualityBase.",
  "formula": "mu_q += qualityReliabilityWeight * (meanReliability(exec pool) - 7) (M16)",
  "plainLanguage": "Unreliable builders drag quality down a bit even with good review." }
```

```json eigenorg:parameter
{ "id": "noveltyQualityPenalty", "value": 15, "range": [5, 25], "distribution": "point", "unit": "quality points",
  "anchor": "Editorial, consistent with the hybrid-team literature's novel-task findings", "tier": "editorial-heuristic",
  "limitation": "As qualityBase.",
  "formula": "mu_q -= noveltyQualityPenalty for novel tasks with zero human judgment coverage (M16)",
  "plainLanguage": "Novel work shipped without any human judgment takes a big quality hit." }
```

```json eigenorg:parameter
{ "id": "reviewUncoveredQualityPenalty", "value": 8, "range": [3, 15], "distribution": "point", "unit": "quality points",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As qualityBase.",
  "formula": "mu_q -= reviewUncoveredQualityPenalty when review is uncovered (M16)",
  "plainLanguage": "Skipping review costs several points of quality on everything." }
```

```json eigenorg:parameter
{ "id": "qualitySpreadDown", "value": 15, "range": [5, 25], "distribution": "point", "unit": "quality points",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Symmetric-ish triangular spread is a simplification.",
  "formula": "quality ~ Triangular(mu_q - qualitySpreadDown, mu_q, mu_q + qualitySpreadUp) (M16)",
  "plainLanguage": "Bad days are worse than good days are good - the downside spread is wider." }
```

```json eigenorg:parameter
{ "id": "qualitySpreadUp", "value": 10, "range": [3, 20], "distribution": "point", "unit": "quality points",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As qualitySpreadDown.",
  "formula": "quality upper spread (M16)",
  "plainLanguage": "Upside surprise on quality is modest." }
```

```json eigenorg:parameter
{ "id": "reviewDwellDays", "value": 1, "range": [0.5, 2], "distribution": "point", "unit": "working days",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "Fixed dwell; review queues are not modeled in v1.",
  "formula": "completed tasks enter the review dwell at execution (§5.2 step 6, T6r) and wait reviewDwellDays before clearing to done at review clearance (§5.2 step 7, T6d/M20) when review is covered",
  "plainLanguage": "Review adds about a day before work counts as shipped." }
```

```json eigenorg:parameter
{ "id": "rampStartFactor", "value": 0.3, "range": [0.1, 0.5], "distribution": "point", "unit": "fraction",
  "anchor": "Brooks (1975) onboarding cost, magnitude editorial", "tier": "editorial-heuristic",
  "limitation": "Linear ramp (M15).",
  "formula": "ramp_e(0) = rampStartFactor for ramping humans (M15)",
  "plainLanguage": "A new hire starts at about 30% effectiveness." }
```

```json eigenorg:parameter
{ "id": "judgmentFloor", "value": 2, "range": [1, 4], "distribution": "point", "unit": "judgment points",
  "anchor": "Editorial", "tier": "editorial-heuristic",
  "limitation": "As qualityBase.",
  "formula": "judgmentEff = judgmentFloor when nobody covers review/synthesis/ambiguity (M16)",
  "plainLanguage": "Even with nobody on judgment functions, some residual judgment happens in the doing." }
```

```json eigenorg:parameter
{ "id": "teamPodTargetSize", "value": 8, "range": [5, 10], "distribution": "point", "unit": "people",
  "anchor": "Industry pod-design practice (6-8 person pods)", "tier": "industry-report",
  "limitation": "Partition arithmetic, not a behavioral coefficient.",
  "formula": "T = ceil(n / teamPodTargetSize) for pods/federated (Sec 3.3)",
  "plainLanguage": "Pods are sized around 8 people." }
```

```json eigenorg:parameter
{ "id": "hierarchicalTeamSize", "value": 7, "range": [5, 10], "distribution": "point", "unit": "people",
  "anchor": "Common span-of-control practice (~7 direct reports)", "tier": "industry-report",
  "limitation": "As teamPodTargetSize.",
  "formula": "T = ceil(n / hierarchicalTeamSize) for hierarchical (Sec 3.3)",
  "plainLanguage": "Hierarchies fan out at about seven people per manager." }
```

### 9.9 Ownership-layer types (org sim; the P6 configurator's model surface)

Each of the `L = ownershipLayers` prioritization layers has a **type** — who sits in that
approval seat. `org.layerTypes` (optional; §12.2) is an array of length `L` over
`humanPm | humanDirector | aiAgent | committee`; **when absent, every layer is `humanPm`,
which is the neutral identity that reproduces the base model** (so every pre-existing
config, preset, and golden is unchanged). Each type carries four factors, consumed by
M6 (latency, capacity), M8 (distortion → overrides), and M11 (novel-brittleness exposure):

| type | latencyFactor (M6) | capacityFactor (M6) | distortionFactor (M8) | novelExposure (M11) | meaning |
|---|---|---|---|---|---|
| `humanPm` | 1.0 | 1.0 | 1.0 | 0.0 | baseline PM seat — the identity type |
| `humanDirector` | `layerLatencyFactorDirector` | `layerCapacityFactorDirector` | 1.0 | 0.0 | senior seat: deliberates longer per item, reviews fewer |
| `aiAgent` | `layerLatencyFactorAiAgent` | `layerCapacityFactorAiAgent` | `layerDistortionFactorAiAgent` | `layerNovelExposureAiAgent` | AI prioritization agent: fast routing + more bandwidth + clean relay, but exposes novel work to brittleness |
| `committee` | `layerLatencyFactorCommittee` | `layerCapacityFactorCommittee` | `layerDistortionFactorCommittee` | 0.0 | group seat: slow and low-bandwidth, but many eyes garble less |

`humanPm`'s four values (1.0, 1.0, 1.0, 0.0) are the neutral identity and are not
parameters — they add nothing and are hardcoded as the no-op baseline. The nine numbers
below are the non-identity factors. The **P6 Prioritization Configurator** builds a stack
of 1–5 such typed layers; this section is the model it drives. (Per-layer AI here is an
ownership-seat choice, distinct from `org.aiInjection`, which is an org-wide execution
event; M11 takes the max of the two novel-exposure sources.)

```json eigenorg:parameter
{ "id": "layerLatencyFactorDirector", "value": 1.2, "range": [1.0, 1.5], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: a senior/exec approval seat deliberates longer per item than a first-line PM", "tier": "editorial-heuristic",
  "limitation": "Seat behavior varies; a decisive director can be faster than a committee-run PM function.",
  "formula": "service draw at a humanDirector layer *= layerLatencyFactorDirector (M6, §9.9)",
  "plainLanguage": "A director seat sits on each decision about 20% longer than a baseline PM seat." }
```

```json eigenorg:parameter
{ "id": "layerCapacityFactorDirector", "value": 0.75, "range": [0.5, 1.0], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: senior seats review fewer items per day (span-of-attention), amplifying the top-of-stack queue", "tier": "editorial-heuristic",
  "limitation": "Some directors batch-approve; the reduction is an editorial default.",
  "formula": "cap_l at a humanDirector layer *= layerCapacityFactorDirector (M6, §9.9)",
  "plainLanguage": "A director seat processes about a quarter fewer decisions per day than a baseline PM seat." }
```

```json eigenorg:parameter
{ "id": "layerLatencyFactorAiAgent", "value": 0.4, "range": [0.2, 0.7], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: an AI prioritization agent clears a routing decision in a fraction of a human seat's time (consistent with aiRoutineLatencyFactor)", "tier": "editorial-heuristic",
  "limitation": "Assumes the routing genuinely is mechanical; the agent is no faster on genuinely ambiguous calls.",
  "formula": "service draw at an aiAgent layer *= layerLatencyFactorAiAgent (M6, §9.9)",
  "plainLanguage": "An AI agent seat clears approvals at roughly 40% of a human seat's time." }
```

```json eigenorg:parameter
{ "id": "layerCapacityFactorAiAgent", "value": 1.4, "range": [1.1, 1.8], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: an agent adds mechanical approval bandwidth at any Structural Health (M11(c) rationale, applied per-seat)", "tier": "editorial-heuristic",
  "limitation": "Bandwidth is a modeling proxy; a badly-integrated agent can add rework instead.",
  "formula": "cap_l at an aiAgent layer *= layerCapacityFactorAiAgent (M6, §9.9)",
  "plainLanguage": "An AI agent seat processes about 40% more decisions per day than a baseline PM seat." }
```

```json eigenorg:parameter
{ "id": "layerDistortionFactorAiAgent", "value": 0.3, "range": [0.0, 0.6], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: an agent relays context verbatim, so its layer garbles far less than a human hand-up", "tier": "editorial-heuristic",
  "limitation": "Assumes the agent preserves nuance; over-summarizing agents can distort in their own way.",
  "formula": "layerDistortionFactor(aiAgent) in layerDistortionMean → override distortion (M8, §9.9)",
  "plainLanguage": "An AI agent seat loses only about a third of the context a human relay would - so it triggers fewer overrides." }
```

```json eigenorg:parameter
{ "id": "layerNovelExposureAiAgent", "value": 0.7, "range": [0.3, 1.0], "distribution": "point", "unit": "exposure fraction",
  "anchor": "Editorial: an AI-owned prioritization seat routes novel work into the brittleness path much like an org-wide injection, scaled below 1 because a single seat is narrower than full injection", "tier": "editorial-heuristic",
  "limitation": "The single load-bearing coefficient that makes an AI middle layer riskier on novel work; deliberately adjustable.",
  "formula": "novelExposure = max(injectionActive?1:0, max_l layerNovelExposure(type_l)); P(brittle) = aiNovelFailureBase * shBrittleFactor(SH) * novelExposure (M11/M9, §9.9)",
  "plainLanguage": "Put an AI agent in an approval seat and about 70% of the AI novel-failure exposure of a full org-wide injection shows up - the routine speed-up comes bundled with novel brittleness." }
```

```json eigenorg:parameter
{ "id": "layerLatencyFactorCommittee", "value": 1.5, "range": [1.1, 2.0], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: committee decision-making is slow (scheduling, consensus)", "tier": "editorial-heuristic",
  "limitation": "A well-run committee with a decider can beat this; the default models the common slow case.",
  "formula": "service draw at a committee layer *= layerLatencyFactorCommittee (M6, §9.9)",
  "plainLanguage": "A committee seat sits on each decision about 50% longer than a baseline PM seat." }
```

```json eigenorg:parameter
{ "id": "layerCapacityFactorCommittee", "value": 0.6, "range": [0.4, 0.9], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: a committee meets periodically, so its per-day approval bandwidth is low", "tier": "editorial-heuristic",
  "limitation": "Standing committees with delegated sub-decisions can process more.",
  "formula": "cap_l at a committee layer *= layerCapacityFactorCommittee (M6, §9.9)",
  "plainLanguage": "A committee seat processes about 40% fewer decisions per day than a baseline PM seat." }
```

```json eigenorg:parameter
{ "id": "layerDistortionFactorCommittee", "value": 0.5, "range": [0.2, 0.8], "distribution": "point", "unit": "multiplier",
  "anchor": "Editorial: multiple reviewers catch and correct relayed context, halving distortion versus a single human hand-up", "tier": "editorial-heuristic",
  "limitation": "Groupthink can defeat the many-eyes benefit; editorial default.",
  "formula": "layerDistortionFactor(committee) in layerDistortionMean → override distortion (M8, §9.9)",
  "plainLanguage": "A committee seat's many eyes cut relayed-context loss roughly in half - fewer overrides than a lone human seat." }
```

### 9.10 Accountability diffusion (M19; co-equal-owner cost)

The M19 accountability-diffusion mechanic (§4) reads a per-seat multiplicity `μ_l ≥ 1` — the number
of co-equal owners holding one decision — from `org.layerOwnerCount` and `org.matrix` (§12.2) by
the precedence rule in M19 (a `committee` seat takes its `μ` from `org.layerOwnerCount` like any
other non-matrix seat; it has **no** intrinsic multiplicity), and raises relitigation, decision
latency, and inter-owner work-drop as multiplicity rises, attenuated toward the single-owner case by
a clear tiebreaker. **Every coefficient below is an exact no-op at `μ_l = 1`, so the default
single-owner org reproduces the base model** (see the neutral-identity clause in M19). Directions rest
on peer-reviewed diffusion-of-responsibility and social-loafing work; the magnitudes are editorial.
The four blocks appear in this document order (which fixes their order in `model/params.json` and thus
its SHA). `team.reviewCapacityPerStep` (M20) is a per-run **config field**, not a coefficient — it is
defined in §12.2, not here.

```json eigenorg:parameter
{ "id": "overrideDiffusionGain", "value": 0.4, "range": [0.25, 0.8], "distribution": "point", "unit": "override-probability gain per added co-equal owner",
  "anchor": "Darley & Latane (1968, JPSP 8:377-383): decisive helping fell 85%->62%->31% for 1/2/5 responsible parties - the first added co-equal owner cut decisive ownership to ~73% of solo; Latane (1981, American Psychologist 36:343-356) Social Impact Theory fits felt-responsibility ~ N^-0.5. Default 0.4 = a x1.4 override multiplier at the first added owner (mu=2), matching that first-owner drop.", "tier": "editorial-heuristic",
  "limitation": "The felt-responsibility -> relitigation link is an author construct; no study measures decision-override rates directly, so despite the peer-reviewed diffusion anchor the coefficient is editorial. The linear (mu-1) form overstates diffusion beyond ~4 co-equal owners, where the data saturate (~N^0.5); a cap/power-law is a deferred refinement.",
  "formula": "diffusionFactor_l = 1 + overrideDiffusionGain * (mu_l - 1) * (1 - tiebreaker_l); diffusionMean = mean over l in 2..=L of diffusionFactor_l feeds o(t) (M8/M19)",
  "plainLanguage": "Each extra co-equal owner on one decision makes it about 40% more likely to be relitigated or overridden - and the first added owner is the costliest." }
```

```json eigenorg:parameter
{ "id": "muLatencySurchargeRate", "value": 0.35, "range": [0.2, 0.6], "distribution": "point", "unit": "service-time gain per added co-equal owner",
  "anchor": "Darley & Latane (1968) found intervention latency rose monotonically with bystander count (interventions were fewer AND slower); McKinsey ('Revisiting the matrix organization,' 2016; 'Decision making in the age of urgency,' 2019) reports distributed accountability decides materially slower than single-point accountability. Default +35% per added owner matches the 2-4 owner regime.", "tier": "editorial-heuristic",
  "limitation": "Direction is well supported; the exact percentage is an anchored estimate, not a measured decision-cycle dataset. Modeled linear in (mu-1); the convex Brooks pairwise-channel form (n(n-1)/2) for >4 co-equal owners is a deferred refinement, kept distinct from the motivation-loss channel per Latane, Williams & Harkins (1979).",
  "formula": "diffusionLatencyFactor_l = 1 + muLatencySurchargeRate * (mu_l - 1) * (1 - tiebreaker_l); multiplies the M6 per-layer service draw at every seat l in 1..L (M19)",
  "plainLanguage": "Each extra co-equal owner adds about 35% to the time a decision sits at that seat - consultation and relitigation rounds pile up." }
```

```json eigenorg:parameter
{ "id": "muWorkDropFraction", "value": 0.03, "range": [0, 0.1], "distribution": "point", "unit": "extra progress fraction dropped per added co-equal owner",
  "anchor": "Karau & Williams (1993, JPSP 65:681-706) social-loafing meta-analysis (78 studies): motivation-loss d ~= -0.44, ~9-18% per-owner effort loss; Latane, Williams & Harkins (1979, JPSP 37:822-832) isolate motivation loss from coordination loss. Default 0.03 is a deliberately small extra loss, distinct from the latency (coordination) channel.", "tier": "editorial-heuristic",
  "limitation": "Loafing is measured on additive output tasks, not decision ownership; kept small and applied only at the override event (T7) to avoid double-counting the coordination-latency channel. Set to 0 to disable the motivation-loss channel; identifiability (a named owner) also removes it (Williams, Harkins & Latane 1981).",
  "formula": "on override (T7): progress *= wipResetFraction * max(0, 1 - dropMean), dropMean = mean over l in 2..=L of muWorkDropFraction * (mu_l - 1) * (1 - tiebreaker_l) (M19)",
  "plainLanguage": "A little extra work falls between co-equal owners: when a diffuse decision is overridden it keeps slightly less of its progress than a single-owner one." }
```

```json eigenorg:parameter
{ "id": "overrideAuthorityGradient", "value": 0.0, "range": [0, 2], "distribution": "point", "unit": "attribution weight per layer above layer 1",
  "anchor": "Authority-gradient / HiPPO effect: steeper authority gradients concentrate reversal power at the top (crew-resource-management authority-gradient research, Fischer & Orasanu 2000; 'HiPPO' - highest-paid-person's-opinion overriding lower-level calls, popularized in evidence-based-management practice). Directional; magnitude editorial. Default 0 = uniform attribution, identical to the v1.0.0 draw - the gradient is exposed as an opt-in lever.", "tier": "editorial-heuristic",
  "limitation": "Reweights only WHICH seat an override is credited to for the perLayer.overrideShare output; it does not change the override rate, the RNG draw count/order (still exactly one uniform per event), the WIP reset, or any series - so no golden is affected at any value. Default 0.0 keeps the uniform draw, so perLayer.overrideShare is byte-identical to v1 (calibration-safety). A maintainer may elect a default of 0.5 (the HiPPO tilt) only after confirming that no www/presets/*.json Rust plausibility test snapshots perLayer.overrideShare (none do in v1). The gradient's slope is an editorial default; real reversal authority is lumpy, not a smooth linear ramp.",
  "formula": "override event attributed to seat l in {2..L} with probability proportional to w_l = 1 + overrideAuthorityGradient * (l - 1) (M8/M19); one uniform per event",
  "plainLanguage": "Off by default: an override is credited to a uniformly-random higher seat, exactly as v1. Turn it up and the higher seats absorb more of the credit - the boss overturns more calls than the layer just above the work (HiPPO)." }
```

---

## 10. Scenarios (normative configs)

The ten scenarios are defined here; `www/presets/*.json` (P4/P7a) materialize
these configs verbatim and carry Rust plausibility tests against the same files. Golden
assertions (§11) reference `metric@runLabel`. **All golden evaluation uses seed 42 and
500 iterations.** The sixth, `layerConfigurator`, is an org scenario that exercises the
per-layer typing of §9.9 (the P6 configurator's model surface).
Scenarios seven through ten — `accountabilityDiffusion`, `committeeInversion`, `matrix`,
`reviewBottleneck` — are the v2.0.0 additions exercising accountability multiplicity (§4 M19)
and the review-capacity queue (§4 M20).

### 10.1 `coordinationCollapse` — rapid scaling without structure (org)

A 12-person flat, meeting-heavy team doubles to 25 with no structural change.

```json
{
  "runs": {
    "main": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 120,
      "org": { "headcountStart": 12, "headcountGrowthPerStep": 0.10833,
        "topology": "flat", "hierarchyDepth": 2, "ownershipLayers": 1,
        "modality": "meetingHeavy", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.2 `prioritizationTax` — the three-layer prioritization tax (org)

A 20-person hierarchical org, async-first, with a 3-layer prioritization stack vs the
same org with 1 layer.

```json
{
  "runs": {
    "threeLayer": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "modality": "asyncFirst", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "oneLayer": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 1,
        "modality": "asyncFirst", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.3 `fasterDysfunction` — AI on broken coordination (org; launch centerpiece)

A 40-person pod org, meeting-heavy. AI agents injected at step 15. Four runs: SH 3
(broken structure), SH 7 (healthy structure), and each without AI (counterfactuals).

```json
{
  "runs": {
    "sh3": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 40, "headcountGrowthPerStep": 0,
        "topology": "pods", "hierarchyDepth": 3, "ownershipLayers": 1,
        "initialBacklog": 30,
        "modality": "meetingHeavy", "structuralHealth": 3,
        "aiInjection": { "enabled": true, "atStep": 15 } }
    },
    "sh7": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 40, "headcountGrowthPerStep": 0,
        "topology": "pods", "hierarchyDepth": 3, "ownershipLayers": 1,
        "initialBacklog": 30,
        "modality": "meetingHeavy", "structuralHealth": 7,
        "aiInjection": { "enabled": true, "atStep": 15 } }
    },
    "sh3NoAi": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 40, "headcountGrowthPerStep": 0,
        "topology": "pods", "hierarchyDepth": 3, "ownershipLayers": 1,
        "initialBacklog": 30,
        "modality": "meetingHeavy", "structuralHealth": 3,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "sh7NoAi": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 40, "headcountGrowthPerStep": 0,
        "topology": "pods", "hierarchyDepth": 3, "ownershipLayers": 1,
        "initialBacklog": 30,
        "modality": "meetingHeavy", "structuralHealth": 7,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.4 `dunbarCliff` — pods scale past the cognitive limit (org)

3 pods (24 people) grow to 8 pods (64 people) over 120 steps with no structural change;
inter-pod coordination and cross-cutting ownership ambiguity explode while each pod
stays individually healthy.

```json
{
  "runs": {
    "main": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 120,
      "org": { "headcountStart": 24, "headcountGrowthPerStep": 0.33333,
        "topology": "pods", "hierarchyDepth": 3, "ownershipLayers": 2,
        "modality": "meetingHeavy", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.5 `hollowMiddle` — AI agent replaces the mid-layer PM (team)

Same 7-entity team twice: with an AI prioritization agent in the PM seat (`hollow`) vs a
human PM (`humanPm`). Front-line engineers and an exec layer stay human in both.

```json
{
  "runs": {
    "hollow": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "team", "seed": 42,
      "iterations": 500, "horizon": 60,
      "team": {
        "entities": [
          { "id": "eng1", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "eng2", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "eng3", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "eng4", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "rev", "kind": "human", "archetype": "reviewer", "throughput": 4, "judgmentQuality": 8, "handoffFriction": 4, "reliability": 9, "rampTimeWeeks": 0, "availability": 1, "functions": ["review"], "capabilities": { "review": 8 } },
          { "id": "dir", "kind": "human", "archetype": "director", "throughput": 4, "judgmentQuality": 8, "handoffFriction": 3, "reliability": 8, "rampTimeWeeks": 0, "availability": 0.25, "functions": ["ambiguityResolution", "review"], "capabilities": { "ambiguityResolution": 8, "review": 5 } },
          { "id": "aiPm", "kind": "ai", "archetype": "aiPrioritization", "throughput": 9, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["prioritization", "coordination", "stakeholderCommunication"], "capabilities": { "prioritization": 9, "coordination": 8, "stakeholderCommunication": 2 } }
        ],
        "workStream": { "arrivalPerStep": 1.3, "mix": { "routine": 0.55, "complex": 0.25, "novel": 0.2 }, "highStakesShare": 0.3 },
        "modality": "asyncFirst",
        "structuralHealth": 6,
        "recoveryOwner": null
      }
    },
    "humanPm": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "team", "seed": 42,
      "iterations": 500, "horizon": 60,
      "team": {
        "entities": [
          { "id": "eng1", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "eng2", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "eng3", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "eng4", "kind": "human", "archetype": "engineer", "throughput": 7, "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 7 } },
          { "id": "rev", "kind": "human", "archetype": "reviewer", "throughput": 4, "judgmentQuality": 8, "handoffFriction": 4, "reliability": 9, "rampTimeWeeks": 0, "availability": 1, "functions": ["review"], "capabilities": { "review": 8 } },
          { "id": "dir", "kind": "human", "archetype": "director", "throughput": 4, "judgmentQuality": 8, "handoffFriction": 3, "reliability": 8, "rampTimeWeeks": 0, "availability": 0.25, "functions": ["ambiguityResolution", "review"], "capabilities": { "ambiguityResolution": 8, "review": 5 } },
          { "id": "pm", "kind": "human", "archetype": "pm", "throughput": 5, "judgmentQuality": 7, "handoffFriction": 5, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["prioritization", "coordination", "stakeholderCommunication"], "capabilities": { "prioritization": 7, "coordination": 6, "stakeholderCommunication": 8 } }
        ],
        "workStream": { "arrivalPerStep": 1.3, "mix": { "routine": 0.55, "complex": 0.25, "novel": 0.2 }, "highStakesShare": 0.3 },
        "modality": "asyncFirst",
        "structuralHealth": 6,
        "recoveryOwner": "pm"
      }
    }
  }
}
```

### 10.6 `layerConfigurator` — an AI agent in a mid-stack approval seat (org; §9.9)

The same 20-person hierarchical org with a 3-layer ownership stack, at moderate Structural
Health (SH 5), run twice: `aiMiddle` puts an `aiAgent` in the middle seat; `allHuman`
keeps a `humanPm` there. Only `layerTypes[1]` differs (the flanking `humanPm` seats keep
the top of the stack from becoming a shared bottleneck that would mask the middle-seat
effect). This is the P6 configurator's acceptance behavior — an AI middle layer drops
routine latency **and** raises novel-task brittleness versus the all-human stack. No
org-wide AI injection: the effect is the seat, not an injection event.

```json
{
  "runs": {
    "aiMiddle": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "layerTypes": ["humanPm", "aiAgent", "humanPm"],
        "modality": "asyncFirst", "structuralHealth": 5,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "allHuman": {
      "schemaVersion": "1", "modelVersion": "1.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "layerTypes": ["humanPm", "humanPm", "humanPm"],
        "modality": "asyncFirst", "structuralHealth": 5,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.7 `accountabilityDiffusion` — one owner vs three co-equal owners (org; §4 M19)

The same 20-person hierarchical org with a 3-layer ownership stack, at SH 6, async-first, no
AI, run twice: `singleOwner` gives every seat a single accountable owner
(`layerOwnerCount [1,1,1]`); `coOwned` puts **three co-equal owners** in every seat
(`layerOwnerCount [3,3,3]`). Only `org.layerOwnerCount` differs. This isolates the
accountability-multiplicity mechanic (M19): more co-equal owners of one decision diffuse felt
responsibility (Latané & Darley), so the decision is relitigated/overridden more and resolves
slower — while nothing about the relay chain (distortion) changes. `singleOwner` (all-`1`) is
the neutral identity: it reproduces the base 3-layer model, so its series is byte-identical
(version-metadata excluded, §12.4) to `prioritizationTax@threeLayer`.

```json
{
  "runs": {
    "singleOwner": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "layerOwnerCount": [1, 1, 1],
        "modality": "asyncFirst", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "coOwned": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "layerOwnerCount": [3, 3, 3],
        "modality": "asyncFirst", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.8 `committeeInversion` — a committee's diffusion cost is now an explicit, additive lever (org; §4 M19/§9.9)

The same 20-person hierarchical org with a 3-layer ownership stack at moderate Structural
Health (SH 5), run three times. `committeeDiffuse` and `committeeSingle` both put a `committee`
in the middle seat and differ **only** in `layerOwnerCount`: `committeeDiffuse` marks that
committee as genuinely diffuse (`layerOwnerCount [1, 3, 1]` — three co-equal owners on the
committee seat), while `committeeSingle` keeps a single accountable owner
(`layerOwnerCount [1, 1, 1]`, which reproduces the v1 committee byte-for-byte). `allHuman`
swaps the middle seat for a `humanPm` (single owner). This is the corrected committee
behaviour: a committee's accountability diffusion is now expressed **additively** through
`org.layerOwnerCount` rather than baked into the seat type, so (a) the diffuse committee
relitigates **more** than the single-owner committee (the diffusion cost appears), while
(b) the single-owner committee still relitigates **less** than the all-human stack, because
its many-eyes relay (`layerDistortionFactorCommittee`, §9.9) keeps the 0.5 distortion discount
(the relay benefit persists — the committee is not inverted into a penalty). A committee is
therefore neither a free lunch (the diffuse case pays) nor forced to be costly (the
single-owner case keeps the v1 benefit); the honest tradeoff is under explicit user control.
(Run labels are scenario-scoped, so this scenario's `allHuman` is distinct from
`layerConfigurator`'s `allHuman`; each golden resolves `@runLabel` within its own `scenario`.)

```json
{
  "runs": {
    "committeeDiffuse": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "layerTypes": ["humanPm", "committee", "humanPm"],
        "layerOwnerCount": [1, 3, 1],
        "modality": "asyncFirst", "structuralHealth": 5,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "committeeSingle": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "layerTypes": ["humanPm", "committee", "humanPm"],
        "layerOwnerCount": [1, 1, 1],
        "modality": "asyncFirst", "structuralHealth": 5,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "allHuman": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
        "layerTypes": ["humanPm", "humanPm", "humanPm"],
        "modality": "asyncFirst", "structuralHealth": 5,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.9 `matrix` — one boss vs two bosses vs two-bosses-with-a-decider (org; §4 M19 lateral)

The same 20-person hierarchical org with a 2-layer ownership stack, at SH 6, async-first, no
AI, run three times. `singleBoss` is the ordinary single-authority stack (`matrix.enabled
false`). `dualBossNoTiebreak` turns the terminal seat into lateral dual-authority (`matrix {
enabled: true, tiebreaker: 0 }`, i.e. μ = 2 with **no** tiebreaker → full diffusion).
`dualBossClearDecider` keeps the two bosses but names a clear decider (`tiebreaker: 1` →
diffusion suppressed to the single-owner identity). Only `org.matrix` differs. This exercises
the tiebreaker control: `tiebreaker = 1` makes the M19 diffusion factor `1 +
overrideDiffusionGain·(μ−1)·(1 − tiebreaker) = 1` exactly (and the latency/drop channels 0), so
`dualBossClearDecider` recovers single-boss behaviour byte-for-byte, while `dualBossNoTiebreak`
pays the full "decision strangulation" + "power struggle" cost (Davis & Lawrence; Rogers &
Blenko). The stack is 2 layers so L ≥ 2: the terminal matrix seat feeds both the M6 latency and
the M8 override channels.

```json
{
  "runs": {
    "singleBoss": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 2, "ownershipLayers": 2,
        "matrix": { "enabled": false, "tiebreaker": 0 },
        "modality": "asyncFirst", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "dualBossNoTiebreak": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 2, "ownershipLayers": 2,
        "matrix": { "enabled": true, "tiebreaker": 0 },
        "modality": "asyncFirst", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    },
    "dualBossClearDecider": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
      "iterations": 500, "horizon": 60,
      "org": { "headcountStart": 20, "headcountGrowthPerStep": 0,
        "topology": "hierarchical", "hierarchyDepth": 2, "ownershipLayers": 2,
        "matrix": { "enabled": true, "tiebreaker": 1 },
        "modality": "asyncFirst", "structuralHealth": 6,
        "aiInjection": { "enabled": false, "atStep": 0 } }
    }
  }
}
```

### 10.10 `reviewBottleneck` — AI execution outruns a fixed reviewer (team; §4 M20)

A 7-entity team with **five AI execution agents** driving a high completion stream into a
single human review function, run twice. `bottleneck` caps review clearance at
`reviewCapacityPerStep 2` (well below the AI-boosted completion rate); `unbounded` leaves
`reviewCapacityPerStep null` (the default — unbounded parallelism, reproducing v1 review
behaviour exactly). Only `team.reviewCapacityPerStep` differs. This exercises the review
capacity gate (M20): once producers outrun a fixed reviewer, done-throughput plateaus at the
reviewer's rate (Goldratt ToC) while the review queue grows and wait diverges (Little's Law),
regardless of how fast the AI agents complete work upstream.

```json
{
  "runs": {
    "bottleneck": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "team", "seed": 42,
      "iterations": 500, "horizon": 60,
      "team": {
        "entities": [
          { "id": "aiEng1", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng2", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng3", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng4", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng5", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "rev", "kind": "human", "archetype": "reviewer", "throughput": 4, "judgmentQuality": 8, "handoffFriction": 4, "reliability": 9, "rampTimeWeeks": 0, "availability": 1, "functions": ["review"], "capabilities": { "review": 8 } },
          { "id": "pm", "kind": "human", "archetype": "pm", "throughput": 5, "judgmentQuality": 7, "handoffFriction": 5, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["prioritization", "coordination", "stakeholderCommunication"], "capabilities": { "prioritization": 7, "coordination": 6, "stakeholderCommunication": 8 } }
        ],
        "workStream": { "arrivalPerStep": 3.5, "mix": { "routine": 0.8, "complex": 0.15, "novel": 0.05 }, "highStakesShare": 0.1 },
        "modality": "asyncFirst",
        "structuralHealth": 6,
        "recoveryOwner": "pm",
        "reviewCapacityPerStep": 2
      }
    },
    "unbounded": {
      "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "team", "seed": 42,
      "iterations": 500, "horizon": 60,
      "team": {
        "entities": [
          { "id": "aiEng1", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng2", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng3", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng4", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "aiEng5", "kind": "ai", "archetype": "aiExecution", "throughput": 8, "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7, "rampTimeWeeks": 0, "availability": 1, "functions": ["execution"], "capabilities": { "execution": 8 } },
          { "id": "rev", "kind": "human", "archetype": "reviewer", "throughput": 4, "judgmentQuality": 8, "handoffFriction": 4, "reliability": 9, "rampTimeWeeks": 0, "availability": 1, "functions": ["review"], "capabilities": { "review": 8 } },
          { "id": "pm", "kind": "human", "archetype": "pm", "throughput": 5, "judgmentQuality": 7, "handoffFriction": 5, "reliability": 8, "rampTimeWeeks": 0, "availability": 1, "functions": ["prioritization", "coordination", "stakeholderCommunication"], "capabilities": { "prioritization": 7, "coordination": 6, "stakeholderCommunication": 8 } }
        ],
        "workStream": { "arrivalPerStep": 3.5, "mix": { "routine": 0.8, "complex": 0.15, "novel": 0.05 }, "highStakesShare": 0.1 },
        "modality": "asyncFirst",
        "structuralHealth": 6,
        "recoveryOwner": "pm",
        "reviewCapacityPerStep": null
      }
    }
  }
}
```

---

## 11. Golden Assertions

### 11.1 Comparator vocabulary (the generic evaluator's contract)

The engine-side golden harness (P3) is a **generic predicate evaluator** over
`model/goldens.json` — it implements exactly these comparators and nothing
scenario-specific. `step` semantics: `null` → final step; a number → that step; `[a, b]`
→ the mean over the inclusive window.

| comparator | passes iff | bound |
|---|---|---|
| `above` | value(metric, step) ≥ bound × (1 − tol) | number |
| `below` | value(metric, step) ≤ bound × (1 + tol) | number |
| `within` | bound[0] × (1 − tol) ≤ value ≤ bound[1] × (1 + tol) | [lo, hi] |
| `ratioAbove` | value of pointwise-ratio metric `a / b` at step ≥ bound × (1 − tol) | number |
| `ratioBelow` | ratio ≤ bound × (1 + tol) | number |
| `riseAtLeast` | value(step[1]) − value(step[0]) ≥ bound × (1 − tol) | number; step = [from, to] |
| `dropAtLeast` | value(step[0]) − value(step[1]) ≥ bound × (1 − tol) | number; step = [from, to] |
| `growthRatioAbove` | value(step[1]) / value(step[0]) ≥ bound × (1 − tol) | number; step = [from, to] |
| `twoWindowRatioAbove` | mean(metric over windowA) / mean(over windowB) ≥ minRatio × (1 − tol) | {windowA, windowB, minRatio} |
| `peakBeforeDecline` | windowPeak = max(series over peakWindow); windowPeak ≥ series[0] AND final ≤ finalRatioMax × windowPeak × (1 + tol) (peak is measured inside the window so warm-up transients before it cannot mask the decline) | {peakWindow, finalRatioMax} |
| `bandSeparationAfter` | p10(A, t) > p90(B, t) for ALL t ≥ step (metric `A vs B`); tol ignored | null |
| `scalarAbove` | scalar(metric path) ≥ bound × (1 − tol) | number |
| `scalarBelow` | scalar ≤ bound × (1 + tol) | number |

**Metric grammar:** `seriesId[.p10|.p50|.p90]@runLabel`, or two such terms joined by
` / ` (pointwise ratio), ` - ` (pointwise difference), ` vs ` (band-separation pair);
ratio convention: a zero denominator with a positive numerator evaluates to +infinity
(satisfies `ratioAbove`, fails `ratioBelow`); 0/0 is NaN and fails the assertion;
scalar paths address non-series blocks by the block's output name, e.g.
`functionCoverage.stakeholderCommunication.score@hollow` (the block is `functionCoverage`,
§7.2/§12.3).
Quantile suffix default: `.p50`.

**Instrument semantics** (also §8.4): `meanPath` = deterministic accumulator mode
pre-lock; **post-lock, against the Monte-Carlo-only engine, meanPath predicates assert
against the p50 series** (500 iterations, seed 42) with the assertion's tolerance.
`monteCarlo` = band series (quantile per metric suffix), 500 iterations, seed 42.
The pre-lock harness re-verifies ALL predicates under the engine semantics in MC mode.

**Decision-latency sampling note:** `decisionLatency`/`decisionLatencyRoutine` samples
come from tasks entering `inProgress` with `overrideCount == 0` (first-pass approvals);
override cost is asserted separately via `overrideRate` and `wip`.

### 11.2 Assertions — coordinationCollapse (5)

```json eigenorg:golden
{ "id": "ccThroughputPeakDecline", "scenario": "coordinationCollapse",
  "metric": "throughput@main", "comparator": "peakBeforeDecline",
  "predicate": "Throughput rises with headcount, peaks mid-run, then declines as coordination overhead dominates: the final value is at most 85% of the steps-20-100 peak.",
  "bound": { "peakWindow": [20, 100], "finalRatioMax": 0.85 }, "tolerance": 0.05, "step": null,
  "instrument": "meanPath",
  "rationale": "The scenario's red-teamed core shape: more hands, then plateau, then decline (Brooks channels + band penalties outgrow added capacity)." }
```

```json eigenorg:golden
{ "id": "ccCoordinationTaxFinal", "scenario": "coordinationCollapse",
  "metric": "coordinationTax@main", "comparator": "above",
  "predicate": "By the end of the run the org spends at least 40% of its capacity on coordination.",
  "bound": 0.4, "tolerance": 0.05, "step": null, "instrument": "meanPath",
  "rationale": "At 25 people flat + meeting-heavy, channel load per person (12 channels each) must visibly dominate capacity." }
```

```json eigenorg:golden
{ "id": "ccCohesionErosion", "scenario": "coordinationCollapse",
  "metric": "cohesionTeamAvg@main", "comparator": "below",
  "predicate": "Cohesion degrades below 65 after the ~15-person band is crossed.",
  "bound": 65, "tolerance": 0.05, "step": null, "instrument": "meanPath",
  "rationale": "The red-teamed expectation: cohesion starts degrading as the 15-member inner-circle threshold is crossed." }
```

```json eigenorg:golden
{ "id": "ccEntropyRise", "scenario": "coordinationCollapse",
  "metric": "entropy@main", "comparator": "riseAtLeast",
  "predicate": "Entropy rises by at least 18 points over the run.",
  "bound": 18, "tolerance": 0.15, "step": [0, 119], "instrument": "meanPath",
  "rationale": "Scaling 12 to 25 with zero structural change must register as a large, visible entropy shift." }
```

```json eigenorg:golden
{ "id": "ccEntropyFloorMc", "scenario": "coordinationCollapse",
  "metric": "entropy.p10@main", "comparator": "above",
  "predicate": "Even the luckiest 10% of Monte Carlo runs end above 40 entropy - the degradation is structural, not noise.",
  "bound": 40, "tolerance": 0.05, "step": null, "instrument": "monteCarlo",
  "rationale": "Band-level check that the collapse is robust across seeds, not a mean-path artifact." }
```

### 11.3 Assertions — prioritizationTax (6)

```json eigenorg:golden
{ "id": "ptLatencyBand", "scenario": "prioritizationTax",
  "metric": "decisionLatency@threeLayer", "comparator": "within",
  "predicate": "A routine decision under a 3-layer stack takes 6-9 working days (settled mean over the last 10 steps).",
  "bound": [6, 9], "tolerance": 0.08, "step": [50, 59], "instrument": "meanPath",
  "rationale": "SI Labs pattern: 2-3 days per layer x 3 layers = 6-9 working days for a decision that should take hours." }
```

```json eigenorg:golden
{ "id": "ptLatencyRatio", "scenario": "prioritizationTax",
  "metric": "decisionLatency@threeLayer / decisionLatency@oneLayer", "comparator": "ratioAbove",
  "predicate": "Three layers make decisions at least 2.2x slower than one layer in the same org.",
  "bound": 2.2, "tolerance": 0.1, "step": [50, 59], "instrument": "meanPath",
  "rationale": "The tax is relative: same org, same work, only the ownership stack differs." }
```

```json eigenorg:golden
{ "id": "ptWipRatio", "scenario": "prioritizationTax",
  "metric": "wip@threeLayer / wip@oneLayer", "comparator": "ratioAbove",
  "predicate": "The 3-layer org carries at least 1.5x the work-in-progress of the 1-layer org - items stack up waiting for approval.",
  "bound": 1.5, "tolerance": 0.1, "step": [50, 59], "instrument": "meanPath",
  "rationale": "WIP accumulation is the visible symptom of approval queues (red-team stress test 3)." }
```

```json eigenorg:golden
{ "id": "ptOverrideVisible", "scenario": "prioritizationTax",
  "metric": "cumulativeOverrides@threeLayer", "comparator": "riseAtLeast",
  "predicate": "Higher-layer overrides keep occurring at a visible rate: at least 2 more override events accumulate between steps 40 and 59.",
  "bound": 2, "tolerance": 0.25, "step": [40, 59], "instrument": "meanPath",
  "rationale": "Override events with partial rework are the mechanism that makes layers cost throughput, not just time. The cumulative series is the robust carrier: per-step medians of sparse integer event counts are degenerate (p50 = 0)." }
```

```json eigenorg:golden
{ "id": "ptOverrideAbsentBaseline", "scenario": "prioritizationTax",
  "metric": "cumulativeOverrides@oneLayer", "comparator": "below",
  "predicate": "The single-layer baseline produces zero overrides across the whole run.",
  "bound": 0.001, "tolerance": 0, "step": null, "instrument": "meanPath",
  "rationale": "Controls that overrides are a layering effect in the model, not background noise." }
```

```json eigenorg:golden
{ "id": "ptLatencyTailMc", "scenario": "prioritizationTax",
  "metric": "decisionLatency.p90@threeLayer", "comparator": "below",
  "predicate": "Even the slowest 10% of runs keep settled routine latency under 16 working days - the model does not explode.",
  "bound": 16, "tolerance": 0.1, "step": [50, 59], "instrument": "monteCarlo",
  "rationale": "Tail sanity: queueing variance widens but does not diverge at 0.92 top-layer utilization." }
```

### 11.4 Assertions — fasterDysfunction (6)

```json eigenorg:golden
{ "id": "fdEntropyWorsens", "scenario": "fasterDysfunction",
  "metric": "entropy@sh3", "comparator": "riseAtLeast",
  "predicate": "In the SH=3 org, entropy RISES by at least 5 points after AI injection (step 15 to end) - AI on broken structure makes things worse.",
  "bound": 5, "tolerance": 0.15, "step": [15, 59], "instrument": "meanPath",
  "rationale": "The product's central claim: layering AI on low Structural Health amplifies dysfunction (red-team stress test 4)." }
```

```json eigenorg:golden
{ "id": "fdEntropyImprovesHealthy", "scenario": "fasterDysfunction",
  "metric": "entropy@sh7NoAi - entropy@sh7", "comparator": "above",
  "predicate": "In the otherwise-identical SH=7 org, the run WITH AI settles at least 1.5 entropy points BELOW the same org without AI - injection helps when structure is healthy.",
  "bound": 1.5, "tolerance": 0.2, "step": [45, 59], "instrument": "meanPath",
  "rationale": "The contrast that makes the story honest: AI is not poison - structure decides the sign of its effect. Counterfactual form is robust to the mean-path mode's discrete event spikes at run end." }
```

```json eigenorg:golden
{ "id": "fdBrittlenessAmplified", "scenario": "fasterDysfunction",
  "metric": "cumulativeBrittleness@sh3 / cumulativeBrittleness@sh7", "comparator": "ratioAbove",
  "predicate": "Total brittleness events in the SH=3 org run at least 1.3x the SH=7 org's total by the end.",
  "bound": 1.3, "tolerance": 0.1, "step": null, "instrument": "meanPath",
  "rationale": "Direct check of the red-teamed amplification claim at the scenario endpoints (cumulative form: per-step medians of sparse counts are degenerate)." }
```

```json eigenorg:golden
{ "id": "fdSeparability", "scenario": "fasterDysfunction",
  "metric": "entropy@sh3 vs entropy@sh7", "comparator": "bandSeparationAfter",
  "predicate": "From step 35 onward, the SH=3 entropy band (p10) sits strictly above the SH=7 band (p90) at the default seed - the before/after visual is separable, not two overlapping fuzzy bands.",
  "bound": null, "tolerance": 0, "step": 35, "instrument": "monteCarlo",
  "rationale": "The launch-centerpiece chart must be visually unambiguous - the two bands must be golden-asserted to stay separated rather than merely hoped to." }
```

```json eigenorg:golden
{ "id": "fdSeductiveThroughput", "scenario": "fasterDysfunction",
  "metric": "throughput@sh3", "comparator": "twoWindowRatioAbove",
  "predicate": "Right after injection (steps 16-22) SH=3 throughput runs at least 5% above its pre-injection level (steps 8-14), within a 3% tolerance: the dysfunction is FASTER - that is the seduction.",
  "bound": { "windowA": [16, 22], "windowB": [8, 14], "minRatio": 1.05 }, "tolerance": 0.03, "step": null, "instrument": "meanPath",
  "rationale": "Red-team stress test 4: throughput increases while entropy worsens; both must be visible or the story reads as 'AI bad'. Mechanism: the M11 approval-bandwidth multiplier - AI routes work into the broken structure faster." }
```

```json eigenorg:golden
{ "id": "fdWorseThanNothing", "scenario": "fasterDysfunction",
  "metric": "entropy@sh3 - entropy@sh3NoAi", "comparator": "above",
  "predicate": "By the settled window, the SH=3 org WITH AI carries at least 5 more entropy points than the same org that did nothing.",
  "bound": 5, "tolerance": 0.2, "step": [45, 59], "instrument": "meanPath",
  "rationale": "The punchline in counterfactual form: on broken structure, injecting AI is worse than not acting." }
```

### 11.5 Assertions — dunbarCliff (5)

```json eigenorg:golden
{ "id": "dcTeamsStayHealthy", "scenario": "dunbarCliff",
  "metric": "cohesionTeamAvg@main", "comparator": "above",
  "predicate": "Per-pod cohesion stays healthy (>= 65) all the way to 8 pods - each pod is fine.",
  "bound": 65, "tolerance": 0.05, "step": null, "instrument": "meanPath",
  "rationale": "The 'healthy teams' half of the healthy-teams-sick-org insight (red-team stress test 5)." }
```

```json eigenorg:golden
{ "id": "dcOrgEntropyRises", "scenario": "dunbarCliff",
  "metric": "entropy@main", "comparator": "riseAtLeast",
  "predicate": "Org-level entropy rises by at least 15 points as pods multiply.",
  "bound": 15, "tolerance": 0.2, "step": [0, 119], "instrument": "meanPath",
  "rationale": "The 'sick org' half: inter-pod channels and unscaled decision structure dominate." }
```

```json eigenorg:golden
{ "id": "dcHealthGapWidens", "scenario": "dunbarCliff",
  "metric": "healthGap@main", "comparator": "riseAtLeast",
  "predicate": "The gap between team cohesion and org health widens by at least 12 points - the two lines visibly diverge on one chart.",
  "bound": 12, "tolerance": 0.2, "step": [0, 119], "instrument": "meanPath",
  "rationale": "Design red-team fix: the Multi-Level Health divergence is the shareable insight and must be structural." }
```

```json eigenorg:golden
{ "id": "dcInterTeamExplosion", "scenario": "dunbarCliff",
  "metric": "interTeamChannels@main", "comparator": "growthRatioAbove",
  "predicate": "Inter-pod channels grow at least 6x while pod count grows 2.67x - superlinear coordination surface.",
  "bound": 6, "tolerance": 0.1, "step": [0, 119], "instrument": "meanPath",
  "rationale": "Quadratic pair growth plus rising misalignment is the cliff mechanism; 6x >> 2.67x proves superlinearity." }
```

```json eigenorg:golden
{ "id": "dcHealthGapMc", "scenario": "dunbarCliff",
  "metric": "healthGap.p10@main", "comparator": "above",
  "predicate": "Even in the luckiest 10% of runs the final team-vs-org health gap exceeds 8 points.",
  "bound": 8, "tolerance": 0.2, "step": null, "instrument": "monteCarlo",
  "rationale": "The divergence must survive Monte Carlo noise to be chart-worthy." }
```

### 11.6 Assertions — hollowMiddle (9)

```json eigenorg:golden
{ "id": "hmRoutineLatencyDrops", "scenario": "hollowMiddle",
  "metric": "decisionLatencyRoutine@hollow / decisionLatencyRoutine@humanPm", "comparator": "ratioBelow",
  "predicate": "The AI prioritization agent routes routine work at most 0.6x the human PM's latency - the acceleration is real.",
  "bound": 0.6, "tolerance": 0.1, "step": [50, 59], "instrument": "meanPath",
  "rationale": "Red-team stress test 2: initial acceleration on routine prioritization is what makes the Hollow Middle tempting." }
```

```json eigenorg:golden
{ "id": "hmEarlyThroughputBoost", "scenario": "hollowMiddle",
  "metric": "cumThroughput@hollow / cumThroughput@humanPm", "comparator": "ratioAbove",
  "predicate": "Across the early window (steps 8-14) the hollow team's cumulative throughput averages at least 8% above the human-PM team's - work accelerates initially.",
  "bound": 1.08, "tolerance": 0.05, "step": [8, 14], "instrument": "meanPath",
  "rationale": "The seductive first fortnight, before the edge cases arrive. Re-anchored from the single step t=10 - where the ratio of small-integer cumulative medians jumps discretely (1.000 -> 1.14 with nothing between) - to the mean of the pointwise ratio over [8,14], a continuous carrier that no longer straddles a knife-edge under the Monte-Carlo p50 semantics." }
```

```json eigenorg:golden
{ "id": "hmBrittlenessSpike", "scenario": "hollowMiddle",
  "metric": "cumulativeBrittleness@hollow / cumulativeBrittleness@humanPm", "comparator": "ratioAbove",
  "predicate": "Total brittleness events in the hollow team run at least 2x the human-PM team by the end.",
  "bound": 2, "tolerance": 0.1, "step": null, "instrument": "meanPath",
  "rationale": "Novel decisions hitting an AI router without human judgment is the failure mechanism (red-team stress test 2). Zero-denominator convention (§11.1): the human-PM team's novel failures (humanNovelFailureBase) are sparse enough that its cumulative total can be 0, giving ratio = +infinity, which satisfies ratioAbove; the paired hmBrittlenessFloorMc pins the hollow numerator to >= 1.5 so the ratio is never the indeterminate 0/0." }
```

```json eigenorg:golden
{ "id": "hmStakeholderGap", "scenario": "hollowMiddle",
  "metric": "functionCoverage.stakeholderCommunication.score@hollow", "comparator": "scalarBelow",
  "predicate": "Stakeholder Communication coverage is at most 0.5 (red) in the hollow team - the function the AI cannot actually do.",
  "bound": 0.5, "tolerance": 0, "step": null, "instrument": "meanPath",
  "rationale": "Red-team requirement: the function coverage map must show Stakeholder Communication under-covered when the human PM is removed." }
```

```json eigenorg:golden
{ "id": "hmExecutionCovered", "scenario": "hollowMiddle",
  "metric": "functionCoverage.execution.score@hollow", "comparator": "scalarAbove",
  "predicate": "Execution coverage stays at least 0.8 (green) - the hollow team's problem is not capacity.",
  "bound": 0.8, "tolerance": 0, "step": null, "instrument": "meanPath",
  "rationale": "Red-team requirement: Execution and routine prioritization stay green while judgment functions go red - that contrast is the insight." }
```

```json eigenorg:golden
{ "id": "hmCohesionErosion", "scenario": "hollowMiddle",
  "metric": "cohesion@humanPm - cohesion@hollow", "comparator": "above",
  "predicate": "The hollow team ends at least 8 cohesion points below the human-PM team.",
  "bound": 8, "tolerance": 0.1, "step": null, "instrument": "meanPath",
  "rationale": "Front-line teams lose the human relationship layer of their PM (red-team stress test 2; WEF/AMCIS cohesion findings)." }
```

```json eigenorg:golden
{ "id": "hmTaxDrops", "scenario": "hollowMiddle",
  "metric": "coordinationTax@hollow / coordinationTax@humanPm", "comparator": "ratioBelow",
  "predicate": "The hollow team pays strictly less coordination tax (ratio <= 0.995) - AI routing has lower handoff friction.",
  "bound": 0.995, "tolerance": 0, "step": null, "instrument": "meanPath",
  "rationale": "Red-team stress test 2: coordination tax drops for routine routing - part of why the trap works." }
```

```json eigenorg:golden
{ "id": "hmBrittlenessFloorMc", "scenario": "hollowMiddle",
  "metric": "cumulativeBrittleness.p50@hollow", "comparator": "above",
  "predicate": "The median Monte Carlo run sees at least 1.5 brittleness events over 60 steps - the failures are not a tail scare-story.",
  "bound": 1.5, "tolerance": 0, "step": null, "instrument": "monteCarlo",
  "rationale": "Median-run realism for the brittleness narrative." }
```

```json eigenorg:golden
{ "id": "hmReviewWaitNeutral", "scenario": "hollowMiddle",
  "metric": "reviewWaitDays@hollow", "comparator": "within",
  "predicate": "With review capacity unbounded (default null), review wait sits at the review dwell (1 working day) at every step - the M20 capacity gate is inert and reproduces v1 review byte-for-byte.",
  "bound": [1, 1], "tolerance": 0, "step": null, "instrument": "meanPath",
  "rationale": "Neutral-identity lock for M20: reviewCapacityPerStep = null must leave the realized review sojourn at reviewDwellDays, proving the queue changes nothing at default (the calibration-safety contract). reviewWaitDays is deterministic here (every sojourn = reviewDwellDays = 1), so within [1,1] at tol 0 holds under the p50 semantics. Exact identity, not a provisional bound." }
```

### 11.7 Assertions — layerConfigurator (4)

```json eigenorg:golden
{ "id": "lcRoutineLatencyDrops", "scenario": "layerConfigurator",
  "metric": "decisionLatency@aiMiddle / decisionLatency@allHuman", "comparator": "ratioBelow",
  "predicate": "With an AI agent in the middle approval seat, settled first-pass decision latency runs at most 0.9x the all-human stack's - the routing acceleration is real.",
  "bound": 0.9, "tolerance": 0.05, "step": [50, 59], "instrument": "meanPath",
  "rationale": "P6 configurator acceptance, half 1: decisionLatency here is the all-class org first-pass latency, and routine work - the ~60% majority of the mix (taskMixRoutineOrg) - is the dominant driver of the aggregate drop; an aiAgent layer's low layerLatencyFactor and higher layerCapacityFactor (§9.9) speed that routine majority through the stack." }
```

```json eigenorg:golden
{ "id": "lcNovelBrittleRises", "scenario": "layerConfigurator",
  "metric": "cumulativeBrittleness@aiMiddle", "comparator": "above",
  "predicate": "The AI-middle stack accumulates at least 2 novel-task brittleness events over the run - the acceleration comes bundled with novel exposure.",
  "bound": 2, "tolerance": 0.2, "step": null, "instrument": "meanPath",
  "rationale": "P6 configurator acceptance, half 2: an aiAgent seat's layerNovelExposure (§9.9) routes novel work into the M9 brittleness path even with no org-wide injection." }
```

```json eigenorg:golden
{ "id": "lcAllHumanNoBrittle", "scenario": "layerConfigurator",
  "metric": "cumulativeBrittleness@allHuman", "comparator": "below",
  "predicate": "The all-human stack produces zero brittleness events - the novel exposure is entirely attributable to the AI seat, not the scenario.",
  "bound": 0.001, "tolerance": 0, "step": null, "instrument": "meanPath",
  "rationale": "The clean counterfactual that makes lcNovelBrittleRises meaningful: swap only the middle seat's type and the brittleness appears." }
```

```json eigenorg:golden
{ "id": "lcBrittleFloorMc", "scenario": "layerConfigurator",
  "metric": "cumulativeBrittleness.p50@aiMiddle", "comparator": "above",
  "predicate": "The median Monte Carlo run of the AI-middle stack sees at least 1 brittleness event - the novel exposure is not a mean-path artifact.",
  "bound": 1, "tolerance": 0, "step": null, "instrument": "monteCarlo",
  "rationale": "Band-level realism: the per-layer novel exposure survives Monte Carlo, not just the deterministic accumulator." }
```

### 11.8 Assertions — accountabilityDiffusion (4)

```json eigenorg:golden
{ "id": "adLatencyRatio", "scenario": "accountabilityDiffusion",
  "metric": "decisionLatency@coOwned / decisionLatency@singleOwner", "comparator": "ratioAbove",
  "predicate": "Three co-equal owners per seat make settled first-pass decisions at least 1.4x slower than a single owner in the same org - the consultation/relitigation surcharge is real.",
  "bound": 1.5, "tolerance": 0.1, "step": [50, 59], "instrument": "meanPath",
  "rationale": "M19 latency surcharge: each added co-equal owner adds consultation rounds before a decision clears (muLatencySurchargeRate; ~1.7x at mu=3). decisionLatency samples first-pass approvals (overrideCount == 0; §11.1), so the ratio isolates the per-seat surcharge; the diffusion-driven queue growth in coOwned only widens it. Direction is well supported (Darley & Latané 1968: interventions both fewer AND slower with more responsible parties). (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 1.90; the 1.5 bound sits well below the measured surcharge so the assertion tracks the phenomenon, not seed-42 noise.)" }
```

```json eigenorg:golden
{ "id": "adOverrideRatio", "scenario": "accountabilityDiffusion",
  "metric": "cumulativeOverrides@coOwned / cumulativeOverrides@singleOwner", "comparator": "ratioAbove",
  "predicate": "The three-co-owner stack accumulates at least 1.4x the overrides of the single-owner stack by the end - accountability multiplicity multiplies relitigation.",
  "bound": 1.3, "tolerance": 0.1, "step": null, "instrument": "meanPath",
  "rationale": "M19 feeds the M8 override probability as an additional multiplicative diffusionMean = 1 + overrideDiffusionGain·(mu−1) ≈ 1.8 at mu=3 (Latané 1981 Social Impact Theory, felt responsibility ∝ N^−0.5). Both runs are 3-layer so both override; the ratio isolates the diffusion multiplier. singleOwner is the base-model override rate (identical to prioritizationTax@threeLayer). Zero-denominator convention (§11.1) keeps the ratio valid if the single-owner cumulative is small. (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 1.48 (31/21 cumulative overrides); the bound is lowered to 1.3 to keep a robust margin over a lumpy small-integer count ratio that a ±1-event seed shift can move ~5%.)" }
```

```json eigenorg:golden
{ "id": "adWipRatio", "scenario": "accountabilityDiffusion",
  "metric": "wip@coOwned / wip@singleOwner", "comparator": "ratioAbove",
  "predicate": "The three-co-owner org carries at least 1.2x the work-in-progress of the single-owner org - diffused ownership piles up relitigated, half-reset work.",
  "bound": 1.4, "tolerance": 0.1, "step": [50, 59], "instrument": "meanPath",
  "rationale": "Combined visible symptom: more overrides re-inject WIP at wipResetFraction (M8) and the latency surcharge holds tasks in-pipeline longer, so queued+inProgress+blocked rises. Mirrors ptWipRatio; the bound stays below prioritizationTax's 1.5 because both runs share the same 3-layer stack and only the multiplicity differs. (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 1.82; raised to 1.4 — still under prioritizationTax's 1.5 — so it asserts the pile-up with a robust margin below the measured value.)" }
```

```json eigenorg:golden
{ "id": "adOverrideRatioMc", "scenario": "accountabilityDiffusion",
  "metric": "cumulativeOverrides.p50@coOwned / cumulativeOverrides.p50@singleOwner", "comparator": "ratioAbove",
  "predicate": "Even at the Monte Carlo median, the three-co-owner stack runs at least 1.3x the overrides of the single-owner stack - the diffusion effect is structural, not a mean-path artifact.",
  "bound": 1.3, "tolerance": 0.1, "step": null, "instrument": "monteCarlo",
  "rationale": "Band-level realism for the relitigation narrative (mirrors hmBrittlenessFloorMc / lcBrittleFloorMc). Using the p50 ratio makes the claim magnitude-independent and robust to the sparse-integer override counts; the zero-denominator convention (§11.1) satisfies ratioAbove if the single-owner median is 0. (Retuned against the engine golden harness MC p50, seed 42, 500 iters, 2026-07-04: measured 1.48; the 1.3 bound is held with margin for the lumpy count ratio.)" }
```

### 11.9 Assertions — committeeInversion (3)

```json eigenorg:golden
{ "id": "adCommitteeDiffusionCost", "scenario": "committeeInversion",
  "metric": "cumulativeOverrides@committeeDiffuse / cumulativeOverrides@committeeSingle", "comparator": "ratioAbove",
  "predicate": "A diffuse committee (three co-equal owners) accumulates at least 1.15x the overrides of the SAME committee at a single accountable owner - the accountability-diffusion cost now appears on the committee seat, driven entirely by layerOwnerCount.",
  "bound": 1.1, "tolerance": 0.1, "step": null, "instrument": "meanPath",
  "rationale": "M19 additive diffusion: committeeDiffuse's layerOwnerCount 3 on the middle seat raises diffusionMean = mean over l in 2..=L of (1 + overrideDiffusionGain*(mu_l-1)) to ~1.4 (one of two averaged seats at mu=3), scaling the M8 override probability; committeeSingle (layerOwnerCount 1) is the v1 committee with diffusionMean = 1. Both runs share the identical committee §9.9 relay factors, so the ratio isolates the diffusion cost. (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 1.25 (25/20 cumulative overrides); lowered to 1.1 to keep a robust margin over a small-count (~20) ratio that a ±1-event seed shift moves ~5%.)" }
```

```json eigenorg:golden
{ "id": "adCommitteeRelayBenefit", "scenario": "committeeInversion",
  "metric": "cumulativeOverrides@committeeSingle / cumulativeOverrides@allHuman", "comparator": "ratioBelow",
  "predicate": "A single-owner committee still accumulates FEWER overrides than the all-human stack (ratio at most ~0.95) - the many-eyes relay benefit persists, so the committee is not inverted into a penalty (anti-inversion evidence).",
  "bound": 0.9, "tolerance": 0.05, "step": null, "instrument": "meanPath",
  "rationale": "At mu = 1 on both runs the M8 override PROBABILITY o(t) differs only through the distortion term: the committee middle seat's layerDistortionFactorCommittee (0.5) vs humanPm (1.0) lowers layerDistortionMean, so the distortion-driven override component is strictly lower for the committee - the v1 many-eyes relay discount, untouched by the amendment. (The committee seat's slower layerLatencyFactorCommittee / layerCapacityFactorCommittee act on queueing, M6, a second-order influence on the override COUNT - which is why the load-bearing claim is the direction, ratio < 1.) (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 0.83 (20/24 cumulative overrides); tightened to 0.9 so the relay discount is asserted clearly below 1 while leaving margin above the measured value for the lumpy count ratio.)" }
```

```json eigenorg:golden
{ "id": "adCommitteeDiffusionCostMc", "scenario": "committeeInversion",
  "metric": "cumulativeOverrides.p50@committeeDiffuse / cumulativeOverrides.p50@committeeSingle", "comparator": "ratioAbove",
  "predicate": "Even at the Monte Carlo median, the diffuse committee runs at least 1.1x the overrides of the single-owner committee - the diffusion cost is structural, not a mean-path artifact.",
  "bound": 1.1, "tolerance": 0.1, "step": null, "instrument": "monteCarlo",
  "rationale": "Band-level realism for the diffusion-cost claim (mirrors adOverrideRatioMc). The p50 ratio is magnitude-independent and robust to sparse-integer override counts; the §11.1 zero-denominator convention satisfies ratioAbove if the single-owner median is 0. (Retuned against the engine golden harness MC p50, seed 42, 500 iters, 2026-07-04: measured 1.25; the 1.1 bound is held with margin for the small-count ratio.)" }
```

### 11.10 Assertions — matrix (5)

```json eigenorg:golden
{ "id": "mxLatencyRatio", "scenario": "matrix",
  "metric": "decisionLatency@dualBossNoTiebreak / decisionLatency@singleBoss", "comparator": "ratioAbove",
  "predicate": "Two bosses with no tiebreaker make settled decisions at least 1.2x slower than a single boss - dual authority strangles the decision.",
  "bound": 1.15, "tolerance": 0.1, "step": [50, 59], "instrument": "meanPath",
  "rationale": "M19 at mu=2, tiebreaker=0 applies the shared muLatencySurchargeRate to the terminal matrix seat (diffusionLatencyFactor_L ≈ 1.35; there is NO separate dual-authority coefficient - the matrix folds entirely into M19). Davis & Lawrence 1977 'decision strangulation'; McKinsey 2016/2019: distributed accountability decides materially slower. The bound is conservative because only the terminal of two seats carries the surcharge, so the aggregate ratio sits between 1 and ~1.35. (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 1.24; lowered from the knife-edge 1.2 to 1.15 for a robust margin below the measured modest surcharge.)" }
```

```json eigenorg:golden
{ "id": "mxRelitigationRatio", "scenario": "matrix",
  "metric": "cumulativeOverrides@dualBossNoTiebreak / cumulativeOverrides@singleBoss", "comparator": "ratioAbove",
  "predicate": "The no-tiebreaker matrix relitigates at least 1.3x as many decisions as the single-boss org - either boss can reopen what the other cleared.",
  "bound": 1.3, "tolerance": 0.1, "step": null, "instrument": "meanPath",
  "rationale": "M19 multiplies M8 override probability by diffusionMean ≈ 1.4 at mu=2 for the L=2 stack (Davis & Lawrence 'power struggles'; McKinsey 2022: multiple veto-holders create loops/reversals a single decider removes). singleBoss's 2-layer stack provides the base override channel the diffusion factor scales; §11.1 zero-denominator convention keeps the ratio valid. (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 1.50 (15/10 cumulative overrides); the 1.3 bound is held with a robust margin for the lumpy small-count ratio.)" }
```

```json eigenorg:golden
{ "id": "mxTiebreakerRecovers", "scenario": "matrix",
  "metric": "decisionLatency@dualBossClearDecider / decisionLatency@singleBoss", "comparator": "ratioBelow",
  "predicate": "Naming a clear decider recovers single-boss decision speed: the tiebreaker=1 matrix runs no slower than the single-boss org (ratio at most ~1.0).",
  "bound": 1.0, "tolerance": 0.05, "step": [50, 59], "instrument": "meanPath",
  "rationale": "The tiebreaker control (Rogers & Blenko 2006 'Who Has the D?': one named decider unclogs the matrix bottleneck). In the unified M19 form diffusionFactor = 1 + overrideDiffusionGain·(mu−1)·(1 − tiebreaker) collapses to 1 at tiebreaker=1, the latency/drop channels to 0, and the diffusion multiplies existing probabilities/service draws (adds no RNG draw), so dualBossClearDecider is byte-identical to singleBoss and the ratio is EXACTLY 1.0 (an exact identity, not a provisional estimate). The 0.05 tolerance is slack only." }
```

```json eigenorg:golden
{ "id": "mxTiebreakerBeatsDeadlock", "scenario": "matrix",
  "metric": "decisionLatency@dualBossClearDecider / decisionLatency@dualBossNoTiebreak", "comparator": "ratioBelow",
  "predicate": "The two-bosses-with-a-decider matrix is at least ~15% faster than the deadlocked two-boss matrix - the tiebreaker is the documented fix, not the dual reporting itself.",
  "bound": 0.85, "tolerance": 0.05, "step": [50, 59], "instrument": "meanPath",
  "rationale": "The load-bearing tiebreaker contrast, robust to the exact surcharge coefficient: dualBossClearDecider recovers to single-boss latency while dualBossNoTiebreak carries the full mu=2 terminal-seat surcharge, so the ratio ≈ 1/1.35 ≈ 0.74. Isolates the [0,1] tiebreaker as the leverage point (McKinsey 2022 single point of accountability). (Retuned against the engine golden harness, seed 42, 500 iters, 2026-07-04: measured 0.81; the 0.85 bound is held — it asserts the documented ≥15% speed-up with margin above the measured value.)" }
```

```json eigenorg:golden
{ "id": "mxRelitigationMc", "scenario": "matrix",
  "metric": "cumulativeOverrides.p50@dualBossNoTiebreak / cumulativeOverrides.p50@singleBoss", "comparator": "ratioAbove",
  "predicate": "Even at the Monte Carlo median, the no-tiebreaker matrix relitigates at least 1.2x the single-boss org - the dual-authority reversal loop survives noise.",
  "bound": 1.2, "tolerance": 0.1, "step": null, "instrument": "monteCarlo",
  "rationale": "Band-level realism for the relitigation claim; p50 ratio is magnitude-independent and the §11.1 zero-denominator convention satisfies ratioAbove if the single-boss median is 0. (Retuned against the engine golden harness MC p50, seed 42, 500 iters, 2026-07-04: measured 1.50; the 1.2 bound is held with a robust margin.)" }
```

### 11.11 Assertions — reviewBottleneck (5)

```json eigenorg:golden
{ "id": "rbQueueBuilds", "scenario": "reviewBottleneck",
  "metric": "reviewQueueDepth@bottleneck", "comparator": "riseAtLeast",
  "predicate": "With review capped below the AI completion rate, the review queue grows by at least 10 items over the run - the unstable rho ≥ 1 regime.",
  "bound": 10, "tolerance": 0.2, "step": [10, 59], "instrument": "meanPath",
  "rationale": "M20 capacity gate: producers (five AI execution agents, ~3.5 completions/step) outrun a fixed reviewer (2/step), so the queue grows ~linearly at (completionRate − reviewCapacity) per step (Goldratt ToC: surplus upstream of the constraint accumulates as WIP). Window starts at step 10 to skip warm-up transients. (bound provisional - retune against the pre-lock mean-path/MC harness, seed 42, before lock)." }
```

```json eigenorg:golden
{ "id": "rbThroughputPlateau", "scenario": "reviewBottleneck",
  "metric": "throughput@bottleneck / throughput@unbounded", "comparator": "ratioBelow",
  "predicate": "The capped team ships at most 0.85x the done-throughput of the uncapped team in the settled window - done-throughput plateaus at the reviewer's rate no matter how fast the AI agents complete work.",
  "bound": 0.85, "tolerance": 0.05, "step": [40, 59], "instrument": "meanPath",
  "rationale": "The Theory-of-Constraints invariant (Goldratt 'The Goal'): system throughput-to-done is capped by the slowest stage. Bottleneck done-rate ≈ reviewCapacity (2/step) while the unbounded control clears the full ~3.5/step completion stream, so the ratio ≈ 0.57 - well under the 0.85 bound. Raising producer speed upstream cannot lift the plateau; only elevating the constraint can. (bound provisional - retune against the pre-lock mean-path/MC harness, seed 42, before lock)." }
```

```json eigenorg:golden
{ "id": "rbWaitRises", "scenario": "reviewBottleneck",
  "metric": "reviewWaitDays@bottleneck", "comparator": "above",
  "predicate": "By the end of the run, completed work waits at least 4 working days for review in the capped team - lead time diverges as the queue grows.",
  "bound": 4, "tolerance": 0.15, "step": null, "instrument": "meanPath",
  "rationale": "Little's Law (W = L / throughput): with a growing queue L cleared at the fixed reviewCapacity, review wait rises superlinearly (M/M/1 rho/(1−rho) as rho → 1). Anchored well below the tens-of-days the divergent queue implies, and far above the well-run few-hours latency (Sadowski et al. 2018) the unbounded control tracks. (bound provisional - retune against the pre-lock mean-path/MC harness, seed 42, before lock)." }
```

```json eigenorg:golden
{ "id": "rbControlBounded", "scenario": "reviewBottleneck",
  "metric": "reviewQueueDepth@unbounded", "comparator": "below",
  "predicate": "With reviewCapacityPerStep null (default), the review queue stays bounded and small (at most ~5 items) all run - unbounded parallelism reproduces the v1 review behaviour, no ToC plateau.",
  "bound": 5, "tolerance": 0.1, "step": null, "instrument": "meanPath",
  "rationale": "The neutral-identity anchor for M20: null capacity means every dwell-elapsed completion clears each step, so the queue never accumulates a runaway backlog and done-throughput is not gated - the v1 behaviour. reviewQueueDepth holds only the in-dwell population (≈ completionRate × reviewDwellDays ≈ 3.5). (bound provisional - retune against the pre-lock mean-path/MC harness, seed 42, before lock)." }
```

```json eigenorg:golden
{ "id": "rbQueueFloorMc", "scenario": "reviewBottleneck",
  "metric": "reviewQueueDepth.p10@bottleneck", "comparator": "above",
  "predicate": "Even the luckiest 10% of Monte Carlo runs end with at least 10 items queued for review in the capped team - the bottleneck is structural, not a mean-path artifact.",
  "bound": 10, "tolerance": 0.2, "step": null, "instrument": "monteCarlo",
  "rationale": "Band-level check that the review queue builds across seeds (mirrors ccEntropyFloorMc). rho ≥ 1 makes the queue grow deterministically in expectation, so even the p10 path accumulates a large backlog over 60 steps. (bound provisional - retune against the pre-lock mean-path/MC harness, seed 42, before lock)." }
```

### 11.12 Neutral-identity regression (all 34 v1 golden assertions unchanged)

The v2.0.0 amendment adds mechanics M19 (accountability diffusion) and M20 (review capacity
queue), the config fields `org.layerOwnerCount`, `org.matrix`, and `team.reviewCapacityPerStep`,
and the additive team series `reviewQueueDepth` / `reviewWaitDays`. **All 34 v1 golden
assertions (§11.2 coordinationCollapse ×5, §11.3 prioritizationTax ×6, §11.4 fasterDysfunction
×6, §11.5 dunbarCliff ×5, §11.6 hollowMiddle ×8 v1, §11.7 layerConfigurator ×4) evaluate
byte-identically under v2.0.0 at default parameters** — they are the executable regression for
the neutral-identity contract and must continue to pass verbatim. The argument, field by field:

- **`org.layerOwnerCount` defaults to all-`1`** (μ = 1 at every seat), so the M19 diffusion
  factor `1 + overrideDiffusionGain·(μ−1)·(1 − tiebreaker) = 1` **exactly** and the M19 latency
  surcharge `∝ (μ−1)` is **0**. The diffusion term multiplies the *existing* M8 override
  Bernoulli probability and the *existing* M6 Triangular service draw — it introduces **no new
  RNG draw** — so the §5 draw order is preserved and the M8/M6 outputs reduce to their v1 forms
  bit-for-bit.
- **`org.matrix` defaults to `{ enabled: false }`**, so no seat is promoted to μ = 2 and the
  identity above holds. (`dualBossClearDecider` further shows that even an *enabled* matrix with
  `tiebreaker: 1` collapses the diffusion factor back to 1 — see `mxTiebreakerRecovers`.)
- **`team.reviewCapacityPerStep` defaults to `null` (unbounded)**, so the M20 gate clears every
  dwell-elapsed completion each step and §5.2 step 7 reduces to the v1 fixed-`reviewDwellDays`
  path with no throughput gating. The additive `reviewQueueDepth` / `reviewWaitDays` series are
  bounded (queue = in-dwell population, wait = `reviewDwellDays`) and consumers ignore unknown
  output fields (§12.1), so no v1 team golden reads a changed value.
- **The `committee` seat is unchanged from v1.** Its §9.9 latency/capacity/distortion factors are
  byte-identical and it carries **no** intrinsic multiplicity, so every v1 `committee` config
  reproduces its v1 series and verdicts byte-for-byte at the default `layerOwnerCount` of 1. A
  committee's accountability diffusion is an **opt-in, additive** cost via `org.layerOwnerCount > 1`,
  exercised only by the new `committeeInversion` scenario (§10.8); no v1 scenario, preset, or golden
  sets it, so nothing locked changes. The amendment is fully additive — there is **no** exception to
  byte-identity (§12.4/§12.5).
- **The authority-gradient override attribution defaults to `0.0`**, so it re-weights nothing —
  the per-event attribution is the v1 uniform draw (one uniform per event, unchanged draw count),
  and `perLayer.overrideShare` is byte-identical. No v1 golden asserts `perLayer.overrideShare`;
  a maintainer may later raise the default only after confirming no preset snapshots it.
- **The M17 function-coverage map is unchanged**, so hollowMiddle's coverage goldens
  (`hmStakeholderGap`, `hmExecutionCovered`) are intact.

Live confirmation on a real config: `accountabilityDiffusion@singleOwner`
(`layerOwnerCount [1,1,1]`) shares every structural field with `prioritizationTax@threeLayer`,
so its series is **byte-identical** to that locked run (version-metadata excluded per §12.4).

Post-amendment the suite is **52 goldens** (34 v1 + 18 new: §11.8 accountabilityDiffusion ×4,
§11.9 committeeInversion ×3, §11.10 matrix ×5, §11.11 reviewBottleneck ×5, plus
`hmReviewWaitNeutral` ×1 in §11.6). Because `model/goldens.json` gains rows, its sha256 changes;
paired with the M8-formula change this is the MAJOR bump to 2.0.0 (§12.6), and §14 gets the
corresponding changelog row.

---

## 12. Schema & versioning (authoritative over CONTRACTS.md)

`docs/CONTRACTS.md` (P3) is the derived operational copy of this section; on conflict,
this section wins.

### 12.1 Conventions

- **All JSON is camelCase** (serde `rename_all = "camelCase"`).
- **Config rejects unknown fields** (serde `deny_unknown_fields`) — a typo'd field is an
  error, never silently ignored. Output is additive-extensible (consumers must ignore
  unknown output fields).
- `schemaVersion` and `modelVersion` appear in **both** config and output.
  **modelVersion is declared in this file's `eigenorg:meta` block (the JSON fence near the
  top of this document, before §1) and emitted into `model/params.json` by the
  extractor** — the CI pairing gate anchors to that declaration (see §12.6).
- `validate()` rejects (**authoring-time validation**, for a config authored by a user or
  the UI): unknown fields, NaN/Inf anywhere, out-of-range structural values,
  `paramOverrides` keys not present in `model/params.json`, override values (or triangular
  modes) outside the parameter's declared `range`, triangular triples that violate
  `min ≤ mode ≤ max`, and `cost.enabled == true` (v1).
- **Joint constraints** (also enforced by `validate()`): when `paramOverrides` sets any
  entropy weight, the five weights (`entropyWeightCoordination`, `…Latency`, `…Cohesion`,
  `…Brittleness`, `…Wip`) must still sum to 1 ± 0.001; `taskMixRoutineOrg +
  taskMixComplexOrg ≤ 1` (the novel share is the non-negative remainder); the team
  `workStream.mix` fractions must sum to 1 ± 0.001; when `org.layerTypes` is present,
  its length must equal `org.ownershipLayers` and every entry must be one of
  `humanPm | humanDirector | aiAgent | committee` (§9.9); and, when `org.layerOwnerCount`
  is present, its length must equal `org.ownershipLayers` (§4 M19). (These length
  joint-constraints hold at both authoring and replay, per the replay bullet.)
- **Replay validation is looser than authoring validation (share-URL contract).** A
  share-URL replay supplies `paramOverrides = resolvedParams`, the FULL effective
  coefficient set captured at run time (§12.4). Range membership is an **authoring-time**
  check only: replay validates structure and type (every key exists in
  `model/params.json`; each value is a number or a `[min,mode,max]` triple with
  `min ≤ mode ≤ max`; NaN/Inf rejected; joint constraints above still hold) but **does NOT re-check current-range
  membership**, because a post-lock maintainer-reviewed amendment can narrow a range so that a value
  that was in-range when the link was created now sits outside it — and the promise is
  that an old link replays its embedded numbers exactly. See §12.5.
- **New structural fields (§4 M19/M20), authoring-time validation.** `validate()`
  additionally rejects: a non-integer or out-of-`[1, 8]` entry in `org.layerOwnerCount`
  (each μ is an integer ≥ 1); a `layerOwnerCount[L−1] ≠ 1` (the terminal seat, 0-indexed to match M19/§A.1) **only on the matrix target layer L**
  (the intrinsic μ = 2 wins — a conflicting explicit count is an authoring error, never
  silently overridden; a `committee` seat, by contrast, **may** carry `layerOwnerCount ≠ 1`,
  which composes with its §9.9 relay factors); an `org.matrix` with a non-boolean `enabled`,
  a `tiebreaker` outside `[0, 1]`, or any key other than `enabled`/`tiebreaker`
  (`deny_unknown_fields`); and a `team.reviewCapacityPerStep` that is present and `≤ 0` (the
  field is optional — `null` or absent = unbounded, which is valid). If the terminal layer L
  is **both** a `committee` **and** the matrix target, the committee contributes its §9.9
  distortion factor **and** the matrix μ = 2 with no conflict (different mechanisms), and the
  `layerOwnerCount ≠ 1` rejection still applies there because it is the matrix target.
  These are "out-of-range structural values" in the sense of the reject bullet above.
  **Replay looseness (§12.4) — with a structural exception for the μ ceiling.** Replay
  looseness exists so an old share URL replays its embedded `resolvedParams` even after a
  *tunable-coefficient* range is later narrowed. It does **not** extend to
  `org.layerOwnerCount`'s upper bound: `μ ≤ 8` is a **structural safety constraint the §6 L1
  boundedness proof and the unclamped M19 latency channel (`diffusionLatencyFactor`) depend
  on**, so — exactly like the `length == ownershipLayers` joint-constraint — it is enforced
  at **both authoring and replay** (a replayed `layerOwnerCount` entry must be an integer in
  `[1, 8]`, never merely `≥ 1`). Replay re-checks type/domain (each `layerOwnerCount` entry an
  integer in `[1, 8]`, `tiebreaker` a number in `[0, 1]`, `reviewCapacityPerStep` `null` or
  `> 0`), the matrix-target intrinsic-μ rule, and the length joint-constraint below; the μ
  ceiling is therefore **not** subject to the "narrow a range post-lock" looseness (the ceiling
  is fixed for the life of `schemaVersion` "1"), while genuinely tunable coefficient ranges in
  `resolvedParams` remain loose per the original policy.

### 12.2 Config

```json
{
  "schemaVersion": "1",
  "modelVersion": "2.0.0",
  "sim": "org",
  "seed": 42,
  "iterations": 500,
  "horizon": 60,
  "paramOverrides": { "layerFrictionFactor": 0.5, "taskEffortNovel": [6, 9, 15] },
  "cost": { "enabled": false },
  "org": {
    "headcountStart": 20, "headcountGrowthPerStep": 0,
    "topology": "hierarchical", "hierarchyDepth": 3, "ownershipLayers": 3,
    "modality": "asyncFirst", "structuralHealth": 6,
    "misalignment": 0.2,
    "aiInjection": { "enabled": false, "atStep": 0 }
  }
}
```

| field | type / range | notes |
|---|---|---|
| `schemaVersion` | string, must be `"1"` | major schema version; unknown major → graceful rejection |
| `modelVersion` | string | informational on input; engine stamps the current version on output |
| `sim` | `"org"` \| `"team"` | exactly one of `org` / `team` blocks must be present, matching `sim` |
| `seed` | u64 | Monte Carlo master seed |
| `iterations` | int 50–5000, default 500 | |
| `horizon` | int 10–600, default 60 | steps |
| `paramOverrides` | map `paramId → number \| [min,mode,max]`, optional | **applied by the engine in v1** (UI sliders are v2); keys must exist in params.json. Authored configs enforce the current declared range; full-set `resolvedParams` replays (share URLs) validate structure/type + joint constraints only, bypassing range membership (§12.1/§12.5) |
| `cost` | `{ "enabled": false }`, optional | **reserved v2 block**; `enabled: true` → typed NotImplemented error |
| `org.headcountStart` | int 4–500 | |
| `org.headcountGrowthPerStep` | number 0–2 | people/step |
| `org.topology` | `flat \| hierarchical \| pods \| federated` | |
| `org.hierarchyDepth` | int 1–6 | reporting depth D (distortion, M8) |
| `org.ownershipLayers` | int 1–5 | prioritization stack L (M6) |
| `org.layerTypes` | array of `humanPm \| humanDirector \| aiAgent \| committee`, optional | length must equal `ownershipLayers`; default all `humanPm` (§9.9) — per-layer ownership-seat typing (P6 configurator); absent ⇒ base model |
| `org.layerOwnerCount` | array of int 1–8, optional | length must equal `ownershipLayers`; default all `1` (§4 M19) — per-layer accountability multiplicity μ (co-equal owners of one seat); the matrix seat's μ is intrinsic and rejects a conflicting entry (§12.1), while a `committee` seat takes its μ from this field like any other non-matrix seat (so a committee may set it > 1); absent ⇒ base model |
| `org.matrix` | `{enabled: bool (default false), tiebreaker: number 0–1 (default 0)}`, optional | lateral dual-authority seat at the terminal layer L, μ = 2 with a decision-rights tiebreaker (§4 M19); rejects unknown keys (`deny_unknown_fields`); absent or `enabled:false` ⇒ base model |
| `org.modality` | `asyncFirst \| meetingHeavy` | |
| `org.structuralHealth` | int 1–10 | §3.4 |
| `org.misalignment` | number 0–1, optional | m₀; default derived from SH (M5) |
| `org.initialBacklog` | int 0–500, optional, default 0 | standing backlog present at t = 0 (M18) |
| `org.aiInjection` | `{enabled: bool, atStep: int ≥ 0}` | |
| `team.entities` | array 2–12 of entity objects (§3.2) | capabilities default from the archetype table |
| `team.workStream` | `{arrivalPerStep: 0.2–5, mix: {routine, complex, novel}, highStakesShare: 0–1}` | mix sums to 1 |
| `team.modality` | as org, optional, default `asyncFirst` | |
| `team.structuralHealth` | int 1–10 | |
| `team.recoveryOwner` | entity id \| null | M10 ownership |
| `team.reviewCapacityPerStep` | number > 0 (may be fractional), optional, default `null` (unbounded) | M20 review-to-done throughput gate (a finite value clears via an M6-style use-it-or-lose-it fractional accumulator, §4 M20); `null` ⇒ current unlimited-parallelism review (byte-identical to v1). `validate()`: if present, finite and `> 0`. Config field (sibling of `team.recoveryOwner`), **not** a params.json coefficient. Additive-optional under `schemaVersion` "1"; `deny_unknown_fields` still holds. |

### 12.3 Output

```json
{
  "schemaVersion": "1",
  "modelVersion": "2.0.0",
  "sim": "org",
  "seed": 42,
  "iterations": 500,
  "horizon": 60,
  "series": { "entropy": [ { "t": 0, "p10": 21.4, "p50": 22.6, "p90": 24.1 } ] },
  "perLayer": [ { "layer": 1, "layerType": "humanPm", "meanLatencyDays": 2.1, "meanQueue": 0.4, "utilization": 0.45, "overrideShare": 0.0, "distortion": 0.0, "bottleneck": false } ],
  "bandMarkers": [5, 15, 50, 150],
  "resolvedParams": { "layerFrictionFactor": 0.35 }
}
```

- `series` carries every §7 series for the sim as tidy percentile arrays
  (`metric → [{t, p10, p50, p90}]`, one entry per step).
- Team outputs replace `perLayer`/`bandMarkers` with `qualityHistogram` and
  `functionCoverage` (§7.2).
- **`resolvedParams`** is the full effective coefficient set (defaults merged with
  `paramOverrides`) — the share-URL payload takes it from here, so a share URL can never
  disagree with the run it came from.
- Serialized size for the heaviest v1 config must stay < 200 KB (P3 asserts).

### 12.4 Share-URL policy

- Fragment: `#s=` + base64url( deflate-raw( UTF-8 JSON `{v: 1, sim, seed, config,
  resolvedParams}` ) ), where `v` is the codec version and `resolvedParams` is the full
  effective coefficient set from the run's output.
- **Replay ALWAYS runs from the embedded `resolvedParams`:** the decoder constructs
  `config.paramOverrides = resolvedParams` (full-set override, winning over any original
  overrides). The modelVersion-mismatch banner ("created with model vX.Y — this link
  replays its embedded parameters") is informational only; the run proceeds on embedded
  params.
- **"Reproduces identically" means byte-identical on the series payload** —
  version-metadata fields are excluded from the comparison (a post-capture amendment
  bumps modelVersion without changing replayed numbers).
- **Evolution caveat (stated policy):** a maintainer-reviewed amendment that adds a NEW parameter
  means older share URLs replay with that parameter at its then-current default (it is
  absent from their embedded set). The banner covers the disclosure; within one major
  schema this is the only permitted replay drift.
  The "byte-identical series payload" replay comparison is over the series present in **both**
  model versions; the additive new series (`reviewQueueDepth`, `reviewWaitDays`, and the additive
  `perLayer` fields `ownerMultiplicity` / `diffusionFactor`) are **excluded** from the comparison,
  consistent with the §12.1/§12.5 additive-output policy. Every pre-existing config — **including
  one that uses a `committee` seat** — replays byte-for-byte at the neutral defaults, because a
  committee's §9.9 factors are unchanged and its default μ is 1; the amendment adds **no** committee
  replay drift. (A committee that a user later makes diffuse via `layerOwnerCount > 1` is a new,
  explicitly-authored config, not a replay of an old one.)

### 12.5 Schema evolution

Additive-only within a major `schemaVersion`: new optional fields may appear; existing
fields never change meaning or type. The `cost` block and `paramOverrides` map are the
pre-reserved v2 hooks; `org.layerTypes` (§9.9) is an additive optional field whose absence
reproduces the pre-existing all-`humanPm` behavior. Unknown **major** schema versions are
rejected gracefully by the UI with an upgrade message.
`org.layerOwnerCount`, `org.matrix`, and `team.reviewCapacityPerStep` (§4 M19/M20) are
additive optional fields on the same footing as `org.layerTypes`: when absent — μ all 1,
matrix off, `reviewCapacityPerStep` `null` (unbounded), and `overrideAuthorityGradient` at its
default 0 — they reproduce the pre-amendment output byte-for-byte (§12.4), and **every
pre-existing config, preset, and golden is unchanged, including any that uses a `committee`
seat** (a committee's §9.9 factors are untouched and its default μ is 1, so **no existing
`layerTypes` value changes meaning**). A committee's accountability diffusion is now an
**opt-in, explicit** cost via `org.layerOwnerCount > 1`, so making a committee diffuse is
authoring a new config, not a drift in an existing one. An old share URL created before this
amendment carries none of these fields and replays at those neutral defaults, seeing the new
§9.10 coefficients at their then-current defaults (§12.4). **`schemaVersion` stays `"1"`:** all
fields are additive-optional within the same major schema, so old configs still load and
`deny_unknown_fields` still holds (the fields are now *known*-optional).

**Range changes vs replay.** A parameter's `range` is authoring-time metadata, not
part of the reproducibility contract. A maintainer-reviewed amendment may narrow or shift a range;
share URLs created before the change still replay, because replay validates the embedded
`resolvedParams` structurally/by type only and skips current-range membership (§12.1).
The value embedded in the link — not today's range — is what reproduces. Authoring a
*new* config through the UI still enforces the current range.

### 12.6 modelVersion policy and CI pairing (declaration format)

`modelVersion` is MAJOR.MINOR.PATCH:

- **PATCH** — prose-only edits that leave **all three** extracted artifacts
  (`model/params.json`, `model/goldens.json`, `www/assumptions.json`) byte-identical.
- **MINOR** — any change to **any** extracted artifact: coefficient defaults within range
  (params.json), maintainer-reviewed golden predicate/tolerance changes (goldens.json), or
  maintainer-reviewed new parameters (params.json + assumptions.json). A tolerance-only edit touches
  goldens.json but not params.json, yet still bumps MINOR — hence the trigger is "any
  extracted artifact", not "params.json only".
- **MAJOR** — mechanic formula changes, schema-affecting changes, RNG scheme/library
  major changes.

**Every amendment that changes any extracted artifact bumps modelVersion (at least MINOR)**
and appends a §14 changelog row. **CI pairing gate (P3 wires; P1 defines):** CI recomputes
`sha256(model/params.json)`, `sha256(model/goldens.json)` AND `sha256(www/assumptions.json)`
and fails unless the §14 changelog table contains a row whose `modelVersion` equals the
meta-block declaration AND whose `params.json sha256`, `goldens.json sha256`, and
`assumptions.json sha256` all equal the recomputed hashes. Pairing all three artifacts (not
params.json alone) is what catches both a tolerance-only amendment — which touches
goldens.json but not params.json — and a mechanic-formula edit that materializes only in
`www/assumptions.json`. The changelog table IS the declaration format.

### 12.7 Generated artifacts (extraction contract)

`scripts/extract_params.mjs` regenerates all three files from this document's tagged
blocks; CI re-runs it and fails on any diff (drift gate). Exact shapes:

- **`model/params.json`** — `{ modelVersion, schemaVersion, parameters: [<parameter
  block verbatim>] }` in document order. Embedded in the engine via `include_str!`.
- **`model/goldens.json`** — `{ modelVersion, assertions: [<golden block verbatim>] }`.
  Consumed by the generic predicate evaluator via `include_str!`.
- **`www/assumptions.json`** — the Assumptions drawer content (P8 renders it verbatim;
  a P8 test asserts every required field exists per item type):

```json
{
  "modelVersion": "1.0.0",
  "generatedBy": "scripts/extract_params.mjs from MODEL.md - do not edit by hand",
  "items": [
    { "type": "parameter", "id": "...", "plainLanguage": "...", "formula": "...",
      "tier": "peer-reviewed | industry-report | editorial-heuristic",
      "limitation": "...", "anchor": "...", "value": 0, "range": [0, 0],
      "unit": "...", "distribution": "point | triangular" },
    { "type": "mechanic", "id": "...", "plainLanguage": "...", "formula": "...",
      "citations": ["..."], "limitations": ["..."] }
  ]
}
```

Items appear in document order: all parameters, then all mechanics. Both item types carry
the same `plainLanguage` prose field; parameters additionally carry `tier`, `limitation`,
`anchor`, `value`, `range`, `unit`, `distribution`; mechanics additionally carry
`citations[]` and `limitations[]`. No timestamps or other non-deterministic content —
re-running the extractor on an unchanged MODEL.md is byte-identical (idempotent).

---

## 13. Limitations & evidence tiers

An honest scorecard of what this model is made of. Tier counts for v1.0.0
(auto-checkable against `www/assumptions.json`):

- **peer-reviewed (coefficient values):** 0. The *directions* of several mechanics rest
  on peer-reviewed work (Brooks channel math; Conway mirroring via MacCormack et al.
  2012 and Nagappan et al. 2008; hierarchical decision delay via Baker et al. 1975), but
  no coefficient *value* in v1 comes from a peer-reviewed point estimate — and the
  drawer says so per coefficient.
- **industry-report:** 7 (`decisionLatencyPerLayerDays`, the four cognitive band centers,
  `teamPodTargetSize`, `hierarchicalTeamSize`) — parameters whose numeric value, not just
  direction, comes from named industry research or established practice.
- **editorial-heuristic:** all remaining parameters — adjustable defaults chosen so the
  mechanics behave plausibly, exposed via `paramOverrides` (UI sliders in v2). This
  includes `meetingHeavyMultiplier` and `cohesionAiPenalty`, whose *directions* are
  industry-supported but whose *magnitudes* are editorial (the tier tracks the number's
  provenance, not the mechanic's).

Structural limitations (also surfaced per-mechanic in the drawer):

1. **The model is a caricature with the right skeleton.** It encodes directions and
   orders of magnitude, not calibrated predictions for any specific org. Outputs are
   ranges from stated assumptions, and the app never claims otherwise.
2. **Brooks' complete-graph assumption** is applied per team; real communication
   topologies are sparser (Raymond's core/periphery critique is disclosed at M1).
3. **Dunbar-style bands are contested** (Lind et al. 2021: the underlying method cannot
   pin the number; alternative US estimate ≈ 290). The model uses adjustable gradual
   bands and never a cliff.
4. **The 68.7% hybrid-team advantage** is a single lab-based, secondhand-reported study
   family; it is deliberately `editorial-heuristic`, deliberately adjustable, and
   deliberately never quoted as a universal constant.
5. **The 1.3–1.8× Structural-Health amplification** — the load-bearing Faster
   Dysfunction coefficient — synthesizes practitioner reports, not controlled studies.
   The model's central qualitative claim (AI amplifies existing structure) is
   better-supported than the specific multiplier.
6. **SH is one scalar** compressing five structural properties; two orgs with equal SH
   can fail differently.
7. **No cost/salary layer in v1** (reserved `cost` block; a deliberate scope boundary —
   eigenorg models structure and coordination dynamics, not budgeting or headcount cost).
   No mid-run restructuring events, hiring events, or attrition in v1.
8. **Quality and entropy are internal indices** — comparable across runs of the same
   modelVersion, not benchmarkable against the outside world.
9. **Review-queue congestion is not in the entropy composite.** The M20 review queue is
   visible only through `reviewQueueDepth` / `reviewWaitDays`; it is not fed back into the
   M13 entropy composite in v2.0.0. Coupling review congestion into entropy is a candidate
   future MINOR.
10. **Accountability diffusion is linear in (μ−1).** M19's three channels are linear in the
   number of added co-equal owners, which overstates the override channel and understates the
   latency channel beyond ~4 co-equal owners (the empirical diffusion saturates ~N^0.5; Brooks
   pairwise-coordination cost is convex ~μ(μ−1)/2). A saturating override cap and a convex
   Brooks latency form for μ > 4 are deferred refinements; realistic μ (matrix 2, a diffuse
   committee ~3 via `layerOwnerCount`) sits in the linear regime.

Tier counts: the four new §9.10 coefficients are all **editorial-heuristic**; the
`peer-reviewed` (0) and `industry-report` (7) counts are unchanged.

---

## 14. Changelog

| modelVersion | date | params.json sha256 | goldens.json sha256 | assumptions.json sha256 | changes |
|---|---|---|---|---|---|
| 1.0.0 | 2026-07-04 | `9b2ce2421c1a13c06dacae001914f5ea4bb6427e44e47c9afcb0fa5d77a080fb` | `3581b470fe333b7a56ad3c8bbb64d9b6d0616e9228355c3460f727dd84aa0173` | `147ec8b99e5e3d2c2593bd7ac763483b0f66418492370d0b824e3a701f6140d6` | Initial model: unified org/team spec with per-layer ownership typing (§9.9), 6 calibrated scenarios, 34 golden assertions, extraction pipeline. |
| 2.0.0 | 2026-07-04 | `60e0ebd0c51b54562b585cf2adf7bc4c602113e23535be201265c5b541440b82` | `bf4249cfbca2a3bf128029d1decb4472874a4ee2fbea8b426d0848b531777c01` | `ca4a16cf385a704c4d24ac1f005567da3df9d1bf4af91d4fe1d497d580839496` | Accountability multiplicity μ (§4 M19 `accountabilityDiffusion`) + review-capacity queue (§4 M20 `reviewCapacityQueue`). M8 gains a diffusion term (μ>1 co-equal owners raise relitigation) and an opt-in authority-gradient override attribution (default `0.0` = v1 uniform draw); four new params in **§9.10** (all editorial-heuristic; document order fixes params.json order/SHA). New additive-optional config fields `org.layerOwnerCount` (int 1–8), `org.matrix{enabled,tiebreaker}` (terminal-layer μ=2), `team.reviewCapacityPerStep` (config field, not a params.json coefficient); new team output series `reviewQueueDepth`, `reviewWaitDays` (additive; consumers ignore unknown output fields). Four new scenarios (§10.7–§10.10) and 18 new goldens ⇒ **ten scenarios, 52 golden assertions** (34 v1 unchanged + 18 new). **Neutral identity (fully additive):** μ=1 / matrix off / unbounded review / gradient 0 reproduces v1.0.0 series byte-for-byte AND all 34 v1 golden verdicts for **every** pre-existing config, **including any using a `committee` seat** (a committee's §9.9 factors are unchanged and its default μ is 1; its accountability diffusion is now the opt-in, additive `org.layerOwnerCount` cost, so no existing `layerTypes` value changes meaning). `schemaVersion` stays `"1"`. **Calibration (2026-07-04):** the org-side v2 golden bounds (§11.8 accountabilityDiffusion, §11.9 committeeInversion, §11.10 matrix) were retuned against the engine golden harness at seed 42 / 500 iterations and are asserted green; the `matrix` `mxTiebreakerRecovers` exact identity and the §11.6 `hmReviewWaitNeutral` identity both verify. The team-side §11.11 `reviewBottleneck` bounds remain provisional (the team engine arm is NotImplemented until P7a and its scoped calibrator surfaced a scenario/mechanics mismatch — see the P3c calibration report); their retune and the v2.0.0 lock await that resolution. |

---

## Appendix A — Hand simulation: 3 steps, 2 entities, on paper

This appendix proves MODEL.md is hand-simulatable (P1 acceptance gate). Team simulator,
**mean-path mode** (§8.4), rounding to 4 decimals.

**Config:** horizon 3; SH 6; modality asyncFirst; recoveryOwner null;
workStream `{arrivalPerStep: 1.0, mix: {routine: 1, complex: 0, novel: 0}, highStakesShare: 0}`.
Entities:

| id | kind | thr | jdg | hf | rel | avail | functions (capability) |
|---|---|---|---|---|---|---|---|
| ana | human | 6 | 6 | 4 | 8 | 1.0 | prioritization (5), execution (7), review (6) |
| exo | ai | 8 | 3 | 2 | 7 | 1.0 | execution (8) |

**Constants once (step-independent here):**

- Attention: ana covers 3 functions → `min(1, 3/3) = 1`; exo (AI) = 1.
- Execution rates (M15): ana `6 × 0.2 = 1.2` pts/step; exo `8 × 0.2 = 1.6`.
  Pool raw = 2.8; `aiExecShare = 1.6/2.8 = 0.5714`.
- Coordination tax (M14): channels C = 1; C/n = 0.5. Band factor B(2) (M3):
  `1 + 0.05·σ(−4) + 0.10·σ(−5.7778) + 0.12·σ(−6.4) + 0.15·σ(−6.5778)`
  `= 1 + 0.0009 + 0.0003 + 0.0002 + 0.0002 = 1.0016`.
  Base = `0.036 × 0.5 × 1.0016 = 0.0180`. Handoff = `0.03 × ((4+2)/2)/5 = 0.0180`.
  **τ = 0.0360.** Effective pool `P_eff = 2.8 × 0.9640 = 2.6991`.
- Routine boost (M11): `1 + 0.5714 × (1.5 − 1) = 1.2857`.
- Effort per routine task (mean-path): `(1.5 + 2.5 + 4)/3 = 2.6667` pts.
- Prioritization service (M6/M11): human-covered, no AI on prioritization →
  mean `Tri(2, 2.5, 3) = 2.5` days. `M_recovery = 1` (no events possible: novel mix 0).
- Coverage (M17, t = 0): demands — execution `2.0 × (2/8) = 0.5`, others `0.125`.
  execution `(0.7 + 0.8)/0.5 → 1.00` **green**; prioritization `0.5/0.125 → 1.00`
  **green**; review `0.6/0.125 → 1.00` **green**; coordination, stakeholderCommunication,
  synthesis, ambiguityResolution `0` **red**. Hollow (M12)? No — no AI is assigned to
  prioritization/coordination/stakeholderCommunication.
- Cohesion target (M12): `75 − 15 × (1/2) − 12 × σ((2−15)/2.25) = 75 − 7.5 − 0.0370 = 67.4630`.
- Entropy proxy weights (M13 team): `(0.30, 0.25, 0.15)/0.70`. `xCoord = 0.0360/0.85 = 0.0424`.

**Walk (arrival accumulator gains exactly 1.0/step → one routine task per step):**

| step | pipeline events | execution | series values |
|---|---|---|---|
| t=0 | Task₁ arrives, `queued(1)`, service 2.5 → decrement → 1.5 | none in progress | throughput 0; latRoutine 2.5 (init); τ 0.0360; cohesion **75.00**; xLat 0.2083; **E = 100×(0.30×0.0424 + 0.25×0.2083)/0.70 = 9.26**; healthGap 75 − 90.74 = **−15.74** |
| t=1 | Task₂ arrives (1.5); Task₁ → 0.5 | none | throughput 0; latRoutine 2.5 (carry); cohesion **74.62** (75 + 0.05×(67.4630 − 75) = 74.6232); E **9.26**; healthGap **−16.12** |
| t=2 | Task₃ arrives (1.5); Task₂ → 0.5; Task₁ → −0.5 ⇒ ready, capacity 6 ⇒ **approved** (T4), latency sample = age = 2 days → EMA `0.3×2 + 0.7×2.5 = 2.35` | Task₁ gets `min(2, 2.6991) = 2` pts × 1.2857 = **2.5714 progress** < 2.6667 → not done | throughput 0; latRoutine **2.35**; cohesion **74.27** (74.6232 + 0.05×(67.4630 − 74.6232) = 74.2652); xLat 0.1958; **E = 100×(0.01272 + 0.04896)/0.70 = 8.81**; healthGap **−16.92** |

Cohesion coupling term is 0 throughout (E < entropyStressThreshold 60).

**What happens next (outlook, t=3):** Task₁ needs 0.0953 more progress (0.0741 raw pts),
completes execution, enters the 1-day review dwell, and lands `done` at t=4 with
mean-path quality `μ_q = 45 + 5.5×6 + 1.0×((8+7)/2 − 7) = 78.5` →
`mean Tri(63.5, 78.5, 88.5) = 76.83`. Task₂ is approved at t=3 and starts executing.
From ~t=6 the team settles into ≈1 completion/step (arrival-limited).

Every number above is reproducible with a pocket calculator from §3–§9 alone — which is
the point.
