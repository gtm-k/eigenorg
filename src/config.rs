//! Config schema (MODEL.md §12.2, authoritative over CONTRACTS.md).
//!
//! `rename_all = "camelCase"` + `deny_unknown_fields` on every config struct is
//! the T3 defense: a snake_case/camelCase mismatch or a typo'd field is a hard
//! parse error, never a silently-empty chart. [`Config::validate`] runs the
//! structural half of `validate()` (§12.1) — ranges, the sim/block match, the
//! new M19/M20 fields, and joint length constraints; the coefficient half lives
//! in [`crate::params::Params::resolve`].

use crate::params::ParamValue;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Sim {
    Org,
    Team,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Topology {
    Flat,
    Hierarchical,
    Pods,
    Federated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Modality {
    AsyncFirst,
    MeetingHeavy,
}

/// Ownership-seat type (§9.9). `humanPm` is the neutral identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LayerType {
    HumanPm,
    HumanDirector,
    AiAgent,
    Committee,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntityKind {
    Human,
    Ai,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub schema_version: String,
    #[serde(default)]
    pub model_version: String,
    pub sim: Sim,
    pub seed: u64,
    #[serde(default = "default_iterations")]
    pub iterations: u32,
    #[serde(default = "default_horizon")]
    pub horizon: u32,
    /// Share-URL replay marker (§12.4). The P5 url-codec sets `replay: true` when
    /// it reconstructs a config from a share link's embedded `resolvedParams`;
    /// authored configs leave it `false` (the default). It is client-set and only
    /// loosens `paramOverrides` range membership for the tamperer's own session —
    /// it never bypasses unknown-key, finiteness, shape, joint, or the μ ≤ 8
    /// structural checks (§12.1). Replaces the removed replay-by-cardinality
    /// heuristic: an old link missing a later-added param replays with the current
    /// default for that key, and a future param never turns an authored full-set
    /// map into an accidental replay.
    #[serde(default)]
    pub replay: bool,
    #[serde(default)]
    pub param_overrides: BTreeMap<String, ParamValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<CostBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org: Option<OrgConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<TeamConfig>,
}

fn default_iterations() -> u32 {
    500
}
fn default_horizon() -> u32 {
    60
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CostBlock {
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrgConfig {
    pub headcount_start: u32,
    pub headcount_growth_per_step: f64,
    pub topology: Topology,
    pub hierarchy_depth: u32,
    pub ownership_layers: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_types: Option<Vec<LayerType>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_owner_count: Option<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matrix: Option<Matrix>,
    pub modality: Modality,
    pub structural_health: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub misalignment: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_backlog: Option<u32>,
    pub ai_injection: AiInjection,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Matrix {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub tiebreaker: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiInjection {
    pub enabled: bool,
    pub at_step: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamConfig {
    pub entities: Vec<Entity>,
    pub work_stream: WorkStream,
    #[serde(default = "default_modality")]
    pub modality: Modality,
    pub structural_health: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_capacity_per_step: Option<f64>,
}

fn default_modality() -> Modality {
    Modality::AsyncFirst
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entity {
    pub id: String,
    pub kind: EntityKind,
    pub archetype: String,
    pub throughput: f64,
    pub judgment_quality: f64,
    pub handoff_friction: f64,
    pub reliability: f64,
    #[serde(default)]
    pub ramp_time_weeks: f64,
    #[serde(default = "default_availability")]
    pub availability: f64,
    pub functions: Vec<String>,
    #[serde(default)]
    pub capabilities: BTreeMap<String, f64>,
}

fn default_availability() -> f64 {
    1.0
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkStream {
    pub arrival_per_step: f64,
    pub mix: TaskMix,
    #[serde(default)]
    pub high_stakes_share: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskMix {
    pub routine: f64,
    pub complex: f64,
    pub novel: f64,
}

/// The seven core functions (§3.1), normative ids for coverage + validation.
pub const FUNCTIONS: [&str; 7] = [
    "prioritization",
    "review",
    "coordination",
    "execution",
    "stakeholderCommunication",
    "synthesis",
    "ambiguityResolution",
];

impl Config {
    /// Structural validation (§12.1). Coefficient/`paramOverrides` validation is
    /// [`crate::params::Params::resolve`]; this covers everything else.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != "1" {
            return Err(format!(
                "unsupported schemaVersion {:?}; this build supports major schema \"1\"",
                self.schema_version
            ));
        }
        if !(50..=5000).contains(&self.iterations) {
            return Err("iterations must be in [50, 5000]".to_string());
        }
        if !(10..=600).contains(&self.horizon) {
            return Err("horizon must be in [10, 600]".to_string());
        }
        if let Some(cost) = &self.cost {
            if cost.enabled {
                return Err("cost layer is a v2 feature (cost.enabled must be false)".to_string());
            }
        }
        match self.sim {
            Sim::Org => {
                if self.team.is_some() {
                    return Err("sim=org but a team block is present".to_string());
                }
                self.org
                    .as_ref()
                    .ok_or_else(|| "sim=org requires an org block".to_string())?
                    .validate()?;
            }
            Sim::Team => {
                if self.org.is_some() {
                    return Err("sim=team but an org block is present".to_string());
                }
                self.team
                    .as_ref()
                    .ok_or_else(|| "sim=team requires a team block".to_string())?
                    .validate()?;
            }
        }
        Ok(())
    }
}

impl OrgConfig {
    fn validate(&self) -> Result<(), String> {
        if !(4..=500).contains(&self.headcount_start) {
            return Err("org.headcountStart must be in [4, 500]".to_string());
        }
        if !self.headcount_growth_per_step.is_finite()
            || !(0.0..=2.0).contains(&self.headcount_growth_per_step)
        {
            return Err("org.headcountGrowthPerStep must be in [0, 2]".to_string());
        }
        if !(1..=6).contains(&self.hierarchy_depth) {
            return Err("org.hierarchyDepth must be in [1, 6]".to_string());
        }
        if !(1..=5).contains(&self.ownership_layers) {
            return Err("org.ownershipLayers must be in [1, 5]".to_string());
        }
        if !(1..=10).contains(&self.structural_health) {
            return Err("org.structuralHealth must be in [1, 10]".to_string());
        }
        let l = self.ownership_layers as usize;
        if let Some(types) = &self.layer_types {
            if types.len() != l {
                return Err("org.layerTypes length must equal ownershipLayers".to_string());
            }
        }
        let matrix_on = self.matrix.map(|m| m.enabled).unwrap_or(false);
        if let Some(m) = &self.matrix {
            if !m.tiebreaker.is_finite() || !(0.0..=1.0).contains(&m.tiebreaker) {
                return Err("org.matrix.tiebreaker must be in [0, 1]".to_string());
            }
        }
        if let Some(counts) = &self.layer_owner_count {
            if counts.len() != l {
                return Err("org.layerOwnerCount length must equal ownershipLayers".to_string());
            }
            for (idx, &mu) in counts.iter().enumerate() {
                if !(1..=8).contains(&mu) {
                    return Err(
                        "org.layerOwnerCount entries must be integers in [1, 8]".to_string()
                    );
                }
                // The matrix seat's intrinsic mu = 2 wins on the terminal layer;
                // a conflicting explicit count there is an authoring error (§12.1).
                if matrix_on && idx == l - 1 && mu != 1 {
                    return Err(
                        "org.layerOwnerCount on the matrix target layer L must be 1 (intrinsic mu=2 wins)"
                            .to_string(),
                    );
                }
            }
        }
        if let Some(m0) = self.misalignment {
            if !m0.is_finite() || !(0.0..=1.0).contains(&m0) {
                return Err("org.misalignment must be in [0, 1]".to_string());
            }
        }
        if let Some(b) = self.initial_backlog {
            if b > 500 {
                return Err("org.initialBacklog must be in [0, 500]".to_string());
            }
        }
        Ok(())
    }
}

impl TeamConfig {
    fn validate(&self) -> Result<(), String> {
        if !(2..=12).contains(&self.entities.len()) {
            return Err("team.entities must have 2..=12 entries".to_string());
        }
        for e in &self.entities {
            e.validate()?;
        }
        if !(1..=10).contains(&self.structural_health) {
            return Err("team.structuralHealth must be in [1, 10]".to_string());
        }
        let ws = &self.work_stream;
        if !ws.arrival_per_step.is_finite() || !(0.2..=5.0).contains(&ws.arrival_per_step) {
            return Err("team.workStream.arrivalPerStep must be in [0.2, 5]".to_string());
        }
        let mix_sum = ws.mix.routine + ws.mix.complex + ws.mix.novel;
        if (mix_sum - 1.0).abs() > 0.001 {
            return Err("team.workStream.mix must sum to 1 (+/- 0.001)".to_string());
        }
        if ws.mix.routine < 0.0 || ws.mix.complex < 0.0 || ws.mix.novel < 0.0 {
            return Err("team.workStream.mix fractions must be non-negative".to_string());
        }
        if !ws.high_stakes_share.is_finite() || !(0.0..=1.0).contains(&ws.high_stakes_share) {
            return Err("team.workStream.highStakesShare must be in [0, 1]".to_string());
        }
        if let Some(owner) = &self.recovery_owner {
            if !self.entities.iter().any(|e| &e.id == owner) {
                return Err(format!("team.recoveryOwner {owner:?} is not an entity id"));
            }
        }
        if let Some(cap) = self.review_capacity_per_step {
            if !cap.is_finite() || cap <= 0.0 {
                return Err(
                    "team.reviewCapacityPerStep must be > 0 when present (null = unbounded)"
                        .to_string(),
                );
            }
        }
        Ok(())
    }
}

impl Entity {
    fn validate(&self) -> Result<(), String> {
        for (name, v) in [
            ("throughput", self.throughput),
            ("judgmentQuality", self.judgment_quality),
            ("handoffFriction", self.handoff_friction),
            ("reliability", self.reliability),
        ] {
            if !v.is_finite() || !(1.0..=10.0).contains(&v) {
                return Err(format!("entity {}: {name} must be in [1, 10]", self.id));
            }
        }
        if !self.ramp_time_weeks.is_finite() || !(0.0..=6.0).contains(&self.ramp_time_weeks) {
            return Err(format!(
                "entity {}: rampTimeWeeks must be in [0, 6]",
                self.id
            ));
        }
        if !self.availability.is_finite() || !(0.0..=1.0).contains(&self.availability) {
            return Err(format!(
                "entity {}: availability must be in [0, 1]",
                self.id
            ));
        }
        for f in &self.functions {
            if !FUNCTIONS.contains(&f.as_str()) {
                return Err(format!("entity {}: unknown function {f:?}", self.id));
            }
        }
        for (f, cap) in &self.capabilities {
            if !FUNCTIONS.contains(&f.as_str()) {
                return Err(format!(
                    "entity {}: unknown capability function {f:?}",
                    self.id
                ));
            }
            if !cap.is_finite() || !(0.0..=10.0).contains(cap) {
                return Err(format!(
                    "entity {}: capability {f} must be in [0, 10]",
                    self.id
                ));
            }
        }
        Ok(())
    }
}
