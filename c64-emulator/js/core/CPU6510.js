import { OPCODES, MODES } from './OpcodeTable.js';

const T_IMPL = 0;
const T_IMM = 1;
const T_ZP_R = 2;
const T_ZP_W = 3;
const T_ZP_M = 4;
const T_ZPI_R = 5;
const T_ZPI_W = 6;
const T_ZPI_M = 7;
const T_ABS_R = 8;
const T_ABS_W = 9;
const T_ABS_M = 10;
const T_ABI_R = 11;
const T_ABI_W = 12;
const T_ABI_M = 13;
const T_IZX_R = 14;
const T_IZX_W = 15;
const T_IZX_M = 16;
const T_IZY_R = 17;
const T_IZY_W = 18;
const T_IZY_M = 19;
const T_BRANCH = 20;
const T_JMP_ABS = 21;
const T_JMP_IND = 22;
const T_JSR = 23;
const T_RTS = 24;
const T_RTI = 25;
const T_BRK = 26;
const T_PUSH = 27;
const T_PULL = 28;
const T_INT = 29;
const T_RESET = 30;
const T_JAM = 31;

const WRITE_MASK = new Uint16Array(32);
WRITE_MASK[T_ZP_W] = 1 << 2;
WRITE_MASK[T_ZP_M] = (1 << 3) | (1 << 4);
WRITE_MASK[T_ZPI_W] = 1 << 3;
WRITE_MASK[T_ZPI_M] = (1 << 4) | (1 << 5);
WRITE_MASK[T_ABS_W] = 1 << 3;
WRITE_MASK[T_ABS_M] = (1 << 4) | (1 << 5);
WRITE_MASK[T_ABI_W] = 1 << 4;
WRITE_MASK[T_ABI_M] = (1 << 5) | (1 << 6);
WRITE_MASK[T_IZX_W] = 1 << 5;
WRITE_MASK[T_IZX_M] = (1 << 6) | (1 << 7);
WRITE_MASK[T_IZY_W] = 1 << 5;
WRITE_MASK[T_IZY_M] = (1 << 6) | (1 << 7);
WRITE_MASK[T_JSR] = (1 << 3) | (1 << 4);
WRITE_MASK[T_BRK] = (1 << 2) | (1 << 3) | (1 << 4);
WRITE_MASK[T_INT] = (1 << 2) | (1 << 3) | (1 << 4);
WRITE_MASK[T_PUSH] = 1 << 2;

const MNEMONIC_IDS = [
  'ADC', 'ALR', 'ANC', 'AND', 'ANE', 'ARR', 'ASL', 'BCC', 'BCS', 'BEQ', 'BIT', 'BMI', 'BNE',
  'BPL', 'BRK', 'BVC', 'BVS', 'CLC', 'CLD', 'CLI', 'CLV', 'CMP', 'CPX', 'CPY', 'DCP', 'DEC',
  'DEX', 'DEY', 'EOR', 'INC', 'INX', 'INY', 'ISC', 'JAM', 'JMP', 'JSR', 'LAS', 'LAX', 'LDA',
  'LDX', 'LDY', 'LSR', 'LXA', 'NOP', 'ORA', 'PHA', 'PHP', 'PLA', 'PLP', 'RLA', 'ROL', 'ROR',
  'RRA', 'RTI', 'RTS', 'SAX', 'SBC', 'SBX', 'SEC', 'SED', 'SEI', 'SHA', 'SHX', 'SHY', 'SLO',
  'SRE', 'STA', 'STX', 'STY', 'TAS', 'TAX', 'TAY', 'TSX', 'TXA', 'TXS', 'TYA'
];

const O = Object.fromEntries(MNEMONIC_IDS.map((name, index) => [name, index]));

const TEMPLATE = new Uint8Array(256);
const OPERATION = new Uint8Array(256);
const USE_Y = new Uint8Array(256);

