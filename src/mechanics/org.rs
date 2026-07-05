//! Org Entropy Simulator — one Monte Carlo iteration (MODEL.md §5.1).
//!
//! Executes the normative step order exactly (structure → recovery → arrivals →
//! unblock → pipeline → overrides → execution → cohesion → metrics); the §5 draw
//! order is part of the reproducibility contract (§8.1). Covers the full org
//! mechanic set: structure (M1–M5), the decision pipeline (M6), overrides +
//! accountability diffusion (M8/M19), Structural-Health amplification + AI
//! coordination relief (M9), brittleness recovery (M10), the AI-injection
//! effects (M11 a–c + per-layer novel exposure), cohesion incl. the org AI
//! share (M12), and the entropy composite (M13). Every AI term is an exact
//! no-op while `aiInjection` is inactive, so no-AI configs are byte-identical
//! to the P3 kernel (cross-target hash + §11.12 neutral identity).

use crate::config::{Modality, OrgConfig, Topology};
use crate::mechanics::{layer_type_name, mean_over_upper, LayerResolved};
use crate::output::PerLayer;
use crate::params::Params;
use crate::rng::SimRng;
use crate::tasks::{Stakes, Task, TaskClass, TaskState};

/// The 16 org output series (§7.1), positionally indexed by the consts below.
pub const ORG_METRICS: [&str; 16] = [
    "throughput",
    "entropy",
    "orgHealth",
    "coordinationTax",
    "meetingOverheadPct",
    "communicationLoad",
    "interTeamChannels",
    "decisionLatency",
    "decisionVelocity",
    "wip",
    "overrideRate",
    "cumulativeOverrides",
    "brittlenessRate",
    "cumulativeBrittleness",
    "cohesionTeamAvg",
    "healthGap",
];
pub const M_THROUGHPUT: usize = 0;
pub const M_ENTROPY: usize = 1;
pub const M_ORG_HEALTH: usize = 2;
pub const M_COORD_TAX: usize = 3;
pub const M_MEETING: usize = 4;
pub const M_COMM_LOAD: usize = 5;
pub const M_INTER_TEAM: usize = 6;
pub const M_LATENCY: usize = 7;
pub const M_VELOCITY: usize = 8;
pub const M_WIP: usize = 9;
pub const M_OVERRIDE_RATE: usize = 10;
pub const M_CUM_OVERRIDES: usize = 11;
pub const M_BRITTLE_RATE: usize = 12;
pub const M_CUM_BRITTLE: usize = 13;
pub const M_COHESION: usize = 14;
pub const M_HEALTH_GAP: usize = 15;

/// Per-layer statistics accumulated over one iteration (§7.1 rules).
#[derive(Clone, Debug)]
pub struct LayerIterStats {
    pub layer: u32,
    pub layer_type: &'static str,
    pub mu: f64,
    pub diffusion_factor: f64,
    pub distortion: f64,
    pub latency_sum: f64,
    pub latency_count: u32,
    pub structural_latency: f64,
    pub queue_sum: f64,
    pub queue_steps: u32,
    pub util_sum: f64,
    pub util_steps: u32,
    pub override_events: u64,
}

/// One iteration's output: the per-step series and per-layer stats.
#[derive(Clone, Debug)]
pub struct OrgIterResult {
    pub series: Vec<[f64; 16]>,
    pub layers: Vec<LayerIterStats>,
}

fn sigma(x: f64) -> f64 {
    // libm::exp (not f64::exp) so the logistic band shape is bit-identical
    // native vs wasm (the cross-target hash gate, §8.1 / T6).
    1.0 / (1.0 + libm::exp(-x))
}

fn team_count(n: u32, topology: Topology, params: &Params) -> u32 {
    match topology {
        Topology::Flat => 1,
        Topology::Pods | Topology::Federated => (f64::from(n) / params.p("teamPodTargetSize"))
            .ceil()
            .max(1.0) as u32,
        Topology::Hierarchical => (f64::from(n) / params.p("hierarchicalTeamSize"))
            .ceil()
            .max(1.0) as u32,
    }
}

/// Sum of `n_i(n_i−1)/2` over `t` teams sized as equally as possible (M1).
fn intra_channels(n: u32, t: u32) -> f64 {
    let t = t.max(1);
    let base = n / t;
    let rem = n % t;
    let big = f64::from(base + 1);
    let small = f64::from(base);
    let big_teams = f64::from(rem);
    let small_teams = f64::from(t - rem);
    big_teams * (big * (big - 1.0) / 2.0) + small_teams * (small * (small - 1.0) / 2.0)
}

fn cognitive_band(n: f64, params: &Params) -> f64 {
    let bands = [
        ("cognitiveBandInner", "bandPenaltyInner"),
        ("cognitiveBandClose", "bandPenaltyClose"),
        ("cognitiveBandWorking", "bandPenaltyWorking"),
        ("cognitiveBandStable", "bandPenaltyStable"),
    ];
    let width = params.p("bandWidthFactor");
    let mut b = 1.0;
    for (center_id, penalty_id) in bands {
        let center = params.p(center_id);
        b += params.p(penalty_id) * sigma((n - center) / (width * center));
    }
    b
}

