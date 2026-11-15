export class VIA6522 {
  constructor({ name = 'via', readPort = null, onPortChange = null, onIRQChange = null } = {}) {
    this.name = name;
    this.readPort = readPort;
    this.onPortChange = onPortChange;
    this.onIRQChange = onIRQChange;
    this.reset();
  }

  reset() {
    this.ora = 0;
    this.orb = 0;
    this.ddra = 0;
    this.ddrb = 0;
    this.t1c = 0xffff;
    this.t1l = 0xffff;
    this.t2c = 0xffff;
    this.t2l = 0xffff;
    this.t1Running = false;
    this.t2Running = false;
    this.t1Fired = false;
    this.t2Fired = false;
    this.sr = 0;
    this.acr = 0;
    this.pcr = 0;
    this.ifr = 0;
    this.ier = 0;
    this.ca1 = true;
    this.ca2 = true;
    this.cb1 = true;
    this.cb2 = true;
    this.pb6 = true;
    this.irqHigh = true;
    this.onIRQChange?.(false);
  }

  getPortPins(port) {
    const a = port === 'a';
    const ddr = a ? this.ddra : this.ddrb;
    const latch = a ? this.ora : this.orb;
    const external = this.readPort ? this.readPort(port) & 255 : 255;
    let result = ((latch & ddr) | (external & ~ddr)) & 255;
    if (!a && (this.acr & 0x80)) result = (result & 0x7f) | (this.orb & 0x80);
    return result;
  }

  updateIRQ() {
    const active = Boolean(this.ifr & this.ier & 0x7f);
    this.irqHigh = !active;
    this.onIRQChange?.(active);
  }

  flag(mask) {
    this.ifr |= mask & 0x7f;
    this.updateIRQ();
  }

  clear(mask) {
    this.ifr &= ~(mask & 0x7f);
    this.updateIRQ();
  }

  readRegister(address, { peek = false } = {}) {
    const register = address & 15;
    switch (register) {
      case 0: if (!peek) this.clear(0x10); return this.getPortPins('b');
      case 1: if (!peek) this.clear(0x03); return this.getPortPins('a');
      case 2: return this.ddrb;
      case 3: return this.ddra;
      case 4: if (!peek) this.clear(0x40); return this.t1c & 255;
      case 5: return this.t1c >>> 8;
      case 6: return this.t1l & 255;
      case 7: return this.t1l >>> 8;
      case 8: if (!peek) this.clear(0x20); return this.t2c & 255;
      case 9: return this.t2c >>> 8;
      case 10: if (!peek) this.clear(0x04); return this.sr;
      case 11: return this.acr;
      case 12: return this.pcr;
      case 13: return this.ifr | (this.irqHigh ? 0 : 0x80);
      case 14: return this.ier | 0x80;
      case 15: return this.getPortPins('a');
      default: return 255;
    }
  }

  peekRegister(address) {
    return this.readRegister(address, { peek: true });
  }

  writeRegister(address, value) {
    const reg = address & 15;
    const byte = value & 255;
    switch (reg) {
      case 0: this.orb = byte; this.onPortChange?.('b', this.getPortPins('b')); this.clear(0x10); break;
      case 1: this.ora = byte; this.onPortChange?.('a', this.getPortPins('a')); this.clear(0x03); break;
      case 2: this.ddrb = byte; this.onPortChange?.('b', this.getPortPins('b')); break;
      case 3: this.ddra = byte; this.onPortChange?.('a', this.getPortPins('a')); break;
      case 4: this.t1l = (this.t1l & 0xff00) | byte; break;
      case 5: this.t1l = (this.t1l & 0xff) | (byte << 8); this.t1c = this.t1l; this.t1Running = true; this.t1Fired = false; this.clear(0x40); break;
      case 6: this.t1l = (this.t1l & 0xff00) | byte; break;
      case 7: this.t1l = (this.t1l & 0xff) | (byte << 8); this.clear(0x40); break;
      case 8: this.t2l = byte; break;
      case 9: this.t2c = (byte << 8) | this.t2l; this.t2Running = true; this.t2Fired = false; this.clear(0x20); break;
      case 10: this.sr = byte; this.clear(0x04); break;
      case 11: this.acr = byte; break;
      case 12: this.pcr = byte; break;
      case 13: this.clear(byte); break;
      case 14:
        if (byte & 0x80) this.ier |= byte & 0x7f;
        else this.ier &= ~(byte & 0x7f);
        this.updateIRQ();
        break;
      case 15: this.ora = byte; this.onPortChange?.('a', this.getPortPins('a')); break;
    }
  }

  setCA1(high) { this.setEdge('ca1', high, 0x02, Boolean(this.pcr & 1)); }
  setCB1(high) { this.setEdge('cb1', high, 0x10, Boolean(this.pcr & 0x10)); }
  setCA2(high) { this.setEdge('ca2', high, 0x01, Boolean(this.pcr & 0x04)); }
  setCB2(high) { this.setEdge('cb2', high, 0x08, Boolean(this.pcr & 0x40)); }

  setEdge(name, high, mask, positive) {
    const previous = this[name];
    this[name] = Boolean(high);
    if (previous !== this[name] && this[name] === positive) this.flag(mask);
  }

  setPB6(high) {
    const previous = this.pb6;
    this.pb6 = Boolean(high);
    if (previous && !this.pb6 && this.t2Running && (this.acr & 0x20)) this.advanceT2();
  }

  advanceT2() {
    if (this.t2c === 0) {
      this.t2c = 0xffff;
      if (!this.t2Fired) { this.flag(0x20); this.t2Fired = true; }
    } else this.t2c = (this.t2c - 1) & 0xffff;
  }

  tick() {
    if (this.t1Running) {
      if (this.t1c === 0) {
        this.flag(0x40);
        if (this.acr & 0x80) this.orb ^= 0x80;
        if (this.acr & 0x40) this.t1c = this.t1l;
        else { this.t1c = 0xffff; this.t1Running = false; }
      } else this.t1c = (this.t1c - 1) & 0xffff;
    }
    if (this.t2Running && !(this.acr & 0x20)) this.advanceT2();
  }

  snapshot() {
    return {
      ora: this.ora, orb: this.orb, ddra: this.ddra, ddrb: this.ddrb,
      t1c: this.t1c, t1l: this.t1l, t2c: this.t2c, acr: this.acr,
      pcr: this.pcr, sr: this.sr, ifr: this.readRegister(13, { peek: true }), ier: this.ier
    };
  }
}
