import { SIDVoice } from './SIDVoice.js';
import { SIDFilter } from './SIDFilter.js';

const MODEL = {
  '6581': { waveZero: 0x380, voiceDc: 0x800 * 0xff, busTtl: 0x1d00, mixerDc: -0x2000 * 0xff },
  '8580': { waveZero: 0x800, voiceDc: 0, busTtl: 0xa2000, mixerDc: 0 }
};

const OUTPUT_SCALE = 1 / (4 * 0x800 * 0xff * 1.6);

export class SID {
  constructor({ clock = { cycles: 0 }, clockHz = 985248, model = '6581', sampleRate = 48000, chunkSize = 512 } = {}) {
    this.clock = clock;
    this.clockHz = clockHz;
    this.voices = [new SIDVoice(0), new SIDVoice(1), new SIDVoice(2)];
    for (let i = 0; i < 3; i++) {
      this.voices[i].syncSource = this.voices[(i + 2) % 3];
      this.voices[i].syncDest = this.voices[(i + 1) % 3];
    }
    this.filter = new SIDFilter(model, sampleRate);
    this.chunkSize = chunkSize;
    this.sink = null;
    this.rateAdjust = 1;
    this.potX = 0xff;
    this.potY = 0xff;
    this.setModel(model);
    this.setSampleRate(sampleRate);
    this.reset();
  }

