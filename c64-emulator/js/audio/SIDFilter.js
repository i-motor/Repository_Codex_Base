export function cutoffHz(model, fc) {
  const x = fc & 0x7ff;
  if (model === '8580') {
    return 30 + x * 5.86;
  }
  return 220 + 12000 / (1 + Math.exp(-(x - 1200) / 180));
}

export function resonanceQ(model, res) {
  const r = res & 0x0f;
  return model === '8580' ? 0.707 + r / 15 : 0.707 + (r / 15) * 1.6;
}

export class SIDFilter {
  constructor(model = '6581', sampleRate = 48000) {
    this.model = model;
    this.sampleRate = sampleRate;
    this.fc = 0;
    this.res = 0;
    this.mode = 0;
    this.reset();
    this.updateCoefficients();
  }

  reset() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.low = 0;
    this.band = 0;
    this.high = 0;
  }

  setModel(model) {
    this.model = model;
    this.updateCoefficients();
  }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.updateCoefficients();
  }

  setCutoff(fc) {
    this.fc = fc & 0x7ff;
    this.updateCoefficients();
  }

  setResonance(res) {
    this.res = res & 0x0f;
    this.updateCoefficients();
  }

  setMode(mode) {
    this.mode = mode & 0x70;
  }

  updateCoefficients() {
    const nyquist = this.sampleRate * 0.49;
    const f = Math.min(cutoffHz(this.model, this.fc), nyquist);
    const g = Math.tan((Math.PI * f) / this.sampleRate);
    const k = 1 / resonanceQ(this.model, this.res);
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(input) {
    const v3 = input - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = input - this.k * v1 - v2;
    let out = 0;
    if (this.mode & 0x10) out += this.low;
    if (this.mode & 0x20) out += this.band;
    if (this.mode & 0x40) out += this.high;
    return out;
  }
}
