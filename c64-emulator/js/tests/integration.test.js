import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { C64 } from '../core/C64.js';
import { assemble } from '../utils/Assembler.js';
import { columnForX, PAL } from '../video/VideoTiming.js';
import { testDataPath, romPath } from './external/paths.js';

export function makeTestC64(source) {
  const program = assemble(`* = $e000\n${source}`, 0xe000);
  const kernal = new Uint8Array(8192);
  kernal.set(program.bytes.subarray(0, 8192), program.origin - 0xe000);
  const c64 = new C64();
  c64.memory.loadRom('kernal', kernal);
  c64.memory.loadRom('basic', new Uint8Array(8192));
  c64.memory.loadRom('chargen', new Uint8Array(4096).fill(0xaa));
  c64.powerOn();
  return { c64, labels: program.labels };
}

const VECTORS = `
* = $fffa
.word nmi, reset, irq
`;

test('CIA1-Timer-IRQ: Anzahl Interrupts entspricht Taktzahl / (Latch+1)', () => {
  const { c64 } = makeTestC64(`
reset: sei
  ldx #$ff
  txs
  lda #0
  sta $02
  lda #$e7
  sta $dc04
  lda #$03
  sta $dc05
  lda #$81
  sta $dc0d
  lda #$11
  sta $dc0e
  cli
loop: jmp loop
irq: pha
  lda $dc0d
  inc $02
  pla
  rti
nmi: rti
${VECTORS}`);
  c64.vic.write(0x11, 0x0b);
  c64.runCycles(100000);
  const count = c64.memory.ram[0x02];
  assert.ok(count >= 98 && count <= 100, `count=${count}`);
});

test('Badlines halten die CPU 25 × 43 Takte je Bild an (JMP-Schleife)', () => {
  const { c64 } = makeTestC64(`
reset: sei
  lda #$1b
  sta $d011
loop: jmp loop
irq: rti
nmi: rti
${VECTORS}`);
  c64.runFrame();
  c64.runFrame();
  let stalled = 0;
  const start = c64.vic.frameCount;
  while (c64.vic.frameCount === start) {
    c64.runCycles(1);
    if (c64.cpu.stalled) stalled++;
  }
  assert.equal(stalled, 25 * 43);
  c64.vic.write(0x11, 0x0b);
  c64.runFrame();
  stalled = 0;
  const next = c64.vic.frameCount;
  while (c64.vic.frameCount === next) {
    c64.runCycles(1);
    if (c64.cpu.stalled) stalled++;
  }
  assert.equal(stalled, 0);
});

test('Raster-IRQ-Programm erzeugt zeilengenaue Rahmenfarbwechsel', () => {
  const { c64 } = makeTestC64(`
reset: sei
  ldx #$ff
  txs
  lda #$7f
  sta $dc0d
  lda $dc0d
  lda #$1b
  sta $d011
  lda #100
  sta $d012
  lda #1
  sta $d01a
  lda #0
  sta $03
  cli
loop: jmp loop
irq: pha
  lda #1
  sta $d019
  lda $03
  eor #1
  sta $03
  beq second
  lda #2
  sta $d020
  lda #150
  sta $d012
  pla
  rti
second: lda #5
  sta $d020
  lda #100
  sta $d012
  pla
  rti
nmi: rti
${VECTORS}`);
  for (let i = 0; i < 4; i++) c64.runFrame();
  const fb = c64.vic.getFrontBuffer();
  const at = (line) => fb[line * c64.vic.width + columnForX(PAL, 10)];
  assert.equal(at(120), 2);
  assert.equal(at(200), 5);
  assert.equal(at(60), 5);
});

