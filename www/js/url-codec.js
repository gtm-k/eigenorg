// eigenorg share-URL codec — CONTRACTS.md §4 / MODEL.md §12.4 (frozen policy).
//
// Fragment: '#s=' + base64url( deflate-raw( UTF-8 JSON
//   { v: 1, sim, seed, config, resolvedParams } ) )
// where `v` is the codec version and `resolvedParams` is the FULL effective
// coefficient set from the run's output (so a share URL can never disagree
// with the run it came from).
//
// REPLAY CONTRACT (decision log; replay-by-cardinality is dead):
//   buildReplayConfig() constructs config.paramOverrides = resolvedParams
//   (full-set override, wins over any original overrides) AND sets the
//   explicit `config.replay = true` flag. Replay ALWAYS runs from the
//   embedded params; the modelVersion-mismatch banner is informational only.
//
// Isomorphic: runs in the browser AND under node --test (base64url is a
// hand-rolled, dependency-free codec; compression uses the standard
// CompressionStream / DecompressionStream 'deflate-raw').
// This module never emits `null`s: it serializes the config/resolvedParams it
// is given, and presets/UI configs use absent-optional fields, never null
// (CONTRACTS §1 reverse-asymmetry note).

/** Codec version this module writes and the only one it accepts. */
export const CODEC_VERSION = 1;

/**
 * Hard budget for the full '#s=…' fragment. 2,000 chars keeps the whole URL
 * inside the classic cross-browser/proxy URL-length floor. encodeShare throws
 * a typed ShareUrlError('budget') beyond it — overflow is observable, never a
 * silently-truncatable link.
 */
export const SHARE_FRAGMENT_BUDGET = 2000;

/** The only major schemaVersion this UI understands (MODEL.md §12.5). */
const SUPPORTED_SCHEMA_MAJOR = '1';

/**
 * Typed decode/encode failure.
 * code ∈ 'malformed' | 'unsupportedCodecVersion' | 'unsupportedSchemaVersion' | 'budget'
 */
export class ShareUrlError extends Error {
  /**
   * @param {'malformed' | 'unsupportedCodecVersion' | 'unsupportedSchemaVersion' | 'budget'} code
   * @param {string} message user-presentable explanation
   */
  constructor(code, message) {
    super(message);
    this.name = 'ShareUrlError';
    this.code = code;
  }
}

// ---- base64url (RFC 4648 §5, no padding) ------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** @type {Map<string, number>} */
const B64_LOOKUP = new Map([...B64_ALPHABET].map((c, i) => [c, i]));

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 * @throws {ShareUrlError} malformed
 */