/// Pick an overriding seat in `{2..=L}` weighted by `w_l = 1 + gradient·(l−1)`
/// (M8/M19) — consumes exactly one uniform per event. Returns the 1-indexed seat.
fn attribute_override(l_layers: u32, gradient: f64, rng: &mut SimRng) -> u32 {
    // Candidates are seats 2..=L (layer 1 originates, never overrides).
    let total: f64 = (2..=l_layers)
        .map(|l| 1.0 + gradient * f64::from(l - 1))
        .sum();
    let u = rng.uniform();
    let target = u * total;
    let mut acc = 0.0;
    for l in 2..=l_layers {
        acc += 1.0 + gradient * f64::from(l - 1);
        if target < acc {
            return l;
        }
    }
    l_layers
}

/// Run one org Monte Carlo iteration with a pre-seeded RNG (§8.1).
pub fn run_iteration(
    org: &OrgConfig,
    params: &Params,
    layers: &[LayerResolved],
    horizon: u32,
    rng: &mut SimRng,
) -> OrgIterResult {
    let l_count = org.ownership_layers;
    let sh = f64::from(org.structural_health);
    let d = f64::from(org.hierarchy_depth);
    let meeting_heavy = matches!(org.modality, Modality::MeetingHeavy);
    let federated = matches!(org.topology, Topology::Federated);

    // Static aggregates (M8/M19): diffusionMean, dropMean, distortion.
    let diffusion_mean = mean_over_upper(layers, 1.0, |s| s.diffusion_factor);
    let drop_mean = mean_over_upper(layers, 0.0, |s| s.drop_contribution);
    let layer_distortion_mean = mean_over_upper(layers, 1.0, |s| s.distortion_factor);
    let distortion = params.p("distortionPerHumanLayer") * (d - 1.0) * layer_distortion_mean;
    let kept_fraction = params.p("wipResetFraction") * (1.0 - drop_mean).max(0.0);
    let gradient = params.p("overrideAuthorityGradient");

    // m0 default derived from SH (M5) unless the config pins it.
    let m0 = org
        .misalignment
        .unwrap_or_else(|| ((7.0 - sh) / 9.0).clamp(0.0, 1.0));
    let n0 = org.headcount_start;
    let t_at_start = team_count(n0, org.topology, params);

    let lat_tri = params.tri("decisionLatencyPerLayerDays");
    let mean_lat = (lat_tri[0] + lat_tri[1] + lat_tri[2]) / 3.0;
    let alpha = params.p("metricSmoothingAlpha");
    let cohesion_base = params.p("cohesionBase");

    // AI-injection factors (M9/M11/M12, P4) — all exact no-ops while the
    // injection is inactive: the boost and routing multiply only when
    // `ai_active`, relief falls back to 0.0, and the cohesion AI term
    // subtracts 0.0, so every no-AI config stays byte-identical (the
    // cross-target hash + §11.12 neutral-identity contracts).
    let inject_enabled = org.ai_injection.enabled;
    let inject_at = org.ai_injection.at_step;
    let uniform_boost = ai_uniform_boost(params);
    let ai_routing = ai_routing_factor(sh, params);
    let ai_share = params.p("aiRoutineShareOrg") * params.p("taskMixRoutineOrg");
    // §9.9 per-layer AI novel exposure (config-static; M11).
    let layer_exposure = layers
        .iter()
        .map(|s| s.novel_exposure)
        .fold(0.0_f64, f64::max);

    // Per-layer stats accumulators.
    let mut layer_stats: Vec<LayerIterStats> = layers
        .iter()
        .map(|s| LayerIterStats {
            layer: s.layer,
            layer_type: layer_type_name(s.layer_type),
            mu: s.mu,
            diffusion_factor: s.diffusion_factor,
            distortion: params.p("distortionPerHumanLayer")
                * f64::from(s.layer - 1)
                * s.distortion_factor,
            latency_sum: 0.0,
            latency_count: 0,
            structural_latency: mean_lat * s.latency_factor * s.diffusion_latency_factor,
            queue_sum: 0.0,
            queue_steps: 0,
            util_sum: 0.0,
            util_steps: 0,
            override_events: 0,
        })
        .collect();

    let mut tasks: Vec<Task> = Vec::new();
    let mut next_id: u64 = 0;
    let mut layer_acc = vec![0.0_f64; l_count as usize];
    // Recovery windows: (steps remaining, service multiplier) — inert without AI.
    let mut windows: Vec<(u32, f64)> = Vec::new();

    let mut cohesion = cohesion_base;
    let mut prev_entropy = 0.0;
    let mut latency_ema = f64::from(l_count) * mean_lat;
    let mut latency_raw_prev = latency_ema;
    let mut brittle_ema = 0.0;
    let mut cum_overrides = 0.0;
    let mut cum_brittle = 0.0;

    let window_start = horizon.saturating_sub(20);
    let mut series: Vec<[f64; 16]> = Vec::with_capacity(horizon as usize);

    for t in 0..horizon {
        // Org-level AI injection is active from `atStep` onward (M9/M11).
        let ai_active = inject_enabled && t >= inject_at;

        // --- 1. Structure ---
        let n = (f64::from(org.headcount_start) + org.headcount_growth_per_step * f64::from(t))
            .round()
            .max(1.0) as u32;
        let nf = f64::from(n);
        let teams = team_count(n, org.topology, params);
        let s_size = nf / f64::from(teams);
        let mut m = (m0
            + params.p("misalignmentPerExtraTeam") * f64::from(teams.saturating_sub(t_at_start)))
        .clamp(0.0, 1.0);
        if federated {
            m *= params.p("federatedAutonomyFactor");
        }
        let c_intra = intra_channels(n, teams);
        let kappa = match org.topology {
            Topology::Flat => 0.0,
            Topology::Pods => params.p("topologyCouplingPods"),
            Topology::Hierarchical => params.p("topologyCouplingHierarchical"),
            Topology::Federated => params.p("topologyCouplingFederated"),
        };
        let c_inter = params.p("interTeamChannelCoefficient")
            * kappa
            * (f64::from(teams) * f64::from(teams - 1) / 2.0)
            * (1.0 + params.p("conwayMisalignmentPenalty") * m);
        let bands = cognitive_band(nf, params);
        // M9 coordination relief — only while the injection is active, and only
        // above the risk threshold (relief_ramp is 0 at SH <= shRiskThreshold).
        let relief_ai = if ai_active {
            ai_relief(sh, params)
        } else {
            0.0
        };
        let mu_modality = if meeting_heavy {
            params.p("meetingHeavyMultiplier")
        } else {
            1.0
        };
        let tau = (mu_modality
            * params.p("channelCostFraction")
            * ((c_intra + c_inter) / nf)
            * bands
            * (1.0 - relief_ai))
            .min(params.p("maxCoordinationTax"));
        let meeting_overhead = tau
            * if meeting_heavy {
                params.p("meetingShareMeetingHeavy")
            } else {
                params.p("meetingShareAsync")
            };

        // --- 2. Recovery windows ---
        let m_recovery = windows.iter().map(|w| w.1).fold(1.0, f64::max);
        for w in &mut windows {
            w.0 = w.0.saturating_sub(1);
        }
        windows.retain(|w| w.0 > 0);

        // --- 3. Arrivals ---
        let rate = params.p("taskArrivalPerPersonPerStep") * nf;
        let whole = rate.floor();
        let mut arrivals = whole as u32 + u32::from(rng.bernoulli(rate - whole));
        if t == 0 {
            arrivals += org.initial_backlog.unwrap_or(0);
        }
        // M11 novel exposure: an org-level active injection exposes novel work
        // fully (1.0); an aiAgent-typed seat exposes it at layerNovelExposure
        // even with no injection; max of the two.
        let novel_exposure = if ai_active {
            layer_exposure.max(1.0)
        } else {
            layer_exposure
        };
        let mut brittle_events_step = 0.0_f64;
        for _ in 0..arrivals {
            let class = draw_class(params, rng);
            let effort = draw_effort(class, params, rng);
            let brittle = class == TaskClass::Novel
                && novel_exposure > 0.0
                && rng.bernoulli(
                    params.p("aiNovelFailureBase") * sh_brittle_factor(sh, params) * novel_exposure,
                );
            if brittle {
                let dur = draw_recovery(org, params, rng);
                windows.push(dur);
                tasks.push(Task::arriving_blocked(
                    next_id,
                    t,
                    effort,
                    Stakes::Low,
                    dur.0,
                ));
                cum_brittle += 1.0;
                brittle_events_step += 1.0;
            } else {
                let mut service = rng.triangular(lat_tri[0], lat_tri[1], lat_tri[2])
                    * m_recovery
                    * layers[0].latency_factor
                    * layers[0].diffusion_latency_factor;
                // M11(b): AI routing accelerates ROUTINE service draws only, and
                // only in structurally healthy orgs (factor 1.0 at low SH).
                if ai_active && class == TaskClass::Routine {
                    service *= ai_routing;
                }
                record_entry(&mut layer_stats, 0, service, t, window_start);
                tasks.push(Task::arriving(
                    next_id,
                    t,
                    class,
                    Stakes::Low,
                    effort,
                    service,
                ));
            }
            next_id += 1;
        }

        // --- 4. Unblock ---
        // (Blocked tasks are Novel by construction — T2 fires on novel arrivals
        // only — so the M11(b) routine routing factor never applies here.)
        for task in tasks.iter_mut() {
            if task.state == TaskState::Blocked {
                task.block_remaining = task.block_remaining.saturating_sub(1);
                if task.block_remaining == 0 {
                    let service = rng.triangular(lat_tri[0], lat_tri[1], lat_tri[2])
                        * m_recovery
                        * layers[0].latency_factor
                        * layers[0].diffusion_latency_factor;
                    record_entry(&mut layer_stats, 0, service, t, window_start);
                    task.unblock(service);
                }
            }
        }

        // --- 5. Pipeline ---
        let mut latency_samples: Vec<f64> = Vec::new();
        for l in 1..=l_count {
            for task in tasks.iter_mut() {
                if task.state == TaskState::Queued(l) {
                    task.service_remaining -= 1.0;
                }
            }
            let mut ready: Vec<usize> = tasks
                .iter()
                .enumerate()
                .filter(|(_, t)| t.state == TaskState::Queued(l) && t.service_remaining <= 0.0)
                .map(|(i, _)| i)
                .collect();
            ready.sort_by(|&a, &b| {
                tasks[a]
                    .arrival_step
                    .cmp(&tasks[b].arrival_step)
                    .then(tasks[a].id.cmp(&tasks[b].id))
            });

            // M11(c): an active injection multiplies EVERY layer's capacity by
            // the uniform boost at ANY Structural Health (mechanical bandwidth
            // is structure-blind; its quality is M9's concern).
            let mut cap = params.p("layerCapacityPerStep")
                * params.p("layerCapacityDecay").powi(l as i32 - 1)
                * layers[l as usize - 1].capacity_factor;
            if ai_active {
                cap *= uniform_boost;
            }
            let budget = layer_acc[l as usize - 1] + cap;
            let moved = ready.len().min(budget.floor().max(0.0) as usize);

            for &idx in ready.iter().take(moved) {
                if l < l_count {
                    let mut service = rng.triangular(lat_tri[0], lat_tri[1], lat_tri[2])
                        * m_recovery
                        * layers[l as usize].latency_factor
                        * layers[l as usize].diffusion_latency_factor;
                    // M11(b): routine routing factor on the base service draw;
                    // the escalation surcharge below is a separate additive draw
                    // for unclear cross-cutting ownership — AI routing does not
                    // shrink it.
                    if ai_active && tasks[idx].class == TaskClass::Routine {
                        service *= ai_routing;
                    }
                    if l + 1 == l_count && rng.bernoulli(m * params.p("crossCutShare")) {
                        let esc = params.tri("escalationExtraDays");
                        service += rng.triangular(esc[0], esc[1], esc[2]);
                    }
                    record_entry(&mut layer_stats, l as usize, service, t, window_start);
                    tasks[idx].advance_layer(service);
                } else if let Some(sample) = tasks[idx].to_in_progress(t) {
                    latency_samples.push(sample);
                }
            }
            layer_acc[l as usize - 1] = (budget - moved as f64).min(1.0);
            if t >= window_start {
                let stat = &mut layer_stats[l as usize - 1];
                stat.util_sum += (moved as f64 / cap).min(1.0);
                stat.util_steps += 1;
            }
        }

        // --- 6. Overrides ---
        let mut override_events: u64 = 0;
        if l_count >= 2 {
            let o_raw = params.p("overrideBaseRate")
                * f64::from(l_count - 1)
                * (1.0 + params.p("overrideMisalignmentGain") * m)
                * (1.0 + params.p("distortionOverrideCoupling") * distortion)
                * diffusion_mean;
            let o = o_raw.min(1.0);
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
            for idx in ip {
                if rng.bernoulli(o) {
                    let seat = attribute_override(l_count, gradient, rng);
                    layer_stats[seat as usize - 1].override_events += 1;
                    tasks[idx].override_reset(kept_fraction);
                    override_events += 1;
                }
            }
        }
        cum_overrides += override_events as f64;

        // --- 7. Execution ---
        let mut pool = nf * params.p("orgExecPointsPerPersonPerStep") * (1.0 - tau);
        let max_per_task = params.p("maxPointsPerTaskPerStep");
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
            // M11(a): the uniform expected-value boost multiplies ROUTINE
            // allocations' progress credit (no per-task draw); the pool debit is
            // the human capacity g either way.
            let credit = if ai_active && tasks[idx].class == TaskClass::Routine {
                g * uniform_boost
            } else {
                g
            };
            tasks[idx].allocate(credit);
            pool -= g;
            if tasks[idx].is_complete() {
                tasks[idx].complete();
                throughput += 1.0;
            }
        }
        // Any inProgress task that completed on a prior allocation but not this
        // step is already Done; nothing else completes without allocation.

        // --- 8. Cohesion (report pre-update value) ---
        let cohesion_report = cohesion;
        // M12 org arm: effectiveAiShare = aiRoutineShareOrg × taskMixRoutineOrg
        // while the injection is active, else 0 (hollow is always false org-side).
        let ai_cohesion_penalty = if ai_active {
            params.p("cohesionAiPenalty") * ai_share
        } else {
            0.0
        };
        let target = cohesion_base
            - params.p("cohesionSizePenalty")
                * sigma(
                    (s_size - params.p("cognitiveBandClose"))
                        / (params.p("bandWidthFactor") * params.p("cognitiveBandClose")),
                )
            - ai_cohesion_penalty;
        let next_cohesion = (cohesion + params.p("cohesionRecoveryRate") * (target - cohesion)
            - params.p("cohesionEntropyCoupling")
                * (prev_entropy - params.p("entropyStressThreshold")).max(0.0)
                / 10.0)
            .clamp(0.0, 100.0);

        // --- 9. Metrics ---
        let wip = tasks.iter().filter(|t| t.is_wip()).count() as f64;
        let raw_latency = if latency_samples.is_empty() {
            latency_raw_prev
        } else {
            latency_samples.iter().sum::<f64>() / latency_samples.len() as f64
        };
        latency_ema = alpha * raw_latency + (1.0 - alpha) * latency_ema;
        latency_raw_prev = raw_latency;
        // §7.1: brittlenessRate = raw events this step (T2 fires only with an
        // active injection or an aiAgent-typed seat; 0 otherwise).
        let brittle_rate = brittle_events_step;
        brittle_ema = alpha * brittle_rate + (1.0 - alpha) * brittle_ema;

        let x_coord = tau / params.p("maxCoordinationTax");
        let x_lat = (latency_ema / params.p("latencyNormDays")).min(1.0);
        let x_coh = 1.0 - cohesion_report / 100.0;
        let x_brit = (brittle_ema / params.p("brittlenessNormPerStep")).min(1.0);
        let x_wip = (wip / (params.p("wipNormPerPerson") * nf)).min(1.0);
        let entropy = 100.0
            * (params.p("entropyWeightCoordination") * x_coord
                + params.p("entropyWeightLatency") * x_lat
                + params.p("entropyWeightCohesion") * x_coh
                + params.p("entropyWeightBrittleness") * x_brit
                + params.p("entropyWeightWip") * x_wip);
        let org_health = 100.0 - entropy;
        let velocity = 100.0
            / ((1.0 + f64::from(l_count - 1) * params.p("layerFrictionFactor"))
                * (latency_ema / (f64::from(l_count) * mean_lat)).max(1.0));

        let mut row = [0.0_f64; 16];
        row[M_THROUGHPUT] = throughput;
        row[M_ENTROPY] = entropy;
        row[M_ORG_HEALTH] = org_health;
        row[M_COORD_TAX] = tau;
        row[M_MEETING] = meeting_overhead;
        row[M_COMM_LOAD] = c_intra + c_inter;
        row[M_INTER_TEAM] = c_inter;
        row[M_LATENCY] = latency_ema;
        row[M_VELOCITY] = velocity;
        row[M_WIP] = wip;
        row[M_OVERRIDE_RATE] = override_events as f64;
        row[M_CUM_OVERRIDES] = cum_overrides;
        row[M_BRITTLE_RATE] = brittle_rate;
        row[M_CUM_BRITTLE] = cum_brittle;
        row[M_COHESION] = cohesion_report;
        row[M_HEALTH_GAP] = cohesion_report - org_health;
        series.push(row);

        // Final-20-step per-layer queue means.
        if t >= window_start {
            for l in 1..=l_count {
                let q = tasks
                    .iter()
                    .filter(|task| task.state == TaskState::Queued(l))
                    .count() as f64;
                let stat = &mut layer_stats[l as usize - 1];
                stat.queue_sum += q;
                stat.queue_steps += 1;
            }
        }

        prev_entropy = entropy;
        cohesion = next_cohesion;
    }

    OrgIterResult {
        series,
        layers: layer_stats,
    }
}

