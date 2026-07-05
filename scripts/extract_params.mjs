// scripts/extract_params.mjs
// Dumb, idempotent extraction of MODEL.md's machine-tagged fenced blocks into
//   model/params.json   (parameters + modelVersion; embedded in Rust via include_str!)
//   model/goldens.json  (golden assertions; consumed by the generic predicate evaluator)
//   www/assumptions.json (drawer content: parameters + mechanics, verbatim)
// MODEL.md is the single source of truth; these files are generated - never edit them.
// Usage: node scripts/extract_params.mjs   (exit 1 with a message on any validation error)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = join(repoRoot, "MODEL.md");

const TIERS = new Set(["peer-reviewed", "industry-report", "editorial-heuristic"]);
const INSTRUMENTS = new Set(["meanPath", "monteCarlo"]);
// The generic evaluator's comparator vocabulary (MODEL.md §11.1) - the only comparators
// a golden may name. A typo'd comparator would otherwise reach the engine unvalidated.
const COMPARATORS = new Set([
  "above", "below", "within", "ratioAbove", "ratioBelow", "riseAtLeast", "dropAtLeast",
  "growthRatioAbove", "twoWindowRatioAbove", "peakBeforeDecline", "bandSeparationAfter",
  "scalarAbove", "scalarBelow",
]);
// Comparators whose `step` MUST be a [from, to] window pair (the evaluator reads both ends).
const WINDOW_STEP_COMPARATORS = new Set(["riseAtLeast", "dropAtLeast", "growthRatioAbove"]);
const PARAM_KEYS = ["id", "value", "range", "distribution", "unit", "anchor", "tier", "limitation", "formula", "plainLanguage"];
const MECHANIC_KEYS = ["id", "formula", "plainLanguage", "citations", "limitations"];
const GOLDEN_KEYS = ["id", "scenario", "metric", "predicate", "comparator", "bound", "tolerance", "step", "instrument", "rationale"];

/** @param {string} msg @returns {never} */
function fail(msg) {
  console.error(`extract_params: ${msg}`);
  process.exit(1);
}

/** @param {unknown} x @returns {x is number} */
function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** @param {unknown} x @returns {x is [number, number]} numeric [from, to] window */
function isNumPair(x) {
  return Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]);
}

/**
 * Validate a golden's `bound` shape against its comparator (MODEL.md §11.1).
 * @param {unknown} id @param {string} cmp @param {unknown} bound
 */
function checkBound(id, cmp, bound) {
  if (cmp === "within") {
    if (!isNumPair(bound)) fail(`golden ${id}: 'within' bound must be [lo, hi] of numbers`);
    else if (bound[0] > bound[1]) fail(`golden ${id}: 'within' bound lo ${bound[0]} > hi ${bound[1]}`);
    return;
  }
  if (cmp === "bandSeparationAfter") {
    if (bound !== null) fail(`golden ${id}: 'bandSeparationAfter' bound must be null`);
    return;
  }
  if (cmp === "twoWindowRatioAbove" || cmp === "peakBeforeDecline") {
    if (bound === null || typeof bound !== "object" || Array.isArray(bound)) {
      fail(`golden ${id}: '${cmp}' bound must be an object`);
    }
    const b = /** @type {Record<string, unknown>} */ (bound);
    if (cmp === "twoWindowRatioAbove") {
      if (!isNumPair(b.windowA) || !isNumPair(b.windowB) || !isNum(b.minRatio)) {
        fail(`golden ${id}: 'twoWindowRatioAbove' bound needs windowA:[a,b], windowB:[a,b], minRatio`);
      }
    } else if (!isNumPair(b.peakWindow) || !isNum(b.finalRatioMax)) {
      fail(`golden ${id}: 'peakBeforeDecline' bound needs peakWindow:[a,b], finalRatioMax`);
    }
    return;
  }
  // above|below|ratioAbove|ratioBelow|riseAtLeast|dropAtLeast|growthRatioAbove|scalarAbove|scalarBelow
  if (!isNum(bound)) fail(`golden ${id}: '${cmp}' bound must be a finite number`);
}

/**
 * Validate a golden's `step` shape against its comparator (MODEL.md §11.1).
 * @param {unknown} id @param {string} cmp @param {unknown} step
 */