function base64urlToBytes(str) {
  if (str.length % 4 === 1) {
    throw new ShareUrlError('malformed', 'share URL is truncated');
  }
  const outLen = Math.floor((str.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let accBits = 0;
  let o = 0;
  for (const ch of str) {
    const v = B64_LOOKUP.get(ch);
    if (v === undefined) {
      throw new ShareUrlError('malformed', `share URL contains an invalid character: ${JSON.stringify(ch)}`);
    }
    acc = (acc << 6) | v;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      out[o++] = (acc >> accBits) & 0xff;
    }
  }
  return out;
}

// ---- deflate-raw --------------------------------------------------------------

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function deflateRaw(bytes) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 * @throws {ShareUrlError} malformed (corrupt deflate payload)
 */
async function inflateRaw(bytes) {
  try {
    const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (err) {
    throw new ShareUrlError('malformed', `share URL payload does not decompress: ${String(err)}`);
  }
}

// ---- public API ----------------------------------------------------------------

/**
 * @typedef {{ v: number, sim: string, seed: number, config: any, resolvedParams: Record<string, number | number[]> }} SharePayload
 */

/**
 * Whether a config's paramOverrides are exactly the resolvedParams being
 * embedded — the replay case (buildReplayConfig injects the full set), where
 * carrying both would double the ~108-param payload for nothing.
 * Values are numbers or number arrays (CONTRACTS §4 / params.json).
 *
 * @param {Record<string, number | number[]> | undefined} overrides
 * @param {Record<string, number | number[]>} resolved
 * @returns {boolean}
 */
function overridesEqualResolved(overrides, resolved) {
  if (!overrides || typeof overrides !== 'object') return false;
  const keys = Object.keys(overrides);
  if (keys.length !== Object.keys(resolved).length) return false;
  for (const key of keys) {
    const a = overrides[key];
    const b = resolved[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
      }
    } else if (a !== b) {
      return false;
    }
  }
  return true;
}

/**
 * Encode a run into the share-fragment value (the part after '#s=').
 * `sim` / `seed` default from the config and, when given, must agree with it
 * (the frozen fragment shape carries them alongside the config).
 *
 * Replay normalization: when config.paramOverrides is EXACTLY the
 * resolvedParams being embedded (re-sharing an unedited replayed run), the
 * embedded config drops `paramOverrides` and `replay` — decode +
 * buildReplayConfig reconstructs both from the embedded resolvedParams, so
 * replay semantics are unchanged while the fragment stops carrying the
 * full 108-param set twice (measured overflow: 2005 > 2000 budget chars).
 *
 * @param {{ config: any, resolvedParams: Record<string, number | number[]>, sim?: string, seed?: number }} parts
 * @returns {Promise<string>}
 * @throws {ShareUrlError} 'budget' when the fragment would exceed SHARE_FRAGMENT_BUDGET
 */
export async function encodeShare(parts) {
  const { config, resolvedParams } = parts;
  if (!config || typeof config !== 'object') {
    throw new ShareUrlError('malformed', 'encodeShare: config must be an object');
  }
  if (!resolvedParams || typeof resolvedParams !== 'object') {
    throw new ShareUrlError('malformed', 'encodeShare: resolvedParams (the full effective coefficient set) is required');
  }
  const sim = parts.sim ?? config.sim;
  const seed = parts.seed ?? config.seed;
  if (sim !== config.sim) {
    throw new ShareUrlError('malformed', `encodeShare: sim "${sim}" disagrees with config.sim "${config.sim}"`);
  }
  if (seed !== config.seed) {
    throw new ShareUrlError('malformed', `encodeShare: seed ${seed} disagrees with config.seed ${config.seed}`);
  }
  let embeddedConfig = config;
  if (overridesEqualResolved(config.paramOverrides, resolvedParams)) {
    // Shallow copy preserves key order; the caller's config is not mutated.
    embeddedConfig = { ...config };
    delete embeddedConfig.paramOverrides;
    delete embeddedConfig.replay;
  }
  /** @type {SharePayload} */
  const payload = { v: CODEC_VERSION, sim, seed, config: embeddedConfig, resolvedParams };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const encoded = bytesToBase64url(await deflateRaw(json));
  const fragmentLength = toShareFragment(encoded).length;
  if (fragmentLength > SHARE_FRAGMENT_BUDGET) {
    throw new ShareUrlError(
      'budget',
      `share URL fragment is ${fragmentLength} chars — over the ${SHARE_FRAGMENT_BUDGET}-char budget; this run cannot be shared as a link`,
    );
  }
  return encoded;
}

/**
 * Decode a share-fragment value back into the payload. Rejects gracefully
 * (typed ShareUrlError) on malformed input, an unknown codec version, and an
 * unknown MAJOR schemaVersion (MODEL.md §12.5).
 *
 * @param {string} encoded the fragment value (no '#s=' prefix)
 * @returns {Promise<SharePayload>}
 */
export async function decodeShare(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new ShareUrlError('malformed', 'empty share URL payload');
  }
  const inflated = await inflateRaw(base64urlToBytes(encoded));
  /** @type {any} */
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(inflated));
  } catch (err) {
    throw new ShareUrlError('malformed', `share URL payload is not JSON: ${String(err)}`);
  }
  if (!payload || typeof payload !== 'object') {
    throw new ShareUrlError('malformed', 'share URL payload is not an object');
  }
  if (payload.v !== CODEC_VERSION) {
    throw new ShareUrlError(
      'unsupportedCodecVersion',
      `this link uses share-codec version ${String(payload.v)}; this build understands version ${CODEC_VERSION}`,
    );
  }
  if (!payload.config || typeof payload.config !== 'object') {
    throw new ShareUrlError('malformed', 'share URL payload has no config');
  }
  if (!payload.resolvedParams || typeof payload.resolvedParams !== 'object') {
    throw new ShareUrlError('malformed', 'share URL payload has no resolvedParams');
  }
  // sim/seed ride alongside the config in the frozen fragment shape — they
  // must be present, typed, and in agreement with the embedded config (a
  // divergent pair means the payload was hand-edited or corrupted).
  if (typeof payload.sim !== 'string') {
    throw new ShareUrlError('malformed', 'share URL payload has no sim');
  }
  if (typeof payload.seed !== 'number' || !Number.isFinite(payload.seed)) {
    throw new ShareUrlError('malformed', 'share URL payload has no numeric seed');
  }
  if (payload.sim !== payload.config.sim) {
    throw new ShareUrlError('malformed', `share URL sim "${payload.sim}" disagrees with the embedded config.sim "${payload.config.sim}"`);
  }
  if (payload.seed !== payload.config.seed) {
    throw new ShareUrlError('malformed', `share URL seed ${payload.seed} disagrees with the embedded config.seed ${payload.config.seed}`);
  }
  const schemaVersion = String(payload.config.schemaVersion ?? '');
  const major = schemaVersion.split('.')[0];
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    throw new ShareUrlError(
      'unsupportedSchemaVersion',
      `this link was created with config schema v${schemaVersion || '?'}; this build understands schema v${SUPPORTED_SCHEMA_MAJOR}. Please open it on a newer version of eigenorg.`,
    );
  }
  return /** @type {SharePayload} */ (payload);
}

