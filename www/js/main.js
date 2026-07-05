// eigenorg UI thread — thin coordinator (PLAN P5b).
// Landing: Faster Dysfunction pre-loaded, ONE click to full results.
// A full result = up to three sequential runs through the serialized
// engine-client queue (primary + Structural-Health contrast twin for the
// before/after pane + AI-off twin for the delta chart — see ui/runplan.js).
//
// This file must never import www/pkg (ci.yml grep gate) — only worker.js
// talks to the wasm.

import { createEngineClient, createWorkerTransport } from './engine-client.js';
import { createPercentileChart, updatePercentileChart } from './charts/entropy.js';
import { createDeltaChart, updateDeltaChart, createHealthChart, updateHealthChart } from './charts/lines.js';
import {
  buildRunPlan,
  deltaSeries,
  finalP50,
  maxP90,
  computeBandCrossings,
  hasActiveAiInjection,
  completionPolicy,
  autoRunsOnInteraction,
  stagesGeneration,
} from './ui/runplan.js';
import { renderControls } from './ui/org.js';
import { renderConfigurator, allHumanTwin, hasNonHumanLayer } from './ui/prioritization.js';
import { PRESET_REFS, DEFAULT_PRESET_ID, fetchPreset, primaryRunConfig, renderPresetPicker } from './ui/presets.js';
import { meaningFor, paneHeading } from './ui/meaning.js';
import { readShareFromHash, wireShareButton } from './ui/share.js';
import { fetchAssumptions, renderAssumptionsDrawer } from './ui/assumptions.js';
import { modelVersionBanner, extractShareFragment } from './url-codec.js';

/** @param {string} sel @returns {HTMLElement} */
function el(sel) {
  const node = document.querySelector(sel);
  if (!node) throw new Error(`missing element: ${sel}`);
  return /** @type {HTMLElement} */ (node);
}

/** @param {HTMLElement} node @param {string} text @param {'ok' | 'error' | ''} tone */
function setStatus(node, text, tone = '') {
  node.textContent = text;
  node.classList.remove('ok', 'error');
  if (tone) node.classList.add(tone);
}

// ---- engine wiring (real worker transport) -----------------------------------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const client = createEngineClient(createWorkerTransport(worker));

// ---- elements ------------------------------------------------------------------

const runButtons = [
  /** @type {HTMLButtonElement} */ (el('#run-button')),
  /** @type {HTMLButtonElement} */ (el('#run-button-2')),
  /** @type {HTMLButtonElement} */ (el('#run-button-3')), // P6 configurator section run trigger
];
const progressBar = /** @type {HTMLProgressElement} */ (el('#run-progress'));
const statusEl = el('#run-status');
const bannerEl = el('#replay-banner');
const shareButton = /** @type {HTMLButtonElement} */ (el('#share-button'));
const shareStatusEl = el('#share-status');
const bottleneckBadge = el('#bottleneck-badge');
const deltaEmpty = el('#delta-empty');
const deltaBox = /** @type {HTMLElement} */ (el('#delta-chart').closest('.chart-box'));

// ---- charts ---------------------------------------------------------------------

const charts = {
  paneBefore: createPercentileChart(/** @type {HTMLCanvasElement} */ (el('#pane-before-chart')), {
    label: 'entropy',
    unit: 'entropy 0–100',
  }),
  paneAfter: createPercentileChart(/** @type {HTMLCanvasElement} */ (el('#pane-after-chart')), {
    label: 'entropy',
    unit: 'entropy 0–100',
  }),
  entropy: createPercentileChart(/** @type {HTMLCanvasElement} */ (el('#entropy-chart')), {
    label: 'entropy',
    unit: 'entropy index (0–100)',
  }),
  velocity: createPercentileChart(/** @type {HTMLCanvasElement} */ (el('#velocity-chart')), {
    label: 'decision velocity',
    unit: 'index (0–100)',
  }),
  communication: createPercentileChart(/** @type {HTMLCanvasElement} */ (el('#comm-chart')), {
    label: 'channels',
    unit: 'open channels',
  }),
  delta: createDeltaChart(/** @type {HTMLCanvasElement} */ (el('#delta-chart'))),
  meetings: createPercentileChart(/** @type {HTMLCanvasElement} */ (el('#meetings-chart')), {
    label: 'meeting overhead',
    unit: '% of capacity',
    percent: true,
  }),
  health: createHealthChart(/** @type {HTMLCanvasElement} */ (el('#health-chart'))),
};

