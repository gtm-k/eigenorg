//! Output schema (MODEL.md §12.3, §7). Tidy percentile series plus per-sim
//! non-series blocks. Additive-extensible: consumers ignore unknown fields
//! (§12.1), so new series/blocks never break an old reader.

use crate::config::Sim;
use crate::params::ParamValue;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One step of a percentile series (`{t, p10, p50, p90}`, §7). Deterministic
/// quantities set `p10 == p50 == p90`.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
pub struct Percentile {
    pub t: u32,
    pub p10: f64,
    pub p50: f64,
    pub p90: f64,
}

/// Per-layer org stats (§7.1). Every field has a fully computable rule.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerLayer {
    pub layer: u32,
    pub layer_type: String,
    pub mean_latency_days: f64,
    pub mean_queue: f64,
    pub utilization: f64,
    pub override_share: f64,
    pub distortion: f64,
    pub owner_multiplicity: f64,
    pub diffusion_factor: f64,
    pub bottleneck: bool,
}

/// One quality-histogram bin (team sim, §7.2).
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
pub struct QualityBin {
    pub lo: f64,
    pub hi: f64,
    pub count: u64,
}

/// Function-coverage entry (team sim, §7.2).
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Coverage {
    pub score: f64,
    pub rating: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub schema_version: String,
    pub model_version: String,
    pub sim: Sim,
    pub seed: u64,
    pub iterations: u32,
    pub horizon: u32,
    pub series: BTreeMap<String, Vec<Percentile>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_layer: Option<Vec<PerLayer>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_markers: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality_histogram: Option<Vec<QualityBin>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function_coverage: Option<BTreeMap<String, Coverage>>,
    pub resolved_params: BTreeMap<String, ParamValue>,
}

impl Output {
    /// Value of `metric[.p10|.p50|.p90]` at a step for the golden evaluator.
    /// Returns `None` if the series or step is absent.
    pub fn series_value(&self, series_id: &str, quantile: Quantile, step: u32) -> Option<f64> {
        let series = self.series.get(series_id)?;
        let point = series.iter().find(|p| p.t == step)?;
        Some(quantile.pick(point))
    }

    /// A scalar addressed by a non-series block path (§11.1), e.g.
    /// `functionCoverage.execution.score`.
    pub fn scalar_path(&self, path: &str) -> Option<f64> {
        let mut parts = path.split('.');
        match parts.next()? {
            "functionCoverage" => {
                let f = parts.next()?;
                let field = parts.next()?;
                let cov = self.function_coverage.as_ref()?.get(f)?;
                match field {
                    "score" => Some(cov.score),
                    _ => None,
                }
            }
            _ => None,
        }
    }
}

/// Which quantile a metric suffix selects (`.p50` default).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Quantile {
    P10,
    P50,
    P90,
}

impl Quantile {
    pub fn pick(self, p: &Percentile) -> f64 {
        match self {
            Quantile::P10 => p.p10,
            Quantile::P50 => p.p50,
            Quantile::P90 => p.p90,
        }
    }
}
