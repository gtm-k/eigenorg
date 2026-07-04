//! Double-validation — serde half (PLAN P3 gate).
//!
//! Every committed fixture must pass BOTH serde+`validate()` (here) AND ajv
//! against `docs/schema/config.v1.schema.json` (`www/js/tests/`). A fixture
//! accepted by exactly one is a schema/type drift (T3). Valid fixtures live in
//! `fixtures/scenarios/` + `fixtures/hash/`; deliberately invalid ones in
//! `fixtures/invalid/` must be rejected by BOTH validators.

use eigenorg::config::Config;
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
