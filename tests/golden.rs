//! Golden-harness gate (MODEL.md §11 / PLAN P3b + P3c + P4 + P7a).
//!
//! Hard gates: the five `coordinationCollapse` assertions, the 12 org-side v2
//! assertions (§11.8 accountabilityDiffusion, §11.9 committeeInversion, §11.10
//! matrix), the 21 remaining org assertions (P4), AND — since P7a — the team-side
//! assertions: §11.6 hollowMiddle (9, incl. `hmReviewWaitNeutral`) and §11.11
//! reviewBottleneck (5), all GREEN via the generic evaluator.
//! `coordinationCollapse` is the harness-fidelity canary (if it forced any
//! coefficient change the orchestrator would be surfaced, per PLAN); the
//! §11.8–§11.10 bounds were retuned against the engine harness at P3c (seed 42,
//! 500 iters) and the §11.6/§11.11 team bounds — calibrator-proven until P7a —
//! are now RE-PROVEN on the real engine (P7a acceptance; a misfit is a
//! stop-and-surface, never a local retune). The normative exact identities hold
//! (neutral-identity byte-parity + `mxTiebreakerRecovers` exact 1.0 +
//! `hmReviewWaitNeutral` exact [1,1]). v2 golden bounds are FINAL per the
//! mini-G2 decisions (2026-07-04 review-cap + rbThroughputPlateau; 2026-07-07
//! hmBrittlenessSpike ratio -> difference re-anchor, MODEL.md v2.2.0); MODEL.md
//! is not edited here.

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
/// goldens and the §11.6 `hmReviewWaitNeutral` identity are asserted by the P7a
/// tests below (engine-re-proven since P7a; calibrator-proven before it).
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

/// P4 + P7a: the 10 presets (`www/presets/*.json`, browser-fetchable) — 5 org
/// (P4: the §10.1–10.4 + §10.6 scenarios) and 5 team (P7a: the §10.5 + §10.10
/// scenarios plus three archetype-table compositions). One definition, no
/// drift: every preset run config must (a) pass full serde + `validate()`,
/// (b) be VALUE-IDENTICAL to the committed
/// `fixtures/scenarios/<id>__<run>.json` twin the golden harness and the
/// double-validation gate consume, and (c) carry the golden instrument settings
/// (seed 42, 500 iterations). Every run label referenced by that scenario's
/// golden assertions must exist in the preset.
#[test]
fn presets_are_plausible_and_drift_free() {
    let preset_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("www/presets");
    let team_dir = preset_dir.join("team");
    // Org presets are browser-fetchable at www/presets/*.json — P5's org picker
    // reads this flat directory and its share-URL budget covers exactly these.
    // Team presets live in the team/ subdirectory (P7b's team-composer surface),
    // invisible to the org picker's flat readdir; team share-URL budget is a
    // P7b concern (team configs exceed the 2000-char org budget — see BACKLOG).
    let json_files = |dir: &std::path::Path, what: &str| {
        let mut v: Vec<_> = std::fs::read_dir(dir)
            .unwrap_or_else(|_| panic!("{what} must exist"))
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
            // manifest.json is the P7b team-preset INDEX (INT-2), not a preset
            // config — exclude it from the preset count/parse. Every other
            // .json in these directories must still be a valid preset.
            .filter(|p| p.file_name().map(|n| n != "manifest.json").unwrap_or(true))
            .collect();
        v.sort();
        v
    };
    let org_files = json_files(&preset_dir, "www/presets");
    let team_files = json_files(&team_dir, "www/presets/team");
    assert_eq!(org_files.len(), 5, "expected 5 org presets at www/presets/");
    assert_eq!(
        team_files.len(),
        5,
        "expected 5 team presets at www/presets/team/"
    );
    let mut files = org_files;
    files.extend(team_files);

    let assertions = load_assertions();
    let mut org_ids = Vec::new();
    let mut team_ids = Vec::new();
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
        let mut sims = Vec::new();
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
            sims.push(cfg["sim"].as_str().unwrap().to_string());
        }
        assert!(
            sims.windows(2).all(|w| w[0] == w[1]),
            "preset {id} mixes sims"
        );

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
        if sims[0] == "org" {
            org_ids.push(id.to_string());
        } else {
            team_ids.push(id.to_string());
        }
    }
    assert_eq!(
        org_ids,
        vec![
            "coordinationCollapse",
            "dunbarCliff",
            "fasterDysfunction",
            "layerConfigurator",
            "prioritizationTax"
        ],
        "the 5 org presets are the §10.1–10.4 + §10.6 scenarios"
    );
    assert_eq!(
        team_ids,
        vec![
            "allHumanBaseline",
            "autonomousSquad",
            "balancedHybrid",
            "hollowMiddle",
            "reviewBottleneck"
        ],
        "the 5 team presets are §10.5 + §10.10 plus the three archetype compositions"
    );
}

