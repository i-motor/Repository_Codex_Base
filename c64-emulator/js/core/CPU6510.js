import { CPU6510Microcode, FLAG_C, FLAG_Z, FLAG_I, FLAG_D, FLAG_B, FLAG_U, FLAG_V, FLAG_N } from './CPU6510Microcode.js';

export class CPU6510 {
  constructor(interrupts = null) {
    this.interrupts = interrupts;
    this.microcode = new CPU6510Microcode(this);
    this.powerOn();
  }

  powerOn() {
    this.A = 0;
    this.X = 0;
    this.Y = 0;
    this.SP = 0;
    this.PC = 0;
    this.P = FLAG_U | FLAG_I;
    this.instructionsExecuted = 0;
    this.interruptsServiced = 0;
    this.lastOpcode = null;
    this.sequence = null;
    this.intent = null;
    this.sequenceKind = null;
    this.jammed = false;
    this.resetPending = true;
    this.irqLatched = false;
  }

  reset() {
    this.resetPending = true;
    this.jammed = false;
    this.sequence = null;
    this.intent = null;
    this.irqLatched = false;
  }

  setTestState(state = {}) {
    this.sequence = null;
    this.intent = null;
    this.resetPending = false;
    this.jammed = false;
    this.irqLatched = false;
    for (const name of ['A', 'X', 'Y', 'SP', 'PC', 'P']) {
      if (Object.hasOwn(state, name)) this[name] = state[name] & (name === 'PC' ? 0xffff : 0xff);
    }
    this.P = (this.P | FLAG_U) & ~FLAG_B;
  }

  nextBusCycle() {
    if (this.resetPending && this.sequenceKind !== 'reset') {
      this.sequence = null;
      this.intent = null;
    }
    if (this.intent !== null) return this.intent;
    if (this.jammed && !this.resetPending) return { kind: 'idle', address: this.PC, stage: 'jam' };
    if (!this.sequence) {
      if (this.resetPending) {
        this.resetPending = false;
        this.sequenceKind = 'reset';
        this.sequence = this.microcode.interrupt('reset');
      } else if (this.interrupts?.pendingNMI) {
        this.interrupts.consumeNMI();
        this.sequenceKind = 'nmi';
        this.sequence = this.microcode.interrupt('nmi');
      } else if (this.irqLatched) {
        this.sequenceKind = 'irq';
        this.sequence = this.microcode.interrupt('irq');
      } else {
        this.sequenceKind = 'instruction';
        this.sequence = this.microcode.fetch();
      }
      this.irqLatched = false;
    }
    const step = this.sequence.next();
    if (step.done) throw new Error('Leere CPU-Mikrozyklensequenz');
    this.intent = step.value;
    return this.intent;
  }

  completeBusCycle(result = {}) {
    if (!this.intent) return false;
    if (!result.advanceCPU) return false;
    const { kind } = this.intent;
    if (kind === 'read' && !Number.isInteger(result.value)) throw new TypeError('CPU-Lesezyklus ohne Busdaten');
    const irqOnLastCycle = !!this.interrupts?.isIRQActive() && !(this.P & FLAG_I);
    const value = kind === 'read' ? result.value & 0xff : undefined;
    const completed = this.sequence.next(value);
    this.intent = completed.done ? null : completed.value;
    if (completed.done) {
      const kindFinished = this.sequenceKind;
      if (kindFinished === 'instruction') {
        this.instructionsExecuted += 1;
        this.irqLatched = irqOnLastCycle;
      } else if (kindFinished !== 'reset') {
        this.interruptsServiced += 1;
      }
      this.sequence = null;
      this.sequenceKind = null;
    }
    return true;
  }

  setFlag(mask, enabled) {
    if (enabled) this.P |= mask;
    else this.P &= ~mask;
    this.P = (this.P | FLAG_U) & ~FLAG_B;
  }

  setNZ(value) {
    const byte = value & 0xff;
    this.setFlag(FLAG_Z, byte === 0);
    this.setFlag(FLAG_N, !!(byte & 0x80));
    return byte;
  }

