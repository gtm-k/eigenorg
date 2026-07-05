//! Org Entropy Simulator — one Monte Carlo iteration (MODEL.md §5.1).
//!
//! Executes the normative step order exactly (structure → recovery → arrivals →
//! unblock → pipeline → overrides → execution → cohesion → metrics); the §5 draw
//! order is part of the reproducibility contract (§8.1). Scope note (PLAN P3b):
//! this implements the mechanics that §10.1 + §10.7–10.9 reference — structure
//! (M1–M5), the decision pipeline (M6), overrides + accountability diffusion
//! (M8/M19), cohesion (M12), and the entropy composite (M13). The AI-injection
//! execution boost / coordination relief (M11 a–c) and per-layer AI novel
//! exposure stay P4; they are exact no-ops for every P3b scenario (no config
//! enables AI), so leaving them out changes no required series.

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
        // AI relief is 0 for every P3b scenario (no injection); kept explicit.
        let relief_ai = 0.0;
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
        for _ in 0..arrivals {
            let class = draw_class(params, rng);
            let effort = draw_effort(class, params, rng);
            // novelExposure is 0 for every P3b scenario; the brittleness branch
            // is dead code for them but keeps the FSM's T2/T8 path honest.
            let novel_exposure = layers
                .iter()
                .map(|s| s.novel_exposure)
                .fold(0.0_f64, f64::max);
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
            } else {
                let service = rng.triangular(lat_tri[0], lat_tri[1], lat_tri[2])
                    * m_recovery
                    * layers[0].latency_factor
                    * layers[0].diffusion_latency_factor;
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

            let cap = params.p("layerCapacityPerStep")
                * params.p("layerCapacityDecay").powi(l as i32 - 1)
                * layers[l as usize - 1].capacity_factor;
            let budget = layer_acc[l as usize - 1] + cap;
            let moved = ready.len().min(budget.floor().max(0.0) as usize);

            for &idx in ready.iter().take(moved) {
                if l < l_count {
                    let mut service = rng.triangular(lat_tri[0], lat_tri[1], lat_tri[2])
                        * m_recovery
                        * layers[l as usize].latency_factor
                        * layers[l as usize].diffusion_latency_factor;
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
            tasks[idx].allocate(g);
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
        let target = cohesion_base
            - params.p("cohesionSizePenalty")
                * sigma(
                    (s_size - params.p("cognitiveBandClose"))
                        / (params.p("bandWidthFactor") * params.p("cognitiveBandClose")),
                );
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
        let brittle_rate = 0.0; // no AI in any P3b scenario
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
