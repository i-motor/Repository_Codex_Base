import { test, assertEqual, assertTrue, assertBytes } from './harness.js';
import { C64 } from '../core/C64.js';
import { VideoTiming } from '../video/VideoTiming.js';
import { VICMemory } from '../video/VICMemory.js';
import { CharacterGenerator } from '../video/CharacterGenerator.js';

function fixture() {
  const machine = new C64();
  const chargen = new Uint8Array(4096);
  chargen[8] = 0x80;
  chargen[9] = 0x40;
  machine.loadROM('chargen', chargen);
  machine.loadDiagnosticProgram(new Uint8Array([0x4c, 0x00, 0xc0]));
  machine.processorPort.writePins(0x35);
  machine.bus.cpuWrite(0xd011, 0x1b);
  machine.bus.cpuWrite(0xd016, 0x08);
  machine.bus.cpuWrite(0xd018, 0x14);
  machine.bus.cpuWrite(0xd020, 14);
  machine.bus.cpuWrite(0xd021, 6);
  machine.memory.writeRAM(0x0400, 1);
  machine.memory.writeColor(0, 2);
  return machine;
}

function pixel(machine, x, y) {
  return machine.vic.getFrame().data[(y - 16) * 404 + x - 76];
}

test('VIC Timing: 312 PAL-Zeilen mit je 63 Zyklen und 8 Dot-Positionen', () => {
  const timing = new VideoTiming();
  assertEqual(timing.cyclesPerFrame, 19656);
  assertEqual(timing.position(19656).frame, 1);
  assertEqual(timing.position(51 * 63).raster, 51);
  assertEqual(timing.position(51 * 63 + 14).cycleInLine, 14);
  assertEqual(timing.profile.dotsPerCycle, 8);
});

test('Badline-Vorlauf: BA 3 CPU-Takte vor 40 gestohlenen Φ2-Zyklen', () => {
  const timing = new VideoTiming();
  assertEqual(timing.isBadline(51, 3, true), true);
  assertEqual(timing.isBadline(52, 3, true), false);
  assertEqual(timing.isBadline(51, 3, false), false);
  let steals = 0;
  let ba = 0;
  for (let c = 0; c < 63; c += 1) {
    const req = timing.busRequest(51, c, 3, true);
    if (req.baLow) ba += 1;
    if (req.stealsPhi2) steals += 1;
    if (c === 11) assertEqual(req.baLow, true);
    if (c === 14) assertEqual(req.stealsPhi2, true);
  }
  assertEqual(ba, 43);
  assertEqual(steals, 40);
});

test('VIC-Register werden mit 64-Byte-Maske im CPU-I/O-Bereich gespiegelt', () => {
  const m = fixture();
  m.bus.cpuWrite(0xd060, 5);
  assertEqual(m.vic.registers[0x20], 5);
  assertEqual(m.bus.cpuRead(0xd020), 0xf5);
  m.bus.cpuWrite(0xd058, 0x24);
  assertEqual(m.vic.getState().screenBase, 0x0800);
});

test('VIC-Rasterlesung aus D011 und D012 verwendet den aktuellen Rasterzähler', () => {
  const m = fixture();
  m.runCycles(256 * 63 + 1);
  assertEqual(m.bus.cpuRead(0xd012), 0);
  assertEqual(m.bus.cpuRead(0xd011) & 0x80, 0x80);
  m.runCycles(63);
  assertEqual(m.bus.cpuRead(0xd012), 1);
});

test('Rasterinterrupt wird im VIC gelatcht, maskiert und per D019 selektiv quittiert', () => {
  const m = fixture();
  m.bus.cpuWrite(0xd012, 4);
  m.bus.cpuWrite(0xd01a, 1);
  m.runCycles(4 * 63 + 1);
  assertTrue(m.interrupts.isIRQActive());
  assertEqual(m.bus.cpuRead(0xd019) & 0x81, 0x81);
  m.bus.cpuWrite(0xd019, 2);
  assertTrue(m.interrupts.isIRQActive());
  m.bus.cpuWrite(0xd019, 1);
  assertEqual(m.interrupts.isIRQActive(), false);
  assertEqual(m.bus.cpuRead(0xd019) & 0x81, 0);
});

