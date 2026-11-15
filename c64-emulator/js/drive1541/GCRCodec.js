const CODES = Uint8Array.of(0x0a,0x0b,0x12,0x13,0x0e,0x0f,0x16,0x17,0x09,0x19,0x1a,0x1b,0x0d,0x1d,0x1e,0x15);
const DECODE = new Int8Array(32).fill(-1);
for (let i = 0; i < 16; i += 1) DECODE[CODES[i]] = i;

export class GCRCodec {
  static encode(bytes) {
    if (bytes.length % 4) throw new RangeError('GCR benötigt Daten in Vierergruppen');
    const result = new Uint8Array(bytes.length * 5 / 4);
    for (let i = 0, at = 0; i < bytes.length; i += 4) {
      let bits = 0n;
      for (let j = 0; j < 4; j += 1) {
        bits = (bits << 5n) | BigInt(CODES[bytes[i + j] >>> 4]);
        bits = (bits << 5n) | BigInt(CODES[bytes[i + j] & 15]);
      }
      for (let j = 4; j >= 0; j -= 1) {
        result[at + j] = Number(bits & 255n);
        bits >>= 8n;
      }
      at += 5;
    }
    return result;
  }

  static decode(bytes) {
    if (bytes.length % 5) throw new RangeError('GCR benötigt Daten in Fünfergruppen');
    const result = new Uint8Array(bytes.length * 4 / 5);
    for (let i = 0, at = 0; i < bytes.length; i += 5) {
      let bits = 0n;
      for (let j = 0; j < 5; j += 1) bits = (bits << 8n) | BigInt(bytes[i + j]);
      for (let j = 7; j >= 0; j -= 1) {
        const encoded = Number((bits >> BigInt(j * 5)) & 31n);
        const nibble = DECODE[encoded];
        if (nibble < 0) throw new Error('Ungültiger GCR-Fünfbitcode');
        const index = at + (7 - j >> 1);
        if ((7 - j) & 1) result[index] |= nibble;
        else result[index] = nibble << 4;
      }
      at += 4;
    }
    return result;
  }

  static encodeSector(track, sector, data, diskId = [0x30, 0x30]) {
    if (data.length !== 256) throw new RangeError('GCR-Sektordaten benötigen 256 Byte');
    const header = Uint8Array.of(0x08, sector ^ track ^ diskId[0] ^ diskId[1], sector, track, diskId[0], diskId[1], 0x0f, 0x0f);
    const body = new Uint8Array(260);
    body[0] = 0x07;
    body.set(data, 1);
    let checksum = 0;
    for (const byte of data) checksum ^= byte;
    body[257] = checksum;
    body[258] = 0;
    body[259] = 0;
    return { header: this.encode(header), data: this.encode(body) };
  }

  static encodeTrack(image, track) {
    const sections = [];
    let length = 0;
    const bam = image.readSector(18, 0);
    for (let s = 0; s < image.sectorsOnTrack(track); s += 1) {
      const { header, data } = this.encodeSector(track, s, image.readSector(track, s), [bam[0xa2], bam[0xa3]]);
      const section = new Uint8Array(5 + header.length + 9 + 5 + data.length + 9).fill(0x55);
      section.fill(0xff, 0, 5);
      section.set(header, 5);
      let p = 5 + header.length + 9;
      section.fill(0xff, p, p + 5);
      p += 5;
      section.set(data, p);
      sections.push(section);
      length += section.length;
    }
    const trackBytes = new Uint8Array(length);
    let offset = 0;
    for (const part of sections) { trackBytes.set(part, offset); offset += part.length; }
    return trackBytes;
  }
}
