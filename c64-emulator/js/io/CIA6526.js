const TIMER_A = 0x01;
const TIMER_B = 0x02;
const TOD_ALARM = 0x04;
const SERIAL = 0x08;
const FLAG = 0x10;

function bcdNumber(byte) {
  return (byte >>> 4) * 10 + (byte & 15);
}

function bcdByte(number) {
  return (((Math.floor(number / 10) % 10) << 4) | (number % 10)) & 0xff;
}

function timerState() {
  return { latch: 0xffff, counter: 0xffff, output: false, pulse: false };
}

function timeState() {
  return { tenths: 0, seconds: 0, minutes: 0, hours: 1 };
}

export class CIA6526 {
  constructor({ name = 'cia', interruptController = null, interruptLine = 'irq', portResolver = null, onPortChange = null } = {}) {
    if (!['irq', 'nmi'].includes(interruptLine)) throw new RangeError('Unbekannte Interruptleitung');
    this.name = name;
    this.interruptController = interruptController;
    this.interruptLine = interruptLine;
    this.portResolver = portResolver;
    this.onPortChange = onPortChange;
    this.reset();
  }

  reset() {
    this.pra = 0xff;
    this.prb = 0xff;
    this.ddra = 0;
    this.ddrb = 0;
    this.portAInputs = 0xff;
    this.portBInputs = 0xff;
    this.timerA = timerState();
    this.timerB = timerState();
    this.cra = 0;
    this.crb = 0;
    this.icrPending = 0;
    this.icrMask = 0;
    this.cntHigh = true;
    this.cntRise = false;
    this.spHigh = true;
    this.flagHigh = true;
    this.tod = timeState();
    this.alarm = timeState();
    this.todLatched = null;
    this.todStopped = false;
    this.todDivider = 0;
    this.sdr = 0;
    this.serialShift = 0;
    this.serialBits = 0;
    this.serialOutputBusy = false;
    this.serialClockHigh = true;
    this.serialOutputHigh = true;
    this.serialInputShift = 0;
    this.serialInputBits = 0;
    this.cycles = 0;
    this.updateInterrupt();
  }

  setPortResolver(resolver) {
    this.portResolver = resolver;
  }

  setPortInputs(port, value) {
    if (port === 'a') this.portAInputs = value & 0xff;
    else if (port === 'b') this.portBInputs = value & 0xff;
    else throw new RangeError('Unbekannter CIA-Port');
  }

  getPortPins(port) {
    if (port !== 'a' && port !== 'b') throw new RangeError('Unbekannter CIA-Port');
    const latch = port === 'a' ? this.pra : this.prb;
    const ddr = port === 'a' ? this.ddra : this.ddrb;
    const inputs = port === 'a' ? this.portAInputs : this.portBInputs;
    const defaultPins = ((latch & ddr) | (inputs & ~ddr)) & 0xff;
    if (!this.portResolver) return defaultPins;
    return this.portResolver(port, this, defaultPins) & 0xff;
  }

  getPortOutputs(port) {
    if (port === 'a') return { latch: this.pra, ddr: this.ddra };
    if (port === 'b') return { latch: this.prb, ddr: this.ddrb };
    throw new RangeError('Unbekannter CIA-Port');
  }

  getPortB() {
    let value = this.getPortPins('b');
    if (this.cra & 0x02) value = (value & ~0x40) | (this.timerA.output ? 0x40 : 0);
    if (this.crb & 0x02) value = (value & ~0x80) | (this.timerB.output ? 0x80 : 0);
    return value;
  }

  interruptValue() {
    return this.icrPending | ((this.icrPending & this.icrMask) ? 0x80 : 0);
  }

  isInterruptActive() {
    return Boolean(this.icrPending & this.icrMask);
  }

  updateInterrupt() {
    if (!this.interruptController) return;
    const active = this.isInterruptActive();
    if (this.interruptLine === 'irq') this.interruptController.setIRQ(this.name, active);
    else this.interruptController.setNMI(this.name, active);
  }

  raiseInterrupt(mask) {
    this.icrPending |= mask & 0x1f;
    this.updateInterrupt();
  }

  setFLAG(high) {
    const newHigh = Boolean(high);
    if (this.flagHigh && !newHigh) this.raiseInterrupt(FLAG);
    this.flagHigh = newHigh;
  }

