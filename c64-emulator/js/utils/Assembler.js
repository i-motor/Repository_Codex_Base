import { MODES, findOpcode, OPCODES } from '../core/OpcodeTable.js';

const BRANCHES = new Set(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ']);
const MNEMONICS = new Set(OPCODES.map((entry) => entry.mnemonic));

function stripComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inString = !inString;
    } else if (ch === ';' && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitArgs(text) {
  const parts = [];
  let current = '';
  let inString = false;
  for (const ch of text) {
    if (ch === '"') {
      inString = !inString;
      current += ch;
    } else if (ch === ',' && !inString) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length) {
    parts.push(current.trim());
  }
  return parts;
}

export class AssemblerError extends Error {
  constructor(message, lineNumber, line) {
    super(`Zeile ${lineNumber}: ${message} [${line.trim()}]`);
    this.lineNumber = lineNumber;
  }
}

export class Assembler {
  constructor() {
    this.symbols = new Map();
  }

  evaluate(expression, pc, strict) {
    let text = expression.trim();
    let part = 'full';
    if (text.startsWith('<')) {
      part = 'lo';
      text = text.slice(1).trim();
    } else if (text.startsWith('>')) {
      part = 'hi';
      text = text.slice(1).trim();
    }
    const tokens = text.match(/\$[0-9a-fA-F]+|%[01]+|'.'|[0-9]+|[A-Za-z_.][A-Za-z0-9_.]*|\*|[+\-/&|^]|\S/g) || [];
    let total = 0;
    let operator = '+';
    let known = true;
    let expectOperand = true;
    for (const token of tokens) {
      if (expectOperand) {
        let value;
        if (token === '*') {
          value = pc;
        } else if (token.startsWith('$')) {
          value = parseInt(token.slice(1), 16);
        } else if (token.startsWith('%')) {
          value = parseInt(token.slice(1), 2);
        } else if (token.startsWith("'")) {
          value = token.charCodeAt(1);
        } else if (/^[0-9]+$/.test(token)) {
          value = parseInt(token, 10);
        } else if (/^[A-Za-z_.]/.test(token)) {
          const key = token.toLowerCase();
          if (this.symbols.has(key)) {
            value = this.symbols.get(key);
          } else if (strict) {
            throw new Error(`Unbekanntes Symbol ${token}`);
          } else {
            value = 0;
            known = false;
          }
        } else if (token === '-' && operator === '+') {
          operator = '-';
          continue;
        } else {
          throw new Error(`Unerwartetes Token ${token}`);
        }
        switch (operator) {
          case '+': total += value; break;
          case '-': total -= value; break;
          case '*': total *= value; break;
          case '/': total = Math.trunc(total / value); break;
          case '&': total &= value; break;
          case '|': total |= value; break;
          case '^': total ^= value; break;
          default: throw new Error(`Operator ${operator}`);
        }
        expectOperand = false;
      } else {
        operator = token;
        expectOperand = true;
      }
    }
    if (part === 'lo') {
      total &= 0xff;
    } else if (part === 'hi') {
      total = (total >> 8) & 0xff;
    }
    return { value: total, known };
  }

  parseOperand(mnemonic, operandText, pc, strict, forcedWide) {
    const text = operandText.trim();
    if (text === '' || text.toUpperCase() === 'A') {
      const acc = findOpcode(mnemonic, MODES.ACC);
      if (acc >= 0) {
        return { mode: MODES.ACC, value: 0 };
      }
      return { mode: MODES.IMP, value: 0 };
    }
    if (BRANCHES.has(mnemonic)) {
      return { mode: MODES.REL, ...this.evaluate(text, pc, strict) };
    }
    if (text.startsWith('#')) {
      return { mode: MODES.IMM, ...this.evaluate(text.slice(1), pc, strict) };
    }
    let match = text.match(/^\((.+),\s*[xX]\)$/);
    if (match) {
      return { mode: MODES.IZX, ...this.evaluate(match[1], pc, strict) };
    }
    match = text.match(/^\((.+)\),\s*[yY]$/);
    if (match) {
      return { mode: MODES.IZY, ...this.evaluate(match[1], pc, strict) };
    }
    match = text.match(/^\((.+)\)$/);
    if (match) {
      return { mode: MODES.IND, ...this.evaluate(match[1], pc, strict) };
    }
    let index = '';
    let base = text;
    match = text.match(/^(.+),\s*([xXyY])$/);
    if (match) {
      base = match[1];
      index = match[2].toUpperCase();
    }
    const result = this.evaluate(base, pc, strict);
    const small = result.known && result.value >= 0 && result.value < 256 && !forcedWide;
    const zpMode = index === 'X' ? MODES.ZPX : index === 'Y' ? MODES.ZPY : MODES.ZP;
    const absMode = index === 'X' ? MODES.ABX : index === 'Y' ? MODES.ABY : MODES.ABS;
    if (small && findOpcode(mnemonic, zpMode) >= 0) {
      return { mode: zpMode, ...result };
    }
    return { mode: absMode, ...result };
  }

  assemble(source, origin = 0) {
    this.symbols = new Map();
    const lines = source.split('\n');
    const decisions = new Map();
    let output = null;
    for (let pass = 1; pass <= 2; pass++) {
      const strict = pass === 2;
      let pc = origin;
      let start = origin;
      let started = false;
      const bytes = [];
      const emit = (value) => {
        if (!started) {
          start = pc;
          started = true;
        }
        bytes[pc - start] = value & 0xff;
        pc++;
      };
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const original = lines[lineNumber];
        let line = stripComment(original).trim();
        if (!line) {
          continue;
        }
        try {
          let match = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*):\s*(.*)$/);
          if (match) {
            this.symbols.set(match[1].toLowerCase(), pc);
            line = match[2].trim();
            if (!line) {
              continue;
            }
          }
          match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
          if (match) {
            const { value } = this.evaluate(match[2], pc, false);
            this.symbols.set(match[1].toLowerCase(), value);
            continue;
          }
          match = line.match(/^\*\s*=\s*(.+)$/) || line.match(/^\.org\s+(.+)$/i);
          if (match) {
            const target = this.evaluate(match[1], pc, true).value;
            if (started) {
              while (pc < target) {
                emit(0);
              }
            }
            pc = target;
            continue;
          }
          match = line.match(/^\.(byte|byt|db|word|dw|text|fill)\s+(.+)$/i);
          if (match) {
            const directive = match[1].toLowerCase();
            const args = splitArgs(match[2]);
            if (directive === 'fill') {
              const count = this.evaluate(args[0], pc, true).value;
              const value = args[1] ? this.evaluate(args[1], pc, strict).value : 0;
              for (let i = 0; i < count; i++) {
                emit(value);
              }
              continue;
            }
            for (const arg of args) {
              if (arg.startsWith('"')) {
                const text = arg.slice(1, -1);
                for (const ch of text) {
                  emit(ch.charCodeAt(0));
                }
              } else if (directive === 'word' || directive === 'dw') {
                const value = this.evaluate(arg, pc, strict).value;
                emit(value);
                emit(value >> 8);
              } else {
                emit(this.evaluate(arg, pc, strict).value);
              }
            }
            continue;
          }
          match = line.match(/^([A-Za-z]{3})\b\s*(.*)$/);
          if (!match || !MNEMONICS.has(match[1].toUpperCase())) {
            throw new Error('Unbekannte Anweisung');
          }
          const mnemonic = match[1].toUpperCase();
          const key = lineNumber;
          const forcedWide = pass === 2 && decisions.get(key) === 'wide';
          const operand = this.parseOperand(mnemonic, match[2], pc, strict, forcedWide);
          if (pass === 1) {
            const wide = operand.mode === MODES.ABS || operand.mode === MODES.ABX || operand.mode === MODES.ABY;
            decisions.set(key, wide ? 'wide' : 'narrow');
          }
          const opcode = findOpcode(mnemonic, operand.mode);
          if (opcode < 0) {
            throw new Error(`Adressierungsart nicht verfügbar für ${mnemonic}`);
          }
          emit(opcode);
          const size = OPCODES[opcode].bytes;
          if (operand.mode === MODES.REL) {
            const offset = operand.value - (pc + 1);
            if (strict && (offset < -128 || offset > 127)) {
              throw new Error('Sprungziel außer Reichweite');
            }
            emit(offset);
          } else if (size === 2) {
            emit(operand.value);
          } else if (size === 3) {
            emit(operand.value);
            emit(operand.value >> 8);
          }
        } catch (error) {
          if (error instanceof AssemblerError) {
            throw error;
          }
          throw new AssemblerError(error.message, lineNumber + 1, original);
        }
      }
      output = { origin: start, bytes: Uint8Array.from(bytes, (v) => v || 0), labels: Object.fromEntries(this.symbols) };
    }
    return output;
  }
}

export function assemble(source, origin = 0) {
  return new Assembler().assemble(source, origin);
}
