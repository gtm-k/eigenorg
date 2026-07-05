#!/usr/bin/env bash
# UI-thread wasm isolation gate (PLAN P5; gate-ownership table row "UI thread
# never imports www/pkg"). Rewritten per P5 round-1 F2: whole-tree scope.
#
# Exactly ONE browser-loaded file may reference the wasm bundle in www/pkg:
# www/js/worker.js (the module worker that owns wasm init and every wasm
# call). Any other reference in browser-served source would put the engine on
# the UI thread and break the worker isolation the perf budget depends on.
#
# Scope: the WHOLE www tree, recursively — every *.js, *.mjs, *.html — so a
# NEW browser-loaded file anywhere (a landing page, a www/lib/ helper, an
# inline <script> in any html) is gated the moment it exists. Excluded:
#   - www/pkg/      generated wasm-bindgen bindings (the bundle itself)
#   - www/vendor/   vendored build products (Chart.js), not UI source
#   - */tests/      node --test files, never loaded by the page (the wasm
#                   tests legitimately load the built pkg under node —
#                   CONTRACTS §3); the tripwire below keeps it that way
#   - www/js/worker.js  the single allowlisted importer (pkg pattern only)
#
# Pattern: a bare `pkg` path segment terminated by / ' " or backtick
# ("../pkg/x", "../pkg", '../pkg', `../pkg`) plus the bundle name
# `eigenorg_bg`. KNOWN OUT-OF-SCOPE: string-concatenation evasion
# ('p'+'kg', "pk" + "g/") defeats any grep-level gate; that requires an
# import-graph analysis and is accepted as out-of-scope at the P2-gate bar
# (P5 round-1 reconciliation — backlog).
#
# Tests-dir tripwire: no browser-loaded file may reference a tests/ path —
# otherwise "tests are excluded from the gate" would become an evasion lane
# (ship UI code from tests/ and escape the scan).
#
# Usage: check_pkg_import_isolation.sh [root]
#   root defaults to the repo root (the directory containing www/); tests
#   point it at planted throwaway trees.
set -euo pipefail

root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$root"

status=0
bt='`'

# Any reference to the pkg bundle: pkg/ pkg' pkg" pkg` (path or bare, quote-
# terminated) or the bundle name itself.
pkg_pattern="(^|[^A-Za-z0-9_])pkg[/'\"$bt]|eigenorg_bg"

hits=$(grep -rInE "$pkg_pattern" www \
  --include='*.js' --include='*.mjs' --include='*.html' \
  --exclude-dir=pkg --exclude-dir=vendor --exclude-dir=tests \
  | grep -v '^www/js/worker\.js:' \
  || true)

if [ -n "$hits" ]; then
  echo "$hits"
  echo "FAIL: a UI-thread file references www/pkg — only www/js/worker.js may import the wasm bundle"
  status=1
fi

# Tests-dir tripwire: browser-loaded files (worker.js included) must not
# reference tests/ paths.
tests_hits=$(grep -rInE "(^|[^A-Za-z0-9_])tests/" www \
  --include='*.js' --include='*.mjs' --include='*.html' \
  --exclude-dir=pkg --exclude-dir=vendor --exclude-dir=tests \
  || true)

if [ -n "$tests_hits" ]; then
  echo "$tests_hits"
  echo "FAIL: a browser-loaded file references a tests/ path — test files are excluded from this gate and must never be page-loaded"
  status=1
fi

# The allowed importer must actually exist and reference the bundle (guards
# against the gate silently passing after a rename).
if ! grep -qE "$pkg_pattern" www/js/worker.js 2>/dev/null; then
  echo "FAIL: www/js/worker.js no longer references www/pkg — gate scope is stale"
  status=1
fi

if [ "$status" -ne 0 ]; then
  exit 1
fi
echo "pkg-import isolation clean: only www/js/worker.js touches www/pkg"
