import { PAL_PROFILE } from '../utils/Constants.js';

export class Clock {
  constructor(profile = PAL_PROFILE) {
    if (!Number.isFinite(profile.cpuHz) || profile.cpuHz <= 0 ||
        !Number.isInteger(profile.linesPerFrame) || profile.linesPerFrame <= 0 ||
        !Number.isInteger(profile.cyclesPerLine) || profile.cyclesPerLine <= 0) {
      throw new RangeError('Ungültiges Zeitprofil');
    }
    this.profile = Object.freeze({ ...profile });
    this.cyclesPerFrame = profile.linesPerFrame * profile.cyclesPerLine;
    this.reset();
  }

  reset() {
    this.cycle = 0;
  }

  tick() {
    this.cycle += 1;
    return this.cycle;
  }

  runCycles(count) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError('Taktanzahl muss eine nichtnegative sichere Ganzzahl sein');
    }
    if (!Number.isSafeInteger(this.cycle + count)) {
      throw new RangeError('Master-Zykluszähler würde überlaufen');
    }
    this.cycle += count;
    return this.getPosition();
  }

  getPosition() {
    const cycleInFrame = this.cycle % this.cyclesPerFrame;
    return {
      cycle: this.cycle,
      frame: Math.floor(this.cycle / this.cyclesPerFrame),
      raster: Math.floor(cycleInFrame / this.profile.cyclesPerLine),
      cycleInLine: cycleInFrame % this.profile.cyclesPerLine,
      cycleInFrame
    };
  }

  getSeconds() {
    return this.cycle / this.profile.cpuHz;
  }
}