function checkStep(id, cmp, step) {
  if (WINDOW_STEP_COMPARATORS.has(cmp)) {
    if (!isNumPair(step)) fail(`golden ${id}: '${cmp}' step must be a [from, to] window`);
  } else if (cmp === "bandSeparationAfter") {
    if (!isNum(step)) fail(`golden ${id}: 'bandSeparationAfter' step must be a step number`);
  } else if (!(step === null || isNum(step) || isNumPair(step))) {
    fail(`golden ${id}: step must be null (final), a number, or a [a, b] window`);
  }
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @param {string} kind
 */
function requireKeys(obj, keys, kind) {
  for (const k of keys) {
    if (!(k in obj)) fail(`${kind} block ${JSON.stringify(obj.id ?? "<no id>")} is missing required field "${k}"`);
  }
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) fail(`${kind} block ${JSON.stringify(obj.id)} has unknown field "${k}"`);
  }
}

const source = readFileSync(modelPath, "utf8");
const fence = /^```json eigenorg:(meta|parameter|mechanic|golden)\r?\n([\s\S]*?)^```\s*$/gm;

/** @type {Record<string, unknown>[]} */
const parameters = [];
/** @type {Record<string, unknown>[]} */
const mechanics = [];
/** @type {Record<string, unknown>[]} */
const goldens = [];
/** @type {Record<string, unknown> | null} */
let meta = null;

for (const match of source.matchAll(fence)) {
  const kind = match[1];
  /** @type {Record<string, unknown>} */
  let obj;
  try {
    obj = JSON.parse(match[2]);
  } catch (e) {
    fail(`invalid JSON in an "eigenorg:${kind}" block: ${e instanceof Error ? e.message : String(e)}\n---\n${match[2].slice(0, 200)}`);
  }
  if (kind === "meta") {
    if (meta !== null) fail("more than one eigenorg:meta block");
    if (typeof obj.modelVersion !== "string" || typeof obj.schemaVersion !== "string") {
      fail("meta block must declare string modelVersion and schemaVersion");
    }
    meta = obj;
  } else if (kind === "parameter") {
    requireKeys(obj, PARAM_KEYS, "parameter");
    if (typeof obj.tier !== "string" || !TIERS.has(obj.tier)) fail(`parameter ${obj.id}: invalid tier ${JSON.stringify(obj.tier)}`);
    if (obj.distribution !== "point" && obj.distribution !== "triangular") fail(`parameter ${obj.id}: invalid distribution`);
    // range must be a numeric [lo, hi] with lo <= hi
    if (!Array.isArray(obj.range) || obj.range.length !== 2 || !isNum(obj.range[0]) || !isNum(obj.range[1])) {
      fail(`parameter ${obj.id}: range must be [lo, hi] of finite numbers`);
    }
    const [lo, hi] = obj.range;
    if (lo > hi) fail(`parameter ${obj.id}: range lo ${lo} exceeds hi ${hi}`);
    if (obj.distribution === "point") {
      // point value must be a finite number sitting inside the declared range
      if (!isNum(obj.value)) fail(`parameter ${obj.id}: point value must be a finite number`);
      if (obj.value < lo || obj.value > hi) {
        fail(`parameter ${obj.id}: default ${obj.value} outside declared range [${lo}, ${hi}]`);
      }
    } else {
      // triangular value = [min, mode, max], numeric and ordered; range constrains the MODE (§9)
      if (!Array.isArray(obj.value) || obj.value.length !== 3 || !obj.value.every(isNum)) {
        fail(`parameter ${obj.id}: triangular value must be [min, mode, max] of finite numbers`);
      }
      const [tmin, tmode, tmax] = obj.value;
      if (!(tmin <= tmode && tmode <= tmax)) {
        fail(`parameter ${obj.id}: triangular must satisfy min <= mode <= max, got [${tmin}, ${tmode}, ${tmax}]`);
      }
      if (tmode < lo || tmode > hi) {
        fail(`parameter ${obj.id}: triangular mode ${tmode} outside declared range [${lo}, ${hi}]`);
      }
    }
    parameters.push(obj);
  } else if (kind === "mechanic") {
    requireKeys(obj, MECHANIC_KEYS, "mechanic");
    if (!Array.isArray(obj.citations) || obj.citations.length === 0) fail(`mechanic ${obj.id}: citations[] required`);
    if (!Array.isArray(obj.limitations) || obj.limitations.length === 0) fail(`mechanic ${obj.id}: limitations[] required`);
    mechanics.push(obj);
  } else {
    requireKeys(obj, GOLDEN_KEYS, "golden");
    if (typeof obj.instrument !== "string" || !INSTRUMENTS.has(obj.instrument)) fail(`golden ${obj.id}: invalid instrument`);
    if (!isNum(obj.tolerance) || obj.tolerance < 0) fail(`golden ${obj.id}: tolerance must be a finite number >= 0`);
    if (typeof obj.comparator !== "string" || !COMPARATORS.has(obj.comparator)) {
      fail(`golden ${obj.id}: unknown comparator ${JSON.stringify(obj.comparator)} (not in the §11.1 vocabulary)`);
    }
    checkBound(obj.id, obj.comparator, obj.bound);
    checkStep(obj.id, obj.comparator, obj.step);
    goldens.push(obj);
  }
}

