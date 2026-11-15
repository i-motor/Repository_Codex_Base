import { decode } from './CPU6510Opcodes.js';

export const FLAG_C = 0x01;
export const FLAG_Z = 0x02;
export const FLAG_I = 0x04;
export const FLAG_D = 0x08;
export const FLAG_B = 0x10;
export const FLAG_U = 0x20;
export const FLAG_V = 0x40;
export const FLAG_N = 0x80;

const READ_OPERATIONS = new Set('ADC AND BIT CMP CPX CPY EOR LDA LDX LDY ORA SBC LAX ANC ALR ARR AXS XAA LXA LAS NOP'.split(' '));
const WRITE_OPERATIONS = new Set('STA STX STY SAX AHX TAS SHX SHY'.split(' '));
const MODIFY_OPERATIONS = new Set('ASL LSR ROL ROR INC DEC SLO RLA SRE RRA DCP ISC'.split(' '));
const BRANCHES = new Set('BPL BMI BVC BVS BCC BCS BNE BEQ'.split(' '));

export class CPU6510Microcode {
  constructor(cpu) {
    this.cpu = cpu;
  }

  read(address, stage = 'read') {
    return { kind: 'read', address: address & 0xffff, stage };
  }

  write(address, value, stage = 'write') {
    return { kind: 'write', address: address & 0xffff, value: value & 0xff, stage };
  }

  *fetch() {
    const cpu = this.cpu;
    const opcode = yield this.read(cpu.PC, 'opcode');
    cpu.PC = (cpu.PC + 1) & 0xffff;
    cpu.lastOpcode = opcode;
    yield* this.execute(decode(opcode));
  }

  *fetchByte() {
    const value = yield this.read(this.cpu.PC, 'operand');
    this.cpu.PC = (this.cpu.PC + 1) & 0xffff;
    return value;
  }

  *push(value) {
    const cpu = this.cpu;
    yield this.write(0x100 | cpu.SP, value, 'stack-push');
    cpu.SP = (cpu.SP - 1) & 0xff;
  }

  *pull() {
    const cpu = this.cpu;
    cpu.SP = (cpu.SP + 1) & 0xff;
    return yield this.read(0x100 | cpu.SP, 'stack-pull');
  }

  *address(mode, writeLike = false) {
    const cpu = this.cpu;
    if (mode === 'zp' || mode === 'zpx' || mode === 'zpy') {
      const base = yield* this.fetchByte();
      if (mode === 'zp') return base;
      yield this.read(base, 'index-dummy');
      return (base + (mode === 'zpx' ? cpu.X : cpu.Y)) & 0xff;
    }
    if (mode === 'abs' || mode === 'absx' || mode === 'absy') {
      const lo = yield* this.fetchByte();
      const hi = yield* this.fetchByte();
      const base = (hi << 8) | lo;
      if (mode === 'abs') return base;
      const offset = mode === 'absx' ? cpu.X : cpu.Y;
      const sum = lo + offset;
      const wrapped = (base & 0xff00) | (sum & 0xff);
      const address = (base + offset) & 0xffff;
      if (writeLike || sum > 0xff) yield this.read(wrapped, 'index-dummy');
      return address;
    }
    if (mode === 'izx') {
      const base = yield* this.fetchByte();
      yield this.read(base, 'index-dummy');
      const pointer = (base + cpu.X) & 0xff;
      const lo = yield this.read(pointer, 'pointer-low');
      const hi = yield this.read((pointer + 1) & 0xff, 'pointer-high');
      return (hi << 8) | lo;
    }
    if (mode === 'izy') {
      const pointer = yield* this.fetchByte();
      const lo = yield this.read(pointer, 'pointer-low');
      const hi = yield this.read((pointer + 1) & 0xff, 'pointer-high');
      const base = (hi << 8) | lo;
      const sum = lo + cpu.Y;
      const wrapped = (base & 0xff00) | (sum & 0xff);
      const address = (base + cpu.Y) & 0xffff;
      if (writeLike || sum > 0xff) yield this.read(wrapped, 'index-dummy');
      return address;
    }
    throw new RangeError(`Unbekannte Speicheradressierungsart: ${mode}`);
  }

  *branch(mnemonic) {
    const cpu = this.cpu;
    const displacement = yield* this.fetchByte();
    const p = cpu.P;
    const take = mnemonic === 'BPL' ? !(p & FLAG_N)
      : mnemonic === 'BMI' ? !!(p & FLAG_N)
      : mnemonic === 'BVC' ? !(p & FLAG_V)
      : mnemonic === 'BVS' ? !!(p & FLAG_V)
      : mnemonic === 'BCC' ? !(p & FLAG_C)
      : mnemonic === 'BCS' ? !!(p & FLAG_C)
      : mnemonic === 'BNE' ? !(p & FLAG_Z) : !!(p & FLAG_Z);
    if (!take) return;
    const oldPC = cpu.PC;
    const target = (oldPC + (displacement < 0x80 ? displacement : displacement - 0x100)) & 0xffff;
    yield this.read(oldPC, 'branch-dummy');
    if ((oldPC & 0xff00) !== (target & 0xff00)) {
      yield this.read((oldPC & 0xff00) | (target & 0xff), 'branch-page-dummy');
    }
    cpu.PC = target;
  }

