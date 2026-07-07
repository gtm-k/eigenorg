//! Model coefficients — the single numeric home for the engine.
//!
//! `model/params.json` (extracted from MODEL.md §9 by `scripts/extract_params.mjs`)
//! is embedded verbatim via `include_str!`, so coefficients have no second home
//! (PLAN P3 / S1). Mechanics read every number through [`Params::p`] /
//! [`Params::tri`] by id — the `src/mechanics/` numeric-literal lint enforces
//! that no bare coefficient is smuggled in as a literal.
//!
//! [`Params::resolve`] merges defaults with a config's `paramOverrides` and runs
//! the coefficient half of `validate()` (§12.1): unknown keys, NaN/Inf, range
//! membership (authoring only), triangular `min ≤ mode ≤ max`, and the entropy /
//! task-mix joint constraints. `resolvedParams` (the share-URL payload, §12.3)
//! is the merged map serialized back out.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::OnceLock;

const PARAMS_JSON: &str = include_str!("../model/params.json");

/// A coefficient value: a fixed point, or a Triangular `[min, mode, max]` (§9).
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ParamValue {
    Point(f64),
    Tri([f64; 3]),
}

impl ParamValue {
    fn all_finite(&self) -> bool {
        match self {
            ParamValue::Point(v) => v.is_finite(),
            ParamValue::Tri(t) => t.iter().all(|x| x.is_finite()),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
struct ParamDef {
    id: String,
    value: ParamValue,
    range: [f64; 2],
    distribution: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParamsFile {
    model_version: String,
    parameters: Vec<ParamDef>,
}

fn file() -> &'static ParamsFile {
    static FILE: OnceLock<ParamsFile> = OnceLock::new();
    FILE.get_or_init(|| {
        serde_json::from_str(PARAMS_JSON).expect("model/params.json must parse (include_str!)")
    })
}

/// The model version declared in `model/params.json` (emitted from the MODEL.md
/// meta block by the extractor — the CI pairing gate anchors to it, §12.6).
pub fn model_version() -> &'static str {
    &file().model_version
}

/// The five entropy-weight ids whose joint sum must stay 1 (§12.1).
const ENTROPY_WEIGHT_IDS: [&str; 5] = [
    "entropyWeightCoordination",
    "entropyWeightLatency",
    "entropyWeightCohesion",
    "entropyWeightBrittleness",
    "entropyWeightWip",
];

/// Resolved coefficient set for one run: defaults merged with `paramOverrides`.
#[derive(Clone, Debug)]
pub struct Params {
    values: BTreeMap<String, ParamValue>,
}

impl Params {
    /// Defaults only (no overrides) — used by tests and the neutral baseline.
    pub fn defaults() -> Self {
        let mut values = BTreeMap::new();
        for def in &file().parameters {
            values.insert(def.id.clone(), def.value.clone());
        }
        Params { values }
    }

    /// Merge `overrides` onto the defaults with coefficient validation (§12.1).
    ///
    /// `replay = false` (authoring): range membership is enforced. `replay =
    /// true` (share-URL `resolvedParams`): range membership is skipped — an old
    /// link replays its embedded numbers even after a range is later narrowed
    /// (§12.4/§12.5) — but structure, type, finiteness, `min ≤ mode ≤ max`, and
    /// the joint constraints still hold.
    pub fn resolve(overrides: &BTreeMap<String, ParamValue>, replay: bool) -> Result<Self, String> {
        let mut params = Params::defaults();
        for (key, val) in overrides {
            let def = file()
                .parameters
                .iter()
                .find(|d| &d.id == key)
                .ok_or_else(|| format!("paramOverrides key not in params.json: {key}"))?;
            if !val.all_finite() {
                return Err(format!("paramOverrides {key}: NaN/Inf is rejected"));
            }
            match (&def.distribution[..], val) {
                ("point", ParamValue::Point(v)) => {
                    if !replay && (*v < def.range[0] || *v > def.range[1]) {
                        return Err(format!(
                            "paramOverrides {key}={v} outside range [{}, {}]",
                            def.range[0], def.range[1]
                        ));
                    }
                }
                ("triangular", ParamValue::Tri(t)) => {
                    if !(t[0] <= t[1] && t[1] <= t[2]) {
                        return Err(format!(
                            "paramOverrides {key}: triangular must satisfy min <= mode <= max, got {t:?}"
                        ));
                    }
                    if !replay && (t[1] < def.range[0] || t[1] > def.range[1]) {
                        return Err(format!(
                            "paramOverrides {key}: mode {} outside range [{}, {}]",
                            t[1], def.range[0], def.range[1]
                        ));
                    }
                }
                _ => {
                    return Err(format!(
                        "paramOverrides {key}: value shape must match the '{}' distribution",
                        def.distribution
                    ));
                }
            }
            params.values.insert(key.clone(), val.clone());
        }
        params.check_joint_constraints(overrides)?;
        Ok(params)
    }

    fn check_joint_constraints(
        &self,
        overrides: &BTreeMap<String, ParamValue>,
    ) -> Result<(), String> {
        // Entropy weights must sum to 1 (± 0.001) whenever any weight is set.
        if ENTROPY_WEIGHT_IDS
            .iter()
            .any(|id| overrides.contains_key(*id))
        {
            let sum: f64 = ENTROPY_WEIGHT_IDS.iter().map(|id| self.p(id)).sum();
            if (sum - 1.0).abs() > 0.001 {
                return Err(format!(
                    "entropy weights must sum to 1 (+/- 0.001); got {sum}"
                ));
            }
        }
        // The org task mix leaves a non-negative novel remainder.
        if self.p("taskMixRoutineOrg") + self.p("taskMixComplexOrg") > 1.0 + 0.001 {
            return Err("taskMixRoutineOrg + taskMixComplexOrg must be <= 1".to_string());
        }
        Ok(())
    }

    /// A point coefficient by id. Panics on a missing/triangular id — an engine
    /// invariant, not user input (all ids are hardcoded against params.json).
    pub fn p(&self, id: &str) -> f64 {
        match self.values.get(id) {
            Some(ParamValue::Point(v)) => *v,
            Some(ParamValue::Tri(_)) => panic!("param {id} is triangular, not point"),
            None => panic!("unknown param id {id}"),
        }
    }

    /// A triangular coefficient `[min, mode, max]` by id.
    pub fn tri(&self, id: &str) -> [f64; 3] {
        match self.values.get(id) {
            Some(ParamValue::Tri(t)) => *t,
            Some(ParamValue::Point(_)) => panic!("param {id} is point, not triangular"),
            None => panic!("unknown param id {id}"),
        }
    }

    /// The merged coefficient set for `resolvedParams` output (§12.3), ordered.
    pub fn resolved_map(&self) -> &BTreeMap<String, ParamValue> {
        &self.values
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params_json_parses_and_declares_v2() {
        assert_eq!(model_version(), "2.2.0");
        let d = Params::defaults();
        // A few spot values against MODEL.md §9.
        assert_eq!(d.p("channelCostFraction"), 0.036);
        assert_eq!(d.p("overrideDiffusionGain"), 0.4);
        assert_eq!(d.p("brittlenessNormPerStep"), 0.35);
        assert_eq!(d.tri("decisionLatencyPerLayerDays"), [2.0, 2.5, 3.0]);
    }

    #[test]
    fn unknown_override_key_is_rejected() {
        let mut ov = BTreeMap::new();
        ov.insert("notARealParam".to_string(), ParamValue::Point(1.0));
        assert!(Params::resolve(&ov, false).is_err());
    }

    #[test]
    fn out_of_range_override_rejected_when_authoring_but_allowed_on_replay() {
        let mut ov = BTreeMap::new();
        // layerFrictionFactor range is [0.2, 0.6].
        ov.insert("layerFrictionFactor".to_string(), ParamValue::Point(0.9));
        assert!(
            Params::resolve(&ov, false).is_err(),
            "authoring enforces range"
        );
        let replayed = Params::resolve(&ov, true).expect("replay skips range");
        assert_eq!(replayed.p("layerFrictionFactor"), 0.9);
    }

    #[test]
    fn nan_and_bad_triangular_are_rejected() {
        let mut nan = BTreeMap::new();
        nan.insert(
            "layerFrictionFactor".to_string(),
            ParamValue::Point(f64::NAN),
        );
        assert!(Params::resolve(&nan, true).is_err());

        let mut bad_tri = BTreeMap::new();
        bad_tri.insert(
            "taskEffortNovel".to_string(),
            ParamValue::Tri([9.0, 8.0, 7.0]),
        );
        assert!(
            Params::resolve(&bad_tri, true).is_err(),
            "min<=mode<=max enforced even on replay"
        );
    }

    #[test]
    fn wrong_shape_override_is_rejected() {
        let mut ov = BTreeMap::new();
        // layerFrictionFactor is a point; a triple is the wrong shape.
        ov.insert(
            "layerFrictionFactor".to_string(),
            ParamValue::Tri([1.0, 2.0, 3.0]),
        );
        assert!(Params::resolve(&ov, true).is_err());
    }

    #[test]
    fn entropy_weight_sum_constraint_enforced_when_touched() {
        let mut ov = BTreeMap::new();
        // Override one weight so the five no longer sum to 1.
        ov.insert(
            "entropyWeightCoordination".to_string(),
            ParamValue::Point(0.5),
        );
        assert!(Params::resolve(&ov, false).is_err(), "sum != 1 must fail");
    }

    #[test]
    fn override_changes_a_resolved_value() {
        let mut ov = BTreeMap::new();
        ov.insert("layerFrictionFactor".to_string(), ParamValue::Point(0.5));
        let r = Params::resolve(&ov, false).unwrap();
        assert_eq!(r.p("layerFrictionFactor"), 0.5);
        assert_eq!(Params::defaults().p("layerFrictionFactor"), 0.35);
    }
}
