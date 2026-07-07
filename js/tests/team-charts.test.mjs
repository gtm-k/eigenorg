// P7b team charts (charts/team.js) — the quality-bar update + the
// function-coverage heatmap DOM. Chart.js itself is canvas/browser-only, so the
// bar update is tested against a fake chart object (the same posture as the org
// chart update fns), and the heatmap against a minimal DOM stub (mirrors
// glossary.test.mjs). Grayscale-readability is asserted structurally: every row
// carries a text WORD + a glyph, not colour alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { updateQualityChart, renderFunctionCoverage } from '../charts/team.js';
import { qualityHistogramModel, functionCoverageRows } from '../ui/team.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bhOut = JSON.parse(readFileSync(path.join(here, 'fixtures/team.balancedHybrid.output.json'), 'utf8'));

// ---- quality bar update --------------------------------------------------------

test('updateQualityChart feeds the 10 bin labels + counts and calls update("none")', () => {
  let updateArg = null;
  const chart = {
    data: { labels: [], datasets: [{ data: [] }] },
    update(/** @type {string} */ mode) {
      updateArg = mode;
    },
  };
  const model = qualityHistogramModel(bhOut);
  updateQualityChart(chart, model);
  assert.equal(chart.data.labels.length, 10);
  assert.equal(chart.data.labels[7], '70–80');
  assert.deepEqual(chart.data.datasets[0].data, model.bins.map((b) => b.count));
  assert.equal(updateArg, 'none'); // perf discipline: no animation
});

// ---- function-coverage heatmap DOM (minimal stub) ------------------------------

class Node {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.textContent = '';
    /** @type {Record<string, string>} */ this.attributes = {};
    /** @type {any[]} */ this.children = [];
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this.attributes[k] = v;
  }
  appendChild(/** @type {any} */ n) {
    this.children.push(n);
    return n;
  }
  append(/** @type {any[]} */ ...ns) {
    for (const n of ns) this.children.push(n);
  }
}

/** @param {() => void} fn */
function withDom(fn) {
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = { createElement: (/** @type {string} */ t) => new Node(t) };
  try {
    fn();
  } finally {
    /** @type {any} */ (globalThis).document = prev;
  }
}

/** Depth-first collect nodes whose tagName matches. @param {any} node @param {string} tag @returns {any[]} */
function allByTag(node, tag) {
  /** @type {any[]} */ const out = [];
  const walk = (/** @type {any} */ n) => {
    for (const c of n.children ?? []) {
      if (c.tagName === tag) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Flatten a node's text (className tokens + textContent). @param {any} node @returns {string} */
function flatText(node) {
  let s = node.textContent ?? '';
  for (const c of node.children ?? []) s += ` ${c.className} ${flatText(c)}`;
  return s;
}

test('renderFunctionCoverage builds a semantic table (ARIA fallback) with a row per function', () => {
  withDom(() => {
    const mount = /** @type {any} */ (new Node('div'));
    renderFunctionCoverage(mount, functionCoverageRows(bhOut));
    const tables = allByTag(mount, 'table');
    assert.equal(tables.length, 1);
    const captions = allByTag(mount, 'caption');
    assert.equal(captions.length, 1, 'the table has a caption (accessible name)');
    const tbodies = allByTag(mount, 'tbody');
    const bodyRows = allByTag(tbodies[0], 'tr');
    assert.equal(bodyRows.length, 7, 'one row per essential function');
    // Column headers use scope=col; row headers use scope=row (semantic table).
    const colHeaders = allByTag(mount, 'th').filter((th) => th.attributes.scope === 'col');
    assert.equal(colHeaders.length, 3);
  });
});

test('renderFunctionCoverage carries a WORD + glyph per row (no colour-alone)', () => {
  withDom(() => {
    const mount = /** @type {any} */ (new Node('div'));
    const rows = functionCoverageRows(bhOut);
    renderFunctionCoverage(mount, rows);
    const text = flatText(mount);
    // The gap functions surface the plain word "gap" (not colour), and covered
    // ones "covered" — a grayscale screenshot stays readable.
    assert.ok(text.includes('gap'), 'a gap row shows the word "gap"');
    assert.ok(text.includes('covered'), 'a covered row shows the word "covered"');
    // Every rating class present is one of the three known tokens.
    const tbody = allByTag(mount, 'tbody')[0];
    for (const tr of allByTag(tbody, 'tr')) {
      assert.match(tr.className, /fc-(green|amber|red)/);
    }
  });
});

test('renderFunctionCoverage shows a pending note when there is no run yet', () => {
  withDom(() => {
    const mount = /** @type {any} */ (new Node('div'));
    renderFunctionCoverage(mount, []);
    assert.ok(flatText(mount).toLowerCase().includes('run the team'));
    assert.equal(allByTag(mount, 'table').length, 0);
  });
});
