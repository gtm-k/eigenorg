// scripts/check_no_external_requests.test.mjs
// Self-test for scripts/check_no_external_requests.sh (R2-2). Writes throwaway probe
// files that exercise EVERY request-sink pattern the gate enforces and asserts the
// gate FAILS (non-zero exit + the matching message) on each, so a silent pattern
// regression is loud rather than a hole. A relative-only control probe must PASS.
//
// Probes live in an OS temp dir — never inside the repo, never committed — and are
// removed after each case (the finally block runs even on assertion failure).
// Run by CI: node --test discovers *.test.mjs and executes this in the JS job.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/check_no_external_requests.sh";

/**
 * Run the gate against a single-file probe directory.
 * @param {string} filename
 * @param {string} content
 * @returns {{ status: number | null, output: string }}
 */
function runGate(filename, content) {
  const dir = mkdtempSync(join(tmpdir(), "eigenorg-extreq-"));
  try {
    writeFileSync(join(dir, filename), content, "utf8");
    // Forward-slash the path so MSYS grep on Windows accepts the drive-letter dir;
    // a no-op on POSIX CI runners.
    const res = spawnSync("bash", [SCRIPT, dir.replace(/\\/g, "/")], { encoding: "utf8" });
    return { status: res.status, output: (res.stdout ?? "") + (res.stderr ?? "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Every request-sink pattern in the gate, each with a probe that trips exactly it
 * and the `fail` message the gate must emit.
 * @type {{ name: string, file: string, body: string, msg: string }[]}
 */
const PROBES = [
  { name: "fetch() absolute", file: "p.js", body: 'fetch("https://evil.example/a.json");', msg: "fetch() to an absolute http(s) URL" },
  { name: "<script src> absolute", file: "p.html", body: '<script src="https://evil.example/a.js"></script>', msg: "<script src> to an absolute http(s) URL" },
  { name: "<link href> absolute", file: "p.html", body: '<link rel="stylesheet" href="https://evil.example/a.css">', msg: "<link href> to an absolute http(s) URL" },
  { name: "dynamic import()", file: "p.js", body: 'const m = import("https://evil.example/a.js");', msg: "dynamic import() of an absolute http(s) URL" },
  { name: "new Worker() absolute", file: "p.js", body: 'const w = new Worker("https://evil.example/w.js");', msg: "new Worker() from an absolute http(s) URL" },
  { name: "static from-import", file: "p.js", body: 'import thing from "https://evil.example/a.js";', msg: "static ESM import from an absolute http(s) URL" },
  { name: "bare side-effect import", file: "p.js", body: 'import "https://evil.example/a.js";', msg: "bare side-effect import of an absolute http(s) URL" },
  { name: "<img src> absolute", file: "p.html", body: '<img src="https://evil.example/a.png">', msg: "<img src> to an absolute http(s) URL" },
  { name: "CSS url() absolute", file: "p.css", body: ".x { background: url(https://evil.example/a.png); }", msg: "CSS url() to an absolute http(s) URL" },
  { name: "protocol-relative //host", file: "p.js", body: 'fetch("//cdn.example/a.json");', msg: "protocol-relative //host request target" },
  { name: "sendBeacon", file: "p.js", body: 'navigator.sendBeacon("/collect", payload);', msg: "sendBeacon usage" },
  { name: "XMLHttpRequest", file: "p.js", body: "const x = new XMLHttpRequest();", msg: "XMLHttpRequest usage" },
  { name: "new WebSocket", file: "p.js", body: 'const s = new WebSocket("/live");', msg: "new WebSocket usage" },
  { name: "new EventSource", file: "p.js", body: 'const e = new EventSource("/events");', msg: "new EventSource usage" },
];

for (const probe of PROBES) {
  test(`gate FAILS on ${probe.name}`, () => {
    const { status, output } = runGate(probe.file, probe.body);
    assert.notEqual(status, 0, `gate should reject ${probe.name}; output:\n${output}`);
    assert.ok(
      output.includes(probe.msg),
      `expected message "${probe.msg}" for ${probe.name}; got:\n${output}`,
    );
  });
}

test("gate PASSES on a relative-only control probe", () => {
  const { status, output } = runGate(
    "clean.js",
    'export const x = 1;\nfetch("./data.json");\nimport y from "./mod.js";\n',
  );
  assert.equal(status, 0, `gate should accept relative-only content; output:\n${output}`);
});