/**
 * Build the replay config from a decoded payload (CONTRACTS §4):
 * a deep copy of the embedded config with
 *   - `paramOverrides` = the embedded resolvedParams (FULL-set override,
 *     winning over any original overrides), and
 *   - the explicit `replay: true` flag (the engine's replay marker — loosens
 *     ONLY the overrides range check; structure/finiteness/joint/μ-ceiling
 *     guards still run).
 * The input payload is not mutated.
 *
 * @param {SharePayload} payload
 * @returns {any} the config to hand to engine-client.run()
 */
export function buildReplayConfig(payload) {
  /** @type {any} */
  const config = JSON.parse(JSON.stringify(payload.config));
  config.paramOverrides = JSON.parse(JSON.stringify(payload.resolvedParams));
  config.replay = true;
  return config;
}

/**
 * modelVersion-mismatch banner hook (decision log round 1; informational
 * only — the run proceeds on embedded params either way).
 *
 * @param {SharePayload} payload
 * @param {string} currentModelVersion the running engine's model version
 * @returns {{ mismatch: boolean, linkVersion: string, currentVersion: string, message: string | null }}
 */
export function modelVersionBanner(payload, currentModelVersion) {
  const linkVersion = String(payload.config.modelVersion ?? 'unknown');
  const mismatch = linkVersion !== currentModelVersion;
  return {
    mismatch,
    linkVersion,
    currentVersion: currentModelVersion,
    message: mismatch
      ? `Created with model v${linkVersion} — this link replays its embedded parameters.`
      : null,
  };
}

/**
 * Extract the encoded share value from a location hash (or any string ending
 * in the fragment). Returns null when there is no share payload.
 *
 * @param {string} hash e.g. location.hash — '#s=…'
 * @returns {string | null}
 */
export function extractShareFragment(hash) {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash ?? '');
  return m ? m[1] : null;
}

/**
 * Render a full '#s=…' fragment for an encoded share value.
 * @param {string} encoded
 * @returns {string}
 */
export function toShareFragment(encoded) {
  return `#s=${encoded}`;
}
