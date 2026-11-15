import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPCODES } from '../core/OpcodeTable.js';
import { makeCpu, runUntil } from './helpers.js';

test('Opcodetabelle: 256 Einträge, 151 offizielle Opcodes', () => {
  assert.equal(OPCODES.length, 256);
  assert.equal(OPCODES.filter((o) => o.official).length, 151);
  assert.equal(OPCODES.filter((o) => o.kind === 'jam').length, 12);
});

test('Taktzahlen offizieller Befehle inklusive Page-Crossing', () => {
  const cases = [
    ['lda #1', 2],
    ['lda $10', 3],
    ['lda $10,x', 4],
    ['lda $1234', 4],
    ['lda $12f0,x', 5, { x: 0x20 }],
    ['lda $1200,x', 4, { x: 0x20 }],
    ['lda $12f0,y', 5, { y: 0x20 }],
    ['lda ($20,x)', 6],
    ['lda ($30),y', 6, { y: 0xff }, [0x30, 0x01, 0x31, 0x20]],
    ['lda ($30),y', 5, { y: 0x01 }, [0x30, 0x01, 0x31, 0x20]],
    ['sta $1234,x', 5],
    ['sta ($30),y', 6],
    ['inc $10', 5],
    ['inc $10,x', 6],
    ['inc $1234', 6],
    ['inc $1234,x', 7],
    ['jmp $0300', 3],
    ['jmp ($0300)', 5],
    ['jsr $0300', 6],
    ['pha', 3],
    ['pla', 4],
    ['php', 3],
    ['plp', 4],
    ['nop', 2],
    ['brk', 7],
    ['slo ($30),y', 8],
    ['dcp $1234,y', 7],
    ['nop $1234,x', 5, { x: 0xff }]
  ];
  for (const [source, expected, regs = {}, poke = []] of cases) {
    const { cpu, bus } = makeCpu(source);
    cpu.setRegisters({ ...regs, pc: 0x0200 });
    for (let i = 0; i < poke.length; i += 2) {
      bus.memory[poke[i]] = poke[i + 1];
    }
    assert.equal(cpu.runInstruction(), expected, source);
  }
});

test('Branch-Taktzahlen: nicht genommen 2, genommen 3, mit Seitenwechsel 4', () => {
  let ctx = makeCpu('bne target\ntarget: nop', 0x0200);
  ctx.cpu.setRegisters({ p: 0x26, pc: 0x0200 });
  assert.equal(ctx.cpu.runInstruction(), 2);
  ctx = makeCpu('bne target\ntarget: nop', 0x0200);
  ctx.cpu.setRegisters({ p: 0x24, pc: 0x0200 });
  assert.equal(ctx.cpu.runInstruction(), 3);
  ctx = makeCpu('* = $02f0\nbne target\n.fill $20\ntarget: nop', 0x02f0);
  ctx.cpu.setRegisters({ p: 0x24, pc: 0x02f0 });
  assert.equal(ctx.cpu.runInstruction(), 4);
  assert.equal(ctx.cpu.pc, 0x0312);
});

test('Read-Modify-Write erzeugt Dummy-Write mit Originalwert', () => {
  const { cpu, bus } = makeCpu('inc $d019');
  bus.memory[0xd019] = 0x81;
  bus.logging = true;
  cpu.runInstruction();
  assert.deepEqual(bus.log, [
    ['r', 0x0200, 0xee],
    ['r', 0x0201, 0x19],
    ['r', 0x0202, 0xd0],
    ['r', 0xd019, 0x81],
    ['w', 0xd019, 0x81],
    ['w', 0xd019, 0x82]
  ]);
});

test('Indizierter Zugriff mit Seitenwechsel liest zuerst die falsche Seite', () => {
  const { cpu, bus } = makeCpu('lda $12ff,x');
  cpu.setRegisters({ x: 2, pc: 0x0200 });
  bus.logging = true;
  cpu.runInstruction();
  assert.deepEqual(bus.log.slice(3).map((e) => e[1]), [0x1201, 0x1301]);
});

test('JMP indirekt mit NMOS-Seitenfehler', () => {
  const { cpu, bus } = makeCpu('jmp ($02ff)', 0x0400);
  bus.memory[0x02ff] = 0x34;
  bus.memory[0x0300] = 0x99;
  bus.memory[0x0200] = 0x12;
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x1234);
});

