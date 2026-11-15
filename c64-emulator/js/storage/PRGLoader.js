export function parsePrg(bytes) {
  if (!bytes || bytes.length < 2) {
    throw new Error('PRG-Datei zu kurz');
  }
  const loadAddress = bytes[0] | (bytes[1] << 8);
  const data = bytes.subarray(2);
  if (loadAddress + data.length > 0x10000) {
    throw new Error('PRG überschreitet den Adressraum');
  }
  return { loadAddress, data, endAddress: loadAddress + data.length };
}

export function makePrg(loadAddress, data) {
  const out = new Uint8Array(data.length + 2);
  out[0] = loadAddress & 0xff;
  out[1] = (loadAddress >> 8) & 0xff;
  out.set(data, 2);
  return out;
}

export function parseP00(bytes) {
  const signature = String.fromCharCode(...bytes.subarray(0, 7));
  if (signature !== 'C64File') {
    return null;
  }
  let name = '';
  for (let i = 8; i < 24 && bytes[i]; i++) {
    name += String.fromCharCode(bytes[i]);
  }
  return { name, prg: bytes.subarray(26) };
}

export function injectPrg(memory, bytes, { basic = true } = {}) {
  const { loadAddress, data, endAddress } = parsePrg(bytes);
  memory.ram.set(data, loadAddress);
  if (basic && loadAddress === 0x0801) {
    for (const pointer of [0x2d, 0x2f, 0x31]) {
      memory.ram[pointer] = endAddress & 0xff;
      memory.ram[pointer + 1] = endAddress >> 8;
    }
    memory.ram[0xae] = endAddress & 0xff;
    memory.ram[0xaf] = endAddress >> 8;
  }
  return { loadAddress, endAddress };
}

export function extractMemory(memory, start, end) {
  return makePrg(start, memory.ram.slice(start, end));
}
