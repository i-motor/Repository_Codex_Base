import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { D64Image } from '../storage/D64Image.js';
import { Drive1541 } from '../drive1541/Drive1541.js';
import { C64 } from '../core/C64.js';
import { SID6581 } from '../audio/SID6581.js';
import { PAL_PROFILE, NTSC_PROFILE } from '../utils/Constants.js';
import { GCRCodec } from '../drive1541/GCRCodec.js';
import { test, assertEqual, assertBytes, runAll } from './harness.js';

const args = process.argv.slice(2);
const option = name => {
  const position = args.indexOf(name);
  return position >= 0 ? args[position + 1] : null;
};
const paths = {
  romDir: resolve(option('--rom-dir') ?? 'rom'),
  driveROM: resolve(option('--1541-rom') ?? 'rom/1541.rom'),
  externalD64: resolve(option('--d64') ?? 'rom/reference.d64'),
  driveTrace: resolve(option('--1541-trace') ?? 'tests/references/1541-external.json'),
  sidTrace: resolve(option('--sid-trace') ?? 'tests/references/sid-external.json'),
  vicTrace: resolve(option('--ntsc-trace') ?? 'tests/references/ntsc-external.json')
};
const reportPath = resolve(option('--report') ?? 'reports/m9-local.json');
const manifest = JSON.parse(readFileSync('tests/references/m9-local-vectors.json', 'utf8'));
const report = {
  schema: 'c64-m9-verification-report-v1',
  profiles: ['PAL MOS 6569', 'NTSC MOS 6567R8'],
  manifest: 'tests/references/m9-local-vectors.json',
  cases: [],
  counts: { passed: 0, failed: 0, skipped: 0, error: 0 }
};
const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex');
const record = (id, status, classification, details = {}) => {
  report.cases.push({ id, status, classification, ...details });
  report.counts[status] += 1;
  process.stdout.write(`${status.toUpperCase().padEnd(7)} ${id}${details.reason ? `: ${details.reason}` : ''}\n`);
};
const check = async (id, classification, callback) => {
  try {
    const details = await callback();
    record(id, 'passed', classification, details ?? {});
  } catch (error) {
    record(id, 'failed', classification, { reason: error.message });
  }
};
const skip = (id, path) => record(id, 'skipped', 'external-reference-not-provided', { reason: `Datei fehlt: ${path}` });

await check('pal-and-ntsc-cycle-geometry', 'local-specification', () => {
  const { pal, ntsc6567r8 } = manifest.hardware;
  for (const [profile, values] of [[PAL_PROFILE, pal], [NTSC_PROFILE, ntsc6567r8]]) {
    if (profile.linesPerFrame !== values.linesPerFrame || profile.cyclesPerLine !== values.cyclesPerLine ||
        profile.linesPerFrame * profile.cyclesPerLine !== values.cyclesPerFrame) throw new Error('Rastergeometrie abweichend');
  }
});
await check('gcr-fixed-encoding-vector', 'local-specification', () => {
  const { bytes, encoded } = manifest.hardware.gcr;
  const output = GCRCodec.encode(Uint8Array.from(bytes));
  if (output.some((byte, i) => byte !== encoded[i])) throw new Error('GCR-Vektor abweichend');
  if (GCRCodec.decode(output).some((byte, i) => byte !== bytes[i])) throw new Error('GCR-Decode abweichend');
});
await check('d64-format-geometry', 'local-specification', () => {
  const { d64 } = manifest.hardware;
  for (const [tracks, length, count] of [[35,d64.tracks35Bytes,d64.tracks35Sectors],[40,d64.tracks40Bytes,d64.tracks40Sectors]]) {
    const image = D64Image.create({ tracks });
    if (image.data.length !== length || image.sectorCount !== count) throw new Error('D64-Geometrie abweichend');
  }
});

try {
  const output = execFileSync(process.execPath, ['js/tests/run-worker-node.mjs'], { encoding: 'utf8', timeout: 30000 });
  record('native-worker-emulator', 'passed', 'node-worker-integration', { output: output.trim() });
} catch (error) {
  record('native-worker-emulator', 'failed', 'node-worker-integration', { reason: String(error.stderr || error.message) });
}

if (existsSync(paths.externalD64)) {
  await check('external-d64-directory-and-chains', 'user-provided-d64-image', () => {
    const bytes = readFileSync(paths.externalD64);
    const disk = new D64Image(bytes);
    const entries = disk.listDirectory();
    let prgsRead = 0;
    for (const entry of entries) if (entry.type === 'PRG') {
      disk.readPRG(entry.name);
      prgsRead += 1;
    }
    return { sha256: fingerprint(bytes), tracks: disk.tracks, directoryEntries: entries.length, prgsRead };
  });
} else skip('external-d64-directory-and-chains', paths.externalD64);

if (existsSync(paths.driveROM)) {
  await check('1541-firmware-rom-smoke', 'user-provided-firmware-smoke', () => {
    const rom = readFileSync(paths.driveROM);
    const drive = new Drive1541({ c64Hz: PAL_PROFILE.cpuHz });
    drive.loadROM(rom);
    drive.advanceC64Cycles(50000);
    if (drive.cpu.jammed) throw new Error('1541-CPU erreichte JAM/KIL');
    return { sha256: fingerprint(rom), cycles: drive.cycles, pc: drive.cpu.PC, instructions: drive.cpu.instructionsExecuted };
  });
} else skip('1541-firmware-rom-smoke', paths.driveROM);

