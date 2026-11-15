import { bcdIncrement } from '../utils/BitOperations.js';

const STOP = 0;
const WAIT_THEN_COUNT = 1;
const LOAD_THEN_STOP = 2;
const LOAD_THEN_COUNT = 3;
const LOAD_THEN_WAIT_THEN_COUNT = 4;
const COUNT = 5;
const COUNT_THEN_STOP = 6;

export const TIMER_STATE = Object.freeze({
  STOP, WAIT_THEN_COUNT, LOAD_THEN_STOP, LOAD_THEN_COUNT, LOAD_THEN_WAIT_THEN_COUNT, COUNT, COUNT_THEN_STOP
});

export const ICR = Object.freeze({ TA: 1, TB: 2, ALARM: 4, SP: 8, FLAG: 16 });

function nextState(state, cr) {
  switch (state) {
    case STOP:
    case LOAD_THEN_STOP:
      if (cr & 1) {
        return cr & 0x10 ? LOAD_THEN_WAIT_THEN_COUNT : WAIT_THEN_COUNT;
      }
      return cr & 0x10 ? LOAD_THEN_STOP : state;
    case COUNT:
      if (cr & 1) {
        return cr & 0x10 ? LOAD_THEN_WAIT_THEN_COUNT : COUNT;
      }
      return cr & 0x10 ? LOAD_THEN_STOP : COUNT_THEN_STOP;
    case LOAD_THEN_COUNT:
    case WAIT_THEN_COUNT:
      if (cr & 1) {
        if (cr & 8) {
          return -1;
        }
        return cr & 0x10 ? LOAD_THEN_WAIT_THEN_COUNT : state;
      }
      return STOP;
    default:
      return state;
  }
}

export class CIA6526 {
  constructor({ name = 'CIA', model = '6526', onInterrupt = null } = {}) {
    this.name = name;
    this.model = model;
    this.onInterrupt = onInterrupt;
    this.portAIn = null;
    this.portBIn = null;
    this.portAOut = null;
    this.portBOut = null;
    this.onSerialOut = null;
    this.reset();
  }

  setModel(model) {
    this.model = model;
  }

  reset() {
    this.pra = 0;
    this.prb = 0;
    this.ddra = 0;
    this.ddrb = 0;
    this.ta = 0xffff;
    this.tb = 0xffff;
    this.latchA = 0xffff;
    this.latchB = 0xffff;
    this.cra = 0;
    this.crb = 0;
    this.newCra = 0;
    this.newCrb = 0;
    this.hasNewCra = false;
    this.hasNewCrb = false;
    this.taState = STOP;
    this.tbState = STOP;
    this.taUnderflow = false;
    this.tbUnderflow = false;
    this.taToggle = false;
    this.tbToggle = false;
    this.taPulse = false;
    this.tbPulse = false;
    this.icr = 0;
    this.mask = 0;
    this.irqPending = false;
    this.irqActive = false;
    this.cnt = true;
    this.cntEdge = false;
    this.sp = true;
    this.flag = true;
    this.sdr = 0;
    this.srShift = 0;
    this.srBits = 0;
    this.srToggle = false;
    this.srOutputPending = false;
    this.tod = [0, 0, 0, 0x01];
    this.alarm = [0, 0, 0, 0];
    this.todLatch = [0, 0, 0, 0x01];
    this.todLatched = false;
    this.todHalted = false;
    this.todDivider = 0;
    this.lastPortA = -1;
    this.lastPortB = -1;
    this.setIrqLine(false);
    this.notifyPorts();
  }

  setIrqLine(active) {
    if (this.irqActive !== active) {
      this.irqActive = active;
      if (this.onInterrupt) {
        this.onInterrupt(active);
      }
    }
  }

  raise(bits) {
    this.icr |= bits;
    if (this.icr & this.mask & 0x1f) {
      if (this.model === '6526A' || this.model === '8521') {
        this.triggerIrq();
      } else {
        this.irqPending = true;
      }
    }
  }

  triggerIrq() {
    this.icr |= 0x80;
    this.setIrqLine(true);
  }

  getPortAPins() {
    return (this.pra | ~this.ddra) & 0xff;
  }

  getPortBPins() {
    let pins = (this.prb | ~this.ddrb) & 0xff;
    if (this.cra & 0x02) {
      const out = this.cra & 0x04 ? this.taToggle : this.taPulse;
      pins = out ? pins | 0x40 : pins & ~0x40;
    }
    if (this.crb & 0x02) {
      const out = this.crb & 0x04 ? this.tbToggle : this.tbPulse;
      pins = out ? pins | 0x80 : pins & ~0x80;
    }
    return pins;
  }

