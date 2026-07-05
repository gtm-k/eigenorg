//! Golden-harness gate (MODEL.md §11 / PLAN P3b + P3c).
//!
//! Hard gates: the five `coordinationCollapse` assertions AND the 12 org-side v2
//! assertions (§11.8 accountabilityDiffusion, §11.9 committeeInversion, §11.10
//! matrix) are GREEN via the generic evaluator. `coordinationCollapse` is the
//! harness-fidelity canary (if it forced any coefficient change the orchestrator
//! would be surfaced, per PLAN); the §11.8–§11.10 bounds are no longer provisional
//! — P3c retuned them against the engine harness (seed 42, 500 iters) and they are
//! hard-asserted here. The normative exact identities hold (neutral-identity
//! byte-parity + the `mxTiebreakerRecovers` exact 1.0). The team-side §11.11
//! reviewBottleneck goldens and the §11.6 `hmReviewWaitNeutral` identity are
//! calibrator-proven only — the engine's team arm is NotImplemented until P7a, so
//! P7a owns their engine assertion. All v2 golden bounds are FINAL per the two
//! mini-G2 decisions (2026-07-04); MODEL.md is not edited here.

mod common;

use common::{run_scenario, scenario_runs, series_bytes};
use eigenorg::goldens::{evaluate, load_assertions};
use eigenorg::output::{Output, Quantile};

/// Final-step p50 value of a series (helper for the §F.4 non-vacuity checks).
fn series_final(o: &Output, series: &str) -> f64 {
    o.series_value(series, Quantile::P50, o.horizon - 1)
        .unwrap_or_else(|| panic!("series {series} missing final step"))
}

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