test('BCD-Arithmetik mit NMOS-Flags', () => {
  const adc = (a, v, c) => {
    const { cpu } = makeCpu(`sed\n${c ? 'sec' : 'clc'}\nlda #${a}\nadc #${v}`);
    for (let i = 0; i < 4; i++) cpu.runInstruction();
    return { a: cpu.a, c: cpu.flagC, z: cpu.flagZ, n: cpu.flagN, v: cpu.flagV };
  };
  const sbc = (a, v, c) => {
    const { cpu } = makeCpu(`sed\n${c ? 'sec' : 'clc'}\nlda #${a}\nsbc #${v}`);
    for (let i = 0; i < 4; i++) cpu.runInstruction();
    return { a: cpu.a, c: cpu.flagC, z: cpu.flagZ, n: cpu.flagN };
  };
  assert.deepEqual(adc(0x09, 0x01, 0), { a: 0x10, c: 0, z: 0, n: 0, v: 0 });
  assert.deepEqual(adc(0x99, 0x01, 0), { a: 0x00, c: 1, z: 0, n: 1, v: 0 });
  assert.deepEqual(adc(0x58, 0x46, 1), { a: 0x05, c: 1, z: 0, n: 1, v: 1 });
  assert.deepEqual(adc(0x79, 0x00, 1), { a: 0x80, c: 0, z: 0, n: 1, v: 1 });
  assert.deepEqual(sbc(0x00, 0x01, 1), { a: 0x99, c: 0, z: 0, n: 1 });
  assert.deepEqual(sbc(0x46, 0x12, 1), { a: 0x34, c: 1, z: 0, n: 0 });
  assert.deepEqual(sbc(0x40, 0x13, 1), { a: 0x27, c: 1, z: 0, n: 0 });
});

test('Stack: JSR/RTS und PHP/PLP', () => {
  const { cpu, bus } = makeCpu('jsr sub\nbrk\nsub: php\nplp\nrts');
  cpu.runInstruction();
  assert.equal(cpu.s, 0xfd);
  assert.equal(bus.memory[0x01ff], 0x02);
  assert.equal(bus.memory[0x01fe], 0x02);
  cpu.runInstruction();
  assert.equal(bus.memory[0x01fd] & 0x30, 0x30);
  cpu.runInstruction();
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x0203);
  assert.equal(cpu.s, 0xff);
});

test('BRK legt B-Flag ab, RTI kehrt hinter das Padding-Byte zurück', () => {
  const { cpu, bus } = makeCpu('brk\n.byte $ea\nnop\n* = $0300\nrti', 0x0200, { irq: 0x0300 });
  assert.equal(cpu.runInstruction(), 7);
  assert.equal(cpu.pc, 0x0300);
  assert.equal(cpu.flagI, 1);
  assert.equal(bus.memory[0x01fd] & 0x10, 0x10);
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x0202);
});

test('RESET-Sequenz: 7 Takte, S um 3 verringert, Vektor $FFFC', () => {
  const { cpu, bus } = makeCpu('nop', 0x0200);
  cpu.setRegisters({ s: 0x00, pc: 0x1000 });
  cpu.reset();
  bus.logging = true;
  assert.equal(cpu.runInstruction(), 7);
  assert.equal(cpu.pc, 0x0200);
  assert.equal(cpu.s, 0xfd);
  assert.equal(cpu.flagI, 1);
  assert.ok(bus.log.every((entry) => entry[0] === 'r'));
});

test('IRQ wird erst nach dem auf CLI folgenden Befehl ausgeführt', () => {
  const { cpu } = makeCpu('sei\ncli\nnop\nnop\nnop\n* = $0300\nnop', 0x0200, { irq: 0x0300 });
  cpu.runInstruction();
  cpu.irqLine = true;
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x0202);
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x0203);
  assert.equal(cpu.runInstruction(), 7);
  assert.equal(cpu.pc, 0x0300);
});

test('IRQ unmittelbar nach SEI wird noch angenommen', () => {
  const { cpu } = makeCpu('cli\nnop\nsei\nnop\n* = $0300\nnop', 0x0200, { irq: 0x0300 });
  cpu.runInstruction();
  cpu.runInstruction();
  cpu.irqLine = true;
  cpu.runInstruction();
  assert.equal(cpu.flagI, 1);
  assert.equal(cpu.runInstruction(), 7);
  assert.equal(cpu.pc, 0x0300);
});

test('IRQ muss vor dem vorletzten Takt anliegen', () => {
  const late = makeCpu('cli\nlda $1234\nnop\n* = $0300\nnop', 0x0200, { irq: 0x0300 });
  late.cpu.runInstruction();
  late.cpu.cycle();
  late.cpu.cycle();
  late.cpu.cycle();
  late.cpu.irqLine = true;
  late.cpu.cycle();
  assert.equal(late.cpu.t, 0);
  late.cpu.runInstruction();
  assert.equal(late.cpu.pc, 0x0205);
  const early = makeCpu('cli\nlda $1234\nnop\n* = $0300\nnop', 0x0200, { irq: 0x0300 });
  early.cpu.runInstruction();
  early.cpu.cycle();
  early.cpu.cycle();
  early.cpu.irqLine = true;
  early.cpu.cycle();
  early.cpu.cycle();
  assert.equal(early.cpu.runInstruction(), 7);
  assert.equal(early.cpu.pc, 0x0300);
});

