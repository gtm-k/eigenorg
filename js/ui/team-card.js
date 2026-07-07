// eigenorg team result card (P7b, INT-1: team = card-only).
//
// The team's shareable artifact. INT-1 (verified: team resolvedParams encode to
// ~2237–2251 chars > the 2000-char share-URL budget, and byte-identical replay
// needs it embedded in full) → team has NO replay link, NO url-codec path, NO
// "copy share link" affordance anywhere in team chrome. The card (download /
// navigator.share PNG) is the ONLY team share. Deterministic rule: team = card;
// org = card + link.
//
// The card MODEL + RENDERER are P7b-owned: share/card.js's cardModel /
// renderCardToCanvas are org-shaped (they read decisionLatency / entropy /
// before-after Structural-Health series and stamp a hardcoded "Entropy over time
// — structure decides the sign" panel title), so they cannot render a team card
// without mislabeling it. Per the P7b brief §5 "verify" clause, we reuse ONLY the
// pure, mode-agnostic export helpers (canShareFiles / downloadAttributeSupported /
// canvasToPngBlob) and the fixed card dimensions; share/card.js stays byte-frozen
// so org's byte-identical replay is untouched.
//
// Authors no model number (coefficient-literal gate): every value is read from
// the team run output via ui/team.js projections. Never imports www/pkg.

import { CARD_WIDTH, CARD_HEIGHT, canShareFiles, downloadAttributeSupported, canvasToPngBlob } from '../share/card.js';
import { coverageSummary, teamRunStats, qualityHistogramModel, functionCoverageRows } from './team.js';

/** DESIGN.md (Linear) tokens the card paints with — mirror share/card.js. */
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
  gap: '#d0d6e0',
};

const HEADLINE_FONT_PX = 54;
const STAT_VALUE_FONT_PX = 26;

/** Short strip labels (card only) — the full labels wrap the 7-cell strip.
 *  @type {Record<string, string>} */
const SHORT_LABEL = {
  execution: 'Build',
  review: 'Review',
  prioritization: 'Prioritize',
  coordination: 'Coordinate',
  stakeholderCommunication: 'Comms',
  synthesis: 'Synthesize',
  ambiguityResolution: 'Ambiguity',
};

// ---- pure card model (node-tested) --------------------------------------------

/**
 * Build the pure display model from a team run snapshot. All numbers derive from
 * the run output — no authored coefficients.
 * @param {{ scenarioLabel: string, output: any }} snap
 * @returns {any}
 */
export function teamCardModel(snap) {
  const output = snap.output;
  const coverage = coverageSummary(output);
  const stats = teamRunStats(output);
  const quality = qualityHistogramModel(output);
  const cells = functionCoverageRows(output).map((r) => ({
    short: SHORT_LABEL[r.id] ?? r.label,
    glyph: r.glyph,
    fill: r.fill,
    rating: r.rating,
    word: r.word,
  }));

  const shipped = stats.shipped === null ? 0 : Math.round(stats.shipped);
  const cohesion = stats.cohesion === null ? 0 : Math.round(stats.cohesion);
  const brittleness = stats.brittleness === null ? 0 : Math.round(stats.brittleness);
  const qualityLabel =
    quality.medianBinLo === null ? '—' : `${quality.medianBinLo}–${quality.medianBinLo + 10}`;

  const headline = `${coverage.covered} of ${coverage.total} essential jobs covered`;

  // Plain, non-judgmental subhead derived from the coverage result (sound/strained
  // register, never "broken"). Names the gaps so the reader can act on them.
  let subhead;
  if (coverage.gaps === 0) {
    subhead = 'Every essential job has qualified attention on it — this makeup holds together.';
  } else {
    const list = coverage.gapLabels.join(' and ');
    subhead = `${list} ${coverage.gaps === 1 ? 'has' : 'have'} no one qualified on it — work that needs it stalls or quietly degrades.`;
  }

  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    eyebrow: snap.scenarioLabel,
    headline,
    subhead,
    stats: [
      { label: 'Work shipped', value: `${shipped} items` },
      { label: 'Typical quality', value: `${qualityLabel}` },
      { label: 'Team trust', value: `${cohesion}/100` },
      { label: 'Fragility', value: `${brittleness} ${brittleness === 1 ? 'break' : 'breaks'}` },
    ],
    cells,
    framing: 'A thinking aid grounded in research — not a prediction engine.',
    meta: `eigenorg · model v${output.modelVersion} · seed ${output.seed}`,
  };
}

