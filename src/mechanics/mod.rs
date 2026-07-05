//! Simulation mechanics (MODEL.md §4/§5).
//!
//! `src/mechanics/` is the numeric-literal-lint scope: every model coefficient
//! is read from [`crate::params`] by id, and the only bare float literals
//! permitted here are the structural identities in the lint allowlist (0.0, 1.0,
//! 2.0, 7.0, 9.0, 10.0, 100.0 — pairwise-channel /2, the sigmoid/clamp
//! identities, the SH→misalignment scale, the /10 cohesion-coupling and ×100
//! index scalings). A smuggled coefficient literal fails `mechanics_has_no_bare_coefficient_literals`.

pub mod org;
pub mod team;

use crate::config::{LayerType, OrgConfig};
use crate::params::Params;
use crate::rng::SimRng;
use crate::tasks::TaskClass;

/// Logistic σ(x) — via `libm::exp` (not `f64::exp`) so band/cohesion shapes are
/// bit-identical native vs wasm (the cross-target hash gate, §8.1 / T6).
pub(crate) fn sigma(x: f64) -> f64 {
    1.0 / (1.0 + libm::exp(-x))
}

/// Cognitive-load band factor `B(n)` (M3): smooth ramps at the four contested
/// band centers, never a cliff. Shared by the org tax (M4) and team tax (M14).
pub(crate) fn cognitive_band(n: f64, params: &Params) -> f64 {
    let bands = [
        ("cognitiveBandInner", "bandPenaltyInner"),
        ("cognitiveBandClose", "bandPenaltyClose"),
        ("cognitiveBandWorking", "bandPenaltyWorking"),
        ("cognitiveBandStable", "bandPenaltyStable"),
    ];
    let width = params.p("bandWidthFactor");
    let mut b = 1.0;
    for (center_id, penalty_id) in bands {
        let center = params.p(center_id);
        b += params.p(penalty_id) * sigma((n - center) / (width * center));
    }
    b
}

/// M9 `shBrittleFactor(SH)`: AI novel-failure amplification at low Structural
/// Health, guardrail at high, linear between. Shared by the org injection path
/// (M11) and the team AI-prioritization path (M9/M11).
pub(crate) fn sh_brittle_factor(sh: f64, params: &Params) -> f64 {
    let low = params.p("aiAmplificationLowSH");
    let high = params.p("aiGuardrailedHighSH");
    let risk = params.p("shRiskThreshold");
    let safe = params.p("shSafeThreshold");
    if sh <= risk {
        low
    } else if sh >= safe {
        high
    } else {
        low + (high - low) * (sh - risk) / (safe - risk)
    }
}

/// Effort draw by task class (M18) — one Triangular uniform.
pub(crate) fn draw_effort(class: TaskClass, params: &Params, rng: &mut SimRng) -> f64 {
    let id = match class {
        TaskClass::Routine => "taskEffortRoutine",
        TaskClass::Complex => "taskEffortComplex",
        TaskClass::Novel => "taskEffortNovel",
    };
    let e = params.tri(id);
    rng.triangular(e[0], e[1], e[2])
}

/// A brittleness recovery window `(duration steps, latency multiplier)` (M10).
/// Owned recovery draws duration only (the multiplier is a point value);
/// unowned draws duration then multiplier — the §5 draw order both sims share.
/// Ownership is the caller's rule: org SH < recoveryOwnershipThreshold; team
/// `recoveryOwner == null`.
pub(crate) fn draw_recovery_window(unowned: bool, params: &Params, rng: &mut SimRng) -> (u32, f64) {
    let dur_tri = if unowned {
        params.tri("recoveryDurationUnownedSteps")
    } else {
        params.tri("recoveryDurationOwnedSteps")
    };
    let duration = rng
        .triangular(dur_tri[0], dur_tri[1], dur_tri[2])
        .round()
        .max(1.0) as u32;
    let mult = if unowned {
        let mt = params.tri("recoveryLatencyMultiplierUnowned");
        rng.triangular(mt[0], mt[1], mt[2])
    } else {
        params.p("recoveryLatencyMultiplierOwned")
    };
    (duration, mult)
}

