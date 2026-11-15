export const RATE_PERIODS = Object.freeze([
  9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251
]);

export const ENVELOPE_STATE = Object.freeze({ ATTACK: 0, DECAY_SUSTAIN: 1, RELEASE: 2 });

const ATTACK = 0;
const DECAY_SUSTAIN = 1;
const RELEASE = 2;

export class SIDEnvelope {
  constructor() {
    this.reset();
  }

  reset() {
    this.level = 0;
    this.state = RELEASE;
    this.attack = 0;
    this.decay = 0;
    this.sustain = 0;
    this.release = 0;
    this.gate = false;
    this.rateCounter = 0;
    this.ratePeriod = RATE_PERIODS[0];
    this.expCounter = 0;
    this.expPeriod = 1;
    this.holdZero = true;
  }

  writeControl(control) {
    const gate = (control & 1) !== 0;
    if (!this.gate && gate) {
      this.state = ATTACK;
      this.ratePeriod = RATE_PERIODS[this.attack];
      this.holdZero = false;
    } else if (this.gate && !gate) {
      this.state = RELEASE;
      this.ratePeriod = RATE_PERIODS[this.release];
    }
    this.gate = gate;
  }

  writeAttackDecay(value) {
    this.attack = (value >> 4) & 0x0f;
    this.decay = value & 0x0f;
    if (this.state === ATTACK) {
      this.ratePeriod = RATE_PERIODS[this.attack];
    } else if (this.state === DECAY_SUSTAIN) {
      this.ratePeriod = RATE_PERIODS[this.decay];
    }
  }

  writeSustainRelease(value) {
    this.sustain = (value >> 4) & 0x0f;
    this.release = value & 0x0f;
    if (this.state === RELEASE) {
      this.ratePeriod = RATE_PERIODS[this.release];
    }
  }

  clock() {
    this.rateCounter++;
    if (this.rateCounter & 0x8000) {
      this.rateCounter = (this.rateCounter + 1) & 0x7fff;
    }
    if (this.rateCounter !== this.ratePeriod) {
      return;
    }
    this.rateCounter = 0;
    if (this.state !== ATTACK) {
      this.expCounter++;
      if (this.expCounter !== this.expPeriod) {
        return;
      }
    }
    this.expCounter = 0;
    if (this.holdZero) {
      return;
    }
    switch (this.state) {
      case ATTACK:
        this.level = (this.level + 1) & 0xff;
        if (this.level === 0xff) {
          this.state = DECAY_SUSTAIN;
          this.ratePeriod = RATE_PERIODS[this.decay];
        }
        break;
      case DECAY_SUSTAIN:
        if (this.level !== this.sustain * 0x11) {
          this.level = (this.level - 1) & 0xff;
        }
        break;
      default:
        this.level = (this.level - 1) & 0xff;
        break;
    }
    switch (this.level) {
      case 0xff: this.expPeriod = 1; break;
      case 0x5d: this.expPeriod = 2; break;
      case 0x36: this.expPeriod = 4; break;
      case 0x1a: this.expPeriod = 8; break;
      case 0x0e: this.expPeriod = 16; break;
      case 0x06: this.expPeriod = 30; break;
      case 0x00:
        this.expPeriod = 1;
        this.holdZero = true;
        break;
      default:
        break;
    }
  }
}
