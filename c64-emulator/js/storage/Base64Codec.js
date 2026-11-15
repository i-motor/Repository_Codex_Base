const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) {
  LOOKUP[ALPHABET.charCodeAt(i)] = i;
}
LOOKUP['-'.charCodeAt(0)] = 62;
LOOKUP['_'.charCodeAt(0)] = 63;

export function encode(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=';
  }
  return out;
}

export function decode(text) {
  const clean = String(text).replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = LOOKUP[clean.charCodeAt(i)];
    if (value < 0) {
      throw new Error(`Ungültiges Base64-Zeichen an Position ${i}`);
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, pos);
}

export const CONTAINER_FORMAT = 'c64-emulator-files';

export function makeContainer(files) {
  return JSON.stringify({
    format: CONTAINER_FORMAT,
    version: 1,
    created: new Date().toISOString(),
    files: files.map((file) => ({
      name: file.name,
      type: file.type || 'PRG',
      size: file.data.length,
      data: encode(file.data)
    }))
  }, null, 2);
}

export function readContainer(text) {
  const parsed = JSON.parse(text);
  if (parsed.format !== CONTAINER_FORMAT || !Array.isArray(parsed.files)) {
    throw new Error('Kein gültiger Emulator-Dateicontainer');
  }
  return parsed.files.map((file) => {
    const data = decode(file.data);
    if (typeof file.size === 'number' && file.size !== data.length) {
      throw new Error(`${file.name}: Größe stimmt nicht`);
    }
    return { name: file.name, type: file.type || 'PRG', data };
  });
}
