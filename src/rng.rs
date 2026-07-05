//! Deterministic RNG scheme (MODEL.md §8.1, normative).
//!
//! ChaCha8Rng seeded per Monte Carlo iteration from a splitmix64-mixed master
//! seed. No `getrandom`, no wall clock: the only entropy source is the config
//! `seed`, so identical `(config, seed)` yields byte-identical output on the
//! same build (the reproducibility + cross-target-hash contract, §8.1 / T6).
//!
//! Uniforms are drawn from the top 53 bits of `next_u64` and turned into
//! Triangular / Bernoulli draws by inverse-CDF here — the engine never touches
//! `rand`'s distribution machinery, so the bit stream is fully under our control
//! (only a `rand_chacha` MAJOR bump can move it, which per §8.1/§12.6 is a
//! modelVersion MAJOR bump).

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

/// splitmix64 finalizer (MODEL.md §8.1), all-wrapping.
fn splitmix64(seed: u64) -> u64 {
    let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// The per-iteration seed for Monte Carlo iteration `i` (MODEL.md §8.1).
pub fn iteration_seed(master_seed: u64, i: u32) -> u64 {
    splitmix64(master_seed.wrapping_add((i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)))
}

/// The simulation RNG: a thin, deterministic wrapper over ChaCha8Rng.
///
/// Every stochastic draw in the engine goes through exactly one of these
/// methods, so the draw order (part of the §5 contract) is auditable in one
/// place and the uniform-per-event accounting (M8/M19 attribution) is exact.
pub struct SimRng {
    inner: ChaCha8Rng,
}

impl SimRng {
    /// Seed for Monte Carlo iteration `i` from the config master seed.
    pub fn for_iteration(master_seed: u64, i: u32) -> Self {
        Self {
            inner: ChaCha8Rng::seed_from_u64(iteration_seed(master_seed, i)),
        }
    }

    /// A uniform in `[0, 1)` from the top 53 bits of a 64-bit draw.
    pub fn uniform(&mut self) -> f64 {
        // 2^53 is exact in f64; the top 53 bits give a uniform on the dyadic
        // rationals in [0, 1) with no modulo bias.
        const SCALE: f64 = (1u64 << 53) as f64;
        (self.inner.next_u64() >> 11) as f64 / SCALE
    }

    /// Bernoulli(p): fires when `u < p` (MODEL.md §8.2). Consumes one uniform.
    pub fn bernoulli(&mut self, p: f64) -> bool {
        self.uniform() < p
    }

    /// Triangular(a, c, b) = Triangular(min, mode, max) by inverse CDF from one
    /// uniform (MODEL.md §8.2). A degenerate triple (a == b) returns `a`.
    pub fn triangular(&mut self, min: f64, mode: f64, max: f64) -> f64 {
        let u = self.uniform();
        triangular_from_uniform(u, min, mode, max)
    }
}

/// Pure inverse-CDF for Triangular(min, mode, max) at uniform `u` — factored out
/// so mean-path/hand-simulation cross-checks can reuse the exact same math.
pub fn triangular_from_uniform(u: f64, min: f64, mode: f64, max: f64) -> f64 {
    let span = max - min;
    if span <= 0.0 {
        return min;
    }
    let split = (mode - min) / span;
    // libm::sqrt (not f64::sqrt) so the draw is bit-identical native vs wasm.
    if u < split {
        min + libm::sqrt(u * span * (mode - min))
    } else {
        max - libm::sqrt((1.0 - u) * span * (max - mode))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iteration_seeds_are_distinct_and_deterministic() {
        let a0 = iteration_seed(42, 0);
        let a0b = iteration_seed(42, 0);
        let a1 = iteration_seed(42, 1);
        assert_eq!(a0, a0b, "same (seed, i) must give the same iteration seed");
        assert_ne!(a0, a1, "different iterations must differ");
    }

    #[test]
    fn uniforms_are_in_unit_interval_and_reproducible() {
        let mut a = SimRng::for_iteration(42, 0);
        let mut b = SimRng::for_iteration(42, 0);
        for _ in 0..1000 {
            let x = a.uniform();
            assert!((0.0..1.0).contains(&x), "uniform {x} out of [0,1)");
            assert_eq!(x.to_bits(), b.uniform().to_bits(), "streams must match");
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = SimRng::for_iteration(1, 0);
        let mut b = SimRng::for_iteration(2, 0);
        // Overwhelmingly likely to differ within a few draws.
        let mut any_diff = false;
        for _ in 0..8 {
            if a.uniform().to_bits() != b.uniform().to_bits() {
                any_diff = true;
                break;
            }
        }
        assert!(any_diff, "distinct seeds must produce distinct streams");
    }

    #[test]
    fn triangular_stays_within_support_and_respects_mode_split() {
        // Endpoints of the uniform map to the support endpoints.
        assert_eq!(triangular_from_uniform(0.0, 2.0, 2.5, 3.0), 2.0);
        let hi = triangular_from_uniform(0.999_999, 2.0, 2.5, 3.0);
        assert!(
            hi > 2.5 && hi <= 3.0,
            "high uniform lands in upper leg: {hi}"
        );
        // Degenerate triple returns the point.
        assert_eq!(triangular_from_uniform(0.37, 1.0, 1.0, 1.0), 1.0);
        // Every draw stays inside [min, max].
        let mut r = SimRng::for_iteration(7, 3);
        for _ in 0..10_000 {
            let v = r.triangular(5.0, 8.0, 14.0);
            assert!((5.0..=14.0).contains(&v), "triangular {v} out of support");
        }
    }

    #[test]
    fn bernoulli_edges_are_saturated() {
        let mut r = SimRng::for_iteration(9, 0);
        for _ in 0..100 {
            assert!(!r.bernoulli(0.0), "p=0 never fires");
            assert!(r.bernoulli(1.0), "p=1 always fires");
        }
    }
}