// ---- state ----------------------------------------------------------------------

/** @type {any} */
const state = {
  presetId: DEFAULT_PRESET_ID,
  /** @type {Map<string, any>} */ presets: new Map(),
  /** @type {any} */ config: null,
  /** @type {any} */ replayPayload: null, // set while showing an un-edited share link
  planCancelled: false,
  // Monotonic config generation (P5b-F1). Bumped by every staged config change
  // (control edit, preset pick, share-link boot); runAll captures it at plan
  // start so a completion whose generation no longer matches is treated as
  // stale (never painted over the current view, never arms share).
  generation: 0,
  // A preset pick that lands mid-run sets this so the in-flight plan's unwind
  // auto-runs the picked preset (decision 6). A control edit / Cancel clears it.
  pendingRerun: false,
};

// Probe hook for the scripted acceptance measurements (Playwright): exposes
// the last plan's primary output + timings. Read-only diagnostics; carries
// nothing that isn't already on the page.
/** @type {any} */
const probe = { lastPlan: null, shareFragment: null, bootReadyMs: null };
/** @type {any} */ (window).__eigenorg = probe;

/** @param {string} id @param {string} text */
function setMeaning(id, text) {
  el(`#meaning-${id}`).textContent = text;
}

/** @param {boolean} running */
function setRunButtons(running) {
  for (const b of runButtons) {
    b.textContent = running ? 'Cancel run' : 'Run simulation';
    b.disabled = false;
  }
}

/** @param {any} run @param {HTMLElement} dl render the pane card stat row */
function renderStats(dl, run) {
  const stats = [
    ['Decision latency', `${finalP50(run.output.series.decisionLatency).toFixed(1)} days`],
    ['Coordination tax', `${Math.round(finalP50(run.output.series.coordinationTax) * 100)}%`],
    ['Throughput', `${finalP50(run.output.series.throughput).toFixed(1)}/step`],
  ];
  dl.textContent = '';
  for (const [label, value] of stats) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    div.append(dt, dd);
    dl.appendChild(div);
  }
}

// ---- run flow -------------------------------------------------------------------

/**
 * Execute one full plan (2–3 sequential runs) and paint every panel.
 * @returns {Promise<void>}
 */