  setSP(high) {
    this.spHigh = Boolean(high);
  }

  setCNT(high) {
    const newHigh = Boolean(high);
    if (newHigh && !this.cntHigh) this.cntRise = true;
    this.cntHigh = newHigh;
  }

  readTOD(index, observeOnly) {
    if (index === 3 && !observeOnly && !this.todLatched) this.todLatched = { ...this.tod };
    const source = this.todLatched || this.tod;
    const field = ['tenths', 'seconds', 'minutes', 'hours'][index];
    const value = source[field];
    if (index === 0 && !observeOnly) this.todLatched = null;
    return value;
  }

  readRegister(address, context = {}) {
    return this.readInternal(address & 15, false);
  }

  peekRegister(address) {
    return this.readInternal(address & 15, true);
  }

  readInternal(reg, observeOnly) {
    switch (reg) {
      case 0: return this.getPortPins('a');
      case 1: return this.getPortB();
      case 2: return this.ddra;
      case 3: return this.ddrb;
      case 4: return this.timerA.counter & 0xff;
      case 5: return this.timerA.counter >>> 8;
      case 6: return this.timerB.counter & 0xff;
      case 7: return this.timerB.counter >>> 8;
      case 8: case 9: case 10: case 11: return this.readTOD(reg - 8, observeOnly);
      case 12: return this.sdr;
      case 13: {
        const value = this.interruptValue();
        if (!observeOnly) {
          this.icrPending = 0;
          this.updateInterrupt();
        }
        return value;
      }
      case 14: return this.cra;
      case 15: return this.crb;
      default: return 0xff;
    }
  }

  writeTimer(timer, high, value, control) {
    if (high) timer.latch = ((value << 8) | (timer.latch & 0xff)) & 0xffff;
    else timer.latch = (timer.latch & 0xff00) | value;
    if (high && !(control & 1)) timer.counter = timer.latch;
  }

  writeTOD(index, value) {
    const target = (this.crb & 0x80) ? this.alarm : this.tod;
    const field = ['tenths', 'seconds', 'minutes', 'hours'][index];
    let sanitized = value;
    if (index === 0) sanitized &= 0x0f;
    else if (index === 3) sanitized &= 0x9f;
    else sanitized &= 0x7f;
    target[field] = sanitized;
    if (!(this.crb & 0x80)) {
      if (index === 3) this.todStopped = true;
      if (index === 0) {
        this.todStopped = false;
        this.todDivider = 0;
      }
    }
  }

  writeRegister(address, value, context = {}) {
    const reg = address & 15;
    const byte = value & 0xff;
    switch (reg) {
      case 0: this.pra = byte; break;
      case 1: this.prb = byte; break;
      case 2: this.ddra = byte; break;
      case 3: this.ddrb = byte; break;
      case 4: this.writeTimer(this.timerA, false, byte, this.cra); break;
      case 5: this.writeTimer(this.timerA, true, byte, this.cra); break;
      case 6: this.writeTimer(this.timerB, false, byte, this.crb); break;
      case 7: this.writeTimer(this.timerB, true, byte, this.crb); break;
      case 8: case 9: case 10: case 11: this.writeTOD(reg - 8, byte); break;
      case 12:
        this.sdr = byte;
        if (this.cra & 0x40) {
          this.serialShift = byte;
          this.serialBits = 0;
          this.serialOutputBusy = true;
          this.serialClockHigh = true;
        }
        break;
      case 13:
        if (byte & 0x80) this.icrMask |= byte & 0x1f;
        else this.icrMask &= ~(byte & 0x1f);
        this.updateInterrupt();
        break;
      case 14:
        this.cra = byte & ~0x10;
        if (byte & 0x10) this.timerA.counter = this.timerA.latch;
        break;
      case 15:
        this.crb = byte & ~0x10;
        if (byte & 0x10) this.timerB.counter = this.timerB.latch;
        break;
    }
    if (reg <= 3) this.onPortChange?.();
  }

  clockTimer(timer, control, pulse, interruptBit) {
    timer.pulse = false;
    if (!(control & 1) || !pulse) return false;
    if (timer.counter !== 0) {
      timer.counter = (timer.counter - 1) & 0xffff;
      return false;
    }
    timer.counter = timer.latch;
    if (control & 0x02) {
      if (control & 0x04) timer.output = !timer.output;
      else {
        timer.output = true;
        timer.pulse = true;
      }
    }
    this.raiseInterrupt(interruptBit);
    return true;
  }