fn draw_class(params: &Params, rng: &mut SimRng) -> TaskClass {
    let routine = params.p("taskMixRoutineOrg");
    let complex = params.p("taskMixComplexOrg");
    let u = rng.uniform();
    if u < routine {
        TaskClass::Routine
    } else if u < routine + complex {
        TaskClass::Complex
    } else {
        TaskClass::Novel
    }
}

fn draw_effort(class: TaskClass, params: &Params, rng: &mut SimRng) -> f64 {
    let id = match class {
        TaskClass::Routine => "taskEffortRoutine",
        TaskClass::Complex => "taskEffortComplex",
        TaskClass::Novel => "taskEffortNovel",
    };
    let e = params.tri(id);
    rng.triangular(e[0], e[1], e[2])
}

fn sh_brittle_factor(sh: f64, params: &Params) -> f64 {
    let low = params.p("aiAmplificationLowSH");
    let high = params.p("aiGuardrailedHighSH");
    let risk = params.p("shRiskThreshold");
    let safe = params.p("shSafeThreshold");
    if sh <= risk {
        low
    } else if sh >= safe {
        high
    } else {
        low + (high - low) * (sh - risk) / (safe - risk)
    }
}

/// M9 relief ramp: `clamp((SH − shRiskThreshold)/(shSafeThreshold −
/// shRiskThreshold), 0, 1)` — 0 at/below the risk threshold, 1 at/above the
/// safe threshold. Shared by the coordination relief (M9) and the routine
/// routing factor (M11 b): AI helps coordination only in structurally
/// healthy orgs.
fn relief_ramp(sh: f64, params: &Params) -> f64 {
    let risk = params.p("shRiskThreshold");
    let safe = params.p("shSafeThreshold");
    ((sh - risk) / (safe - risk)).clamp(0.0, 1.0)
}