function templateFor(entry) {
  const { mnemonic, mode, kind } = entry;
  if (kind === 'jam') {
    return T_JAM;
  }
  if (kind === 'branch') {
    return T_BRANCH;
  }
  if (kind === 'special') {
    switch (mnemonic) {
      case 'BRK': return T_BRK;
      case 'JSR': return T_JSR;
      case 'RTS': return T_RTS;
      case 'RTI': return T_RTI;
      case 'JMP': return mode === MODES.IND ? T_JMP_IND : T_JMP_ABS;
      case 'PHA':
      case 'PHP': return T_PUSH;
      default: return T_PULL;
    }
  }
  if (kind === 'impl') {
    return T_IMPL;
  }
  const offset = kind === 'read' ? 0 : kind === 'write' ? 1 : 2;
  switch (mode) {
    case MODES.IMM: return T_IMM;
    case MODES.ZP: return T_ZP_R + offset;
    case MODES.ZPX:
    case MODES.ZPY: return T_ZPI_R + offset;
    case MODES.ABS: return T_ABS_R + offset;
    case MODES.ABX:
    case MODES.ABY: return T_ABI_R + offset;
    case MODES.IZX: return T_IZX_R + offset;
    case MODES.IZY: return T_IZY_R + offset;
    default: throw new Error(`Keine Vorlage für ${mnemonic}`);
  }
}

for (let op = 0; op < 256; op++) {
  const entry = OPCODES[op];
  TEMPLATE[op] = templateFor(entry);
  OPERATION[op] = O[entry.mnemonic];
  USE_Y[op] = entry.mode === MODES.ZPY || entry.mode === MODES.ABY ? 1 : 0;
}

export const CPU_TEMPLATES = Object.freeze({ T_INT, T_RESET, T_JAM });

export class CPU6502 {
  constructor(bus) {
    this.bus = bus;
    this.aneMagic = 0xee;
    this.lxaMagic = 0xee;
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.s = 0;
    this.pc = 0;
    this.flagN = 0;
    this.flagV = 0;
    this.flagD = 0;
    this.flagI = 1;
    this.flagZ = 0;
    this.flagC = 0;
    this.ir = 0;
    this.t = 0;
    this.template = T_IMPL;
    this.op = 0;
    this.useY = 0;
    this.ad = 0;
    this.ptr = 0;
    this.dat = 0;
    this.baseHi = 0;
    this.crossed = false;
    this.rdy = true;
    this.irqLine = false;
    this.nmiLine = false;
    this.nmiLast = false;
    this.nmiFlag = false;
    this.nmiRun = false;
    this.nmiPrevRun = false;
    this.irqRun = false;
    this.irqPrevRun = false;
    this.intPending = false;
    this.resetPending = true;
    this.branchQuirk = false;
    this.jammed = false;
    this.stalled = false;
    this.curStepStalled = false;
    this.stepStalled = false;
    this.lastStepStalled = false;
    this.instructionStart = false;
    this.totalCycles = 0;
    this.lastOpcodeAddress = 0;
    this.onInstruction = null;
  }

  reset() {
    this.resetPending = true;
    this.t = 0;
    this.jammed = false;
    this.intPending = false;
    this.nmiFlag = false;
    this.nmiRun = false;
    this.nmiPrevRun = false;
    this.branchQuirk = false;
  }

  powerOn() {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.s = 0;
    this.setP(0x24);
    this.reset();
  }

  getP() {
    return (this.flagN << 7) | (this.flagV << 6) | 0x20 | (this.flagD << 3) | (this.flagI << 2) | (this.flagZ << 1) | this.flagC;
  }

  setP(value) {
    this.flagN = (value >> 7) & 1;
    this.flagV = (value >> 6) & 1;
    this.flagD = (value >> 3) & 1;
    this.flagI = (value >> 2) & 1;
    this.flagZ = (value >> 1) & 1;
    this.flagC = value & 1;
  }

  setRegisters({ a, x, y, s, pc, p }) {
    if (a !== undefined) this.a = a & 0xff;
    if (x !== undefined) this.x = x & 0xff;
    if (y !== undefined) this.y = y & 0xff;
    if (s !== undefined) this.s = s & 0xff;
    if (pc !== undefined) this.pc = pc & 0xffff;
    if (p !== undefined) this.setP(p);
    this.t = 0;
    this.resetPending = false;
    this.intPending = false;
    this.jammed = false;
  }

  isWriteCycle() {
    return this.t !== 0 && (WRITE_MASK[this.template] & (1 << this.t)) !== 0;
  }

  isInstructionBoundary() {
    return this.t === 0;
  }

  read(address) {
    return this.bus.read(address);
  }

  write(address, value) {
    this.bus.write(address, value);
  }

