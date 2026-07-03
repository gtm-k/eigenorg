//! eigenorg engine core.
//!
//! This crate root is deliberately wasm-free: everything here compiles and
//! tests on the native target (`cargo test` needs no wasm toolchain). The
//! wasm-bindgen boundary lives in [`api`] and only exists on wasm32 builds.
//!
//! P2 walking-skeleton scope: a version string, an echo round-trip, and a
//! dummy Monte Carlo pi probe used as the earliest read on the perf budget.
//! Real mechanics arrive in P3+ per MODEL.md.

#[cfg(target_arch = "wasm32")]
pub mod api;

/// Placeholder engine version for the walking skeleton.
///
/// The real `modelVersion` is declared in MODEL.md and emitted into
/// `model/params.json` by the extractor (P1); P3 wires it through here.
pub const MODEL_VERSION: &str = "0.0.0-p2-skeleton";

/// Returns the engine's model version string.
pub fn model_version() -> &'static str {
    MODEL_VERSION
}

/// Echo round-trip: returns the input unchanged.
///
/// Exists so the walking skeleton can prove a string survives the
/// JS -> wasm -> JS boundary byte-for-byte.
pub fn echo(input: &str) -> String {
    input.to_owned()
}

/// Dummy perf probe: seeded Monte Carlo estimate of pi.
///
/// Deterministic (xorshift64* — no `getrandom`, no wall clock, per the
/// determinism standing rule; P3 replaces this with the real rand_chacha
/// scheme). 500 iterations is the walking-skeleton probe size; the caller
/// times the call to get the earliest read on the <1.5 s simulation budget.
pub fn monte_carlo_pi(iterations: u32, seed: u32) -> f64 {
    if iterations == 0 {
        return 0.0;
    }
    let mut state: u64 = u64::from(seed).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        // Top 53 bits -> uniform f64 in [0, 1).
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
    fn model_version_is_nonempty_and_named() {
        assert!(!model_version().is_empty());
        assert!(model_version().contains("skeleton"));
    }

    #[test]
    fn echo_round_trips_unchanged() {
        assert_eq!(echo("eigenorg"), "eigenorg");
        assert_eq!(echo(""), "");
        assert_eq!(echo("unicode: π ≈ 3.14159 🧭"), "unicode: π ≈ 3.14159 🧭");
    }

    #[test]
    fn pi_probe_is_deterministic_for_a_seed() {
        let a = monte_carlo_pi(500, 42);
        let b = monte_carlo_pi(500, 42);
        assert_eq!(a.to_bits(), b.to_bits());
    }

    #[test]
    fn pi_probe_differs_across_seeds() {
        assert_ne!(
            monte_carlo_pi(500, 1).to_bits(),
            monte_carlo_pi(500, 2).to_bits()
        );
    }

    #[test]
    fn pi_probe_is_in_a_plausible_band_at_500_iterations() {
        // 500 iterations is coarse; ±0.25 is a generous but real sanity band.
        let estimate = monte_carlo_pi(500, 42);
        assert!(
            (estimate - std::f64::consts::PI).abs() < 0.25,
            "estimate {estimate} too far from pi"
        );
    }

    #[test]
    fn pi_probe_zero_iterations_is_finite() {
        assert_eq!(monte_carlo_pi(0, 42), 0.0);
    }
}
