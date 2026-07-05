# eigenorg — CONTRACTS.md

The derived, operational copy of MODEL.md §12 (Schema & versioning) plus the
**frozen** engine/worker API. On any conflict, **MODEL.md §Schema wins** — this
file restates it for implementers and pins the wasm export signatures P5+ build
against.

**Frozen at P3 (this file + `src/api.rs`).** Changing a signature below, the
config/output schema (`docs/schema/*.json`), or the URL-hash codec after P3 is a
review-blocking change. P7a fills in the team simulator body **without** changing
any signature.

---

## 1. Config & output schema

- Authoritative definition: MODEL.md §12.2 (config) and §12.3 (output).
- Machine-checkable forms: `docs/schema/config.v1.schema.json` and
  `docs/schema/output.v1.schema.json`.
- **Double-validation gate:** every committed fixture must pass BOTH serde +
  `validate()` (Rust) AND ajv against the config schema (node). A fixture
  accepted by exactly one is a drift bug (PREMORTEM T3). `fixtures/scenarios/**`
  and `fixtures/hash/**` are valid; `fixtures/invalid/**` must be rejected by
  both. The config schema now requires the `org` block when `sim=org` (and forbids
  `team`) and vice-versa, and pins `capabilities` keys to the seven functions, so
  missing/mismatched blocks and an unknown capability key are caught by both.
- **Serde-only rejections (documented asymmetry).** A few authoring constraints are
  cross-field or params-membership checks that JSON Schema draft-07 cannot express:
  the `team.workStream.mix` fraction sum, `layerOwnerCount.length ==
  ownershipLayers`, the matrix-target seat's `layerOwnerCount == 1` rule, the
  `recoveryOwner` entity-id back-reference, and `paramOverrides` keys existing in
  `params.json`. Fixtures exercising these live in `fixtures/invalid_serde_only/`:
  the Rust authoring stack (`validate()` + `Params::resolve`) rejects them
  (`tests/double_validation.rs`), and ajv is asserted to ACCEPT them
  (`www/js/tests/double-validation.test.mjs`) so the asymmetry is a pinned,
  intentional invariant rather than a silent gap. If a schema change ever lets ajv
  express one, its fixture moves to `fixtures/invalid/`.
- **Residual serde-only bound (`seed`).** `org.aiInjection.atStep` now carries the
  `u32` upper bound (`maximum: 4294967295`) in the schema, but `seed` (serde `u64`)
  keeps no schema upper bound: a JSON schema `maximum` of `u64::MAX` cannot be
  represented exactly in ajv's IEEE-754 evaluation, so an out-of-`u64`-range literal
  (e.g. `1e999`) stays a serde-only rejection (ajv accepts the non-negative integer;
  the serde `u64` parse overflows). This is an accepted residue on an intentionally-wide
  field, not a fixture-backed invariant.
- **Reverse asymmetry (ajv-stricter).** An explicit `null` on an optional field the
  schema types as non-null (e.g. `org.misalignment: null`) is rejected by ajv — the
  property's type is `number`, not `null` — while serde accepts it as an absent
  `Option` (`None`). This is intended fail-closed at the browser, and the P5 share-URL
  codec never emits `null`s, so no real payload trips it.
- All JSON is camelCase; config is `deny_unknown_fields`; output is
  additive-extensible (consumers ignore unknown fields). `schemaVersion` and
  `modelVersion` appear in both.
- `validate()` (authoring) enforces: unknown fields, NaN/Inf, structural ranges,
  the sim↔block match, `layerTypes`/`layerOwnerCount` length == `ownershipLayers`,
  `layerOwnerCount ∈ [1,8]` (and `== 1` on a matrix target seat), matrix
  `tiebreaker ∈ [0,1]`, `reviewCapacityPerStep > 0` when present, entropy-weight
  sum, and `taskMix` sum. `cost.enabled == true` is rejected (v1).

## 2. Frozen chunked wasm API (`src/api.rs`)

One in-flight run per worker. Every export returns a JSON string — a success
payload or an error envelope `{ "error": { "type", "message" } }` (`type ∈
{validation, notImplemented, badState}`) — so the worker never interprets a trap.

| export | signature | returns |
|---|---|---|
| `get_model_version()` | `() -> String` | the modelVersion string |
| `begin_run(sim, config_json, seed)` | `(&str, &str, u64) -> String` | `{ ok: true, totalIterations }` or error envelope; replaces any in-flight run |
| `run_chunk(n)` | `(u32) -> String` | `{ completedCount, totalIterations }` or error envelope |
| `finalize()` | `() -> String` | the output JSON, or an error envelope (BadState if not every iteration has run) |
| `cancel()` | `() -> ()` | drops the in-flight run |

- `sim` is `"org"` or `"team"`; it must match `config.sim`. The **team** arm
  returns a typed `notImplemented` error until P7a (signature frozen; body later).
