/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const begin_run: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
export const echo: (a: number, b: number) => [number, number];
export const finalize: () => [number, number];
export const get_model_version: () => [number, number];
export const monte_carlo_pi: (a: number, b: number) => number;
export const run_chunk: (a: number) => [number, number];
export const cancel: () => void;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
