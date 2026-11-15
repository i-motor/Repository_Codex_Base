import { CPU6510 } from '../core/CPU6510.js';
import { InterruptController } from '../core/InterruptController.js';
import { Memory } from '../core/Memory.js';
import { Clock } from '../core/Clock.js';

export class CPUReferenceMachine {
  constructor() {
    this.interrupts = new InterruptController();
    this.cpu = new CPU6510(this.interrupts);
    this.memory = new Memory();
    this.clock = new Clock();
    this.externalRDYHigh = true;
    this.bus = {
      cpuRead: address => this.memory.readRAM(address),
      cpuWrite: (address, value) => this.memory.writeRAM(address, value),
      peek: address => this.memory.readRAM(address)
    };
    this.powerOn();
  }

  powerOn() {
    this.memory.powerOn();
    this.interrupts.reset();
    this.cpu.powerOn();
    this.clock.reset();
    this.externalRDYHigh = true;
  }

  step() {
    const cycle = this.clock.cycle;
    const intent = this.cpu.nextBusCycle();
    const active = intent.kind !== 'idle';
    const advanceCPU = active && (intent.kind === 'write' || this.externalRDYHigh);
    const value = intent.kind === 'read' ? this.bus.cpuRead(intent.address) : undefined;
    if (intent.kind === 'write') this.bus.cpuWrite(intent.address, intent.value);
    this.cpu.completeBusCycle({ advanceCPU, value });
    this.clock.tick();
    return {
      cycle, kind: active ? intent.kind : 'idle', address: intent.address,
      value: intent.kind === 'write' ? intent.value : value, stage: intent.stage,
      advanced: advanceCPU, repeatedRead: intent.kind === 'read' && !advanceCPU,
      owner: active ? 'cpu' : 'none'
    };
  }

  runCycles(count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000000) throw new RangeError('Ungültige Taktanzahl');
    for (let i = 0; i < count; i += 1) this.step();
    return this.cpu.getState();
  }
}
