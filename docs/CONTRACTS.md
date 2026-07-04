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
  both.
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
- **Lifecycle:** `begin_run` → repeated `run_chunk(n)` until
  `completedCount == totalIterations` → `finalize()`. `finalize()` is a pure read
  (idempotent). **Cancel = `cancel()` (or a new `begin_run`), then begin again;**
  a fresh run reproduces the previous output byte-for-byte.
- **State machine:** `run_chunk`/`finalize` before `begin_run` → `badState`;
  `finalize` before completion → `badState`.

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
- **Replay always runs from the embedded `resolvedParams`:** the decoder sets
  `config.paramOverrides = resolvedParams` (full-set override, wins over any
  original overrides). The modelVersion-mismatch banner is informational; the run
  proceeds on embedded params.
- **Replay detection (engine):** a `paramOverrides` map covering the full
  parameter set is treated as a replay — it validates structure/type/finiteness
  and the joint + μ-ceiling constraints, but **skips current-range membership**
  (an old link replays its embedded numbers even after a range is later narrowed,
  §12.5). Any smaller override set is an authored override and enforces the
  current range. The `μ ≤ 8` ceiling is a structural safety bound and is enforced
  in **both** modes.
- **"Reproduces identically" = byte-identical on the series payload;**
  version-metadata fields and additive-only new series
  (`reviewQueueDepth`, `reviewWaitDays`, the additive `perLayer` fields
  `ownerMultiplicity`/`diffusionFactor`) are excluded from the comparison.

## 5. modelVersion / CI pairing (MODEL.md §12.6)

`modelVersion` (from the MODEL.md meta block, emitted into `model/params.json` by
the extractor) is paired in CI to `sha256(params.json)`, `sha256(goldens.json)`,
and `sha256(assumptions.json)` via the §14 changelog row. Any extracted-artifact
change bumps at least MINOR; a mechanic/schema/RNG change is MAJOR.
