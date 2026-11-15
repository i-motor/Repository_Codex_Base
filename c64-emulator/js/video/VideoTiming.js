export const PHI1 = Object.freeze({
  IDLE: 0,
  SPRITE_POINTER: 1,
  SPRITE_DATA: 2,
  REFRESH: 3,
  GRAPHICS: 4
});

export const PAL = Object.freeze({
  name: 'PAL',
  chip: '6569',
  verified: true,
  crystalHz: 17734475,
  clockHz: 985248,
  cyclesPerLine: 63,
  linesPerFrame: 312,
  firstXCoord: 0x194,
  xCoordCount: 504,
  firstVisibleLine: 16,
  lastVisibleLine: 299,
  firstVisibleX: 0x1e0,
  lastVisibleX: 0x17c,
  spriteFetchCycles: Object.freeze([58, 60, 62, 1, 3, 5, 7, 9]),
  refreshCycles: Object.freeze([11, 12, 13, 14, 15]),
  graphicsFirstCycle: 16,
  graphicsLastCycle: 55,
  cAccessFirstCycle: 15,
  cAccessLastCycle: 54,
  badlineBaFirstCycle: 12,
  badlineBaLastCycle: 54,
  vcLoadCycle: 14,
  spriteCrunchCycle: 15,
  spriteMcBaseCycle: 16,
  spriteExpandToggleCycle: 55,
  spriteDmaCycles: Object.freeze([55, 56]),
  spriteDisplayCycle: 58,
  rcCheckCycle: 58,
  verticalBorderCycle: 63,
  rasterIrqLine0Cycle: 2,
  todHz: 50
});

export const NTSC = Object.freeze({
  name: 'NTSC',
  chip: '6567R8',
  verified: false,
  crystalHz: 14318180,
  clockHz: 1022727,
  cyclesPerLine: 65,
  linesPerFrame: 263,
  firstXCoord: 0x19c,
  xCoordCount: 512,
  firstVisibleLine: 41,
  lastVisibleLine: 12,
  firstVisibleX: 0x1e9,
  lastVisibleX: 0x18c,
  spriteFetchCycles: Object.freeze([58, 60, 62, 64, 1, 3, 5, 7]),
  refreshCycles: Object.freeze([11, 12, 13, 14, 15]),
  graphicsFirstCycle: 16,
  graphicsLastCycle: 55,
  cAccessFirstCycle: 15,
  cAccessLastCycle: 54,
  badlineBaFirstCycle: 12,
  badlineBaLastCycle: 54,
  vcLoadCycle: 14,
  spriteCrunchCycle: 15,
  spriteMcBaseCycle: 16,
  spriteExpandToggleCycle: 55,
  spriteDmaCycles: Object.freeze([55, 56]),
  spriteDisplayCycle: 58,
  rcCheckCycle: 58,
  verticalBorderCycle: 65,
  rasterIrqLine0Cycle: 2,
  todHz: 60
});

function wrapCycle(cycle, count) {
  return ((cycle - 1 + count * 4) % count) + 1;
}

export function buildCycleTable(timing) {
  const n = timing.cyclesPerLine;
  const phi1Type = new Uint8Array(n + 2);
  const phi1Sprite = new Int8Array(n + 2).fill(-1);
  const phi2Sprite = new Int8Array(n + 2).fill(-1);
  const phi2Byte = new Uint8Array(n + 2);
  const spriteBaMask = new Uint8Array(n + 2);
  const borderCheck = new Uint8Array(n + 2);
  const width = n * 8;
  const xcoord = new Int16Array(width);
  for (let col = 0; col < width; col++) {
    xcoord[col] = (timing.firstXCoord + col) % timing.xCoordCount;
  }
  for (const c of timing.refreshCycles) {
    phi1Type[c] = PHI1.REFRESH;
  }
  for (let c = timing.graphicsFirstCycle; c <= timing.graphicsLastCycle; c++) {
    phi1Type[c] = PHI1.GRAPHICS;
  }
  timing.spriteFetchCycles.forEach((first, sprite) => {
    const second = wrapCycle(first + 1, n);
    phi1Type[first] = PHI1.SPRITE_POINTER;
    phi1Sprite[first] = sprite;
    phi1Type[second] = PHI1.SPRITE_DATA;
    phi1Sprite[second] = sprite;
    phi2Sprite[first] = sprite;
    phi2Byte[first] = 0;
    phi2Sprite[second] = sprite;
    phi2Byte[second] = 2;
    for (let k = -3; k <= 1; k++) {
      spriteBaMask[wrapCycle(first + k, n)] |= 1 << sprite;
    }
  });
  for (let c = 1; c <= n; c++) {
    const start = (c - 1) * 8;
    for (let p = 0; p < 8; p++) {
      const x = xcoord[start + p];
      if (x === 24 || x === 31 || x === 335 || x === 344) {
        borderCheck[c] = 1;
      }
    }
  }
  return { phi1Type, phi1Sprite, phi2Sprite, phi2Byte, spriteBaMask, borderCheck, xcoord, width };
}

export function columnForX(timing, x) {
  return (x - timing.firstXCoord + timing.xCoordCount * 2) % timing.xCoordCount;
}

export function cropRect(timing, mode = 'normal') {
  if (mode === 'full') {
    const left = columnForX(timing, timing.firstVisibleX);
    const right = columnForX(timing, timing.lastVisibleX);
    const top = timing.firstVisibleLine;
    const bottom = timing.lastVisibleLine >= top ? timing.lastVisibleLine : timing.linesPerFrame - 1;
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }
  if (mode === 'raw') {
    return { x: 0, y: 0, width: timing.cyclesPerLine * 8, height: timing.linesPerFrame };
  }
  const left = columnForX(timing, 24 - 32);
  const top = timing.name === 'PAL' ? 16 : 28;
  return { x: left, y: top, width: 384, height: timing.name === 'PAL' ? 272 : 235 };
}