/// P7a: the three non-golden team presets (archetype-table compositions) run
/// end-to-end on the engine — a plausibility smoke, not a golden: every series
/// is finite and bounded where §6 binds it, all 12 §7.2 series and both team
/// blocks are present, and the compositions differ in the direction the model
/// claims (an all-AI squad erodes cohesion below the all-human baseline's and
/// draws lower-quality output than the hybrid team).
#[test]
fn team_composition_presets_run_plausibly() {
    let runs = ["allHumanBaseline", "autonomousSquad", "balancedHybrid"];
    let mut finals: std::collections::BTreeMap<&str, Output> = std::collections::BTreeMap::new();
    for id in runs {
        let out = run_scenario(id, "main");
        assert_eq!(out.series.len(), 12, "{id}: all 12 team series");
        for (sid, series) in &out.series {
            for p in series {
                for v in [p.p10, p.p50, p.p90] {
                    assert!(v.is_finite(), "{id}/{sid} non-finite at t={}", p.t);
                }
            }
        }
        for sid in ["cohesion", "entropyProxy", "orgHealthProxy"] {
            for p in out.series.get(sid).unwrap() {
                assert!(
                    (0.0..=100.0).contains(&p.p50),
                    "{id}/{sid} out of [0,100] at t={}",
                    p.t
                );
            }
        }
        let cov = out.function_coverage.as_ref().unwrap();
        assert_eq!(cov.len(), 7, "{id}: coverage for all seven functions");
        let hist_total: u64 = out
            .quality_histogram
            .as_ref()
            .unwrap()
            .iter()
            .map(|b| b.count)
            .sum();
        assert!(hist_total > 0, "{id}: completions must draw quality");
        finals.insert(id, out);
    }
    // Directional plausibility (M12/M16): the all-AI squad's settled cohesion
    // sits below the all-human baseline's, and its pooled quality mass sits
    // lower than the hybrid team's (autonomous complex/novel judgment loss).
    let last = |o: &Output, s: &str| {
        let v = o.series.get(s).unwrap();
        v.last().unwrap().p50
    };
    assert!(
        last(&finals["autonomousSquad"], "cohesion")
            < last(&finals["allHumanBaseline"], "cohesion"),
        "an all-AI squad must erode cohesion below the all-human baseline"
    );
    let mean_quality = |o: &Output| {
        let bins = o.quality_histogram.as_ref().unwrap();
        let (mut num, mut den) = (0.0, 0.0);
        for b in bins {
            num += (b.lo + b.hi) / 2.0 * b.count as f64;
            den += b.count as f64;
        }
        num / den
    };
    assert!(
        mean_quality(&finals["autonomousSquad"]) < mean_quality(&finals["balancedHybrid"]),
        "autonomous output quality must sit below the hybrid team's"
    );
}

/// P7a hard gate — hollowMiddle on the real engine (seed 42, 500 iterations,
/// ONE default coefficient set): all 9 §11.6 assertions (including the
/// `hmReviewWaitNeutral` M20 neutral identity and the re-anchored
/// `hmBrittlenessSpike`) GREEN via the generic evaluator. hollowMiddle 9/9
/// completes the launch stress suite 5/5.
///
/// **`hmBrittlenessSpike` was re-anchored by mini-G2 #1 (MODEL.md v2.2.0,
/// USER-APPROVED 2026-07-07):** its metric moved from the pointwise ratio
/// `cumulativeBrittleness@hollow / cumulativeBrittleness@humanPm` (`ratioAbove`)
/// — structurally unpassable because the human-PM median is legitimately 0 at
/// every probed seed ({42, 7, 123, 999, 2024}: hollow p50 = 2, humanPm p50 = 0),
/// so the ratio is +inf and the P3 §11.1 hardening fails every ratio-family
/// comparator loudly on a non-finite value — to the pointwise difference
/// `cumulativeBrittleness@hollow - cumulativeBrittleness@humanPm` (`above` 1.5),
/// which is always finite (measured 2.000 on all five seeds). The companion
/// test below now asserts the re-anchored predicate PASSES on the engine.
#[test]
fn hollow_middle_goldens_green() {
    let runs = scenario_runs("hollowMiddle", &["hollow", "humanPm"]);
    let assertions = load_assertions();
    let mut checked = 0;
    for a in assertions.iter().filter(|a| a.scenario == "hollowMiddle") {
        let o = evaluate(a, &runs);
        println!(
            "[p7a-golden] {:<24} {} measured={:.4} bound={} tol={}",
            a.id,
            if o.pass { "pass" } else { "FAIL" },
            o.measured,
            a.bound,
            a.tolerance
        );
        assert!(
            o.pass,
            "hollowMiddle golden {} FAILED: measured {} ({})",
            a.id, o.measured, o.detail
        );
        checked += 1;
    }
    assert_eq!(
        checked, 9,
        "expected all 9 hollowMiddle assertions (incl. the re-anchored hmBrittlenessSpike)"
    );

    // hmReviewWaitNeutral is an EXACT identity, not a tolerance pass: with
    // review capacity unbounded every realized sojourn equals reviewDwellDays,
    // so reviewWaitDays is exactly 1.0 at every step and quantile (M20).
    let hollow = &runs["hollow"];
    for p in hollow.series.get("reviewWaitDays").unwrap() {
        assert_eq!(
            p.p10, 1.0,
            "reviewWaitDays p10 must be exactly 1 at t={}",
            p.t
        );
        assert_eq!(
            p.p50, 1.0,
            "reviewWaitDays p50 must be exactly 1 at t={}",
            p.t
        );
        assert_eq!(
            p.p90, 1.0,
            "reviewWaitDays p90 must be exactly 1 at t={}",
            p.t
        );
    }
}

