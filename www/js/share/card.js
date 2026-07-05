// eigenorg output/share card (PLAN P8 acceptance bullets 3–4; PREMORTEM A5;
// MODEL.md §3.5).
//
// The card is the one artifact that TRAVELS without the app around it — a
// narrative object, not a BI screenshot (A5). It is generated fully client-side
// (zero external requests, binding delta 2) onto a canvas at EXACTLY 1200×628,
// then downloaded or shared via navigator.share.
//
// Human units are pinned by §3.5: decision latency in working days is the lead
// metric; entropy is NEVER the lead. The Faster-Dysfunction story needs BOTH the
// throughput-up seduction AND the dysfunction-up cost visible (fdSeductive
// Throughput rationale) — the stat chips carry both. The framing line is
// rendered into the PNG (decision default 7 / VISION §5): the card must honour
// "a thinking aid, not a prediction engine" even when it travels alone.
//
// No coefficient literals: every number on the card is computed from the run's
// output series (the coefficient-literal gate forbids hand-typed model numbers).

import { finalP50 } from '../ui/runplan.js';

/** The card PNG is EXACTLY these dimensions (PLAN P8). og-image renders at 630. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 628;
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Headline (human units) at ≥2× the metric-text size (PLAN P8 acceptance 3). */
export const HEADLINE_FONT_PX = 58;
export const STAT_VALUE_FONT_PX = 28;

/** DESIGN.md (Linear) tokens the card paints with. */
const CARD_COLORS = {
  bg: '#0b0c0d',
  panel: '#141516',
  hairline: '#23252a',
  ink: '#f7f8f8',
  inkMuted: '#d0d6e0',
  inkSubtle: '#8a8f98',
  inkTertiary: '#62666d',
  accent: '#828fff',
  accentDeep: '#5e6ad2',
  band: 'rgba(94, 106, 210, 0.20)',
};

// ---- pure card model ----------------------------------------------------------

/**
 * @param {Array<{ t: number, p50: number }>} series
 * @param {number} t
 * @returns {number} the p50 at step t (nearest ≤ t; falls back to first)
 */
function p50At(series, t) {
  let chosen = series[0];
  for (const point of series) {
    if (point.t <= t) chosen = point;
    else break;
  }
  return chosen ? chosen.p50 : 0;
}

/**
 * Mean p50 over the inclusive step window [a, b].
 * @param {Array<{ t: number, p50: number }>} series
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function windowMeanP50(series, a, b) {
  const pts = series.filter((p) => p.t >= a && p.t <= b);
  if (pts.length === 0) return 0;
  return pts.reduce((s, p) => s + p.p50, 0) / pts.length;
}

/** Max p90 across series (for the shared y scale of the before/after visual).
 * @param {Array<Array<{ p90: number }>>} seriesList @returns {number} */
function maxP90(seriesList) {
  let max = 0;
  for (const s of seriesList) for (const p of s) if (p.p90 > max) max = p.p90;
  return max;
}

/**
 * THE HEADLINE COPY — the single swappable string (user may revise before beta).
 * Leads with decision latency in working days (§3.5; decision default 1);
 * entropy never leads. Kept as one function so the copy lives in exactly one
 * place.
 * @param {{ latencyDays: number }} m
 * @returns {string}
 */
export function cardHeadline(m) {
  return `${m.latencyDays} working days to clear one decision`;
}

/**
 * Build the pure display model for the card from a run snapshot. All numbers are
 * derived from the run's output series — no authored coefficients.
 *
 * @param {{
 *   scenarioLabel: string, beforeSh: number, afterSh: number, primarySh: number,
 *   beforeEntropy: Array<any>, afterEntropy: Array<any>,
 *   decisionLatency: Array<any>, throughput: Array<any>, coordinationTax: Array<any>, entropy: Array<any>,
 *   aiActive: boolean, injectStep: number | null,
 *   aiOffThroughput: Array<any> | null, aiOffEntropy: Array<any> | null,
 *   modelVersion: string, seed: number,
 * }} snap
 * @returns {any}
 */
