#!/usr/bin/env bash
# eigenorg site build — proven on Windows Git Bash AND in CI (PREMORTEM T4).
# Do not re-derive the wasm build elsewhere; this script is the one true path.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Rust -> wasm bundle into the deploy root.
wasm-pack build --target web --out-dir www/pkg --release

# 2) wasm-pack writes '*' into www/pkg/.gitignore, which would silently
#    exclude the wasm binary from any deploy artifact built from a checkout
#    (sleeper deploy bug — PREMORTEM T2). Delete it, always.
rm -f www/pkg/.gitignore

# 3) Vendor the pinned Chart.js UMD bundle (zero CDN — PLAN binding delta #2).
#    Source of truth: chart.js npm devDependency (exact-pinned in package.json).
if [ -f node_modules/chart.js/dist/chart.umd.min.js ]; then
  mkdir -p www/vendor
  cp node_modules/chart.js/dist/chart.umd.min.js www/vendor/chart.umd.min.js
elif [ -f www/vendor/chart.umd.min.js ]; then
  echo "node_modules/chart.js absent — keeping the committed www/vendor/chart.umd.min.js"
else
  echo "ERROR: chart.js UMD bundle not found; run 'npm install' first" >&2
  exit 1
fi

echo "build complete: www/pkg + www/vendor ready"
