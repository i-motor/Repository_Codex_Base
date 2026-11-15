export class ProcessorPort6510 {
  constructor() {
    this.reset();
  }

  reset() {
    this.ddr = 0x2f;
    this.latch = 0x37;
    this.externalPins = 0xff;
  }

  readDDR() {
    return this.ddr;
  }

  readPins() {
    return ((this.latch & this.ddr) | (this.externalPins & (~this.ddr & 0xff))) & 0xff;
  }

  writeDDR(value) {
    this.ddr = value & 0xff;
  }

  writePins(value) {
    this.latch = value & 0xff;
  }

  setExternalPins(value) {
    this.externalPins = value & 0xff;
  }

  getBankBits() {
    return this.readPins() & 0x07;
  }

  snapshot() {
    return { ddr: this.ddr, latch: this.latch, externalPins: this.externalPins, pins: this.readPins() };
  }
}