  serialClock(underflow) {
    if (!underflow || !(this.cra & 0x40) || !this.serialOutputBusy) return;
    this.serialClockHigh = !this.serialClockHigh;
    if (!this.serialClockHigh) {
      this.serialOutputHigh = Boolean(this.serialShift & 0x80);
      return;
    }
    this.serialShift = (this.serialShift << 1) & 0xff;
    this.serialBits += 1;
    if (this.serialBits === 8) {
      this.serialOutputBusy = false;
      this.raiseInterrupt(SERIAL);
    }
  }

  serialInput(rising) {
    if (!rising || (this.cra & 0x40)) return;
    this.serialInputShift = ((this.serialInputShift << 1) | Number(this.spHigh)) & 0xff;
    this.serialInputBits += 1;
    if (this.serialInputBits === 8) {
      this.sdr = this.serialInputShift;
      this.serialInputBits = 0;
      this.serialInputShift = 0;
      this.raiseInterrupt(SERIAL);
    }
  }

  advanceTOD() {
    if (this.todStopped) return;
    this.todDivider += 1;
    const pulsesPerTenth = (this.cra & 0x80) ? 5 : 6;
    if (this.todDivider < pulsesPerTenth) return;
    this.todDivider = 0;
    this.tod.tenths = bcdByte((bcdNumber(this.tod.tenths) + 1) % 10);
    if (this.tod.tenths === 0) {
      let seconds = bcdNumber(this.tod.seconds) + 1;
      if (seconds >= 60) {
        seconds = 0;
        let minutes = bcdNumber(this.tod.minutes) + 1;
        if (minutes >= 60) {
          minutes = 0;
          const hour = bcdNumber(this.tod.hours & 0x1f);
          const next = hour === 12 ? 1 : hour + 1;
          const pm = (this.tod.hours & 0x80) ^ (hour === 11 ? 0x80 : 0);
          this.tod.hours = pm | bcdByte(next);
        }
        this.tod.minutes = bcdByte(minutes);
      }
      this.tod.seconds = bcdByte(seconds);
    }
    if (this.tod.tenths === this.alarm.tenths && this.tod.seconds === this.alarm.seconds &&
        this.tod.minutes === this.alarm.minutes && this.tod.hours === this.alarm.hours) this.raiseInterrupt(TOD_ALARM);
  }

  tick({ todPulse = false } = {}) {
    this.cycles += 1;
    if (this.timerA.pulse && !(this.cra & 0x04)) this.timerA.output = false;
    if (this.timerB.pulse && !(this.crb & 0x04)) this.timerB.output = false;
    const rising = this.cntRise;
    this.cntRise = false;
    const aPulse = !(this.cra & 0x20) || rising;
    const underflowA = this.clockTimer(this.timerA, this.cra, aPulse, TIMER_A);
    if (underflowA && (this.cra & 0x08)) this.cra &= ~1;
    const bMode = (this.crb >>> 5) & 3;
    const bPulse = bMode === 0 ? true : bMode === 1 ? rising : bMode === 2 ? underflowA : underflowA && this.cntHigh;
    const underflowB = this.clockTimer(this.timerB, this.crb, bPulse, TIMER_B);
    if (underflowB && (this.crb & 0x08)) this.crb &= ~1;
    this.serialInput(rising);
    this.serialClock(underflowA);
    if (todPulse) this.advanceTOD();
    return { underflowA, underflowB, irq: this.isInterruptActive() };
  }

  getState() {
    return {
      name: this.name, pra: this.pra, prb: this.prb, ddra: this.ddra, ddrb: this.ddrb,
      pinsA: this.getPortPins('a'), pinsB: this.getPortB(),
      timerA: { ...this.timerA }, timerB: { ...this.timerB },
      cra: this.cra, crb: this.crb, icrPending: this.icrPending, icrMask: this.icrMask,
      interrupt: this.isInterruptActive(), tod: { ...this.tod }, alarm: { ...this.alarm },
      serial: { sdr: this.sdr, bits: this.serialBits, busy: this.serialOutputBusy },
      cycles: this.cycles
    };
  }
}
