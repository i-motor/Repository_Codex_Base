import { ROM_SIZES } from '../utils/Constants.js';

export class ROMManager {
  constructor() {
    this.roms = new Map();
  }

  validate(type, source) {
    if (!Object.hasOwn(ROM_SIZES, type)) {
      throw new RangeError(`Unbekannter ROM-Typ: ${type}`);
    }
    let data;
    if (source instanceof ArrayBuffer) {
      data = new Uint8Array(source);
    } else if (ArrayBuffer.isView(source)) {
      data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    } else {
      throw new TypeError('ROM muss ein ArrayBuffer oder ein Typed Array sein');
    }
    if (data.byteLength !== ROM_SIZES[type]) {
      throw new RangeError(`${type}.rom: erwartet ${ROM_SIZES[type]} Byte, erhalten ${data.byteLength}`);
    }
    return data;
  }

  load(type, source) {
    const data = this.validate(type, source);
    this.roms.set(type, data.slice());
    return this.getStatus();
  }

  async loadFromURL(type, url, fetcher = fetch) {
    const response = await fetcher(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    this.load(type, await response.arrayBuffer());
    return this.getStatus();
  }

  read(type, offset) {
    const data = this.roms.get(type);
    if (!data) return null;
    if (!Number.isInteger(offset) || offset < 0 || offset >= data.length) {
      throw new RangeError(`ROM-Adresse außerhalb des gültigen Bereichs: ${offset}`);
    }
    return data[offset];
  }

  isLoaded(type) {
    return this.roms.has(type);
  }

  isComplete() {
    return Object.keys(ROM_SIZES).every(type => this.isLoaded(type));
  }

  getStatus() {
    return Object.fromEntries(Object.keys(ROM_SIZES).map(type => [type, {
      loaded: this.isLoaded(type),
      size: this.roms.get(type)?.length ?? 0,
      expectedSize: ROM_SIZES[type]
    }]));
  }
}
