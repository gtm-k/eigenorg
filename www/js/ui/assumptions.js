// eigenorg Model Assumptions drawer — renders www/assumptions.json VERBATIM.
//
// PREMORTEM Story 3 (the project-fatal failure): three sources of truth drift
// apart and the open-source community re-derives different numbers than the
// live app. This module is the defense: it hand-copies NO coefficient. Every
// value, formula, citation, limitation, tier and range shown in the drawer is
// read from the extracted artifact at runtime; the only authored strings here
// are layout chrome (group headings, the toggle label, the "adjustable via
// config" note — binding delta 5). The companion field test + the ci.yml
// coefficient-literal gate keep it that way.
//
// Shape-driven: a later amendment may re-extract assumptions.json (item counts
// change, values change); the drawer renders whatever the current artifact
// holds, and assumptions.test.mjs pins the field shape it depends on.

/** The tiers a parameter may carry (MODEL.md §12.7 / §13). Text labels — never color-alone. */
export const ALLOWED_TIERS = ['peer-reviewed', 'industry-report', 'editorial-heuristic'];

/** Human-readable tier label (the drawer shows the tier as text, not a colour). @type {Record<string, string>} */
const TIER_LABEL = {
  'peer-reviewed': 'peer-reviewed',
  'industry-report': 'industry report',
  'editorial-heuristic': 'editorial heuristic',
};

/** Fields a `parameter` item must carry for the drawer (PLAN P8 + §12.7). */
export const REQUIRED_PARAM_FIELDS = [
  'plainLanguage',
  'formula',
  'tier',
  'limitation',
  'anchor',
  'value',
  'range',
  'unit',
  'distribution',
];

/** Fields a `mechanic` item must carry for the drawer (PLAN P8 + §12.7). */
export const REQUIRED_MECHANIC_FIELDS = ['plainLanguage', 'formula', 'citations', 'limitations'];

/** Binding delta 5 (exact phrasing, PLAN §P8): the "adjustable via config" note. */
export const ADJUSTABLE_NOTE = 'adjustable via config (paramOverrides); UI sliders in v2';

/**
 * Split the extracted items into the two groups the drawer renders, preserving
 * document order within each (§12.7: all parameters, then all mechanics).
 * @param {any[]} items
 * @returns {{ parameters: any[], mechanics: any[] }}
 */
export function partitionItems(items) {
  /** @type {any[]} */ const parameters = [];
  /** @type {any[]} */ const mechanics = [];
  for (const item of items) {
    if (item.type === 'parameter') parameters.push(item);
    else if (item.type === 'mechanic') mechanics.push(item);
  }
  return { parameters, mechanics };
}

/**
 * Shape check the drawer relies on. Returns a list of human-readable problems
 * (empty ⇒ the artifact is drawer-renderable). Pure — node-tested — so a broken
 * re-extraction is caught by CI's node --test before it can blank a drawer row.
 * @param {any} data the parsed assumptions.json
 * @returns {string[]}
 */
export function validateAssumptions(data) {
  /** @type {string[]} */ const problems = [];
  if (!data || typeof data !== 'object') return ['assumptions.json is not an object'];
  if (typeof data.modelVersion !== 'string') problems.push('missing modelVersion');
  if (!Array.isArray(data.items) || data.items.length === 0) {
    problems.push('items is not a non-empty array');
    return problems;
  }
  for (const item of data.items) {
    const id = item && typeof item.id === 'string' ? item.id : '(no id)';
    if (item.type === 'parameter') {
      for (const field of REQUIRED_PARAM_FIELDS) {
        if (!(field in item)) problems.push(`parameter ${id}: missing "${field}"`);
      }
      if ('tier' in item && !ALLOWED_TIERS.includes(item.tier)) {
        problems.push(`parameter ${id}: unknown tier "${item.tier}"`);
      }
      if ('range' in item && !(Array.isArray(item.range) && item.range.length === 2)) {
        problems.push(`parameter ${id}: range is not a 2-tuple`);
      }
    } else if (item.type === 'mechanic') {
      for (const field of REQUIRED_MECHANIC_FIELDS) {
        if (!(field in item)) problems.push(`mechanic ${id}: missing "${field}"`);
      }
      if ('citations' in item && !Array.isArray(item.citations)) problems.push(`mechanic ${id}: citations is not an array`);
      if ('limitations' in item && !Array.isArray(item.limitations)) problems.push(`mechanic ${id}: limitations is not an array`);
    } else {
      problems.push(`item ${id}: unknown type "${item.type}"`);
    }
  }
  return problems;
}

/**
 * Render one parameter's numeric metadata as a display string, straight from
 * the artifact (value may be a scalar point default or a triangular triple).
 * No authored numbers — everything is stringified from the JSON.
 * @param {any} p
 * @returns {string}
 */
export function parameterValueText(p) {
  const value = Array.isArray(p.value) ? `[${p.value.join(', ')}]` : String(p.value);
  const range = Array.isArray(p.range) ? `${p.range[0]}–${p.range[1]}` : String(p.range);
  return `${value} ${p.unit} · range ${range} · ${p.distribution}`;
}

