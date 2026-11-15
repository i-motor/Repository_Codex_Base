import { SIDVoice } from './SIDVoice.js';
import { SIDFilter } from './SIDFilter.js';

export class SID6581 {
  constructor({ cpuHz = 985248.44, model = '6581' } = {}) {
    this.cpuHz = cpuHz;
    this.voices = [new SIDVoice(), new SIDVoice(), new SIDVoice()];
    this.filter = new SIDFilter(cpuHz, model);
    this.registers = new Uint8Array(32);
    this.potX = 255;
    this.potY = 255;
    this.reset();
  }

  reset() {
    this.registers.fill(0);
    for (const voice of this.voices) voice.reset();
    this.filter.reset();
    this.cycles = 0;
    this.output = 0;
    this.busLatch = 0;
    this.latchCycle = -100000;
  }

  setModel(model) {
    this.filter.setModel(model);
  }

  setPaddles(x, y) {
    this.potX = x & 255;
    this.potY = y & 255;
  }

  writeRegister(address, value) {
    const reg = address & 31;
    const data = value & 255;
    this.busLatch = data;
    this.latchCycle = this.cycles;
    this.registers[reg] = data;
    if (reg < 21) {
      const index = Math.floor(reg / 7);
      const base = index * 7;
      const r = this.registers;
      this.voices[index].setRegisters({
        frequencyLow: r[base], frequencyHigh: r[base + 1],
        pulseLow: r[base + 2], pulseHigh: r[base + 3],
        control: r[base + 4], attackDecay: r[base + 5], sustainRelease: r[base + 6]
      });
    } else if (reg >= 21 && reg <= 24) {
      const r = this.registers;
      this.filter.configure(((r[0x16] << 3) | (r[0x15] & 7)), r[0x17], r[0x18], r[0x18]);
    }
  }

  getReadableRegister(reg) {
    if (reg === 25) return this.potX;
    if (reg === 26) return this.potY;
    if (reg === 27) return this.voices[2].getWaveform() >>> 4;
    if (reg === 28) return this.voices[2].envelope.getLevel();
    return this.cycles - this.latchCycle < 8192 ? this.busLatch : 0;
  }

  readRegister(address) {
    const value = this.getReadableRegister(address & 31);
    this.busLatch = value;
    this.latchCycle = this.cycles;
    return value;
  }

  peekRegister(address) {
    return this.getReadableRegister(address & 31);
  }

  tick() {
    const v = this.voices;
    const sourceRising0 = v[2].willRiseMSB();
    const sourceRising1 = v[0].willRiseMSB();
    const sourceRising2 = v[1].willRiseMSB();
    const sourceHigh0 = Boolean(v[2].accumulator & 0x800000);
    const sourceHigh1 = Boolean(v[0].accumulator & 0x800000);
    const sourceHigh2 = Boolean(v[1].accumulator & 0x800000);
    const s1 = v[0].tick(sourceHigh0, sourceRising0);
    const s2 = v[1].tick(sourceHigh1, sourceRising1);
    const s3 = v[2].tick(sourceHigh2, sourceRising2);
    this.output = this.filter.process(s1, s2, s3);
    this.cycles += 1;
    return this.output;
  }

  getOutput() {
    return this.output;
  }

  getState() {
    return {
      cycles: this.cycles, output: this.output,
      registers: Array.from(this.registers),
      voices: this.voices.map(voice => voice.snapshot()),
      filter: this.filter.snapshot()
    };
  }
}
