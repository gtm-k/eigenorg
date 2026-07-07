// eigenorg share UI — copy button + replay boot around the frozen url-codec
// (CONTRACTS §4). The codec does the heavy lifting; this module owns the two
// UI policies around it:
//
//  1. modelVersion NORMALIZATION on encode: presets may carry the model
//     version they were authored against, but the share embeds the version
//     the run actually executed with (output.modelVersion) so a same-build
//     share never shows a spurious mismatch banner (P5a handoff note).
//  2. Replay boot on page load: decode #s=, surface the informational
//     banner on modelVersion mismatch, and hand back the exact replay
//     config (buildReplayConfig — replay:true + full-set paramOverrides).

import {
  encodeShare,
  decodeShare,
  buildReplayConfig,
  modelVersionBanner,
  extractShareFragment,
  toShareFragment,
} from '../url-codec.js';
import { deepCopy } from './runplan.js';

/**
 * The config a share URL embeds: the config AS RUN, with modelVersion
 * normalized to the engine's stamp on the output.
 * @param {any} runConfig the primary config that produced `output`
 * @param {any} output the run's parsed output
 * @returns {any}
 */
export function buildShareConfig(runConfig, output) {
  const config = deepCopy(runConfig);
  config.modelVersion = output.modelVersion;
  return config;
}

/**
 * Encode a completed run into a full share URL on the current page.
 * @param {{ origin: string, pathname: string }} loc e.g. window.location
 * @param {any} runConfig the primary config as run
 * @param {any} output the parsed output (supplies resolvedParams + modelVersion)
 * @returns {Promise<{ url: string, fragment: string }>}
 */
export async function buildShareUrl(loc, runConfig, output) {
  const config = buildShareConfig(runConfig, output);
  const encoded = await encodeShare({ config, resolvedParams: output.resolvedParams });
  const fragment = toShareFragment(encoded);
  return { url: `${loc.origin}${loc.pathname}${fragment}`, fragment };
}

/**
 * @typedef {{ payload: any, replayConfig: any,
 *             banner: ReturnType<typeof modelVersionBanner> | null }} ReplayBoot
 */

/**
 * Decode a share link from the location hash, if present.
 * Returns null when there is no share payload. Throws ShareUrlError (typed,
 * user-presentable) on malformed/unsupported links — the caller renders it.
 *
 * @param {string} hash location.hash
 * @param {string | null} currentModelVersion the running engine's version, when known
 * @returns {Promise<ReplayBoot | null>}
 */
export async function readShareFromHash(hash, currentModelVersion) {
  const encoded = extractShareFragment(hash);
  if (encoded === null) return null;
  const payload = await decodeShare(encoded);
  const banner = currentModelVersion === null ? null : modelVersionBanner(payload, currentModelVersion);
  return { payload, replayConfig: buildReplayConfig(payload), banner };
}

// ---- DOM wiring (browser only) ------------------------------------------------

/**
 * Wire the copy button. Disabled until armed with a completed run; on click
 * it writes the URL into the address bar (the durable artifact) and copies
 * it to the clipboard when the browser allows.
 *
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} statusEl aria-live region for copy feedback
 * @param {{ onFragment?: (fragment: string) => void }} [hooks]
 * @returns {{ arm: (runConfig: any, output: any) => void, disarm: () => void }}
 */
export function wireShareButton(button, statusEl, hooks = {}) {
  /** @type {{ runConfig: any, output: any } | null} */
  let armed = null;

  button.addEventListener('click', async () => {
    if (!armed) return;
    try {
      const { url, fragment } = await buildShareUrl(window.location, armed.runConfig, armed.output);
      window.history.replaceState(null, '', fragment);
      hooks.onFragment?.(fragment);
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Clipboard permission denied (or non-secure context): the address
        // bar already holds the link — tell the user where it is.
      }
      statusEl.textContent = copied
        ? 'Link copied — it replays this exact run, byte for byte.'
        : 'Link is in the address bar — copy it from there to share this exact run.';
    } catch (err) {
      statusEl.textContent = `Could not build the share link: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  return {
    arm(runConfig, output) {
      armed = { runConfig, output };
      button.disabled = false;
    },
    disarm() {
      armed = null;
      button.disabled = true;
    },
  };
}