  notifyPorts() {
    const a = this.getPortAPins();
    if (a !== this.lastPortA) {
      this.lastPortA = a;
      if (this.portAOut) {
        this.portAOut(a);
      }
    }
    const b = this.getPortBPins();
    if (b !== this.lastPortB) {
      this.lastPortB = b;
      if (this.portBOut) {
        this.portBOut(b);
      }
    }
  }

  cycle() {
    if (this.irqPending) {
      this.irqPending = false;
      this.triggerIrq();
    }
    const pulses = this.taPulse || this.tbPulse;
    this.taPulse = false;
    this.tbPulse = false;
    this.taUnderflow = false;
    this.tbUnderflow = false;

    let countA = false;
    switch (this.taState) {
      case WAIT_THEN_COUNT:
        this.taState = COUNT;
        break;
      case STOP:
        break;
      case LOAD_THEN_STOP:
        this.taState = STOP;
        this.ta = this.latchA;
        break;
      case LOAD_THEN_COUNT:
        this.taState = COUNT;
        this.ta = this.latchA;
        break;
      case LOAD_THEN_WAIT_THEN_COUNT:
        this.taState = WAIT_THEN_COUNT;
        if (this.ta === 1) {
          this.underflowA();
        } else {
          this.ta = this.latchA;
        }
        break;
      case COUNT:
        countA = true;
        break;
      case COUNT_THEN_STOP:
        this.taState = STOP;
        countA = true;
        break;
      default:
        break;
    }
    if (countA && ((this.cra & 0x20) === 0 || this.cntEdge)) {
      if (this.ta === 0 || --this.ta === 0) {
        if (this.taState !== STOP) {
          this.underflowA();
        }
        this.taUnderflow = true;
      }
    }
    if (this.hasNewCra) {
      const state = nextState(this.taState, this.newCra);
      if (state === -1) {
        this.newCra &= 0xfe;
        this.taState = STOP;
      } else {
        this.taState = state;
      }
      this.cra = this.newCra & 0xef;
      this.hasNewCra = false;
    }

    let countB = false;
    switch (this.tbState) {
      case WAIT_THEN_COUNT:
        this.tbState = COUNT;
        break;
      case STOP:
        break;
      case LOAD_THEN_STOP:
        this.tbState = STOP;
        this.tb = this.latchB;
        break;
      case LOAD_THEN_COUNT:
        this.tbState = COUNT;
        this.tb = this.latchB;
        break;
      case LOAD_THEN_WAIT_THEN_COUNT:
        this.tbState = WAIT_THEN_COUNT;
        if (this.tb === 1) {
          this.underflowB();
        } else {
          this.tb = this.latchB;
        }
        break;
      case COUNT:
        countB = true;
        break;
      case COUNT_THEN_STOP:
        this.tbState = STOP;
        countB = true;
        break;
      default:
        break;
    }
    if (countB) {
      let tick;
      switch ((this.crb >> 5) & 3) {
        case 0: tick = true; break;
        case 1: tick = this.cntEdge; break;
        case 2: tick = this.taUnderflow; break;
        default: tick = this.taUnderflow && this.cnt; break;
      }
      if (tick && (this.tb === 0 || --this.tb === 0)) {
        if (this.tbState !== STOP) {
          this.underflowB();
        }
        this.tbUnderflow = true;
      }
    }
    if (this.hasNewCrb) {
      const state = nextState(this.tbState, this.newCrb);
      if (state === -1) {
        this.newCrb &= 0xfe;
        this.tbState = STOP;
      } else {
        this.tbState = state;
      }
      this.crb = this.newCrb & 0xef;
      this.hasNewCrb = false;
    }
    this.cntEdge = false;
    if (pulses || this.taPulse || this.tbPulse) {
      this.notifyPorts();
    }
  }

  underflowA() {
    this.ta = this.latchA;
    this.raise(ICR.TA);
    this.taPulse = true;
    this.taToggle = !this.taToggle;
    if (this.cra & 0x08) {
      this.cra &= 0xfe;
      this.newCra &= 0xfe;
      this.taState = LOAD_THEN_STOP;
    } else {
      this.taState = LOAD_THEN_COUNT;
    }
    this.serialClock();
  }

  underflowB() {
    this.tb = this.latchB;
    this.raise(ICR.TB);
    this.tbPulse = true;
    this.tbToggle = !this.tbToggle;
    if (this.crb & 0x08) {
      this.crb &= 0xfe;
      this.newCrb &= 0xfe;
      this.tbState = LOAD_THEN_STOP;
    } else {
      this.tbState = LOAD_THEN_COUNT;
    }
  }

