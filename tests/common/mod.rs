//! Shared helpers for the integration tests: fixture loading + scenario maps.
//!
//! Each test binary compiles this module and uses a subset of the helpers, so
//! unused-in-one-binary warnings are expected and allowed.
#![allow(dead_code)]

use eigenorg::engine::run_json;
use eigenorg::output::Output;
use std::collections::BTreeMap;

pub fn fixture_path(rel: &str) -> String {
    format!("{}/{}", env!("CARGO_MANIFEST_DIR"), rel)
}

pub fn read_fixture(rel: &str) -> String {
    std::fs::read_to_string(fixture_path(rel)).unwrap_or_else(|e| panic!("read fixture {rel}: {e}"))
}

/// Run a scenario fixture `<scenario>__<run>.json` from `fixtures/scenarios/`.
pub fn run_scenario(scenario: &str, run: &str) -> Output {
    let json = read_fixture(&format!("fixtures/scenarios/{scenario}__{run}.json"));
    run_json(&json).unwrap_or_else(|e| panic!("run {scenario}/{run}: {}", e.to_json()))
}

/// Build the `runLabel -> Output` map a golden scenario needs.
pub fn scenario_runs(scenario: &str, runs: &[&str]) -> BTreeMap<String, Output> {
    runs.iter()
        .map(|r| (r.to_string(), run_scenario(scenario, r)))
        .collect()
}

/// Byte-canonical form of the series payload (version-metadata excluded), for
/// the neutral-identity byte-parity checks (§12.4).
pub fn series_bytes(o: &Output) -> String {
    serde_json::to_string(&o.series).unwrap()
}
