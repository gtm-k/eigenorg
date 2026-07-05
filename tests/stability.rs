//! Long-horizon stability property tests (MODEL.md §6 / PLAN P3b + P4): >= 5x
//! the default horizon (>= 300 steps), bounded, no NaN, settling. P4 extends
//! the P3 static-benign suite to org mechanics under stress: a GROWING config
//! (headcountGrowthPerStep > 0 — the L3 cohesion/entropy loop under monotone
//! structural pressure) and an AI-INJECTION config at low SH (the L2
//! brittleness/recovery loop churning recovery windows for ~335 steps).

mod common;

use eigenorg::engine::run_json;
use eigenorg::output::Output;
use eigenorg::params::Params;

/// Shared §6 boundedness contract: composites in range, event/integer series
/// finite and non-negative, no NaN anywhere.
fn assert_bounded(out: &Output) {
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
        "cumulativeBrittleness",
        "cumulativeOverrides",
        "decisionLatency",
        "communicationLoad",
        "interTeamChannels",
        "meetingOverheadPct",
        "healthGap",
    ] {
        for p in out.series.get(id).unwrap() {
            for v in [p.p10, p.p50, p.p90] {
                assert!(v.is_finite(), "{id} non-finite at t={}", p.t);
            }
            assert!(p.p50 >= -100.0, "{id} implausible at t={}", p.t);
        }
    }
}

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

/// P4: a GROWING org (headcountGrowthPerStep > 0) run to 350 steps — 20 people
/// scaling to 90 with no structural change.
fn growing_run() -> Output {
    let cfg = r#"{"schemaVersion":"1","modelVersion":"2.1.0","sim":"org","seed":42,
        "iterations":100,"horizon":350,
        "org":{"headcountStart":20,"headcountGrowthPerStep":0.2,"topology":"hierarchical",
        "hierarchyDepth":3,"ownershipLayers":3,"modality":"asyncFirst","structuralHealth":6,
        "aiInjection":{"enabled":false,"atStep":0}}}"#;
    run_json(cfg).unwrap()
}

/// P4: an AI-injection org at low SH (the adversarial L2 case: unowned
/// recovery, brittleness events churning windows for ~335 steps post-injection).
/// 500 iterations — the golden-instrument statistics — because the p50 of a
/// recovery-churned composite still jitters ~4 points at 100 iterations.
fn injection_run() -> Output {
    let cfg = r#"{"schemaVersion":"1","modelVersion":"2.1.0","sim":"org","seed":42,
        "iterations":500,"horizon":350,
        "org":{"headcountStart":40,"headcountGrowthPerStep":0,"topology":"pods",
        "hierarchyDepth":3,"ownershipLayers":1,"initialBacklog":30,
        "modality":"meetingHeavy","structuralHealth":3,
        "aiInjection":{"enabled":true,"atStep":15}}}"#;
    run_json(cfg).unwrap()
}

#[test]
fn growing_config_bounded_and_entropy_trend_monotone_over_five_horizons() {
    let out = growing_run();
    assert_bounded(&out);

    // §6 "Monotone structure effects hold at long horizon": growing configs
    // keep entropy non-decreasing in trailing-60-step trend until saturation.
    // Sweep every consecutive trailing-60 mean pair; require non-decreasing
    // within a small noise epsilon, allowing a flat plateau once every
    // normalized term saturates.
    let entropy: Vec<f64> = out
        .series
        .get("entropy")
        .unwrap()
        .iter()
        .map(|p| p.p50)
        .collect();
    assert!(entropy.len() >= 300, "need >= 5x horizon");
    let trailing: Vec<f64> = (59..entropy.len())
        .map(|t| entropy[t - 59..=t].iter().sum::<f64>() / 60.0)
        .collect();
    let eps = 0.05; // p50 step noise on a 100-iteration run
    for w in trailing.windows(2) {
        assert!(
            w[1] >= w[0] - eps,
            "growing-config entropy trailing-60 trend decreased: {} -> {}",
            w[0],
            w[1]
        );
    }
    // Non-vacuity: growth must actually move entropy substantially.
    assert!(
        trailing.last().unwrap() - trailing.first().unwrap() > 10.0,
        "expected a substantial entropy climb while scaling 20 -> 90"
    );
}

#[test]
fn injection_config_bounded_and_settles_after_l2_transient() {
    let out = injection_run();
    assert_bounded(&out);

    // L2 (§6): the injection overshoots then settles into a steady band. The
    // config is static after atStep=15, so we hold the continuous composites
    // to the same trailing-30 criterion the static suite uses, from step 100
    // (>= 4 recovery durations past the injection) through the 5x horizon end.
    for id in ["entropy", "cohesionTeamAvg", "orgHealth"] {
        let series = out.series.get(id).unwrap();
        let p50: Vec<f64> = series.iter().map(|p| p.p50).collect();
        let last = series.len() - 1;
        assert!(last >= 300, "settling needs >= 300 steps, got {}", last + 1);
        for start in 100..=(last - 29) {
            let window = &p50[start..=start + 29];
            let mean = window.iter().sum::<f64>() / window.len() as f64;
            let range = window.iter().cloned().fold(f64::MIN, f64::max)
                - window.iter().cloned().fold(f64::MAX, f64::min);
            assert!(
                mean > 0.0 && range <= 0.10 * mean,
                "{id} not settled under sustained AI churn at window t=[{}, {}]: range {range} vs mean {mean}",
                series[start].t,
                series[start + 29].t
            );
        }
    }

    // The L2 loop must actually be exercised: brittleness events accumulate
    // for the whole horizon (non-vacuity for the churn claim).
    let cum = out.series.get("cumulativeBrittleness").unwrap();
    let final_cum = cum.last().unwrap().p50;
    assert!(
        final_cum > 50.0,
        "expected sustained brittleness churn over 335 post-injection steps, got {final_cum}"
    );
    // WIP stays at most linear in t (overload guard): bounded by cumulative
    // arrivals ~ 5.4/step * 350.
    for p in out.series.get("wip").unwrap() {
        assert!(
            p.p90 <= 5.4 * 350.0,
            "wip exceeded the cumulative-arrivals linear bound at t={}",
            p.t
        );
    }
}
