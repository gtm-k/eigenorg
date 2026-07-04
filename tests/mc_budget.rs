//! Monte Carlo output-size and native-perf budgets (MODEL.md §12.3 / PLAN P3b).

mod common;

use common::read_fixture;
use eigenorg::engine::run_json;
use std::time::Instant;

#[test]
fn heaviest_output_stays_under_200kb() {
    // The heaviest committed scenario is horizon 120 (coordinationCollapse /
    // dunbarCliff). Payload is independent of iteration count (percentiles
    // collapse iterations), so this bounds the share-URL/output budget (T5).
    let out = run_json(&read_fixture(
        "fixtures/scenarios/coordinationCollapse__main.json",
    ))
    .unwrap();
    let bytes = serde_json::to_string(&out).unwrap().len();
    assert!(
        bytes < 200 * 1024,
        "output {bytes} bytes exceeds the 200 KB budget"
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
