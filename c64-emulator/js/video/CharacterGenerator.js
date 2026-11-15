export const BG0 = 16;
export const BG1 = 17;
export const BG2 = 18;
export const FOREGROUND = 0x80;

export const MODE = Object.freeze({
  STANDARD_TEXT: 0,
  MULTICOLOR_TEXT: 1,
  STANDARD_BITMAP: 2,
  MULTICOLOR_BITMAP: 3,
  EXTENDED_TEXT: 4,
  INVALID_TEXT: 5,
  INVALID_BITMAP_1: 6,
  INVALID_BITMAP_2: 7
});

function hires(out, offset, gdata, one, zero) {
  for (let i = 0; i < 8; i++) {
    out[offset + i] = gdata & (0x80 >> i) ? one : zero;
  }
}

function multi(out, offset, gdata, c0, c1, c2, c3) {
  for (let i = 0; i < 4; i++) {
    const pair = (gdata >> (6 - i * 2)) & 3;
    const code = pair === 0 ? c0 : pair === 1 ? c1 : pair === 2 ? c2 : c3;
    out[offset + i * 2] = code;
    out[offset + i * 2 + 1] = code;
  }
}

export function decodeCell(mode, gdata, vm, color, out, offset) {
  switch (mode) {
    case 0:
      hires(out, offset, gdata, color | FOREGROUND, BG0);
      return;
    case 1:
      if (color & 8) {
        multi(out, offset, gdata, BG0, BG1, BG2 | FOREGROUND, (color & 7) | FOREGROUND);
      } else {
        hires(out, offset, gdata, color | FOREGROUND, BG0);
      }
      return;
    case 2:
      hires(out, offset, gdata, (vm >> 4) | FOREGROUND, vm & 0x0f);
      return;
    case 3:
      multi(out, offset, gdata, BG0, vm >> 4, (vm & 0x0f) | FOREGROUND, color | FOREGROUND);
      return;
    case 4:
      hires(out, offset, gdata, color | FOREGROUND, BG0 + (vm >> 6));
      return;
    case 5:
      if (color & 8) {
        multi(out, offset, gdata, 0, 0, FOREGROUND, FOREGROUND);
      } else {
        hires(out, offset, gdata, FOREGROUND, 0);
      }
      return;
    case 6:
      hires(out, offset, gdata, FOREGROUND, 0);
      return;
    default:
      multi(out, offset, gdata, 0, 0, FOREGROUND, FOREGROUND);
  }
}

export function graphicsAddress(mode, displayState, memptr, vc, rc, charCode) {
  let address;
  if (!displayState) {
    address = 0x3fff;
  } else if (mode & 2) {
    address = ((memptr & 0x08) << 10) | (vc << 3) | rc;
  } else {
    address = ((memptr & 0x0e) << 10) | (charCode << 3) | rc;
  }
  if (mode & 4) {
    address &= 0x39ff;
  }
  return address;
}
