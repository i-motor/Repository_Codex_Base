export class SIDFilter {
  constructor(cpuRate = 985248.44, model = '6581') {
    this.cpuRate = cpuRate;
    this.model = model;
    this.reset();
  }

  reset() {
    this.cutoff = 0;
    this.resonance = 0;
    this.routing = 0;
    this.mode = 0;
    this.volume = 0;
    this.low = 0;
    this.band = 0;
    this.alpha = 0;
    this.damping = 1.7;
    this.configure(0, 0, 0, 0);
  }

  setModel(model) {
    if (model !== '6581' && model !== '8580') throw new RangeError('Unbekanntes SID-Modell');
    this.model = model;
    this.configure(this.cutoff, (this.resonance << 4) | this.routing, this.mode, this.volume);
  }

  configure(cutoff, resonanceAndRouting, mode, volume) {
    this.cutoff = cutoff & 0x7ff;
    this.resonance = (resonanceAndRouting >>> 4) & 15;
    this.routing = resonanceAndRouting & 15;
    this.mode = mode & 0xf0;
    this.volume = volume & 15;
    const normal = this.cutoff / 2047;
    const cutoffHz = this.model === '6581'
      ? 30 + 12500 * Math.pow(normal, 1.55)
      : 30 + 18000 * normal;
    this.alpha = 2 * Math.sin(Math.PI * Math.min(cutoffHz, this.cpuRate * 0.4) / this.cpuRate);
    this.damping = 1.72 - this.resonance * 0.095;
  }

  process(voice1, voice2, voice3) {
    const v1 = voice1 * 0.34;
    const v2 = voice2 * 0.34;
    const v3 = voice3 * 0.34;
    const filtered = ((this.routing & 1) ? v1 : 0)
      + ((this.routing & 2) ? v2 : 0)
      + ((this.routing & 4) ? v3 : 0);
    const direct = ((this.routing & 1) ? 0 : v1)
      + ((this.routing & 2) ? 0 : v2)
      + ((this.routing & 4) || (this.mode & 0x80) ? 0 : v3);
    const high = filtered - this.low - this.damping * this.band;
    this.band += this.alpha * high;
    this.low += this.alpha * this.band;
    let filterOut = 0;
    if (this.mode & 0x10) filterOut += this.low;
    if (this.mode & 0x20) filterOut += this.band;
    if (this.mode & 0x40) filterOut += high;
    const result = (direct + filterOut) * (this.volume / 15);
    return this.volume === 0 ? 0 : Math.max(-1, Math.min(1, result));
  }

  snapshot() {
    return {
      model: this.model, cutoff: this.cutoff, resonance: this.resonance,
      routing: this.routing, mode: this.mode, volume: this.volume,
      low: this.low, band: this.band
    };
  }
}
