// eigenorg "what this means" lines — one RULE-BASED sentence per chart panel,
// derived from the config (and the run's outputs) so the sentence always
// matches what the reader is looking at (PLAN P5; PREMORTEM A6: real-world
// units, no toy framing). Pure functions, node-tested.

/** @param {number} v @param {number} [dp] */
const fmt = (v, dp = 1) => v.toFixed(dp);

/** @type {Record<string, string>} */
const TOPOLOGY_NOUNS = {
  flat: 'flat org',
  hierarchical: 'hierarchical org',
  pods: 'pod org',
  federated: 'federated org',
};

/** @param {any} config */
const topologyNoun = (config) => TOPOLOGY_NOUNS[config.org.topology] ?? 'org';

/** @param {any} config @returns {boolean} */
const aiActive = (config) =>
  Boolean(config.org.aiInjection?.enabled) && Number(config.org.aiInjection?.atStep) < Number(config.horizon);

/**
 * @typedef {{ config: any, output?: any,
 *             beforeSh?: number, afterSh?: number,
 *             beforeFinal?: number, afterFinal?: number,
 *             entropyDeltaPeak?: number,
 *             crossings?: Array<{ t: number, center: number }> }} MeaningCtx
 */

/** @type {Record<string, (ctx: MeaningCtx) => string>} */
const RULES = {
  pane(ctx) {
    const { config } = ctx;
    const head = `${config.org.headcountStart}-person ${topologyNoun(config)}`;
    const shSpan = `Structural Health ${ctx.beforeSh} vs ${ctx.afterSh}`;
    const ends =
      ctx.beforeFinal !== undefined && ctx.afterFinal !== undefined
        ? ` entropy ends at ${fmt(/** @type {number} */ (ctx.beforeFinal))} vs ${fmt(/** @type {number} */ (ctx.afterFinal))}.`
        : '';
    if (aiActive(config)) {
      return (
        `Same ${head}, same AI injected at step ${config.org.aiInjection.atStep} — only the structure differs (${shSpan}).${ends}` +
        ` Structure decides whether AI compounds order or disorder.`
      );
    }
    return `Same ${head} at ${shSpan}, no AI in this scenario.${ends} The gap is pure structure.`;
  },

  entropy(ctx) {
    const { config } = ctx;
    const sh = Number(config.org.structuralHealth);
    if (aiActive(config) && sh <= 4) {
      return `At Structural Health ${sh}, this org is fragile — watch entropy after the AI injection at step ${config.org.aiInjection.atStep}: AI accelerates the disorder it lands in.`;
    }
    if (aiActive(config)) {
      return `At Structural Health ${sh}, the structure absorbs the AI injection at step ${config.org.aiInjection.atStep} — entropy stays governed rather than compounding.`;
    }
    if (Number(config.org.headcountGrowthPerStep) > 0) {
      return `No AI here — entropy tracks how ~${fmt(Number(config.org.headcountGrowthPerStep), 2)} hires/step outpace the ${topologyNoun(config)}'s coordination structure.`;
    }
    return `No AI and no growth — entropy settles to the level this structure earns at Structural Health ${sh}.`;
  },

  velocity(ctx) {
    const { config, output } = ctx;
    const layers = Number(config.org.ownershipLayers);
    const layerWord = layers === 1 ? '1 ownership layer sets' : `${layers} ownership layers set`;
    /** @type {any} */
    const bn = output?.perLayer?.find((/** @type {any} */ l) => l.bottleneck);
    const bnText = bn
      ? ` The bottleneck is layer ${bn.layer} (${bn.layerType}) at ${Math.round(bn.utilization * 100)}% utilization — decisions queue there first.`
      : '';
    return `Decision velocity is a 0–100 speedometer: ${layerWord} the ceiling, and queues drag it lower.${bnText}`;
  },

  communication(ctx) {
    const { config } = ctx;
    const growth = Number(config.org.headcountGrowthPerStep);
    if (growth > 0 && ctx.crossings && ctx.crossings.length > 0) {
      const list = ctx.crossings.map((c) => `~${c.center} people at step ${c.t}`).join(', ');
      return `Growing ~${fmt(growth, 2)} people/step, this org crosses cognitive bands (${list}) — each crossing makes every channel a little more expensive.`;
    }
    if (growth > 0) {
      return `Growing ~${fmt(growth, 2)} people/step — channel count climbs, but no cognitive band is crossed inside this horizon.`;
    }
    return `Headcount holds at ${config.org.headcountStart}, so channel load is set by the ${topologyNoun(config)}'s wiring, not by growth.`;
  },

  delta(ctx) {
    const { config } = ctx;
    if (!aiActive(config)) {
      return `AI injection is off in this scenario, so there is no injection delta to show — pick Faster Dysfunction to see one.`;
    }
    const peak = ctx.entropyDeltaPeak;
    const peakText =
      peak === undefined
        ? ''
        : peak > 0
          ? ` Here it peaks at +${fmt(peak)} entropy points: the injection made disorder worse.`
          : ` Here it stays at or below ${fmt(peak)} entropy points: the structure converted AI into order.`;
    return `Pointwise difference, AI minus no-AI, on this exact org — above zero means the injection ADDED disorder.${peakText}`;
  },

  meetings(ctx) {
    const { config, output } = ctx;
    const finalPct = output ? Math.round(output.series.meetingOverheadPct.at(-1).p50 * 100) : undefined;
    const endText = finalPct === undefined ? '' : ` — ending near ${finalPct}% of capacity`;
    if (config.org.modality === 'meetingHeavy') {
      return `Meeting-heavy coordination converts headcount into calendar time${endText}. That capacity never reaches the backlog.`;
    }
    return `Async-first coordination keeps meeting overhead low${endText}, leaving more of each step for actual work.`;
  },

  health(ctx) {
    const { output } = ctx;
    if (!output) return `Team cohesion vs org-level health: when the lines diverge, healthy teams are living inside a sick org.`;
    const gap = output.series.healthGap.at(-1).p50;
    if (gap > 10) {
      return `Teams end ${fmt(gap)} points healthier than the org around them — the healthy-teams-sick-org gap. Local morale is masking structural drag.`;
    }
    if (gap < -10) {
      return `The org level ends ${fmt(-gap)} points above its teams — structural metrics look fine while the teams inside are eroding.`;
    }
    return `Team cohesion and org health end within ${fmt(Math.abs(gap))} points of each other — the levels roughly agree here.`;
  },
};

/**
 * The rule-based sentence for a panel.
 * @param {string} panelId pane | entropy | velocity | communication | delta | meetings | health
 * @param {MeaningCtx} ctx
 * @returns {string}
 */
export function meaningFor(panelId, ctx) {
  const rule = RULES[panelId];
  if (!rule) throw new Error(`no meaning rule for panel: ${panelId}`);
  return rule(ctx);
}

export const PANEL_IDS = Object.keys(RULES);
