import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../core/Memory.js';
import { MemoryBus, PAGE, computePageMap } from '../core/MemoryBus.js';
import { ProcessorPort } from '../core/ProcessorPort.js';
import { ProcessorPortBus } from '../core/CPU6510.js';
import { InterruptController } from '../core/InterruptController.js';

function setup() {
  const memory = new Memory();
  memory.basicRom.fill(0xbb);
  memory.kernalRom.fill(0xee);
  memory.charRom.fill(0xcc);
  const bus = new MemoryBus(memory);
  return { memory, bus };
}

const NAMES = ['RAM', 'BASIC', 'KERNAL', 'CHAR', 'IO', 'ROML', 'ROMH', 'OPEN'];

function layout(loram, hiram, charen, game = 1, exrom = 1) {
  const { read } = computePageMap(loram, hiram, charen, game, exrom);
  return [0x1, 0x8, 0xa, 0xc, 0xd, 0xe].map((page) => NAMES[read[page]]).join(' ');
}

test('PLA ohne Modul: alle 8 Kombinationen von LORAM/HIRAM/CHAREN', () => {
  assert.equal(layout(1, 1, 1), 'RAM RAM BASIC RAM IO KERNAL');
  assert.equal(layout(0, 1, 1), 'RAM RAM RAM RAM IO KERNAL');
  assert.equal(layout(1, 0, 1), 'RAM RAM RAM RAM IO RAM');
  assert.equal(layout(0, 0, 1), 'RAM RAM RAM RAM RAM RAM');
  assert.equal(layout(1, 1, 0), 'RAM RAM BASIC RAM CHAR KERNAL');
  assert.equal(layout(0, 1, 0), 'RAM RAM RAM RAM CHAR KERNAL');
  assert.equal(layout(1, 0, 0), 'RAM RAM RAM RAM CHAR RAM');
  assert.equal(layout(0, 0, 0), 'RAM RAM RAM RAM RAM RAM');
});

test('PLA mit 8K-, 16K- und Ultimax-Modul', () => {
  assert.equal(layout(1, 1, 1, 1, 0), 'RAM ROML BASIC RAM IO KERNAL');
  assert.equal(layout(1, 1, 1, 0, 0), 'RAM ROML ROMH RAM IO KERNAL');
  assert.equal(layout(0, 1, 1, 0, 0), 'RAM RAM ROMH RAM IO KERNAL');
  assert.equal(layout(1, 0, 1, 0, 0), 'RAM RAM RAM RAM IO RAM');
  assert.equal(layout(1, 0, 0, 0, 0), 'RAM RAM RAM RAM RAM RAM');
  assert.equal(layout(1, 1, 0, 0, 0), 'RAM ROML ROMH RAM CHAR KERNAL');
  assert.equal(layout(0, 0, 0, 0, 1), 'OPEN ROML OPEN OPEN IO ROMH');
  assert.equal(layout(1, 1, 1, 0, 1), 'OPEN ROML OPEN OPEN IO ROMH');
});

test('ROM-Bereiche schreiben in das darunterliegende RAM', () => {
  const { bus, memory } = setup();
  bus.write(0xa000, 0x12);
  bus.write(0xe000, 0x34);
  assert.equal(bus.read(0xa000), 0xbb);
  assert.equal(bus.read(0xe000), 0xee);
  assert.equal(memory.ram[0xa000], 0x12);
  assert.equal(memory.ram[0xe000], 0x34);
  bus.setCpuLines(0, 0, 1);
  assert.equal(bus.read(0xa000), 0x12);
  assert.equal(bus.read(0xe000), 0x34);
});

test('Zeichen-ROM für die CPU bei CHAREN=0', () => {
  const { bus } = setup();
  bus.setCpuLines(1, 1, 0);
  assert.equal(bus.read(0xd000), 0xcc);
  bus.write(0xd000, 0x55);
  assert.equal(bus.read(0xd000), 0xcc);
  bus.setCpuLines(0, 0, 0);
  assert.equal(bus.read(0xd000), 0x55);
});

test('Color-RAM: 4 Bit, obere Bits aus dem Open Bus', () => {
  const { bus, memory } = setup();
  bus.write(0xd800, 0xff);
  assert.equal(memory.colorRam[0], 0x0f);
  bus.phi1Data = 0xa0;
  assert.equal(bus.read(0xd800), 0xaf);
  bus.phi1Data = 0x30;
  assert.equal(bus.read(0xdbff + 1 - 0x400), 0x3f);
});

