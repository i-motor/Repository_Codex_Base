import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CPU6502 } from '../../core/CPU6510.js';
import { OPCODES } from '../../core/OpcodeTable.js';
import { testDataPath } from './paths.js';

const directory = process.env.C64_HARTE_DIR || testDataPath('harte');
const limit = Number(process.env.C64_HARTE_LIMIT || 400);

function loadTests(opcode) {
  const hex = opcode.toString(16).padStart(2, '0');
  const candidates = [`${hex}.json`, `${hex}.part`];
  for (const name of candidates) {
    const file = join(directory, name);
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const tests = [];
      for (const raw of lines) {
        const line = raw.trim().replace(/,$/, '');
        if (!line.startsWith('{') || !line.endsWith('}')) {
          continue;
        }
        try {
          tests.push(JSON.parse(line));
        } catch {
          continue;
        }
        if (tests.length >= limit) {
          break;
        }
      }
      return tests;
    }
  }
  return null;
}

function runCase(testCase) {
  const memory = new Map();
  const log = [];
  const bus = {
    read(address) {
      const value = memory.has(address) ? memory.get(address) : 0;
      log.push([address, value, 'read']);
      return value;
    },
    write(address, value) {
      memory.set(address, value);
      log.push([address, value, 'write']);
    }
  };
  const cpu = new CPU6502(bus);
  const init = testCase.initial;
  for (const [address, value] of init.ram) {
    memory.set(address, value);
  }
  cpu.setRegisters({ a: init.a, x: init.x, y: init.y, s: init.s, pc: init.pc, p: init.p });
  const expected = testCase.cycles.length;
  for (let i = 0; i < expected; i++) {
    cpu.cycle();
    if (cpu.t === 0 && !cpu.jammed) {
      break;
    }
  }
  const problems = [];
  const fin = testCase.final;
  const regs = { pc: cpu.pc, s: cpu.s, a: cpu.a, x: cpu.x, y: cpu.y, p: cpu.getP() | 0x30 };
  for (const key of ['pc', 's', 'a', 'x', 'y']) {
    if (regs[key] !== fin[key]) {
      problems.push(`${key}: ${regs[key]} != ${fin[key]}`);
    }
  }
  if ((regs.p & 0xcf) !== (fin.p & 0xcf)) {
    problems.push(`p: ${regs.p.toString(2)} != ${fin.p.toString(2)}`);
  }
  for (const [address, value] of fin.ram) {
    const actual = memory.has(address) ? memory.get(address) : 0;
    if (actual !== value) {
      problems.push(`ram[${address}]: ${actual} != ${value}`);
    }
  }
  if (log.length !== testCase.cycles.length) {
    problems.push(`cycles: ${log.length} != ${testCase.cycles.length}`);
  } else {
    for (let i = 0; i < log.length; i++) {
      const [a, v, k] = testCase.cycles[i];
      const [aa, vv, kk] = log[i];
      if (a !== aa || v !== vv || k !== kk) {
        problems.push(`bus ${i}: ${aa}/${vv}/${kk} != ${a}/${v}/${k}`);
        break;
      }
    }
  }
  return problems;
}

const available = existsSync(directory) && readdirSync(directory).length > 0;

test('Tom Harte SingleStepTests 6502 (extern)', { skip: available ? false : `keine Testdaten in ${directory}` }, async (t) => {
  for (let opcode = 0; opcode < 256; opcode++) {
    const entry = OPCODES[opcode];
    const tests = loadTests(opcode);
    if (!tests) {
      continue;
    }
    await t.test(`$${opcode.toString(16).padStart(2, '0')} ${entry.mnemonic} ${entry.modeName}`, () => {
      const failures = [];
      for (const testCase of tests) {
        const problems = runCase(testCase);
        if (problems.length) {
          failures.push(`${testCase.name}: ${problems.join('; ')}`);
        }
      }
      assert.equal(failures.length, 0, `${failures.length}/${tests.length} fehlgeschlagen\n${failures.slice(0, 5).join('\n')}`);
    });
  }
});
