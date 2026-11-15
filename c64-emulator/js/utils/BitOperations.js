const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function toBcd(value) {
  return (((value / 10) | 0) << 4) | (value % 10);
}

export function fromBcd(value) {
  return (value >> 4) * 10 + (value & 0x0f);
}

export function bcdIncrement(value) {
  let lo = (value & 0x0f) + 1;
  let hi = value & 0xf0;
  if (lo === 10) {
    lo = 0;
    hi += 0x10;
  } else if (lo > 15) {
    lo &= 0x0f;
  }
  return (hi | lo) & 0xff;
}

export function hex2(value) {
  return (value & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export function hex4(value) {
  return (value & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

export function bit(value, n) {
  return (value >> n) & 1;
}

export function signed8(value) {
  return value & 0x80 ? value - 256 : value;
}

export function word(lo, hi) {
  return (lo & 0xff) | ((hi & 0xff) << 8);
}
