import { FILE_TYPES, blocksFor, matchPattern, normalizeName } from './DiskDirectory.js';

const SIZE_35 = 174848;
const SIZE_35_ERRORS = 175531;
const SIZE_40 = 196608;
const SIZE_40_ERRORS = 197376;
const DIR_TRACK = 18;
const INTERLEAVE = 10;
const DIR_INTERLEAVE = 3;

export function sectorsPerTrack(track) {
  if (track <= 17) return 21;
  if (track <= 24) return 19;
  if (track <= 30) return 18;
  return 17;
}

function padName(name) {
  const bytes = new Uint8Array(16).fill(0xa0);
  for (let i = 0; i < Math.min(16, name.length); i++) {
    bytes[i] = name.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function readName(bytes, offset, length = 16) {
  let name = '';
  for (let i = 0; i < length; i++) {
    const b = bytes[offset + i];
    if (b === 0xa0) break;
    name += String.fromCharCode(b >= 0xc1 && b <= 0xda ? b - 0x80 : b);
  }
  return name;
}

export class D64Image {
  constructor(bytes = null) {
    if (bytes) {
      this.load(bytes);
    } else {
      this.tracks = 35;
      this.data = new Uint8Array(SIZE_35);
      this.format('LEERE DISK', 'EM');
    }
    this.onChange = null;
  }

  static isD64(bytes) {
    return [SIZE_35, SIZE_35_ERRORS, SIZE_40, SIZE_40_ERRORS].includes(bytes.length);
  }

  load(bytes) {
    if (!D64Image.isD64(bytes)) {
      throw new Error(`Ungültige D64-Größe: ${bytes.length}`);
    }
    this.tracks = bytes.length >= SIZE_40 ? 40 : 35;
    this.data = new Uint8Array(this.tracks === 40 ? SIZE_40 : SIZE_35);
    this.data.set(bytes.subarray(0, this.data.length));
  }

  offset(track, sector) {
    if (track < 1 || track > this.tracks || sector >= sectorsPerTrack(track)) {
      throw new Error(`Ungültiger Sektor ${track}/${sector}`);
    }
    let index = 0;
    for (let t = 1; t < track; t++) {
      index += sectorsPerTrack(t);
    }
    return (index + sector) * 256;
  }

  sector(track, sector) {
    const start = this.offset(track, sector);
    return this.data.subarray(start, start + 256);
  }

  get bam() {
    return this.sector(DIR_TRACK, 0);
  }

  get diskName() {
    return readName(this.bam, 0x90);
  }

  get diskId() {
    return readName(this.bam, 0xa2, 2).padEnd(2, ' ');
  }

  get dosType() {
    return readName(this.bam, 0xa5, 2);
  }

  isFree(track, sector) {
    if (track > 35) {
      return false;
    }
    const bam = this.bam;
    return (bam[4 * track + 1 + (sector >> 3)] & (1 << (sector & 7))) !== 0;
  }

  setUsed(track, sector, used) {
    if (track > 35) {
      return;
    }
    const bam = this.bam;
    const index = 4 * track + 1 + (sector >> 3);
    const mask = 1 << (sector & 7);
    const wasFree = (bam[index] & mask) !== 0;
    if (used && wasFree) {
      bam[index] &= ~mask;
      bam[4 * track]--;
    } else if (!used && !wasFree) {
      bam[index] |= mask;
      bam[4 * track]++;
    }
  }

  blocksFree() {
    let free = 0;
    for (let track = 1; track <= 35; track++) {
      if (track !== DIR_TRACK) {
        free += this.bam[4 * track];
      }
    }
    return free;
  }

  format(name, id) {
    this.data.fill(0);
    const bam = this.bam;
    bam[0] = DIR_TRACK;
    bam[1] = 1;
    bam[2] = 0x41;
    for (let track = 1; track <= 35; track++) {
      const count = sectorsPerTrack(track);
      bam[4 * track] = count;
      for (let s = 0; s < count; s++) {
        bam[4 * track + 1 + (s >> 3)] |= 1 << (s & 7);
      }
    }
    bam.set(padName(normalizeName(name)), 0x90);
    bam[0xa0] = 0xa0;
    bam[0xa1] = 0xa0;
    const cleanId = (id || 'EM').toUpperCase().padEnd(2, ' ');
    bam[0xa2] = cleanId.charCodeAt(0);
    bam[0xa3] = cleanId.charCodeAt(1);
    bam[0xa4] = 0xa0;
    bam[0xa5] = 0x32;
    bam[0xa6] = 0x41;
    for (let i = 0xa7; i <= 0xaa; i++) bam[i] = 0xa0;
    this.setUsed(DIR_TRACK, 0, true);
    this.setUsed(DIR_TRACK, 1, true);
    const dir = this.sector(DIR_TRACK, 1);
    dir[0] = 0;
    dir[1] = 0xff;
    this.changed();
  }

  *directoryEntries() {
    let track = DIR_TRACK;
    let sector = 1;
    const seen = new Set();
    while (track !== 0 && !seen.has(`${track}/${sector}`)) {
      seen.add(`${track}/${sector}`);
      const block = this.sector(track, sector);
      for (let i = 0; i < 8; i++) {
        yield { block, offset: i * 32, track, sector };
      }
      track = block[0];
      sector = block[1];
    }
  }

  listFiles() {
    const files = [];
    for (const { block, offset } of this.directoryEntries()) {
      const type = block[offset + 2];
      if ((type & 0x07) === 0 && !(type & 0x80)) {
        continue;
      }
      if (type === 0) {
        continue;
      }
      files.push({
        name: readName(block, offset + 5),
        type: FILE_TYPES[type & 0x07] || 'PRG',
        closed: (type & 0x80) !== 0,
        locked: (type & 0x40) !== 0,
        blocks: block[offset + 30] | (block[offset + 31] << 8),
        track: block[offset + 3],
        sector: block[offset + 4]
      });
    }
    return files;
  }

  findEntry(pattern) {
    const upper = normalizeName(pattern) || pattern;
    for (const entry of this.directoryEntries()) {
      const type = entry.block[entry.offset + 2];
      if (type === 0 || (type & 0x07) === 0) {
        continue;
      }
      const name = readName(entry.block, entry.offset + 5);
      if (matchPattern(upper, name)) {
        return { ...entry, name, type };
      }
    }
    return null;
  }

  readChain(track, sector) {
    const chunks = [];
    const seen = new Set();
    while (track !== 0) {
      const key = `${track}/${sector}`;
      if (seen.has(key)) {
        throw new Error('Zyklische Sektorkette');
      }
      seen.add(key);
      const block = this.sector(track, sector);
      if (block[0] === 0) {
        chunks.push(block.slice(2, Math.max(2, block[1] + 1)));
      } else {
        chunks.push(block.slice(2, 256));
      }
      track = block[0];
      sector = block[1];
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) {
      out.set(chunk, pos);
      pos += chunk.length;
    }
    return out;
  }

  readFile(pattern) {
    const entry = this.findEntry(pattern);
    if (!entry) {
      return null;
    }
    return {
      name: entry.name,
      type: FILE_TYPES[entry.type & 7] || 'PRG',
      data: this.readChain(entry.block[entry.offset + 3], entry.block[entry.offset + 4])
    };
  }

  freeChain(track, sector) {
    const seen = new Set();
    while (track !== 0 && !seen.has(`${track}/${sector}`)) {
      seen.add(`${track}/${sector}`);
      const block = this.sector(track, sector);
      this.setUsed(track, sector, false);
      track = block[0];
      sector = block[1];
    }
  }

  allocate(nearTrack, nearSector) {
    const order = [];
    for (let distance = 0; distance < 36; distance++) {
      for (const t of [nearTrack - distance, nearTrack + distance]) {
        if (t >= 1 && t <= 35 && t !== DIR_TRACK && !order.includes(t)) {
          order.push(t);
        }
      }
    }
    for (const track of order) {
      if (this.bam[4 * track] === 0) {
        continue;
      }
      const count = sectorsPerTrack(track);
      const start = track === nearTrack ? (nearSector + INTERLEAVE) % count : 0;
      for (let i = 0; i < count; i++) {
        const s = (start + i) % count;
        if (this.isFree(track, s)) {
          this.setUsed(track, s, true);
          return { track, sector: s };
        }
      }
    }
    return null;
  }

  directorySlot() {
    for (const entry of this.directoryEntries()) {
      if (entry.block[entry.offset + 2] === 0) {
        return entry;
      }
    }
    let last = null;
    for (const entry of this.directoryEntries()) {
      last = entry;
    }
    const count = sectorsPerTrack(DIR_TRACK);
    for (let i = 1; i < count; i++) {
      const s = (last.sector + DIR_INTERLEAVE * i) % count;
      if (s !== 0 && this.isFree(DIR_TRACK, s)) {
        this.setUsed(DIR_TRACK, s, true);
        const block = this.sector(DIR_TRACK, s);
        block.fill(0);
        block[1] = 0xff;
        last.block[0] = DIR_TRACK;
        last.block[1] = s;
        return { block, offset: 0, track: DIR_TRACK, sector: s };
      }
    }
    return null;
  }

  writeFile(name, data, type = 'PRG', replace = true) {
    const clean = normalizeName(name);
    const existing = this.findEntry(clean);
    if (existing && existing.name === clean) {
      if (!replace) {
        return false;
      }
      this.deleteFile(clean);
    }
    const needed = blocksFor(data.length);
    if (needed > this.blocksFree()) {
      throw new Error('72,DISK FULL');
    }
    const slot = this.directorySlot();
    if (!slot) {
      throw new Error('72,DISK FULL');
    }
    const sectors = [];
    let near = { track: 17, sector: 0 };
    for (let i = 0; i < needed; i++) {
      const next = this.allocate(near.track, near.sector);
      if (!next) {
        throw new Error('72,DISK FULL');
      }
      sectors.push(next);
      near = next;
    }
    for (let i = 0; i < sectors.length; i++) {
      const block = this.sector(sectors[i].track, sectors[i].sector);
      block.fill(0);
      const chunk = data.subarray(i * 254, i * 254 + 254);
      block.set(chunk, 2);
      if (i + 1 < sectors.length) {
        block[0] = sectors[i + 1].track;
        block[1] = sectors[i + 1].sector;
      } else {
        block[0] = 0;
        block[1] = chunk.length + 1;
      }
    }
    const typeIndex = Math.max(1, FILE_TYPES.indexOf(type));
    const o = slot.offset;
    slot.block[o + 2] = 0x80 | typeIndex;
    slot.block[o + 3] = sectors[0].track;
    slot.block[o + 4] = sectors[0].sector;
    slot.block.set(padName(clean), o + 5);
    slot.block[o + 30] = needed & 0xff;
    slot.block[o + 31] = needed >> 8;
    this.changed();
    return true;
  }

  deleteFile(pattern) {
    let removed = 0;
    const upper = normalizeName(pattern) || pattern;
    for (const entry of this.directoryEntries()) {
      const type = entry.block[entry.offset + 2];
      if (type === 0 || (type & 7) === 0) {
        continue;
      }
      const name = readName(entry.block, entry.offset + 5);
      if (matchPattern(upper, name)) {
        this.freeChain(entry.block[entry.offset + 3], entry.block[entry.offset + 4]);
        entry.block[entry.offset + 2] = 0;
        removed++;
      }
    }
    if (removed) {
      this.changed();
    }
    return removed;
  }

  renameFile(oldName, newName) {
    const entry = this.findEntry(normalizeName(oldName));
    if (!entry) {
      return false;
    }
    entry.block.set(padName(normalizeName(newName)), entry.offset + 5);
    this.changed();
    return true;
  }

  toBytes() {
    return this.data.slice();
  }

  changed() {
    if (this.onChange) {
      this.onChange(this);
    }
  }
}