test('IRQ-Masken können ein bestehendes VIC-Rasterinterrupt-Latch sichtbar machen', () => {
  const m = fixture();
  m.bus.cpuWrite(0xd012, 2);
  m.runCycles(2 * 63 + 1);
  assertEqual(m.interrupts.isIRQActive(), false);
  m.bus.cpuWrite(0xd01a, 1);
  assertEqual(m.interrupts.isIRQActive(), true);
  m.bus.cpuWrite(0xd019, 1);
  assertEqual(m.interrupts.isIRQActive(), false);
});

test('VIC-Chargen-ROM ist in Bank 0/2 sichtbar und in Bank 1/3 nicht', () => {
  const m = fixture();
  m.memory.writeRAM(0x1008, 0x22);
  m.memory.writeRAM(0x5008, 0x33);
  m.memory.writeRAM(0x9008, 0x44);
  m.memory.writeRAM(0xd008, 0x55);
  assertEqual(m.vicMemory.read(0x1008), 0x80);
  m.cia2.writeRegister(2, 3);
  m.cia2.writeRegister(0, 2);
  assertEqual(m.getVICBankBase(), 0x4000);
  assertEqual(m.vicMemory.read(0x1008), 0x33);
  m.cia2.writeRegister(0, 1);
  assertEqual(m.getVICBankBase(), 0x8000);
  assertEqual(m.vicMemory.read(0x1008), 0x80);
  m.cia2.writeRegister(0, 0);
  assertEqual(m.getVICBankBase(), 0xc000);
  assertEqual(m.vicMemory.read(0x1008), 0x55);
});

test('CPU-Banking und VIC-Banking bleiben vollständig voneinander getrennt', () => {
  const m = fixture();
  m.processorPort.writePins(0x30);
  assertEqual(m.bus.getMapping().d000, 'ram');
  assertEqual(m.vicMemory.read(0x1008), 0x80);
  m.processorPort.writePins(0x37);
  assertEqual(m.bus.getMapping().d000, 'io');
  assertEqual(m.vicMemory.read(0x1008), 0x80);
});

test('Originale 8x8-Bitmaske aus Zeichensatz-ROM erzeugt Zeichenpixel und Hintergrund', () => {
  const m = fixture();
  m.runCycles(19656);
  assertEqual(m.vic.getFrame().frameNumber, 1);
  assertEqual(pixel(m, 120, 51), 2);
  assertEqual(pixel(m, 121, 51), 6);
  assertEqual(pixel(m, 120, 52), 6);
  assertEqual(pixel(m, 121, 52), 2);
  assertEqual(pixel(m, 80, 22), 14);
  assertEqual(m.vic.getState().matrixFetches, 1000);
  assertEqual(m.vic.getState().graphicsFetches, 8000);
});

test('Bildschirmbasis aus D018 wählt echte Bildschirmmatrix in RAM', () => {
  const m = fixture();
  m.memory.writeRAM(0x0400, 0);
  m.memory.writeRAM(0x0800, 1);
  m.bus.cpuWrite(0xd018, 0x24);
  m.runCycles(19656);
  assertEqual(pixel(m, 120, 51), 2);
  assertEqual(m.vic.lastMatrixAddress >= 0x0800, true);
});

test('CPU-STA auf D018 bewirkt realen VIC-Bildschirmmatrixwechsel', () => {
  const m = fixture();
  m.memory.writeRAM(0x0400, 0);
  m.memory.writeRAM(0x0800, 1);
  m.loadDiagnosticProgram(new Uint8Array([0xa9, 0x24, 0x8d, 0x18, 0xd0, 0x4c, 0x05, 0xc0]));
  m.processorPort.writePins(0x35);
  m.runCycles(19656);
  assertEqual(m.vic.registers[0x18], 0x24);
  assertEqual(pixel(m, 120, 51), 2);
});

test('Benutzerdefinierter Zeichensatz aus RAM in VIC-Bank 1 ist unabhängig vom CHAR-ROM', () => {
  const m = fixture();
  m.cia2.writeRegister(2, 3);
  m.cia2.writeRegister(0, 2);
  m.memory.writeRAM(0x4400, 1);
  m.memory.writeRAM(0x5008, 0xff);
  m.memory.writeColor(0, 3);
  m.runCycles(19656);
  assertEqual(pixel(m, 120, 51), 3);
  assertEqual(pixel(m, 127, 51), 3);
});