export function cardModel(snap) {
  const latencyDays = Math.round(finalP50(snap.decisionLatency));
  const throughputPerStep = finalP50(snap.throughput);
  const coordinationTaxPct = Math.round(finalP50(snap.coordinationTax) * 100);
  const finalEntropy = Math.round(finalP50(snap.entropy));

  /** @type {Array<{ label: string, value: string }>} */
  const stats = [];

  if (snap.aiActive && snap.injectStep !== null) {
    // The seduction (throughput up) AND the cost (entropy up), both from the
    // SAME broken-org run around the injection — the fdSeductiveThroughput /
    // fdEntropyWorsens story. Windows mirror the golden's [pre] vs [post].
    const inject = snap.injectStep;
    const pre = windowMeanP50(snap.throughput, inject - 7, inject - 1);
    const post = windowMeanP50(snap.throughput, inject + 1, inject + 7);
    const throughputBoostPct = pre > 0 ? Math.round((post / pre - 1) * 100) : 0;
    const entropyRisePts = Math.round(finalP50(snap.entropy) - p50At(snap.entropy, inject));
    stats.push({ label: 'Throughput after AI', value: `${signed(throughputBoostPct)}%` });
    stats.push({ label: 'Entropy after AI', value: `${signed(entropyRisePts)} pts` });
    stats.push({ label: 'Coordination tax', value: `${coordinationTaxPct}%` });
  } else {
    stats.push({ label: 'Throughput', value: `${throughputPerStep.toFixed(1)}/step` });
    stats.push({ label: 'Coordination tax', value: `${coordinationTaxPct}%` });
    stats.push({ label: 'Entropy index', value: `${finalEntropy}/100` });
  }

  // The dominant before/after visual: entropy at the broken vs healthy
  // Structural-Health poles (fdSeparability — structure decides the sign).
  const yMax = Math.min(100, Math.ceil(maxP90([snap.beforeEntropy, snap.afterEntropy]) / 10) * 10) || 100;

  const eyebrow = snap.aiActive
    ? `${snap.scenarioLabel} · AI on a Structural-Health-${snap.primarySh} org`
    : snap.scenarioLabel;

  const subhead = snap.aiActive
    ? 'Layering AI on low Structural Health moves work faster and makes it more disordered — faster dysfunction.'
    : 'Org performance is a property of structure, not headcount.';

  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    eyebrow,
    headline: cardHeadline({ latencyDays }),
    subhead,
    stats,
    latencyDays,
    before: { sh: snap.beforeSh, series: snap.beforeEntropy, label: `Structural Health ${snap.beforeSh}` },
    after: { sh: snap.afterSh, series: snap.afterEntropy, label: `Structural Health ${snap.afterSh}` },
    yMax,
    framing: 'A thinking aid grounded in research — not a prediction engine.',
    meta: `eigenorg · model v${snap.modelVersion} · seed ${snap.seed}`,
  };
}

