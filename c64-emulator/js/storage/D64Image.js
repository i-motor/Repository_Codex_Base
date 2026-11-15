const TRACK_SECTORS = Object.freeze(Array.from({ length: 40 }, (_, i) => i < 17 ? 21 : i < 24 ? 19 : i < 30 ? 18 : 17));
const SECTOR_SIZE = 256;
const SIZES = new Set([174848, 175531, 196608, 197376]);

function petscii(bytes) {
  return Array.from(bytes, value => value === 0xa0 || value === 0 ? ' ' : String.fromCharCode(value)).join('').trimEnd();
}

function encodeName(name) {
  const result = new Uint8Array(16).fill(0xa0);
  for (let index = 0; index < Math.min(16, name.length); index += 1) result[index] = name.toUpperCase().charCodeAt(index) & 255;
  return result;
}

export class D64Image {
  static supportedSizes = Object.freeze([...SIZES]);

  constructor(source) {
    const input = source instanceof Uint8Array ? source : new Uint8Array(source);
    if (!SIZES.has(input.length)) throw new RangeError(`D64-Größe nicht unterstützt: ${input.length}`);
    this.data = input.slice();
    this.tracks = this.data.length >= 196608 ? 40 : 35;
    this.sectorCount = TRACK_SECTORS.slice(0, this.tracks).reduce((a, b) => a + b, 0);
    this.errors = this.data.length > this.sectorCount * SECTOR_SIZE ? this.data.subarray(this.sectorCount * SECTOR_SIZE) : null;
    this.dirty = false;
  }

  static create({ tracks = 35, name = 'C64 DISK', id = '00' } = {}) {
    if (![35, 40].includes(tracks)) throw new RangeError('Nur 35 oder 40 Spuren');
    const size = TRACK_SECTORS.slice(0, tracks).reduce((sum, count) => sum + count, 0) * SECTOR_SIZE;
    const image = new D64Image(new Uint8Array(size));
    const bam = image.readSector(18, 0);
    bam[0] = 18;
    bam[1] = 1;
    bam[2] = 0x41;
    for (let track = 1; track <= Math.min(35, tracks); track += 1) {
      const count = image.sectorsOnTrack(track);
      const offset = 4 + (track - 1) * 4;
      bam[offset] = count;
      for (let sector = 0; sector < count; sector += 1) bam[offset + 1 + (sector >> 3)] |= 1 << (sector & 7);
    }
    bam.set(encodeName(name), 0x90);
    bam[0xa2] = id.charCodeAt(0) || 48;
    bam[0xa3] = id.charCodeAt(1) || 48;
    bam[0xa5] = 0x32;
    bam[0xa6] = 0x41;
    const directory = image.readSector(18, 1);
    directory[0] = 0;
    directory[1] = 255;
    image.markUsed(18, 0);
    image.markUsed(18, 1);
    image.dirty = false;
    return image;
  }

  sectorsOnTrack(track) {
    if (!Number.isInteger(track) || track < 1 || track > this.tracks) throw new RangeError('Ungültige D64-Spur');
    return TRACK_SECTORS[track - 1];
  }

  offset(track, sector) {
    const count = this.sectorsOnTrack(track);
    if (!Number.isInteger(sector) || sector < 0 || sector >= count) throw new RangeError('Ungültiger D64-Sektor');
    let index = sector;
    for (let t = 1; t < track; t += 1) index += TRACK_SECTORS[t - 1];
    return index * SECTOR_SIZE;
  }

  readSector(track, sector) {
    const offset = this.offset(track, sector);
    return this.data.subarray(offset, offset + SECTOR_SIZE);
  }

