import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CPU6502 } from '../../core/CPU6510.js';
import { testDataPath } from './paths.js';

const file = process.env.C64_DORMANN_BIN || testDataPath('dormann', '6502_functional_test.bin');
const SUCCESS = Number(process.env.C64_DORMANN_SUCCESS || 0x3469);

test('Klaus Dormann 6502 Functional Test (extern)', { skip: existsSync(file) ? false : `Datei fehlt: ${file}` }, () => {
  const memory = new Uint8Array(readFileSync(file));
  const cpu = new CPU6502({ read: (a) => memory[a], write: (a, v) => { memory[a] = v; } });
  cpu.setRegisters({ pc: 0x0400, s: 0xfd, p: 0x24 });
  let previous = -1;
  for (let i = 0; i < 100_000_000; i++) {
    cpu.runInstruction();
    if (cpu.pc === previous) {
      break;
    }
    previous = cpu.pc === cpu.lastOpcodeAddress ? cpu.pc : -1;
  }
  assert.equal(cpu.pc.toString(16), SUCCESS.toString(16), `Testprogramm endet in Fehlerfalle bei $${cpu.pc.toString(16)}`);
});