/** Signed integer as text (+3 / −2 / 0). @param {number} n */
function signed(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`; // real minus sign
  return '0';
}

// ---- canvas rendering (browser only) -----------------------------------------

/** @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} x @param {number} y @param {number} maxWidth @param {number} lineHeight @returns {number} the y after the last line */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
  return cy + lineHeight;
}

/**
 * Draw the before/after entropy visual: two lines (broken pole = solid accent,
 * healthy pole = dashed muted) on a shared y scale. Not colour-alone — each line
 * carries a text label + its end value, and the two use different dash patterns.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} model
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
function drawBeforeAfter(ctx, model, x, y, w, h) {
  // Panel.
  ctx.fillStyle = CARD_COLORS.panel;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = CARD_COLORS.hairline;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();

  const pad = 24;
  const plotX = x + pad;
  const plotW = w - pad * 2;
  const plotTop = y + pad + 22;
  const plotBottom = y + h - pad - 26; // room for the legend row
  const plotH = plotBottom - plotTop;
  const yMax = model.yMax;

  // Title inside the panel.
  ctx.fillStyle = CARD_COLORS.inkSubtle;
  ctx.font = '600 17px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Entropy over time — structure decides the sign', plotX, y + pad + 8);

  /** Pixel points for a series' p50 line. @param {Array<{ t: number, p50: number }>} s */
  const pixels = (s) => s.map((p, i) => ({
    x: plotX + (plotW * i) / (s.length - 1),
    y: plotBottom - (Math.min(p.p50, yMax) / yMax) * plotH,
  }));

  const brokenPts = pixels(model.before.series); // higher entropy pole
  const healthyPts = pixels(model.after.series); // lower entropy pole

  // Shade the gap between the poles — the shaded wedge IS the cost of broken
  // structure (makes even a modest separation read at feed size; A3/A5).
  if (brokenPts.length > 0 && healthyPts.length === brokenPts.length) {
    ctx.beginPath();
    brokenPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    for (let i = healthyPts.length - 1; i >= 0; i -= 1) ctx.lineTo(healthyPts[i].x, healthyPts[i].y);
    ctx.closePath();
    ctx.fillStyle = CARD_COLORS.band;
    ctx.fill();
  }

  /** @param {Array<{x:number,y:number}>} pts @param {boolean} dashed @param {string} color */
  const drawLine = (pts, dashed, color) => {
    if (pts.length === 0) return;
    ctx.beginPath();
    ctx.setLineDash(dashed ? [9, 7] : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    const last = pts[pts.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
    ctx.fill();
  };

  drawLine(healthyPts, true, CARD_COLORS.inkSubtle);
  drawLine(brokenPts, false, CARD_COLORS.accent);

  // Legend (text + dash pattern — not colour-alone).
  ctx.textBaseline = 'middle';
  ctx.font = '500 15px Inter, system-ui, sans-serif';
  const legY = plotBottom + 24;
  // broken
  ctx.strokeStyle = CARD_COLORS.accent;
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(plotX, legY);
  ctx.lineTo(plotX + 26, legY);
  ctx.stroke();
  ctx.fillStyle = CARD_COLORS.inkMuted;
  ctx.fillText(`${model.before.label} (broken)`, plotX + 34, legY);
  // healthy
  const mid = plotX + Math.round(plotW / 2);
  ctx.strokeStyle = CARD_COLORS.inkSubtle;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(mid, legY);
  ctx.lineTo(mid + 26, legY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText(`${model.after.label} (healthy)`, mid + 34, legY);
}

/** Rounded-rect path helper.
 * @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y
 * @param {number} w @param {number} h @param {number} r */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Render the full card onto a canvas. The canvas backing size IS the PNG size
 * (no devicePixelRatio scaling — the PNG must be exactly width×height).
 * @param {HTMLCanvasElement} canvas
 * @param {any} model
 */
export function renderCardToCanvas(canvas, model) {
  canvas.width = model.width;
  canvas.height = model.height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const W = model.width;
  const H = model.height;
  const P = 56;

  // Background.
  ctx.fillStyle = CARD_COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  // Accent rule down the left edge (brand cue).
  ctx.fillStyle = CARD_COLORS.accentDeep;
  ctx.fillRect(0, 0, 8, H);

  ctx.textBaseline = 'alphabetic';

  // Wordmark + right-aligned meta.
  ctx.fillStyle = CARD_COLORS.ink;
  ctx.font = '700 30px Inter, system-ui, sans-serif';
  ctx.fillText('eigenorg', P, P + 20);
  ctx.fillStyle = CARD_COLORS.inkTertiary;
  ctx.font = '500 16px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(model.meta, W - P, P + 18);
  ctx.textAlign = 'left';

  // Eyebrow (scenario).
  ctx.fillStyle = CARD_COLORS.accent;
  ctx.font = '600 20px Inter, system-ui, sans-serif';
  ctx.fillText(model.eyebrow.toUpperCase(), P, P + 70);

  // Headline (huge human-unit metric; ≥2× the stat text). Wraps if it overflows.
  ctx.fillStyle = CARD_COLORS.ink;
  ctx.font = `700 ${HEADLINE_FONT_PX}px Inter, system-ui, sans-serif`;
  const afterHead = wrapText(ctx, model.headline, P, P + 120, W - P * 2, 64);

  // Subhead.
  ctx.fillStyle = CARD_COLORS.inkMuted;
  ctx.font = '400 22px Inter, system-ui, sans-serif';
  const afterSub = wrapText(ctx, model.subhead, P, afterHead + 2, W - P * 2, 30);

  // Stat chips row (both throughput-up AND dysfunction-up visible).
  const chipY = Math.round(afterSub + 12);
  const chipH = 80;
  const chipW = Math.floor((W - P * 2 - 24 * (model.stats.length - 1)) / model.stats.length);
  model.stats.forEach((/** @type {{label:string,value:string}} */ chip, /** @type {number} */ i) => {
    const cx = P + i * (chipW + 24);
    ctx.fillStyle = CARD_COLORS.panel;
    roundRect(ctx, cx, chipY, chipW, chipH, 12);
    ctx.fill();
    ctx.strokeStyle = CARD_COLORS.hairline;
    ctx.lineWidth = 1;
    roundRect(ctx, cx, chipY, chipW, chipH, 12);
    ctx.stroke();
    ctx.fillStyle = CARD_COLORS.inkTertiary;
    ctx.font = '600 14px Inter, system-ui, sans-serif';
    ctx.fillText(chip.label.toUpperCase(), cx + 18, chipY + 30);
    ctx.fillStyle = CARD_COLORS.ink;
    ctx.font = `600 ${STAT_VALUE_FONT_PX}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(chip.value, cx + 18, chipY + 62);
  });

  // Before/after visual (dominant): fills the space from below the chips to the
  // framing line, so the separation reads at feed size.
  const chartY = chipY + chipH + 20;
  drawBeforeAfter(ctx, model, P, chartY, W - P * 2, H - chartY - 34);

  // Framing line (small — the card travels alone; VISION §5).
  ctx.fillStyle = CARD_COLORS.inkTertiary;
  ctx.font = '400 15px Inter, system-ui, sans-serif';
  ctx.fillText(model.framing, P, H - 20);
}