  *interrupt(kind) {
    const cpu = this.cpu;
    if (kind === 'reset') {
      cpu.P |= FLAG_I | FLAG_U;
      cpu.P &= ~FLAG_B;
      yield this.read(cpu.PC, 'reset-dummy-1');
      yield this.read(cpu.PC, 'reset-dummy-2');
      for (let index = 0; index < 3; index += 1) {
        yield this.read(0x100 | cpu.SP, 'reset-stack');
        cpu.SP = (cpu.SP - 1) & 0xff;
      }
      const lo = yield this.read(0xfffc, 'vector-low');
      const hi = yield this.read(0xfffd, 'vector-high');
      cpu.PC = (hi << 8) | lo;
      return;
    }
    yield this.read(cpu.PC, 'interrupt-dummy-1');
    yield this.read(cpu.PC, 'interrupt-dummy-2');
    yield* this.push(cpu.PC >>> 8);
    yield* this.push(cpu.PC);
    yield* this.push((cpu.P | FLAG_U) & ~FLAG_B);
    cpu.P |= FLAG_I;
    let vector = kind === 'nmi' ? 0xfffa : 0xfffe;
    if (kind !== 'nmi' && cpu.interrupts?.sample().nmiPending) {
      cpu.interrupts.consumeNMI();
      vector = 0xfffa;
    }
    const lo = yield this.read(vector, 'vector-low');
    const hi = yield this.read(vector + 1, 'vector-high');
    cpu.PC = (hi << 8) | lo;
  }

  *brk() {
    const cpu = this.cpu;
    yield* this.fetchByte();
    yield* this.push(cpu.PC >>> 8);
    yield* this.push(cpu.PC);
    yield* this.push(cpu.P | FLAG_B | FLAG_U);
    cpu.P |= FLAG_I;
    let vector = 0xfffe;
    if (cpu.interrupts?.sample().nmiPending) {
      cpu.interrupts.consumeNMI();
      vector = 0xfffa;
    }
    const lo = yield this.read(vector, 'vector-low');
    const hi = yield this.read(vector + 1, 'vector-high');
    cpu.PC = (hi << 8) | lo;
  }

  *execute(entry) {
    const cpu = this.cpu;
    const { mnemonic, mode } = entry;
    if (mnemonic === 'KIL') {
      yield this.read(cpu.PC, 'jam-dummy');
      cpu.jammed = true;
      return;
    }
    if (BRANCHES.has(mnemonic)) {
      yield* this.branch(mnemonic);
      return;
    }
    if (mnemonic === 'BRK') {
      yield* this.brk();
      return;
    }
    if (mnemonic === 'JMP') {
      const lo = yield* this.fetchByte();
      const hi = yield* this.fetchByte();
      const address = (hi << 8) | lo;
      if (mode === 'abs') {
        cpu.PC = address;
      } else {
        const low = yield this.read(address, 'pointer-low');
        const high = yield this.read((address & 0xff00) | ((address + 1) & 0xff), 'pointer-high');
        cpu.PC = (high << 8) | low;
      }
      return;
    }
    if (mnemonic === 'JSR') {
      const low = yield* this.fetchByte();
      yield this.read(0x100 | cpu.SP, 'stack-dummy');
      yield* this.push(cpu.PC >>> 8);
      yield* this.push(cpu.PC);
      const high = yield* this.fetchByte();
      cpu.PC = (high << 8) | low;
      return;
    }
    if (mnemonic === 'RTS' || mnemonic === 'RTI') {
      yield this.read(cpu.PC, 'instruction-dummy');
      yield this.read(0x100 | cpu.SP, 'stack-dummy');
      if (mnemonic === 'RTI') {
        const status = yield* this.pull();
        cpu.P = (status | FLAG_U) & ~FLAG_B;
      }
      const low = yield* this.pull();
      const high = yield* this.pull();
      cpu.PC = (high << 8) | low;
      if (mnemonic === 'RTS') {
        yield this.read(cpu.PC, 'return-dummy');
        cpu.PC = (cpu.PC + 1) & 0xffff;
      }
      return;
    }
    if (mnemonic === 'PHA' || mnemonic === 'PHP') {
      yield this.read(cpu.PC, 'instruction-dummy');
      yield* this.push(mnemonic === 'PHA' ? cpu.A : cpu.P | FLAG_B | FLAG_U);
      return;
    }
    if (mnemonic === 'PLA' || mnemonic === 'PLP') {
      yield this.read(cpu.PC, 'instruction-dummy');
      yield this.read(0x100 | cpu.SP, 'stack-dummy');
      const value = yield* this.pull();
      if (mnemonic === 'PLA') {
        cpu.A = value;
        cpu.setNZ(value);
      } else cpu.P = (value | FLAG_U) & ~FLAG_B;
      return;
    }
    if (mode === 'imp' || mode === 'acc') {
      yield this.read(cpu.PC, 'instruction-dummy');
      if (mode === 'acc') cpu.A = cpu.modify(mnemonic, cpu.A);
      else cpu.implied(mnemonic);
      return;
    }
    if (mode === 'imm') {
      const value = yield* this.fetchByte();
      cpu.applyRead(mnemonic, value);
      return;
    }
    if (READ_OPERATIONS.has(mnemonic)) {
      const address = yield* this.address(mode);
      const value = yield this.read(address, 'data-read');
      cpu.applyRead(mnemonic, value);
      return;
    }
    if (WRITE_OPERATIONS.has(mnemonic)) {
      const address = yield* this.address(mode, true);
      yield this.write(address, cpu.storeValue(mnemonic, address), 'data-write');
      return;
    }
    if (MODIFY_OPERATIONS.has(mnemonic)) {
      const address = yield* this.address(mode, true);
      const original = yield this.read(address, 'rmw-read');
      yield this.write(address, original, 'rmw-dummy-write');
      yield this.write(address, cpu.modify(mnemonic, original), 'rmw-write');
      return;
    }
    throw new Error(`Opcode nicht implementiert: ${entry.opcode.toString(16)}`);
  }
}
