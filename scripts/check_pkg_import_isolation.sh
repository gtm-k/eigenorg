#!/usr/bin/env bash
# UI-thread wasm isolation gate (PLAN P5; gate-ownership table row "UI thread
# never imports www/pkg").
#
# Exactly ONE browser-loaded file may reference the wasm bundle in www/pkg:
# www/js/worker.js (the module worker that owns wasm init and every wasm
# call). Any other reference in browser-served source would put the engine on
# the UI thread and break the worker isolation the perf budget depends on.
#
# Scope: browser-loaded source = www/index.html + www/js/** MINUS
#   - www/js/worker.js        (the single allowed importer)
#   - www/js/tests/**         (node --test files, never loaded by the page;
#                              the cross-target hash test legitimately loads
#                              the built wasm under node — CONTRACTS §3)
# www/pkg itself (generated bindings) and www/vendor are build products, not
# UI source, and are excluded.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0

# Any reference to the pkg bundle: 'pkg/', '../pkg', 'www/pkg', 'eigenorg_bg'.
pattern='(^|[^A-Za-z0-9_])pkg/|eigenorg_bg'

hits=$(grep -rInE "$pattern" www/js www/index.html \
  --include='*.js' --include='*.mjs' --include='*.html' \
  | grep -v '^www/js/worker\.js:' \
  | grep -v '^www/js/tests/' \
  || true)

if [ -n "$hits" ]; then
  echo "$hits"
  echo "FAIL: a UI-thread file references www/pkg — only www/js/worker.js may import the wasm bundle"
  status=1
fi

# The allowed importer must actually exist and reference the bundle (guards
# against the gate silently passing after a rename).
if ! grep -qE "$pattern" www/js/worker.js; then
  echo "FAIL: www/js/worker.js no longer references www/pkg — gate scope is stale"
  status=1
fi

if [ "$status" -ne 0 ]; then
  exit 1
fi
echo "pkg-import isolation clean: only www/js/worker.js touches www/pkg"
