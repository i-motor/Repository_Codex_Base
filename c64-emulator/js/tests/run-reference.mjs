import { readFile } from 'node:fs/promises';
import { CPUReferenceMachine } from '../verification/CPUReferenceMachine.js';

const [filename, startHex, successHex, maxText = '50000000'] = process.argv.slice(2);
if (!filename || !startHex || !successHex) {
  process.stderr.write('Aufruf: node --experimental-default-type=module js/tests/run-reference.mjs <bin-datei> <start-hex> <erfolg-pc-hex> [max-takte]\n');
  process.exit(2);
}
const start = Number.parseInt(startHex.replace(/^\$/, ''), 16);
const success = Number.parseInt(successHex.replace(/^\$/, ''), 16);
const maxCycles = Number(maxText);
if (![start, success].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff) ||
    !Number.isSafeInteger(maxCycles) || maxCycles < 1) {
  throw new RangeError('Ungültige Testparameter');
}
const binary = new Uint8Array(await readFile(filename));
if (binary.length !== 65536) throw new RangeError(`Es werden vollständige 65536-Byte-Testspeicher erwartet, erhalten: ${binary.length}`);
const c64 = new CPUReferenceMachine();
c64.memory.ram.set(binary);
c64.cpu.setTestState({ PC: start, SP: 0xfd, P: 0x20 });
let atTarget = 0;
let previousCount = 0;
for (let cycle = 0; cycle < maxCycles; cycle += 1) {
  c64.step();
  const state = c64.cpu.getState();
  if (state.jammed) {
    process.stderr.write(`JAM nach ${cycle + 1} Takten, PC=$${state.PC.toString(16)}\n`);
    process.exit(1);
  }
  if (state.instructionCount !== previousCount) {
    previousCount = state.instructionCount;
    atTarget = state.PC === success ? atTarget + 1 : 0;
    if (atTarget >= 4) {
      process.stdout.write(`Referenztest-Erfolg: stabiler Ziel-PC $${success.toString(16)}, ${cycle + 1} CPU-Takte, ${previousCount} Befehle\n`);
      process.exit(0);
    }
  }
}
const last = c64.cpu.getState();
process.stderr.write(`Referenztest ohne Erfolg: ${maxCycles} Takte, PC=$${last.PC.toString(16)}, ${last.instructionCount} Befehle\n`);
process.exit(1);
