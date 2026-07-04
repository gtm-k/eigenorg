//! Long-horizon stability property tests (MODEL.md §6 / PLAN P3b): >= 5x the
//! default horizon (>= 300 steps), bounded, no NaN, settling.

mod common;

use eigenorg::engine::run_json;
use eigenorg::output::Output;
use eigenorg::params::Params;

/// A static, non-overloaded org (no growth, no AI) run for 350 steps.
fn long_run() -> Output {
    let cfg = r#"{"schemaVersion":"1","modelVersion":"2.0.0","sim":"org","seed":42,
        "iterations":100,"horizon":350,
        "org":{"headcountStart":20,"headcountGrowthPerStep":0,"topology":"hierarchical",
        "hierarchyDepth":3,"ownershipLayers":3,"modality":"asyncFirst","structuralHealth":6,
        "aiInjection":{"enabled":false,"atStep":0}}}"#;
    run_json(cfg).unwrap()
}

#[test]
fn everything_is_bounded_over_five_horizons() {
    let out = long_run();
    let max_tax = Params::defaults().p("maxCoordinationTax");
    let bound = |id: &str, lo: f64, hi: f64| {
        for p in out.series.get(id).unwrap() {
            for v in [p.p10, p.p50, p.p90] {
                assert!(v.is_finite(), "{id} non-finite at t={}", p.t);
                assert!(
                    v >= lo && v <= hi,
                    "{id}={v} out of [{lo},{hi}] at t={}",
                    p.t
                );
            }
        }
    };
    bound("entropy", 0.0, 100.0);
    bound("orgHealth", 0.0, 100.0);
    bound("cohesionTeamAvg", 0.0, 100.0);
    bound("coordinationTax", 0.0, max_tax);
    bound("decisionVelocity", 0.0, 100.0);

    for id in [
        "throughput",
        "wip",
        "overrideRate",
        "brittlenessRate",
        "decisionLatency",
    ] {
        for p in out.series.get(id).unwrap() {
            assert!(
                p.p10.is_finite() && p.p50 >= 0.0,
                "{id} negative/non-finite at t={}",
                p.t
            );
        }
    }
}

#[test]
fn key_composites_settle() {
    let out = long_run();
    // Trailing-30-step p50 range < 10% of the trailing mean (§6 settling).
    for id in ["entropy", "cohesionTeamAvg"] {
        let series = out.series.get(id).unwrap();
        let tail: Vec<f64> = series.iter().rev().take(30).map(|p| p.p50).collect();
        let mean = tail.iter().sum::<f64>() / tail.len() as f64;
        let range = tail.iter().cloned().fold(f64::MIN, f64::max)
            - tail.iter().cloned().fold(f64::MAX, f64::min);
        assert!(
            mean > 0.0 && range <= 0.10 * mean,
            "{id} not settled: trailing range {range} vs 10% of mean {mean}"
        );
    }
}
