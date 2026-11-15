export const MODES = Object.freeze({
  IMP: 0,
  ACC: 1,
  IMM: 2,
  ZP: 3,
  ZPX: 4,
  ZPY: 5,
  ABS: 6,
  ABX: 7,
  ABY: 8,
  IZX: 9,
  IZY: 10,
  IND: 11,
  REL: 12
});

const M = MODES;

const MODE_NAMES = ['imp', 'acc', 'imm', 'zp', 'zpx', 'zpy', 'abs', 'abx', 'aby', 'izx', 'izy', 'ind', 'rel'];

const MODE_BY_NAME = Object.fromEntries(MODE_NAMES.map((name, index) => [name, index]));

const OPERAND_BYTES = [0, 0, 1, 1, 1, 1, 2, 2, 2, 1, 1, 2, 1];

const TABLE_SOURCE = [
  'BRK imp', 'ORA izx', 'JAM imp', 'SLO izx', 'NOP zp', 'ORA zp', 'ASL zp', 'SLO zp',
  'PHP imp', 'ORA imm', 'ASL acc', 'ANC imm', 'NOP abs', 'ORA abs', 'ASL abs', 'SLO abs',
  'BPL rel', 'ORA izy', 'JAM imp', 'SLO izy', 'NOP zpx', 'ORA zpx', 'ASL zpx', 'SLO zpx',
  'CLC imp', 'ORA aby', 'NOP imp', 'SLO aby', 'NOP abx', 'ORA abx', 'ASL abx', 'SLO abx',
  'JSR abs', 'AND izx', 'JAM imp', 'RLA izx', 'BIT zp', 'AND zp', 'ROL zp', 'RLA zp',
  'PLP imp', 'AND imm', 'ROL acc', 'ANC imm', 'BIT abs', 'AND abs', 'ROL abs', 'RLA abs',
  'BMI rel', 'AND izy', 'JAM imp', 'RLA izy', 'NOP zpx', 'AND zpx', 'ROL zpx', 'RLA zpx',
  'SEC imp', 'AND aby', 'NOP imp', 'RLA aby', 'NOP abx', 'AND abx', 'ROL abx', 'RLA abx',
  'RTI imp', 'EOR izx', 'JAM imp', 'SRE izx', 'NOP zp', 'EOR zp', 'LSR zp', 'SRE zp',
  'PHA imp', 'EOR imm', 'LSR acc', 'ALR imm', 'JMP abs', 'EOR abs', 'LSR abs', 'SRE abs',
  'BVC rel', 'EOR izy', 'JAM imp', 'SRE izy', 'NOP zpx', 'EOR zpx', 'LSR zpx', 'SRE zpx',
  'CLI imp', 'EOR aby', 'NOP imp', 'SRE aby', 'NOP abx', 'EOR abx', 'LSR abx', 'SRE abx',
  'RTS imp', 'ADC izx', 'JAM imp', 'RRA izx', 'NOP zp', 'ADC zp', 'ROR zp', 'RRA zp',
  'PLA imp', 'ADC imm', 'ROR acc', 'ARR imm', 'JMP ind', 'ADC abs', 'ROR abs', 'RRA abs',
  'BVS rel', 'ADC izy', 'JAM imp', 'RRA izy', 'NOP zpx', 'ADC zpx', 'ROR zpx', 'RRA zpx',
  'SEI imp', 'ADC aby', 'NOP imp', 'RRA aby', 'NOP abx', 'ADC abx', 'ROR abx', 'RRA abx',
  'NOP imm', 'STA izx', 'NOP imm', 'SAX izx', 'STY zp', 'STA zp', 'STX zp', 'SAX zp',
  'DEY imp', 'NOP imm', 'TXA imp', 'ANE imm', 'STY abs', 'STA abs', 'STX abs', 'SAX abs',
  'BCC rel', 'STA izy', 'JAM imp', 'SHA izy', 'STY zpx', 'STA zpx', 'STX zpy', 'SAX zpy',
  'TYA imp', 'STA aby', 'TXS imp', 'TAS aby', 'SHY abx', 'STA abx', 'SHX aby', 'SHA aby',
  'LDY imm', 'LDA izx', 'LDX imm', 'LAX izx', 'LDY zp', 'LDA zp', 'LDX zp', 'LAX zp',
  'TAY imp', 'LDA imm', 'TAX imp', 'LXA imm', 'LDY abs', 'LDA abs', 'LDX abs', 'LAX abs',
  'BCS rel', 'LDA izy', 'JAM imp', 'LAX izy', 'LDY zpx', 'LDA zpx', 'LDX zpy', 'LAX zpy',
  'CLV imp', 'LDA aby', 'TSX imp', 'LAS aby', 'LDY abx', 'LDA abx', 'LDX aby', 'LAX aby',
  'CPY imm', 'CMP izx', 'NOP imm', 'DCP izx', 'CPY zp', 'CMP zp', 'DEC zp', 'DCP zp',
  'INY imp', 'CMP imm', 'DEX imp', 'SBX imm', 'CPY abs', 'CMP abs', 'DEC abs', 'DCP abs',
  'BNE rel', 'CMP izy', 'JAM imp', 'DCP izy', 'NOP zpx', 'CMP zpx', 'DEC zpx', 'DCP zpx',
  'CLD imp', 'CMP aby', 'NOP imp', 'DCP aby', 'NOP abx', 'CMP abx', 'DEC abx', 'DCP abx',
  'CPX imm', 'SBC izx', 'NOP imm', 'ISC izx', 'CPX zp', 'SBC zp', 'INC zp', 'ISC zp',
  'INX imp', 'SBC imm', 'NOP imp', 'SBC imm', 'CPX abs', 'SBC abs', 'INC abs', 'ISC abs',
  'BEQ rel', 'SBC izy', 'JAM imp', 'ISC izy', 'NOP zpx', 'SBC zpx', 'INC zpx', 'ISC zpx',
  'SED imp', 'SBC aby', 'NOP imp', 'ISC aby', 'NOP abx', 'SBC abx', 'INC abx', 'ISC abx'
];