test('I/O-Dekodierung und Spiegelung', () => {
  const { bus } = setup();
  const accesses = [];
  const chip = (name) => ({
    read: (reg) => { accesses.push(`${name}r${reg}`); return 0x42; },
    write: (reg, v) => accesses.push(`${name}w${reg}=${v}`),
    peek: () => 0
  });
  bus.connect({ vic: chip('vic'), sid: chip('sid'), cia1: chip('cia1'), cia2: chip('cia2') });
  bus.read(0xd040);
  bus.read(0xd3ff);
  bus.write(0xd420, 1);
  bus.read(0xdc10);
  bus.write(0xdd1d, 2);
  bus.phi1Data = 0x77;
  assert.equal(bus.read(0xde00), 0x77);
  assert.equal(bus.read(0xdf80), 0x77);
  assert.deepEqual(accesses, ['vicr0', 'vicr63', 'sidw0=1', 'cia1r0', 'cia2w13=2']);
});

test('VIC-Sicht: Bankwahl und Zeichen-ROM in Bank 0 und 2', () => {
  const { bus, memory } = setup();
  memory.ram[0x1000] = 0x11;
  memory.ram[0x5000] = 0x22;
  memory.ram[0x9000] = 0x33;
  memory.ram[0xd000] = 0x44;
  bus.setVicBank(0);
  assert.equal(bus.vicRead(0x1000), 0xcc);
  bus.setVicBank(1);
  assert.equal(bus.vicRead(0x1000), 0x22);
  bus.setVicBank(2);
  assert.equal(bus.vicRead(0x1000), 0xcc);
  bus.setVicBank(3);
  assert.equal(bus.vicRead(0x1000), 0x44);
  assert.equal(bus.phi1Data, 0x44);
  bus.setVicBank(0);
  memory.ram[0x0400] = 0x99;
  assert.equal(bus.vicRead(0x0400), 0x99);
});

test('Prozessorport: Grundzustand, Banking und Kassettenbits', () => {
  const clock = { cycles: 0 };
  const port = new ProcessorPort(clock);
  const { bus } = setup();
  port.onChange = (l, h, c) => bus.setCpuLines(l, h, c);
  port.reset();
  assert.equal(bus.mapName(0xa000), 'BASIC');
  port.write(0, 0x2f);
  port.write(1, 0x37);
  assert.equal(port.read(0), 0x2f);
  assert.equal(port.read(1), 0x37);
  port.setCassetteSense(true);
  assert.equal(port.read(1) & 0x10, 0);
  port.write(1, 0x36);
  assert.equal(bus.mapName(0xa000), 'RAM');
  assert.equal(bus.mapName(0xd000), 'IO');
  assert.equal(bus.mapName(0xe000), 'KERNAL');
});

test('Prozessorport: Floating-Bits 6/7 halten Wert und fallen ab', () => {
  const clock = { cycles: 1000 };
  const port = new ProcessorPort(clock, { falloffCycles: 5000 });
  port.write(0, 0xef);
  port.write(1, 0xc0);
  port.write(0, 0x2f);
  assert.equal(port.read(1) & 0xc0, 0xc0);
  clock.cycles = 7000;
  assert.equal(port.read(1) & 0xc0, 0x00);
});

test('CPU-Schreibzugriff auf $0000/$0001 schreibt Open-Bus-Wert ins RAM', () => {
  const { bus, memory } = setup();
  const port = new ProcessorPort({ cycles: 0 });
  const portBus = new ProcessorPortBus(bus, port);
  bus.phi1Data = 0x5a;
  portBus.write(0x0001, 0x37);
  assert.equal(memory.ram[1], 0x5a);
  assert.equal(portBus.read(0x0001) & 0x07, 0x07);
});

test('InterruptController: Wired-OR mehrerer Quellen', () => {
  const cpu = { irqLine: false, nmiLine: false };
  const ic = new InterruptController(cpu);
  ic.setIrq(1, true);
  ic.setIrq(2, true);
  ic.setIrq(1, false);
  assert.equal(cpu.irqLine, true);
  ic.setIrq(2, false);
  assert.equal(cpu.irqLine, false);
  ic.setNmi(1, true);
  ic.setNmi(2, true);
  ic.setNmi(2, false);
  assert.equal(cpu.nmiLine, true);
});

test('Seitentypen sind konsistent mit PAGE-Konstanten', () => {
  assert.equal(PAGE.IO, 4);
  assert.equal(NAMES[PAGE.KERNAL], 'KERNAL');
});
