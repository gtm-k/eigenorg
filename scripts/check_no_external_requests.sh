#!/usr/bin/env bash
# Zero-external-requests gate (PLAN binding delta #2; backlog B1).
#
# Greps a directory tree for any request to a non-relative origin. Run against
# BOTH the www/ source (JS CI job) AND the BUILT www/ after scripts/build.sh
# (Rust CI job) so the wasm-bindgen glue in www/pkg and the vendored bundle in
# www/vendor are covered. Patterns catch absolute http(s), protocol-relative
# (//host), and absolute/protocol-relative targets of fetch / import() /
# new Worker() / <script src> / <link href>, plus sendBeacon. Relative `//`
# never appears after a quote/paren/equals, so line comments do not false-match.
set -euo pipefail

dir="${1:-www}"
status=0
fail() { echo "$1"; status=1; }

# Absolute http(s) URLs in the common request sinks.
if grep -rInE 'fetch\(.{0,3}https?://' "$dir"; then fail '^^ fetch() to an absolute http(s) URL'; fi
if grep -rInE '<script[^>]*src=.{0,2}https?://' "$dir"; then fail '^^ <script src> to an absolute http(s) URL'; fi
if grep -rInE '<link[^>]*href=.{0,2}https?://' "$dir"; then fail '^^ <link href> to an absolute http(s) URL'; fi
if grep -rInE 'import\(.{0,3}https?://' "$dir"; then fail '^^ dynamic import() of an absolute http(s) URL'; fi
if grep -rInE 'new Worker\(.{0,3}https?://' "$dir"; then fail '^^ new Worker() from an absolute http(s) URL'; fi
# Static ESM import from an absolute http(s) URL (import ... from "https://...").
if grep -rInE 'from[[:space:]].{0,2}https?://' "$dir"; then fail '^^ static ESM import from an absolute http(s) URL'; fi
# Bare side-effect static import of an absolute http(s) URL (import "https://..."), which
# carries no `from` and so escapes the static-import pattern above. Whitespace-tolerant.
if grep -rInE 'import[[:space:]]*['"'"'"]https?://' "$dir"; then fail '^^ bare side-effect import of an absolute http(s) URL'; fi
# <img src> and CSS url() to an absolute http(s) URL.
if grep -rInE '<img[^>]*src=.{0,2}https?://' "$dir"; then fail '^^ <img src> to an absolute http(s) URL'; fi
if grep -rInE 'url\(.{0,2}https?://' "$dir"; then fail '^^ CSS url() to an absolute http(s) URL'; fi
# Protocol-relative //host targets (quote/paren/equals then //hostchar).
if grep -rInE '['"'"'"`(=]//[A-Za-z0-9]' "$dir"; then fail '^^ protocol-relative //host request target'; fi
# Request-sink tripwires (any use is disallowed on a zero-external-requests site).
if grep -rIn 'sendBeacon' "$dir"; then fail '^^ sendBeacon usage'; fi
if grep -rIn 'XMLHttpRequest' "$dir"; then fail '^^ XMLHttpRequest usage'; fi
if grep -rIn 'new WebSocket' "$dir"; then fail '^^ new WebSocket usage'; fi
if grep -rIn 'new EventSource' "$dir"; then fail '^^ new EventSource usage'; fi

if [ "$status" -ne 0 ]; then
  echo "FAIL: external-request pattern found in $dir — the site must make zero external requests"
  exit 1
fi
echo "external-request grep clean for $dir"
