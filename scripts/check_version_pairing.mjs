// modelVersion <-> extracted-artifact hash pairing gate (MODEL.md §12.6).
//
// Recomputes sha256 of the three extracted artifacts and asserts the MODEL.md
// §14 changelog table has a row whose modelVersion equals the declaration in
// model/params.json AND whose three sha columns equal the recomputed hashes.
// Pairing all three (not params.json alone) catches a tolerance-only amendment
// (touches goldens.json) and a formula edit that surfaces only in
// assumptions.json. P1 defines the declaration format (the §14 table); P3 wires.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** @param {string} path */
function sha256(path) {
  // The artifacts are UTF-8; hashing the UTF-8 string reproduces the byte hash.
  return createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex');
}

const declared = JSON.parse(readFileSync('model/params.json', 'utf8')).modelVersion;
const hashes = {
  params: sha256('model/params.json'),
  goldens: sha256('model/goldens.json'),
  assumptions: sha256('www/assumptions.json'),
};

const model = readFileSync('MODEL.md', 'utf8');
// Changelog rows: | modelVersion | date | paramsSha | goldensSha | assumptionsSha | changes |
const rows = model
  .split('\n')
  .filter((l) => /^\|\s*\d+\.\d+\.\d+\s*\|/.test(l))
  .map((l) => l.split('|').map((c) => c.trim().replace(/`/g, '')));

const row = rows.find((c) => c[1] === declared);
if (!row) {
  console.error(`FAIL: no §14 changelog row for declared modelVersion ${declared}`);
  process.exit(1);
}
const [, , , paramsSha, goldensSha, assumptionsSha] = row;
const mismatches = [];
if (paramsSha !== hashes.params) mismatches.push(`params.json (row ${paramsSha} != ${hashes.params})`);
if (goldensSha !== hashes.goldens) mismatches.push(`goldens.json (row ${goldensSha} != ${hashes.goldens})`);
if (assumptionsSha !== hashes.assumptions)
  mismatches.push(`assumptions.json (row ${assumptionsSha} != ${hashes.assumptions})`);

if (mismatches.length) {
  console.error(`FAIL: modelVersion ${declared} artifact-hash pairing mismatch:\n  ${mismatches.join('\n  ')}`);
  process.exit(1);
}
console.log(`version pairing OK: modelVersion ${declared} matches all three artifact hashes`);