/// M9 AI coordination relief `relief_ai = aiCoordinationRelief ×
/// reliefRamp(SH)` — applied to τ only while the injection is active.
fn ai_relief(sh: f64, params: &Params) -> f64 {
    params.p("aiCoordinationRelief") * relief_ramp(sh, params)
}

/// M11(a)/(c) uniform expected-value boost `1 + aiRoutineShareOrg ×
/// (aiThroughputBoostOrg − 1)` — the closed-form mean of boosting the routine
/// share, applied deterministically (no per-task draw) to every routine
/// execution allocation AND to every decision layer's capacity at ANY
/// Structural Health (mechanical bandwidth is structure-blind; its QUALITY is
/// not — that is M9's job).
fn ai_uniform_boost(params: &Params) -> f64 {
    1.0 + params.p("aiRoutineShareOrg") * (params.p("aiThroughputBoostOrg") - 1.0)
}

/// M11(b) routine routing factor `1 − (1 − aiRoutineLatencyFactor) ×
/// reliefRamp(SH)` multiplying routine-task service draws while the injection
/// is active — AI routing accelerates routine decisions only in structurally
/// healthy orgs (identity 1.0 at SH ≤ shRiskThreshold).
fn ai_routing_factor(sh: f64, params: &Params) -> f64 {
    1.0 - (1.0 - params.p("aiRoutineLatencyFactor")) * relief_ramp(sh, params)
}