  serialClock() {
    if (!(this.cra & 0x40)) {
      return;
    }
    if (this.srBits === 0) {
      if (!this.srOutputPending) {
        return;
      }
      this.srOutputPending = false;
      this.srShift = this.sdr;
      this.srBits = 16;
      this.srToggle = false;
    }
    this.srToggle = !this.srToggle;
    this.cnt = !this.srToggle;
    if (!this.srToggle) {
      const bit = (this.srShift >> 7) & 1;
      this.sp = bit === 1;
      if (this.onSerialOut) {
        this.onSerialOut(bit);
      }
      this.srShift = (this.srShift << 1) & 0xff;
    }
    this.srBits--;
    if (this.srBits === 0) {
      this.raise(ICR.SP);
      if (this.srOutputPending) {
        this.serialClockRestart();
      }
    }
  }

  serialClockRestart() {
    this.srOutputPending = false;
    this.srShift = this.sdr;
    this.srBits = 16;
    this.srToggle = false;
  }

  setCnt(level) {
    const high = !!level;
    if (high && !this.cnt) {
      this.cntEdge = true;
      if (!(this.cra & 0x40)) {
        this.srShift = ((this.srShift << 1) | (this.sp ? 1 : 0)) & 0xff;
        this.srBits++;
        if (this.srBits >= 8) {
          this.srBits = 0;
          this.sdr = this.srShift;
          this.raise(ICR.SP);
        }
      }
    }
    this.cnt = high;
  }

  setSp(level) {
    this.sp = !!level;
  }

  setFlag(level) {
    const high = !!level;
    if (this.flag && !high) {
      this.raise(ICR.FLAG);
    }
    this.flag = high;
  }

  todTick() {
    const divisor = this.cra & 0x80 ? 5 : 6;
    this.todDivider++;
    if (this.todDivider < divisor) {
      return;
    }
    this.todDivider = 0;
    if (this.todHalted) {
      return;
    }
    this.advanceTod();
  }

  advanceTod() {
    const t = this.tod;
    t[0] = (t[0] + 1) & 0x0f;
    if (t[0] === 10) {
      t[0] = 0;
      t[1] = bcdIncrement(t[1] & 0x7f);
      if (t[1] === 0x60) {
        t[1] = 0;
        t[2] = bcdIncrement(t[2] & 0x7f);
        if (t[2] === 0x60) {
          t[2] = 0;
          const pm = t[3] & 0x80;
          let hour = t[3] & 0x1f;
          if (hour === 0x11) {
            t[3] = 0x12 | (pm ^ 0x80);
          } else if (hour === 0x12) {
            t[3] = 0x01 | pm;
          } else {
            hour = bcdIncrement(hour);
            t[3] = hour | pm;
          }
        }
      }
    }
    this.checkAlarm();
  }

  checkAlarm() {
    const t = this.tod;
    const a = this.alarm;
    if (t[0] === a[0] && t[1] === a[1] && t[2] === a[2] && t[3] === a[3]) {
      this.raise(ICR.ALARM);
    }
  }

  readTod(index) {
    if (index === 3) {
      if (!this.todLatched) {
        this.todLatch = this.tod.slice();
        this.todLatched = true;
      }
      return this.todLatch[3];
    }
    if (index === 0) {
      const value = this.todLatched ? this.todLatch[0] : this.tod[0];
      this.todLatched = false;
      return value;
    }
    return this.todLatched ? this.todLatch[index] : this.tod[index];
  }

  writeTod(index, value) {
    const masks = [0x0f, 0x7f, 0x7f, 0x9f];
    let v = value & masks[index];
    if (index === 3 && (v & 0x1f) === 0x12 && this.model === '6526') {
      v ^= 0x80;
    }
    if (this.crb & 0x80) {
      this.alarm[index] = v;
    } else {
      this.tod[index] = v;
      if (index === 3) {
        this.todHalted = true;
      } else if (index === 0) {
        this.todHalted = false;
        this.todDivider = 0;
      }
    }
    this.checkAlarm();
  }

  read(register) {
    switch (register & 0x0f) {
      case 0x0: {
        const driven = this.getPortAPins();
        return this.portAIn ? this.portAIn(driven) & 0xff : driven;
      }
      case 0x1: {
        const driven = this.getPortBPins();
        return this.portBIn ? this.portBIn(driven) & 0xff : driven;
      }
      case 0x2: return this.ddra;
      case 0x3: return this.ddrb;
      case 0x4: return this.ta & 0xff;
      case 0x5: return this.ta >> 8;
      case 0x6: return this.tb & 0xff;
      case 0x7: return this.tb >> 8;
      case 0x8: return this.readTod(0);
      case 0x9: return this.readTod(1);
      case 0xa: return this.readTod(2);
      case 0xb: return this.readTod(3);
      case 0xc: return this.sdr;
      case 0xd: {
        const value = this.icr;
        this.icr = 0;
        this.irqPending = false;
        this.setIrqLine(false);
        return value;
      }
      case 0xe: return this.cra;
      default: return this.crb;
    }
  }

