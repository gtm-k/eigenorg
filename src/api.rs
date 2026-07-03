//! Thin wasm-bindgen boundary — the ONLY module that touches wasm-bindgen.
//!
//! Compiled exclusively for wasm32 (see `Cargo.toml` target-gated dependency
//! and the `#[cfg]` in `lib.rs`), so the engine core stays wasm-free and
//! native `cargo test` never needs the wasm toolchain.
//!
//! P2 exports only the walking-skeleton surface. P3 freezes the full export
//! signature set (chunked stateful run API) — do not grow this file casually.

use wasm_bindgen::prelude::*;

/// Model version string, for the page header and output stamping.
#[wasm_bindgen]
pub fn get_model_version() -> String {
    crate::model_version().to_string()
}

/// Echo round-trip: proves a string crosses JS -> wasm -> JS unchanged.
#[wasm_bindgen]
pub fn echo(input: &str) -> String {
    crate::echo(input)
}

/// Dummy perf probe: seeded Monte Carlo pi estimate (see `crate::monte_carlo_pi`).
/// The worker times this call for the earliest read on the <1.5 s budget.
#[wasm_bindgen]
pub fn monte_carlo_pi(iterations: u32, seed: u32) -> f64 {
    crate::monte_carlo_pi(iterations, seed)
}