/// A brittleness recovery window `(duration steps, latency multiplier)` (M10).
fn draw_recovery(org: &OrgConfig, params: &Params, rng: &mut SimRng) -> (u32, f64) {
    let unowned = f64::from(org.structural_health) < params.p("recoveryOwnershipThreshold");
    let dur_tri = if unowned {
        params.tri("recoveryDurationUnownedSteps")
    } else {
        params.tri("recoveryDurationOwnedSteps")
    };
    let duration = rng
        .triangular(dur_tri[0], dur_tri[1], dur_tri[2])
        .round()
        .max(1.0) as u32;
    let mult = if unowned {
        let mt = params.tri("recoveryLatencyMultiplierUnowned");
        rng.triangular(mt[0], mt[1], mt[2])
    } else {
        params.p("recoveryLatencyMultiplierOwned")
    };
    (duration, mult)
}

fn record_entry(
    stats: &mut [LayerIterStats],
    layer_idx0: usize,
    service: f64,
    step: u32,
    window_start: u32,
) {
    if step >= window_start {
        stats[layer_idx0].latency_sum += service;
        stats[layer_idx0].latency_count += 1;
    }
}

/// Finalize a per-layer stat block into an output `PerLayer` (§7.1). Scalar
/// per-layer means come from one iteration; the Monte Carlo runner averages
/// these across iterations and stamps `overrideShare` / `bottleneck`.
pub fn layer_means(stat: &LayerIterStats) -> (f64, f64, f64) {
    let latency = if stat.latency_count > 0 {
        stat.latency_sum / f64::from(stat.latency_count)
    } else {
        stat.structural_latency
    };
    let queue = if stat.queue_steps > 0 {
        stat.queue_sum / f64::from(stat.queue_steps)
    } else {
        0.0
    };
    let util = if stat.util_steps > 0 {
        stat.util_sum / f64::from(stat.util_steps)
    } else {
        0.0
    };
    (latency, queue, util)
}

