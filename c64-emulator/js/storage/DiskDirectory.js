export const FILE_TYPES = Object.freeze(['DEL', 'SEQ', 'PRG', 'USR', 'REL']);

export const TOTAL_BLOCKS = 664;

export function normalizeName(name) {
  return String(name)
    .replace(/\.(prg|seq|usr|p00|bas)$/i, '')
    .toUpperCase()
    .replace(/[^\x20-\x5f]/g, '')
    .slice(0, 16);
}

export function blocksFor(size) {
  return Math.max(1, Math.ceil(size / 254));
}

export function matchPattern(pattern, name) {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p === '*') {
      return true;
    }
    if (i >= name.length) {
      return false;
    }
    if (p !== '?' && p !== name[i]) {
      return false;
    }
  }
  return pattern.length === name.length;
}

export class DiskDirectory {
  constructor({ name = 'VIRTUELLE DISK', id = 'EM' } = {}) {
    this.diskName = normalizeName(name);
    this.diskId = id.toUpperCase().slice(0, 2).padEnd(2, ' ');
    this.dosType = '2A';
    this.files = [];
    this.onChange = null;
  }

  listFiles() {
    return this.files.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.data.length,
      blocks: blocksFor(file.data.length),
      locked: false
    }));
  }

  find(pattern) {
    const upper = normalizeName(pattern) || pattern;
    return this.files.find((file) => matchPattern(upper, file.name)) || null;
  }

  readFile(pattern) {
    const file = this.find(pattern);
    return file ? { name: file.name, type: file.type, data: file.data } : null;
  }

  writeFile(name, data, type = 'PRG', replace = true) {
    const clean = normalizeName(name);
    const existing = this.files.findIndex((file) => file.name === clean);
    if (existing >= 0) {
      if (!replace) {
        return false;
      }
      this.files.splice(existing, 1, { name: clean, type, data: new Uint8Array(data) });
    } else {
      if (this.blocksFree() < blocksFor(data.length)) {
        throw new Error('72,DISK FULL');
      }
      this.files.push({ name: clean, type, data: new Uint8Array(data) });
    }
    this.changed();
    return true;
  }

  deleteFile(pattern) {
    const before = this.files.length;
    const upper = normalizeName(pattern) || pattern;
    this.files = this.files.filter((file) => !matchPattern(upper, file.name));
    const removed = before - this.files.length;
    if (removed) {
      this.changed();
    }
    return removed;
  }

  renameFile(oldName, newName) {
    const file = this.files.find((entry) => entry.name === normalizeName(oldName));
    if (!file) {
      return false;
    }
    file.name = normalizeName(newName);
    this.changed();
    return true;
  }

  format(name, id) {
    this.files = [];
    this.diskName = normalizeName(name || this.diskName);
    if (id) {
      this.diskId = id.toUpperCase().slice(0, 2).padEnd(2, ' ');
    }
    this.changed();
  }

  blocksFree() {
    const used = this.files.reduce((sum, file) => sum + blocksFor(file.data.length), 0);
    return Math.max(0, TOTAL_BLOCKS - used);
  }

  changed() {
    if (this.onChange) {
      this.onChange(this);
    }
  }

  toJSON() {
    return {
      diskName: this.diskName,
      diskId: this.diskId,
      files: this.files.map((file) => ({ name: file.name, type: file.type, data: Array.from(file.data) }))
    };
  }
}