if (existsSync(paths.driveTrace) && existsSync(paths.driveROM)) {
  await check('1541-external-cycle-reference', 'user-provided-reference-trace', () => {
    const fixture = JSON.parse(readFileSync(paths.driveTrace, 'utf8'));
    if (fixture.schema !== 'c64-m9-1541-cycle-trace-v1') throw new Error('Unbekanntes Laufwerks-Referenzformat');
    const drive = new Drive1541();
    drive.loadROM(readFileSync(paths.driveROM));
    if (fixture.d64) drive.mount(new D64Image(readFileSync(resolve(fixture.d64))));
    let previous = 0;
    for (const expected of fixture.checkpoints) {
      if (!Number.isInteger(expected.cycle) || expected.cycle < previous || expected.cycle > 2000000) throw new RangeError('Ungültiger Prüftakt');
      for (let i = previous; i < expected.cycle; i += 1) drive.step();
      previous = expected.cycle;
      const actual = drive.getState();
      for (const register of ['PC','A','X','Y','SP','P']) {
        if (expected.cpu?.[register] !== undefined && actual.cpu[register] !== expected.cpu[register]) {
          throw new Error(`Zyklus ${previous}: CPU ${register} erwartet ${expected.cpu[register]}, erhalten ${actual.cpu[register]}`);
        }
      }
      for (const name of ['headTrack','bitPosition']) if (expected[name] !== undefined && actual[name] !== expected[name]) throw new Error(`Zyklus ${previous}: ${name} abweichend`);
    }
    return { checkpoints: fixture.checkpoints.length };
  });
} else skip('1541-external-cycle-reference', paths.driveTrace);

if (existsSync(paths.sidTrace)) {
  await check('sid-external-audio-reference', 'user-provided-reference-trace', () => {
    const fixture = JSON.parse(readFileSync(paths.sidTrace, 'utf8'));
    if (fixture.schema !== 'c64-m9-sid-samples-v1') throw new Error('Unbekanntes SID-Referenzformat');
    const sid = new SID6581({ model: fixture.model ?? '6581', cpuHz: fixture.cpuHz ?? PAL_PROFILE.cpuHz });
    const writes = fixture.writes ?? [];
    const checkpoints = fixture.checkpoints ?? [];
    let w = 0;
    let c = 0;
    const until = Math.max(0, ...checkpoints.map(entry => entry.cycle));
    if (until > 2000000) throw new RangeError('SID-Prüflauf zu lang');
    for (let cycle = 0; cycle <= until; cycle += 1) {
      while (w < writes.length && writes[w].cycle === cycle) {
        sid.writeRegister(writes[w].address, writes[w].value);
        w += 1;
      }
      if (cycle < until) sid.tick();
      while (c < checkpoints.length && checkpoints[c].cycle === cycle) {
        const point = checkpoints[c++];
        if (Math.abs(sid.getOutput() - point.output) > (point.tolerance ?? 0.001)) throw new Error(`SID-Abweichung bei Takt ${cycle}`);
      }
    }
    return { checkpoints: c };
  });
} else skip('sid-external-audio-reference', paths.sidTrace);

if (existsSync(paths.vicTrace)) {
  await check('ntsc-vic-external-raster-reference', 'user-provided-reference-trace', () => {
    const fixture = JSON.parse(readFileSync(paths.vicTrace, 'utf8'));
    if (fixture.schema !== 'c64-m9-ntsc-raster-v1') throw new Error('Unbekanntes VIC-Referenzformat');
    const machine = new C64({ videoStandard: 'NTSC' });
    let previous = 0;
    for (const checkpoint of fixture.checkpoints) {
      if (!Number.isInteger(checkpoint.cycle) || checkpoint.cycle < previous || checkpoint.cycle > 2000000) throw new RangeError('Ungültiger VIC-Prüftakt');
      machine.runCycles(checkpoint.cycle - previous);
      previous = checkpoint.cycle;
      const pos = machine.clock.getPosition();
      for (const field of ['raster', 'frame', 'cycleInLine']) if (checkpoint[field] !== undefined && pos[field] !== checkpoint[field]) throw new Error(`VIC-Position ${field} weicht ab`);
    }
    return { checkpoints: fixture.checkpoints.length };
  });
} else skip('ntsc-vic-external-raster-reference', paths.vicTrace);

const completeROMs = ['basic.rom','kernal.rom','chargen.rom'].every(filename => existsSync(resolve(paths.romDir, filename)));
if (completeROMs) {
  try {
    const output = execFileSync(process.execPath, ['js/tests/run-m8-kernal.mjs', '--rom-dir', paths.romDir], { encoding: 'utf8', timeout: 120000 });
    record('original-c64-rom-boot-and-iec', 'passed', 'user-provided-original-rom-integration', { output: output.trim() });
  } catch (error) {
    record('original-c64-rom-boot-and-iec', 'failed', 'user-provided-original-rom-integration', { reason: String(error.stdout || error.stderr || error.message) });
  }
} else skip('original-c64-rom-boot-and-iec', paths.romDir);

record('firefox-gamepad-and-worker-runtime', 'skipped', 'manual-firefox-verification-required', { reason: 'Native Firefox-Ausführung benötigt einen manuellen Browsertest' });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`${JSON.stringify(report.counts)}\n`);
if (report.counts.failed + report.counts.error) process.exitCode = 1;
