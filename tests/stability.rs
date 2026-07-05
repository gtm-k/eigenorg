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
fn key_composites_settle_and_stay() {
    let out = long_run();
    // §6 settling contract: the continuous composite series it binds — `entropy`,
    // `cohesionTeamAvg`, and `orgHealth = 100 − entropy` — reach a steady band
    // (trailing-30-step p50 range < 10% of the trailing mean) by step 100 and STAY
    // there through the 5× horizon end.
    //
    // Assert EVERY trailing-30 window lying inside the settled region [100, last] —
    // i.e. every window whose earliest step is >= 100, sliding from [100, 129] to the
    // final window ending at `last` — not just the single final window. A window that
    // reaches back before step 100 would be probing the initial settling transient,
    // which §6 does not claim is flat: it only promises the band is REACHED by step 100
    // and STAYS after. (entropy still climbs from ~36 at step 71 to ~42 at step 100, so
    // a window ending at 100 has a wide range by construction; from step 100 onward it
    // is flat.) Sweeping every window across [100, last] catches a mid-horizon drift or
    // oscillation that a single settled tail window would miss.
    for id in ["entropy", "cohesionTeamAvg", "orgHealth"] {
        let series = out.series.get(id).unwrap();
        let p50: Vec<f64> = series.iter().map(|p| p.p50).collect();
        let last = series.len() - 1;
        // Guard against a vacuous pass if the horizon is ever shortened below the §6
        // minimum (>= 5× the default 60-step horizon = >= 300 steps).
        assert!(
            last >= 300,
            "settling test needs a >=300-step run to bind §6; got {} steps",
            last + 1
        );
        for start in 100..=(last - 29) {
            let window = &p50[start..=start + 29];
            let mean = window.iter().sum::<f64>() / window.len() as f64;
            let range = window.iter().cloned().fold(f64::MIN, f64::max)
                - window.iter().cloned().fold(f64::MAX, f64::min);
            assert!(
                mean > 0.0 && range <= 0.10 * mean,
                "{id} not settled at trailing-30 window t=[{}, {}]: range {range} vs 10% of mean {mean}",
                series[start].t,
                series[start + 29].t
            );
        }
    }
}