  writeSector(track, sector, bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 256) throw new RangeError('D64-Sektor benötigt 256 Byte');
    this.data.set(bytes, this.offset(track, sector));
    this.dirty = true;
  }

  getDiskName() {
    return petscii(this.readSector(18, 0).subarray(0x90, 0xa0));
  }

  isFree(track, sector) {
    if (track > 35) return false;
    this.offset(track, sector);
    const bam = this.readSector(18, 0);
    const index = 4 + (track - 1) * 4;
    return Boolean(bam[index + 1 + (sector >> 3)] & (1 << (sector & 7)));
  }

  markUsed(track, sector, used = true) {
    if (track > 35) throw new RangeError('BAM für Spur über 35 wird nicht unterstützt');
    this.offset(track, sector);
    const bam = this.readSector(18, 0);
    const index = 4 + (track - 1) * 4;
    const byte = index + 1 + (sector >> 3);
    const mask = 1 << (sector & 7);
    const wasFree = Boolean(bam[byte] & mask);
    if (used && wasFree) { bam[byte] &= ~mask; bam[index] -= 1; }
    if (!used && !wasFree) { bam[byte] |= mask; bam[index] += 1; }
    this.dirty = true;
  }

  freeBlocks() {
    const bam = this.readSector(18, 0);
    let blocks = 0;
    for (let track = 1; track <= 35; track += 1) if (track !== 18) blocks += bam[4 + (track - 1) * 4];
    return blocks;
  }

  walkChain(track, sector, callback) {
    const visited = new Set();
    while (track !== 0) {
      const offset = this.offset(track, sector);
      if (visited.has(offset)) throw new Error('Zyklische D64-Sektorkette');
      visited.add(offset);
      if (visited.size > this.sectorCount) throw new RangeError('D64-Sektorkette zu lang');
      const bytes = this.data.subarray(offset, offset + 256);
      callback(bytes, track, sector);
      const nextTrack = bytes[0];
      const nextSector = bytes[1];
      if (nextTrack === 0) return;
      track = nextTrack;
      sector = nextSector;
    }
  }

  listDirectory() {
    const result = [];
    this.walkChain(18, 1, bytes => {
      for (let entry = 0; entry < 8; entry += 1) {
        const start = 2 + entry * 32;
        const type = bytes[start];
        if (!(type & 7)) continue;
        result.push({
          name: petscii(bytes.subarray(start + 3, start + 19)),
          type: ['DEL','SEQ','PRG','USR','REL'][type & 7] || 'UNKNOWN',
          closed: Boolean(type & 0x80), locked: Boolean(type & 0x40),
          track: bytes[start + 1], sector: bytes[start + 2],
          blocks: bytes[start + 28] | (bytes[start + 29] << 8)
        });
      }
    });
    return result;
  }

  readPRG(name) {
    const entry = this.listDirectory().find(item => item.name.toUpperCase() === String(name).toUpperCase() && item.type === 'PRG');
    if (!entry) throw new Error('FILE NOT FOUND');
    const chunks = [];
    let total = 0;
    this.walkChain(entry.track, entry.sector, bytes => {
      const length = bytes[0] === 0 ? Math.min(254, Math.max(0, bytes[1] - 1)) : 254;
      chunks.push(bytes.subarray(2, 2 + length));
      total += length;
    });
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  }

  allocateSector(allowDirectory = false) {
    if (allowDirectory) {
      for (let sector = 0; sector < this.sectorsOnTrack(18); sector += 1) {
        if (this.isFree(18, sector)) { this.markUsed(18, sector); return { track: 18, sector }; }
      }
      throw new Error('D64-Directory voll');
    }
    const limit = Math.min(this.tracks, 35);
    for (let track = 1; track <= limit; track += 1) {
      if (track === 18 && !allowDirectory) continue;
      for (let sector = 0; sector < this.sectorsOnTrack(track); sector += 1) {
        if (this.isFree(track, sector)) {
          this.markUsed(track, sector);
          return { track, sector };
        }
      }
    }
    throw new Error('DISK FULL');
  }

  findDirectoryEntry(name) {
    let found = null;
    this.walkChain(18, 1, (bytes, track, sector) => {
      for (let i = 0; i < 8; i += 1) {
        const offset = 2 + i * 32;
        if ((bytes[offset] & 7) && petscii(bytes.subarray(offset + 3, offset + 19)).toUpperCase() === name.toUpperCase()) {
          found = { bytes, track, sector, offset };
        }
      }
    });
    return found;
  }

  deletePRG(name) {
    const location = this.findDirectoryEntry(String(name));
    if (!location || (location.bytes[location.offset] & 7) !== 2) throw new Error('FILE NOT FOUND');
    const chain = [];
    this.walkChain(location.bytes[location.offset + 1], location.bytes[location.offset + 2], (_, track, sector) => chain.push([track, sector]));
    for (const [track, sector] of chain) this.markUsed(track, sector, false);
    location.bytes.fill(0, location.offset, location.offset + 32);
    this.dirty = true;
    return chain.length;
  }

  findFreeDirectoryEntry() {
    let location = null;
    let last = null;
    this.walkChain(18, 1, (sector, track, number) => {
      last = { sector, track, number };
      if (location) return;
      for (let i = 0; i < 8; i += 1) {
        const offset = 2 + i * 32;
        if (!(sector[offset] & 7)) { location = { track, number, offset }; break; }
      }
    });
    if (location) return location;
    const next = this.allocateSector(true);
    if (next.track !== 18) throw new Error('Directory-Sektor außerhalb Spur 18');
    last.sector[0] = next.track;
    last.sector[1] = next.sector;
    const block = this.readSector(next.track, next.sector);
    block.fill(0);
    block[1] = 255;
    return { track: next.track, number: next.sector, offset: 2 };
  }

  writePRG(name, source, { overwrite = false } = {}) {
    const filename = String(name).trim().toUpperCase();
    if (!filename || filename.length > 16) throw new RangeError('Ungültiger D64-Dateiname');
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    if (bytes.length < 2) throw new RangeError('PRG benötigt Ladeadresse');
    const existing = this.listDirectory().find(item => item.name === filename);
    if (existing && !overwrite) throw new Error('FILE EXISTS');
    const count = Math.max(1, Math.ceil(bytes.length / 254));
    if (count > this.freeBlocks() + (existing?.blocks ?? 0)) throw new Error('DISK FULL');
    if (existing) this.deletePRG(filename);
    const location = this.findFreeDirectoryEntry();
    const sectors = [];
    for (let i = 0; i < count; i += 1) sectors.push(this.allocateSector());
    for (let i = 0; i < sectors.length; i += 1) {
      const { track, sector } = sectors[i];
      const block = this.readSector(track, sector);
      block.fill(0);
      const length = Math.min(254, bytes.length - i * 254);
      block.set(bytes.subarray(i * 254, i * 254 + length), 2);
      if (i + 1 < sectors.length) {
        block[0] = sectors[i + 1].track;
        block[1] = sectors[i + 1].sector;
      } else {
        block[0] = 0;
        block[1] = length + 1;
      }
    }
    const entry = this.readSector(location.track, location.number);
    entry[location.offset] = 0x82;
    entry[location.offset + 1] = sectors[0].track;
    entry[location.offset + 2] = sectors[0].sector;
    entry.set(encodeName(filename), location.offset + 3);
    entry[location.offset + 28] = count & 255;
    entry[location.offset + 29] = count >>> 8;
    this.dirty = true;
    return { name: filename, blocks: count };
  }

  exportImage() {
    return this.data.slice();
  }
}
