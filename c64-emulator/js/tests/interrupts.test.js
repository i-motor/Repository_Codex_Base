import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCpu, makeTestC64 } from './helpers.js';

const VECTORS = `
* = $fffa
.word nmi, reset, irq
`;

test('IRQ-Leitung als Wired-OR von VIC und CIA1', () => {
  const { c64 } = makeTestC64(`
reset: sei
  jmp *
irq: rti
nmi: rti
${VECTORS}`);
  c64.vic.write(0x1a, 0x01);
  c64.vic.raiseIrq(0x01);
  c64.cia1.write(0xd, 0x81);
  c64.cia1.raise(0x01);
  c64.cia1.cycle();
  assert.equal(c64.cpu.irqLine, true);
  c64.vic.write(0x19, 0x01);
  assert.equal(c64.cpu.irqLine, true);
  c64.cia1.read(0xd);
  assert.equal(c64.cpu.irqLine, false);
});

test('Hardware-IRQ legt B=0 ab, BRK legt B=1 ab', () => {
  const irq = makeCpu('cli\nnop\nnop\n* = $0300\nrti', 0x0200, { irq: 0x0300 });
  irq.cpu.runInstruction();
  irq.cpu.irqLine = true;
  irq.cpu.runInstruction();
  irq.cpu.runInstruction();
  assert.equal(irq.cpu.pc, 0x0300);
  assert.equal(irq.bus.memory[0x01fd] & 0x10, 0);
  const brk = makeCpu('brk\n* = $0300\nrti', 0x0200, { irq: 0x0300 });
  brk.cpu.runInstruction();
  assert.equal(brk.bus.memory[0x01fd] & 0x10, 0x10);
});

test('Nach einer Interruptsequenz wird mindestens ein Befehl ausgeführt', () => {
  const { cpu } = makeCpu('cli\nnop\nnop\n* = $0300\ninx\ninx\nrti', 0x0200, { irq: 0x0300, nmi: 0x0300 });
  cpu.runInstruction();
  cpu.irqLine = true;
  cpu.runInstruction();
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x0300);
  cpu.nmiLine = true;
  cpu.runInstruction();
  assert.equal(cpu.x, 1);
});

test('CIA2-Timer erzeugt NMI, Quittierung durch Lesen von $DD0D', () => {
  const { c64 } = makeTestC64(`
reset: sei
  lda #0
  sta $12
  lda #$63
  sta $dd04
  lda #0
  sta $dd05
  lda #$81
  sta $dd0d
  lda #$11
  sta $dd0e
loop: jmp loop
nmi: pha
  lda $dd0d
  inc $12
  pla
  rti
irq: rti
${VECTORS}`);
  c64.vic.write(0x11, 0x0b);
  c64.runCycles(100 * 50 + 200);
  const count = c64.memory.ram[0x12];
  assert.ok(count >= 50 && count <= 52, `count=${count}`);
});

test('IRQ während RDY-Stall wird nach Ende des Stalls angenommen', () => {
  const { cpu } = makeCpu('cli\nnop\nnop\nnop\n* = $0300\nrti', 0x0200, { irq: 0x0300 });
  cpu.runInstruction();
  cpu.rdy = false;
  cpu.irqLine = true;
  for (let i = 0; i < 10; i++) cpu.cycle();
  assert.equal(cpu.pc, 0x0201);
  cpu.rdy = true;
  cpu.runInstruction();
  assert.equal(cpu.runInstruction(), 7);
  assert.equal(cpu.pc, 0x0300);
});
