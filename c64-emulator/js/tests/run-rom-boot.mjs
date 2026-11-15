import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { C64 } from '../core/C64.js';

const base = resolve(process.cwd(), 'rom');
const files = ['basic.rom', 'kernal.rom', 'chargen.rom'];
const missing = files.filter(name => !existsSync(resolve(base, name)));
if (missing.length) {
  process.stderr.write(`Original-ROM-Integration nicht ausgeführt. Fehlende Dateien: ${missing.join(', ')}\n`);
  process.exitCode = 2;
} else {
  const machine = new C64();
  for (const name of files) machine.loadROM(name.slice(0, -4), readFileSync(resolve(base, name)));
  machine.powerOn();
  const screenCode = text => Array.from(text, character => character.charCodeAt(0) & 63);
  const banner = screenCode('COMMODORE');
  const ready = screenCode('READY.');
  const contains = sequence => {
    const data = machine.memory.ram;
    for (let position = 0x0400; position <= 0x07e8 - sequence.length; position += 1) {
      let matches = true;
      for (let i = 0; i < sequence.length; i += 1) {
        if (data[position + i] !== sequence[i]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    return false;
  };
  let foundBanner = false;
  let foundReady = false;
  for (let elapsed = 0; elapsed < 4000000; elapsed += 10000) {
    machine.runCycles(10000);
    foundBanner ||= contains(banner);
    foundReady ||= contains(ready);
    if (foundBanner && foundReady && machine.vic.frameNumber > 0) break;
    if (machine.cpu.jammed) break;
  }
  const state = machine.cpu.getState();
  process.stdout.write(`Original-ROM-Test: Banner=${foundBanner}, READY=${foundReady}, CPU-PC=$${state.PC.toString(16)}, Frames=${machine.vic.frameNumber}, Takte=${machine.clock.cycle}\n`);
  if (!foundBanner || !foundReady || state.jammed) process.exitCode = 1;
}
