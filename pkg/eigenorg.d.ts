/* tslint:disable */
/* eslint-disable */

/**
 * `begin_run(sim, config_json, seed)` — set up a run. Replaces any in-flight run
 * (cancel-and-restart). Returns `{ "ok": true, "totalIterations": N }` or an
 * error envelope.
 */
export function begin_run(sim: string, config_json: string, seed: bigint): string;

/**
 * `cancel()` — drop the in-flight run. A fresh `begin_run` reproduces exactly.
 */
export function cancel(): void;

/**
 * Echo round-trip (P2 skeleton surface; retained until P5 rewrites the worker).
 */
export function echo(input: string): string;

/**
 * `finalize()` — aggregate to the output JSON, or an error envelope (including
 * BadState if the run has not completed every iteration).
 */
export function finalize(): string;

/**
 * Model version string, for the page header and output stamping.
 */
export function get_model_version(): string;

/**
 * Dummy perf probe (P2 skeleton surface): seeded Monte Carlo pi estimate.
 */
export function monte_carlo_pi(iterations: number, seed: number): number;

/**
 * `run_chunk(n)` — run up to `n` more iterations; returns
 * `{ "completedCount": c, "totalIterations": t }` or an error envelope.
 */
export function run_chunk(n: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly begin_run: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly echo: (a: number, b: number) => [number, number];
    readonly finalize: () => [number, number];
    readonly get_model_version: () => [number, number];
    readonly monte_carlo_pi: (a: number, b: number) => number;
    readonly run_chunk: (a: number) => [number, number];
    readonly cancel: () => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
