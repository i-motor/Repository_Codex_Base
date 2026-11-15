import { PAL_PROFILE } from '../utils/Constants.js';

export class VideoTiming {
  constructor(profile = PAL_PROFILE) {
    this.profile = profile;
    this.cyclesPerFrame = profile.linesPerFrame * profile.cyclesPerLine;
    this.visibleX = profile.visibleX ?? 76;
    this.visibleY = profile.visibleY ?? 16;
    this.visibleWidth = profile.visibleWidth ?? 404;
    this.visibleHeight = profile.visibleHeight ?? 284;
    this.displayX = profile.displayX ?? 120;
    this.displayY = profile.displayY ?? 51;
  }

  position(cycle) {
    const inFrame = cycle % this.cyclesPerFrame;
    return {
      frame: Math.floor(cycle / this.cyclesPerFrame),
      raster: Math.floor(inFrame / this.profile.cyclesPerLine),
      cycleInLine: inFrame % this.profile.cyclesPerLine,
      inFrame
    };
  }

  isBadline(raster, scrollY, denLatched) {
    return denLatched && raster >= 0x30 && raster <= 0xf7 && (raster & 7) === (scrollY & 7);
  }

  busRequest(raster, cycleInLine, scrollY, denLatched, spriteRequest = null) {
    const badline = this.isBadline(raster, scrollY, denLatched);
    const badlineBA = badline && cycleInLine >= 11 && cycleInLine <= 53;
    const badlineSteal = badline && cycleInLine >= 14 && cycleInLine <= 53;
    return {
      baLow: badlineBA || Boolean(spriteRequest?.baLow),
      stealsPhi2: badlineSteal || Boolean(spriteRequest?.stealsPhi2),
      badlineSteal,
      spriteSteal: Boolean(spriteRequest?.stealsPhi2)
    };
  }
}