  compare(a, b) {
    const result = (a - b) & 0xff;
    this.setFlag(FLAG_C, a >= b);
    this.setNZ(result);
  }

  adc(value) {
    const a = this.A;
    const carry = this.P & FLAG_C ? 1 : 0;
    const sum = a + value + carry;
    const binary = sum & 0xff;
    this.setFlag(FLAG_V, !!(~(a ^ value) & (a ^ binary) & 0x80));
    this.setNZ(binary);
    if (this.P & FLAG_D) {
      let low = (a & 0xf) + (value & 0xf) + carry;
      if (low > 9) low += 6;
      let high = (a >> 4) + (value >> 4) + (low > 0xf ? 1 : 0);
      if (high > 9) high += 6;
      this.setFlag(FLAG_C, high > 15);
      this.A = ((high << 4) | (low & 0xf)) & 0xff;
    } else {
      this.setFlag(FLAG_C, sum > 255);
      this.A = binary;
    }
  }

  sbc(value) {
    const a = this.A;
    const carry = this.P & FLAG_C ? 1 : 0;
    const sum = a + (value ^ 0xff) + carry;
    const binary = sum & 0xff;
    this.setFlag(FLAG_C, sum > 0xff);
    this.setFlag(FLAG_V, !!((a ^ binary) & (a ^ value) & 0x80));
    this.setNZ(binary);
    if (this.P & FLAG_D) {
      let low = (a & 0xf) - (value & 0xf) - (1 - carry);
      let high = (a >> 4) - (value >> 4);
      if (low < 0) {
        low -= 6;
        high -= 1;
      }
      if (high < 0) high -= 6;
      this.A = ((high << 4) | (low & 0xf)) & 0xff;
    } else this.A = binary;
  }

  applyRead(mnemonic, value) {
    const byte = value & 0xff;
    switch (mnemonic) {
      case 'NOP': break;
      case 'LDA': this.A = this.setNZ(byte); break;
      case 'LDX': this.X = this.setNZ(byte); break;
      case 'LDY': this.Y = this.setNZ(byte); break;
      case 'LAX': this.A = this.X = this.setNZ(byte); break;
      case 'ORA': this.A = this.setNZ(this.A | byte); break;
      case 'AND': this.A = this.setNZ(this.A & byte); break;
      case 'EOR': this.A = this.setNZ(this.A ^ byte); break;
      case 'ADC': this.adc(byte); break;
      case 'SBC': this.sbc(byte); break;
      case 'CMP': this.compare(this.A, byte); break;
      case 'CPX': this.compare(this.X, byte); break;
      case 'CPY': this.compare(this.Y, byte); break;
      case 'BIT':
        this.setFlag(FLAG_Z, !(this.A & byte));
        this.setFlag(FLAG_N, !!(byte & 0x80));
        this.setFlag(FLAG_V, !!(byte & 0x40));
        break;
      case 'ANC':
        this.A = this.setNZ(this.A & byte);
        this.setFlag(FLAG_C, !!(this.A & 0x80));
        break;
      case 'ALR':
        this.A &= byte;
        this.A = this.modify('LSR', this.A);
        break;
      case 'ARR': {
        const combined = this.A & byte;
        this.A = this.setNZ((combined >>> 1) | ((this.P & FLAG_C) << 7));
        this.setFlag(FLAG_C, !!(this.A & 0x40));
        this.setFlag(FLAG_V, !!((this.A ^ (this.A << 1)) & 0x40));
        break;
      }
      case 'AXS': {
        const aAndX = this.A & this.X;
        this.setFlag(FLAG_C, aAndX >= byte);
        this.X = this.setNZ((aAndX - byte) & 0xff);
        break;
      }
      case 'XAA': this.A = this.setNZ(this.X & byte); break;
      case 'LXA': this.A = this.X = this.setNZ((this.A | 0xee) & byte); break;
      case 'LAS': this.A = this.X = this.SP = this.setNZ(this.SP & byte); break;
      default: throw new Error(`Unbekannter Lese-Befehl ${mnemonic}`);
    }
  }

