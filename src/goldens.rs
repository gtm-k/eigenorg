//! Generic golden-predicate evaluator (MODEL.md §11).
//!
//! A single evaluator over `model/goldens.json` implementing exactly the §11.1
//! comparator vocabulary and metric grammar — no scenario-specific logic, no
//! hand-transcribed assertions (S5). The scenario CONFIGS are supplied by the
//! caller (test fixtures transcribed from §10; P4/P7a presets are the canonical
//! materialization), so this module only knows how to read predicates and score
//! `Output` objects. Instrument mapping (§8.4): `meanPath` → p50 series,
//! `monteCarlo` → the band quantile named by the metric suffix (default p50) —
//! both reduce to "quantile = suffix if present, else p50".

use crate::output::{Output, Quantile};
use serde::Deserialize;
use std::collections::BTreeMap;

const GOLDENS_JSON: &str = include_str!("../model/goldens.json");

#[derive(Deserialize)]
struct GoldensFile {
    assertions: Vec<Assertion>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Assertion {
    pub id: String,
    pub scenario: String,
    pub metric: String,
    pub comparator: String,
    #[serde(default)]
    pub predicate: String,
    pub bound: serde_json::Value,
    #[serde(default)]
    pub tolerance: f64,
    pub step: serde_json::Value,
    pub instrument: String,
}

/// The result of scoring one assertion.
#[derive(Clone, Debug)]
pub struct Outcome {
    pub id: String,
    pub pass: bool,
    pub measured: f64,
    pub detail: String,
}

/// All 52 assertions, in document order (§12.7 goldens.json shape).
pub fn load_assertions() -> Vec<Assertion> {
    let file: GoldensFile =
        serde_json::from_str(GOLDENS_JSON).expect("model/goldens.json must parse (include_str!)");
    file.assertions
}

enum StepSpec {
    Final,
    At(u32),
    Window(u32, u32),
}

fn parse_step(v: &serde_json::Value) -> StepSpec {
    if v.is_null() {
        StepSpec::Final
    } else if let Some(n) = v.as_u64() {
        StepSpec::At(n as u32)
    } else if let Some(arr) = v.as_array() {
        StepSpec::Window(
            arr[0].as_u64().unwrap() as u32,
            arr[1].as_u64().unwrap() as u32,
        )
    } else {
        StepSpec::Final
    }
}

/// Split a term `series[.p10|.p50|.p90]@run` (or a scalar block path) into its
/// series id, quantile, and run label.
fn parse_term(term: &str) -> Option<(String, Quantile, String)> {
    let (left, run) = term.split_once('@')?;
    let (series, q) = if let Some(base) = left.strip_suffix(".p10") {
        (base, Quantile::P10)
    } else if let Some(base) = left.strip_suffix(".p50") {
        (base, Quantile::P50)
    } else if let Some(base) = left.strip_suffix(".p90") {
        (base, Quantile::P90)
    } else {
        (left, Quantile::P50)
    };
    Some((series.to_string(), q, run.to_string()))
}

fn run_of<'a>(runs: &'a BTreeMap<String, Output>, run: &str) -> Option<&'a Output> {
    runs.get(run)
}

/// Value of a single term at a specific step (series) or block scalar.
fn term_value(term: &str, runs: &BTreeMap<String, Output>, step: u32) -> Option<f64> {
    let (series, q, run) = parse_term(term)?;
    let out = run_of(runs, &run)?;
    if series.starts_with("functionCoverage") {
        out.scalar_path(&series)
    } else {
        out.series_value(&series, q, step)
    }
}

fn term_value_q(
    term: &str,
    runs: &BTreeMap<String, Output>,
    step: u32,
    q: Quantile,
) -> Option<f64> {
    let (series, _, run) = parse_term(term)?;
    let out = run_of(runs, &run)?;
    out.series_value(&series, q, step)
}

fn ratio(a: f64, b: f64) -> f64 {
    if b == 0.0 {
        if a > 0.0 {
            f64::INFINITY
        } else {
            f64::NAN
        }
    } else {
        a / b
    }
}

/// Value of a metric expression (single term, ` / ` ratio, or ` - ` difference)
/// at a step.
fn expr_at(metric: &str, runs: &BTreeMap<String, Output>, step: u32) -> Option<f64> {
    if let Some((a, b)) = metric.split_once(" / ") {
        Some(ratio(
            term_value(a, runs, step)?,
            term_value(b, runs, step)?,
        ))
    } else if let Some((a, b)) = metric.split_once(" - ") {
        Some(term_value(a, runs, step)? - term_value(b, runs, step)?)
    } else {
        term_value(metric, runs, step)
    }
}

fn window_mean(metric: &str, runs: &BTreeMap<String, Output>, a: u32, b: u32) -> Option<f64> {
    let mut sum = 0.0;
    let mut n = 0u32;
    for s in a..=b {
        sum += expr_at(metric, runs, s)?;
        n += 1;
    }
    if n == 0 {
        None
    } else {
        Some(sum / f64::from(n))
    }
}

