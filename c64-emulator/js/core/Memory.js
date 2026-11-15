export class Memory {
  constructor() {
    this.ram = new Uint8Array(65536);
    this.colorRam = new Uint8Array(1024);
  }

  powerOn() {
    this.ram.fill(0);
    this.colorRam.fill(0);
  }

  readRAM(address) {
    return this.ram[address & 0xffff];
  }

  writeRAM(address, value) {
    this.ram[address & 0xffff] = value & 0xff;
  }

  readColor(index) {
    return this.colorRam[index & 0x3ff] & 0x0f;
  }

  writeColor(index, value) {
    this.colorRam[index & 0x3ff] = value & 0x0f;
  }

  snapshot() {
    return {
      ram: this.ram.slice(),
      colorRam: this.colorRam.slice()
    };
  }
}
