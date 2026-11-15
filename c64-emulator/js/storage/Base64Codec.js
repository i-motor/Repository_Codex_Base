import { PRGLoader } from './PRGLoader.js';

export class Base64Codec {
  static encode(source) {
    const bytes = PRGLoader.bytes(source);
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      const chunk = bytes.subarray(i, i + 8192);
      for (let j = 0; j < chunk.length; j += 1) text += String.fromCharCode(chunk[j]);
    }
    return btoa(text);
  }

  static decode(text) {
    if (typeof text !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
      throw new TypeError('Ungültige Base64-Daten');
    }
    const binary = atob(text);
    const result = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
    return result;
  }

  static exportContainer(entries) {
    if (!Array.isArray(entries)) throw new TypeError('Dateikatalog erwartet');
    return JSON.stringify({ format: 'c64-base64-v1', files: entries.map(entry => ({
      name: String(entry.name), type: entry.type ?? 'prg', encoding: 'base64', data: this.encode(entry.data)
    })) }, null, 2);
  }

  static importContainer(json) {
    const container = JSON.parse(json);
    if (container?.format !== 'c64-base64-v1' || !Array.isArray(container.files) || container.files.length > 2048) {
      throw new TypeError('Kein gültiger C64-Base64-Container');
    }
    return container.files.map(entry => {
      if (typeof entry.name !== 'string' || !entry.name.length || entry.name.length > 160 || entry.encoding !== 'base64' || entry.type !== 'prg') {
        throw new TypeError('Ungültiger Containereintrag');
      }
      const data = this.decode(entry.data);
      PRGLoader.validate(data);
      return { name: entry.name, type: 'prg', data };
    });
  }
}