/// The resolved model factors for one ownership seat (§9.9 type + §4 M19
/// multiplicity), precomputed once per iteration.
#[derive(Clone, Copy, Debug)]
pub struct LayerResolved {
    pub layer: u32,
    pub layer_type: LayerType,
    pub latency_factor: f64,
    pub capacity_factor: f64,
    /// §9.9 relay-fidelity factor feeding the M8 distortion term.
    pub distortion_factor: f64,
    pub novel_exposure: f64,
    /// Accountability multiplicity μ_l (§4 M19).
    pub mu: f64,
    pub tiebreaker: f64,
    /// `1 + overrideDiffusionGain·(μ−1)·(1−tiebreaker)` (M19 override channel).
    pub diffusion_factor: f64,
    /// `1 + muLatencySurchargeRate·(μ−1)·(1−tiebreaker)` (M19 latency channel).
    pub diffusion_latency_factor: f64,
    /// `muWorkDropFraction·(μ−1)·(1−tiebreaker)` (M19 motivation-loss channel).
    pub drop_contribution: f64,
}

fn type_of(org: &OrgConfig, idx0: usize) -> LayerType {
    org.layer_types
        .as_ref()
        .and_then(|t| t.get(idx0).copied())
        .unwrap_or(LayerType::HumanPm)
}

fn latency_factor(t: LayerType, p: &Params) -> f64 {
    match t {
        LayerType::HumanPm => 1.0,
        LayerType::HumanDirector => p.p("layerLatencyFactorDirector"),
        LayerType::AiAgent => p.p("layerLatencyFactorAiAgent"),
        LayerType::Committee => p.p("layerLatencyFactorCommittee"),
    }
}

fn capacity_factor(t: LayerType, p: &Params) -> f64 {
    match t {
        LayerType::HumanPm => 1.0,
        LayerType::HumanDirector => p.p("layerCapacityFactorDirector"),
        LayerType::AiAgent => p.p("layerCapacityFactorAiAgent"),
        LayerType::Committee => p.p("layerCapacityFactorCommittee"),
    }
}

fn distortion_factor(t: LayerType, p: &Params) -> f64 {
    match t {
        LayerType::HumanPm | LayerType::HumanDirector => 1.0,
        LayerType::AiAgent => p.p("layerDistortionFactorAiAgent"),
        LayerType::Committee => p.p("layerDistortionFactorCommittee"),
    }
}

fn novel_exposure(t: LayerType, p: &Params) -> f64 {
    match t {
        LayerType::AiAgent => p.p("layerNovelExposureAiAgent"),
        _ => 0.0,
    }
}

/// Resolve all `L = ownershipLayers` seats (§9.9 factors + §4 M19 multiplicity).
///
/// μ precedence (M19, no `max()`): the matrix seat's intrinsic μ = 2 wins on the
/// terminal layer L; every other seat (including a committee) takes μ from
/// `org.layerOwnerCount` (default 1). At μ = 1 all three diffusion channels are
/// exact no-ops, so the default org reproduces the base model.
pub fn resolve_layers(org: &OrgConfig, params: &Params) -> Vec<LayerResolved> {
    let l = org.ownership_layers as usize;
    let matrix_on = org.matrix.map(|m| m.enabled).unwrap_or(false);
    let matrix_tiebreaker = org.matrix.map(|m| m.tiebreaker).unwrap_or(0.0);
    let gain = params.p("overrideDiffusionGain");
    let surcharge = params.p("muLatencySurchargeRate");
    let drop = params.p("muWorkDropFraction");

    (0..l)
        .map(|idx0| {
            let layer = idx0 as u32 + 1;
            let ty = type_of(org, idx0);
            let is_matrix_seat = matrix_on && idx0 == l - 1;
            let (mu, tiebreaker) = if is_matrix_seat {
                (2.0, matrix_tiebreaker)
            } else {
                let count = org
                    .layer_owner_count
                    .as_ref()
                    .and_then(|c| c.get(idx0).copied())
                    .unwrap_or(1);
                (f64::from(count), 0.0)
            };
            let attenuation = (mu - 1.0) * (1.0 - tiebreaker);
            LayerResolved {
                layer,
                layer_type: ty,
                latency_factor: latency_factor(ty, params),
                capacity_factor: capacity_factor(ty, params),
                distortion_factor: distortion_factor(ty, params),
                novel_exposure: novel_exposure(ty, params),
                mu,
                tiebreaker,
                diffusion_factor: 1.0 + gain * attenuation,
                diffusion_latency_factor: 1.0 + surcharge * attenuation,
                drop_contribution: drop * attenuation,
            }
        })
        .collect()
}