test('Tastaturmatrix über CIA1: Taste A (PA1/PB2) und Joystick Port 2', () => {
  const { c64 } = makeTestC64(`
reset: lda #$ff
  sta $dc02
  lda #$00
  sta $dc03
  lda #$fd
  sta $dc00
  lda $dc01
  sta $10
  lda #$00
  sta $dc02
  lda $dc00
  sta $11
  jmp *
irq: rti
nmi: rti
${VECTORS}`);
  c64.keyboard.pressKey('A');
  c64.joysticks.setActive('up', true);
  c64.joysticks.setActive('fire', true);
  c64.runCycles(200);
  assert.equal(c64.memory.ram[0x10], 0xfb);
  assert.equal(c64.memory.ram[0x11] & 0x1f, 0x0e);
});

test('RESTORE erzeugt NMI; gehaltene CIA2-NMI-Leitung blockiert weitere Flanken', () => {
  const { c64 } = makeTestC64(`
reset: lda #0
  sta $11
loop: jmp loop
nmi: inc $11
  rti
irq: rti
${VECTORS}`);
  c64.runCycles(100);
  c64.pressRestore();
  c64.runCycles(5000);
  assert.equal(c64.memory.ram[0x11], 1);
  c64.cia2.write(0xd, 0x81);
  c64.cia2.write(0x4, 0x10);
  c64.cia2.write(0x5, 0x00);
  c64.cia2.write(0xe, 0x09);
  c64.runCycles(100);
  assert.equal(c64.memory.ram[0x11], 2);
  c64.pressRestore();
  c64.runCycles(5000);
  assert.equal(c64.memory.ram[0x11], 2);
});

test('INC $D019 quittiert über den RMW-Dummy-Schreibzugriff', () => {
  const { c64 } = makeTestC64(`
reset: inc $d019
  jmp *
irq: rti
nmi: rti
${VECTORS}`);
  c64.vic.irqFlags = 0x01;
  c64.runCycles(50);
  assert.equal(c64.vic.irqFlags, 0);
});

const openRomsDir = process.env.C64_OPENROMS_DIR || testDataPath('openroms');
const hasOpenRoms = existsSync(`${openRomsDir}/kernal_generic.rom`);

test('Kaltstart mit Open-ROMs (extern, LGPL) bis READY. und Direktmodus', { skip: hasOpenRoms ? false : 'Open-ROMs nicht vorhanden' }, () => {
  const c64 = new C64();
  c64.loadRoms({
    basic: readFileSync(`${openRomsDir}/basic_generic.rom`),
    kernal: readFileSync(`${openRomsDir}/kernal_generic.rom`),
    chargen: readFileSync(`${openRomsDir}/chargen_openroms.rom`)
  });
  c64.powerOn();
  c64.runSeconds(3);
  assert.ok(c64.readScreenText().includes('READY.'));
  c64.typeText('POKE 53280,2\r10 PRINT "HALLO"\rRUN\r');
  c64.runSeconds(6);
  assert.equal(c64.vic.borderColor, 2);
  assert.ok(c64.readScreenText().some((line) => line.trim() === 'HALLO'));
});

const originalRoms = ['basic.rom', 'kernal.rom', 'chargen.rom'].map((name) => romPath(name));
const hasOriginal = originalRoms.every((file) => existsSync(file));

test('Kaltstart mit Original-ROMs (lokal bereitgestellt)', { skip: hasOriginal ? false : 'rom/basic.rom, kernal.rom, chargen.rom fehlen' }, () => {
  const c64 = new C64();
  c64.loadRoms({
    basic: readFileSync(originalRoms[0]),
    kernal: readFileSync(originalRoms[1]),
    chargen: readFileSync(originalRoms[2])
  });
  c64.powerOn();
  c64.runSeconds(3);
  const screen = c64.readScreenText();
  assert.ok(screen.some((line) => line.includes('COMMODORE 64 BASIC V2')));
  assert.ok(screen.includes('READY.'));
  c64.typeText('POKE 53280,2:PRINT PEEK(53280)AND15\r');
  c64.runSeconds(2);
  assert.equal(c64.vic.borderColor, 2);
  assert.ok(c64.readScreenText().some((line) => line.trim() === '2'));
});