  cycle() {
    this.totalCycles++;
    if (!this.rdy && (this.t === 0 || (WRITE_MASK[this.template] & (1 << this.t)) === 0)) {
      this.stalled = true;
      this.curStepStalled = true;
      this.instructionStart = false;
      this.sampleInterrupts();
      return;
    }
    this.stalled = false;
    this.lastStepStalled = this.stepStalled;
    this.stepStalled = this.curStepStalled;
    this.curStepStalled = false;
    if (this.t === 0) {
      this.fetch();
    } else {
      this.execute();
    }
    this.sampleInterrupts();
    if (this.t === 0) {
      if (this.template === T_INT || this.template === T_RESET) {
        this.intPending = false;
      } else {
        this.intPending = this.nmiPrevRun || this.irqPrevRun;
      }
      if (this.onInstruction !== null) {
        this.onInstruction(this.pc);
      }
    }
  }

  sampleInterrupts() {
    if (this.nmiLine && !this.nmiLast) {
      this.nmiFlag = true;
    }
    this.nmiLast = this.nmiLine;
    this.nmiPrevRun = this.nmiRun;
    this.nmiRun = this.nmiFlag;
    this.irqPrevRun = this.irqRun;
    this.irqRun = this.irqLine && this.flagI === 0;
    if (this.branchQuirk) {
      this.branchQuirk = false;
      if (this.irqRun && !this.irqPrevRun) {
        this.irqRun = false;
      }
      if (this.nmiRun && !this.nmiPrevRun) {
        this.nmiRun = false;
      }
    }
  }

  fetch() {
    if (this.jammed) {
      this.read(0xffff);
      this.instructionStart = false;
      return;
    }
    this.instructionStart = true;
    this.lastOpcodeAddress = this.pc;
    if (this.resetPending) {
      this.read(this.pc);
      this.resetPending = false;
      this.ir = 0;
      this.template = T_RESET;
      this.t = 1;
      return;
    }
    if (this.intPending) {
      this.read(this.pc);
      this.ir = 0;
      this.template = T_INT;
      this.t = 1;
      return;
    }
    const opcode = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    this.ir = opcode;
    this.template = TEMPLATE[opcode];
    this.op = OPERATION[opcode];
    this.useY = USE_Y[opcode];
    this.t = 1;
  }

  fetchPcByte() {
    const value = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return value;
  }

  finish() {
    this.t = 0;
  }

