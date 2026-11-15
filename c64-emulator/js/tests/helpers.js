import { CPU6502 } from '../core/CPU6510.js';
import { assemble } from '../utils/Assembler.js';
import { C64 } from '../core/C64.js';

export class FlatBus {
  constructor() {
    this.memory = new Uint8Array(65536);
    this.log = [];
    this.logging = false;
  }

  read(address) {
    const value = this.memory[address];
    if (this.logging) {
      this.log.push(['r', address, value]);
    }
    return value;
  }

  write(address, value) {
    this.memory[address] = value;
    if (this.logging) {
      this.log.push(['w', address, value]);
    }
  }
}

export function makeCpu(source, origin = 0x0200, vectors = {}) {
  const bus = new FlatBus();
  const program = assemble(source, origin);
  bus.memory.set(program.bytes, program.origin);
  const reset = vectors.reset ?? program.origin;
  bus.memory[0xfffc] = reset & 0xff;
  bus.memory[0xfffd] = reset >> 8;
  if (vectors.irq !== undefined) {
    bus.memory[0xfffe] = vectors.irq & 0xff;
    bus.memory[0xffff] = vectors.irq >> 8;
  }
  if (vectors.nmi !== undefined) {
    bus.memory[0xfffa] = vectors.nmi & 0xff;
    bus.memory[0xfffb] = vectors.nmi >> 8;
  }
  const cpu = new CPU6502(bus);
  cpu.setRegisters({ pc: reset, s: 0xff, p: 0x24 });
  return { cpu, bus, labels: program.labels };
}

export function runUntil(cpu, predicate, maxCycles = 1_000_000) {
  for (let i = 0; i < maxCycles; i++) {
    cpu.cycle();
    if (cpu.t === 0 && predicate(cpu)) {
      return i + 1;
    }
  }
  throw new Error('runUntil: Zeitlimit überschritten');
}

export function instructionCycles(cpu) {
  return cpu.runInstruction();
}

export function makeTestC64(source) {
  const program = assemble(`* = $e000\n${source}`, 0xe000);
  const kernal = new Uint8Array(8192);
  kernal.set(program.bytes.subarray(0, 8192), program.origin - 0xe000);
  const c64 = new C64();
  c64.memory.loadRom('kernal', kernal);
  c64.memory.loadRom('basic', new Uint8Array(8192));
  c64.memory.loadRom('chargen', new Uint8Array(4096).fill(0xaa));
  c64.powerOn();
  return { c64, labels: program.labels };
}
