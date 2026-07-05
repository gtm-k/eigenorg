//! AI Agent Team Simulator — one Monte Carlo iteration (MODEL.md §5.2).
//!
//! Executes the normative step order exactly (rates → recovery → arrivals →
//! unblock → prioritization → execution → review clearance → cohesion →
//! metrics); the §5 draw order is part of the reproducibility contract (§8.1).
//! Covers the team mechanic set: property→rate mappings + attention (§3.2/M15),
//! AI capability by task type (M11: routine advantage, novel collapse, the
//! prioritization service factors), Structural-Health brittleness amplification
//! on the AI judgment path (M9) with the high-stakes lift, recovery ownership
//! from `team.recoveryOwner` (M10), team handoff-friction tax (M14), the quality
//! model (M16), cohesion incl. the hollowness penalty (M12), the entropy proxy
//! (M13 team variant), and the M20 review-capacity queue over the T6r/T6d review
//! states — `reviewCapacityPerStep = null` reproduces v1's ungated review exactly
//! (the `hmReviewWaitNeutral` identity). Function coverage (M17) is static per
//! run and computed by the Monte Carlo runner from `crate::entities`.

use crate::config::{Entity, EntityKind, Modality, TeamConfig};
use crate::entities::{attention, exec_rate};
use crate::mechanics::{
    cognitive_band, draw_effort, draw_recovery_window, sh_brittle_factor, sigma,
};
use crate::params::Params;
use crate::rng::SimRng;
use crate::tasks::{clear_reviews, Stakes, Task, TaskClass, TaskState};

/// The 12 team output series (§7.2), positionally indexed by the consts below.
pub const TEAM_METRICS: [&str; 12] = [
    "throughput",
    "cumThroughput",
    "decisionLatencyRoutine",
    "coordinationTax",
    "cohesion",
    "brittlenessRate",
    "cumulativeBrittleness",
    "entropyProxy",
    "orgHealthProxy",
    "healthGap",
    "reviewQueueDepth",
    "reviewWaitDays",
];
pub const T_THROUGHPUT: usize = 0;
pub const T_CUM_THROUGHPUT: usize = 1;
pub const T_LATENCY_ROUTINE: usize = 2;
pub const T_COORD_TAX: usize = 3;
pub const T_COHESION: usize = 4;
pub const T_BRITTLE_RATE: usize = 5;
pub const T_CUM_BRITTLE: usize = 6;
pub const T_ENTROPY_PROXY: usize = 7;
pub const T_HEALTH_PROXY: usize = 8;
pub const T_HEALTH_GAP: usize = 9;
pub const T_REVIEW_QUEUE: usize = 10;
pub const T_REVIEW_WAIT: usize = 11;

/// The three judgment functions whose coverage drives task quality (M16).
const JUDGMENT_FUNCTIONS: [&str; 3] = ["review", "synthesis", "ambiguityResolution"];
/// The three human-relationship functions whose AI-only coverage marks a team
/// hollow (M12).
const HOLLOW_FUNCTIONS: [&str; 3] = ["prioritization", "coordination", "stakeholderCommunication"];

/// Config-static team factors (§3.2/§4), resolved once per run.
#[derive(Clone, Debug)]
pub struct TeamResolved {
    /// Entity count `n_e` (all entities — humans and agents alike, M14).
    pub n_e: f64,
    /// τ_team (M14) — static per config (entities and friction do not change).
    pub tau: f64,
    /// Is the `review` function assigned to anyone (T6 vs T6r/T6d)?
    pub review_covered: bool,
    /// Attention-and-availability-weighted mean judgment over entities covering
    /// review ∪ synthesis ∪ ambiguityResolution, or `judgmentFloor` (M16).
    pub judgment_eff: f64,
    /// Any HUMAN on a judgment function (the hybrid-vs-autonomous gate, M11/M16).
    pub human_judgment_covered: bool,
    /// Mean reliability of the execution pool (M16); the neutral center when the
    /// pool is empty (nothing ever executes, so no quality is drawn).
    pub mean_rel_exec: f64,
    /// `(# AI entities) / (# entities)` — the M12 cohesion AI share.
    pub ai_count_share: f64,
    /// AI covers a human-relationship function no human covers (M12).
    pub hollow: bool,
    /// `recoveryOwner == null` (M10 team ownership rule).
    pub unowned_recovery: bool,
    /// Novel-arrival brittleness base probability (M9/M11): the AI failure
    /// probability when AI holds prioritization with no human, else
    /// `humanNovelFailureBase`. The high-stakes lift is applied per task.
    pub brittle_base: f64,
    /// Prioritization service factor for routine tasks (M11).
    pub prio_routine_factor: f64,
    /// Prioritization service factor for complex/novel tasks (M11).
    pub prio_other_factor: f64,
    /// Indices into `team.entities` of the execution pool, with an AI flag —
    /// per-step rates (ramp, M15) are computed from these.
    pub exec_pool: Vec<(usize, bool)>,
}

fn covers(e: &Entity, f: &str) -> bool {
    e.functions.iter().any(|x| x == f)
}

fn is_ai(e: &Entity) -> bool {
    matches!(e.kind, EntityKind::Ai)
}