if (meta === null) fail("no eigenorg:meta block found");
if (parameters.length === 0) fail("no parameter blocks found");
if (goldens.length === 0) fail("no golden blocks found");

// Fence guard: a fence that OPENS with an "eigenorg:" tag but that the strict block regex
// did NOT capture (a mistyped kind like ":golde", a missing "json" info-string, a
// malformed/missing close fence, or two blocks sharing one closing fence) would otherwise
// drop silently. The loose scan matches ANY opening fence carrying the eigenorg: tag
// (info-string optional) so a fence missing the "json" tag is caught rather than dropped.
// The count of opening markers must equal the number of captured blocks.
const looseFenceCount = (source.match(/^```.*\beigenorg:/gm) || []).length;
const strictFenceCount = 1 /* meta */ + parameters.length + mechanics.length + goldens.length;
if (looseFenceCount !== strictFenceCount) {
  fail(`fence guard: ${looseFenceCount} eigenorg fences open but only ${strictFenceCount} blocks were captured - a malformed or mistyped fence dropped silently`);
}

/** @param {Record<string, unknown>[]} items @param {string} kind */
function checkDuplicates(items, kind) {
  const seen = new Set();
  for (const item of items) {
    if (typeof item.id !== "string" || item.id.length === 0) fail(`${kind} block with missing/empty id`);
    if (seen.has(item.id)) fail(`duplicate ${kind} id "${item.id}"`);
    seen.add(item.id);
  }
}
checkDuplicates(parameters, "parameter");
checkDuplicates(mechanics, "mechanic");
checkDuplicates(goldens, "golden");

// Entropy weights must sum to 1 (documented invariant, M13).
const weightIds = [
  "entropyWeightCoordination", "entropyWeightLatency", "entropyWeightCohesion",
  "entropyWeightBrittleness", "entropyWeightWip",
];
let weightSum = 0;
for (const id of weightIds) {
  const p = parameters.find((x) => x.id === id);
  if (!p || typeof p.value !== "number") fail(`entropy weight ${id} missing or non-numeric`);
  weightSum += p.value;
}
if (Math.abs(weightSum - 1) > 1e-9) fail(`entropy weights sum to ${weightSum}, expected 1`);

const modelVersion = meta.modelVersion;
const schemaVersion = meta.schemaVersion;

/** @param {string} rel @param {unknown} data */
function emit(rel, data) {
  const out = join(repoRoot, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`wrote ${rel}`);
}

emit("model/params.json", { modelVersion, schemaVersion, parameters });
emit("model/goldens.json", { modelVersion, assertions: goldens });
emit("www/assumptions.json", {
  modelVersion,
  generatedBy: "scripts/extract_params.mjs from MODEL.md - do not edit by hand",
  items: [
    ...parameters.map((p) => ({
      type: "parameter",
      id: p.id, plainLanguage: p.plainLanguage, formula: p.formula, tier: p.tier,
      limitation: p.limitation, anchor: p.anchor, value: p.value, range: p.range,
      unit: p.unit, distribution: p.distribution,
    })),
    ...mechanics.map((m) => ({
      type: "mechanic",
      id: m.id, plainLanguage: m.plainLanguage, formula: m.formula,
      citations: m.citations, limitations: m.limitations,
    })),
  ],
});

console.log(`extracted ${parameters.length} parameters, ${mechanics.length} mechanics, ${goldens.length} goldens (model v${modelVersion})`);