/// Companion pin for the re-anchored `hmBrittlenessSpike` (mini-G2 #1,
/// MODEL.md v2.2.0, USER-APPROVED 2026-07-07). Asserts the amendment landed
/// (comparator `above`, difference metric) AND that the re-anchored predicate
/// now PASSES on the real engine — the inverse of the earlier surfaced-state
/// pin, which asserted the +inf `ratioAbove` collision. If the golden ever
/// reverts to a ratio form this test fails loudly, re-surfacing the §11.1
/// non-finite contradiction the re-anchor resolved.
#[test]
fn hm_brittleness_spike_reanchored_difference_passes() {
    let runs = scenario_runs("hollowMiddle", &["hollow", "humanPm"]);
    let a = load_assertions()
        .into_iter()
        .find(|a| a.id == "hmBrittlenessSpike")
        .expect("hmBrittlenessSpike exists");
    assert_eq!(
        a.comparator, "above",
        "hmBrittlenessSpike must use the re-anchored finite `above` comparator \
         (mini-G2 #1); a `ratioAbove` here means the re-anchor was reverted and \
         the §11.1 non-finite collision is back"
    );
    assert_eq!(
        a.metric, "cumulativeBrittleness@hollow - cumulativeBrittleness@humanPm",
        "hmBrittlenessSpike must score the pointwise difference, not a ratio"
    );
    let o = evaluate(&a, &runs);
    assert!(
        o.pass,
        "re-anchored hmBrittlenessSpike must PASS on the engine: measured {} ({})",
        o.measured, o.detail
    );
    // Substance: the difference clears the bound at the final step, carried by a
    // strictly positive hollow count (hmBrittlenessFloorMc pins ≥ 1.5), so the
    // pass never depends on the human denominator being any particular value.
    let last = |run: &str, s: &str| {
        runs[run]
            .series_value(s, Quantile::P50, runs[run].horizon - 1)
            .unwrap()
    };
    let hollow = last("hollow", "cumulativeBrittleness");
    let human = last("humanPm", "cumulativeBrittleness");
    assert!(
        hollow - human >= 1.5 && hollow > 0.0,
        "expected hollow - humanPm >= 1.5 with hollow > 0, got hollow={hollow} human={human}"
    );
}

/// P7a hard gate — the v2.0.0 team goldens re-proven on the REAL engine (they
/// were calibrator-proven only until this phase): the 5 §11.11 reviewBottleneck
/// assertions GREEN via the generic evaluator, seed 42, 500 iterations. A bound
/// misfit here is calibrator-vs-engine divergence — a stop-and-surface via the
/// amendment protocol, never a local retune.
#[test]
fn review_bottleneck_goldens_reproven_on_engine() {
    let runs = scenario_runs("reviewBottleneck", &["bottleneck", "unbounded"]);
    let assertions = load_assertions();
    let mut checked = 0;
    for a in assertions
        .iter()
        .filter(|a| a.scenario == "reviewBottleneck")
    {
        let o = evaluate(a, &runs);
        println!(
            "[p7a-golden] {:<24} {} measured={:.4} bound={} tol={}",
            a.id,
            if o.pass { "pass" } else { "FAIL" },
            o.measured,
            a.bound,
            a.tolerance
        );
        assert!(
            o.pass,
            "reviewBottleneck golden {} FAILED: measured {} ({})",
            a.id, o.measured, o.detail
        );
        checked += 1;
    }
    assert_eq!(checked, 5, "expected all 5 reviewBottleneck assertions");
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
