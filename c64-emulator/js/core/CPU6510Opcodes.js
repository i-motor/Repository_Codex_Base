const ROWS = [
  'BRK:imp ORA:izx KIL:imp SLO:izx NOP:zp ORA:zp ASL:zp SLO:zp PHP:imp ORA:imm ASL:acc ANC:imm NOP:abs ORA:abs ASL:abs SLO:abs',
  'BPL:rel ORA:izy KIL:imp SLO:izy NOP:zpx ORA:zpx ASL:zpx SLO:zpx CLC:imp ORA:absy NOP:imp SLO:absy NOP:absx ORA:absx ASL:absx SLO:absx',
  'JSR:abs AND:izx KIL:imp RLA:izx BIT:zp AND:zp ROL:zp RLA:zp PLP:imp AND:imm ROL:acc ANC:imm BIT:abs AND:abs ROL:abs RLA:abs',
  'BMI:rel AND:izy KIL:imp RLA:izy NOP:zpx AND:zpx ROL:zpx RLA:zpx SEC:imp AND:absy NOP:imp RLA:absy NOP:absx AND:absx ROL:absx RLA:absx',
  'RTI:imp EOR:izx KIL:imp SRE:izx NOP:zp EOR:zp LSR:zp SRE:zp PHA:imp EOR:imm LSR:acc ALR:imm JMP:abs EOR:abs LSR:abs SRE:abs',
  'BVC:rel EOR:izy KIL:imp SRE:izy NOP:zpx EOR:zpx LSR:zpx SRE:zpx CLI:imp EOR:absy NOP:imp SRE:absy NOP:absx EOR:absx LSR:absx SRE:absx',
  'RTS:imp ADC:izx KIL:imp RRA:izx NOP:zp ADC:zp ROR:zp RRA:zp PLA:imp ADC:imm ROR:acc ARR:imm JMP:ind ADC:abs ROR:abs RRA:abs',
  'BVS:rel ADC:izy KIL:imp RRA:izy NOP:zpx ADC:zpx ROR:zpx RRA:zpx SEI:imp ADC:absy NOP:imp RRA:absy NOP:absx ADC:absx ROR:absx RRA:absx',
  'NOP:imm STA:izx NOP:imm SAX:izx STY:zp STA:zp STX:zp SAX:zp DEY:imp NOP:imm TXA:imp XAA:imm STY:abs STA:abs STX:abs SAX:abs',
  'BCC:rel STA:izy KIL:imp AHX:izy STY:zpx STA:zpx STX:zpy SAX:zpy TYA:imp STA:absy TXS:imp TAS:absy SHY:absx STA:absx SHX:absy AHX:absy',
  'LDY:imm LDA:izx LDX:imm LAX:izx LDY:zp LDA:zp LDX:zp LAX:zp TAY:imp LDA:imm TAX:imp LXA:imm LDY:abs LDA:abs LDX:abs LAX:abs',
  'BCS:rel LDA:izy KIL:imp LAX:izy LDY:zpx LDA:zpx LDX:zpy LAX:zpy CLV:imp LDA:absy TSX:imp LAS:absy LDY:absx LDA:absx LDX:absy LAX:absy',
  'CPY:imm CMP:izx NOP:imm DCP:izx CPY:zp CMP:zp DEC:zp DCP:zp INY:imp CMP:imm DEX:imp AXS:imm CPY:abs CMP:abs DEC:abs DCP:abs',
  'BNE:rel CMP:izy KIL:imp DCP:izy NOP:zpx CMP:zpx DEC:zpx DCP:zpx CLD:imp CMP:absy NOP:imp DCP:absy NOP:absx CMP:absx DEC:absx DCP:absx',
  'CPX:imm SBC:izx NOP:imm ISC:izx CPX:zp SBC:zp INC:zp ISC:zp INX:imp SBC:imm NOP:imp SBC:imm CPX:abs SBC:abs INC:abs ISC:abs',
  'BEQ:rel SBC:izy KIL:imp ISC:izy NOP:zpx SBC:zpx INC:zpx ISC:zpx SED:imp SBC:absy NOP:imp ISC:absy NOP:absx SBC:absx INC:absx ISC:absx'
];

const OFFICIAL = `00 01 05 06 08 09 0A 0D 0E 10 11 15 16 18 19 1D 1E
20 21 24 25 26 28 29 2A 2C 2D 2E 30 31 35 36 38 39 3D 3E
40 41 45 46 48 49 4A 4C 4D 4E 50 51 55 56 58 59 5D 5E
60 61 65 66 68 69 6A 6C 6D 6E 70 71 75 76 78 79 7D 7E
81 84 85 86 88 8A 8C 8D 8E 90 91 94 95 96 98 99 9A 9D
A0 A1 A2 A4 A5 A6 A8 A9 AA AC AD AE B0 B1 B4 B5 B6 B8 B9 BA BC BD BE
C0 C1 C4 C5 C6 C8 C9 CA CC CD CE D0 D1 D5 D6 D8 D9 DD DE
E0 E1 E4 E5 E6 E8 E9 EA EC ED EE F0 F1 F5 F6 F8 F9 FD FE`;
const STABLE_UNOFFICIAL = new Set('SLO RLA SRE RRA SAX LAX DCP ISC ANC ALR AXS'.split(' '));
const UNSTABLE = new Set('AHX TAS SHX SHY XAA LXA ARR LAS'.split(' '));
const officialSet = new Set(OFFICIAL.trim().split(/\s+/).map(value => parseInt(value, 16)));
const entries = ROWS.flatMap(row => row.trim().split(/\s+/)).map((entry, opcode) => {
  const [mnemonic, mode] = entry.split(':');
  const classification = officialSet.has(opcode) ? 'official'
    : mnemonic === 'KIL' ? 'jam'
    : UNSTABLE.has(mnemonic) ? 'approximate'
    : STABLE_UNOFFICIAL.has(mnemonic) || mnemonic === 'NOP' || opcode === 0xeb ? 'unofficial'
    : 'approximate';
  return Object.freeze({ opcode, mnemonic, mode, classification });
});
if (entries.length !== 256 || officialSet.size !== 151) throw new Error('Ungültige Opcode-Tabelle');
export const CPU6510_OPCODES = Object.freeze(entries);
export function decode(opcode) {
  return CPU6510_OPCODES[opcode & 0xff];
}
export function getClassification(opcode) {
  return decode(opcode).classification;
}
