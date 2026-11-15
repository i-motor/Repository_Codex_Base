import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../utils/Assembler.js';
import { disassemble } from '../utils/Debugger.js';
import { crc32, toBcd, fromBcd, bcdIncrement } from '../utils/BitOperations.js';
import { validateRom, guessRomKind } from '../core/ROMManager.js';
import { RealTimeScheduler } from '../core/Clock.js';
import { makeTestC64 } from './helpers.js';

test('Assembler: Adressierungsarten, Labels, Vorwärtsreferenzen, Direktiven', () => {
  const program = assemble(`
start: lda #$01
  sta $d020
  ldx data,y
  lda ($fb),y
  jmp (vector)
  bne start
  lda forward
vector: .word start
data: .byte 1, 2, "AB"
forward = $1234
`, 0xc000);
  assert.equal(program.origin, 0xc000);
  assert.deepEqual(Array.from(program.bytes.subarray(0, 5)), [0xa9, 0x01, 0x8d, 0x20, 0xd0]);
  assert.equal(program.labels.vector, 0xc000 + 2 + 3 + 3 + 2 + 3 + 2 + 3);
  const lda = program.bytes.indexOf(0xad);
  assert.deepEqual(Array.from(program.bytes.subarray(lda, lda + 3)), [0xad, 0x34, 0x12]);
});

test('Disassembler kennzeichnet undokumentierte Opcodes', () => {
  const mem = new Uint8Array(65536);
  mem.set([0xa7, 0x10, 0xb1, 0xfb, 0x6c, 0x00, 0x03], 0x1000);
  const peek = (a) => mem[a];
  assert.match(disassemble(peek, 0x1000).text, /\*LAX \$10/);
  assert.match(disassemble(peek, 0x1002).text, / LDA \(\$FB\),Y/);
  assert.match(disassemble(peek, 0x1004).text, / JMP \(\$0300\)/);
});

test('Monitor: Register, Speicher, Haltepunkt', () => {
  const { c64 } = makeTestC64(`
reset: ldx #0
loop: inx
  stx $0400
  jmp loop
irq: rti
nmi: rti
* = $fffa
.word nmi, reset, irq
`);
  c64.setBreakpoint(0xe002);
  c64.runCycles(100000);
  assert.equal(c64.breakReason.type, 'breakpoint');
  assert.equal(c64.cpu.pc, 0xe002);
  assert.match(c64.debugger.command('r'), /PC=E002/);
  assert.match(c64.debugger.command('d e000 2'), /LDX #\$00/);
  c64.debugger.command('w 1000 41 42');
  assert.match(c64.debugger.command('m 1000 16'), /^1000  41 42/);
  c64.setBreakpoint(0xe002, false);
  assert.equal(c64.cpu.onInstruction, null);
});

test('Bit-Hilfen: CRC32, BCD', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(toBcd(59), 0x59);
  assert.equal(fromBcd(0x42), 42);
  assert.equal(bcdIncrement(0x09), 0x10);
  assert.equal(bcdIncrement(0x59), 0x60);
});

test('ROM-Validierung: Größe, CRC32, Typerkennung', () => {
  assert.equal(validateRom('kernal', new Uint8Array(100)).ok, false);
  const check = validateRom('chargen', new Uint8Array(4096));
  assert.equal(check.ok, true);
  assert.equal(check.known, false);
  const basic = new Uint8Array(8192);
  basic.set(Array.from('CBMBASIC', (c) => c.charCodeAt(0)), 4);
  assert.equal(guessRomKind('x.bin', basic), 'basic');
  const kernal = new Uint8Array(8192);
  kernal[0x1ffd] = 0xfc;
  assert.equal(guessRomKind('y.bin', kernal), 'kernal');
});

test('Echtzeit-Scheduler: Takte folgen der Wanduhr, Rückstand wird begrenzt', () => {
  let time = 0;
  const timers = [];
  let executed = 0;
  const scheduler = new RealTimeScheduler({
    clockHz: 1000000,
    run: (cycles) => { executed += cycles; return cycles; },
    now: () => time,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
    maxSliceMs: 40
  });
  scheduler.start();
  for (let i = 0; i < 100; i++) {
    time += 10;
    timers.shift()();
  }
  assert.ok(Math.abs(executed - 1000000) < 100);
  time += 5000;
  timers.shift()();
  assert.ok(executed - 1000000 <= 40000 + 100);
  scheduler.stop();
});
