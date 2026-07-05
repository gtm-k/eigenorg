//! Team entity property → rate mappings (§3.2) and function coverage (M17).
//!
//! The full team simulator loop is P7a; P3 lands the pure, deterministic rate
//! and coverage functions (in scope: "entities 1–10 → rates; function coverage
//! scoring") so they are unit-tested and ready behind the frozen team API.

use crate::config::{Entity, EntityKind, FUNCTIONS};
use crate::output::Coverage;
use crate::params::Params;
use std::collections::BTreeMap;

/// Attention split (§3.2): humans divide `humanAttentionSpan` across their
/// assigned functions; AI agents are software, not calendars (attention 1).
pub fn attention(e: &Entity, params: &Params) -> f64 {
    match e.kind {
        EntityKind::Ai => 1.0,
        EntityKind::Human => {
            let n = e.functions.len().max(1) as f64;
            (params.p("humanAttentionSpan") / n).min(1.0)
        }
    }
}

/// Ramp factor `ramp_e(t)` (M15): 1 for AI and zero-ramp humans; a linear ramp
/// from `rampStartFactor` to 1 over `rampTimeWeeks × 5` steps otherwise.
pub fn ramp(e: &Entity, t: u32, params: &Params) -> f64 {
    if matches!(e.kind, EntityKind::Ai) || e.ramp_time_weeks == 0.0 {
        return 1.0;
    }
    let start = params.p("rampStartFactor");
    let span_steps = e.ramp_time_weeks * 5.0;
    (start + (1.0 - start) * f64::from(t) / span_steps).min(1.0)
}

/// Execution rate `rate_e = throughput × execPointsPerThroughputPoint × ramp ×
/// availability` (§3.2 / M15).
pub fn exec_rate(e: &Entity, t: u32, params: &Params) -> f64 {
    e.throughput * params.p("execPointsPerThroughputPoint") * ramp(e, t, params) * e.availability
}

fn capability(e: &Entity, f: &str) -> f64 {
    e.capabilities.get(f).copied().unwrap_or(0.0)
}

/// Function coverage map (M17): qualified, attention-and-availability-weighted
/// capability pointed at each function, relative to its team-size-scaled demand.
///
/// §7.2 convention (renderer-facing): `rating` is authoritative — it is derived
/// from the FULL-precision score against the green/amber thresholds BEFORE the
/// two-decimal display rounding of `score`. Renderers (P7b) must show the
/// returned `rating` and must NOT recompute it from the rounded `score`, which
/// could disagree at a threshold boundary (e.g. an unrounded 0.796 rates amber
/// against a 0.8 green threshold, yet rounds to 0.80 — recomputing off that
/// rounded value would wrongly read green).
pub fn function_coverage(entities: &[Entity], params: &Params) -> BTreeMap<String, Coverage> {
    let n_e = entities.len() as f64;
    let green = params.p("coverageGreenThreshold");
    let amber = params.p("coverageAmberThreshold");
    let demand_exec = params.p("functionDemandExecution") * (n_e / 8.0);
    let demand_default = params.p("functionDemandDefault") * (n_e / 8.0);

    let mut out = BTreeMap::new();
    for f in FUNCTIONS {
        let demand = if f == "execution" {
            demand_exec
        } else {
            demand_default
        };
        let supply: f64 = entities
            .iter()
            .filter(|e| e.functions.iter().any(|x| x == f))
            .map(|e| (capability(e, f) / 10.0) * attention(e, params) * e.availability)
            .sum();
        let score = if demand > 0.0 {
            (supply / demand).min(1.0)
        } else {
            0.0
        };
        let rating = if score >= green {
            "green"
        } else if score >= amber {
            "amber"
        } else {
            "red"
        };
        // Two-decimal rounding per §7.2.
        let score = (score * 100.0).round() / 100.0;
        out.insert(
            f.to_string(),
            Coverage {
                score,
                rating: rating.to_string(),
            },
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::EntityKind;
    use std::collections::BTreeMap;

    fn ent(id: &str, kind: EntityKind, funcs: &[&str], caps: &[(&str, f64)]) -> Entity {
        let mut capabilities = BTreeMap::new();
        for (f, c) in caps {
            capabilities.insert((*f).to_string(), *c);
        }
        Entity {
            id: id.to_string(),
            kind,
            archetype: "engineer".to_string(),
            throughput: 5.0,
            judgment_quality: 6.0,
            handoff_friction: 4.0,
            reliability: 8.0,
            ramp_time_weeks: 0.0,
            availability: 1.0,
            functions: funcs.iter().map(|s| s.to_string()).collect(),
            capabilities,
        }
    }

    #[test]
    fn ai_has_full_attention_and_ramp() {
        let p = Params::defaults();
        let mut e = ent("ai", EntityKind::Ai, &["execution", "coordination"], &[]);
        e.throughput = 8.0;
        assert_eq!(attention(&e, &p), 1.0);
        assert_eq!(ramp(&e, 0, &p), 1.0);
        // rate = 8 * 0.2 * 1 * 1 = 1.6
        assert!((exec_rate(&e, 0, &p) - 1.6).abs() < 1e-12);
    }

    #[test]
    fn human_ramp_climbs_to_one() {
        let p = Params::defaults();
        let mut e = ent("h", EntityKind::Human, &["execution"], &[]);
        e.ramp_time_weeks = 4.0; // 20 steps to full
        assert!(ramp(&e, 0, &p) < 1.0);
        assert_eq!(ramp(&e, 100, &p), 1.0, "ramp saturates at 1");
    }

    #[test]
    fn attention_splits_across_human_functions() {
        let p = Params::defaults(); // humanAttentionSpan = 3
        let e = ent("h", EntityKind::Human, &["a", "b", "c", "d"], &[]);
        // 3 / 4 = 0.75
        assert!((attention(&e, &p) - 0.75).abs() < 1e-12);
    }

    #[test]
    fn coverage_rates_uncovered_function_red() {
        let p = Params::defaults();
        let entities = vec![
            ent(
                "e1",
                EntityKind::Human,
                &["execution"],
                &[("execution", 8.0)],
            ),
            ent(
                "e2",
                EntityKind::Human,
                &["execution"],
                &[("execution", 8.0)],
            ),
        ];
        let cov = function_coverage(&entities, &p);
        assert_eq!(cov["review"].rating, "red", "no one covers review");
        assert!(cov["execution"].score > 0.0);
    }
}
