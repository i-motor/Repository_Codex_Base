import { OPCODES, MODES } from '../core/OpcodeTable.js';
import { hex2, hex4 } from './BitOperations.js';
import { assemble } from './Assembler.js';

export function disassemble(peek, address) {
  const opcode = peek(address & 0xffff);
  const entry = OPCODES[opcode];
  const lo = peek((address + 1) & 0xffff);
  const hi = peek((address + 2) & 0xffff);
  const word = lo | (hi << 8);
  let operand;
  switch (entry.mode) {
    case MODES.IMP: operand = ''; break;
    case MODES.ACC: operand = 'A'; break;
    case MODES.IMM: operand = `#$${hex2(lo)}`; break;
    case MODES.ZP: operand = `$${hex2(lo)}`; break;
    case MODES.ZPX: operand = `$${hex2(lo)},X`; break;
    case MODES.ZPY: operand = `$${hex2(lo)},Y`; break;
    case MODES.ABS: operand = `$${hex4(word)}`; break;
    case MODES.ABX: operand = `$${hex4(word)},X`; break;
    case MODES.ABY: operand = `$${hex4(word)},Y`; break;
    case MODES.IZX: operand = `($${hex2(lo)},X)`; break;
    case MODES.IZY: operand = `($${hex2(lo)}),Y`; break;
    case MODES.IND: operand = `($${hex4(word)})`; break;
    case MODES.REL: operand = `$${hex4((address + 2 + (lo & 0x80 ? lo - 256 : lo)) & 0xffff)}`; break;
    default: operand = '';
  }
  const bytes = [opcode, lo, hi].slice(0, entry.bytes);
  const marker = entry.official ? ' ' : '*';
  return {
    address,
    bytes,
    length: entry.bytes,
    text: `${hex4(address)}  ${bytes.map(hex2).join(' ').padEnd(8)} ${marker}${entry.mnemonic} ${operand}`.trimEnd()
  };
}

export class Debugger {
  constructor(c64) {
    this.c64 = c64;
    this.traceSize = 256;
    this.traceBuffer = [];
    this.tracing = false;
  }

  peek(address) {
    return this.c64.bus.peek(address & 0xffff);
  }

  registers() {
    const cpu = this.c64.cpu;
    const p = cpu.getP();
    const flags = 'NV-BDIZC'.split('').map((f, i) => (p & (0x80 >> i) ? f : '.')).join('');
    return `PC=${hex4(cpu.pc)} A=${hex2(cpu.a)} X=${hex2(cpu.x)} Y=${hex2(cpu.y)} SP=${hex2(cpu.s)} P=${flags} ` +
      `RASTER=${this.c64.vic.raster} ZYKLUS=${this.c64.vic.cycleInLine} TAKT=${this.c64.clock.cycles}`;
  }

  disassembleRange(start, count = 16) {
    const lines = [];
    let address = start & 0xffff;
    for (let i = 0; i < count; i++) {
      const line = disassemble((a) => this.peek(a), address);
      lines.push(line.text);
      address = (address + line.length) & 0xffff;
    }
    return lines;
  }

  memoryDump(start, length = 128) {
    const lines = [];
    for (let row = 0; row < length; row += 16) {
      const base = (start + row) & 0xffff;
      const bytes = [];
      let text = '';
      for (let i = 0; i < 16; i++) {
        const v = this.peek(base + i);
        bytes.push(hex2(v));
        text += v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.';
      }
      lines.push(`${hex4(base)}  ${bytes.join(' ')}  ${text}`);
    }
    return lines;
  }

  stepInstruction() {
    const cpu = this.c64.cpu;
    let cycles = 0;
    do {
      this.c64.cycle();
      cycles++;
    } while ((cpu.t !== 0 || cpu.stalled) && cycles < 200);
    return cycles;
  }

  stepCycle() {
    this.c64.cycle();
  }

  setTracing(enabled) {
    this.tracing = enabled;
    this.updateHook();
  }