// ---- canvas rendering (browser only) ------------------------------------------

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

/** @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} x @param {number} y @param {number} maxWidth @param {number} lineHeight @returns {number} */
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
 * Draw the dominant visual: a 7-cell coverage strip. State is carried by a fill
 * PATTERN (solid / half-hatch / open) + a shape glyph + the plain word, so a
 * grayscale render stays fully readable (never colour alone).
 * @param {CanvasRenderingContext2D} ctx @param {any} model
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
function drawCoverageStrip(ctx, model, x, y, w, h) {
  ctx.fillStyle = CARD_COLORS.panel;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = CARD_COLORS.hairline;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();

  const pad = 24;
  ctx.fillStyle = CARD_COLORS.inkSubtle;
  ctx.font = '600 17px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('Which essential jobs are covered', x + pad, y + pad + 8);

  const cells = model.cells ?? [];
  const n = cells.length || 1;
  const stripTop = y + pad + 30;
  const stripBottom = y + h - pad;
  const gapPx = 12;
  const cellW = Math.floor((w - pad * 2 - gapPx * (n - 1)) / n);
  const cellH = stripBottom - stripTop - 44; // room for label + word rows below

  cells.forEach((/** @type {any} */ cell, /** @type {number} */ i) => {
    const cx = x + pad + i * (cellW + gapPx);
    const isGap = cell.rating === 'red';
    const isThin = cell.rating === 'amber';
    const tone = isGap ? CARD_COLORS.gap : CARD_COLORS.accent;

    // Fill pattern: solid (covered), half hatch (thin), open outline (gap).
    if (isGap) {
      ctx.strokeStyle = tone;
      ctx.lineWidth = 2;
      roundRect(ctx, cx, stripTop, cellW, cellH, 10);
      ctx.stroke();
    } else {
      ctx.fillStyle = tone;
      roundRect(ctx, cx, stripTop, cellW, cellH, 10);
      ctx.fill();
      if (isThin) {
        // Half state: overlay diagonal hatch so it reads distinct in grayscale.
        ctx.save();
        roundRect(ctx, cx, stripTop, cellW, cellH, 10);
        ctx.clip();
        ctx.strokeStyle = CARD_COLORS.bg;
        ctx.lineWidth = 3;
        for (let hx = cx - cellH; hx < cx + cellW; hx += 12) {
          ctx.beginPath();
          ctx.moveTo(hx, stripTop + cellH);
          ctx.lineTo(hx + cellH, stripTop);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Glyph centered in the cell.
    ctx.fillStyle = isGap ? tone : CARD_COLORS.bg;
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cell.glyph, cx + cellW / 2, stripTop + cellH / 2);

    // Short job label + coverage word below the cell.
    ctx.fillStyle = CARD_COLORS.inkMuted;
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(cell.short, cx + cellW / 2, stripBottom - 22);
    ctx.fillStyle = CARD_COLORS.inkSubtle;
    ctx.font = '400 12px Inter, system-ui, sans-serif';
    ctx.fillText(cell.word, cx + cellW / 2, stripBottom - 4);
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/**
 * Render the full team card onto a canvas. The canvas backing size IS the PNG
 * size (no devicePixelRatio scaling — exactly width×height).
 * @param {HTMLCanvasElement} canvas @param {any} model
 */
export function renderTeamCardToCanvas(canvas, model) {
  canvas.width = model.width;
  canvas.height = model.height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const W = model.width;
  const H = model.height;
  const P = 56;

  ctx.fillStyle = CARD_COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = CARD_COLORS.accentDeep;
  ctx.fillRect(0, 0, 8, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

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

  // Headline (human-unit coverage lead).
  ctx.fillStyle = CARD_COLORS.ink;
  ctx.font = `700 ${HEADLINE_FONT_PX}px Inter, system-ui, sans-serif`;
  const afterHead = wrapText(ctx, model.headline, P, P + 118, W - P * 2, 60);

  // Subhead.
  ctx.fillStyle = CARD_COLORS.inkMuted;
  ctx.font = '400 22px Inter, system-ui, sans-serif';
  const afterSub = wrapText(ctx, model.subhead, P, afterHead + 2, W - P * 2, 30);

  // Stat chips.
  const chipY = Math.round(afterSub + 12);
  const chipH = 78;
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
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillText(chip.label.toUpperCase(), cx + 18, chipY + 28);
    ctx.fillStyle = CARD_COLORS.ink;
    ctx.font = `600 ${STAT_VALUE_FONT_PX}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(chip.value, cx + 18, chipY + 60);
  });

  // Coverage strip (dominant visual).
  const stripY = chipY + chipH + 20;
  drawCoverageStrip(ctx, model, P, stripY, W - P * 2, H - stripY - 34);

  // Framing line.
  ctx.fillStyle = CARD_COLORS.inkTertiary;
  ctx.font = '400 15px Inter, system-ui, sans-serif';
  ctx.fillText(model.framing, P, H - 20);
}

// ---- DOM controller (browser only) --------------------------------------------

/**
 * Wire the team card preview + download + share controls. Mirrors the share/
 * card.js export/share fallback ladder (native share sheet → <a download> →
 * window.open) using the reused pure detection helpers — but NO share-link /
 * copy-link path exists here (INT-1).
 *
 * @param {{ canvas: HTMLCanvasElement, downloadButton: HTMLButtonElement,
 *           shareButton: HTMLButtonElement, statusEl: HTMLElement }} els
 * @returns {{ arm: (snap: any) => void, disarm: () => void,
 *             renderDataUrl: (w: number, h: number) => string }}
 */
export function wireTeamCard(els) {
  /** @type {any} */
  let snapshot = null;
  const filename = 'eigenorg-team-card.png';

  /** @returns {Promise<string>} */
  async function exportCard() {
    const blob = await canvasToPngBlob(els.canvas);
    const url = URL.createObjectURL(blob);
    if (downloadAttributeSupported(document)) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      requestAnimationFrame(() => URL.revokeObjectURL(url));
      return 'Team card downloaded — 1200×628 PNG, ready to post.';
    }
    const opened = window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    return opened
      ? 'Team card opened in a new tab — use your browser to save the 1200×628 PNG.'
      : 'Team card ready — allow pop-ups, or long-press the preview, to save the 1200×628 PNG.';
  }

  async function download() {
    if (!snapshot) return;
    try {
      els.statusEl.textContent = await exportCard();
    } catch (err) {
      els.statusEl.textContent = `Could not export the card: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function share() {
    if (!snapshot) return;
    const nav = /** @type {any} */ (navigator);
    const FileCtor = /** @type {any} */ (window).File;
    if (canShareFiles(nav, FileCtor)) {
      try {
        const blob = await canvasToPngBlob(els.canvas);
        const file = new FileCtor([blob], filename, { type: 'image/png' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: 'eigenorg', text: teamCardModel(snapshot).headline });
          els.statusEl.textContent = 'Shared.';
          return;
        }
      } catch (err) {
        if (/** @type {any} */ (err)?.name === 'AbortError') return; // user cancelled
      }
    }
    try {
      els.statusEl.textContent = `Couldn't share on this device — ${await exportCard()}`;
    } catch (err) {
      els.statusEl.textContent = `Could not export the card: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  els.downloadButton.addEventListener('click', () => void download());
  els.shareButton.addEventListener('click', () => void share());

  return {
    arm(snap) {
      snapshot = snap;
      renderTeamCardToCanvas(els.canvas, teamCardModel(snap));
      els.downloadButton.disabled = false;
      els.shareButton.disabled = false;
    },
    disarm() {
      snapshot = null;
      els.downloadButton.disabled = true;
      els.shareButton.disabled = true;
    },
    renderDataUrl(w, h) {
      if (!snapshot) return '';
      const off = document.createElement('canvas');
      const model = teamCardModel(snapshot);
      renderTeamCardToCanvas(off, { ...model, width: w, height: h });
      return off.toDataURL('image/png');
    },
  };
}