/// Resolve the config-static team factors (§3.2, M9, M11, M12, M14, M16).
pub fn resolve_team(team: &TeamConfig, params: &Params) -> TeamResolved {
    let entities = &team.entities;
    let n_e = entities.len() as f64;
    let sh = f64::from(team.structural_health);

    let ai_prio = entities
        .iter()
        .any(|e| is_ai(e) && covers(e, "prioritization"));
    let human_prio = entities
        .iter()
        .any(|e| !is_ai(e) && covers(e, "prioritization"));
    let review_covered = entities.iter().any(|e| covers(e, "review"));

    // M16 judgment coverage: weighted mean judgment over entities covering any
    // judgment function (weights = attention × availability), floor when none.
    // Human judgment counts only with EFFECTIVE capacity (attention × availability
    // > 0): M16 weights judgmentEff by exactly this product and §3.2 makes
    // availability multiply the coverage contribution, so a zero-availability
    // human applies no judgment and must not satisfy the hybrid-vs-autonomous
    // gate (M16 hybridFactor / noveltyQualityPenalty) — a dead seat is not
    // judgment. attention is always > 0 for an assigned human, so in practice
    // this excludes exactly the availability-0 seat.
    let mut weight_sum = 0.0;
    let mut judgment_sum = 0.0;
    let mut human_judgment_covered = false;
    for e in entities {
        if JUDGMENT_FUNCTIONS.iter().any(|f| covers(e, f)) {
            let w = attention(e, params) * e.availability;
            weight_sum += w;
            judgment_sum += e.judgment_quality * w;
            if !is_ai(e) && w > 0.0 {
                human_judgment_covered = true;
            }
        }
    }
    let judgment_eff = if weight_sum > 0.0 {
        judgment_sum / weight_sum
    } else {
        params.p("judgmentFloor")
    };

    // Execution pool (§3.2): entities assigned to `execution`.
    let exec_pool: Vec<(usize, bool)> = entities
        .iter()
        .enumerate()
        .filter(|(_, e)| covers(e, "execution"))
        .map(|(i, e)| (i, is_ai(e)))
        .collect();
    let mean_rel_exec = if exec_pool.is_empty() {
        // Neutral center: the reliability term is (mean − 7); with no execution
        // pool nothing completes, so no quality draw ever reads this.
        7.0
    } else {
        exec_pool
            .iter()
            .map(|&(i, _)| entities[i].reliability)
            .sum::<f64>()
            / exec_pool.len() as f64
    };

    let ai_count = entities.iter().filter(|e| is_ai(e)).count() as f64;
    let hollow = HOLLOW_FUNCTIONS.iter().any(|f| {
        entities.iter().any(|e| is_ai(e) && covers(e, f))
            && !entities.iter().any(|e| !is_ai(e) && covers(e, f))
    });

    // M9/M11 novel brittleness base: AI on prioritization with no human takes
    // the SH-amplified AI failure probability; otherwise the human base.
    let brittle_base = if ai_prio && !human_prio {
        params.p("aiNovelFailureBase") * sh_brittle_factor(sh, params)
    } else {
        params.p("humanNovelFailureBase")
    };

    // M11 prioritization service factors. The routine latency factor applies
    // when ANY AI covers prioritization ("if any AI covers prioritization,
    // routine service time *= aiRoutineLatencyFactor") — including a mixed
    // human+AI seat. This is deliberately broader than the brittleness gate
    // (brittle_base above), whose clause carries the explicit "and no human is
    // assigned" qualifier; the two gates differ by that qualifier's presence.
    // Nobody on prioritization → the uncovered factor on every class; a
    // human-only seat is neutral.
    let (prio_routine_factor, prio_other_factor) = if ai_prio {
        (params.p("aiRoutineLatencyFactor"), 1.0)
    } else if !human_prio {
        let u = params.p("uncoveredPrioritizationFactor");
        (u, u)
    } else {
        (1.0, 1.0)
    };

    // M14 team coordination tax: channel term (Brooks intra-team, C/n = (n−1)/2)
    // × modality × band factor, plus the handoff friction term; capped.
    let mu_modality = match team.modality {
        Modality::MeetingHeavy => params.p("meetingHeavyMultiplier"),
        Modality::AsyncFirst => 1.0,
    };
    let c_over_n = (n_e - 1.0) / 2.0;
    let channel =
        mu_modality * params.p("channelCostFraction") * c_over_n * cognitive_band(n_e, params);
    let friction_mean = entities.iter().map(|e| e.handoff_friction).sum::<f64>() / n_e;
    let handoff = params.p("handoffTaxCoefficient") * friction_mean / 5.0;
    let tau = (channel + handoff).min(params.p("maxCoordinationTax"));

    TeamResolved {
        n_e,
        tau,
        review_covered,
        judgment_eff,
        human_judgment_covered,
        mean_rel_exec,
        ai_count_share: ai_count / n_e,
        hollow,
        unowned_recovery: team.recovery_owner.is_none(),
        brittle_base,
        prio_routine_factor,
        prio_other_factor,
        exec_pool,
    }
}

/// One iteration's output: the per-step series and its quality-histogram bins
/// (pooled across steps; the runner pools across iterations, §7.2).
#[derive(Clone, Debug)]
pub struct TeamIterResult {
    pub series: Vec<[f64; 12]>,
    pub quality_bins: [u64; 10],
}

fn draw_team_class(routine: f64, complex: f64, rng: &mut SimRng) -> TaskClass {
    let u = rng.uniform();
    if u < routine {
        TaskClass::Routine
    } else if u < routine + complex {
        TaskClass::Complex
    } else {
        TaskClass::Novel
    }
}