/// §F.4 pre-lock gate (normative, per M8/M19): full-series byte-identity at
/// defaults (μ=1, matrix off, review unbounded, gradient 0) for the three named
/// configs — `prioritizationTax` (L=3), `dunbarCliff` (the L=2 singleton
/// override-attribution path), `layerConfigurator` (typed seats) — proving the
/// amendment is fully additive AND that the override-attribution step consumes
/// exactly one uniform per event (draw-count/stream parity with v1), INCLUDING
/// the singleton case `{2..L} = {2}` at L=2. Each config is compared against an
/// explicit-neutral twin (`layerOwnerCount` all-1, matrix off); byte-equality of
/// the series payload (version-metadata excluded, §12.4) is the gate. Each config
/// is additionally required to actually PRODUCE overrides so the attribution draw
/// is genuinely in the stream — a byte-parity check over a run with zero override
/// events would be vacuous.
#[test]
fn f4_prelock_neutral_identity_gate() {
    // (1) prioritizationTax, L=3 — explicit twin is accountabilityDiffusion
    // @singleOwner ([1,1,1]); the bare config is prioritizationTax@threeLayer.
    let pt_bare = run_scenario("prioritizationTax", "threeLayer");
    let pt_explicit = run_scenario("accountabilityDiffusion", "singleOwner");
    assert_eq!(
        series_bytes(&pt_bare),
        series_bytes(&pt_explicit),
        "F.4: prioritizationTax@threeLayer must be byte-identical to its explicit [1,1,1] twin"
    );
    assert!(
        series_final(&pt_bare, "cumulativeOverrides") > 0.0,
        "F.4: prioritizationTax must produce overrides (non-vacuous attribution parity)"
    );

    // (2) dunbarCliff, L=2 — the singleton override-attribution path {2..L} = {2}.
    let dc_bare = run_scenario("dunbarCliff", "main");
    let dc_explicit = run_scenario("dunbarCliff", "mainNeutral");
    assert_eq!(
        series_bytes(&dc_bare),
        series_bytes(&dc_explicit),
        "F.4: dunbarCliff@main (L=2) must be byte-identical to its explicit [1,1] twin"
    );
    assert!(
        series_final(&dc_bare, "cumulativeOverrides") > 0.0,
        "F.4: dunbarCliff must produce overrides so the singleton {{2}} attribution draw fires"
    );

    // (3) layerConfigurator — typed seats (aiAgent middle seat).
    let lc_bare = run_scenario("layerConfigurator", "aiMiddle");
    let lc_explicit = run_scenario("layerConfigurator", "aiMiddleNeutral");
    assert_eq!(
        series_bytes(&lc_bare),
        series_bytes(&lc_explicit),
        "F.4: layerConfigurator@aiMiddle (typed seats) must be byte-identical to its explicit [1,1,1] twin"
    );
    assert!(
        series_final(&lc_bare, "cumulativeOverrides") > 0.0,
        "F.4: layerConfigurator must produce overrides (non-vacuous attribution parity)"
    );
    assert!(
        series_final(&lc_bare, "cumulativeBrittleness") > 0.0,
        "F.4: layerConfigurator's aiAgent seat must route novel work into the brittleness path"
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

/// Retuned org-side v2 goldens (§11.8 accountabilityDiffusion, §11.9
/// committeeInversion, §11.10 matrix): after P3c calibration these bounds are FINAL
/// (the two mini-G2 decisions, 2026-07-04) — every predicate must PASS via the
/// engine golden harness (seed 42, 500 iters). The team-side §11.11 reviewBottleneck
/// goldens and the §11.6 `hmReviewWaitNeutral` identity are NOT here: the engine's
/// team arm is NotImplemented until P7a, so they are calibrator-proven only and their
/// engine assertion is owned by P7a (per PLAN). Their bounds are FINAL, not
/// provisional.
#[test]
fn retuned_v2_org_goldens_green() {
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
    let mut checked = 0;
    for (scenario, runs) in scenarios {
        let run_map = scenario_runs(scenario, runs);
        for a in assertions.iter().filter(|a| &a.scenario == scenario) {
            let o = evaluate(a, &run_map);
            println!(
                "[retuned] {:<28} {} measured={:.4} bound={}",
                a.id,
                if o.pass { "pass" } else { "FAIL" },
                o.measured,
                a.bound
            );
            assert!(
                o.pass,
                "retuned org golden {} FAILED: measured {} ({})",
                a.id, o.measured, o.detail
            );
            checked += 1;
        }
    }
    assert_eq!(checked, 12, "expected 4+3+5 = 12 org-side v2 goldens");
}

/// P4: the 5 org presets (`www/presets/*.json`, browser-fetchable) materialize
/// the §10 scenario configs. One definition, no drift: every preset run config
/// must (a) pass full serde + `validate()`, (b) be VALUE-IDENTICAL to the
/// committed `fixtures/scenarios/<id>__<run>.json` twin the golden harness and
/// the double-validation gate consume, and (c) carry the §10-normative golden
/// instrument settings (seed 42, 500 iterations). Every run label referenced by
/// that scenario's golden assertions must exist in the preset.
#[test]
fn org_presets_are_plausible_and_drift_free() {
    let preset_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("www/presets");
    let mut files: Vec<_> = std::fs::read_dir(&preset_dir)
        .expect("www/presets must exist")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
        .collect();
    files.sort();
    assert_eq!(files.len(), 5, "expected exactly 5 org presets");

    let assertions = load_assertions();
    let mut seen_ids = Vec::new();
    for path in &files {
        let text = std::fs::read_to_string(path).unwrap();
        let preset: serde_json::Value = serde_json::from_str(&text).unwrap();
        let id = preset["id"].as_str().expect("preset id");
        assert_eq!(
            path.file_stem().unwrap().to_str().unwrap(),
            id,
            "preset filename must match its id"
        );
        assert!(
            preset["label"]
                .as_str()
                .map(|l| !l.is_empty())
                .unwrap_or(false),
            "preset {id} needs a label"
        );
        let runs = preset["runs"].as_object().expect("preset runs map");

        // (a)+(b)+(c): each run validates, runs on the engine's authoring
        // path, matches its fixture twin, and pins seed 42 / 500 iterations.
        for (run_label, cfg) in runs {
            let cfg_text = serde_json::to_string(cfg).unwrap();
            let parsed: eigenorg::config::Config = serde_json::from_str(&cfg_text)
                .unwrap_or_else(|e| panic!("preset {id}@{run_label} must parse: {e}"));
            parsed
                .validate()
                .unwrap_or_else(|e| panic!("preset {id}@{run_label} must validate: {e}"));
            assert_eq!(cfg["seed"], 42, "preset {id}@{run_label} seed");
            assert_eq!(cfg["iterations"], 500, "preset {id}@{run_label} iterations");
            let fixture: serde_json::Value = serde_json::from_str(&common::read_fixture(&format!(
                "fixtures/scenarios/{id}__{run_label}.json"
            )))
            .unwrap();
            assert_eq!(
                *cfg, fixture,
                "preset {id}@{run_label} drifted from its fixture twin"
            );
        }

        // Golden coverage: every @runLabel this scenario's assertions name
        // exists in the preset.
        for a in assertions.iter().filter(|a| a.scenario == id) {
            for term in a.metric.split(' ') {
                if let Some((_, run)) = term.split_once('@') {
                    assert!(
                        runs.contains_key(run),
                        "preset {id} is missing run {run:?} required by golden {}",
                        a.id
                    );
                }
            }
        }
        seen_ids.push(id.to_string());
    }
    assert_eq!(
        seen_ids,
        vec![
            "coordinationCollapse",
            "dunbarCliff",
            "fasterDysfunction",
            "layerConfigurator",
            "prioritizationTax"
        ],
        "the 5 org presets are the §10.1–10.4 + §10.6 scenarios"
    );
}

/// P4 hard gate: the remaining org-side goldens — §11.3 prioritizationTax (6),
/// §11.4 fasterDysfunction (6, including the monteCarlo visual-separability
/// predicate `fdSeparability`), §11.5 dunbarCliff (5), §11.7 layerConfigurator
/// (4) — GREEN via the generic evaluator, all with the ONE default coefficient
/// set (seed 42, 500 iterations, per §10). With coordinationCollapse (P3) this
/// completes 4/5 of the launch stress suite; hollowMiddle (team) is P7a's.
#[test]
fn remaining_org_goldens_green() {
    let scenarios: &[(&str, &[&str], usize)] = &[
        ("prioritizationTax", &["threeLayer", "oneLayer"], 6),
        (
            "fasterDysfunction",
            &["sh3", "sh7", "sh3NoAi", "sh7NoAi"],
            6,
        ),
        ("dunbarCliff", &["main"], 5),
        ("layerConfigurator", &["aiMiddle", "allHuman"], 4),
    ];
    let assertions = load_assertions();
    for (scenario, runs, expected) in scenarios {
        let run_map = scenario_runs(scenario, runs);
        let mut checked = 0;
        for a in assertions.iter().filter(|a| &a.scenario == scenario) {
            let o = evaluate(a, &run_map);
            println!(
                "[p4-golden] {:<26} {} measured={:.4} bound={} tol={}",
                a.id,
                if o.pass { "pass" } else { "FAIL" },
                o.measured,
                a.bound,
                a.tolerance
            );
            assert!(
                o.pass,
                "org golden {} FAILED: measured {} ({})",
                a.id, o.measured, o.detail
            );
            checked += 1;
        }
        assert_eq!(
            checked, *expected,
            "expected {expected} {scenario} assertions"
        );
    }
}
