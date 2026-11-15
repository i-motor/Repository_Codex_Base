export class Memory {
  constructor() {
    this.ram = new Uint8Array(65536);
    this.colorRam = new Uint8Array(1024);
    this.basicRom = new Uint8Array(8192);
    this.kernalRom = new Uint8Array(8192);
    this.charRom = new Uint8Array(4096);
    this.romsLoaded = { basic: false, kernal: false, chargen: false };
  }

  fillPowerOnPattern() {
    for (let address = 0; address < 65536; address++) {
      this.ram[address] = address & 0x40 ? 0xff : 0x00;
    }
    for (let i = 0; i < 1024; i++) {
      this.colorRam[i] = (i * 7 + 3) & 0x0f;
    }
  }

  loadRom(kind, bytes) {
    const target = kind === 'basic' ? this.basicRom : kind === 'kernal' ? this.kernalRom : kind === 'chargen' ? this.charRom : null;
    if (!target) {
      throw new Error(`Unbekannter ROM-Typ ${kind}`);
    }
    if (bytes.length !== target.length) {
      throw new Error(`${kind}: erwartet ${target.length} Bytes, erhalten ${bytes.length}`);
    }
    target.set(bytes);
    this.romsLoaded[kind] = true;
  }
}
