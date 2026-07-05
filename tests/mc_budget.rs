//! Monte Carlo output-size and native-perf budgets (MODEL.md §12.3 / PLAN P3b).

mod common;

use common::{fixture_path, read_fixture};
use eigenorg::engine::run_json;
use std::time::Instant;

#[test]
fn heaviest_output_stays_under_200kb() {
    // Scope (MODEL.md §12.3): the < 200 KB budget covers the SHIPPED scenarios and
    // presets (horizon <= 120 — the heaviest committed config is coordinationCollapse
    // / dunbarCliff at 120). It is a product constraint on shipped content, not a
    // schema bound: a schema-max horizon-600 config carries ~5x the per-step points
    // (~0.6-1 MB) and is deliberately out of this budget's scope. Payload is
    // independent of iteration count (percentiles collapse iterations).
    //
    // Assert the budget over EVERY committed scenario fixture — org AND (since
    // P7a landed the team arm) team — not one hand-picked config, so a
    // newly-added heavy scenario cannot slip past unmeasured (T5).
    let dir = fixture_path("fixtures/scenarios");
    let mut checked_org = 0usize;
    let mut checked_team = 0usize;
    for entry in std::fs::read_dir(&dir).expect("read fixtures/scenarios") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let json = std::fs::read_to_string(&path).unwrap();
        let sim = serde_json::from_str::<serde_json::Value>(&json)
            .unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
            .get("sim")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string();
        let out =
            run_json(&json).unwrap_or_else(|e| panic!("run {}: {}", path.display(), e.to_json()));
        let bytes = serde_json::to_string(&out).unwrap().len();
        assert!(
            bytes < 200 * 1024,
            "{} output {bytes} bytes exceeds the 200 KB budget",
            path.display()
        );
        if sim == "org" {
            checked_org += 1;
        } else {
            checked_team += 1;
        }
    }
    assert!(checked_org > 0, "no org scenario fixtures were checked");
    assert!(
        checked_team >= 7,
        "expected the team fixture set (4 golden twins + 3 preset twins)"
    );
}

#[test]
fn native_500_iterations_under_500ms() {
    // A representative 3-layer org at the default 500 iterations / 60 horizon.
    let cfg = read_fixture("fixtures/scenarios/prioritizationTax__threeLayer.json");
    // Warm up (allocator / branch predictor), then time.
    let _ = run_json(&cfg).unwrap();
    let t0 = Instant::now();
    let out = run_json(&cfg).unwrap();
    let elapsed = t0.elapsed();
    assert_eq!(out.iterations, 500);
    // The <500 ms acceptance budget is a RELEASE metric (CI runs the perf gate
    // via `cargo test --release`). A debug `cargo test` uses a loose sanity
    // bound so a pathological regression still trips, without failing on the
    // ~3-4x debug-build slowdown.
    let budget_ms = if cfg!(debug_assertions) { 4000 } else { 500 };
    println!(
        "500 iterations: {} ms (budget {budget_ms} ms)",
        elapsed.as_millis()
    );
    assert!(
        elapsed.as_millis() < budget_ms,
        "500 iterations took {} ms (> {budget_ms} ms budget)",
        elapsed.as_millis()
    );
}
