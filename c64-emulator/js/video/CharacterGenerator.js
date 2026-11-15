export class CharacterGenerator {
  static mode(d011, d016) {
    return ((d011 & 0x60) >>> 4) | ((d016 & 0x10) >>> 4);
  }

  static dataAddress(d018, code, row, column, rowIndex, mode) {
    if (mode & 2) {
      const bitmapBase = (d018 & 0x08) << 10;
      return (bitmapBase + ((rowIndex * 40 + column) << 3) + row) & 0x3fff;
    }
    const characterBase = (d018 & 0x0e) << 10;
    const characterCode = (mode & 4) ? (code & 0x3f) : code;
    return (characterBase + (characterCode << 3) + row) & 0x3fff;
  }

  static isForeground(mode, bits, bit, color) {
    if (mode === 0 || mode === 2 || mode === 4) return Boolean(bits & (0x80 >>> bit));
    if (mode === 1) {
      if (!(color & 8)) return Boolean(bits & (0x80 >>> bit));
      return ((bits >>> (6 - ((bit >>> 1) << 1))) & 3) === 3;
    }
    if (mode === 3) return ((bits >>> (6 - ((bit >>> 1) << 1))) & 3) !== 0;
    return false;
  }

  static colorForPixel({ mode, bits, bit, code, color, backgrounds, xInChar }) {
    if (mode === 0) return (bits & (0x80 >>> bit)) ? color : backgrounds[0];
    if (mode === 1) {
      if (!(color & 8)) return (bits & (0x80 >>> bit)) ? color : backgrounds[0];
      const pair = (bits >>> (6 - ((xInChar >>> 1) << 1))) & 3;
      return [backgrounds[0], backgrounds[1], backgrounds[2], color & 7][pair];
    }
    if (mode === 4) {
      const bg = backgrounds[(code >>> 6) & 3];
      return (bits & (0x80 >>> bit)) ? color : bg;
    }
    if (mode === 2) return (bits & (0x80 >>> bit)) ? (code >>> 4) : (code & 15);
    if (mode === 3) {
      const pair = (bits >>> (6 - ((xInChar >>> 1) << 1))) & 3;
      return [backgrounds[0], code >>> 4, code & 15, color][pair];
    }
    return backgrounds[0];
  }
}