/// Assemble the final `PerLayer` vector from Monte-Carlo-averaged fields.
#[allow(clippy::too_many_arguments)]
pub fn make_per_layer(
    stat: &LayerIterStats,
    mean_latency: f64,
    mean_queue: f64,
    utilization: f64,
    override_share: f64,
    bottleneck: bool,
) -> PerLayer {
    PerLayer {
        layer: stat.layer,
        layer_type: stat.layer_type.to_string(),
        mean_latency_days: mean_latency,
        mean_queue,
        utilization,
        override_share,
        distortion: stat.distortion,
        owner_multiplicity: stat.mu,
        diffusion_factor: stat.diffusion_factor,
        bottleneck,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::run_json;
    use crate::output::{Output, Quantile};

    // ---- Hand-computed values (defaults from MODEL.md §9.5/§9.6; every
    // expected number below is derived by hand in the comment beside it). ----

    #[test]
    fn m9_sh_brittle_factor_hand_values() {
        let p = Params::defaults();
        // SH <= shRiskThreshold (4): aiAmplificationLowSH = 1.55.
        assert_eq!(sh_brittle_factor(3.0, &p), 1.55);
        assert_eq!(sh_brittle_factor(4.0, &p), 1.55);
        // SH >= shSafeThreshold (7): aiGuardrailedHighSH = 0.2.
        assert_eq!(sh_brittle_factor(7.0, &p), 0.2);
        assert_eq!(sh_brittle_factor(9.0, &p), 0.2);
        // Interpolation at SH 5: 1.55 + (0.2 - 1.55)*(5-4)/(7-4) = 1.55 - 0.45 = 1.1.
        assert!((sh_brittle_factor(5.0, &p) - 1.1).abs() < 1e-12);
    }

    #[test]
    fn m9_relief_ramp_and_relief_hand_values() {
        let p = Params::defaults();
        // Ramp: 0 at SH 3 (below risk 4), 1 at SH 7 (safe), 0.5 at SH 5.5.
        assert_eq!(relief_ramp(3.0, &p), 0.0);
        assert_eq!(relief_ramp(7.0, &p), 1.0);
        assert!((relief_ramp(5.5, &p) - 0.5).abs() < 1e-12);
        // relief = aiCoordinationRelief (0.35) * ramp.
        assert_eq!(ai_relief(3.0, &p), 0.0);
        assert!((ai_relief(7.0, &p) - 0.35).abs() < 1e-12);
        assert!((ai_relief(5.5, &p) - 0.175).abs() < 1e-12);
    }

    #[test]
    fn m11_uniform_boost_hand_value() {
        let p = Params::defaults();
        // 1 + aiRoutineShareOrg (0.6) * (aiThroughputBoostOrg (1.25) - 1) = 1.15.
        assert!((ai_uniform_boost(&p) - 1.15).abs() < 1e-12);
    }

    #[test]
    fn m11_routing_factor_hand_values() {
        let p = Params::defaults();
        // SH 3: ramp 0 => factor 1 (no routine acceleration on broken structure).
        assert_eq!(ai_routing_factor(3.0, &p), 1.0);
        // SH 7: 1 - (1 - aiRoutineLatencyFactor 0.25) * 1 = 0.25.
        assert!((ai_routing_factor(7.0, &p) - 0.25).abs() < 1e-12);
        // SH 5: ramp = 1/3 => 1 - 0.75/3 = 0.75.
        assert!((ai_routing_factor(5.0, &p) - 0.75).abs() < 1e-12);
    }

    #[test]
    fn m9_m11_brittleness_probability_hand_value() {
        let p = Params::defaults();
        // Novel arrival under active injection at SH 3, exposure 1:
        // aiNovelFailureBase (0.22) * shBrittleFactor(3) (1.55) * 1 = 0.341.
        let prob = p.p("aiNovelFailureBase") * sh_brittle_factor(3.0, &p) * 1.0;
        assert!((prob - 0.341).abs() < 1e-12);
    }

    #[test]
    fn m12_org_effective_ai_share_hand_value() {
        let p = Params::defaults();
        // effectiveAiShare = aiRoutineShareOrg (0.6) * taskMixRoutineOrg (0.6) = 0.36;
        // cohesion target penalty = cohesionAiPenalty (15) * 0.36 = 5.4 points.
        let share = p.p("aiRoutineShareOrg") * p.p("taskMixRoutineOrg");
        assert!((share - 0.36).abs() < 1e-12);
        assert!((p.p("cohesionAiPenalty") * share - 5.4).abs() < 1e-12);
    }

    #[test]
    fn m3_cognitive_bands_are_gradual_no_cliff() {
        let p = Params::defaults();
        // Derivative test (M3 "gradual, not cliffs"): B(n) is monotone
        // nondecreasing, and no single added person moves it by more than the
        // analytic bound sum_b bandPenalty_b * 0.25 / (bandWidthFactor * center_b)
        // (mean-value theorem on the logistic; sigma' <= 1/4). Hand value:
        // 0.05*0.25/(0.15*5) + 0.1*0.25/(0.15*15) + 0.12*0.25/(0.15*50)
        //   + 0.15*0.25/(0.15*150) = 0.016667 + 0.011111 + 0.004 + 0.001667
        //   = 0.033444... — a tiny fraction of the 0.42 total band range.
        let bound = 0.0334445;
        let mut prev = cognitive_band(1.0, &p);
        for n in 2..=500 {
            let b = cognitive_band(f64::from(n), &p);
            assert!(b >= prev, "B(n) must be nondecreasing at n={n}");
            assert!(
                b - prev <= bound,
                "B({n}) - B({}) = {} exceeds the no-cliff bound {bound}",
                n - 1,
                b - prev
            );
            prev = b;
        }
        // Total range check: B(1) ~= 1 and B(500) < 1 + sum of penalties (0.42).
        assert!(cognitive_band(500.0, &p) < 1.42);
    }

    // ---- Integration behavior (engine-level; these FAIL until the P4 wiring
    // lands: the P3 guard rejected aiInjection.enabled and brittlenessRate was
    // pinned to 0). ----

    fn org_cfg(sh: u32, enabled: bool, at_step: u32) -> String {
        format!(
            r#"{{"schemaVersion":"1","modelVersion":"2.0.0","sim":"org","seed":42,
            "iterations":60,"horizon":40,
            "org":{{"headcountStart":40,"headcountGrowthPerStep":0,"topology":"pods",
            "hierarchyDepth":3,"ownershipLayers":1,"initialBacklog":30,
            "modality":"meetingHeavy","structuralHealth":{sh},
            "aiInjection":{{"enabled":{enabled},"atStep":{at_step}}}}}}}"#
        )
    }

    fn p50_at(out: &Output, series: &str, t: u32) -> f64 {
        out.series_value(series, Quantile::P50, t).unwrap()
    }

    #[test]
    fn ai_injection_with_at_step_beyond_horizon_is_a_byte_identical_noop() {
        // enabled=true but atStep past the horizon: every per-step factor is the
        // neutral identity, so the series payload must be byte-identical to
        // enabled=false (the additive-no-op contract that protects the committed
        // cross-target hash and every P3 scenario).
        let off = run_json(&org_cfg(6, false, 0)).unwrap();
        let on_never = run_json(&org_cfg(6, true, 4_000_000_000)).unwrap();
        assert_eq!(
            serde_json::to_string(&off.series).unwrap(),
            serde_json::to_string(&on_never.series).unwrap(),
            "inactive injection must not perturb a single bit of the series"
        );
    }

    #[test]
    fn brittleness_rate_series_is_consistent_with_cumulative() {
        // Per-iteration invariant: final cumulativeBrittleness == sum over steps
        // of brittlenessRate (the P3 kernel pinned the rate to 0 while the
        // cumulative rose — this is the regression test for that inconsistency).
        let p = Params::defaults();
        let org: crate::config::OrgConfig = serde_json::from_str(
            r#"{"headcountStart":40,"headcountGrowthPerStep":0,"topology":"pods",
            "hierarchyDepth":3,"ownershipLayers":1,"initialBacklog":30,
            "modality":"meetingHeavy","structuralHealth":3,
            "aiInjection":{"enabled":true,"atStep":10}}"#,
        )
        .unwrap();
        let layers = crate::mechanics::resolve_layers(&org, &p);
        let mut rng = crate::rng::SimRng::for_iteration(42, 0);
        let it = run_iteration(&org, &p, &layers, 40, &mut rng);
        let rate_sum: f64 = it.series.iter().map(|row| row[M_BRITTLE_RATE]).sum();
        let cum_final = it.series.last().unwrap()[M_CUM_BRITTLE];
        assert!(
            cum_final > 0.0,
            "SH-3 injection must produce brittleness events"
        );
        assert_eq!(
            rate_sum, cum_final,
            "brittlenessRate must sum to cumulativeBrittleness"
        );
    }

    #[test]
    fn coordination_relief_applies_at_high_sh_only() {
        // M9: relief_ai > 0 only above the risk threshold. At SH 7 the with-AI
        // run's settled coordinationTax must sit below the no-AI run's; at SH 3
        // the ramp is 0 and tau must be bit-identical.
        let sh7_on = run_json(&org_cfg(7, true, 10)).unwrap();
        let sh7_off = run_json(&org_cfg(7, false, 0)).unwrap();
        let last = 39;
        assert!(
            p50_at(&sh7_on, "coordinationTax", last) < p50_at(&sh7_off, "coordinationTax", last),
            "SH-7 injection must relieve coordination tax"
        );
        let sh3_on = run_json(&org_cfg(3, true, 10)).unwrap();
        let sh3_off = run_json(&org_cfg(3, false, 0)).unwrap();
        assert_eq!(
            p50_at(&sh3_on, "coordinationTax", last).to_bits(),
            p50_at(&sh3_off, "coordinationTax", last).to_bits(),
            "SH-3 relief ramp is 0: tau must be untouched"
        );
    }

    #[test]
    fn cohesion_ai_penalty_lowers_settled_cohesion() {
        // M12 org arm: effectiveAiShare = 0.36 pulls the cohesion target down
        // 5.4 points while the injection is active.
        let on = run_json(&org_cfg(7, true, 10)).unwrap();
        let off = run_json(&org_cfg(7, false, 0)).unwrap();
        assert!(
            p50_at(&on, "cohesionTeamAvg", 39) < p50_at(&off, "cohesionTeamAvg", 39),
            "active injection must erode cohesion via the AI-share penalty"
        );
    }

    #[test]
    fn injection_boosts_throughput_into_the_backlog() {
        // M11(a)+(c): with a standing backlog, the uniform boost on routine
        // execution and layer bandwidth must lift near-term throughput after
        // injection relative to the no-AI twin (the "faster" in Faster
        // Dysfunction) — at low SH, where neither relief nor routing helps.
        let on = run_json(&org_cfg(3, true, 15)).unwrap();
        let off = run_json(&org_cfg(3, false, 0)).unwrap();
        let window = |o: &Output, a: u32, b: u32| -> f64 {
            (a..=b).map(|t| p50_at(o, "throughput", t)).sum::<f64>() / f64::from(b - a + 1)
        };
        assert!(
            window(&on, 16, 22) > window(&off, 16, 22),
            "post-injection throughput must beat the no-AI twin in the same window"
        );
    }
}
