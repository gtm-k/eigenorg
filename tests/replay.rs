//! Explicit `replay` flag semantics (F1 — replaces the removed replay-by-cardinality
//! heuristic).
//!
//! `replay == true` skips `paramOverrides` current-range membership ONLY; every other
//! guard (unknown key, NaN/Inf finiteness, value shape, joint constraints, and the μ ≤ 8
//! structural ceiling in `validate()`) still holds. `replay` absent/false is full
//! authoring validation — including for a `paramOverrides` map that happens to cover the
//! whole parameter set (the case the old cardinality heuristic wrongly waved through).

mod common;

use common::{read_fixture, run_scenario};
use eigenorg::engine::{run_json, EngineError};
use eigenorg::output::Quantile;
use eigenorg::params::{ParamValue, Params};
use serde_json::json;
use std::collections::BTreeMap;

/// An L=1 flat org config carrying `paramOverrides` + the `replay` flag.
fn org_l1(overrides: serde_json::Value, replay: bool) -> String {
    json!({
        "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
        "iterations": 50, "horizon": 10,
        "replay": replay,
        "paramOverrides": overrides,
        "org": { "headcountStart": 12, "headcountGrowthPerStep": 0, "topology": "flat",
            "hierarchyDepth": 2, "ownershipLayers": 1, "modality": "meetingHeavy",
            "structuralHealth": 6, "aiInjection": { "enabled": false, "atStep": 0 } }
    })
    .to_string()
}

/// An L=3 org with an explicit `layerOwnerCount` and the `replay` flag (for the
/// μ-ceiling test).
fn org_l3_counts(counts: serde_json::Value, replay: bool) -> String {
    json!({
        "schemaVersion": "1", "modelVersion": "2.0.0", "sim": "org", "seed": 42,
        "iterations": 50, "horizon": 10,
        "replay": replay,
        "org": { "headcountStart": 20, "headcountGrowthPerStep": 0, "topology": "hierarchical",
            "hierarchyDepth": 3, "ownershipLayers": 3, "layerOwnerCount": counts,
            "modality": "asyncFirst", "structuralHealth": 6,
            "aiInjection": { "enabled": false, "atStep": 0 } }
    })
    .to_string()
}

/// The full default coefficient set as a `paramOverrides` value, with one point
/// coefficient forced out of its declared range (`layerFrictionFactor` ∈ [0.2, 0.6]).
fn full_set_with_out_of_range() -> serde_json::Value {
    let mut full = Params::defaults().resolved_map().clone();
    full.insert("layerFrictionFactor".to_string(), ParamValue::Point(0.9));
    serde_json::to_value(&full).unwrap()
}

#[test]
fn authored_full_set_map_enforces_range() {
    // (a) An authored (replay:false) map that covers the whole parameter set with one
    // out-of-range value is a Validation error — the old cardinality heuristic wrongly
    // treated a full-set map as a replay and skipped this check.
    let cfg = org_l1(full_set_with_out_of_range(), false);
    assert!(
        matches!(run_json(&cfg).unwrap_err(), EngineError::Validation(_)),
        "authored full-set map with an out-of-range value must be rejected"
    );
}

#[test]
fn replay_full_set_skips_range_membership() {
    // (b) The identical full-set map with the same out-of-range value runs under
    // replay:true (range membership skipped, embedded numbers honored).
    let cfg = org_l1(full_set_with_out_of_range(), true);
    let out = run_json(&cfg).expect("replay skips range membership");
    assert_eq!(
        out.resolved_params["layerFrictionFactor"],
        ParamValue::Point(0.9)
    );
}

#[test]
fn replay_accepts_a_partial_map_with_defaults_for_missing_keys() {
    // (c) A replay with only a PARTIAL override map runs; the missing keys fall back to
    // the current defaults (an old link that predates a later-added param replays with
    // that param at its default).
    let cfg = org_l1(json!({ "layerFrictionFactor": 0.9 }), true);
    let out = run_json(&cfg).expect("replay accepts a partial overrides map");
    assert_eq!(
        out.resolved_params["layerFrictionFactor"],
        ParamValue::Point(0.9)
    );
    // A key absent from the override map is present at its default value.
    assert_eq!(
        out.resolved_params["channelCostFraction"],
        ParamValue::Point(0.036),
        "missing keys replay at the current default"
    );
}

#[test]
fn replay_still_rejects_unknown_key() {
    // (d.i) An unknown paramOverrides key is a structure error even on replay.
    let cfg = org_l1(json!({ "notARealParam": 1.0 }), true);
    assert!(matches!(
        run_json(&cfg).unwrap_err(),
        EngineError::Validation(_)
    ));
}

#[test]
fn replay_still_rejects_nan() {
    // (d.ii) NaN cannot travel through JSON, so the finiteness guard is proven at the
    // resolve boundary — the only path a non-finite override could reach the engine.
    let mut nan = BTreeMap::new();
    nan.insert(
        "layerFrictionFactor".to_string(),
        ParamValue::Point(f64::NAN),
    );
    assert!(
        Params::resolve(&nan, true).is_err(),
        "replay still rejects a non-finite override value"
    );
}

#[test]
fn replay_still_rejects_mu_over_8() {
    // (d.iii) μ ≤ 8 is a structural safety ceiling enforced at both authoring and
    // replay; a layerOwnerCount entry of 9 is rejected regardless of the flag.
    let cfg = org_l3_counts(json!([9, 1, 1]), true);
    assert!(
        matches!(run_json(&cfg).unwrap_err(), EngineError::Validation(_)),
        "μ > 8 is rejected even under replay"
    );
}

#[test]
fn in_range_override_changes_org_output_in_the_expected_direction() {
    // F3: an in-range, single-key authored override on prioritizationTax@threeLayer
    // (L=3) changes the output series in the direction M7 dictates. decisionVelocity =
    // 100 / ((1 + (L−1)·layerFrictionFactor) · …), so raising layerFrictionFactor from
    // its 0.35 default to 0.5 (∈ [0.2, 0.6]) strictly lowers decisionVelocity.
    let base = run_scenario("prioritizationTax", "threeLayer");
    let mut cfg: serde_json::Value = serde_json::from_str(&read_fixture(
        "fixtures/scenarios/prioritizationTax__threeLayer.json",
    ))
    .unwrap();
    cfg["paramOverrides"] = json!({ "layerFrictionFactor": 0.5 });
    let over = run_json(&cfg.to_string()).unwrap();

    let step = base.horizon - 1;
    let base_v = base
        .series_value("decisionVelocity", Quantile::P50, step)
        .unwrap();
    let over_v = over
        .series_value("decisionVelocity", Quantile::P50, step)
        .unwrap();
    assert_ne!(base_v, over_v, "an applied override must change the series");
    assert!(
        over_v < base_v,
        "higher layerFrictionFactor lowers decisionVelocity (M7): {over_v} !< {base_v}"
    );
}