test('Border-Farbe und Hintergrundfarbe werden aus D020/D021 gelesen', () => {
  const m = fixture();
  m.bus.cpuWrite(0xd020, 5);
  m.bus.cpuWrite(0xd021, 7);
  m.runCycles(19656);
  assertEqual(pixel(m, 100, 51), 5);
  assertEqual(pixel(m, 121, 51), 7);
});

test('VIC-Badline-DMA hält CPU-Lesezyklen an, ohne die CIA-Takte zu stoppen', () => {
  const m = fixture();
  m.traceEnabled = true;
  m.runCycles(51 * 63 + 63);
  const line = m.trace.filter(item => item.cycle >= 51 * 63 && item.cycle < 52 * 63);
  assertEqual(line.filter(item => item.owner === 'vic').length, 40);
  assertEqual(line.filter(item => item.repeatedRead).length, 3);
  assertEqual(m.cia1.cycles, 52 * 63);
  assertEqual(m.vic.getState().matrixFetches, 40);
});

test('VIC-Framebuffer enthält ausschließlich emulierte Farbindizes und tauscht pro Frame', () => {
  const m = fixture();
  m.runCycles(19656);
  const first = m.vic.getFrame().data;
  assertEqual(first.length, 404 * 284);
  m.bus.cpuWrite(0xd020, 1);
  m.runCycles(19656);
  const second = m.vic.getFrame().data;
  assertEqual(m.vic.getFrame().frameNumber, 2);
  assertEqual(second === first, false);
  assertEqual(pixel(m, 80, 22), 1);
  assertEqual(first[(22 - 16) * 404 + 4], 14);
});

test('Grafikmodus-Dekodierung bildet fünf reguläre und drei ungültige Kombinationen ab', () => {
  assertEqual(CharacterGenerator.mode(0x00, 0x00), 0);
  assertEqual(CharacterGenerator.mode(0x00, 0x10), 1);
  assertEqual(CharacterGenerator.mode(0x20, 0x00), 2);
  assertEqual(CharacterGenerator.mode(0x20, 0x10), 3);
  assertEqual(CharacterGenerator.mode(0x40, 0x00), 4);
  assertEqual(CharacterGenerator.mode(0x40, 0x10), 5);
  assertEqual(CharacterGenerator.mode(0x60, 0x00), 6);
  assertEqual(CharacterGenerator.mode(0x60, 0x10), 7);
});

test('ROM-Start arbeitet ausschließlich mit echtem synthetischem KERNAL-Maschinencode', () => {
  const m = new C64();
  const kernal = new Uint8Array(8192);
  kernal.fill(0xea);
  const bytes = [
    0xa9, 0x1b, 0x8d, 0x11, 0xd0,
    0xa9, 0x08, 0x8d, 0x16, 0xd0,
    0xa9, 0x14, 0x8d, 0x18, 0xd0,
    0xa9, 0x01, 0x8d, 0x00, 0x04,
    0xa9, 0x02, 0x8d, 0x00, 0xd8,
    0xa9, 0x0e, 0x8d, 0x20, 0xd0,
    0xa9, 0x06, 0x8d, 0x21, 0xd0,
    0x4c, 0x23, 0xe0
  ];
  kernal.set(bytes, 0);
  kernal[0x1ffc] = 0x00;
  kernal[0x1ffd] = 0xe0;
  const chargen = new Uint8Array(4096);
  chargen[8] = 0x80;
  m.loadROM('kernal', kernal);
  m.loadROM('chargen', chargen);
  m.powerOn();
  m.runCycles(19656);
  assertEqual(m.memory.readRAM(0x0400), 1);
  assertEqual(m.memory.readColor(0), 2);
  assertEqual(m.cpu.getState().jammed, false);
  assertEqual(pixel(m, 120, 51), 2);
  assertEqual(pixel(m, 121, 51), 6);
});

test('Border-Registerwechsel innerhalb einer Rasterzeile wirkt auf nachfolgende Dot-Ausgabe', () => {
  const m = fixture();
  m.runCycles(51 * 63 + 11);
  m.bus.cpuWrite(0xd020, 1);
  m.runCycles(19656 - (51 * 63 + 11));
  assertEqual(pixel(m, 80, 51), 14);
  assertEqual(pixel(m, 104, 51), 1);
});

