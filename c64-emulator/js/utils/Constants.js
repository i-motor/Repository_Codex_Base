export const PAL_PROFILE = Object.freeze({
  name: 'PAL MOS 6569',
  cpuHz: 985248.44,
  linesPerFrame: 312,
  cyclesPerLine: 63,
  dotsPerCycle: 8
});

export const NTSC_PROFILE = Object.freeze({
  name: 'NTSC MOS 6567R8',
  cpuHz: 1022727.14,
  linesPerFrame: 263,
  cyclesPerLine: 65,
  dotsPerCycle: 8,
  visibleX: 76,
  visibleY: 20,
  visibleWidth: 404,
  visibleHeight: 240,
  displayX: 120,
  displayY: 51
});

export const VIDEO_PROFILES = Object.freeze({ PAL: PAL_PROFILE, NTSC: NTSC_PROFILE });

export const ROM_SIZES = Object.freeze({
  basic: 8192,
  kernal: 8192,
  chargen: 4096
});

export const ROM_FILENAMES = Object.freeze({
  basic: 'basic.rom',
  kernal: 'kernal.rom',
  chargen: 'chargen.rom'
});

export const IO_RANGES = Object.freeze({
  vic: Object.freeze({ start: 0xd000, end: 0xd3ff, mirrorMask: 0x3f }),
  sid: Object.freeze({ start: 0xd400, end: 0xd7ff, mirrorMask: 0x1f }),
  cia1: Object.freeze({ start: 0xdc00, end: 0xdcff, mirrorMask: 0x0f }),
  cia2: Object.freeze({ start: 0xdd00, end: 0xddff, mirrorMask: 0x0f }),
  expansion: Object.freeze({ start: 0xde00, end: 0xdfff, mirrorMask: 0x1ff })
});