async function runAll() {
  if (client.busy) {
    // Run/Cancel toggle: an explicit click cancels the in-flight plan and
    // drops any queued auto-rerun. (A preset pick uses requestRun('preset'),
    // which sets pendingRerun BEFORE cancelling — decision 6.)
    state.pendingRerun = false;
    state.planCancelled = true;
    client.cancel();
    return;
  }

  // Capture the generation this plan runs at. If the config changes under it
  // (an edit/preset/share-boot bumps state.generation), the completion is
  // stale — see completionPolicy below (P5b-F1).
  const planGeneration = state.generation;
  const replayPayload = state.replayPayload;
  const baseConfig = replayPayload ? state.replayConfig : state.config;
  const plan = buildRunPlan(baseConfig);
  // P6 legibility twin: when the configurator's compare toggle is on AND the
  // stack has a non-humanPm seat (an all-human twin would otherwise be an
  // identical, wasted run — D3), append one sequential all-human run through
  // the SAME serialized client (CONTRACTS §2; the sequential-pair decision is
  // BINDING). Off by default → the landing plan is byte-identical (test 14).
  const wantLayerTwin = configurator.getCompareOn() && hasNonHumanLayer(baseConfig);
  const totalRuns = plan.runCount + (wantLayerTwin ? 1 : 0);
  const iterations = Number(plan.primary.iterations);
  const totalWork = iterations * totalRuns;

  state.planCancelled = false;
  setRunButtons(true);
  progressBar.max = totalWork;
  progressBar.value = 0;
  shareButton.disabled = true;

  /** @param {number} runIndex @returns {(p: { completedCount: number, totalIterations: number }) => void} */
  const onProgress = (runIndex) => ({ completedCount }) => {
    progressBar.value = runIndex * iterations + completedCount;
    setStatus(statusEl, `running… ${progressBar.value}/${totalWork} iterations (${totalRuns} runs)`, '');
  };

  const tPlan0 = performance.now();
  try {
    setStatus(statusEl, `running… 0/${totalWork} iterations (${totalRuns} runs)`, '');

    const t0 = performance.now();
    const primary = await client.run({ config: plan.primary, onProgress: onProgress(0) });
    const primaryElapsedMs = performance.now() - t0;

    if (state.planCancelled) throw Object.assign(new Error('run cancelled'), { cancelled: true });
    const contrast = await client.run({ config: plan.contrast, onProgress: onProgress(1) });

    /** @type {any} */
    let aiOff = null;
    if (plan.aiOff) {
      if (state.planCancelled) throw Object.assign(new Error('run cancelled'), { cancelled: true });
      aiOff = await client.run({ config: plan.aiOff, onProgress: onProgress(2) });
    }

    /** @type {any} */
    let layerTwin = null;
    if (wantLayerTwin) {
      if (state.planCancelled) throw Object.assign(new Error('run cancelled'), { cancelled: true });
      // allHumanTwin preserves replay/paramOverrides, so a replayed pair runs
      // on the same coefficients (twin philosophy — runplan.js). Its index is
      // plan.runCount (after primary/contrast/[aiOff]).
      layerTwin = await client.run({ config: allHumanTwin(baseConfig), onProgress: onProgress(plan.runCount) });
    }

    const planElapsedMs = performance.now() - tPlan0;
    // Late-cancel race (P5b-F1(d)): a cancel that arrived while the final run
    // was already resolving must not paint a plan the user cancelled.
    if (state.planCancelled) throw Object.assign(new Error('run cancelled'), { cancelled: true });

    const { stale } = completionPolicy(planGeneration, state.generation);
    if (stale) {
      // The config changed while this plan ran (an edit, preset pick or share
      // boot bumped the generation): these charts describe a config the
      // controls no longer show. Do NOT paint them over the current view and
      // do NOT arm share; re-assert the "configuration changed" warning in case
      // a progress tick overwrote it. (No silent chart/controls mismatch; no
      // share armed for a config the controls no longer show.)
      setStatus(statusEl, 'configuration changed — run to update the charts', '');
    } else {
      paintResults({ plan, primary, contrast, aiOff, layerTwin, totalRuns, primaryElapsedMs, planElapsedMs, replayPayload });
    }
  } catch (err) {
    if (/** @type {any} */ (err).cancelled) {
      setStatus(statusEl, 'run cancelled', '');
    } else {
      setStatus(statusEl, `run failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  } finally {
    setRunButtons(false);
    progressBar.value = 0;
    // A preset picked mid-run scheduled an auto-rerun (decision 6). Now that the
    // cancelled plan has fully unwound and the client is idle, run the picked
    // preset. queueMicrotask defers past this finally so runAll re-enters clean.
    if (state.pendingRerun) {
      state.pendingRerun = false;
      window.queueMicrotask(() => void runAll());
    }
  }
}

/**
 * Paint every panel from a completed plan.
 * @param {{ plan: any, primary: any, contrast: any, aiOff: any, layerTwin: any,
 *           totalRuns: number, primaryElapsedMs: number, planElapsedMs: number,
 *           replayPayload: any }} r
 */
function paintResults(r) {
  const { plan, primary, contrast, aiOff, layerTwin } = r;
  const config = plan.primary;
  const output = primary.output;

  // --- before/after pane (lower SH left, shared y scale) ---
  const beforeRun = plan.primaryIsBefore ? primary : contrast;
  const afterRun = plan.primaryIsBefore ? contrast : primary;
  const paneMax = Math.min(100, Math.ceil(maxP90([beforeRun.output.series.entropy, afterRun.output.series.entropy]) / 10) * 10);
  updatePercentileChart(charts.paneBefore, beforeRun.output.series.entropy, { yMax: paneMax });
  updatePercentileChart(charts.paneAfter, afterRun.output.series.entropy, { yMax: paneMax });
  el('#pane-before-label').textContent = `Structural Health ${plan.beforeSh}`;
  el('#pane-after-label').textContent = `Structural Health ${plan.afterSh}`;
  el('#pane-before-tag').hidden = !plan.primaryIsBefore;
  el('#pane-after-tag').hidden = plan.primaryIsBefore;
  // Heading tracks whether AI is actually active in this pair (4/5 presets run
  // the pane with AI off; the static default is the neutral copy).
  el('#pane-heading').textContent = paneHeading(config);
  renderStats(el('#pane-before-stats'), beforeRun);
  renderStats(el('#pane-after-stats'), afterRun);
  setMeaning('pane', meaningFor('pane', {
    config,
    beforeSh: plan.beforeSh,
    afterSh: plan.afterSh,
    beforeFinal: finalP50(beforeRun.output.series.entropy),
    afterFinal: finalP50(afterRun.output.series.entropy),
  }));

  // --- entropy (+ injection marker) ---
  const aiOn = hasActiveAiInjection(config);
  const entropyMarkers = aiOn ? [{ t: Number(config.org.aiInjection.atStep), label: 'AI injected' }] : [];
  updatePercentileChart(charts.entropy, output.series.entropy, { markers: entropyMarkers });
  // Pass output so the fragile/absorbs boundary derives from the model's
  // resolvedParams.shRiskThreshold (P5b-F1 fold; no hardcoded threshold).
  setMeaning('entropy', meaningFor('entropy', { config, output }));

  // --- decision velocity + bottleneck badge ---
  updatePercentileChart(charts.velocity, output.series.decisionVelocity);
  /** @type {any} */
  const bn = output.perLayer.find((/** @type {any} */ l) => l.bottleneck);
  if (bn) {
    bottleneckBadge.textContent = `Bottleneck: layer ${bn.layer} (${bn.layerType}) — ${Math.round(bn.utilization * 100)}% utilized`;
    bottleneckBadge.hidden = false;
  } else {
    bottleneckBadge.hidden = true;
  }
  setMeaning('velocity', meaningFor('velocity', { config, output }));

  // --- communication load + cognitive band crossings ---
  const crossings = computeBandCrossings(config, output.bandMarkers);
  updatePercentileChart(charts.communication, output.series.communicationLoad, {
    markers: crossings.map((c) => ({ t: c.t, label: c.label })),
  });
  setMeaning('communication', meaningFor('communication', { config, crossings }));

  // --- AI injection delta (UI-computed pointwise diff, MODEL.md §7.1) ---
  if (aiOff) {
    const entropyDelta = deltaSeries(output.series.entropy, aiOff.output.series.entropy);
    const throughputDelta = deltaSeries(output.series.throughput, aiOff.output.series.throughput);
    updateDeltaChart(charts.delta, entropyDelta, throughputDelta);
    deltaBox.hidden = false;
    deltaEmpty.hidden = true;
    const peak = entropyDelta.reduce((m, p) => Math.max(m, p.v), -Infinity);
    setMeaning('delta', meaningFor('delta', { config, entropyDeltaPeak: peak }));
  } else {
    deltaBox.hidden = true;
    deltaEmpty.textContent = meaningFor('delta', { config });
    deltaEmpty.hidden = false;
    setMeaning('delta', 'Pointwise difference, AI minus no-AI, on this exact org.');
  }

  // --- meeting overhead % ---
  updatePercentileChart(charts.meetings, output.series.meetingOverheadPct);
  setMeaning('meetings', meaningFor('meetings', { config, output }));

  // --- multi-level health ---
  updateHealthChart(charts.health, output.series.orgHealth, output.series.cohesionTeamAvg);
  setMeaning('health', meaningFor('health', { config, output }));

  // --- readout + status + share ---
  el('#ro-model').textContent = `model v${output.modelVersion}`;
  el('#ro-seed').textContent = `seed ${config.seed}`;
  el('#ro-iters').textContent = `${output.iterations} iterations × ${r.totalRuns} runs`;
  el('#ro-elapsed').textContent = `${(r.primaryElapsedMs / 1000).toFixed(2)} s/run · ${(r.planElapsedMs / 1000).toFixed(2)} s total`;
  const replayNote = r.replayPayload ? 'replayed from the shared link — ' : '';
  setStatus(
    statusEl,
    `${replayNote}${r.totalRuns} runs × ${output.iterations} iterations in ${(r.planElapsedMs / 1000).toFixed(2)} s — entropy p50 ends at ${finalP50(output.series.entropy).toFixed(1)}`,
    'ok',
  );

  // --- P6 configurator: flow diagram + recovery indicator + all-human
  //     comparison, all from THIS run's snapshot (never the edit buffer — B4).
  configurator.renderRun(
    { config: plan.primary, output },
    layerTwin ? { output: layerTwin.output } : null,
  );

  share.arm(plan.primary, output);

  // Replay banner: informational, computed against the version the engine
  // actually stamped on this output (decision log round 1).
  if (r.replayPayload) {
    const banner = modelVersionBanner(r.replayPayload, output.modelVersion);
    bannerEl.hidden = !banner.mismatch;
    if (banner.mismatch && banner.message) bannerEl.textContent = banner.message;
  } else {
    bannerEl.hidden = true;
  }

  probe.lastPlan = {
    replay: Boolean(r.replayPayload),
    runCount: plan.runCount,
    iterations: output.iterations,
    primaryElapsedMs: r.primaryElapsedMs,
    planElapsedMs: r.planElapsedMs,
    primaryOutputJson: primary.outputJson,
    primaryConfig: plan.primary,
  };
}

// ---- config-change plumbing (P5b-F1) ----------------------------------------------

/**
 * Clear a stale '#s=' share fragment from the address bar once the user authors
 * or picks a new config — otherwise a manual address-bar copy would share the
 * pre-edit run (the same misattribution class the generation guard prevents).
 * No-op when the hash holds no share fragment (preserves a live replay link).
 */
function clearShareHash() {
  if (extractShareFragment(window.location.hash) === null) return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}`);
}

/**
 * Advance the monotonic generation for a staged interaction (P5b-F1 + MED-1).
 * Every staged-change entry point routes its bump through the ONE `stagesGeneration`
 * policy (runplan.js) so what invalidates an in-flight plan lives in a single,
 * node-tested place. A no-op for interactions that stage nothing (a Run/Cancel
 * toggle never reaches here).
 * @param {'edit' | 'preset' | 'shareBoot' | 'compareToggle'} interaction
 */
function stageGeneration(interaction) {
  if (stagesGeneration(interaction)) state.generation += 1;
}

/**
 * A staged config change (a control edit or a preset pick): bump the generation
 * so any in-flight plan's completion is treated as stale, leave replay mode,
 * disarm the now-stale share button, and drop a stale share fragment.
 * @param {'edit' | 'preset'} interaction which config-authoring entry staged this
 */
function stageConfigChange(interaction) {
  stageGeneration(interaction);
  state.replayPayload = null; // editing/picking = authoring (CONTRACTS §4)
  state.replayConfig = null;
  share.disarm(); // (e) no share until a matching fresh run completes
  clearShareHash();
}

/**
 * Run the current config now, or — when a plan is in flight and the interaction
 * auto-runs (a preset pick; decision 6) — cancel the in-flight plan and auto-run
 * once it unwinds (runAll's finally consumes pendingRerun). A non-auto-run
 * interaction while busy does nothing here: the staged config waits for an
 * explicit Run.
 * @param {'preset' | 'run'} interaction
 */
function requestRun(interaction) {
  if (client.busy) {
    if (autoRunsOnInteraction(interaction)) {
      state.pendingRerun = true;
      state.planCancelled = true;
      client.cancel();
    }
    return;
  }
  void runAll();
}

// ---- controls / presets -----------------------------------------------------------

/** @type {{ setActive: (id: string) => void }} */
let picker = { setActive: () => {} }; // real picker mounts in boot(), after labels load

/**
 * Shared staged-config-change handler for BOTH the org controls and the P6
 * configurator — they edit ONE canonical config through ONE surface (the
 * single-state rule that closes B5). A control edit or a layer-stack edit
 * stages config and prompts a re-run; it never auto-runs (decision 6). Any
 * in-flight plan keeps running but is now stale and will re-assert this warning
 * on completion instead of painting / arming share.
 * @param {any} next
 */
function stageAndRefresh(next) {
  state.config = next;
  stageConfigChange('edit');
  state.pendingRerun = false; // an edit cancels a pending preset auto-run
  picker.setActive('');
  el('#preset-note').textContent = 'Custom configuration — changes apply on the next run.';
  controls.refresh();
  configurator.refresh();
  setStatus(statusEl, 'configuration changed — run to update the charts', '');
}

const controls = renderControls(el('#org-controls'), {
  getConfig: () => state.config,
  onConfigChange: stageAndRefresh,
});

// P6 configurator — SUBSUMES P5's ownership-layers control (decision 4): the
// single editing surface for layer structure, wired to the SAME config-change
// handler as the org controls (so share/replay stay free — §2).
const configurator = renderConfigurator(el('#configurator'), {
  getConfig: () => state.config,
  onConfigChange: stageAndRefresh,
  onCompareToggle() {
    // Toggling compare changes the NEXT run's SHAPE (add/drop the sequential
    // all-human twin). It is a staged RUN-SHAPE change — the same class as a
    // config edit (P5b-F1) — because an in-flight plan captured the OLD compare
    // state (thus the old wantLayerTwin). Bump the generation so that plan
    // completes STALE: completionPolicy then keeps it from painting the compare/
    // legibility panel for the old shape (the no-twin note under a checked box)
    // or overwriting this prompt with a success status (MED-1). A compare toggle
    // authors NO new config, so — unlike stageConfigChange — replay mode and the
    // '#s=' hash are PRESERVED; only the run shape is staged. But the last run's
    // charts no longer match the pending shape, so disarm share (staged-change
    // convention). Never auto-run (decision 6).
    stageGeneration('compareToggle');
    share.disarm();
    setStatus(statusEl, 'comparison changed — run to update the all-human comparison', '');
  },
});

/** @param {any} preset */
function presetNote(preset) {
  return `${preset.label} — materialized verbatim from ${String(preset.source).replace(' (normative scenario config, materialized verbatim)', '')}.`;
}

const share = wireShareButton(shareButton, shareStatusEl, {
  onFragment(fragment) {
    probe.shareFragment = fragment;
  },
});

for (const b of runButtons) b.addEventListener('click', () => void runAll());

// ---- boot ---------------------------------------------------------------------------

async function boot() {
  // Fetch all preset files up front (labels for the picker; configs cached
  // for instant switching). Relative fetches — subpath-safe.
  const files = await Promise.all(PRESET_REFS.map((ref) => fetchPreset(ref.id)));
  PRESET_REFS.forEach((ref, i) => state.presets.set(ref.id, files[i]));
  /** @type {Record<string, string>} */
  const labels = {};
  for (const [id, preset] of state.presets) labels[id] = preset.label;
  picker = renderPresetPicker(el('#preset-picker'), {
    labels,
    onPick(ref) {
      const preset = state.presets.get(ref.id);
      if (!preset) return;
      state.presetId = ref.id;
      state.config = primaryRunConfig(preset, ref);
      stageConfigChange('preset');
      picker.setActive(ref.id);
      el('#preset-note').textContent = presetNote(preset);
      controls.refresh();
      // Compare defaults ON for the layerConfigurator preset (mirrors the §10.6
      // aiMiddle/allHuman pair), OFF for the others — decision 3.
      configurator.setCompareDefault(ref.id === 'layerConfigurator');
      configurator.refresh();
      // Picking a scenario is an explicit "show me" action → run now, or cancel
      // the in-flight plan and auto-run this preset when it unwinds (decision 6).
      requestRun('preset');
    },
  });

  // Share-link replay boot (CONTRACTS §4): the banner is rendered after the
  // run, against the engine-stamped modelVersion.
  /** @type {any} */
  let replayBoot = null;
  try {
    replayBoot = await readShareFromHash(window.location.hash, null);
  } catch (err) {
    setStatus(statusEl, `could not open the shared link: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }

  if (replayBoot) {
    state.replayPayload = replayBoot.payload;
    state.replayConfig = replayBoot.replayConfig;
    // Controls display the embedded config (without its override machinery).
    state.config = JSON.parse(JSON.stringify(replayBoot.payload.config));
    state.presetId = '';
    stageGeneration('shareBoot'); // share-link boot is a staged config change (P5b-F1);
    // NB: do NOT clear the '#s=' hash here — the shared link stays replayable.
    el('#preset-note').textContent = 'Shared run — replaying the exact embedded configuration and coefficients.';
    // A shared AI-seat stack shows its comparison by default.
    configurator.setCompareDefault(hasNonHumanLayer(state.config));
  } else {
    const preset = state.presets.get(DEFAULT_PRESET_ID);
    const ref = PRESET_REFS.find((p) => p.id === DEFAULT_PRESET_ID);
    state.config = primaryRunConfig(preset, /** @type {any} */ (ref));
    picker.setActive(DEFAULT_PRESET_ID);
    el('#preset-note').textContent = presetNote(preset);
    // The landing default is fasterDysfunction (all-human) → single-run view;
    // compare defaults on only for the layerConfigurator preset (decision 3).
    configurator.setCompareDefault(false);
  }
  controls.refresh();
  configurator.refresh();
  setRunButtons(false);
  probe.bootReadyMs = performance.now(); // navigation start → Run clickable
  setStatus(statusEl, 'ready — every run is 500 seeded Monte Carlo iterations, entirely in your browser', '');

  if (replayBoot) void runAll(); // a shared link replays without a click
}

boot().catch((err) => {
  setStatus(statusEl, `failed to start: ${err instanceof Error ? err.message : String(err)}`, 'error');
});

// ---- model assumptions drawer (independent of the run flow) ------------------------

/**
 * Fetch www/assumptions.json and render the transparency drawer. Independent of
 * the engine run flow, so a drawer failure never blocks the simulator. The
 * drawer renders the artifact VERBATIM (PREMORTEM Story 3) — no coefficient is
 * authored here.
 */
async function mountAssumptionsDrawer() {
  const mount = el('#assumptions-mount');
  const status = el('#assumptions-status');
  try {
    const data = await fetchAssumptions();
    const { problems } = renderAssumptionsDrawer(mount, data);
    if (problems.length > 0) {
      // Shape drift in the extracted artifact — surface it rather than render a
      // silently blank row (the drift gate would also catch this in CI).
      status.textContent = `The model artifact changed shape (${problems.length} issue(s)); some rows may be incomplete.`;
      status.hidden = false;
    }
  } catch (err) {
    status.textContent = `Could not load the model assumptions: ${err instanceof Error ? err.message : String(err)}`;
    status.hidden = false;
  }
}

void mountAssumptionsDrawer();
