import { test, assertEqual, assertTrue, assertThrows, assertBytes } from './harness.js';
import { Memory } from '../core/Memory.js';
import { ProcessorPort6510 } from '../core/ProcessorPort6510.js';
import { ROMManager } from '../core/ROMManager.js';
import { MemoryBus } from '../core/MemoryBus.js';
import { C64 } from '../core/C64.js';

function fixture() {
  const memory = new Memory();
  const port = new ProcessorPort6510();
  const roms = new ROMManager();
  roms.load('basic', new Uint8Array(8192).fill(0xa1));
  roms.load('kernal', new Uint8Array(8192).fill(0xe1));
  roms.load('chargen', new Uint8Array(4096).fill(0xd1));
  return { memory, port, roms, bus: new MemoryBus(memory, roms, port) };
}

test('RAM hat 65536 adressierbare Bytes und 16-Bit-Adresswrap', () => {
  const memory = new Memory();
  memory.writeRAM(0x1234, 0xab);
  memory.writeRAM(0x1ffff, 0x34);
  assertEqual(memory.readRAM(0x1234), 0xab);
  assertEqual(memory.readRAM(0xffff), 0x34);
});

test('Color-RAM speichert ausschließlich das untere Nibble', () => {
  const memory = new Memory();
  memory.writeColor(0, 0xbd);
  assertEqual(memory.readColor(0), 0x0d);
  assertEqual(memory.readColor(1024), 0x0d);
});

test('Prozessorport arbeitet mit DDR, Ausgangslatch und Eingangspegeln', () => {
  const port = new ProcessorPort6510();
  assertEqual(port.readDDR(), 0x2f);
  assertEqual(port.getBankBits(), 7);
  port.writeDDR(0x01);
  port.writePins(0x00);
  port.setExternalPins(0xfe);
  assertEqual(port.readPins(), 0xfe);
  port.writeDDR(0x00);
  assertEqual(port.readPins(), 0xfe);
  port.setExternalPins(0xfd);
  assertEqual(port.getBankBits(), 5);
});

test('ROM-Größen werden geprüft und Eingabepuffer kopiert', () => {
  const manager = new ROMManager();
  assertThrows(() => manager.load('basic', new Uint8Array(16)), RangeError);
  assertThrows(() => manager.load('unknown', new Uint8Array(8192)), RangeError);
  const bytes = new Uint8Array(8192);
  bytes[0] = 0x44;
  manager.load('basic', bytes);
  bytes[0] = 0x99;
  assertEqual(manager.read('basic', 0), 0x44);
  assertEqual(manager.isComplete(), false);
});

test('Alle acht Kombinationen der C64-Banking-Bits', () => {
  const { bus, port } = fixture();
  const expected = [
    [false, false, 'ram'],
    [false, false, 'chargen'],
    [false, true, 'chargen'],
    [true, true, 'chargen'],
    [false, false, 'ram'],
    [false, false, 'io'],
    [false, true, 'io'],
    [true, true, 'io']
  ];
  port.writeDDR(0x07);
  for (let bits = 0; bits < 8; bits += 1) {
    port.writePins(bits);
    const mapping = bus.getMapping();
    assertEqual(mapping.basic, expected[bits][0], `BASIC Mapping ${bits}`);
    assertEqual(mapping.kernal, expected[bits][1], `KERNAL Mapping ${bits}`);
    assertEqual(mapping.d000, expected[bits][2], `D000 Mapping ${bits}`);
  }
});

test('ROM-RAM-Overlay bewahrt Schreibzugriffe unter BASIC und KERNAL', () => {
  const { bus, port, memory } = fixture();
  assertEqual(bus.cpuRead(0xa000), 0xa1);
  assertEqual(bus.cpuRead(0xe000), 0xe1);
  bus.cpuWrite(0xa000, 0x42);
  bus.cpuWrite(0xe000, 0x73);
  assertEqual(bus.cpuRead(0xa000), 0xa1);
  assertEqual(bus.cpuRead(0xe000), 0xe1);
  assertEqual(memory.readRAM(0xa000), 0x42);
  assertEqual(memory.readRAM(0xe000), 0x73);
  port.writePins(0x34);
  assertEqual(bus.cpuRead(0xa000), 0x42);
  assertEqual(bus.cpuRead(0xe000), 0x73);
});

test('Bei ausgeblendetem I/O ist CHAR-ROM lesbar und RAM beschreibbar', () => {
  const { bus, port, memory } = fixture();
  port.writePins(0x33);
  assertEqual(bus.cpuRead(0xd000), 0xd1);
  bus.cpuWrite(0xd000, 0x4d);
  assertEqual(bus.cpuRead(0xd000), 0xd1);
  assertEqual(memory.readRAM(0xd000), 0x4d);
  port.writePins(0x30);
  assertEqual(bus.cpuRead(0xd000), 0x4d);
});

test('I/O-Registerspiegelung und Schreib-Seiteneffekte', () => {
  const { bus, memory } = fixture();
  const events = [];
  bus.attachDevice('vic', {
    readRegister: offset => 0x80 | offset,
    writeRegister: (offset, value) => events.push([offset, value]),
    peekRegister: offset => 0x40 | offset
  });
  bus.cpuWrite(0xd040, 0x2a);
  bus.cpuWrite(0xd03f, 0x1b);
  assertBytes(events.flat(), [0, 0x2a, 0x3f, 0x1b]);
  assertEqual(bus.cpuRead(0xd040), 0x80);
  assertEqual(bus.peek(0xd040), 0x40);
  assertEqual(memory.readRAM(0xd040), 0);
});

test('Color-RAM im I/O-Bereich und angenähertes oberes Datenbus-Nibble', () => {
  const { bus } = fixture();
  bus.cpuWrite(0xd800, 0x5c);
  assertEqual(bus.cpuRead(0xd800), 0x5c);
  bus.cpuWrite(0x4000, 0xa0);
  assertEqual(bus.cpuRead(0xd800), 0xac);
});

test('Offener I/O-Bus liefert letzten Datenbuswert', () => {
  const { bus } = fixture();
  bus.cpuWrite(0x4000, 0x6b);
  assertEqual(bus.cpuRead(0xde00), 0x6b);
});

test('ROM-Manager erkennt vollständigen ROM-Satz', () => {
  const { roms } = fixture();
  assertTrue(roms.isComplete());
  assertEqual(roms.read('chargen', 0xfff), 0xd1);
});

test('System-Reset löscht den RAM nicht, Power-On initialisiert ihn', () => {
  const c64 = new C64();
  c64.bus.cpuWrite(0x4000, 0x7a);
  c64.reset();
  assertEqual(c64.memory.readRAM(0x4000), 0x7a);
  c64.powerOn();
  assertEqual(c64.memory.readRAM(0x4000), 0x00);
});