/**
 * Export a canvas to a PNG blob.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

// ---- DOM controller ----------------------------------------------------------

/**
 * Wire the card preview + download + share controls.
 *
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   downloadButton: HTMLButtonElement,
 *   shareButton: HTMLButtonElement,
 *   statusEl: HTMLElement,
 * }} els
 * @returns {{ arm: (snap: any) => void, disarm: () => void, renderDataUrl: (w: number, h: number) => string }}
 */
export function wireCard(els) {
  /** @type {any} */
  let snapshot = null;

  const filename = 'eigenorg-card.png';

  async function download() {
    if (!snapshot) return;
    try {
      const blob = await canvasToPngBlob(els.canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next frame so the click has consumed the URL.
      requestAnimationFrame(() => URL.revokeObjectURL(url));
      els.statusEl.textContent = 'Card downloaded — 1200×628 PNG, ready to post.';
    } catch (err) {
      els.statusEl.textContent = `Could not export the card: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function share() {
    if (!snapshot) return;
    try {
      const blob = await canvasToPngBlob(els.canvas);
      const FileCtor = /** @type {any} */ (window).File;
      const nav = /** @type {any} */ (navigator);
      if (FileCtor && nav.canShare) {
        const file = new FileCtor([blob], filename, { type: 'image/png' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({
            files: [file],
            title: 'eigenorg',
            text: snapshot ? cardHeadline({ latencyDays: Math.round(finalP50(snapshot.decisionLatency)) }) : 'eigenorg',
          });
          els.statusEl.textContent = 'Shared.';
          return;
        }
      }
      // No share target (or no file-share support): fall back to download.
      els.statusEl.textContent = 'Sharing is not available here — downloading the card instead.';
      await download();
    } catch (err) {
      if (/** @type {any} */ (err)?.name === 'AbortError') return; // user cancelled the share sheet
      els.statusEl.textContent = `Could not share the card: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  els.downloadButton.addEventListener('click', () => void download());
  els.shareButton.addEventListener('click', () => void share());

  return {
    arm(snap) {
      snapshot = snap;
      renderCardToCanvas(els.canvas, cardModel(snap));
      els.downloadButton.disabled = false;
      els.shareButton.disabled = false;
    },
    disarm() {
      snapshot = null;
      els.downloadButton.disabled = true;
      els.shareButton.disabled = true;
    },
    // og-image / probe hook: render the current snapshot at an arbitrary size to
    // a data URL without disturbing the on-page preview canvas.
    renderDataUrl(w, h) {
      if (!snapshot) return '';
      const off = document.createElement('canvas');
      const model = cardModel(snapshot);
      renderCardToCanvas(off, { ...model, width: w, height: h });
      return off.toDataURL('image/png');
    },
  };
}