  setModel(model) {
    this.model = model === '8580' ? '8580' : '6581';
    this.params = MODEL[this.model];
    for (const voice of this.voices) {
      voice.setModel(this.model);
    }
    this.filter.setModel(this.model);
  }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.filter.setSampleRate(rate);
    this.updateRatio();
    const rc = 1 / (2 * Math.PI * 16);
    this.dcAlpha = rc / (rc + 1 / rate);
  }

  setRateAdjust(factor) {
    this.rateAdjust = factor;
    this.updateRatio();
  }

  updateRatio() {
    this.cyclesPerSample = (this.clockHz / this.sampleRate) * this.rateAdjust;
  }

  setSink(sink) {
    this.sink = sink;
    this.buffer = new Float32Array(this.chunkSize);
    this.bufferIndex = 0;
  }

  reset() {
    for (const voice of this.voices) {
      voice.reset();
    }
    this.filter.reset();
    this.registers = new Uint8Array(32);
    this.fc = 0;
    this.resFilt = 0;
    this.modeVol = 0;
    this.filter.setCutoff(0);
    this.filter.setResonance(0);
    this.filter.setMode(0);
    this.busValue = 0;
    this.busValueCycle = 0;
    this.lastCycle = this.clock.cycles;
    this.sampleCounter = 0;
    this.accFiltered = 0;
    this.accDirect = 0;
    this.accCount = 0;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
    this.buffer = new Float32Array(this.chunkSize);
    this.bufferIndex = 0;
  }

  catchUp(target) {
    let cycles = target - this.lastCycle;
    if (cycles <= 0) {
      return;
    }
    this.lastCycle = target;
    const v0 = this.voices[0];
    const v1 = this.voices[1];
    const v2 = this.voices[2];
    const e0 = v0.envelope;
    const e1 = v1.envelope;
    const e2 = v2.envelope;
    const output = this.sink !== null;
    const waveZero = this.params.waveZero;
    const voiceDc = this.params.voiceDc;
    const route = this.resFilt & 0x07;
    const voice3Off = (this.modeVol & 0x80) !== 0 && (route & 4) === 0;
    while (cycles-- > 0) {
      v0.clockOscillator();
      v1.clockOscillator();
      v2.clockOscillator();
      v0.synchronize();
      v1.synchronize();
      v2.synchronize();
      e0.clock();
      e1.clock();
      e2.clock();
      if (!output) {
        continue;
      }
      const o0 = e0.level ? (v0.output() - waveZero) * e0.level + voiceDc : voiceDc;
      const o1 = e1.level ? (v1.output() - waveZero) * e1.level + voiceDc : voiceDc;
      const o2 = e2.level ? (v2.output() - waveZero) * e2.level + voiceDc : voiceDc;
      let filtered = 0;
      let direct = 0;
      if (route & 1) filtered += o0; else direct += o0;
      if (route & 2) filtered += o1; else direct += o1;
      if (route & 4) filtered += o2; else if (!voice3Off) direct += o2;
      this.accFiltered += filtered;
      this.accDirect += direct;
      this.accCount++;
      this.sampleCounter += 1;
      if (this.sampleCounter >= this.cyclesPerSample) {
        this.sampleCounter -= this.cyclesPerSample;
        this.emitSample();
      }
    }
  }

  emitSample() {
    const n = this.accCount || 1;
    const filteredIn = this.accFiltered / n;
    const direct = this.accDirect / n;
    this.accFiltered = 0;
    this.accDirect = 0;
    this.accCount = 0;
    const filtered = this.filter.process(filteredIn);
    const volume = this.modeVol & 0x0f;
    const mixed = ((direct + filtered + this.params.mixerDc) * volume) / 15;
    const input = mixed * OUTPUT_SCALE;
    const out = this.dcAlpha * (this.dcPrevOut + input - this.dcPrevIn);
    this.dcPrevIn = input;
    this.dcPrevOut = out;
    this.buffer[this.bufferIndex++] = out > 1 ? 1 : out < -1 ? -1 : out;
    if (this.bufferIndex >= this.buffer.length) {
      const chunk = this.buffer;
      this.buffer = new Float32Array(this.chunkSize);
      this.bufferIndex = 0;
      this.sink(chunk);
    }
  }

  flush() {
    this.catchUp(this.clock.cycles);
  }

  read(register) {
    this.catchUp(this.clock.cycles);
    switch (register & 0x1f) {
      case 0x19: return this.potX;
      case 0x1a: return this.potY;
      case 0x1b: return this.voices[2].output() >> 4;
      case 0x1c: return this.voices[2].envelope.level;
      default:
        if (this.clock.cycles - this.busValueCycle > this.params.busTtl) {
          this.busValue = 0;
        }
        return this.busValue;
    }
  }

  peek(register) {
    switch (register & 0x1f) {
      case 0x19: return this.potX;
      case 0x1a: return this.potY;
      case 0x1b: return this.voices[2].output() >> 4;
      case 0x1c: return this.voices[2].envelope.level;
      default: return this.registers[register & 0x1f];
    }
  }

  write(register, value) {
    this.catchUp(this.clock.cycles);
    const reg = register & 0x1f;
    const v = value & 0xff;
    this.registers[reg] = v;
    this.busValue = v;
    this.busValueCycle = this.clock.cycles;
    if (reg < 21) {
      const voice = this.voices[(reg / 7) | 0];
      switch (reg % 7) {
        case 0: voice.writeFrequencyLo(v); break;
        case 1: voice.writeFrequencyHi(v); break;
        case 2: voice.writePulseLo(v); break;
        case 3: voice.writePulseHi(v); break;
        case 4: voice.writeControl(v); break;
        case 5: voice.envelope.writeAttackDecay(v); break;
        default: voice.envelope.writeSustainRelease(v); break;
      }
      return;
    }
    switch (reg) {
      case 0x15:
        this.fc = (this.fc & 0x7f8) | (v & 7);
        this.filter.setCutoff(this.fc);
        break;
      case 0x16:
        this.fc = (this.fc & 7) | (v << 3);
        this.filter.setCutoff(this.fc);
        break;
      case 0x17:
        this.resFilt = v;
        this.filter.setResonance(v >> 4);
        break;
      case 0x18:
        this.modeVol = v;
        this.filter.setMode(v);
        break;
      default:
        break;
    }
  }

  frequencyHz(voiceIndex) {
    return (this.voices[voiceIndex].frequency * this.clockHz) / 16777216;
  }
}