/// Horizon of the run named by the metric's first term (for `step: null`).
fn horizon_of(metric: &str, runs: &BTreeMap<String, Output>) -> Option<u32> {
    let first = metric
        .split([' '])
        .find(|s| s.contains('@'))
        .unwrap_or(metric);
    let (_, _, run) = parse_term(first)?;
    Some(run_of(runs, &run)?.horizon)
}

/// The scalar value the comparator scores, given the step spec (§11.1: null →
/// final, number → that step, window → mean).
fn value_for(metric: &str, runs: &BTreeMap<String, Output>, step: &StepSpec) -> Option<f64> {
    match step {
        StepSpec::Final => expr_at(metric, runs, horizon_of(metric, runs)?.saturating_sub(1)),
        StepSpec::At(s) => expr_at(metric, runs, *s),
        StepSpec::Window(a, b) => window_mean(metric, runs, *a, *b),
    }
}

fn fail(id: &str, detail: impl Into<String>) -> Outcome {
    Outcome {
        id: id.to_string(),
        pass: false,
        measured: f64::NAN,
        detail: detail.into(),
    }
}

/// Score one assertion against the runs of its scenario.
pub fn evaluate(a: &Assertion, runs: &BTreeMap<String, Output>) -> Outcome {
    let tol = a.tolerance;
    let step = parse_step(&a.step);
    match a.comparator.as_str() {
        "above" | "scalarAbove" => {
            let bound = a.bound.as_f64().unwrap_or(f64::NAN);
            match value_for(&a.metric, runs, &step) {
                Some(v) if !v.is_nan() => {
                    let pass = v >= bound * (1.0 - tol);
                    outcome(&a.id, pass, v, format!(">= {}", bound * (1.0 - tol)))
                }
                _ => fail(&a.id, "metric unresolved"),
            }
        }
        "below" | "scalarBelow" => {
            let bound = a.bound.as_f64().unwrap_or(f64::NAN);
            match value_for(&a.metric, runs, &step) {
                Some(v) if !v.is_nan() => {
                    let pass = v <= bound * (1.0 + tol);
                    outcome(&a.id, pass, v, format!("<= {}", bound * (1.0 + tol)))
                }
                _ => fail(&a.id, "metric unresolved"),
            }
        }
        "within" => {
            let arr = a.bound.as_array();
            let (lo, hi) = match arr {
                Some(b) if b.len() == 2 => (b[0].as_f64().unwrap(), b[1].as_f64().unwrap()),
                _ => return fail(&a.id, "within bound must be [lo, hi]"),
            };
            match value_for(&a.metric, runs, &step) {
                Some(v) if !v.is_nan() => {
                    let pass = v >= lo * (1.0 - tol) && v <= hi * (1.0 + tol);
                    outcome(
                        &a.id,
                        pass,
                        v,
                        format!("in [{}, {}]", lo * (1.0 - tol), hi * (1.0 + tol)),
                    )
                }
                _ => fail(&a.id, "metric unresolved"),
            }
        }
        "ratioAbove" => {
            let bound = a.bound.as_f64().unwrap_or(f64::NAN);
            match value_for(&a.metric, runs, &step) {
                // A non-finite ratio is degenerate — 0/0 (NaN) or x/0 (+inf). Both
                // FAIL loudly rather than silently satisfying `ratioAbove` (§11.1).
                Some(v) if v.is_finite() => outcome(
                    &a.id,
                    v >= bound * (1.0 - tol),
                    v,
                    format!(">= {}", bound * (1.0 - tol)),
                ),
                _ => fail(
                    &a.id,
                    "ratio non-finite (0/0 NaN or x/0 +inf) or unresolved",
                ),
            }
        }
        "ratioBelow" => {
            let bound = a.bound.as_f64().unwrap_or(f64::NAN);
            match value_for(&a.metric, runs, &step) {
                // A non-finite ratio fails loudly (a zero-denominator +inf must not
                // silently pass `ratioBelow` either) (§11.1).
                Some(v) if v.is_finite() => outcome(
                    &a.id,
                    v <= bound * (1.0 + tol),
                    v,
                    format!("<= {}", bound * (1.0 + tol)),
                ),
                _ => fail(
                    &a.id,
                    "ratio non-finite (0/0 NaN or x/0 +inf) or unresolved",
                ),
            }
        }
        "riseAtLeast" | "dropAtLeast" | "growthRatioAbove" => {
            let (from, to) = match step {
                StepSpec::Window(a, b) => (a, b),
                _ => return fail(&a.id, "endpoint comparator needs step [from, to]"),
            };
            let bound = a.bound.as_f64().unwrap_or(f64::NAN);
            let (Some(vf), Some(vt)) =
                (expr_at(&a.metric, runs, from), expr_at(&a.metric, runs, to))
            else {
                return fail(&a.id, "endpoint unresolved");
            };
            let (measured, pass) = match a.comparator.as_str() {
                "riseAtLeast" => (vt - vf, (vt - vf) >= bound * (1.0 - tol)),
                "dropAtLeast" => (vf - vt, (vf - vt) >= bound * (1.0 - tol)),
                _ => (ratio(vt, vf), ratio(vt, vf) >= bound * (1.0 - tol)),
            };
            outcome(
                &a.id,
                pass,
                measured,
                format!("target {}", bound * (1.0 - tol)),
            )
        }
        "twoWindowRatioAbove" => {
            let b = &a.bound;
            let (Some(wa), Some(wb), Some(min_ratio)) = (
                b.get("windowA"),
                b.get("windowB"),
                b.get("minRatio").and_then(|x| x.as_f64()),
            ) else {
                return fail(&a.id, "twoWindowRatioAbove bound malformed");
            };
            let wa = (
                wa[0].as_u64().unwrap() as u32,
                wa[1].as_u64().unwrap() as u32,
            );
            let wb = (
                wb[0].as_u64().unwrap() as u32,
                wb[1].as_u64().unwrap() as u32,
            );
            let (Some(ma), Some(mb)) = (
                window_mean(&a.metric, runs, wa.0, wa.1),
                window_mean(&a.metric, runs, wb.0, wb.1),
            ) else {
                return fail(&a.id, "window unresolved");
            };
            let r = ratio(ma, mb);
            outcome(
                &a.id,
                r >= min_ratio * (1.0 - tol),
                r,
                format!(">= {}", min_ratio * (1.0 - tol)),
            )
        }
        "peakBeforeDecline" => {
            let b = &a.bound;
            let (Some(pw), Some(final_ratio_max)) = (
                b.get("peakWindow"),
                b.get("finalRatioMax").and_then(|x| x.as_f64()),
            ) else {
                return fail(&a.id, "peakBeforeDecline bound malformed");
            };
            let (pa, pb) = (
                pw[0].as_u64().unwrap() as u32,
                pw[1].as_u64().unwrap() as u32,
            );
            let Some(horizon) = horizon_of(&a.metric, runs) else {
                return fail(&a.id, "run unresolved");
            };
            let Some(first) = expr_at(&a.metric, runs, 0) else {
                return fail(&a.id, "series start unresolved");
            };
            let mut peak = f64::MIN;
            for s in pa..=pb.min(horizon - 1) {
                if let Some(v) = expr_at(&a.metric, runs, s) {
                    peak = peak.max(v);
                }
            }
            let Some(finalv) = expr_at(&a.metric, runs, horizon - 1) else {
                return fail(&a.id, "final unresolved");
            };
            let pass = peak >= first && finalv <= final_ratio_max * peak * (1.0 + tol);
            outcome(
                &a.id,
                pass,
                finalv / peak,
                format!("final/peak <= {}", final_ratio_max * (1.0 + tol)),
            )
        }
        "bandSeparationAfter" => {
            let (a_term, b_term) = match a.metric.split_once(" vs ") {
                Some(x) => x,
                None => return fail(&a.id, "bandSeparationAfter needs 'A vs B'"),
            };
            let from = match step {
                StepSpec::At(s) => s,
                _ => return fail(&a.id, "bandSeparationAfter needs a numeric step"),
            };
            let Some(horizon) = horizon_of(&a.metric, runs) else {
                return fail(&a.id, "run unresolved");
            };
            let mut worst = f64::INFINITY;
            for s in from..horizon {
                let (Some(p10a), Some(p90b)) = (
                    term_value_q(a_term, runs, s, Quantile::P10),
                    term_value_q(b_term, runs, s, Quantile::P90),
                ) else {
                    return fail(&a.id, "band unresolved");
                };
                worst = worst.min(p10a - p90b);
            }
            outcome(
                &a.id,
                worst > 0.0,
                worst,
                "min(p10A - p90B) > 0".to_string(),
            )
        }
        other => fail(&a.id, format!("unknown comparator {other}")),
    }
}

fn outcome(id: &str, pass: bool, measured: f64, detail: String) -> Outcome {
    Outcome {
        id: id.to_string(),
        pass,
        measured,
        detail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goldens_json_loads_all_52_assertions() {
        let a = load_assertions();
        assert_eq!(a.len(), 52);
        assert!(a.iter().any(|x| x.id == "ccEntropyRise"));
    }

    #[test]
    fn parse_term_handles_quantile_suffix_and_run() {
        let (s, q, r) = parse_term("entropy.p10@main").unwrap();
        assert_eq!(s, "entropy");
        assert_eq!(q, Quantile::P10);
        assert_eq!(r, "main");
        let (s2, q2, _) = parse_term("throughput@sh3").unwrap();
        assert_eq!(s2, "throughput");
        assert_eq!(q2, Quantile::P50, "default quantile is p50");
    }

    #[test]
    fn ratio_zero_denominator_convention() {
        assert!(ratio(1.0, 0.0).is_infinite());
        assert!(ratio(0.0, 0.0).is_nan());
        assert_eq!(ratio(2.0, 4.0), 0.5);
    }
}