  storeValue(mnemonic, address) {
    const mask = (((address >> 8) + 1) & 0xff);
    switch (mnemonic) {
      case 'STA': return this.A;
      case 'STX': return this.X;
      case 'STY': return this.Y;
      case 'SAX': return this.A & this.X;
      case 'AHX': return this.A & this.X & mask;
      case 'SHX': return this.X & mask;
      case 'SHY': return this.Y & mask;
      case 'TAS': this.SP = this.A & this.X; return this.SP & mask;
      default: throw new Error(`Unbekannter Schreib-Befehl ${mnemonic}`);
    }
  }

  modify(mnemonic, original) {
    let value = original & 0xff;
    switch (mnemonic) {
      case 'ASL': case 'SLO':
        this.setFlag(FLAG_C, !!(value & 0x80));
        value = (value << 1) & 0xff;
        break;
      case 'LSR': case 'SRE':
        this.setFlag(FLAG_C, !!(value & 1));
        value >>>= 1;
        break;
      case 'ROL': case 'RLA': {
        const carry = this.P & FLAG_C;
        this.setFlag(FLAG_C, !!(value & 0x80));
        value = ((value << 1) | carry) & 0xff;
        break;
      }
      case 'ROR': case 'RRA': {
        const carry = this.P & FLAG_C;
        this.setFlag(FLAG_C, !!(value & 1));
        value = (value >>> 1) | (carry << 7);
        break;
      }
      case 'INC': case 'ISC': value = (value + 1) & 0xff; break;
      case 'DEC': case 'DCP': value = (value - 1) & 0xff; break;
      default: throw new Error(`Unbekannter RMW-Befehl ${mnemonic}`);
    }
    this.setNZ(value);
    switch (mnemonic) {
      case 'SLO': this.A = this.setNZ(this.A | value); break;
      case 'RLA': this.A = this.setNZ(this.A & value); break;
      case 'SRE': this.A = this.setNZ(this.A ^ value); break;
      case 'RRA': this.adc(value); break;
      case 'DCP': this.compare(this.A, value); break;
      case 'ISC': this.sbc(value); break;
    }
    return value;
  }

  implied(mnemonic) {
    switch (mnemonic) {
      case 'NOP': break;
      case 'CLC': this.setFlag(FLAG_C, false); break;
      case 'SEC': this.setFlag(FLAG_C, true); break;
      case 'CLI': this.setFlag(FLAG_I, false); break;
      case 'SEI': this.setFlag(FLAG_I, true); break;
      case 'CLD': this.setFlag(FLAG_D, false); break;
      case 'SED': this.setFlag(FLAG_D, true); break;
      case 'CLV': this.setFlag(FLAG_V, false); break;
      case 'TAX': this.X = this.setNZ(this.A); break;
      case 'TXA': this.A = this.setNZ(this.X); break;
      case 'TAY': this.Y = this.setNZ(this.A); break;
      case 'TYA': this.A = this.setNZ(this.Y); break;
      case 'TSX': this.X = this.setNZ(this.SP); break;
      case 'TXS': this.SP = this.X; break;
      case 'INX': this.X = this.setNZ(this.X + 1); break;
      case 'INY': this.Y = this.setNZ(this.Y + 1); break;
      case 'DEX': this.X = this.setNZ(this.X - 1); break;
      case 'DEY': this.Y = this.setNZ(this.Y - 1); break;
      default: throw new Error(`Unbekannter impliziter Befehl ${mnemonic}`);
    }
  }

  getState() {
    return {
      A: this.A, X: this.X, Y: this.Y, SP: this.SP, PC: this.PC, P: this.P,
      lastOpcode: this.lastOpcode, instructionCount: this.instructionsExecuted,
      interruptsServiced: this.interruptsServiced, sequence: this.sequenceKind,
      stage: this.intent?.stage ?? null, jammed: this.jammed, resetPending: this.resetPending
    };
  }

  snapshot() {
    return this.getState();
  }
}