/// M16 mean quality μ_q for a task class (config-static).
fn quality_mu(class: TaskClass, r: &TeamResolved, params: &Params) -> f64 {
    let complex_or_novel = matches!(class, TaskClass::Complex | TaskClass::Novel);
    let hybrid_factor = if complex_or_novel && !r.human_judgment_covered {
        1.0 / params.p("hybridVsAutonomousAdvantage")
    } else {
        1.0
    };
    let novelty_penalty = if class == TaskClass::Novel && !r.human_judgment_covered {
        params.p("noveltyQualityPenalty")
    } else {
        0.0
    };
    let review_penalty = if r.review_covered {
        0.0
    } else {
        params.p("reviewUncoveredQualityPenalty")
    };
    params.p("qualityBase")
        + params.p("qualityJudgmentWeight") * r.judgment_eff * hybrid_factor
        + params.p("qualityReliabilityWeight") * (r.mean_rel_exec - 7.0)
        - novelty_penalty
        - review_penalty
}

/// Draw one task's quality (M16) — one Triangular uniform — and bin it into the
/// 10-bucket histogram (width 10; 100 lands in the top bucket).
fn draw_quality_binned(mu: f64, params: &Params, rng: &mut SimRng, bins: &mut [u64; 10]) -> f64 {
    let q = rng
        .triangular(
            mu - params.p("qualitySpreadDown"),
            mu,
            mu + params.p("qualitySpreadUp"),
        )
        .clamp(0.0, 100.0);
    let bin = ((q / 10.0).floor() as usize).min(9);
    bins[bin] += 1;
    q
}

/// M11 prioritization service factor by class.
fn prio_factor(r: &TeamResolved, class: TaskClass) -> f64 {
    if class == TaskClass::Routine {
        r.prio_routine_factor
    } else {
        r.prio_other_factor
    }
}