  peek(register) {
    switch (register & 0x0f) {
      case 0x0: return this.portAIn ? this.portAIn(this.getPortAPins()) & 0xff : this.getPortAPins();
      case 0x1: return this.portBIn ? this.portBIn(this.getPortBPins()) & 0xff : this.getPortBPins();
      case 0x8: return this.todLatched ? this.todLatch[0] : this.tod[0];
      case 0x9: return this.todLatched ? this.todLatch[1] : this.tod[1];
      case 0xa: return this.todLatched ? this.todLatch[2] : this.tod[2];
      case 0xb: return this.todLatched ? this.todLatch[3] : this.tod[3];
      case 0xd: return this.icr;
      default: return this.readRegisterValue(register);
    }
  }

  readRegisterValue(register) {
    switch (register & 0x0f) {
      case 0x2: return this.ddra;
      case 0x3: return this.ddrb;
      case 0x4: return this.ta & 0xff;
      case 0x5: return this.ta >> 8;
      case 0x6: return this.tb & 0xff;
      case 0x7: return this.tb >> 8;
      case 0xc: return this.sdr;
      case 0xe: return this.cra;
      case 0xf: return this.crb;
      default: return 0xff;
    }
  }

  write(register, value) {
    const v = value & 0xff;
    switch (register & 0x0f) {
      case 0x0:
        this.pra = v;
        this.notifyPorts();
        return;
      case 0x1:
        this.prb = v;
        this.notifyPorts();
        return;
      case 0x2:
        this.ddra = v;
        this.notifyPorts();
        return;
      case 0x3:
        this.ddrb = v;
        this.notifyPorts();
        return;
      case 0x4:
        this.latchA = (this.latchA & 0xff00) | v;
        return;
      case 0x5:
        this.latchA = (this.latchA & 0x00ff) | (v << 8);
        if (this.taState === STOP) {
          this.ta = this.latchA;
        }
        return;
      case 0x6:
        this.latchB = (this.latchB & 0xff00) | v;
        return;
      case 0x7:
        this.latchB = (this.latchB & 0x00ff) | (v << 8);
        if (this.tbState === STOP) {
          this.tb = this.latchB;
        }
        return;
      case 0x8: this.writeTod(0, v); return;
      case 0x9: this.writeTod(1, v); return;
      case 0xa: this.writeTod(2, v); return;
      case 0xb: this.writeTod(3, v); return;
      case 0xc:
        this.sdr = v;
        if (this.cra & 0x40) {
          if (this.srBits === 0) {
            this.srOutputPending = true;
          } else {
            this.srOutputPending = true;
          }
        }
        return;
      case 0xd:
        if (v & 0x80) {
          this.mask |= v & 0x1f;
        } else {
          this.mask &= ~v & 0x1f;
        }
        if (this.icr & this.mask & 0x1f && !(this.icr & 0x80)) {
          if (this.model === '6526A' || this.model === '8521') {
            this.triggerIrq();
          } else {
            this.irqPending = true;
          }
        }
        return;
      case 0xe:
        if ((v & 1) && !(this.cra & 1)) {
          this.taToggle = true;
        }
        if ((v & 0x40) !== (this.cra & 0x40)) {
          this.srBits = 0;
          this.srOutputPending = false;
          this.cnt = true;
        }
        this.newCra = v;
        this.hasNewCra = true;
        this.cra = (this.cra & 0x01) | (v & 0xee);
        this.notifyPorts();
        return;
      default:
        if ((v & 1) && !(this.crb & 1)) {
          this.tbToggle = true;
        }
        this.newCrb = v;
        this.hasNewCrb = true;
        this.crb = (this.crb & 0x01) | (v & 0xee);
        this.notifyPorts();
    }
  }

  getState() {
    return {
      ta: this.ta,
      tb: this.tb,
      latchA: this.latchA,
      latchB: this.latchB,
      cra: this.cra,
      crb: this.crb,
      icr: this.icr,
      mask: this.mask,
      taState: this.taState,
      tbState: this.tbState,
      tod: this.tod.slice(),
      alarm: this.alarm.slice(),
      irq: this.irqActive
    };
  }
}
