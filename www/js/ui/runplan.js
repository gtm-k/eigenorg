// eigenorg run planning — pure logic (node-tested, no DOM).
//
// A "full result" is up to three sequential engine runs through the ONE
// serialized engine-client queue (CONTRACTS §2 — exactly one in-flight run
// per worker):
//   primary   — the config as configured,
//   contrast  — the before/after pane's Structural-Health twin
//               (same org, SH varied; PLAN P5: "same org, AI injected,
//               SH 3 vs 7" on the landing preset),
//   aiOff     — the AI-injection counterfactual twin (only when the primary
//               has an active injection) for the UI-computed delta chart
//               (MODEL.md §7.1: the delta view is the pointwise difference
//               of two runs' series — the engine emits no delta series).

/** Healthy / broken Structural Health poles for the contrast twin. */
export const SH_HEALTHY = 7;
export const SH_BROKEN = 3;

/**
 * @param {any} value
 * @returns {any} deep copy (configs are plain JSON)
 */
export function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Whether a config has an ACTIVE AI injection (enabled and inside the horizon).
 * @param {any} config
 * @returns {boolean}
 */
export function hasActiveAiInjection(config) {
  const inj = config?.org?.aiInjection;
  return Boolean(inj?.enabled) && Number(inj?.atStep) < Number(config?.horizon ?? 0);
}

/**
 * The contrast twin's Structural Health: orgs at SH ≥ 6 are contrasted with
 * the broken pole (SH 3), fragile orgs with the healthy pole (SH 7) — the
 * pane always tells the broken-vs-healthy story. On the landing preset
 * (SH 3) this yields exactly SH 3 vs SH 7.
 * @param {number} sh
 * @returns {number}
 */
export function contrastStructuralHealth(sh) {
  return sh >= 6 ? SH_BROKEN : SH_HEALTHY;
}

/**
 * @typedef {{ primary: any, contrast: any, aiOff: any | null,
 *             beforeSh: number, afterSh: number,
 *             primaryIsBefore: boolean, runCount: number }} RunPlan
 */

/**
 * Build the run plan for one click of Run. All twins are deep copies varying
 * ONLY the stated org field, so a replayed config's paramOverrides/replay
 * flag ride along unchanged (the recipient's pane reproduces the sender's).
 *
 * The pane shows the LOWER Structural Health on the left ("before") and the
 * higher on the right ("after").
 *
 * @param {any} config the config to run (authored, or a replay config)
 * @returns {RunPlan}
 */
export function buildRunPlan(config) {
  const primary = deepCopy(config);
  const sh = Number(primary.org.structuralHealth);
  const contrastSh = contrastStructuralHealth(sh);
  const contrast = deepCopy(primary);
  contrast.org.structuralHealth = contrastSh;

  const aiOff = hasActiveAiInjection(primary) ? deepCopy(primary) : null;
  if (aiOff) {
    aiOff.org.aiInjection = { enabled: false, atStep: 0 };
  }

  const primaryIsBefore = sh <= contrastSh;
  return {
    primary,
    contrast,
    aiOff,
    beforeSh: Math.min(sh, contrastSh),
    afterSh: Math.max(sh, contrastSh),
    primaryIsBefore,
    runCount: aiOff ? 3 : 2,
  };
}

/**
 * Pointwise p50 difference a − b (MODEL.md §7.1 delta view). Series are tidy
 * percentile arrays [{t, p10, p50, p90}] over the same horizon.
 * @param {Array<{t: number, p50: number}>} a
 * @param {Array<{t: number, p50: number}>} b
 * @returns {Array<{t: number, v: number}>}
 */
export function deltaSeries(a, b) {
  const n = Math.min(a.length, b.length);
  /** @type {Array<{t: number, v: number}>} */
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ t: a[i].t, v: a[i].p50 - b[i].p50 });
  }
  return out;
}

/**
 * Final-step p50 of a tidy percentile series.
 * @param {Array<{t: number, p50: number}>} series
 * @returns {number}
 */
export function finalP50(series) {
  return series[series.length - 1].p50;
}

/**
 * Max p90 across one or more tidy percentile series (shared-y-axis helper for
 * the before/after pane — comparability requires one scale).
 * @param {Array<Array<{p90: number}>>} seriesList
 * @returns {number}
 */
export function maxP90(seriesList) {
  let max = 0;
  for (const series of seriesList) {
    for (const p of series) {
      if (p.p90 > max) max = p.p90;
    }
  }
  return max;
}

/**
 * Headcount at step t (MODEL.md §3.3): n(t) = round(start + growth × t).
 * @param {any} config
 * @param {number} t
 * @returns {number}
 */
export function headcountAt(config, t) {
  return Math.round(Number(config.org.headcountStart) + Number(config.org.headcountGrowthPerStep) * t);
}

/**
 * Steps at which headcount first crosses each cognitive band center
 * (annotation data for the communication-load chart; the band centers come
 * from the output's `bandMarkers` echo — MODEL.md §7.1).
 *
 * @param {any} config
 * @param {number[]} bandMarkers the four band centers, e.g. [5, 15, 50, 150]
 * @returns {Array<{ t: number, center: number, label: string }>}
 */
export function computeBandCrossings(config, bandMarkers) {
  const horizon = Number(config.horizon);
  /** @type {Array<{ t: number, center: number, label: string }>} */
  const crossings = [];
  for (const center of bandMarkers) {
    if (headcountAt(config, 0) >= center) continue; // crossed before t=0
    // The series spans t = 0..horizon-1; a crossing at t = horizon would
    // annotate off the right edge, so scan only the valid indices.
    for (let t = 1; t < horizon; t += 1) {
      if (headcountAt(config, t) >= center) {
        crossings.push({ t, center, label: `≈${center} people` });
        break;
      }
    }
  }
  return crossings;
}

// ---- run-lifecycle decisions (P5b-F1, pure + node-tested) ---------------------

/**
 * Stale-generation completion policy. main.js keeps a monotonic `generation`
 * counter that any staged config change bumps (a control edit, a preset pick,
 * or a share-link boot); runAll captures it at plan start. When a plan
 * finishes, compare the captured generation with the live one:
 *   - EQUAL → the charts still describe the config the controls show: paint
 *     and arm the share button.
 *   - DIFFERENT → the config changed under the plan: its charts/controls no
 *     longer agree. The completion is STALE — never arm share for it (it would
 *     share a config the controls contradict) and never let its success status
 *     overwrite the "configuration changed — run to update" warning.
 *
 * @param {number} planGeneration the generation captured when the plan started
 * @param {number} currentGeneration the live generation counter at completion
 * @returns {{ stale: boolean, armShare: boolean }}
 */
export function completionPolicy(planGeneration, currentGeneration) {
  const stale = planGeneration !== currentGeneration;
  return { stale, armShare: !stale };
}

/**
 * Decision 6: which mid-run interaction auto-runs. A preset pick is an explicit
 * "show me this scenario" action, so when it lands while a plan is in flight the
 * in-flight plan is cancelled and the picked preset is auto-run once the
 * cancelled plan unwinds. A plain control edit only stages config (it sets the
 * "configuration changed — run to update" status and waits for an explicit Run),
 * and a Run/Cancel click mid-run is just the cancel toggle — neither auto-runs.
 *
 * @param {'preset' | 'edit' | 'run'} interaction
 * @returns {boolean} whether this interaction should auto-run after a cancel
 */
export function autoRunsOnInteraction(interaction) {
  return interaction === 'preset';
}
