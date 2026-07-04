//! FROZEN wasm-bindgen boundary — the ONLY module that touches wasm-bindgen.
//!
//! Compiled exclusively for wasm32 so the engine core stays wasm-free and native
//! `cargo test` needs no wasm toolchain. **The export signatures below are
//! frozen at P3 (CONTRACTS.md).** P5 builds the worker against them; P7a fills in
//! the team arm without changing a signature. Do not add or reshape an export
//! without a contract amendment.
//!
//! Chunked stateful run (one in-flight run per worker, §CONTRACTS):
//!   `begin_run(sim, config_json, seed)` → `run_chunk(n) → completedCount`
//!   → `finalize() → output_json`; `cancel()` drops the run. wasm32 is
//! single-threaded, so the run lives in a `thread_local`. Every export returns a
//! JSON string — an envelope `{ "error": { type, message } }` on failure, or the
//! success payload — so the worker never has to interpret a wasm trap.

use crate::config::Sim;
use crate::engine::{EngineError, Run};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static RUN: RefCell<Option<Run>> = const { RefCell::new(None) };
}

/// Model version string, for the page header and output stamping.
#[wasm_bindgen]
pub fn get_model_version() -> String {
    crate::model_version().to_string()
}

/// Echo round-trip (P2 skeleton surface; retained until P5 rewrites the worker).
#[wasm_bindgen]
pub fn echo(input: &str) -> String {
    crate::echo(input)
}

/// Dummy perf probe (P2 skeleton surface): seeded Monte Carlo pi estimate.
#[wasm_bindgen]
pub fn monte_carlo_pi(iterations: u32, seed: u32) -> f64 {
    crate::monte_carlo_pi(iterations, seed)
}

fn parse_sim(sim: &str) -> Result<Sim, EngineError> {
    match sim {
        "org" => Ok(Sim::Org),
        "team" => Ok(Sim::Team),
        other => Err(EngineError::Validation(format!("unknown sim {other:?}"))),
    }
}

/// `begin_run(sim, config_json, seed)` — set up a run. Replaces any in-flight run
/// (cancel-and-restart). Returns `{ "ok": true, "totalIterations": N }` or an
/// error envelope.
#[wasm_bindgen]
pub fn begin_run(sim: &str, config_json: &str, seed: u64) -> String {
    let result = parse_sim(sim).and_then(|s| Run::begin(s, config_json, seed));
    match result {
        Ok(run) => {
            let total = run.total_iterations();
            RUN.with(|cell| *cell.borrow_mut() = Some(run));
            serde_json::json!({ "ok": true, "totalIterations": total }).to_string()
        }
        Err(e) => {
            RUN.with(|cell| *cell.borrow_mut() = None);
            e.to_json()
        }
    }
}

/// `run_chunk(n)` — run up to `n` more iterations; returns
/// `{ "completedCount": c, "totalIterations": t }` or an error envelope.
#[wasm_bindgen]
pub fn run_chunk(n: u32) -> String {
    RUN.with(|cell| {
        let mut guard = cell.borrow_mut();
        match guard.as_mut() {
            Some(run) => {
                let completed = run.run_chunk(n);
                serde_json::json!({
                    "completedCount": completed,
                    "totalIterations": run.total_iterations()
                })
                .to_string()
            }
            None => EngineError::BadState("run_chunk before begin_run".to_string()).to_json(),
        }
    })
}

/// `finalize()` — aggregate to the output JSON, or an error envelope (including
/// BadState if the run has not completed every iteration).
#[wasm_bindgen]
pub fn finalize() -> String {
    RUN.with(|cell| {
        let guard = cell.borrow();
        match guard.as_ref() {
            Some(run) => match run.finalize() {
                Ok(json) => json,
                Err(e) => e.to_json(),
            },
            None => EngineError::BadState("finalize before begin_run".to_string()).to_json(),
        }
    })
}

/// `cancel()` — drop the in-flight run. A fresh `begin_run` reproduces exactly.
#[wasm_bindgen]
pub fn cancel() {
    RUN.with(|cell| *cell.borrow_mut() = None);
}
