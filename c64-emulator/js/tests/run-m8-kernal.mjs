import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { C64 } from '../core/C64.js';
import { PRGLoader } from '../storage/PRGLoader.js';
import { findScreenText } from '../verification/ReferenceHarness.js';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i < 0 ? fallback : args[i + 1];
};
const directory = resolve(arg('--rom-dir', 'rom'));
const reportPath = arg('--report', null);
const paths = Object.fromEntries(['basic', 'kernal', 'chargen'].map(key => [key, resolve(directory, `${key}.rom`)]));
const missing = Object.entries(paths).filter(([, path]) => !existsSync(path)).map(([name]) => name);
const report = { schema: 'c64-m8-rom-integration-v1', romDir: directory, cases: [], roms: {} };
if (missing.length) {
  report.cases.push({ id: 'original-rom-integration', status: 'skipped', reason: `Fehlende ROMs: ${missing.join(', ')}` });
  if (reportPath) writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`SKIPPED Original-ROM-Integration: ${missing.join(', ')} fehlen\n`);
  process.exit(0);
}
const roms = Object.fromEntries(Object.entries(paths).map(([type, path]) => [type, new Uint8Array(readFileSync(path))]));
for (const [type, data] of Object.entries(roms)) {
  report.roms[type] = { length: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
function createMachine() {
  const machine = new C64();
  for (const [type, data] of Object.entries(roms)) machine.loadROM(type, data);
  machine.powerOn();
  return machine;
}
function boot(machine, budget = 5000000) {
  for (let cycles = 0; cycles < budget; cycles += 10000) {
    machine.runCycles(10000);
    if (machine.cpu.jammed) return false;
    if (machine.vic.frameNumber && findScreenText(machine, 'COMMODORE') >= 0 && findScreenText(machine, 'READY.') >= 0) return true;
  }
  return false;
}
function runToLoop(machine, loopPC, budget = 6000000) {
  let consecutive = 0;
  let lastInstructions = machine.cpu.instructionsExecuted;
  for (let cycle = 0; cycle < budget; cycle += 1) {
    machine.step();
    if (machine.cpu.jammed) return false;
    if (machine.cpu.instructionsExecuted !== lastInstructions) {
      lastInstructions = machine.cpu.instructionsExecuted;
      consecutive = machine.cpu.PC === loopPC ? consecutive + 1 : 0;
      if (consecutive >= 4) return true;
    }
  }
  return false;
}
function record(id, passed, details) {
  const item = { id, status: passed ? 'passed' : 'failed', ...details };
  report.cases.push(item);
  process.stdout.write(`${item.status.toUpperCase()} ${id}: ${JSON.stringify(details)}\n`);
}
try {
  const bootMachine = createMachine();
  const started = boot(bootMachine);
  record('original-basic-boot', started, { cycles: bootMachine.clock.cycle, cpu: bootMachine.cpu.getState(), frames: bootMachine.vic.frameNumber });
  if (started) {
    const loadMachine = createMachine();
    const ready = boot(loadMachine);
    if (ready) {
      const program = PRGLoader.serialize(0x2000, Uint8Array.from([0xa9, 0x42, 0x8d, 0x00, 0x21, 0x60]));
      loadMachine.files.store('M8LOAD', program);
      const length = loadMachine.installKernalFileDemo('load', 'M8LOAD', 1, { preserveSystem: true });
      const completed = runToLoop(loadMachine, 0xc000 + length - 3);
      const transferred = program.subarray(2).every((value, i) => loadMachine.memory.readRAM(0x2000 + i) === value);
      const commands = loadMachine.drive8.events.filter(event => event.type === 'command').map(event => event.value);
      record('original-kernal-load-8-1', completed && transferred && commands.length > 0, {
        completed, transferred, commands, cycles: loadMachine.clock.cycle,
        kernalA: loadMachine.memory.readRAM(0xc220), kernalP: loadMachine.memory.readRAM(0xc221)
      });
    } else {
      record('original-kernal-load-8-1', false, { reason: 'Zweiter Kaltstart nicht abgeschlossen' });
    }
    const saveMachine = createMachine();
    if (boot(saveMachine)) {
      const length = saveMachine.installKernalFileDemo('save', 'M8SAVE', 1, { preserveSystem: true });
      const completed = runToLoop(saveMachine, 0xc000 + length - 3);
      const exported = saveMachine.files.match('M8SAVE')?.data ?? null;
      const expected = PRGLoader.serialize(0xc300, Uint8Array.from({ length: 16 }, (_, i) => (i * 13 + 7) & 255));
      const correct = Boolean(exported) && exported.length === expected.length && expected.every((value, i) => value === exported[i]);
      const commands = saveMachine.drive8.events.filter(event => event.type === 'command').map(event => event.value);
      record('original-kernal-save-8-1', completed && correct && commands.length > 0, {
        completed, correct, commands, bytes: exported?.length ?? 0, cycles: saveMachine.clock.cycle,
        kernalA: saveMachine.memory.readRAM(0xc220), kernalP: saveMachine.memory.readRAM(0xc221)
      });
    } else {
      record('original-kernal-save-8-1', false, { reason: 'Dritter Kaltstart nicht abgeschlossen' });
    }
  } else {
    report.cases.push({ id: 'original-kernal-load-8-1', status: 'blocked', reason: 'Originaler BASIC-Start fehlt' });
    report.cases.push({ id: 'original-kernal-save-8-1', status: 'blocked', reason: 'Originaler BASIC-Start fehlt' });
  }
} catch (error) {
  report.cases.push({ id: 'integration-runner', status: 'error', reason: error.stack ?? error.message });
  process.exitCode = 1;
}
if (report.cases.some(item => item.status === 'failed' || item.status === 'error')) process.exitCode = 1;
if (reportPath) writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