test('Genommener Branch ohne Seitenwechsel verzögert neuen IRQ um einen Befehl', () => {
  const { cpu } = makeCpu('cli\nclc\nbcc next\nnext: nop\nnop\n* = $0300\nnop', 0x0200, { irq: 0x0300 });
  cpu.runInstruction();
  cpu.runInstruction();
  cpu.cycle();
  cpu.irqLine = true;
  cpu.cycle();
  cpu.cycle();
  assert.equal(cpu.t, 0);
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x0205);
  assert.equal(cpu.runInstruction(), 7);
  assert.equal(cpu.pc, 0x0300);
});

test('NMI ist flankengesteuert', () => {
  const { cpu } = makeCpu('nop\nnop\nnop\nnop\nnop\n* = $0300\nrti', 0x0200, { nmi: 0x0300 });
  cpu.nmiLine = true;
  cpu.runInstruction();
  assert.equal(cpu.runInstruction(), 7);
  assert.equal(cpu.pc, 0x0300);
  cpu.runInstruction();
  cpu.runInstruction();
  cpu.runInstruction();
  assert.notEqual(cpu.pc, 0x0300);
  cpu.nmiLine = false;
  cpu.runInstruction();
  cpu.nmiLine = true;
  cpu.runInstruction();
  cpu.runInstruction();
  assert.equal(cpu.pc, 0x0300);
});

test('NMI kapert eine laufende BRK-Sequenz', () => {
  const { cpu, bus } = makeCpu('brk\n* = $0300\nnop\n* = $0400\nnop', 0x0200, { irq: 0x0300, nmi: 0x0400 });
  cpu.cycle();
  cpu.cycle();
  cpu.nmiLine = true;
  for (let i = 0; i < 5; i++) cpu.cycle();
  assert.equal(cpu.pc, 0x0400);
  assert.equal(bus.memory[0x01fd] & 0x10, 0x10);
});

test('RDY hält nur Lesezyklen an, Schreibzyklen laufen weiter', () => {
  const { cpu, bus } = makeCpu('inc $1000\nnop');
  bus.logging = true;
  cpu.cycle();
  cpu.cycle();
  cpu.cycle();
  cpu.cycle();
  cpu.rdy = false;
  cpu.cycle();
  cpu.cycle();
  assert.equal(bus.log.filter((e) => e[0] === 'w').length, 2);
  cpu.cycle();
  cpu.cycle();
  assert.equal(cpu.stalled, true);
  assert.equal(bus.log.length, 6);
  cpu.rdy = true;
  cpu.cycle();
  assert.equal(bus.log.length, 7);
});

test('SHA verliert das "& (H+1)", wenn RDY im Takt davor low war', () => {
  const normal = makeCpu('sha $12f0,y');
  normal.cpu.setRegisters({ a: 0xff, x: 0xff, y: 0x05, pc: 0x0200 });
  normal.cpu.runInstruction();
  assert.equal(normal.bus.memory[0x12f5], 0x13);
  const stalled = makeCpu('sha $12f0,y');
  stalled.cpu.setRegisters({ a: 0xff, x: 0xff, y: 0x05, pc: 0x0200 });
  stalled.cpu.cycle();
  stalled.cpu.cycle();
  stalled.cpu.cycle();
  stalled.cpu.rdy = false;
  stalled.cpu.cycle();
  stalled.cpu.rdy = true;
  stalled.cpu.cycle();
  stalled.cpu.cycle();
  assert.equal(stalled.bus.memory[0x12f5], 0xff);
});

test('JAM hält die CPU an, nur RESET beendet den Zustand', () => {
  const { cpu } = makeCpu('.byte $02\nnop', 0x0200);
  for (let i = 0; i < 20; i++) cpu.cycle();
  assert.equal(cpu.jammed, true);
  const pc = cpu.pc;
  for (let i = 0; i < 20; i++) cpu.cycle();
  assert.equal(cpu.pc, pc);
  cpu.reset();
  cpu.runInstruction();
  assert.equal(cpu.jammed, false);
  assert.equal(cpu.pc, 0x0200);
});

test('Zählschleife mit fester Taktzahl', () => {
  const { cpu } = makeCpu('ldx #10\nloop: dex\nbne loop\nbrk');
  const cycles = runUntil(cpu, (c) => c.pc === 0x0205);
  assert.equal(cycles, 2 + 10 * 2 + 9 * 3 + 2);
});