/// Mean over seats `l ∈ 2..=L` of `f(seat)`, or `identity` when `L == 1` (M8/M19
/// aggregates skip the originating layer 1).
pub fn mean_over_upper<F: Fn(&LayerResolved) -> f64>(
    layers: &[LayerResolved],
    identity: f64,
    f: F,
) -> f64 {
    if layers.len() <= 1 {
        return identity;
    }
    let upper = &layers[1..];
    upper.iter().map(&f).sum::<f64>() / upper.len() as f64
}

pub fn layer_type_name(t: LayerType) -> &'static str {
    match t {
        LayerType::HumanPm => "humanPm",
        LayerType::HumanDirector => "humanDirector",
        LayerType::AiAgent => "aiAgent",
        LayerType::Committee => "committee",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Matrix, Modality, Topology};

    fn org(l: u32) -> OrgConfig {
        OrgConfig {
            headcount_start: 20,
            headcount_growth_per_step: 0.0,
            topology: Topology::Hierarchical,
            hierarchy_depth: 3,
            ownership_layers: l,
            layer_types: None,
            layer_owner_count: None,
            matrix: None,
            modality: Modality::AsyncFirst,
            structural_health: 6,
            misalignment: None,
            initial_backlog: None,
            ai_injection: crate::config::AiInjection {
                enabled: false,
                at_step: 0,
            },
        }
    }

    #[test]
    fn single_owner_default_is_the_neutral_identity() {
        let p = Params::defaults();
        let layers = resolve_layers(&org(3), &p);
        for seat in &layers {
            assert_eq!(seat.mu, 1.0);
            assert_eq!(seat.diffusion_factor, 1.0);
            assert_eq!(seat.diffusion_latency_factor, 1.0);
            assert_eq!(seat.drop_contribution, 0.0);
        }
        assert_eq!(mean_over_upper(&layers, 1.0, |s| s.diffusion_factor), 1.0);
    }

    #[test]
    fn explicit_all_ones_equals_default() {
        let p = Params::defaults();
        let mut with_counts = org(3);
        with_counts.layer_owner_count = Some(vec![1, 1, 1]);
        let a = resolve_layers(&org(3), &p);
        let b = resolve_layers(&with_counts, &p);
        for (x, y) in a.iter().zip(b.iter()) {
            assert_eq!(x.diffusion_factor, y.diffusion_factor);
            assert_eq!(x.diffusion_latency_factor, y.diffusion_latency_factor);
        }
    }

    #[test]
    fn co_owned_raises_all_three_channels() {
        let p = Params::defaults();
        let mut co = org(3);
        co.layer_owner_count = Some(vec![3, 3, 3]);
        let layers = resolve_layers(&co, &p);
        // diffusionFactor = 1 + 0.4*(3-1) = 1.8
        assert!((layers[0].diffusion_factor - 1.8).abs() < 1e-12);
        // latency = 1 + 0.35*2 = 1.7
        assert!((layers[0].diffusion_latency_factor - 1.7).abs() < 1e-12);
        assert!(layers[0].drop_contribution > 0.0);
    }

    #[test]
    fn matrix_tiebreaker_one_collapses_to_identity() {
        let p = Params::defaults();
        let mut m = org(2);
        m.matrix = Some(Matrix {
            enabled: true,
            tiebreaker: 1.0,
        });
        let layers = resolve_layers(&m, &p);
        let terminal = layers.last().unwrap();
        assert_eq!(terminal.mu, 2.0, "matrix seat has intrinsic mu=2");
        assert_eq!(
            terminal.diffusion_factor, 1.0,
            "tiebreaker=1 collapses diffusion"
        );
        assert_eq!(terminal.diffusion_latency_factor, 1.0);
    }

    #[test]
    fn matrix_no_tiebreaker_pays_the_surcharge() {
        let p = Params::defaults();
        let mut m = org(2);
        m.matrix = Some(Matrix {
            enabled: true,
            tiebreaker: 0.0,
        });
        let layers = resolve_layers(&m, &p);
        let terminal = layers.last().unwrap();
        assert!((terminal.diffusion_factor - 1.4).abs() < 1e-12);
    }
}
