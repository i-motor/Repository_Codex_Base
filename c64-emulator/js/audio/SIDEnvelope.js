export const SID_RATES = Object.freeze([
  9, 32, 63, 95, 149, 220, 267, 313,
  392, 977, 1954, 3126, 3907, 11720, 19532, 31251
]);

export class SIDEnvelope {
  constructor() {
    this.reset();
  }

  reset() {
    this.attackDecay = 0;
    this.sustainRelease = 0;
    this.gate = false;
    this.state = 'release';
    this.level = 0;
    this.rateCounter = 0;
    this.exponentialCounter = 0;
    this.holdZero = true;
  }

  setAD(value) {
    this.attackDecay = value & 255;
  }

  setSR(value) {
    this.sustainRelease = value & 255;
  }

  setGate(active) {
    const next = Boolean(active);
    if (next === this.gate) return;
    this.gate = next;
    this.state = next ? 'attack' : 'release';
    this.holdZero = next ? false : this.level === 0;
    this.exponentialCounter = 0;
  }

  getRateIndex() {
    if (this.state === 'attack') return this.attackDecay >>> 4;
    if (this.state === 'decay') return this.attackDecay & 15;
    return this.sustainRelease & 15;
  }

  getExponentialPeriod() {
    if (this.level >= 0x5d) return 1;
    if (this.level >= 0x36) return 2;
    if (this.level >= 0x1a) return 4;
    if (this.level >= 0x0e) return 8;
    if (this.level >= 0x06) return 16;
    return 30;
  }

  tick() {
    this.rateCounter = (this.rateCounter + 1) & 0x7fff;
    if (this.rateCounter !== SID_RATES[this.getRateIndex()]) return this.level;
    this.rateCounter = 0;
    if (this.state === 'attack') {
      this.level = (this.level + 1) & 255;
      if (this.level === 255) {
        this.state = 'decay';
        this.exponentialCounter = 0;
      }
      return this.level;
    }
    this.exponentialCounter += 1;
    if (this.exponentialCounter < this.getExponentialPeriod()) return this.level;
    this.exponentialCounter = 0;
    if (this.state === 'decay') {
      const sustain = (this.sustainRelease >>> 4) * 17;
      if (this.level > sustain) this.level -= 1;
    } else if (!this.holdZero) {
      this.level = (this.level - 1) & 255;
      if (this.level === 0) this.holdZero = true;
    }
    return this.level;
  }

  getLevel() {
    return this.level;
  }

  snapshot() {
    return {
      level: this.level, state: this.state, gate: this.gate,
      rateCounter: this.rateCounter, exponentialCounter: this.exponentialCounter,
      holdZero: this.holdZero
    };
  }
}
