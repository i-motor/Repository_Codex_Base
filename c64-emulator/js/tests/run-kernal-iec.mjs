import { readFile } from 'node:fs/promises';
import { C64 } from '../core/C64.js';
import { PRGLoader } from '../storage/PRGLoader.js';

const [basicPath, kernalPath, chargenPath, prgPath] = process.argv.slice(2);
if (!basicPath || !kernalPath || !chargenPath) {
  process.stderr.write('Aufruf: node js/tests/run-kernal-iec.mjs basic.rom kernal.rom chargen.rom [datei.prg]\n');
  process.exit(2);
}

const machine = new C64();
for (const [type, path] of [['basic', basicPath], ['kernal', kernalPath], ['chargen', chargenPath]]) {
  machine.loadROM(type, await readFile(path));
}
const fixture = prgPath ? new Uint8Array(await readFile(prgPath)) : PRGLoader.serialize(0x2000, Uint8Array.from([0xa9, 0x42, 0x8d, 0x00, 0x21, 0x60]));
PRGLoader.validate(fixture);
const targetName = 'IEC-TEST';
machine.files.store(targetName, fixture);
const instructions = machine.installKernalFileDemo('load', targetName, 1);
const loopPC = 0xc000 + instructions - 3;
let done = false;
let elapsed = 0;
const budget = 4000000;
while (elapsed < budget && !done) {
  machine.runCycles(2000);
  elapsed += 2000;
  done = machine.cpu.getState().PC === loopPC;
}
const expected = PRGLoader.parse(fixture);
let correct = done;
for (let i = 0; correct && i < expected.data.length; i += 1) {
  if (machine.memory.readRAM((expected.loadAddress + i) & 0xffff) !== expected.data[i]) correct = false;
}
const result = {
  done, correct, cycles: elapsed, pc: machine.cpu.getState().PC,
  kernalReturn: machine.memory.readRAM(0xc220),
  kernalFlags: machine.memory.readRAM(0xc221),
  iecCommands: machine.drive8.events.filter(event => event.type === 'command').map(event => event.value),
  driveStatus: machine.drive8.status.trim()
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!correct) process.exitCode = 1;
