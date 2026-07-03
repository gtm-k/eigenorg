// @ts-nocheck -- dev-only Node server; the P0 scaffold ships no @types/node
// (P2 may add only the chart.js devDependency), so node: module imports are
// unresolvable to tsc. Runtime-only file, exercised on every local run.
//
// Local GitHub-Pages-equivalent server (PLAN P2, PREMORTEM T2):
//   1. Serves the repo's www/ at http://localhost:PORT/eigenorg/ — emulating
//      the Pages *project subpath* so import.meta.url / relative-path bugs
//      surface during dev, not at the P9 public flip.
//   2. Rejects requests whose path does not EXACT-CASE match the file on
//      disk. GitHub Pages serves case-sensitively from Linux; the Windows
//      dev filesystem is case-insensitive and would otherwise mask case bugs
//      until flip time.
//
// Usage: node scripts/serve.mjs [port]   (default 8080, or PORT env var)

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUBPATH = '/eigenorg';
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8', // wasm-pack emits .d.ts into pkg
};

/**
 * Walk segments from ROOT requiring an exact-case directory-entry match at
 * every level (the Pages-on-Linux behavior). Returns { fsPath, isDir } or
 * { status, reason }.
 */
async function resolveExactCase(segments) {
  let cur = ROOT;
  for (const seg of segments) {
    let entries;
    try {
      entries = await fs.readdir(cur);
    } catch {
      return { status: 404, reason: `not a directory: ${path.relative(ROOT, cur)}` };
    }
    if (!entries.includes(seg)) {
      const ci = entries.find((e) => e.toLowerCase() === seg.toLowerCase());
      if (ci) {
        return {
          status: 404,
          reason: `CASE MISMATCH: request segment "${seg}" vs on-disk "${ci}" — GitHub Pages (Linux) would 404 this`,
        };
      }
      return { status: 404, reason: `no such entry: "${seg}"` };
    }
    cur = path.join(cur, seg);
  }
  const st = await fs.stat(cur);
  return { fsPath: cur, isDir: st.isDirectory() };
}

function deny(res, status, reason) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${status} — ${reason}\n`);
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  } catch {
    return deny(res, 400, 'malformed URL');
  }
  const log = (status, extra = '') =>
    console.log(`${status} ${req.method} ${pathname}${extra ? ` (${extra})` : ''}`);

  // Convenience: the bare origin redirects into the subpath (dev nicety only —
  // the real gtm-k.github.io root is a different site).
  if (pathname === '/') {
    res.writeHead(302, { Location: `${SUBPATH}/` });
    res.end();
    return log(302, `dev redirect into ${SUBPATH}/`);
  }
  if (pathname === SUBPATH) {
    // Pages redirects /eigenorg -> /eigenorg/
    res.writeHead(301, { Location: `${SUBPATH}/` });
    res.end();
    return log(301, 'subpath trailing-slash redirect');
  }
  if (!pathname.startsWith(`${SUBPATH}/`)) {
    log(404, 'outside the project subpath — a root-relative path leaked');
    return deny(res, 404, `outside ${SUBPATH}/ — on Pages this asset would 404 (root-relative path bug?)`);
  }

  const rel = pathname.slice(SUBPATH.length + 1);
  const wantsDir = rel === '' || rel.endsWith('/');
  const segments = rel.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '.' || s === '..')) {
    log(400);
    return deny(res, 400, 'path traversal rejected');
  }

  const resolved = await resolveExactCase(segments).catch(() => ({ status: 404, reason: 'not found' }));
  if (resolved.status) {
    log(resolved.status, resolved.reason);
    return deny(res, resolved.status, resolved.reason);
  }

  let filePath = resolved.fsPath;
  if (resolved.isDir) {
    if (!wantsDir) {
      // Pages redirects directory paths to the trailing-slash form.
      res.writeHead(301, { Location: `${pathname}/` });
      res.end();
      return log(301, 'directory trailing-slash redirect');
    }
    const idx = await resolveExactCase([...segments, 'index.html']).catch(() => ({ status: 404, reason: 'no index.html' }));
    if (idx.status) {
      log(404, idx.reason);
      return deny(res, 404, idx.reason);
    }
    filePath = idx.fsPath;
  } else if (wantsDir) {
    log(404, 'trailing slash on a file');
    return deny(res, 404, 'trailing slash on a file');
  }

  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store', // dev server: always fresh
    });
    res.end(body);
    log(200);
  } catch (err) {
    log(500, String(err));
    deny(res, 500, 'read error');
  }
});

server.listen(PORT, () => {
  console.log(`eigenorg dev server (Pages-subpath emulation, case-strict)`);
  console.log(`  serving ${ROOT}`);
  console.log(`  open    http://localhost:${PORT}${SUBPATH}/`);
});