test('38-Spalten-Modus schließt acht zusätzliche Pixel links und rechts mit Border', () => {
  const m = fixture();
  m.bus.cpuWrite(0xd016, 0x00);
  m.runCycles(19656);
  assertEqual(pixel(m, 120, 51), 14);
  assertEqual(pixel(m, 128, 51), 6);
});

test('24-Zeilen-Modus verschiebt vertikalen Rahmen auf 55 bis 246', () => {
  const m = fixture();
  m.bus.cpuWrite(0xd011, 0x13);
  m.runCycles(19656);
  assertEqual(pixel(m, 120, 51), 14);
  assertEqual(pixel(m, 120, 55), 6);
});

test('Multicolor-Zeichenausgabe nutzt Farbregister und 2-Pixel-Gruppen', () => {
  const c = CharacterGenerator.colorForPixel;
  const arg = { mode: 1, bits: 0b01101100, code: 1, color: 0x0b, backgrounds: [6, 2, 4, 5] };
  assertEqual(c({ ...arg, bit: 0, xInChar: 0 }), 2);
  assertEqual(c({ ...arg, bit: 1, xInChar: 1 }), 2);
  assertEqual(c({ ...arg, bit: 2, xInChar: 2 }), 4);
  assertEqual(c({ ...arg, bit: 4, xInChar: 4 }), 3);
});

test('ECM-Zeichenmodus wählt Hintergrundfarbe aus den zwei hohen Zeichencode-Bits', () => {
  const color = CharacterGenerator.colorForPixel({
    mode: 4, bits: 0, bit: 0, code: 0xc1, color: 2,
    backgrounds: [6, 7, 8, 9], xInChar: 0
  });
  assertEqual(color, 9);
  assertEqual(CharacterGenerator.dataAddress(0x14, 0xc1, 0, 0, 0, 4), 0x1008);
});

test('CPU läuft während echter VIC-Badlines nach den DMA-Zyklen regulär weiter', () => {
  const m = fixture();
  const before = m.cpu.instructionsExecuted;
  m.runCycles(19656);
  assertTrue(m.cpu.instructionsExecuted > before);
  assertEqual(m.cpu.jammed, false);
  assertEqual(m.vic.getFrame().frameNumber, 1);
});

test('VIC-Rasterinterrupt wird durch eine wirkliche 6510-IRQ-Routine quittiert', () => {
  const m = fixture();
  m.memory.writeRAM(0xc200, 0);
  m.memory.writeRAM(0xfffe, 0x80);
  m.memory.writeRAM(0xffff, 0xc0);
  m.loadDiagnosticProgram(new Uint8Array([
    0x78, 0xa9, 0x0a, 0x8d, 0x12, 0xd0,
    0xa9, 0x01, 0x8d, 0x19, 0xd0,
    0xa9, 0x01, 0x8d, 0x1a, 0xd0,
    0x58, 0x4c, 0x11, 0xc0
  ]));
  m.processorPort.writePins(0x35);
  m.memory.writeRAM(0xc080, 0xee);
  m.memory.writeRAM(0xc081, 0x00);
  m.memory.writeRAM(0xc082, 0xc2);
  m.memory.writeRAM(0xc083, 0xa9);
  m.memory.writeRAM(0xc084, 1);
  m.memory.writeRAM(0xc085, 0x8d);
  m.memory.writeRAM(0xc086, 0x19);
  m.memory.writeRAM(0xc087, 0xd0);
  m.memory.writeRAM(0xc088, 0x40);
  m.runCycles(16 * 63);
  assertEqual(m.memory.readRAM(0xc200), 1);
  assertTrue(m.cpu.interruptsServiced >= 1);
  assertEqual(m.interrupts.isIRQActive(), false);
});

test('VIC-Diagnoseprogramm schreibt die grafischen Daten über echte 6510-STA-Zugriffe', () => {
  const m = new C64();
  m.loadVICDemo();
  m.runCycles(19656);
  assertEqual(m.getVICBankBase(), 0x4000);
  assertEqual(m.memory.readRAM(0x4400), 1);
  assertEqual(m.memory.readRAM(0x5008), 0x81);
  assertEqual(pixel(m, 120, 51), 2);
  assertEqual(pixel(m, 121, 51), 6);
});
