export const TOKENS = Object.freeze([
  'END', 'FOR', 'NEXT', 'DATA', 'INPUT#', 'INPUT', 'DIM', 'READ', 'LET', 'GOTO', 'RUN', 'IF',
  'RESTORE', 'GOSUB', 'RETURN', 'REM', 'STOP', 'ON', 'WAIT', 'LOAD', 'SAVE', 'VERIFY', 'DEF',
  'POKE', 'PRINT#', 'PRINT', 'CONT', 'LIST', 'CLR', 'CMD', 'SYS', 'OPEN', 'CLOSE', 'GET', 'NEW',
  'TAB(', 'TO', 'FN', 'SPC(', 'THEN', 'NOT', 'STEP', '+', '-', '*', '/', '^', 'AND', 'OR', '>',
  '=', '<', 'SGN', 'INT', 'ABS', 'USR', 'FRE', 'POS', 'SQR', 'RND', 'LOG', 'EXP', 'COS', 'SIN',
  'TAN', 'ATN', 'PEEK', 'LEN', 'STR$', 'VAL', 'ASC', 'CHR$', 'LEFT$', 'RIGHT$', 'MID$', 'GO'
]);

export const TOKEN_BASE = 0x80;
export const PI_TOKEN = 0xff;

export const CONTROL_CODES = Object.freeze({
  0x05: 'WHT', 0x0d: 'RETURN', 0x0e: 'LOWER', 0x11: 'DOWN', 0x12: 'RVS ON', 0x13: 'HOME',
  0x14: 'DEL', 0x1c: 'RED', 0x1d: 'RIGHT', 0x1e: 'GRN', 0x1f: 'BLU', 0x81: 'ORANGE',
  0x85: 'F1', 0x86: 'F3', 0x87: 'F5', 0x88: 'F7', 0x89: 'F2', 0x8a: 'F4', 0x8b: 'F6', 0x8c: 'F8',
  0x8e: 'UPPER', 0x90: 'BLK', 0x91: 'UP', 0x92: 'RVS OFF', 0x93: 'CLR', 0x94: 'INST',
  0x95: 'BROWN', 0x96: 'LT RED', 0x97: 'DK GRAY', 0x98: 'GRAY', 0x99: 'LT GREEN',
  0x9a: 'LT BLUE', 0x9b: 'LT GRAY', 0x9c: 'PUR', 0x9d: 'LEFT', 0x9e: 'YEL', 0x9f: 'CYN'
});

export const CONTROL_BY_NAME = Object.freeze(
  Object.fromEntries(Object.entries(CONTROL_CODES).map(([code, name]) => [name, Number(code)]))
);

export function petsciiToAscii(code) {
  if (code >= 0x41 && code <= 0x5a) return String.fromCharCode(code);
  if (code >= 0xc1 && code <= 0xda) return String.fromCharCode(code - 0x80).toLowerCase();
  if (code >= 0x20 && code <= 0x40) return String.fromCharCode(code);
  if (code === 0x5b) return '[';
  if (code === 0x5c) return '£';
  if (code === 0x5d) return ']';
  if (code === 0x5e) return '↑';
  if (code === 0x5f) return '←';
  if (code === PI_TOKEN || code === 0xde) return 'π';
  if (CONTROL_CODES[code]) return `{${CONTROL_CODES[code].toLowerCase()}}`;
  return `{$${code.toString(16).padStart(2, '0')}}`;
}

export function detokenize(prg) {
  const loadAddress = prg[0] | (prg[1] << 8);
  const lines = [];
  let pos = 2;
  let guard = 0;
  while (pos + 4 <= prg.length && guard++ < 65536) {
    const link = prg[pos] | (prg[pos + 1] << 8);
    if (link === 0) {
      break;
    }
    const number = prg[pos + 2] | (prg[pos + 3] << 8);
    pos += 4;
    let text = '';
    let quoted = false;
    while (pos < prg.length && prg[pos] !== 0) {
      const byte = prg[pos++];
      if (byte === 0x22) {
        quoted = !quoted;
        text += '"';
      } else if (!quoted && byte >= TOKEN_BASE && byte < TOKEN_BASE + TOKENS.length) {
        text += TOKENS[byte - TOKEN_BASE];
      } else if (!quoted && byte === PI_TOKEN) {
        text += 'π';
      } else {
        text += petsciiToAscii(byte);
      }
    }
    pos++;
    lines.push(`${number} ${text}`);
  }
  return { loadAddress, text: lines.join('\n') };
}

export function readProgram(memory) {
  const ram = memory.ram;
  const start = ram[0x2b] | (ram[0x2c] << 8);
  const end = ram[0x2d] | (ram[0x2e] << 8);
  if (end <= start || end > 0xa000) {
    throw new Error('Kein BASIC-Programm im Speicher');
  }
  const out = new Uint8Array(end - start + 2);
  out[0] = start & 0xff;
  out[1] = start >> 8;
  out.set(ram.subarray(start, end), 2);
  return out;
}
