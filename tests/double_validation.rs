//! Double-validation — serde half (PLAN P3 gate).
//!
//! Every committed fixture must pass BOTH serde+`validate()` (here) AND ajv
//! against `docs/schema/config.v1.schema.json` (`www/js/tests/`). A fixture
//! accepted by exactly one is a schema/type drift (T3). Valid fixtures live in
//! `fixtures/scenarios/` + `fixtures/hash/`; deliberately invalid ones in
//! `fixtures/invalid/` must be rejected by BOTH validators.

use eigenorg::config::Config;
use eigenorg::engine::{run_json, EngineError};
use std::path::{Path, PathBuf};

fn manifest(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
        .collect();
    v.sort();
    v
}

/// serde deserialize + structural `validate()` — the "accept" predicate.
fn accepts(path: &Path) -> bool {
    let text = std::fs::read_to_string(path).unwrap();
    match serde_json::from_str::<Config>(&text) {
        Ok(cfg) => cfg.validate().is_ok(),
        Err(_) => false,
    }
}

#[test]
fn all_valid_fixtures_pass_serde_and_validate() {
    let mut count = 0;
    for dir in ["fixtures/scenarios", "fixtures/hash"] {
        for path in json_files(&manifest(dir)) {
            assert!(
                accepts(&path),
                "valid fixture rejected by serde/validate: {}",
                path.display()
            );
            count += 1;
        }
    }
    assert!(
        count >= 12,
        "expected the full committed fixture set, saw {count}"
    );
}

#[test]
fn all_invalid_fixtures_are_rejected() {
    let files = json_files(&manifest("fixtures/invalid"));
    assert!(!files.is_empty(), "expected invalid fixtures");
    for path in files {
        assert!(
            !accepts(&path),
            "invalid fixture wrongly accepted: {}",
            path.display()
        );
    }
}

/// Full authoring rejection: serde + `validate()` + `paramOverrides` resolution
/// (via `run_json`). The `paramOverrides` membership check lives in
/// `Params::resolve`, not the structural `validate()`, so the serde-only corpus is
/// scored through the whole authoring stack rather than `accepts()` alone.
fn rejected_by_full_authoring(path: &Path) -> bool {
    let text = std::fs::read_to_string(path).unwrap();
    matches!(run_json(&text), Err(EngineError::Validation(_)))
}

#[test]
fn serde_only_invalid_fixtures_are_rejected_by_full_authoring() {
    // These encode cross-field or params-membership constraints that ajv (JSON Schema
    // draft-07) cannot express: a fraction sum, an array length bound to another
    // field's value, the matrix-target seat rule, a `recoveryOwner` entity-id
    // back-reference, and a `paramOverrides` key that must exist in params.json. ajv
    // ACCEPTS them (the JS mirror asserts this; the asymmetry is documented in
    // CONTRACTS.md §1), so they cannot live in `fixtures/invalid/` — but the Rust
    // authoring stack must reject every one.
    let files = json_files(&manifest("fixtures/invalid_serde_only"));
    assert!(!files.is_empty(), "expected serde-only invalid fixtures");
    for path in files {
        assert!(
            rejected_by_full_authoring(&path),
            "serde-only invalid fixture wrongly accepted by full authoring validation: {}",
            path.display()
        );
    }
}
