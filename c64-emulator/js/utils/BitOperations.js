export function lo(word) {
  return word & 0xff;
}

export function hi(word) {
  return (word >>> 8) & 0xff;
}

export function makeWord(low, high) {
  return ((high & 0xff) << 8) | (low & 0xff);
}

export function signExtend(byte) {
  const value = byte & 0xff;
  return value & 0x80 ? value - 0x100 : value;
}
