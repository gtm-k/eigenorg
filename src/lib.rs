//! eigenorg engine core.
//!
//! The crate root is deliberately wasm-free: everything here compiles and tests
//! on the native target (`cargo test` needs no wasm toolchain). The wasm-bindgen
//! boundary lives in [`api`] and only exists on wasm32 builds.
//!
//! P3 kernel: the config/output schema, the deterministic RNG, the task FSM, the
//! org decision pipeline (M1–M13, M18, M19), the Monte Carlo runner, and the
//! frozen chunked run API. P4 landed the org AI-injection mechanics; P7a landed
//! the team simulator (`mechanics::team` — M9/M11/M12/M14–M18/M20 team-side)
//! behind the same frozen API. `modelVersion` comes from `model/params.json`
//! (the extractor's declaration, §12.6), never a hand-typed constant.

#[cfg(target_arch = "wasm32")]
pub mod api;

pub mod config;
pub mod engine;
pub mod entities;
pub mod goldens;
pub mod mechanics;
pub mod montecarlo;
pub mod output;
pub mod params;
pub mod rng;
pub mod tasks;

/// The engine's model version, declared in MODEL.md's meta block and emitted
/// into `model/params.json` by the extractor (§12.6). The CI pairing gate ties
/// this string to the params.json sha256.
pub fn model_version() -> &'static str {
    params::model_version()
}

/// Echo round-trip (P2 skeleton surface, retained so the walking-skeleton page
/// keeps working until P5 rewrites the worker against the frozen chunked API).
pub fn echo(input: &str) -> String {
    input.to_owned()
}

/// Dummy perf probe: seeded Monte Carlo estimate of pi (P2 skeleton surface).
///
/// Kept for the P2 perf-probe page; the real engine perf path is the Monte Carlo
/// runner ([`montecarlo`]). Deterministic xorshift — no `getrandom`, no wall
/// clock — so it does not disturb the sim RNG contract.
pub fn monte_carlo_pi(iterations: u32, seed: u32) -> f64 {
    if iterations == 0 {
        return 0.0;
    }
    let mut state: u64 = u64::from(seed).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as f64 / (1u64 << 53) as f64
    };
    let mut inside: u32 = 0;
    for _ in 0..iterations {
        let x = next();
        let y = next();
        if x * x + y * y <= 1.0 {
            inside += 1;
        }
    }
    4.0 * f64::from(inside) / f64::from(iterations)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_version_comes_from_params_json() {
        assert_eq!(model_version(), "2.2.0");
    }

    #[test]
    fn echo_round_trips_unchanged() {
        assert_eq!(echo("eigenorg"), "eigenorg");
        assert_eq!(echo("unicode: π ≈ 3.14159 🧭"), "unicode: π ≈ 3.14159 🧭");
    }

    #[test]
    fn pi_probe_is_deterministic_for_a_seed() {
        assert_eq!(
            monte_carlo_pi(500, 42).to_bits(),
            monte_carlo_pi(500, 42).to_bits()
        );
        assert_ne!(
            monte_carlo_pi(500, 1).to_bits(),
            monte_carlo_pi(500, 2).to_bits()
        );
    }
}
