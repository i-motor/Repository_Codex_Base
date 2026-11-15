import { PRGLoader } from './PRGLoader.js';
import { Base64Codec } from './Base64Codec.js';

export class FileManager {
  constructor() {
    this.files = new Map();
  }

  normalizeName(name) {
    if (typeof name !== 'string') throw new TypeError('Dateiname erwartet');
    const normalized = name.trim().toUpperCase();
    if (!normalized || normalized.length > 16 || /[\x00-\x1f\/:]/.test(normalized)) throw new RangeError('Ungültiger 1541-Dateiname');
    return normalized;
  }

  store(name, source, { overwrite = false } = {}) {
    const normalized = this.normalizeName(name);
    const data = PRGLoader.validate(source).slice();
    if (this.files.has(normalized) && !overwrite) throw new Error('FILE EXISTS');
    this.files.set(normalized, { name: normalized, type: 'prg', data });
    return { name: normalized, size: data.length, loadAddress: data[0] | data[1] << 8 };
  }

  get(name) {
    const entry = this.files.get(this.normalizeName(name));
    return entry ? { ...entry, data: entry.data.slice() } : null;
  }

  match(pattern) {
    const text = String(pattern ?? '*').trim().toUpperCase();
    const expression = new RegExp(`^${text.split('').map(character => character === '*' ? '.*' : character === '?' ? '.' : character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
    const result = [...this.files.values()].find(file => expression.test(file.name));
    return result ? { ...result, data: result.data.slice() } : null;
  }

  remove(name) {
    return this.files.delete(this.normalizeName(name));
  }

  rename(oldName, newName) {
    const oldKey = this.normalizeName(oldName);
    const newKey = this.normalizeName(newName);
    if (!this.files.has(oldKey)) throw new Error('FILE NOT FOUND');
    if (this.files.has(newKey)) throw new Error('FILE EXISTS');
    const record = this.files.get(oldKey);
    this.files.delete(oldKey);
    this.files.set(newKey, { ...record, name: newKey });
  }

  list() {
    return [...this.files.values()].map(entry => ({ name: entry.name, type: entry.type, size: entry.data.length, loadAddress: entry.data[0] | entry.data[1] << 8 }));
  }

  async importFile(file, { overwrite = false } = {}) {
    const name = file.name ?? '';
    if (/\.(?:c64b64|json)$/i.test(name)) {
      return this.importContainer(await file.text(), { overwrite });
    }
    if (!/\.prg$/i.test(name)) throw new RangeError('Nur PRG- oder C64B64-Dateien werden unterstützt');
    return [this.store(name.replace(/\.prg$/i, ''), await file.arrayBuffer(), { overwrite })];
  }

  importContainer(json, { overwrite = false } = {}) {
    const files = Base64Codec.importContainer(json);
    const names = files.map(file => this.normalizeName(file.name));
    if (new Set(names).size !== names.length) throw new Error('Doppelte Dateinamen im Container');
    if (!overwrite && names.some(name => this.files.has(name))) throw new Error('FILE EXISTS');
    return files.map(file => this.store(file.name, file.data, { overwrite }));
  }

  exportContainer() {
    return Base64Codec.exportContainer([...this.files.values()]);
  }

  exportPRG(name) {
    const file = this.get(name);
    if (!file) throw new Error('FILE NOT FOUND');
    return { name: `${file.name}.prg`, data: file.data };
  }

  static saveBrowserFile(name, data, mimeType = 'application/octet-stream') {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
