//! Determinism, chunk-partition invariance, and chunked-API state machine
//! (MODEL.md §8.1 / PLAN P3b / PREMORTEM T6).

mod common;

use common::{read_fixture, run_scenario};
use eigenorg::config::Sim;
use eigenorg::engine::{run_json, EngineError, Run};
use eigenorg::output::Output;

fn to_json(o: &Output) -> String {
    serde_json::to_string(o).unwrap()
}

#[test]
fn identical_config_and_seed_is_byte_identical() {
    let a = run_scenario("committeeInversion", "committeeDiffuse");
    let b = run_scenario("committeeInversion", "committeeDiffuse");
    assert_eq!(
        to_json(&a),
        to_json(&b),
        "same (config, seed) -> byte-identical"
    );
}

#[test]
fn different_seed_gives_different_output() {
    let cfg = read_fixture("fixtures/scenarios/accountabilityDiffusion__coOwned.json");
    let a = run_json(&cfg).unwrap();
    let b_cfg = cfg.replace("\"seed\": 42", "\"seed\": 43");
    let b = run_json(&b_cfg).unwrap();
    assert_ne!(
        to_json(&a),
        to_json(&b),
        "different seed -> different output"
    );
}

#[test]
fn extreme_config_stays_finite() {
    // Every structural knob at an extreme corner + max co-owner multiplicity.
    let cfg = r#"{"schemaVersion":"1","modelVersion":"2.0.0","sim":"org","seed":7,
        "iterations":60,"horizon":80,
        "org":{"headcountStart":500,"headcountGrowthPerStep":2,"topology":"federated",
        "hierarchyDepth":6,"ownershipLayers":5,"layerOwnerCount":[8,8,8,8,8],
        "modality":"meetingHeavy","structuralHealth":1,
        "aiInjection":{"enabled":false,"atStep":0}}}"#;
    let out = run_json(cfg).unwrap();
    for (id, series) in &out.series {
        for p in series {
            for v in [p.p10, p.p50, p.p90] {
                assert!(
                    v.is_finite(),
                    "series {id} produced non-finite {v} at t={}",
                    p.t
                );
            }
        }
    }
}

#[test]
fn chunk_partition_is_invariant() {
    let cfg = read_fixture("fixtures/hash/crossTarget.json");
    let seed = 1729u64;

    let mut single_steps = Run::begin(Sim::Org, &cfg, seed).unwrap();
    let total = single_steps.total_iterations();
    for _ in 0..total {
        single_steps.run_chunk(1); // run_chunk(1) x N
    }
    let by_ones = single_steps.finalize().unwrap();

    let mut whole = Run::begin(Sim::Org, &cfg, seed).unwrap();
    whole.run_chunk(total); // run_chunk(N) x 1
    let by_whole = whole.finalize().unwrap();

    let mut odd = Run::begin(Sim::Org, &cfg, seed).unwrap();
    while odd.completed_count() < total {
        odd.run_chunk(31); // a non-default chunk size
    }
    let by_odd = odd.finalize().unwrap();

    // Monolithic native path.
    let monolithic = to_json(&run_json(&cfg).unwrap());

    assert_eq!(by_ones, by_whole, "run_chunk(1)xN == run_chunk(N)x1");
    assert_eq!(by_ones, by_odd, "chunk size 31 == run_chunk(1)xN");
    assert_eq!(by_ones, monolithic, "chunked == monolithic native");
}

#[test]
fn finalize_before_completion_is_bad_state() {
    let cfg = read_fixture("fixtures/hash/crossTarget.json");
    let mut run = Run::begin(Sim::Org, &cfg, 1729).unwrap();
    run.run_chunk(10); // fewer than total
    match run.finalize() {
        Err(EngineError::BadState(_)) => {}
        other => panic!("expected BadState, got {other:?}"),
    }
}

#[test]
fn finalize_is_idempotent_after_completion() {
    let cfg = read_fixture("fixtures/hash/crossTarget.json");
    let mut run = Run::begin(Sim::Org, &cfg, 1729).unwrap();
    run.run_chunk(run.total_iterations());
    let a = run.finalize().unwrap();
    let b = run.finalize().unwrap();
    assert_eq!(a, b, "finalize is a pure read; repeatable");
}

#[test]
fn cancel_and_restart_reproduces_exactly() {
    let cfg = read_fixture("fixtures/hash/crossTarget.json");
    // A partial run, then "cancel" (drop) and begin again from scratch.
    let mut aborted = Run::begin(Sim::Org, &cfg, 1729).unwrap();
    aborted.run_chunk(53);
    drop(aborted);

    let mut fresh = Run::begin(Sim::Org, &cfg, 1729).unwrap();
    fresh.run_chunk(fresh.total_iterations());
    let after_cancel = fresh.finalize().unwrap();

    let monolithic = to_json(&run_json(&cfg).unwrap());
    assert_eq!(
        after_cancel, monolithic,
        "cancel-reset reproduces the fixture"
    );
}

#[test]
fn sim_argument_must_match_config() {
    let cfg = read_fixture("fixtures/hash/crossTarget.json");
    // The fixture is an org config; asking for team is a validation error.
    assert!(matches!(
        Run::begin(Sim::Team, &cfg, 1),
        Err(EngineError::Validation(_))
    ));
}