  updateHook() {
    const c64 = this.c64;
    const breakpoints = c64.breakpoints;
    if (!this.tracing && breakpoints.size === 0) {
      c64.cpu.onInstruction = null;
      return;
    }
    c64.cpu.onInstruction = (pc) => {
      if (this.tracing) {
        this.traceBuffer.push(pc);
        if (this.traceBuffer.length > this.traceSize) {
          this.traceBuffer.shift();
        }
      }
      if (breakpoints.has(pc)) {
        c64.breakRequested = true;
        c64.breakReason = { type: 'breakpoint', address: pc };
      }
    };
  }

  setBreakpoint(address, enabled = true) {
    if (enabled) {
      this.c64.breakpoints.add(address & 0xffff);
    } else {
      this.c64.breakpoints.delete(address & 0xffff);
    }
    this.updateHook();
  }

  trace() {
    return this.traceBuffer.map((pc) => disassemble((a) => this.peek(a), pc).text);
  }

  chipState(name) {
    const c64 = this.c64;
    switch (name) {
      case 'vic': return c64.vic.getState();
      case 'cia1': return c64.cia1.getState();
      case 'cia2': return c64.cia2.getState();
      case 'sid': return { registers: Array.from(c64.sid.registers, hex2).join(' '), model: c64.sid.model };
      case 'drive': return { status: c64.drive8.status, state: c64.drive8.state };
      default: return null;
    }
  }

  command(input) {
    const parts = input.trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const num = (i, fallback) => (parts[i] !== undefined ? parseInt(parts[i].replace(/^\$/, ''), 16) : fallback);
    switch (cmd) {
      case 'r':
        return this.registers();
      case 'd':
        return this.disassembleRange(num(1, this.c64.cpu.pc), num(2, 16)).join('\n');
      case 'm':
        return this.memoryDump(num(1, 0), num(2, 128)).join('\n');
      case 's':
      case 'z':
        this.stepInstruction();
        return `${this.disassembleRange(this.c64.cpu.pc, 1)[0]}\n${this.registers()}`;
      case 'b':
        this.setBreakpoint(num(1, 0));
        return `Haltepunkt bei $${hex4(num(1, 0))}`;
      case 'bc':
        this.setBreakpoint(num(1, 0), false);
        return `Haltepunkt gelöscht $${hex4(num(1, 0))}`;
      case 'bl':
        return [...this.c64.breakpoints].map((a) => `$${hex4(a)}`).join(' ') || 'keine Haltepunkte';
      case 'f': {
        const start = num(1, 0);
        const end = num(2, start);
        const value = num(3, 0);
        for (let a = start; a <= end; a++) this.c64.bus.write(a & 0xffff, value);
        return `$${hex4(start)}-$${hex4(end)} = $${hex2(value)}`;
      }
      case 'w': {
        const start = num(1, 0);
        for (let i = 2; i < parts.length; i++) this.c64.bus.write((start + i - 2) & 0xffff, num(i, 0));
        return `${parts.length - 2} Byte(s) ab $${hex4(start)}`;
      }
      case 'a': {
        const start = num(1, 0);
        const program = assemble(parts.slice(2).join(' ').replace(/\|/g, '\n'), start);
        program.bytes.forEach((b, i) => this.c64.bus.write((program.origin + i) & 0xffff, b));
        return this.disassembleRange(start, 4).join('\n');
      }
      case 'g':
        if (parts[1] !== undefined) this.c64.cpu.setRegisters({ pc: num(1, 0) });
        return `PC=$${hex4(this.c64.cpu.pc)}`;
      case 'vic':
      case 'cia1':
      case 'cia2':
      case 'sid':
      case 'drive':
        return JSON.stringify(this.chipState(cmd));
      case 't':
        this.setTracing(!this.tracing);
        return `Trace ${this.tracing ? 'an' : 'aus'}`;
      case 'tl':
        return this.trace().join('\n');
      default:
        return 'Befehle: r, d [adr] [n], m [adr] [n], s, b adr, bc adr, bl, f von bis wert, w adr bytes, a adr befehl|befehl, g [adr], t, tl, vic, cia1, cia2, sid, drive';
    }
  }
}
