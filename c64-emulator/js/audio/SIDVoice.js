import { SIDEnvelope } from './SIDEnvelope.js';

function triangle12(x) {
  return x & 0x800 ? (~x << 1) & 0xfff : (x << 1) & 0xfff;
}

function buildCombinedTable(selector, { threshold, distance, pulseWeight }) {
  const table = new Uint16Array(4096);
  const weights = new Float64Array(24);
  for (let d = 0; d < 24; d++) {
    weights[d] = 1 / (1 + d * d * distance);
  }
  const bits = new Float64Array(12);
  for (let x = 0; x < 4096; x++) {
    const saw = x;
    const tri = triangle12(x);
    for (let i = 0; i < 12; i++) {
      let sum = 0;
      let count = 0;
      if (selector & 1) {
        sum += (tri >> i) & 1;
        count++;
      }
      if (selector & 2) {
        sum += (saw >> i) & 1;
        count++;
      }
      if (selector & 4) {
        sum += pulseWeight;
        count += pulseWeight;
      }
      bits[i] = sum / count;
    }
    let out = 0;
    for (let i = 0; i < 12; i++) {
      let avg = 0;
      let norm = 0;
      for (let j = 0; j < 12; j++) {
        const w = weights[Math.abs(i - j)];
        avg += bits[j] * w;
        norm += w;
      }
      const value = (bits[i] + avg / norm) / 2;
      if (value > threshold) {
        out |= 1 << i;
      }
    }
    table[x] = out;
  }
  return table;
}

const MODEL_PARAMS = {
  '6581': {
    tri_saw: { threshold: 0.86, distance: 0.6, pulseWeight: 1 },
    pulse_tri: { threshold: 0.8, distance: 0.4, pulseWeight: 0.7 },
    pulse_saw: { threshold: 0.84, distance: 0.4, pulseWeight: 0.7 },
    pulse_tri_saw: { threshold: 0.86, distance: 0.6, pulseWeight: 0.7 }
  },
  '8580': {
    tri_saw: { threshold: 0.72, distance: 1.5, pulseWeight: 1 },
    pulse_tri: { threshold: 0.7, distance: 1.2, pulseWeight: 0.9 },
    pulse_saw: { threshold: 0.72, distance: 1.2, pulseWeight: 0.9 },
    pulse_tri_saw: { threshold: 0.74, distance: 1.5, pulseWeight: 0.9 }
  }
};

const TABLE_CACHE = new Map();

export function combinedTables(model) {
  const key = model === '8580' ? '8580' : '6581';
  if (!TABLE_CACHE.has(key)) {
    const p = MODEL_PARAMS[key];
    TABLE_CACHE.set(key, {
      triSaw: buildCombinedTable(3, p.tri_saw),
      pulseTri: buildCombinedTable(5, p.pulse_tri),
      pulseSaw: buildCombinedTable(6, p.pulse_saw),
      pulseTriSaw: buildCombinedTable(7, p.pulse_tri_saw)
    });
  }
  return TABLE_CACHE.get(key);
}

export class SIDVoice {
  constructor(index) {
    this.index = index;
    this.envelope = new SIDEnvelope();
    this.syncSource = null;
    this.syncDest = null;
    this.tables = combinedTables('6581');
    this.reset();
  }

  setModel(model) {
    this.tables = combinedTables(model);
  }

  reset() {
    this.frequency = 0;
    this.pulseWidth = 0;
    this.control = 0;
    this.waveform = 0;
    this.test = false;
    this.ring = false;
    this.sync = false;
    this.accumulator = 0;
    this.noise = 0x7ffff8;
    this.msbRising = false;
    this.envelope.reset();
  }

  writeFrequencyLo(value) {
    this.frequency = (this.frequency & 0xff00) | value;
  }

  writeFrequencyHi(value) {
    this.frequency = (this.frequency & 0x00ff) | (value << 8);
  }

  writePulseLo(value) {
    this.pulseWidth = (this.pulseWidth & 0xf00) | value;
  }

  writePulseHi(value) {
    this.pulseWidth = (this.pulseWidth & 0x0ff) | ((value & 0x0f) << 8);
  }

  writeControl(value) {
    const testNext = (value & 0x08) !== 0;
    if (testNext) {
      this.accumulator = 0;
      this.noise = 0;
    } else if (this.test) {
      this.noise = 0x7ffff8;
    }
    this.test = testNext;
    this.control = value;
    this.waveform = (value >> 4) & 0x0f;
    this.ring = (value & 0x04) !== 0;
    this.sync = (value & 0x02) !== 0;
    this.envelope.writeControl(value);
  }

  clockOscillator() {
    if (this.test) {
      this.msbRising = false;
      return;
    }
    const previous = this.accumulator;
    const next = (previous + this.frequency) & 0xffffff;
    this.accumulator = next;
    this.msbRising = (previous & 0x800000) === 0 && (next & 0x800000) !== 0;
    if ((previous & 0x080000) === 0 && (next & 0x080000) !== 0) {
      const reg = this.noise;
      const bit = ((reg >> 22) ^ (reg >> 17)) & 1;
      this.noise = ((reg << 1) & 0x7fffff) | bit;
    }
  }

  synchronize() {
    if (this.msbRising && this.syncDest.sync && !(this.sync && this.syncSource.msbRising)) {
      this.syncDest.accumulator = 0;
    }
  }

  triangleOutput() {
    const msb = this.ring ? (this.accumulator ^ this.syncSource.accumulator) & 0x800000 : this.accumulator & 0x800000;
    return ((msb ? ~this.accumulator : this.accumulator) >> 11) & 0xfff;
  }

  noiseOutput() {
    const r = this.noise;
    return ((r & 0x400000) >> 11) | ((r & 0x100000) >> 10) | ((r & 0x010000) >> 7) | ((r & 0x002000) >> 5) |
      ((r & 0x000800) >> 4) | ((r & 0x000080) >> 1) | ((r & 0x000010) << 1) | ((r & 0x000004) << 2);
  }

  pulseOutput() {
    return this.test || (this.accumulator >> 12) >= this.pulseWidth ? 0xfff : 0x000;
  }

  output() {
    switch (this.waveform) {
      case 0x0: return 0;
      case 0x1: return this.triangleOutput();
      case 0x2: return this.accumulator >> 12;
      case 0x3: return this.tables.triSaw[this.accumulator >> 12] & this.triangleOutput();
      case 0x4: return this.pulseOutput();
      case 0x5: return this.tables.pulseTri[this.accumulator >> 12] & this.pulseOutput();
      case 0x6: return this.tables.pulseSaw[this.accumulator >> 12] & this.pulseOutput();
      case 0x7: return this.tables.pulseTriSaw[this.accumulator >> 12] & this.pulseOutput();
      case 0x8: return this.noiseOutput();
      default: {
        let value = 0xfff;
        if (this.waveform & 1) value &= this.triangleOutput();
        if (this.waveform & 2) value &= this.accumulator >> 12;
        if (this.waveform & 4) value &= this.pulseOutput();
        return value & this.noiseOutput();
      }
    }
  }
}
