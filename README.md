# eigenorg

A browser-native organizational-dynamics simulator: model how team composition (human + AI agents) and org structure (hierarchy, topology, coordination) shape throughput, decision latency, and coherence — before you make the structural decision.

**Status: in development.** Rust → WebAssembly simulation engine, static site, no backend, no analytics — nothing leaves your browser.

Building in the open soon.

## Local development

### Toolchain setup (once)

- **Rust:** install via [rustup](https://rustup.rs). `rust-toolchain.toml` pins the
  stable channel and the `wasm32-unknown-unknown` target — rustup picks both up
  automatically inside this repo.
- **wasm-pack:** `cargo install --locked wasm-pack` (it downloads the wasm-bindgen
  CLI matching the exact-pinned crate version in `Cargo.toml`).
- **Node.js** (v22+): `npm install` — devDependencies only (lint, typecheck, and the
  vendored Chart.js source); nothing npm-installed ships to the site.

### Build & serve

```sh
bash scripts/build.sh        # wasm-pack build → www/pkg + vendor Chart.js → www/vendor
node scripts/serve.mjs 8080  # serve www/ at http://localhost:8080/eigenorg/
```

Then open <http://localhost:8080/eigenorg/>.

The dev server intentionally emulates GitHub Pages project hosting: it serves the
site **under the `/eigenorg/` subpath** and **rejects case-mismatched paths**
(Pages serves case-sensitively from Linux; a case-insensitive dev filesystem would
otherwise hide broken links until deploy). Keep all asset references relative.

### Quality gates

```sh
cargo fmt --check && cargo clippy -- -D warnings && cargo test   # Rust (native)
cargo clippy --target wasm32-unknown-unknown -- -D warnings      # wasm boundary
npm run lint && npm run typecheck                                # JS
```
