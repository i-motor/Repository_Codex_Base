const PULLUP = 0x17;
const FLOATING_BITS = 0xc8;

export class ProcessorPort {
  constructor(clock, { falloffCycles = 350000 } = {}) {
    this.clock = clock;
    this.falloffCycles = falloffCycles;
    this.ddr = 0;
    this.data = 0;
    this.cassetteSense = false;
    this.floatingValue = 0;
    this.floatingUntil = new Float64Array(8);
    this.onChange = null;
    this.lastLines = -1;
  }

  reset() {
    this.ddr = 0;
    this.data = 0;
    this.floatingValue = 0;
    this.floatingUntil.fill(0);
    this.notify();
  }

  now() {
    return this.clock ? this.clock.cycles : 0;
  }

  pins() {
    const driven = this.data & this.ddr;
    const floating = this.floatingInputs();
    let inputs = (PULLUP | floating) & ~this.ddr;
    if (this.cassetteSense) {
      inputs &= ~0x10;
    }
    return (driven | inputs) & 0xff;
  }

  floatingInputs() {
    let value = 0;
    const now = this.now();
    for (let bit = 3; bit < 8; bit++) {
      const mask = 1 << bit;
      if ((FLOATING_BITS & mask) && !(this.ddr & mask) && (this.floatingValue & mask) && now < this.floatingUntil[bit]) {
        value |= mask;
      }
    }
    return value;
  }

  read(address) {
    if (address === 0) {
      return this.ddr;
    }
    let value = (this.data & this.ddr) | (this.pins() & ~this.ddr);
    if (!(this.ddr & 0x20)) {
      value &= ~0x20;
    }
    return value & 0xff;
  }

  write(address, value) {
    const now = this.now();
    if (address === 0) {
      const old = this.ddr;
      for (let bit = 3; bit < 8; bit++) {
        const mask = 1 << bit;
        if ((FLOATING_BITS & mask) && (old & mask) && !(value & mask)) {
          if (this.data & mask) {
            this.floatingValue |= mask;
            this.floatingUntil[bit] = now + this.falloffCycles;
          } else {
            this.floatingValue &= ~mask;
          }
        }
      }
      this.ddr = value & 0xff;
    } else {
      this.data = value & 0xff;
      for (let bit = 3; bit < 8; bit++) {
        const mask = 1 << bit;
        if ((FLOATING_BITS & mask) && !(this.ddr & mask) && (value & mask) && (this.floatingValue & mask)) {
          this.floatingUntil[bit] = now + this.falloffCycles;
        }
      }
    }
    this.notify();
  }

  lines() {
    const pins = this.pins();
    return { loram: pins & 1, hiram: (pins >> 1) & 1, charen: (pins >> 2) & 1 };
  }

  outputs() {
    const pins = this.pins();
    return {
      loram: pins & 1,
      hiram: (pins >> 1) & 1,
      charen: (pins >> 2) & 1,
      cassetteWrite: (pins >> 3) & 1,
      motor: this.ddr & 0x20 ? ((this.data >> 5) & 1) === 0 : false
    };
  }

  setCassetteSense(pressed) {
    this.cassetteSense = pressed;
  }

  notify() {
    const pins = this.pins() & 7;
    if (pins !== this.lastLines) {
      this.lastLines = pins;
      if (this.onChange) {
        this.onChange(pins & 1, (pins >> 1) & 1, (pins >> 2) & 1);
      }
    }
  }
}