- The P3-era org `aiInjection` NotImplemented guard is **gone (removed at P4, as
  planned here; signature-stable — no export changed)**: the M9/M11 execution
  effects and the M12 cohesion-AI term are implemented, so an org run with
  `org.aiInjection.enabled == true` runs normally. An inactive injection
  (`enabled: false`, or `atStep` beyond the horizon) is an exact no-op — the
  series payload is byte-identical to the P3 kernel.
- **Lifecycle:** `begin_run` → repeated `run_chunk(n)` until
  `completedCount == totalIterations` → `finalize()`. `finalize()` is a pure read
  (idempotent). **Cancel = `cancel()` (or a new `begin_run`), then begin again;**
  a fresh run reproduces the previous output byte-for-byte.
- **State machine:** `run_chunk`/`finalize` before `begin_run` → `badState`;
  `finalize` before completion → `badState`.
- **Transitional (non-contract) exports.** `echo` and `monte_carlo_pi` (`src/api.rs`)
  are P2 walking-skeleton surfaces kept only so the skeleton page loads until P5
  rewrites the worker. They are **not** part of the frozen surface — P5 removes them
  with the worker rewrite — so the freeze does not bind them.

### Worker protocol (P5 implements; shape frozen here)

Messages `{ id, type, payload? }`, `type ∈ { run | progress | result | error |
cancel }`, map onto the chunk loop: the engine-client posts `run`, the worker
loops `run_chunk` emitting `progress` (`completedCount/totalIterations`) between
chunks, then `result` (the output JSON) or `error` (an envelope). `cancel` drops
the run. The engine-client serializes calls so there is exactly one in-flight run
per worker (the P5 before/after pane is two sequential runs).

## 3. Determinism & chunk invariance

- RNG: `ChaCha8Rng`, per-iteration seed
  `splitmix64(masterSeed + i·0x9E3779B97F4A7C15)` (MODEL.md §8.1). No getrandom,
  no wall clock, no HashMap in sim state (Vec/BTreeMap only).
- **Chunk-partition invariance (contract + property-tested):** the output is
  invariant to chunk size. `run_chunk(1)×N == run_chunk(N)×1 ==` the native
  monolithic runner, byte-for-byte — iteration `i` is seeded independently of
  chunk boundaries.
- **Cross-target output hash:** `exp`/`sqrt` go through the pure-Rust `libm`
  crate, so native (any OS) and wasm run identical transcendental code. The
  committed hash `fixtures/hash/crossTarget.sha256` is asserted BOTH natively
  (`tests/cross_target.rs`) and via the built wasm
  (`www/js/tests/cross-target-hash.test.mjs`, non-default chunk size). P5 re-runs
  it; P9 re-checks on the live URL.

## 4. Share-URL / replay policy (MODEL.md §12.4)

- Fragment: `#s=` + base64url( deflate-raw( UTF-8 JSON
  `{ v: 1, sim, seed, config, resolvedParams }` ) ), `v` the codec version,
  `resolvedParams` the full effective coefficient set from the run's output.
- **Replay always runs from the embedded `resolvedParams`:** the P5 url-codec, when
  it reconstructs a config from a share URL, sets `config.paramOverrides =
  resolvedParams` (full-set override, wins over any original overrides) **and sets
  the explicit `config.replay = true` flag**. The modelVersion-mismatch banner is
  informational; the run proceeds on embedded params.
- **Replay detection (engine):** replay is the **explicit `config.replay` boolean**
  (default `false`), not an inference from the size of the `paramOverrides` map. When
  `replay == true` the engine validates structure/type/finiteness and the joint +
  μ-ceiling constraints but **skips current-range membership** for overrides (an old
  link replays its embedded numbers even after a range is later narrowed, §12.5). When
  `replay` is absent or `false` the config gets **full authoring validation**, range
  membership included — even a `paramOverrides` map that happens to cover every
  parameter. The `μ ≤ 8` ceiling is a structural safety bound and is enforced in
  **both** modes. Because detection is an explicit flag, a future amendment that adds a
  parameter can never turn an authored full-set map into an accidental replay, and an
  **older share URL that omits a later-added param replays with the current default for
  that missing key** (§12.4 evolution caveat) rather than breaking.
- **"Reproduces identically" = byte-identical on the series payload;**
  version-metadata fields and additive-only new series
  (`reviewQueueDepth`, `reviewWaitDays`, the additive `perLayer` fields
  `ownerMultiplicity`/`diffusionFactor`) are excluded from the comparison.

## 5. modelVersion / CI pairing (MODEL.md §12.6)

`modelVersion` (from the MODEL.md meta block, emitted into `model/params.json` by
the extractor) is paired in CI to `sha256(params.json)`, `sha256(goldens.json)`,
and `sha256(assumptions.json)` via the §14 changelog row. Any extracted-artifact
change bumps at least MINOR; a mechanic/schema/RNG change is MAJOR.
