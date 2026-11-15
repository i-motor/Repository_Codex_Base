import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyManifest } from '../verification/ReferenceHarness.js';

const argumentsList = process.argv.slice(2);
const option = flag => {
  const position = argumentsList.indexOf(flag);
  return position < 0 ? null : argumentsList[position + 1];
};
const manifestFile = resolve(option('--manifest') ?? 'tests/references/local-m8.json');
const romDir = resolve(option('--rom-dir') ?? 'rom');
const reportFile = option('--report') ? resolve(option('--report')) : null;
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const paths = Object.fromEntries(['basic', 'kernal', 'chargen'].map(type => [type, resolve(romDir, `${type}.rom`)]));
const allROMs = Object.values(paths).every(existsSync);
const roms = allROMs ? Object.fromEntries(Object.entries(paths).map(([type, name]) => [type, new Uint8Array(readFileSync(name))])) : null;
const checksums = Object.fromEntries(Object.entries(paths).map(([type, name]) => [type, existsSync(name) ? createHash('sha256').update(readFileSync(name)).digest('hex') : null]));
const referenceFiles = {};
const results = verifyManifest(manifest, {
  roms,
  loadBinary: filename => {
    const data = readFileSync(resolve(dirname(manifestFile), filename));
    referenceFiles[filename] = {
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex')
    };
    return new Uint8Array(data);
  }
});
const summary = {
  schema: 'c64-m8-report-v1',
  manifest: manifestFile,
  roms: checksums,
  referenceFiles,
  counts: {
    passed: results.filter(item => item.status === 'passed').length,
    failed: results.filter(item => item.status === 'failed').length,
    skipped: results.filter(item => item.status === 'skipped').length,
    error: results.filter(item => item.status === 'error').length
  },
  results
};
for (const result of results) {
  process.stdout.write(`${result.status.toUpperCase().padEnd(7)} ${result.id} ${result.reason ?? (result.mismatches?.length ? JSON.stringify(result.mismatches) : '')}\n`);
}
process.stdout.write(`${JSON.stringify(summary.counts)}\n`);
if (reportFile) writeFileSync(reportFile, JSON.stringify(summary, null, 2) + '\n');
if (summary.counts.failed + summary.counts.error > 0) process.exitCode = 1;
