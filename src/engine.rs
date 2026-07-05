//! Engine dispatch + the stateful chunked run behind the frozen wasm API.
//!
//! [`run_config`] is the native monolithic path (golden harness, cross-target
//! hash, tests). [`Run`] is the chunked state machine the wasm `begin_run →
//! run_chunk → finalize` surface drives (CONTRACTS.md). The team arm returns a
//! typed [`EngineError::NotImplemented`] — the freeze binds the SIGNATURE; P7a
//! fills in the body.

use crate::config::{Config, Sim};
use crate::montecarlo::OrgRun;
use crate::output::Output;

/// Typed engine error, surfaced to JS as `{ "error": { "type", "message" } }`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EngineError {
    /// Config failed structural/schema validation (§12.1).
    Validation(String),
    /// A frozen-but-unimplemented surface (team sim until P7a; `cost` block).
    NotImplemented(String),
    /// The chunked API was driven out of order (§ state-machine contract).
    BadState(String),
}

impl EngineError {
    fn kind(&self) -> &'static str {
        match self {
            EngineError::Validation(_) => "validation",
            EngineError::NotImplemented(_) => "notImplemented",
            EngineError::BadState(_) => "badState",
        }
    }

    fn message(&self) -> &str {
        match self {
            EngineError::Validation(m)
            | EngineError::NotImplemented(m)
            | EngineError::BadState(m) => m,
        }
    }

    /// The JSON error envelope returned across the wasm boundary.
    pub fn to_json(&self) -> String {
        serde_json::json!({ "error": { "type": self.kind(), "message": self.message() } })
            .to_string()
    }
}

/// Parse + validate a config JSON string (§12.1/§12.2). `seed_override`, when
/// `Some`, replaces `config.seed` (the API passes the seed explicitly).
pub fn parse_and_validate(
    config_json: &str,
    seed_override: Option<u64>,
) -> Result<Config, EngineError> {
    let mut config: Config = serde_json::from_str(config_json)
        .map_err(|e| EngineError::Validation(format!("config parse error: {e}")))?;
    if let Some(seed) = seed_override {
        config.seed = seed;
    }
    config.validate().map_err(EngineError::Validation)?;
    Ok(config)
}

/// Native monolithic run: validate, dispatch, run every iteration, aggregate.
///
/// Replay looseness is driven by the explicit `config.replay` flag (§12.4), not by
/// the size of the `paramOverrides` map: `replay == true` skips current-range
/// membership for overrides only; every other check (unknown key, NaN/Inf, value
/// shape, joint constraints, and the μ ≤ 8 structural ceiling in `validate()`)
/// runs in both modes.
pub fn run_config(config: Config) -> Result<Output, EngineError> {
    config.validate().map_err(EngineError::Validation)?;
    match config.sim {
        Sim::Team => Err(EngineError::NotImplemented(
            "team simulator lands in P7a (the wasm export signature is frozen here)".to_string(),
        )),
        Sim::Org => {
            let replay = config.replay;
            let mut run = OrgRun::new(config, replay).map_err(EngineError::Validation)?;
            run.run_chunk(run.total_iterations());
            Ok(run.finalize())
        }
    }
}

/// Convenience: parse a JSON config and run it monolithically.
pub fn run_json(config_json: &str) -> Result<Output, EngineError> {
    let config = parse_and_validate(config_json, None)?;
    run_config(config)
}

/// The chunked run state machine (CONTRACTS.md). One in-flight run per handle;
/// cancel = drop the handle and `begin` again.
pub enum Run {
    Org(OrgRun),
}

impl Run {
    /// `begin_run(sim, config_json, seed)` — parse, validate, and set up the run.
    /// The `sim` argument must match the config's `sim`. Team → NotImplemented.
    pub fn begin(sim: Sim, config_json: &str, seed: u64) -> Result<Run, EngineError> {
        let config = parse_and_validate(config_json, Some(seed))?;
        if config.sim != sim {
            return Err(EngineError::Validation(format!(
                "sim argument {:?} does not match config.sim {:?}",
                sim, config.sim
            )));
        }
        match config.sim {
            Sim::Team => Err(EngineError::NotImplemented(
                "team simulator lands in P7a (the wasm export signature is frozen here)"
                    .to_string(),
            )),
            Sim::Org => {
                let replay = config.replay;
                let run = OrgRun::new(config, replay).map_err(EngineError::Validation)?;
                Ok(Run::Org(run))
            }
        }
    }

