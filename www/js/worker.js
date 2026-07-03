// eigenorg module worker — owns wasm init and every wasm call.
// The UI thread never imports www/pkg (P5 wires a grep gate for that).
//
// MIME-IMMUNE wasm loading (PLAN P2 / PREMORTEM T2): fetch the .wasm with an
// explicitly-constructed URL, take arrayBuffer(), and hand the BYTES to the
// wasm-bindgen init — never WebAssembly.instantiateStreaming, which dies on
// any host that serves .wasm without the application/wasm MIME type.
//
// Message protocol (P2 skeleton shape; P3 freezes the real chunked protocol):
//   in:  { id, type: 'version' | 'echo' | 'probe', payload? }
//   out: { id, type: 'result', payload } | { id, type: 'error', payload }
//   plus an unsolicited { id: 0, type: 'ready' | 'error', payload } after init.

/** @type {(msg: { id: number, type: string, payload?: unknown }) => void} */
const post = (msg) => /** @type {any} */ (self).postMessage(msg);

/** Resolve pkg assets relative to THIS module so it works under any subpath. */
async function initWasm() {
  // Dynamic import keeps the generated bindings out of the typecheck graph
  // (www/pkg is a gitignored build product) while remaining a plain relative
  // module load at runtime.
  const bindingsUrl = new URL('../pkg/eigenorg.js', import.meta.url);
  const bindings = await import(bindingsUrl.href);

  const wasmUrl = new URL('../pkg/eigenorg_bg.wasm', import.meta.url);
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`wasm fetch failed: HTTP ${response.status} for ${wasmUrl.href}`);
  }
  const bytes = await response.arrayBuffer();
  await bindings.default({ module_or_path: bytes });
  return bindings;
}

const wasmReady = initWasm();

wasmReady.then(
  () => post({ id: 0, type: 'ready' }),
  (err) => post({ id: 0, type: 'error', payload: String(err) }),
);

self.onmessage = async (event) => {
  const { id, type, payload } = /** @type {{ id: number, type: string, payload?: any }} */ (
    event.data
  );
  try {
    const wasm = await wasmReady;
    switch (type) {
      case 'version': {
        post({ id, type: 'result', payload: wasm.get_model_version() });
        break;
      }
      case 'echo': {
        post({ id, type: 'result', payload: wasm.echo(String(payload)) });
        break;
      }
      case 'probe': {
        const iterations = payload?.iterations ?? 500;
        const seed = payload?.seed ?? 42;
        const t0 = performance.now();
        const estimate = wasm.monte_carlo_pi(iterations, seed);
        const computeMs = performance.now() - t0;
        post({ id, type: 'result', payload: { estimate, iterations, seed, computeMs } });
        break;
      }
      default: {
        post({ id, type: 'error', payload: `unknown message type: ${type}` });
      }
    }
  } catch (err) {
    post({ id, type: 'error', payload: String(err) });
  }
};