// ---- fetch --------------------------------------------------------------------

/**
 * Fetch the extracted artifact relatively (subpath-safe under /eigenorg/).
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<any>}
 */
export async function fetchAssumptions(fetchImpl) {
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch('./assumptions.json');
  if (!response.ok) throw new Error(`assumptions.json fetch failed: HTTP ${response.status}`);
  return response.json();
}

// ---- DOM rendering (browser only) --------------------------------------------

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A labelled metadata row (dt/dd). @param {string} label @param {string} value */
function metaRow(label, value) {
  const div = make('div', 'assum-meta-row');
  div.append(make('dt', 'assum-meta-label', label), make('dd', 'assum-meta-value', value));
  return div;
}

/** A bulleted list from an array of strings. @param {string[]} items @param {string} cls */
function bulletList(items, cls) {
  const ul = make('ul', cls);
  for (const s of items) ul.appendChild(make('li', undefined, s));
  return ul;
}

/** One parameter entry (collapsible). @param {any} p */
function renderParameter(p) {
  const entry = make('details', 'assum-item');
  const summary = make('summary', 'assum-summary');
  summary.append(make('span', 'assum-id', p.id));
  const tier = make('span', 'assum-tier', TIER_LABEL[p.tier] ?? p.tier);
  tier.dataset.tier = p.tier; // for optional styling; the text IS the signal
  summary.appendChild(tier);
  entry.appendChild(summary);

  const body = make('div', 'assum-body');
  body.appendChild(make('p', 'assum-plain', p.plainLanguage));
  const meta = make('dl', 'assum-meta');
  meta.appendChild(metaRow('Default', parameterValueText(p)));
  meta.appendChild(metaRow('Formula', p.formula));
  meta.appendChild(metaRow('Anchor', p.anchor));
  meta.appendChild(metaRow('Limitation', p.limitation));
  body.appendChild(meta);
  entry.appendChild(body);
  return entry;
}

/** One mechanic entry (collapsible). @param {any} m */
function renderMechanic(m) {
  const entry = make('details', 'assum-item');
  const summary = make('summary', 'assum-summary');
  summary.append(make('span', 'assum-id', m.id));
  entry.appendChild(summary);

  const body = make('div', 'assum-body');
  body.appendChild(make('p', 'assum-plain', m.plainLanguage));
  const meta = make('dl', 'assum-meta');
  meta.appendChild(metaRow('Formula', m.formula));
  body.appendChild(meta);

  body.appendChild(make('p', 'assum-sublabel', 'Citations'));
  body.appendChild(bulletList(m.citations, 'assum-cites'));
  body.appendChild(make('p', 'assum-sublabel', 'Limitations'));
  body.appendChild(bulletList(m.limitations, 'assum-cites'));
  entry.appendChild(body);
  return entry;
}

/**
 * Render the drawer into `root`. The drawer itself is a native <details> so it
 * is keyboard-operable and screen-reader-announced without custom ARIA.
 * @param {HTMLElement} root the mount (an empty container)
 * @param {any} data parsed assumptions.json
 * @returns {{ itemCount: number, problems: string[] }}
 */
export function renderAssumptionsDrawer(root, data) {
  root.textContent = '';
  const problems = validateAssumptions(data);
  const { parameters, mechanics } = partitionItems(data.items ?? []);

  const drawer = make('details', 'drawer');
  const summary = make('summary', 'drawer-summary');
  summary.append(
    make('span', 'drawer-title', 'Model assumptions'),
    make('span', 'drawer-count', `${parameters.length} parameters · ${mechanics.length} mechanics · model v${data.modelVersion}`),
  );
  drawer.appendChild(summary);

  const intro = make('p', 'drawer-note');
  intro.append(
    document.createTextNode('Every coefficient below is extracted from '),
    make('span', 'mono', 'MODEL.md'),
    document.createTextNode(` and carries an evidence tier, a range and a limitation — ${ADJUSTABLE_NOTE}. Nothing here is hand-copied; a CI drift gate keeps this drawer identical to the shipped model.`),
  );
  drawer.appendChild(intro);

  const paramGroup = make('section', 'assum-group');
  paramGroup.setAttribute('aria-label', 'Parameters');
  paramGroup.appendChild(make('h3', 'assum-group-head', `Parameters (${parameters.length})`));
  for (const p of parameters) paramGroup.appendChild(renderParameter(p));
  drawer.appendChild(paramGroup);

  const mechGroup = make('section', 'assum-group');
  mechGroup.setAttribute('aria-label', 'Mechanics');
  mechGroup.appendChild(make('h3', 'assum-group-head', `Mechanics (${mechanics.length})`));
  for (const m of mechanics) mechGroup.appendChild(renderMechanic(m));
  drawer.appendChild(mechGroup);

  root.appendChild(drawer);
  return { itemCount: (data.items ?? []).length, problems };
}
