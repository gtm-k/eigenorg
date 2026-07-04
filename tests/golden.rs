//! Golden-harness gate (MODEL.md §11 / PLAN P3b).
//!
//! Hard gates: the five `coordinationCollapse` assertions are GREEN via the
//! generic evaluator (the harness-fidelity canary — if this forced any
//! coefficient change the orchestrator would be surfaced, per PLAN), and the
//! normative exact identities hold (neutral-identity byte-parity + the
//! `mxTiebreakerRecovers` exact 1.0). The provisional §11.8–§11.10 v2 bounds are
//! evaluated and REPORTED but not asserted — their bounds are provisional and
//! P3c retunes them; MODEL.md is not edited here.

mod common;

use common::{run_scenario, scenario_runs, series_bytes};
use eigenorg::goldens::{evaluate, load_assertions};

#[test]
fn coordination_collapse_is_green() {
    let runs = scenario_runs("coordinationCollapse", &["main"]);
    let assertions = load_assertions();
    let mut checked = 0;
    for a in assertions
        .iter()
        .filter(|a| a.scenario == "coordinationCollapse")
    {
        let o = evaluate(a, &runs);
        assert!(
            o.pass,
            "coordinationCollapse golden {} FAILED: measured {} ({})",
            a.id, o.measured, o.detail
        );
        checked += 1;
    }
    assert_eq!(checked, 5, "expected all 5 coordinationCollapse assertions");
}

#[test]
fn neutral_identity_byte_parity() {
    // accountabilityDiffusion@singleOwner ([1,1,1]) reproduces prioritizationTax
    // @threeLayer byte-for-byte on the series payload (§11.12).
    let single = run_scenario("accountabilityDiffusion", "singleOwner");
    let three = run_scenario("prioritizationTax", "threeLayer");
    assert_eq!(
        series_bytes(&single),
        series_bytes(&three),
        "singleOwner must be byte-identical to prioritizationTax@threeLayer"
    );

    // An enabled matrix with tiebreaker=1 collapses to the single-boss identity.
    let clear = run_scenario("matrix", "dualBossClearDecider");
    let single_boss = run_scenario("matrix", "singleBoss");
    assert_eq!(
        series_bytes(&clear),
        series_bytes(&single_boss),
        "dualBossClearDecider (tiebreaker=1) must be byte-identical to singleBoss"
    );
}

#[test]
fn matrix_tiebreaker_recovers_is_exact_identity() {
    let runs = scenario_runs("matrix", &["singleBoss", "dualBossClearDecider"]);
    let a = load_assertions()
        .into_iter()
        .find(|a| a.id == "mxTiebreakerRecovers")
        .unwrap();
    let o = evaluate(&a, &runs);
    assert!(
        o.pass,
        "mxTiebreakerRecovers must hold; measured {}",
        o.measured
    );
    assert!(
        (o.measured - 1.0).abs() < 1e-12,
        "tiebreaker=1 is an EXACT identity: ratio must be 1.0, got {}",
        o.measured
    );
}

/// Provisional v2 goldens (§11.8–§11.10): evaluated and reported, not asserted
/// against their provisional bounds (P3c retunes). The gate here is only that
/// every predicate RESOLVES to a finite measurement (the evaluator + metric
/// grammar work end to end).
#[test]
fn provisional_v2_goldens_resolve() {
    let scenarios: &[(&str, &[&str])] = &[
        ("accountabilityDiffusion", &["singleOwner", "coOwned"]),
        (
            "committeeInversion",
            &["committeeDiffuse", "committeeSingle", "allHuman"],
        ),
        (
            "matrix",
            &["singleBoss", "dualBossNoTiebreak", "dualBossClearDecider"],
        ),
    ];
    let assertions = load_assertions();
    for (scenario, runs) in scenarios {
        let run_map = scenario_runs(scenario, runs);
        for a in assertions.iter().filter(|a| &a.scenario == scenario) {
            let o = evaluate(a, &run_map);
            println!(
                "[provisional] {:<28} {} measured={:.4} bound={}",
                a.id,
                if o.pass { "pass" } else { "FAIL" },
                o.measured,
                a.bound
            );
            assert!(
                o.measured.is_finite(),
                "{} must resolve to a finite measurement, got {}",
                a.id,
                o.measured
            );
        }
    }
}
