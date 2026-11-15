import { SIDEnvelope } from './SIDEnvelope.js';

const NOISE_TAPS = [22, 20, 16, 13, 11, 7, 4, 2];

export class SIDVoice {
  constructor() {
    this.envelope = new SIDEnvelope();
    this.reset();
  }

  reset() {
    this.frequency = 0;
    this.pulseWidth = 0x800;
    this.control = 0;
    this.accumulator = 0;
    this.noiseRegister = 0x7ffff8;
    this.waveform = 0;
    this.envelope.reset();
  }

  setRegisters({ frequencyLow, frequencyHigh, pulseLow, pulseHigh, control, attackDecay, sustainRelease }) {
    this.frequency = (frequencyLow & 255) | ((frequencyHigh & 255) << 8);
    this.pulseWidth = (pulseLow & 255) | ((pulseHigh & 15) << 8);
    this.setControl(control);
    this.envelope.setAD(attackDecay);
    this.envelope.setSR(sustainRelease);
  }

  setControl(value) {
    const control = value & 255;
    if ((control & 8) && !(this.control & 8)) {
      this.accumulator = 0;
      this.noiseRegister = 0x7ffff8;
    }
    this.control = control;
    this.envelope.setGate((control & 1) !== 0);
  }

  willRiseMSB() {
    if (this.control & 8) return false;
    return !(this.accumulator & 0x800000) && ((this.accumulator + this.frequency) & 0x800000) !== 0;
  }

  clockOscillator(modulatorHigh, sourceRising) {
    const previous = this.accumulator;
    if (this.control & 8) {
      this.accumulator = 0;
    } else {
      this.accumulator = (this.accumulator + this.frequency) & 0xffffff;
      if (!(previous & 0x080000) && (this.accumulator & 0x080000)) {
        const feedback = ((this.noiseRegister >>> 22) ^ (this.noiseRegister >>> 17)) & 1;
        this.noiseRegister = ((this.noiseRegister << 1) | feedback) & 0x7fffff;
      }
      if ((this.control & 2) && sourceRising) this.accumulator = 0;
    }
    this.waveform = this.generateWaveform(modulatorHigh);
    return this.waveform;
  }

  generateWaveform(modulatorHigh = false) {
    const active = this.control & 0xf0;
    if (!active || (this.control & 8)) return 0;
    const phase = (this.accumulator >>> 12) & 0xfff;
    let output = 0xfff;
    if (active & 0x10) {
      const falling = Boolean(this.accumulator & 0x800000) !== Boolean((this.control & 4) && modulatorHigh);
      const triangle = (this.accumulator >>> 11) & 0xfff;
      output &= falling ? 0xfff ^ triangle : triangle;
    }
    if (active & 0x20) output &= phase;
    if (active & 0x40) output &= phase < this.pulseWidth ? 0xfff : 0;
    if (active & 0x80) {
      let noise = 0;
      for (const tap of NOISE_TAPS) noise = (noise << 1) | ((this.noiseRegister >>> tap) & 1);
      output &= noise << 4;
    }
    return output;
  }

  tick(modulatorHigh = false, sourceRising = false) {
    this.clockOscillator(modulatorHigh, sourceRising);
    this.envelope.tick();
    return this.getOutput();
  }

  getOutput() {
    if (!(this.control & 0xf0)) return 0;
    return (this.waveform / 2047.5 - 1) * (this.envelope.level / 255);
  }

  getWaveform() {
    return this.waveform;
  }

  snapshot() {
    return {
      frequency: this.frequency, pulseWidth: this.pulseWidth,
      control: this.control, accumulator: this.accumulator,
      noiseRegister: this.noiseRegister, waveform: this.waveform,
      envelope: this.envelope.snapshot()
    };
  }
}