const READ_MNEMONICS = new Set([
  'LDA', 'LDX', 'LDY', 'EOR', 'AND', 'ORA', 'ADC', 'SBC', 'CMP', 'CPX', 'CPY', 'BIT',
  'LAX', 'NOP', 'ANC', 'ALR', 'ARR', 'SBX', 'ANE', 'LXA', 'LAS'
]);

const WRITE_MNEMONICS = new Set(['STA', 'STX', 'STY', 'SAX', 'SHA', 'SHX', 'SHY', 'TAS']);

const RMW_MNEMONICS = new Set([
  'ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC', 'SLO', 'RLA', 'SRE', 'RRA', 'DCP', 'ISC'
]);

const SPECIAL_MNEMONICS = new Set(['BRK', 'JSR', 'RTS', 'RTI', 'JMP', 'PHA', 'PHP', 'PLA', 'PLP']);

const UNDOCUMENTED = new Set([
  'SLO', 'RLA', 'SRE', 'RRA', 'SAX', 'LAX', 'DCP', 'ISC', 'ANC', 'ALR', 'ARR', 'SBX',
  'ANE', 'LXA', 'SHA', 'SHX', 'SHY', 'TAS', 'LAS', 'JAM'
]);

const UNSTABLE = new Set(['ANE', 'LXA', 'SHA', 'SHX', 'SHY', 'TAS']);

function classify(mnemonic, mode) {
  if (mnemonic === 'JAM') {
    return 'jam';
  }
  if (mode === M.REL) {
    return 'branch';
  }
  if (SPECIAL_MNEMONICS.has(mnemonic)) {
    return 'special';
  }
  if (mode === M.IMP || mode === M.ACC) {
    return 'impl';
  }
  if (WRITE_MNEMONICS.has(mnemonic)) {
    return 'write';
  }
  if (RMW_MNEMONICS.has(mnemonic)) {
    return 'rmw';
  }
  if (READ_MNEMONICS.has(mnemonic)) {
    return 'read';
  }
  throw new Error(`Unklassifizierter Opcode ${mnemonic}`);
}

export const OPCODES = Object.freeze(
  TABLE_SOURCE.map((entry, opcode) => {
    const [mnemonic, modeName] = entry.split(' ');
    const mode = MODE_BY_NAME[modeName];
    const official = !UNDOCUMENTED.has(mnemonic) && !(mnemonic === 'NOP' && opcode !== 0xea) && opcode !== 0xeb;
    return Object.freeze({
      opcode,
      mnemonic,
      mode,
      modeName,
      kind: classify(mnemonic, mode),
      bytes: 1 + OPERAND_BYTES[mode],
      official,
      unstable: UNSTABLE.has(mnemonic)
    });
  })
);

export function modeOperandBytes(mode) {
  return OPERAND_BYTES[mode];
}

export function modeName(mode) {
  return MODE_NAMES[mode];
}

export function modeByName(name) {
  return MODE_BY_NAME[name];
}

export function findOpcode(mnemonic, mode) {
  const upper = mnemonic.toUpperCase();
  for (const preferred of [0xea, 0xe9]) {
    const entry = OPCODES[preferred];
    if (entry.mnemonic === upper && entry.mode === mode) {
      return preferred;
    }
  }
  for (let op = 0; op < 256; op++) {
    const entry = OPCODES[op];
    if (entry.mnemonic === upper && entry.mode === mode) {
      return op;
    }
  }
  return -1;
}
