// scripts/check_pkg_import_isolation.test.mjs
// Self-test for scripts/check_pkg_import_isolation.sh (P5 round-1 F2). Builds
// throwaway www trees that exercise every scope/pattern the gate enforces and
// asserts the gate FAILS loudly on each plant — so a silent scope regression
// (the original F2 defect: landing.html and any new www/ dir escaped the
// hard-coded www/js + www/index.html scan) breaks CI instead of hiding.
// Clean-control trees and the REAL repo tree must PASS.
//
// Probes live in an OS temp dir — never inside the repo, never committed —
// and are removed after each case (the finally block runs even on assertion
// failure). Same pattern as check_no_external_requests.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const SCRIPT = "scripts/check_pkg_import_isolation.sh";

const WORKER_ALLOWED = [
  "// the single allowlisted importer",
  "const bindings = await import(new URL('../pkg/eigenorg.js', import.meta.url).href);",
  "export default bindings;",
  "",
].join("\n");

/**
 * Run the gate against a synthetic root. `files` maps root-relative paths to
 * contents; a legit www/js/worker.js (so the rename self-check passes) is
 * included unless the case overrides or omits it explicitly.
 * @param {Record<string, string | null>} files null value = do not create
 * @returns {{ status: number | null, output: string }}
 */
function runGate(files) {
  const root = mkdtempSync(join(tmpdir(), "eigenorg-pkggate-"));
  try {
    const tree = { "www/js/worker.js": WORKER_ALLOWED, ...files };
    for (const [rel, content] of Object.entries(tree)) {
      if (content === null) continue;
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    // Forward-slash the path so MSYS bash/grep on Windows accept the
    // drive-letter dir; a no-op on POSIX CI runners.
    const res = spawnSync("bash", [SCRIPT, root.replace(/\\/g, "/")], { encoding: "utf8" });
    return { status: res.status, output: (res.stdout ?? "") + (res.stderr ?? "") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const UI_FAIL = "only www/js/worker.js may import the wasm bundle";
const TESTS_FAIL = "must never be page-loaded";
const STALE_FAIL = "gate scope is stale";

/** @type {{ name: string, files: Record<string, string | null>, msg: string }[]} */
const PLANTS = [
  {
    name: "landing.html inline-script pkg import (html outside the old www/js scope)",
    files: { "www/landing.html": '<script type="module">import init from "./pkg/eigenorg.js"; init();</script>' },
    msg: UI_FAIL,
  },
  {
    name: "index.html inline-script pkg import",
    files: { "www/index.html": '<script type="module">import init from "../pkg/eigenorg.js";</script>' },
    msg: UI_FAIL,
  },
  {
    name: "NEW directory www/lib/evil.js pkg import (dir outside the old scan surface)",
    files: { "www/lib/evil.js": 'import init from "../pkg/eigenorg.js";\n' },
    msg: UI_FAIL,
  },
  {
    name: "quote-terminated bare pkg ref, single quotes (old pattern required a trailing slash)",
    files: { "www/js/sneaky.js": "const mod = await import('../pkg');\n" },
    msg: UI_FAIL,
  },
  {
    name: "quote-terminated bare pkg ref, double quotes",
    files: { "www/js/sneaky.js": 'const mod = await import("../pkg");\n' },
    msg: UI_FAIL,
  },
  {
    name: "backtick-terminated bare pkg ref (template literal)",
    files: { "www/js/sneaky.js": "const p = `../pkg`;\nexport default p;\n" },
    msg: UI_FAIL,
  },
  {
    name: "eigenorg_bg bundle-name reference in a UI file",
    files: { "www/js/direct.mjs": 'const wasm = fetch(new URL("../pkg/eigenorg_bg.wasm", import.meta.url));\n' },
    msg: UI_FAIL,
  },
  {
    name: "tests-dir tripwire: browser-loaded file importing from tests/",
    files: { "www/js/uses-tests.js": 'import { helper } from "./tests/helper.mjs";\n' },
    msg: TESTS_FAIL,
  },
];

for (const plant of PLANTS) {
  test(`gate FAILS on ${plant.name}`, () => {
    const { status, output } = runGate(plant.files);
    assert.notEqual(status, 0, `gate should reject ${plant.name}; output:\n${output}`);
    assert.ok(output.includes(plant.msg), `expected "${plant.msg}" for ${plant.name}; got:\n${output}`);
  });
}

test("gate FAILS when www/js/worker.js no longer references pkg (rename/stale-scope self-check)", () => {
  const { status, output } = runGate({ "www/js/worker.js": "// worker moved elsewhere\nexport {};\n" });
  assert.notEqual(status, 0, `gate should flag a stale allowlist; output:\n${output}`);
  assert.ok(output.includes(STALE_FAIL), `expected "${STALE_FAIL}"; got:\n${output}`);
});

test("gate PASSES a clean tree where ONLY worker.js references pkg", () => {
  const { status, output } = runGate({
    "www/index.html": '<script type="module" src="./js/main.js"></script>',
    "www/js/main.js": 'import { createEngineClient } from "./engine-client.js";\n',
  });
  assert.equal(status, 0, `gate should accept the clean control tree; output:\n${output}`);
});

test("gate PASSES pkg references inside excluded dirs (pkg/, vendor/, tests/)", () => {
  const { status, output } = runGate({
    "www/pkg/eigenorg.js": "export default function init() {} // mentions eigenorg_bg internally\n",
    "www/vendor/chart.umd.min.js": '/* vendored; mentions pkg/ in a sourcemap comment */\n',
    "www/js/tests/worker.test.mjs": 'await import("../../pkg/eigenorg.js"); // node-only, legitimately loads pkg\n',
  });
  assert.equal(status, 0, `excluded dirs must not trip the gate; output:\n${output}`);
});

test("gate PASSES on the real repo tree", () => {
  const res = spawnSync("bash", [SCRIPT], { encoding: "utf8" });
  const output = (res.stdout ?? "") + (res.stderr ?? "");
  assert.equal(res.status, 0, `the real tree must be clean; output:\n${output}`);
  assert.ok(output.includes("pkg-import isolation clean"), output);
});
