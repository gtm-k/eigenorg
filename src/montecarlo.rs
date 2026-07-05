//! Monte Carlo runner + percentile aggregation (MODEL.md §8).
//!
//! Rust-side aggregation collapses N iterations into tidy percentile series, so
//! the output payload is independent of iteration count and stays small (T5 /
//! §12.3 < 200 KB). [`OrgRun`] is the reusable state behind both the native
//! monolithic runner and the frozen chunked wasm API: iteration `i` always uses
//! `SimRng::for_iteration(seed, i)` regardless of chunk boundaries, so the
//! output is invariant to chunking (`run_chunk(1)×N == run_chunk(N)×1`).

use crate::config::{Config, OrgConfig, Sim};
use crate::mechanics::org::{
    layer_means, make_per_layer, run_iteration, LayerIterStats, OrgIterResult, ORG_METRICS,
};
use crate::mechanics::{resolve_layers, LayerResolved};
use crate::output::{Output, Percentile};
use crate::params::Params;
use crate::rng::SimRng;
use std::collections::BTreeMap;

/// Nearest-rank percentile (§8.3): `values[min(N−1, max(0, ceil(q·N)−1))]`.
fn percentile(sorted: &[f64], q: f64) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.0;
    }
    let idx = (((q * n as f64).ceil() as i64) - 1).clamp(0, n as i64 - 1) as usize;
    sorted[idx]
}

/// Stateful org Monte Carlo run — validated config + resolved params/layers plus
/// the completed iterations. Chunk-invariant by construction.
pub struct OrgRun {
    config: Config,
    org: OrgConfig,
    params: Params,
    layers: Vec<LayerResolved>,
    completed: Vec<OrgIterResult>,
}

impl OrgRun {
    /// Build a run from an already-`validate()`d org config. `replay` controls
    /// `paramOverrides` range checking (§12.1). Resolves params + layers up front.
    pub fn new(config: Config, replay: bool) -> Result<Self, String> {
        let org = config
            .org
            .clone()
            .ok_or_else(|| "org run requires an org block".to_string())?;
        let params = Params::resolve(&config.param_overrides, replay)?;
        let layers = resolve_layers(&org, &params);
        Ok(OrgRun {
            config,
            org,
            params,
            layers,
            completed: Vec::new(),
        })
    }

    pub fn total_iterations(&self) -> u32 {
        self.config.iterations
    }

    pub fn completed_count(&self) -> u32 {
        self.completed.len() as u32
    }

    /// Run up to `n` more iterations; returns the new completed count. Iteration
    /// `i` is seeded independently, so the result set is chunk-invariant.
    pub fn run_chunk(&mut self, n: u32) -> u32 {
        let start = self.completed.len() as u32;
        let end = (start + n).min(self.config.iterations);
        for i in start..end {
            let mut rng = SimRng::for_iteration(self.config.seed, i);
            self.completed.push(run_iteration(
                &self.org,
                &self.params,
                &self.layers,
                self.config.horizon,
                &mut rng,
            ));
        }
        self.completed.len() as u32
    }

    /// Aggregate the completed iterations into the output (§7.1, §12.3).
    pub fn finalize(&self) -> Output {
        let horizon = self.config.horizon as usize;
        let iters = self.completed.len();
        let mut series: BTreeMap<String, Vec<Percentile>> = BTreeMap::new();
        for (mi, name) in ORG_METRICS.iter().enumerate() {
            let mut points = Vec::with_capacity(horizon);
            for step in 0..horizon {
                let mut vals: Vec<f64> = self
                    .completed
                    .iter()
                    .map(|it| it.series[step][mi])
                    .collect();
                vals.sort_by(|a, b| a.total_cmp(b));
                points.push(Percentile {
                    t: step as u32,
                    p10: percentile(&vals, 0.1),
                    p50: percentile(&vals, 0.5),
                    p90: percentile(&vals, 0.9),
                });
            }
            series.insert((*name).to_string(), points);
        }

        let per_layer = self.aggregate_layers(iters);
        let band_markers = vec![
            self.params.p("cognitiveBandInner"),
            self.params.p("cognitiveBandClose"),
            self.params.p("cognitiveBandWorking"),
            self.params.p("cognitiveBandStable"),
        ];

        Output {
            schema_version: "1".to_string(),
            model_version: crate::model_version().to_string(),
            sim: Sim::Org,
            seed: self.config.seed,
            iterations: self.config.iterations,
            horizon: self.config.horizon,
            series,
            per_layer: Some(per_layer),
            band_markers: Some(band_markers),
            quality_histogram: None,
            function_coverage: None,
            resolved_params: self.params.resolved_map().clone(),
        }
    }

    fn aggregate_layers(&self, iters: usize) -> Vec<crate::output::PerLayer> {
        let n_layers = self.layers.len();
        let mut lat = vec![0.0_f64; n_layers];
        let mut queue = vec![0.0_f64; n_layers];
        let mut util = vec![0.0_f64; n_layers];
        let mut events = vec![0_u64; n_layers];
        let mut total_events = 0_u64;
        // A representative per-layer stat block for the deterministic fields.
        let template: &Vec<LayerIterStats> = &self.completed[0].layers;

        for it in &self.completed {
            for (li, st) in it.layers.iter().enumerate() {
                let (l, q, u) = layer_means(st);
                lat[li] += l;
                queue[li] += q;
                util[li] += u;
                events[li] += st.override_events;
                total_events += st.override_events;
            }
        }
        let denom = iters.max(1) as f64;
        // Bottleneck = the single layer with the maximum mean utilization.
        let mut bottleneck = 0usize;
        for li in 1..n_layers {
            if util[li] > util[bottleneck] {
                bottleneck = li;
            }
        }
        (0..n_layers)
            .map(|li| {
                let share = if total_events > 0 {
                    events[li] as f64 / total_events as f64
                } else {
                    0.0
                };
                make_per_layer(
                    &template[li],
                    lat[li] / denom,
                    queue[li] / denom,
                    util[li] / denom,
                    share,
                    li == bottleneck,
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_nearest_rank_matches_spec_indices() {
        let sorted: Vec<f64> = (0..500).map(|i| i as f64).collect();
        // N=500: p10 index 49, p50 index 249, p90 index 449 (§8.3).
        assert_eq!(percentile(&sorted, 0.1), 49.0);
        assert_eq!(percentile(&sorted, 0.5), 249.0);
        assert_eq!(percentile(&sorted, 0.9), 449.0);
    }
}
