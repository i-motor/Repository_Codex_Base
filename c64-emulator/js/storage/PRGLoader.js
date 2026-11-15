export class PRGLoader {
  static bytes(source) {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    throw new TypeError('Binärdaten müssen ein ArrayBuffer oder TypedArray sein');
  }

  static validate(source) {
    const bytes = this.bytes(source);
    if (bytes.length < 2 || bytes.length > 65538) throw new RangeError('PRG benötigt eine zweiby­tige Ladeadresse und maximal 65536 Datenbytes');
    return bytes;
  }

  static parse(source) {
    const bytes = this.validate(source);
    const address = bytes[0] | (bytes[1] << 8);
    return { loadAddress: address, data: bytes.slice(2), byteLength: bytes.length, endAddress: (address + bytes.length - 2) & 0xffff };
  }

  static serialize(loadAddress, data) {
    if (!Number.isInteger(loadAddress) || loadAddress < 0 || loadAddress > 65535) throw new RangeError('Ungültige PRG-Ladeadresse');
    const bytes = this.bytes(data);
    if (bytes.length > 65536) throw new RangeError('PRG-Datei zu groß');
    const result = new Uint8Array(bytes.length + 2);
    result[0] = loadAddress & 255;
    result[1] = loadAddress >>> 8;
    result.set(bytes, 2);
    return result;
  }
}
