import { crc32 } from '../utils/BitOperations.js';
import { ROM_SIZES } from '../utils/Constants.js';

export const ROM_SPECS = ROM_SIZES;

export const KNOWN_ROMS = Object.freeze([
  { kind: 'basic', crc32: 0xf833d117, revision: 'BASIC V2 (901226-01)' },
  { kind: 'kernal', crc32: 0xdbe3e7c7, revision: 'KERNAL Rev. 3 (901227-03)' },
  { kind: 'kernal', crc32: 0xa5c687b3, revision: 'KERNAL Rev. 2 (901227-02)' },
  { kind: 'kernal', crc32: 0xdce782fa, revision: 'KERNAL Rev. 1 (901227-01)' },
  { kind: 'chargen', crc32: 0xec4272ee, revision: 'Zeichensatz (901225-01)' }
]);

export const ROM_FILENAMES = Object.freeze({
  basic: ['basic.rom', 'basic.901226-01.bin', 'basic'],
  kernal: ['kernal.rom', 'kernal.901227-03.bin', 'kernal'],
  chargen: ['chargen.rom', 'characters.901225-01.bin', 'chargen']
});

export function validateRom(kind, bytes) {
  const expected = ROM_SPECS[kind];
  if (expected === undefined) {
    return { ok: false, message: `Unbekannter ROM-Typ: ${kind}` };
  }
  if (!bytes || bytes.length !== expected) {
    return {
      ok: false,
      size: bytes ? bytes.length : 0,
      message: `${kind}: ungültige Größe ${bytes ? bytes.length : 0} Bytes, erwartet ${expected}`
    };
  }
  const checksum = crc32(bytes);
  const known = KNOWN_ROMS.find((entry) => entry.kind === kind && entry.crc32 === checksum) || null;
  return {
    ok: true,
    size: bytes.length,
    crc32: checksum,
    known: known !== null,
    revision: known ? known.revision : 'unbekannte Revision (Größe gültig)',
    message: `${kind}: ${known ? known.revision : 'unbekannte Revision'}, CRC32 ${checksum.toString(16).padStart(8, '0')}`
  };
}

export function guessRomKind(name, size) {
  const lower = name.toLowerCase();
  for (const [kind, names] of Object.entries(ROM_FILENAMES)) {
    if (names.some((candidate) => lower.includes(candidate.split('.')[0]))) {
      if (ROM_SPECS[kind] === size) {
        return kind;
      }
    }
  }
  if (size === 4096) {
    return 'chargen';
  }
  return null;
}

export async function loadRomFromUrl(kind, url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${kind}: ${url} nicht gefunden (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const check = validateRom(kind, bytes);
  if (!check.ok) {
    throw new Error(check.message);
  }
  return bytes;
}

export async function loadRomFromFile(kind, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateRom(kind, bytes);
  if (!check.ok) {
    throw new Error(check.message);
  }
  return bytes;
}

export async function loadRomSet(baseUrl, fetchImpl = globalThis.fetch) {
  const roms = {};
  for (const kind of Object.keys(ROM_SPECS)) {
    roms[kind] = await loadRomFromUrl(kind, `${baseUrl}/${kind === 'chargen' ? 'chargen' : kind}.rom`, fetchImpl);
  }
  return roms;
}