    /// `run_chunk(n)` — run up to `n` more iterations; returns total completed.
    pub fn run_chunk(&mut self, n: u32) -> u32 {
        match self {
            Run::Org(run) => run.run_chunk(n),
        }
    }

    pub fn total_iterations(&self) -> u32 {
        match self {
            Run::Org(run) => run.total_iterations(),
        }
    }

    pub fn completed_count(&self) -> u32 {
        match self {
            Run::Org(run) => run.completed_count(),
        }
    }

    /// `finalize()` — aggregate to the output JSON. Errors if the run has not
    /// completed every iteration (the state-machine contract).
    pub fn finalize(&self) -> Result<String, EngineError> {
        match self {
            Run::Org(run) => {
                if run.completed_count() < run.total_iterations() {
                    return Err(EngineError::BadState(format!(
                        "finalize before completion: {}/{} iterations run",
                        run.completed_count(),
                        run.total_iterations()
                    )));
                }
                serde_json::to_string(&run.finalize())
                    .map_err(|e| EngineError::BadState(format!("serialize error: {e}")))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn team_run_is_typed_not_implemented() {
        let cfg = r#"{"schemaVersion":"1","modelVersion":"2.0.0","sim":"team","seed":42,
            "iterations":50,"horizon":10,
            "team":{"entities":[
              {"id":"a","kind":"human","archetype":"engineer","throughput":7,"judgmentQuality":6,"handoffFriction":4,"reliability":8,"functions":["execution"],"capabilities":{"execution":7}},
              {"id":"b","kind":"human","archetype":"reviewer","throughput":4,"judgmentQuality":8,"handoffFriction":4,"reliability":9,"functions":["review"],"capabilities":{"review":8}}],
            "workStream":{"arrivalPerStep":1.0,"mix":{"routine":0.6,"complex":0.25,"novel":0.15},"highStakesShare":0.2},
            "structuralHealth":6,"recoveryOwner":null}}"#;
        let err = run_json(cfg).unwrap_err();
        assert!(matches!(err, EngineError::NotImplemented(_)));
        assert!(err.to_json().contains("notImplemented"));
    }

    #[test]
    fn org_ai_injection_runs_and_changes_output() {
        // P4 removed the P3 typed-NotImplemented guard (M9/M11/M12-AI now live;
        // CONTRACTS §2, signature-stable). An enabled injection must RUN and
        // must actually perturb the output versus the disabled twin.
        let cfg = r#"{"schemaVersion":"1","modelVersion":"2.0.0","sim":"org","seed":42,
            "iterations":50,"horizon":30,
            "org":{"headcountStart":12,"headcountGrowthPerStep":0,"topology":"flat",
            "hierarchyDepth":2,"ownershipLayers":1,"modality":"asyncFirst","structuralHealth":6,
            "aiInjection":{"enabled":true,"atStep":5}}}"#;
        let with_ai = run_json(cfg).expect("aiInjection.enabled=true must run after P4");
        let without = run_json(&cfg.replace("\"enabled\":true", "\"enabled\":false")).unwrap();
        assert_ne!(
            serde_json::to_string(&with_ai.series).unwrap(),
            serde_json::to_string(&without.series).unwrap(),
            "an active injection must change the series"
        );
    }

    #[test]
    fn unknown_field_is_a_validation_error() {
        let cfg = r#"{"schemaVersion":"1","sim":"org","seed":42,"iterations":50,"horizon":10,
            "org":{"headcountStart":12,"headcountGrowthPerStep":0,"topology":"flat","hierarchyDepth":2,
            "ownershipLayers":1,"modality":"meetingHeavy","structuralHealth":6,
            "aiInjection":{"enabled":false,"atStep":0},"typo":true}}"#;
        assert!(matches!(
            run_json(cfg).unwrap_err(),
            EngineError::Validation(_)
        ));
    }
}