/// Run one team Monte Carlo iteration with a pre-seeded RNG (§8.1).
pub fn run_team_iteration(
    team: &TeamConfig,
    params: &Params,
    r: &TeamResolved,
    horizon: u32,
    rng: &mut SimRng,
) -> TeamIterResult {
    let lat_tri = params.tri("decisionLatencyPerLayerDays");
    let mean_lat = (lat_tri[0] + lat_tri[1] + lat_tri[2]) / 3.0;
    let alpha = params.p("metricSmoothingAlpha");
    let dwell = params.p("reviewDwellDays");
    let review_cap = team.review_capacity_per_step;
    let arrival_rate = team.work_stream.arrival_per_step;
    let mix_routine = team.work_stream.mix.routine;
    let mix_complex = team.work_stream.mix.complex;
    let hs_share = team.work_stream.high_stakes_share;
    let hs_brittle = params.p("highStakesBrittlenessFactor");
    let max_per_task = params.p("maxPointsPerTaskPerStep");
    let prio_cap = params.p("layerCapacityPerStep");
    let tau = r.tau;

    // M16 per-class mean quality (config-static).
    let mu_q = [
        quality_mu(TaskClass::Routine, r, params),
        quality_mu(TaskClass::Complex, r, params),
        quality_mu(TaskClass::Novel, r, params),
    ];
    let mu_of = |class: TaskClass| match class {
        TaskClass::Routine => mu_q[0],
        TaskClass::Complex => mu_q[1],
        TaskClass::Novel => mu_q[2],
    };

    // M12 cohesion target — static per config (team size, AI share, hollowness).
    let cohesion_base = params.p("cohesionBase");
    let band_close = params.p("cognitiveBandClose");
    let cohesion_target = cohesion_base
        - params.p("cohesionSizePenalty")
            * sigma((r.n_e - band_close) / (params.p("bandWidthFactor") * band_close))
        - params.p("cohesionAiPenalty") * r.ai_count_share
        - if r.hollow {
            params.p("cohesionHollownessPenalty")
        } else {
            0.0
        };

    // M13 team-variant entropy weights, renormalized to sum 1.
    let w_coord = params.p("entropyWeightCoordination");
    let w_lat = params.p("entropyWeightLatency");
    let w_brit = params.p("entropyWeightBrittleness");
    let w_sum = w_coord + w_lat + w_brit;

    let mut tasks: Vec<Task> = Vec::new();
    let mut next_id: u64 = 0;
    let mut windows: Vec<(u32, f64)> = Vec::new();
    let mut prio_acc = 0.0_f64;
    let mut review_acc = 0.0_f64;
    let mut quality_bins = [0_u64; 10];

    let mut cohesion = cohesion_base;
    let mut prev_entropy = 0.0;
    let mut lat_ema = mean_lat;
    let mut lat_raw_prev = mean_lat;
    let mut brittle_ema = 0.0;
    let mut wait_ema = dwell;
    let mut cum_throughput = 0.0;
    let mut cum_brittle = 0.0;

    let mut series: Vec<[f64; 12]> = Vec::with_capacity(horizon as usize);

    for t in 0..horizon {
        // --- 1. Rates (M15/M11/M14) ---
        let mut pool_raw = 0.0;
        let mut pool_ai = 0.0;
        for &(idx, ai) in &r.exec_pool {
            let rate = exec_rate(&team.entities[idx], t, params);
            pool_raw += rate;
            if ai {
                pool_ai += rate;
            }
        }
        let ai_exec_share = if pool_raw > 0.0 {
            pool_ai / pool_raw
        } else {
            0.0
        };
        let human_exec_share = 1.0 - ai_exec_share;
        let routine_factor = 1.0 + ai_exec_share * (params.p("aiRoutineAdvantage") - 1.0);
        let novel_factor = human_exec_share + ai_exec_share * params.p("aiNovelEffectiveness");

        // --- 2. Recovery windows ---
        let m_recovery = windows.iter().map(|w| w.1).fold(1.0, f64::max);
        for w in &mut windows {
            w.0 = w.0.saturating_sub(1);
        }
        windows.retain(|w| w.0 > 0);

        // --- 3. Arrivals (M18: count; per task class, stakes, effort; novel →
        // brittleness per M9/M11 with the high-stakes lift) ---
        let whole = arrival_rate.floor();
        let arrivals = whole as u32 + u32::from(rng.bernoulli(arrival_rate - whole));
        let mut brittle_events_step = 0.0_f64;
        for _ in 0..arrivals {
            let class = draw_team_class(mix_routine, mix_complex, rng);
            let stakes = if rng.bernoulli(hs_share) {
                Stakes::High
            } else {
                Stakes::Low
            };
            let effort = draw_effort(class, params, rng);
            let brittle = class == TaskClass::Novel
                && rng.bernoulli(
                    r.brittle_base
                        * if stakes == Stakes::High {
                            hs_brittle
                        } else {
                            1.0
                        },
                );
            if brittle {
                let (dur, mult) = draw_recovery_window(r.unowned_recovery, params, rng);
                windows.push((dur, mult));
                tasks.push(Task::arriving_blocked(next_id, t, effort, stakes, dur));
                cum_brittle += 1.0;
                brittle_events_step += 1.0;
            } else {
                let service = rng.triangular(lat_tri[0], lat_tri[1], lat_tri[2])
                    * m_recovery
                    * prio_factor(r, class);
                tasks.push(Task::arriving(next_id, t, class, stakes, effort, service));
            }
            next_id += 1;
        }

        // --- 4. Unblock ---
        for task in tasks.iter_mut() {
            if task.state == TaskState::Blocked {
                task.block_remaining = task.block_remaining.saturating_sub(1);
                if task.block_remaining == 0 {
                    let service = rng.triangular(lat_tri[0], lat_tri[1], lat_tri[2])
                        * m_recovery
                        * prio_factor(r, task.class);
                    task.unblock(service);
                }
            }
        }

        // --- 5. Prioritization (single layer, fractional capacity accumulator;
        // T4 first-pass latency samples — routine samples feed the series) ---
        for task in tasks.iter_mut() {
            if task.state == TaskState::Queued(1) {
                task.service_remaining -= 1.0;
            }
        }
        let mut ready: Vec<usize> = tasks
            .iter()
            .enumerate()
            .filter(|(_, t)| t.state == TaskState::Queued(1) && t.service_remaining <= 0.0)
            .map(|(i, _)| i)
            .collect();
        ready.sort_by(|&a, &b| {
            tasks[a]
                .arrival_step
                .cmp(&tasks[b].arrival_step)
                .then(tasks[a].id.cmp(&tasks[b].id))
        });
        let budget = prio_acc + prio_cap;
        let moved = ready.len().min(budget.floor().max(0.0) as usize);
        let mut routine_samples: Vec<f64> = Vec::new();
        for &idx in ready.iter().take(moved) {
            let class = tasks[idx].class;
            if let Some(sample) = tasks[idx].to_in_progress(t) {
                if class == TaskClass::Routine {
                    routine_samples.push(sample);
                }
            }
        }
        prio_acc = (budget - moved as f64).min(1.0);

        // --- 6. Execution (M11 class factors on progress credit; completions
        // enter review when covered, else complete with a quality draw) ---
        let mut pool = pool_raw * (1.0 - tau);
        let mut ip: Vec<usize> = tasks
            .iter()
            .enumerate()
            .filter(|(_, t)| t.state == TaskState::InProgress)
            .map(|(i, _)| i)
            .collect();
        ip.sort_by(|&a, &b| {
            tasks[a]
                .arrival_step
                .cmp(&tasks[b].arrival_step)
                .then(tasks[a].id.cmp(&tasks[b].id))
        });
        let mut throughput = 0.0;
        for idx in ip {
            if pool <= 0.0 {
                break;
            }
            let g = max_per_task.min(pool);
            let credit = match tasks[idx].class {
                TaskClass::Routine => g * routine_factor,
                TaskClass::Complex => g,
                TaskClass::Novel => g * novel_factor,
            };
            tasks[idx].allocate(credit);
            pool -= g;
            if tasks[idx].is_complete() {
                if r.review_covered {
                    tasks[idx].to_review(t, dwell);
                } else {
                    tasks[idx].complete();
                    draw_quality_binned(mu_of(tasks[idx].class), params, rng, &mut quality_bins);
                    throughput += 1.0;
                }
            }
        }

        // --- 7. Review clearance (M20) ---
        // Dwell decrement: once per step, only for tasks that entered review on
        // a PRIOR step, so a task entering at step e first becomes eligible at
        // e + ceil(dwell) — the realized sojourn is (clear step − entry step),
        // exactly reviewDwellDays at unbounded capacity (§11.6 identity).
        for task in tasks.iter_mut() {
            if task.state == TaskState::Review && task.completion_step < t {
                task.review_dwell_remaining -= 1.0;
            }
        }
        let cleared = clear_reviews(&mut tasks, review_cap, &mut review_acc);
        if !cleared.is_empty() {
            let mut sojourn_sum = 0.0;
            for id in &cleared {
                let task = tasks
                    .iter()
                    .find(|task| task.id == *id)
                    .expect("cleared id must exist");
                sojourn_sum += f64::from(t - task.completion_step);
                draw_quality_binned(mu_of(task.class), params, rng, &mut quality_bins);
            }
            throughput += cleared.len() as f64;
            wait_ema = alpha * (sojourn_sum / cleared.len() as f64) + (1.0 - alpha) * wait_ema;
        }
        let queue_depth = tasks
            .iter()
            .filter(|task| task.state == TaskState::Review)
            .count() as f64;

        // --- 8. Cohesion (M12 team variant; report pre-update; E(−1) = 0) ---
        let cohesion_report = cohesion;
        let next_cohesion = (cohesion
            + params.p("cohesionRecoveryRate") * (cohesion_target - cohesion)
            - params.p("cohesionEntropyCoupling")
                * (prev_entropy - params.p("entropyStressThreshold")).max(0.0)
                / 10.0)
            .clamp(0.0, 100.0);

        // --- 9. Metrics ---
        cum_throughput += throughput;
        let raw_lat = if routine_samples.is_empty() {
            lat_raw_prev
        } else {
            routine_samples.iter().sum::<f64>() / routine_samples.len() as f64
        };
        lat_ema = alpha * raw_lat + (1.0 - alpha) * lat_ema;
        lat_raw_prev = raw_lat;
        brittle_ema = alpha * brittle_events_step + (1.0 - alpha) * brittle_ema;

        let x_coord = tau / params.p("maxCoordinationTax");
        let x_lat = (lat_ema / params.p("latencyNormDays")).min(1.0);
        let x_brit = (brittle_ema / params.p("brittlenessNormPerStep")).min(1.0);
        let entropy = 100.0 * (w_coord * x_coord + w_lat * x_lat + w_brit * x_brit) / w_sum;
        let health = 100.0 - entropy;

        let mut row = [0.0_f64; 12];
        row[T_THROUGHPUT] = throughput;
        row[T_CUM_THROUGHPUT] = cum_throughput;
        row[T_LATENCY_ROUTINE] = lat_ema;
        row[T_COORD_TAX] = tau;
        row[T_COHESION] = cohesion_report;
        row[T_BRITTLE_RATE] = brittle_events_step;
        row[T_CUM_BRITTLE] = cum_brittle;
        row[T_ENTROPY_PROXY] = entropy;
        row[T_HEALTH_PROXY] = health;
        row[T_HEALTH_GAP] = cohesion_report - health;
        row[T_REVIEW_QUEUE] = queue_depth;
        row[T_REVIEW_WAIT] = wait_ema;
        series.push(row);

        prev_entropy = entropy;
        cohesion = next_cohesion;
    }

    TeamIterResult {
        series,
        quality_bins,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::run_json;
    use crate::output::{Output, Quantile};

    /// The MODEL.md Appendix A hand-simulation config (2 entities: ana human,
    /// exo AI), whose deterministic quantities are reproduced to 4 decimals.
    fn appendix_a_team() -> TeamConfig {
        serde_json::from_str(
            r#"{
            "entities": [
              { "id": "ana", "kind": "human", "archetype": "engineer", "throughput": 6,
                "judgmentQuality": 6, "handoffFriction": 4, "reliability": 8,
                "rampTimeWeeks": 0, "availability": 1,
                "functions": ["prioritization", "execution", "review"],
                "capabilities": { "prioritization": 5, "execution": 7, "review": 6 } },
              { "id": "exo", "kind": "ai", "archetype": "aiExecution", "throughput": 8,
                "judgmentQuality": 3, "handoffFriction": 2, "reliability": 7,
                "rampTimeWeeks": 0, "availability": 1,
                "functions": ["execution"], "capabilities": { "execution": 8 } }
            ],
            "workStream": { "arrivalPerStep": 1.0,
              "mix": { "routine": 1, "complex": 0, "novel": 0 }, "highStakesShare": 0 },
            "modality": "asyncFirst", "structuralHealth": 6, "recoveryOwner": null
        }"#,
        )
        .unwrap()
    }

    #[test]
    fn m14_appendix_a_tau_hand_value() {
        // Appendix A: channel = 0.036 × 0.5 × 1.0016 = 0.0180; handoff =
        // 0.03 × ((4+2)/2)/5 = 0.0180; τ = 0.0360 (4 decimals).
        let p = Params::defaults();
        let r = resolve_team(&appendix_a_team(), &p);
        assert!(
            (r.tau - 0.0360).abs() < 5e-5,
            "Appendix A τ must be 0.0360, got {}",
            r.tau
        );
    }

    #[test]
    fn m11_appendix_a_exec_shares_and_factors() {
        // ana 1.2 pts/step + exo 1.6 → aiExecShare = 0.5714; routine boost
        // 1 + 0.5714 × 0.5 = 1.2857; novel factor 0.4286 + 0.5714 × 0.3 = 0.6.
        let p = Params::defaults();
        let team = appendix_a_team();
        let r = resolve_team(&team, &p);
        let mut pool_raw = 0.0;
        let mut pool_ai = 0.0;
        for &(idx, ai) in &r.exec_pool {
            let rate = exec_rate(&team.entities[idx], 0, &p);
            pool_raw += rate;
            if ai {
                pool_ai += rate;
            }
        }
        assert!((pool_raw - 2.8).abs() < 1e-12);
        let ai_share = pool_ai / pool_raw;
        assert!((ai_share - 0.5714).abs() < 1e-4);
        let routine = 1.0 + ai_share * (p.p("aiRoutineAdvantage") - 1.0);
        assert!((routine - 1.2857).abs() < 1e-4);
        let novel = (1.0 - ai_share) + ai_share * p.p("aiNovelEffectiveness");
        assert!((novel - 0.6).abs() < 1e-4);
    }

    #[test]
    fn m11_prioritization_service_factors() {
        let p = Params::defaults();
        // Appendix A: human (ana) covers prioritization → factor 1 for all.
        let human = resolve_team(&appendix_a_team(), &p);
        assert_eq!(human.prio_routine_factor, 1.0);
        assert_eq!(human.prio_other_factor, 1.0);

        // AI-only prioritization: routine ×aiRoutineLatencyFactor, others ×1.
        let mut hollow = appendix_a_team();
        hollow.entities[0].functions = vec!["execution".to_string(), "review".to_string()];
        hollow.entities[1].functions = vec!["execution".to_string(), "prioritization".to_string()];
        let ai = resolve_team(&hollow, &p);
        assert_eq!(ai.prio_routine_factor, p.p("aiRoutineLatencyFactor"));
        assert_eq!(ai.prio_other_factor, 1.0);

        // Nobody covers prioritization → uncovered factor on every class.
        let mut uncovered = appendix_a_team();
        uncovered.entities[0].functions = vec!["execution".to_string(), "review".to_string()];
        let un = resolve_team(&uncovered, &p);
        assert_eq!(un.prio_routine_factor, p.p("uncoveredPrioritizationFactor"));
        assert_eq!(un.prio_other_factor, p.p("uncoveredPrioritizationFactor"));

        // Mixed human+AI prioritization seat → routine still takes the AI
        // routine-latency factor (M11: "if ANY AI covers prioritization, routine
        // service time *= aiRoutineLatencyFactor" — no "and no human" qualifier,
        // unlike the brittleness clause). RED on the pre-fix ai && !human gate,
        // which neutralized a co-owned seat to factor 1. others stay 1.
        let mut mixed = appendix_a_team();
        // ana (human) keeps prioritization; exo (AI) also covers prioritization.
        mixed.entities[0].functions = vec!["prioritization".to_string(), "review".to_string()];
        mixed.entities[1].functions = vec!["execution".to_string(), "prioritization".to_string()];
        let mx = resolve_team(&mixed, &p);
        assert_eq!(mx.prio_routine_factor, p.p("aiRoutineLatencyFactor"));
        assert_eq!(mx.prio_other_factor, 1.0);
        // The brittleness gate keeps its explicit "no human" qualifier: a human
        // co-owns prioritization → humanNovelFailureBase, NOT the AI base.
        assert_eq!(mx.brittle_base, p.p("humanNovelFailureBase"));
    }

    #[test]
    fn m16_appendix_a_quality_mu_hand_value() {
        // Appendix A outlook: μ_q = 45 + 5.5×6 + 1.0×((8+7)/2 − 7) = 78.5 for a
        // routine task (human judgment covered → hybrid factor 1, no penalties).
        let p = Params::defaults();
        let r = resolve_team(&appendix_a_team(), &p);
        assert!(r.human_judgment_covered);
        assert!(
            (r.judgment_eff - 6.0).abs() < 1e-12,
            "ana is the only judge"
        );
        assert!((r.mean_rel_exec - 7.5).abs() < 1e-12);
        assert!((quality_mu(TaskClass::Routine, &r, &p) - 78.5).abs() < 1e-12);
    }

    #[test]
    fn m16_autonomous_pipeline_loses_judgment_bonus() {
        // Zero human judgment: complex/novel divide the judgment contribution by
        // hybridVsAutonomousAdvantage; novel additionally takes the penalty.
        let p = Params::defaults();
        let mut team = appendix_a_team();
        team.entities[0].functions = vec!["prioritization".to_string(), "execution".to_string()];
        team.entities[1].functions = vec!["execution".to_string(), "review".to_string()];
        let r = resolve_team(&team, &p);
        assert!(!r.human_judgment_covered);
        assert!(
            (r.judgment_eff - 3.0).abs() < 1e-12,
            "exo is the only judge"
        );
        let routine = quality_mu(TaskClass::Routine, &r, &p);
        let complex = quality_mu(TaskClass::Complex, &r, &p);
        let novel = quality_mu(TaskClass::Novel, &r, &p);
        // routine keeps the full (autonomous) judgment term: 45 + 5.5×3 + 0.5.
        assert!((routine - 62.0).abs() < 1e-12);
        // complex: 45 + 5.5×3/1.687 + 0.5 = 55.2810...
        assert!((complex - (45.0 + 16.5 / 1.687 + 0.5)).abs() < 1e-12);
        // novel: complex − noveltyQualityPenalty (15).
        assert!((novel - (complex - 15.0)).abs() < 1e-12);
    }

    #[test]
    fn m16_zero_availability_human_is_not_judgment_coverage() {
        // A human assigned to a judgment function but at availability 0 applies
        // ZERO judgment: M16 weights judgmentEff by attention × availability and
        // §3.2 makes availability multiply the coverage contribution, so a dead
        // seat contributes nothing. It must NOT satisfy human judgment coverage —
        // otherwise complex/novel work would dodge the autonomous-quality divisor
        // (M16 hybridFactor) with no human judgment actually applied. RED on the
        // pre-fix `!is_ai(e)` gate, which flipped the flag on assignment alone.
        let p = Params::defaults();
        let mut team = appendix_a_team();
        // ana (human) is the only entity on a judgment function, but fully
        // unavailable; exo (AI) executes only, covering no judgment function.
        team.entities[0].functions = vec!["prioritization".to_string(), "review".to_string()];
        team.entities[0].availability = 0.0;
        team.entities[1].functions = vec!["execution".to_string()];
        let r = resolve_team(&team, &p);
        assert!(
            !r.human_judgment_covered,
            "a zero-availability human applies no judgment"
        );
        // No entity contributes effective judgment → judgmentEff is the floor.
        assert!((r.judgment_eff - p.p("judgmentFloor")).abs() < 1e-12);
        // Consequence (M16): complex work takes the autonomous divisor. exo is
        // the only executor (reliability 7 → reliability term 0).
        assert!((r.mean_rel_exec - 7.0).abs() < 1e-12);
        let complex = quality_mu(TaskClass::Complex, &r, &p);
        let expected = p.p("qualityBase")
            + p.p("qualityJudgmentWeight") * p.p("judgmentFloor")
                / p.p("hybridVsAutonomousAdvantage");
        assert!((complex - expected).abs() < 1e-12);
    }

    #[test]
    fn m9_team_brittleness_base_hand_values() {
        // hollowMiddle@hollow (SH 6, AI prioritization, no human): base =
        // 0.22 × (1.55 − 1.35×2/3) = 0.22 × 0.65 = 0.143; ×1.5 high stakes.
        let p = Params::defaults();
        let mut hollow = appendix_a_team();
        hollow.entities[0].functions = vec!["execution".to_string(), "review".to_string()];
        hollow.entities[1].functions = vec!["execution".to_string(), "prioritization".to_string()];
        let r = resolve_team(&hollow, &p);
        assert!((r.brittle_base - 0.143).abs() < 1e-12);
        assert!((r.brittle_base * p.p("highStakesBrittlenessFactor") - 0.2145).abs() < 1e-12);

        // Human-covered prioritization → humanNovelFailureBase.
        let human = resolve_team(&appendix_a_team(), &p);
        assert_eq!(human.brittle_base, p.p("humanNovelFailureBase"));
    }

    #[test]
    fn m12_hollow_flag_and_cohesion_target() {
        let p = Params::defaults();
        // Appendix A: no AI on the relationship functions → not hollow;
        // target = 75 − 15×(1/2) − 12×σ((2−15)/2.25) = 67.4630.
        let r = resolve_team(&appendix_a_team(), &p);
        assert!(!r.hollow);
        assert!((r.ai_count_share - 0.5).abs() < 1e-12);
        let target = p.p("cohesionBase")
            - p.p("cohesionSizePenalty")
                * sigma(
                    (r.n_e - p.p("cognitiveBandClose"))
                        / (p.p("bandWidthFactor") * p.p("cognitiveBandClose")),
                )
            - p.p("cohesionAiPenalty") * r.ai_count_share;
        assert!((target - 67.4630).abs() < 5e-5);

        // AI-only prioritization+coordination → hollow.
        let mut hollow = appendix_a_team();
        hollow.entities[1].functions = vec![
            "execution".to_string(),
            "prioritization".to_string(),
            "coordination".to_string(),
        ];
        hollow.entities[0].functions = vec!["execution".to_string(), "review".to_string()];
        assert!(resolve_team(&hollow, &p).hollow);
    }

    // ---- Engine-level behavior (through the full dispatch path) ----

    fn appendix_a_cfg(horizon: u32) -> String {
        format!(
            r#"{{"schemaVersion":"1","modelVersion":"2.1.0","sim":"team","seed":42,
            "iterations":50,"horizon":{horizon},
            "team":{{"entities":[
              {{"id":"ana","kind":"human","archetype":"engineer","throughput":6,"judgmentQuality":6,"handoffFriction":4,"reliability":8,"rampTimeWeeks":0,"availability":1,"functions":["prioritization","execution","review"],"capabilities":{{"prioritization":5,"execution":7,"review":6}}}},
              {{"id":"exo","kind":"ai","archetype":"aiExecution","throughput":8,"judgmentQuality":3,"handoffFriction":2,"reliability":7,"rampTimeWeeks":0,"availability":1,"functions":["execution"],"capabilities":{{"execution":8}}}}],
            "workStream":{{"arrivalPerStep":1.0,"mix":{{"routine":1,"complex":0,"novel":0}},"highStakesShare":0}},
            "modality":"asyncFirst","structuralHealth":6,"recoveryOwner":null}}}}"#
        )
    }

    fn p50_at(out: &Output, series: &str, t: u32) -> f64 {
        out.series_value(series, Quantile::P50, t).unwrap()
    }

    #[test]
    fn appendix_a_walk_deterministic_values_on_engine() {
        // The Appendix A 3-step walk's DETERMINISTIC quantities (τ, cohesion
        // series, throughput 0, latency-EMA init, review-wait identity) hold on
        // the Monte Carlo engine at every quantile.
        let out = run_json(&appendix_a_cfg(10)).unwrap();
        // τ = 0.0360 every step, deterministic.
        assert!((p50_at(&out, "coordinationTax", 0) - 0.0360).abs() < 5e-5);
        // cohesion: 75.00 → 74.6232 → 74.2652 (pre-update reporting). Appendix A
        // prints intermediate values rounded to 4 decimals, so its chained
        // figures carry ~1e-4 of print-rounding (true c(1) = 74.62315…); the
        // engine is compared at 2e-4.
        assert!((p50_at(&out, "cohesion", 0) - 75.0).abs() < 1e-12);
        assert!((p50_at(&out, "cohesion", 1) - 74.6232).abs() < 2e-4);
        assert!((p50_at(&out, "cohesion", 2) - 74.2652).abs() < 2e-4);
        // decisionLatencyRoutine init = mean Tri(2, 2.5, 3) = 2.5 at t=0.
        assert!((p50_at(&out, "decisionLatencyRoutine", 0) - 2.5).abs() < 1e-12);
        // throughput 0 through t=2 (nothing can clear review before t=3).
        for t in 0..=2 {
            for q in [Quantile::P10, Quantile::P50, Quantile::P90] {
                assert_eq!(out.series_value("throughput", q, t).unwrap(), 0.0);
            }
        }
        // Review is covered and unbounded → reviewWaitDays ≡ reviewDwellDays.
        for p in out.series.get("reviewWaitDays").unwrap() {
            assert_eq!(p.p10, 1.0);
            assert_eq!(p.p50, 1.0);
            assert_eq!(p.p90, 1.0);
        }
        // healthGap = cohesion − orgHealthProxy at t=0: 75 − 90.74 = −15.74.
        assert!((p50_at(&out, "healthGap", 0) - (-15.74)).abs() < 5e-3);
        // All 12 §7.2 series are present.
        assert_eq!(out.series.len(), TEAM_METRICS.len());
        for id in TEAM_METRICS {
            assert!(out.series.contains_key(id), "missing team series {id}");
        }
        // Team blocks: coverage for all 7 functions; histogram present.
        let cov = out.function_coverage.as_ref().unwrap();
        assert_eq!(cov.len(), 7);
        assert_eq!(cov["execution"].rating, "green");
        assert_eq!(cov["coordination"].rating, "red");
        assert!(out.quality_histogram.is_some());
        assert!(out.per_layer.is_none(), "perLayer is org-only");
    }

    #[test]
    fn quality_histogram_pools_completions() {
        // Over a longer run the team completes work; every completion draws one
        // quality (T6d — review covered here), pooled across iterations.
        let out = run_json(&appendix_a_cfg(40)).unwrap();
        let bins = out.quality_histogram.as_ref().unwrap();
        assert_eq!(bins.len(), 10);
        let total: u64 = bins.iter().map(|b| b.count).sum();
        assert!(total > 0, "completions must draw quality");
        // Appendix A μ_q = 78.5, spread [63.5, 88.5] → all mass in bins 6..=8.
        for (i, b) in bins.iter().enumerate() {
            assert_eq!(b.lo, i as f64 * 10.0);
            assert_eq!(b.hi, i as f64 * 10.0 + 10.0);
            if !(6..=8).contains(&i) {
                assert_eq!(
                    b.count, 0,
                    "quality mass outside Tri(63.5,78.5,88.5) support"
                );
            }
        }
    }

    #[test]
    fn m20_bottleneck_gates_throughput_and_grows_queue() {
        // A capacity below the completion rate must (a) plateau done-throughput
        // and (b) grow the review queue, versus the unbounded twin.
        let base = appendix_a_cfg(40);
        let capped = base.replace(
            "\"recoveryOwner\":null",
            "\"recoveryOwner\":null,\"reviewCapacityPerStep\":0.5",
        );
        let unbounded = run_json(&base).unwrap();
        let bottleneck = run_json(&capped).unwrap();
        let last = 39;
        assert!(
            p50_at(&bottleneck, "cumThroughput", last) < p50_at(&unbounded, "cumThroughput", last),
            "capped review must ship less"
        );
        assert!(
            p50_at(&bottleneck, "reviewQueueDepth", last)
                > p50_at(&unbounded, "reviewQueueDepth", last),
            "capped review must bank a queue"
        );
        assert!(
            p50_at(&bottleneck, "reviewWaitDays", last)
                > p50_at(&unbounded, "reviewWaitDays", last),
            "capped review must wait longer"
        );
    }

    #[test]
    fn team_param_override_changes_output() {
        // paramOverrides reach the team arm: raising aiRoutineAdvantage within
        // range must change the series (the engine applies overrides in v1).
        let base = appendix_a_cfg(20);
        let overridden = base.replace(
            "\"sim\":\"team\"",
            "\"sim\":\"team\",\"paramOverrides\":{\"aiRoutineAdvantage\":2.0}",
        );
        let a = run_json(&base).unwrap();
        let b = run_json(&overridden).unwrap();
        assert_ne!(
            serde_json::to_string(&a.series).unwrap(),
            serde_json::to_string(&b.series).unwrap(),
            "a within-range override must perturb the team series"
        );
    }

    #[test]
    fn m15_ramping_human_slows_early_execution() {
        // rampTimeWeeks > 0 starts the human at rampStartFactor and climbs to 1
        // (M15) — the early cumThroughput must trail the zero-ramp twin's.
        let base = appendix_a_cfg(30);
        let ramped = base.replace(
            r#""id":"ana","kind":"human","archetype":"engineer","throughput":6,"judgmentQuality":6,"handoffFriction":4,"reliability":8,"rampTimeWeeks":0"#,
            r#""id":"ana","kind":"human","archetype":"engineer","throughput":6,"judgmentQuality":6,"handoffFriction":4,"reliability":8,"rampTimeWeeks":6"#,
        );
        assert_ne!(base, ramped, "replace must hit");
        let full = run_json(&base).unwrap();
        let ramp = run_json(&ramped).unwrap();
        assert!(
            p50_at(&ramp, "cumThroughput", 15) <= p50_at(&full, "cumThroughput", 15),
            "a ramping human cannot outproduce the full-speed twin early"
        );
        assert!(
            p50_at(&ramp, "cumThroughput", 15) < p50_at(&full, "cumThroughput", 15)
                || p50_at(&ramp, "cumThroughput", 29) < p50_at(&full, "cumThroughput", 29),
            "the ramp must actually bite somewhere in the run"
        );
    }
}