  execute() {
    const t = this.t;
    switch (this.template) {
      case T_IMPL:
        this.read(this.pc);
        this.execImplied(this.op);
        this.t = 0;
        return;
      case T_IMM:
        this.execRead(this.op, this.fetchPcByte());
        this.t = 0;
        return;
      case T_ZP_R:
        if (t === 1) {
          this.ad = this.fetchPcByte();
          this.t = 2;
        } else {
          this.execRead(this.op, this.read(this.ad));
          this.t = 0;
        }
        return;
      case T_ZP_W:
        if (t === 1) {
          this.ad = this.fetchPcByte();
          this.t = 2;
        } else {
          this.write(this.ad, this.storeValue(this.op));
          this.t = 0;
        }
        return;
      case T_ZP_M:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.dat = this.read(this.ad); this.t = 3; return;
          case 3: this.write(this.ad, this.dat); this.dat = this.execRmw(this.op, this.dat); this.t = 4; return;
          default: this.write(this.ad, this.dat); this.t = 0; return;
        }
      case T_ZPI_R:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.read(this.ad); this.ad = (this.ad + (this.useY ? this.y : this.x)) & 0xff; this.t = 3; return;
          default: this.execRead(this.op, this.read(this.ad)); this.t = 0; return;
        }
      case T_ZPI_W:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.read(this.ad); this.ad = (this.ad + (this.useY ? this.y : this.x)) & 0xff; this.t = 3; return;
          default: this.write(this.ad, this.storeValue(this.op)); this.t = 0; return;
        }
      case T_ZPI_M:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.read(this.ad); this.ad = (this.ad + this.x) & 0xff; this.t = 3; return;
          case 3: this.dat = this.read(this.ad); this.t = 4; return;
          case 4: this.write(this.ad, this.dat); this.dat = this.execRmw(this.op, this.dat); this.t = 5; return;
          default: this.write(this.ad, this.dat); this.t = 0; return;
        }
      case T_ABS_R:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.ad |= this.fetchPcByte() << 8; this.t = 3; return;
          default: this.execRead(this.op, this.read(this.ad)); this.t = 0; return;
        }
      case T_ABS_W:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.ad |= this.fetchPcByte() << 8; this.t = 3; return;
          default: this.write(this.ad, this.storeValue(this.op)); this.t = 0; return;
        }
      case T_ABS_M:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.ad |= this.fetchPcByte() << 8; this.t = 3; return;
          case 3: this.dat = this.read(this.ad); this.t = 4; return;
          case 4: this.write(this.ad, this.dat); this.dat = this.execRmw(this.op, this.dat); this.t = 5; return;
          default: this.write(this.ad, this.dat); this.t = 0; return;
        }
      case T_ABI_R:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.indexAbsolute(); this.t = 3; return;
          case 3: {
            const value = this.read(this.ad);
            if (this.crossed) {
              this.ad = (this.ad + 0x100) & 0xffff;
              this.t = 4;
            } else {
              this.execRead(this.op, value);
              this.t = 0;
            }
            return;
          }
          default: this.execRead(this.op, this.read(this.ad)); this.t = 0; return;
        }
      case T_ABI_W:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.indexAbsolute(); this.t = 3; return;
          case 3:
            this.read(this.ad);
            if (this.crossed) {
              this.ad = (this.ad + 0x100) & 0xffff;
            }
            this.t = 4;
            return;
          default: this.indexedStore(); this.t = 0; return;
        }
      case T_ABI_M:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.indexAbsolute(); this.t = 3; return;
          case 3:
            this.read(this.ad);
            if (this.crossed) {
              this.ad = (this.ad + 0x100) & 0xffff;
            }
            this.t = 4;
            return;
          case 4: this.dat = this.read(this.ad); this.t = 5; return;
          case 5: this.write(this.ad, this.dat); this.dat = this.execRmw(this.op, this.dat); this.t = 6; return;
          default: this.write(this.ad, this.dat); this.t = 0; return;
        }
      case T_IZX_R:
      case T_IZX_W:
      case T_IZX_M:
        switch (t) {
          case 1: this.ptr = this.fetchPcByte(); this.t = 2; return;
          case 2: this.read(this.ptr); this.ptr = (this.ptr + this.x) & 0xff; this.t = 3; return;
          case 3: this.ad = this.read(this.ptr); this.t = 4; return;
          case 4: this.ad |= this.read((this.ptr + 1) & 0xff) << 8; this.t = 5; return;
          case 5:
            if (this.template === T_IZX_R) {
              this.execRead(this.op, this.read(this.ad));
              this.t = 0;
            } else if (this.template === T_IZX_W) {
              this.write(this.ad, this.storeValue(this.op));
              this.t = 0;
            } else {
              this.dat = this.read(this.ad);
              this.t = 6;
            }
            return;
          case 6: this.write(this.ad, this.dat); this.dat = this.execRmw(this.op, this.dat); this.t = 7; return;
          default: this.write(this.ad, this.dat); this.t = 0; return;
        }
      case T_IZY_R:
        switch (t) {
          case 1: this.ptr = this.fetchPcByte(); this.t = 2; return;
          case 2: this.ad = this.read(this.ptr); this.t = 3; return;
          case 3: this.indexIndirect(); this.t = 4; return;
          case 4: {
            const value = this.read(this.ad);
            if (this.crossed) {
              this.ad = (this.ad + 0x100) & 0xffff;
              this.t = 5;
            } else {
              this.execRead(this.op, value);
              this.t = 0;
            }
            return;
          }
          default: this.execRead(this.op, this.read(this.ad)); this.t = 0; return;
        }
      case T_IZY_W:
        switch (t) {
          case 1: this.ptr = this.fetchPcByte(); this.t = 2; return;
          case 2: this.ad = this.read(this.ptr); this.t = 3; return;
          case 3: this.indexIndirect(); this.t = 4; return;
          case 4:
            this.read(this.ad);
            if (this.crossed) {
              this.ad = (this.ad + 0x100) & 0xffff;
            }
            this.t = 5;
            return;
          default: this.indexedStore(); this.t = 0; return;
        }
      case T_IZY_M:
        switch (t) {
          case 1: this.ptr = this.fetchPcByte(); this.t = 2; return;
          case 2: this.ad = this.read(this.ptr); this.t = 3; return;
          case 3: this.indexIndirect(); this.t = 4; return;
          case 4:
            this.read(this.ad);
            if (this.crossed) {
              this.ad = (this.ad + 0x100) & 0xffff;
            }
            this.t = 5;
            return;
          case 5: this.dat = this.read(this.ad); this.t = 6; return;
          case 6: this.write(this.ad, this.dat); this.dat = this.execRmw(this.op, this.dat); this.t = 7; return;
          default: this.write(this.ad, this.dat); this.t = 0; return;
        }
      case T_BRANCH:
        switch (t) {
          case 1:
            this.dat = this.fetchPcByte();
            if (this.branchCondition(this.op)) {
              this.branchQuirk = true;
              this.t = 2;
            } else {
              this.t = 0;
            }
            return;
          case 2: {
            this.read(this.pc);
            const target = (this.pc + (this.dat & 0x80 ? this.dat - 256 : this.dat)) & 0xffff;
            if (((target ^ this.pc) & 0xff00) === 0) {
              this.pc = target;
              this.t = 0;
            } else {
              this.pc = (this.pc & 0xff00) | (target & 0xff);
              this.ad = target;
              this.t = 3;
            }
            return;
          }
          default:
            this.read(this.pc);
            this.pc = this.ad;
            this.t = 0;
            return;
        }
      case T_JMP_ABS:
        if (t === 1) {
          this.dat = this.fetchPcByte();
          this.t = 2;
        } else {
          this.pc = (this.read(this.pc) << 8) | this.dat;
          this.t = 0;
        }
        return;
      case T_JMP_IND:
        switch (t) {
          case 1: this.ad = this.fetchPcByte(); this.t = 2; return;
          case 2: this.ad |= this.fetchPcByte() << 8; this.t = 3; return;
          case 3: this.dat = this.read(this.ad); this.t = 4; return;
          default:
            this.pc = (this.read((this.ad & 0xff00) | ((this.ad + 1) & 0xff)) << 8) | this.dat;
            this.t = 0;
            return;
        }
      case T_JSR:
        switch (t) {
          case 1: this.dat = this.fetchPcByte(); this.t = 2; return;
          case 2: this.read(0x100 | this.s); this.t = 3; return;
          case 3: this.write(0x100 | this.s, this.pc >> 8); this.s = (this.s - 1) & 0xff; this.t = 4; return;
          case 4: this.write(0x100 | this.s, this.pc & 0xff); this.s = (this.s - 1) & 0xff; this.t = 5; return;
          default:
            this.pc = (this.read(this.pc) << 8) | this.dat;
            this.t = 0;
            return;
        }
      case T_RTS:
        switch (t) {
          case 1: this.read(this.pc); this.t = 2; return;
          case 2: this.read(0x100 | this.s); this.s = (this.s + 1) & 0xff; this.t = 3; return;
          case 3: this.dat = this.read(0x100 | this.s); this.s = (this.s + 1) & 0xff; this.t = 4; return;
          case 4: this.pc = (this.read(0x100 | this.s) << 8) | this.dat; this.t = 5; return;
          default:
            this.read(this.pc);
            this.pc = (this.pc + 1) & 0xffff;
            this.t = 0;
            return;
        }
      case T_RTI:
        switch (t) {
          case 1: this.read(this.pc); this.t = 2; return;
          case 2: this.read(0x100 | this.s); this.s = (this.s + 1) & 0xff; this.t = 3; return;
          case 3: this.setP(this.read(0x100 | this.s)); this.s = (this.s + 1) & 0xff; this.t = 4; return;
          case 4: this.dat = this.read(0x100 | this.s); this.s = (this.s + 1) & 0xff; this.t = 5; return;
          default:
            this.pc = (this.read(0x100 | this.s) << 8) | this.dat;
            this.t = 0;
            return;
        }
      case T_BRK:
      case T_INT:
      case T_RESET:
        this.interruptSequence(t);
        return;
      case T_PUSH:
        if (t === 1) {
          this.read(this.pc);
          this.t = 2;
        } else {
          this.write(0x100 | this.s, this.op === O.PHA ? this.a : this.getP() | 0x10);
          this.s = (this.s - 1) & 0xff;
          this.t = 0;
        }
        return;
      case T_PULL:
        switch (t) {
          case 1: this.read(this.pc); this.t = 2; return;
          case 2: this.read(0x100 | this.s); this.s = (this.s + 1) & 0xff; this.t = 3; return;
          default: {
            const value = this.read(0x100 | this.s);
            if (this.op === O.PLA) {
              this.a = value;
              this.setNZ(value);
            } else {
              this.setP(value);
            }
            this.t = 0;
            return;
          }
        }
      case T_JAM:
        switch (t) {
          case 1: this.read(this.pc); this.t = 2; return;
          case 2: this.read(0xffff); this.t = 3; return;
          case 3: this.read(0xfffe); this.t = 4; return;
          case 4: this.read(0xfffe); this.t = 5; return;
          default:
            this.read(0xffff);
            this.jammed = true;
            this.t = 0;
            return;
        }
      default:
        throw new Error(`Unbekannte Vorlage ${this.template}`);
    }
  }

  interruptSequence(t) {
    const isReset = this.template === T_RESET;
    switch (t) {
      case 1:
        this.read(this.pc);
        if (this.template === T_BRK) {
          this.pc = (this.pc + 1) & 0xffff;
        }
        this.t = 2;
        return;
      case 2:
        if (isReset) {
          this.read(0x100 | this.s);
        } else {
          this.write(0x100 | this.s, this.pc >> 8);
        }
        this.s = (this.s - 1) & 0xff;
        this.t = 3;
        return;
      case 3:
        if (isReset) {
          this.read(0x100 | this.s);
        } else {
          this.write(0x100 | this.s, this.pc & 0xff);
        }
        this.s = (this.s - 1) & 0xff;
        this.t = 4;
        return;
      case 4:
        if (isReset) {
          this.read(0x100 | this.s);
        } else {
          const p = this.template === T_BRK ? this.getP() | 0x10 : this.getP() & 0xef;
          this.write(0x100 | this.s, p);
        }
        this.s = (this.s - 1) & 0xff;
        this.t = 5;
        return;
      case 5:
        if (isReset) {
          this.ad = 0xfffc;
        } else if (this.nmiRun) {
          this.ad = 0xfffa;
          this.nmiFlag = false;
          this.nmiRun = false;
          this.nmiPrevRun = false;
        } else {
          this.ad = 0xfffe;
        }
        this.dat = this.read(this.ad);
        this.flagI = 1;
        this.t = 6;
        return;
      default:
        this.pc = (this.read(this.ad + 1) << 8) | this.dat;
        this.t = 0;
        return;
    }
  }

  indexAbsolute() {
    const hi = this.fetchPcByte();
    const index = this.useY ? this.y : this.x;
    const lo = this.ad + index;
    this.baseHi = hi;
    this.crossed = lo > 0xff;
    this.ad = (hi << 8) | (lo & 0xff);
  }

  indexIndirect() {
    const hi = this.read((this.ptr + 1) & 0xff);
    const lo = this.ad + this.y;
    this.baseHi = hi;
    this.crossed = lo > 0xff;
    this.ad = (hi << 8) | (lo & 0xff);
  }

  indexedStore() {
    const op = this.op;
    if (op === O.SHA || op === O.SHX || op === O.SHY || op === O.TAS) {
      let source;
      if (op === O.SHA) {
        source = this.a & this.x;
      } else if (op === O.SHX) {
        source = this.x;
      } else if (op === O.SHY) {
        source = this.y;
      } else {
        this.s = this.a & this.x;
        source = this.s;
      }
      const value = this.lastStepStalled ? source : source & ((this.baseHi + 1) & 0xff);
      if (this.crossed) {
        this.ad = (value << 8) | (this.ad & 0xff);
      }
      this.write(this.ad, value);
      return;
    }
    this.write(this.ad, this.storeValue(op));
  }

  storeValue(op) {
    switch (op) {
      case O.STA: return this.a;
      case O.STX: return this.x;
      case O.STY: return this.y;
      case O.SAX: return this.a & this.x;
      default: return this.a;
    }
  }

  setNZ(value) {
    this.flagN = value >> 7;
    this.flagZ = value === 0 ? 1 : 0;
  }

  branchCondition(op) {
    switch (op) {
      case O.BPL: return this.flagN === 0;
      case O.BMI: return this.flagN === 1;
      case O.BVC: return this.flagV === 0;
      case O.BVS: return this.flagV === 1;
      case O.BCC: return this.flagC === 0;
      case O.BCS: return this.flagC === 1;
      case O.BNE: return this.flagZ === 0;
      default: return this.flagZ === 1;
    }
  }

  adc(value) {
    if (this.flagD) {
      const a = this.a;
      const c = this.flagC;
      let lo = (a & 0x0f) + (value & 0x0f) + c;
      if (lo > 9) {
        lo += 6;
      }
      let hi = (a >> 4) + (value >> 4) + (lo > 0x0f ? 1 : 0);
      this.flagZ = ((a + value + c) & 0xff) === 0 ? 1 : 0;
      this.flagN = (hi >> 3) & 1;
      this.flagV = (~(a ^ value) & (a ^ (hi << 4)) & 0x80) !== 0 ? 1 : 0;
      if (hi > 9) {
        hi += 6;
      }
      this.flagC = hi > 0x0f ? 1 : 0;
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
      return;
    }
    const sum = this.a + value + this.flagC;
    this.flagV = (~(this.a ^ value) & (this.a ^ sum) & 0x80) !== 0 ? 1 : 0;
    this.flagC = sum > 0xff ? 1 : 0;
    this.a = sum & 0xff;
    this.setNZ(this.a);
  }

  sbc(value) {
    const a = this.a;
    const borrow = 1 - this.flagC;
    const diff = a - value - borrow;
    this.flagV = ((a ^ value) & (a ^ diff) & 0x80) !== 0 ? 1 : 0;
    this.flagC = diff >= 0 ? 1 : 0;
    this.setNZ(diff & 0xff);
    if (this.flagD) {
      let lo = (a & 0x0f) - (value & 0x0f) - borrow;
      let hi = (a >> 4) - (value >> 4);
      if (lo & 0x10) {
        lo -= 6;
        hi -= 1;
      }
      if (hi & 0x10) {
        hi -= 6;
      }
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
    } else {
      this.a = diff & 0xff;
    }
  }

  compare(register, value) {
    const diff = register - value;
    this.flagC = diff >= 0 ? 1 : 0;
    this.setNZ(diff & 0xff);
  }

  arr(value) {
    const tmp = this.a & value;
    const c = this.flagC;
    if (this.flagD) {
      let result = (tmp >> 1) | (c << 7);
      this.flagN = c;
      this.flagZ = result === 0 ? 1 : 0;
      this.flagV = ((result ^ tmp) & 0x40) !== 0 ? 1 : 0;
      if ((tmp & 0x0f) + (tmp & 0x01) > 5) {
        result = (result & 0xf0) | ((result + 6) & 0x0f);
      }
      if ((tmp & 0xf0) + (tmp & 0x10) > 0x50) {
        result = (result + 0x60) & 0xff;
        this.flagC = 1;
      } else {
        this.flagC = 0;
      }
      this.a = result;
      return;
    }
    const result = (tmp >> 1) | (c << 7);
    this.a = result;
    this.setNZ(result);
    this.flagC = (result >> 6) & 1;
    this.flagV = ((result >> 6) ^ (result >> 5)) & 1;
  }

  execRead(op, value) {
    switch (op) {
      case O.LDA: this.a = value; this.setNZ(value); return;
      case O.LDX: this.x = value; this.setNZ(value); return;
      case O.LDY: this.y = value; this.setNZ(value); return;
      case O.EOR: this.a ^= value; this.setNZ(this.a); return;
      case O.AND: this.a &= value; this.setNZ(this.a); return;
      case O.ORA: this.a |= value; this.setNZ(this.a); return;
      case O.ADC: this.adc(value); return;
      case O.SBC: this.sbc(value); return;
      case O.CMP: this.compare(this.a, value); return;
      case O.CPX: this.compare(this.x, value); return;
      case O.CPY: this.compare(this.y, value); return;
      case O.BIT:
        this.flagZ = (this.a & value) === 0 ? 1 : 0;
        this.flagN = value >> 7;
        this.flagV = (value >> 6) & 1;
        return;
      case O.LAX: this.a = value; this.x = value; this.setNZ(value); return;
      case O.NOP: return;
      case O.ANC: this.a &= value; this.setNZ(this.a); this.flagC = this.flagN; return;
      case O.ALR: {
        const tmp = this.a & value;
        this.flagC = tmp & 1;
        this.a = tmp >> 1;
        this.setNZ(this.a);
        return;
      }
      case O.ARR: this.arr(value); return;
      case O.SBX: {
        const diff = (this.a & this.x) - value;
        this.flagC = diff >= 0 ? 1 : 0;
        this.x = diff & 0xff;
        this.setNZ(this.x);
        return;
      }
      case O.ANE: this.a = (this.a | this.aneMagic) & this.x & value; this.setNZ(this.a); return;
      case O.LXA: this.a = (this.a | this.lxaMagic) & value; this.x = this.a; this.setNZ(this.a); return;
      case O.LAS: {
        const result = value & this.s;
        this.a = result;
        this.x = result;
        this.s = result;
        this.setNZ(result);
        return;
      }
      default:
        throw new Error(`Leseoperation ${MNEMONIC_IDS[op]} unbekannt`);
    }
  }

  execRmw(op, value) {
    let result;
    switch (op) {
      case O.ASL: this.flagC = value >> 7; result = (value << 1) & 0xff; this.setNZ(result); return result;
      case O.LSR: this.flagC = value & 1; result = value >> 1; this.setNZ(result); return result;
      case O.ROL: result = ((value << 1) | this.flagC) & 0xff; this.flagC = value >> 7; this.setNZ(result); return result;
      case O.ROR: result = (value >> 1) | (this.flagC << 7); this.flagC = value & 1; this.setNZ(result); return result;
      case O.INC: result = (value + 1) & 0xff; this.setNZ(result); return result;
      case O.DEC: result = (value - 1) & 0xff; this.setNZ(result); return result;
      case O.SLO: this.flagC = value >> 7; result = (value << 1) & 0xff; this.a |= result; this.setNZ(this.a); return result;
      case O.RLA: result = ((value << 1) | this.flagC) & 0xff; this.flagC = value >> 7; this.a &= result; this.setNZ(this.a); return result;
      case O.SRE: this.flagC = value & 1; result = value >> 1; this.a ^= result; this.setNZ(this.a); return result;
      case O.RRA: result = (value >> 1) | (this.flagC << 7); this.flagC = value & 1; this.adc(result); return result;
      case O.DCP: result = (value - 1) & 0xff; this.compare(this.a, result); return result;
      case O.ISC: result = (value + 1) & 0xff; this.sbc(result); return result;
      default:
        throw new Error(`RMW-Operation ${MNEMONIC_IDS[op]} unbekannt`);
    }
  }

  execImplied(op) {
    switch (op) {
      case O.ASL:
      case O.LSR:
      case O.ROL:
      case O.ROR: this.a = this.execRmw(op, this.a); return;
      case O.CLC: this.flagC = 0; return;
      case O.SEC: this.flagC = 1; return;
      case O.CLI: this.flagI = 0; return;
      case O.SEI: this.flagI = 1; return;
      case O.CLV: this.flagV = 0; return;
      case O.CLD: this.flagD = 0; return;
      case O.SED: this.flagD = 1; return;
      case O.TAX: this.x = this.a; this.setNZ(this.x); return;
      case O.TXA: this.a = this.x; this.setNZ(this.a); return;
      case O.TAY: this.y = this.a; this.setNZ(this.y); return;
      case O.TYA: this.a = this.y; this.setNZ(this.a); return;
      case O.TSX: this.x = this.s; this.setNZ(this.x); return;
      case O.TXS: this.s = this.x; return;
      case O.INX: this.x = (this.x + 1) & 0xff; this.setNZ(this.x); return;
      case O.INY: this.y = (this.y + 1) & 0xff; this.setNZ(this.y); return;
      case O.DEX: this.x = (this.x - 1) & 0xff; this.setNZ(this.x); return;
      case O.DEY: this.y = (this.y - 1) & 0xff; this.setNZ(this.y); return;
      case O.NOP: return;
      default:
        throw new Error(`Implizite Operation ${MNEMONIC_IDS[op]} unbekannt`);
    }
  }

  runInstruction() {
    let cycles = 0;
    do {
      this.cycle();
      cycles++;
    } while (this.t !== 0 && cycles < 64);
    return cycles;
  }

  snapshot() {
    return {
      a: this.a,
      x: this.x,
      y: this.y,
      s: this.s,
      pc: this.pc,
      p: this.getP(),
      t: this.t,
      ir: this.ir,
      jammed: this.jammed
    };
  }
}

export class ProcessorPortBus {
  constructor(bus, port) {
    this.bus = bus;
    this.port = port;
  }

  read(address) {
    if (address < 2) {
      this.bus.read(address);
      return this.port.read(address);
    }
    return this.bus.read(address);
  }

  write(address, value) {
    if (address < 2) {
      this.port.write(address, value);
      this.bus.write(address, this.bus.phi1Data);
      return;
    }
    this.bus.write(address, value);
  }
}

export class CPU6510 extends CPU6502 {
  constructor(bus, processorPort) {
    super(new ProcessorPortBus(bus, processorPort));
    this.memoryBus = bus;
    this.port = processorPort;
  }
}
