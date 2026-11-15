export class VICMemory {
  constructor(memory, roms, getCIA2Pins) {
    this.memory = memory;
    this.roms = roms;
    this.getCIA2Pins = getCIA2Pins;
  }

  getBankBase() {
    return ((~this.getCIA2Pins()) & 3) << 14;
  }

  read(address) {
    const relative = address & 0x3fff;
    const base = this.getBankBase();
    if ((base === 0 || base === 0x8000) && relative >= 0x1000 && relative < 0x2000) {
      const value = this.roms.read('chargen', relative - 0x1000);
      if (value !== null) return value;
    }
    return this.memory.readRAM(base | relative);
  }

  readColor(index) {
    return this.memory.readColor(index);
  }
}
