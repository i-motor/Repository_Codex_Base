import { test, assertEqual, assertTrue } from './harness.js';
import { C64 } from '../core/C64.js';

const FRAME = 19656;

function machine() {
  const m = new C64();
  m.loadDiagnosticProgram(new Uint8Array([0x4c, 0x00, 0xc0]));
  m.processorPort.writePins(0x35);
  m.bus.cpuWrite(0xd011, 0x1b);
  m.bus.cpuWrite(0xd016, 8);
  m.bus.cpuWrite(0xd018, 0x14);
  m.bus.cpuWrite(0xd020, 14);
  m.bus.cpuWrite(0xd021, 6);
  return m;
}

function sprite(m, number, { x = 24, y = 80, color = 2, pointer = 0x20 + number, bytes = [255, 255, 255], bank = 0, screenBase = 0x400 } = {}) {
  m.memory.writeRAM(bank + screenBase + 0x3f8 + number, pointer);
  for (let row = 0; row < 21; row += 1) {
    for (let byte = 0; byte < 3; byte += 1) {
      m.memory.writeRAM(bank + pointer * 64 + row * 3 + byte, bytes[byte]);
    }
  }
  m.bus.cpuWrite(0xd000 + number * 2, x & 255);
  m.bus.cpuWrite(0xd001 + number * 2, y);
  const msb = m.vic.registers[0x10] & ~(1 << number);
  m.bus.cpuWrite(0xd010, msb | (x & 256 ? 1 << number : 0));
  m.bus.cpuWrite(0xd027 + number, color);
  m.bus.cpuWrite(0xd015, m.vic.registers[0x15] | (1 << number));
}

function finishFrame(m) {
  const rest = FRAME - (m.clock.cycle % FRAME);
  m.runCycles(rest);
}

function pixel(m, x, y) {
  return m.vic.getFrame().data[(y - 16) * m.vic.width + x - 76];
}

test('Sprite-Register steuern acht X/Y-Paare, X-MSB, Aktivierung und individuelle Farben', () => {
  const m = machine();
  for (let i = 0; i < 8; i += 1) sprite(m, i, { x: 24 + i * 38, y: 80, color: i + 2 });
  assertEqual(m.bus.peek(0xd015), 255);
  assertEqual(m.bus.peek(0xd010), 128);
  assertEqual(m.bus.peek(0xd02e) & 15, 9);
  finishFrame(m);
  for (let i = 0; i < 8; i += 1) assertEqual(pixel(m, 120 + i * 38, 80), i + 2, `Sprite ${i}`);
});

test('Ein Sprite besteht aus genau 24 x 21 Pixeln mit transparentem Umfeld', () => {
  const m = machine();
  sprite(m, 0);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 2);
  assertEqual(pixel(m, 143, 100), 2);
  assertEqual(pixel(m, 144, 100), 6);
  assertEqual(pixel(m, 120, 101), 6);
  assertEqual(pixel(m, 120, 79), 6);
});

test('X-MSB verschiebt den Sprite-Kanal um 256 Pixel nach rechts', () => {
  const m = machine();
  sprite(m, 7, { x: 256, color: 12 });
  assertEqual(m.bus.peek(0xd010), 128);
  finishFrame(m);
  assertEqual(pixel(m, 352, 80), 12);
  assertEqual(pixel(m, 120, 80), 6);
});

test('Ein deaktivierter Sprite-Kanal generiert keine Daten-DMA oder Pixel', () => {
  const m = machine();
  sprite(m, 0);
  m.bus.cpuWrite(0xd015, 0);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 6);
  assertEqual(m.vic.sprites.dataFetches, 0);
  assertEqual(m.vic.sprites.phi2Steals, 0);
});

test('Sprite-Pointer werden tatsächlich aus Bildschirmbasis + $3F8 gelesen', () => {
  const m = machine();
  sprite(m, 0, { pointer: 0x20 });
  m.memory.writeRAM(0x0bf8, 0x21);
  for (let i = 0; i < 63; i += 1) m.memory.writeRAM(0x840 + i, 0);
  m.bus.cpuWrite(0xd018, 0x24);
  finishFrame(m);
  assertEqual(m.vic.sprites.pointer[0], 0x21);
  assertEqual(m.vic.sprites.lastPointerAddress, 0x0bfc);
  assertEqual(pixel(m, 120, 80), 6);
});

test('Sprite-DMA verwendet die über CIA 2 gewählte VIC-Bank', () => {
  const m = machine();
  sprite(m, 0, { pointer: 0x20, color: 3 });
  m.cia2.writeRegister(2, 3);
  m.cia2.writeRegister(0, 2);
  sprite(m, 0, { pointer: 0x23, color: 7, bank: 0x4000 });
  assertEqual(m.getVICBankBase(), 0x4000);
  finishFrame(m);
  assertEqual(m.vic.sprites.pointer[0], 0x23);
  assertEqual(pixel(m, 120, 80), 7);
});

test('Sprite-DMA lädt 63 Datenbytes mit zwei Φ2-Busübernahmen pro Rasterzeile', () => {
  const m = machine();
  sprite(m, 0);
  finishFrame(m);
  assertEqual(m.vic.sprites.dataFetches, 63);
  assertEqual(m.vic.sprites.phi2Steals, 42);
  assertEqual(m.vic.sprites.dmaCounter[0], 60);
  assertEqual(m.vic.sprites.pointerFetches, 8 * 312);
});

test('Sprite-DMA-Fetches haben deterministische φ1/φ2-Phasen und reale RAM-Adressen', () => {
  const m = machine();
  sprite(m, 0);
  m.vic.sprites.traceEnabled = true;
  m.runCycles(80 * 63);
  const events = m.vic.sprites.trace.filter(event => event.sprite === 0 && event.cycle >= 79 * 63 + 54 && event.cycle <= 79 * 63 + 55);
  assertEqual(events.length, 4);
  assertEqual(events[0].kind, 'pointer');
  assertEqual(events[0].address, 0x07f8);
  assertEqual(events[0].phase, 1);
  for (let i = 1; i < 4; i += 1) {
    assertEqual(events[i].kind, 'data');
    assertEqual(events[i].address, 0x0800 + i - 1);
  }
  assertEqual(events[1].phase, 2);
  assertEqual(events[2].phase, 1);
  assertEqual(events[3].phase, 2);
});

test('Sprite-DMA setzt BA mit drei CPU-Takten Vorlauf und belegt den Φ2-Bus', () => {
  const m = machine();
  sprite(m, 0);
  m.runCycles(79 * 63 + 51);
  const first = m.vic.beginCycle(m.clock.cycle);
  assertEqual(first.baLow, true);
  assertEqual(first.stealsPhi2, false);
  const request = m.vic.sprites.busRequest(79, 54);
  assertEqual(request.baLow, true);
  assertEqual(request.stealsPhi2, true);
  assertEqual(m.vic.sprites.busRequest(79, 50).baLow, false);
});

test('CPU-Lesezyklen werden bei Sprite-DMA angehalten, CIA-Timer laufen weiter', () => {
  const m = machine();
  sprite(m, 0);
  m.traceEnabled = true;
  m.runCycles(80 * 63);
  const line = m.trace.filter(event => event.cycle >= 79 * 63 && event.cycle < 80 * 63);
  assertEqual(line.filter(event => event.owner === 'vic').length, 2);
  assertEqual(line.filter(event => event.repeatedRead).length, 3);
  assertEqual(m.cia1.cycles, 80 * 63);
});

test('Vollständig aktive acht Sprite-Kanäle erzeugen eigene Daten-DMA', () => {
  const m = machine();
  for (let i = 0; i < 8; i += 1) sprite(m, i, { x: 24 + i * 38, color: i + 2 });
  finishFrame(m);
  assertEqual(m.vic.sprites.dataFetches, 8 * 63);
  assertEqual(m.vic.sprites.phi2Steals, 8 * 42);
});

test('Horizontale Verdopplung wiederholt jedes Sprite-Pixel einmal', () => {
  const m = machine();
  sprite(m, 0, { bytes: [0x80, 0, 0] });
  m.bus.cpuWrite(0xd01d, 1);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 2);
  assertEqual(pixel(m, 121, 80), 2);
  assertEqual(pixel(m, 122, 80), 6);
});

test('Vertikale Verdopplung wiederholt jede Sprite-Datenzeile zweimal', () => {
  const m = machine();
  sprite(m, 0, { bytes: [0x80, 0, 0] });
  m.bus.cpuWrite(0xd017, 1);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 2);
  assertEqual(pixel(m, 120, 81), 2);
  assertEqual(pixel(m, 120, 121), 2);
  assertEqual(pixel(m, 120, 122), 6);
  assertEqual(m.vic.sprites.dataFetches, 126);
});

test('Sprite-Multicolor verwendet D025, D026 und individuelle Spritefarbe', () => {
  const m = machine();
  sprite(m, 0, { bytes: [0x6c, 0x6c, 0x6c], color: 4 });
  m.bus.cpuWrite(0xd01c, 1);
  m.bus.cpuWrite(0xd025, 9);
  m.bus.cpuWrite(0xd026, 11);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 9);
  assertEqual(pixel(m, 121, 80), 9);
  assertEqual(pixel(m, 122, 80), 4);
  assertEqual(pixel(m, 123, 80), 4);
  assertEqual(pixel(m, 124, 80), 11);
  assertEqual(pixel(m, 125, 80), 11);
  assertEqual(pixel(m, 126, 80), 6);
});

test('Zwei überlappende Sprites setzen Bits beider Kanäle in D01E', () => {
  const m = machine();
  sprite(m, 0, { x: 24, color: 2 });
  sprite(m, 1, { x: 32, color: 3 });
  finishFrame(m);
  assertEqual(pixel(m, 128, 80), 2);
  assertEqual(m.bus.peek(0xd01e), 3);
  assertEqual(m.bus.peek(0xd019) & 4, 4);
});

test('Lesezugriff D01E löscht Sprite-Sprite-Kollision, Peek nicht', () => {
  const m = machine();
  sprite(m, 0, { x: 24 });
  sprite(m, 1, { x: 32 });
  finishFrame(m);
  assertEqual(m.bus.peek(0xd01e), 3);
  assertEqual(m.bus.cpuRead(0xd01e), 3);
  assertEqual(m.bus.cpuRead(0xd01e), 0);
  assertEqual(m.bus.peek(0xd019) & 4, 4);
  m.bus.cpuWrite(0xd019, 4);
  assertEqual(m.bus.peek(0xd019) & 4, 0);
});

test('Sprite-Sprite-IRQ kann nach bereits gesetztem Latch maskiert werden', () => {
  const m = machine();
  sprite(m, 0, { x: 24 });
  sprite(m, 1, { x: 32 });
  finishFrame(m);
  assertEqual(m.interrupts.isIRQActive(), false);
  m.bus.cpuWrite(0xd01a, 4);
  assertEqual(m.interrupts.isIRQActive(), true);
  m.bus.cpuWrite(0xd019, 4);
  assertEqual(m.interrupts.isIRQActive(), false);
});

test('Sprite-Hintergrund-Kollision benutzt echte Zeichendaten und D01F', () => {
  const m = machine();
  const chargen = new Uint8Array(4096);
  chargen.fill(255, 8, 16);
  m.loadROM('chargen', chargen);
  m.memory.writeRAM(0x0400 + 3 * 40, 1);
  m.memory.writeColor(3 * 40, 5);
  sprite(m, 0, { x: 24, y: 80, color: 2 });
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 2);
  assertEqual(m.bus.peek(0xd01f), 1);
  assertEqual(m.bus.peek(0xd019) & 2, 2);
  assertEqual(m.bus.cpuRead(0xd01f), 1);
  assertEqual(m.bus.peek(0xd01f), 0);
});

test('Sprite-Priorität hinter Vordergrundpixeln blendet Sprite aus, Kollision bleibt', () => {
  const m = machine();
  const chargen = new Uint8Array(4096);
  chargen.fill(255, 8, 16);
  m.loadROM('chargen', chargen);
  m.memory.writeRAM(0x0400 + 3 * 40, 1);
  m.memory.writeColor(3 * 40, 5);
  sprite(m, 0, { x: 24, y: 80, color: 2 });
  m.bus.cpuWrite(0xd01b, 1);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 5);
  assertEqual(m.bus.peek(0xd01f), 1);
});

test('Sprite-Hintergrund-IRQ ist separat maskierbar und quittierbar', () => {
  const m = machine();
  const chargen = new Uint8Array(4096);
  chargen.fill(255, 8, 16);
  m.loadROM('chargen', chargen);
  m.memory.writeRAM(0x0400 + 3 * 40, 1);
  sprite(m, 0);
  m.bus.cpuWrite(0xd01a, 2);
  finishFrame(m);
  assertEqual(m.interrupts.isIRQActive(), true);
  m.bus.cpuWrite(0xd019, 2);
  assertEqual(m.interrupts.isIRQActive(), false);
});

test('Schreibzugriffe auf D01E/D01F verändern die Kollisionslatches nicht', () => {
  const m = machine();
  sprite(m, 0, { x: 24 });
  sprite(m, 1, { x: 32 });
  finishFrame(m);
  m.bus.cpuWrite(0xd01e, 0);
  m.bus.cpuWrite(0xd01f, 255);
  assertEqual(m.bus.peek(0xd01e), 3);
  assertEqual(m.bus.peek(0xd01f), 0);
});

test('Spritefarbe kann durch ein Register-Write innerhalb der Rasterzeile wechseln', () => {
  const m = machine();
  sprite(m, 0, { x: 24, color: 2 });
  m.runCycles(80 * 63 + 17);
  m.bus.cpuWrite(0xd027, 4);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 2);
  assertEqual(pixel(m, 144 - 1, 80), 4);
});

test('Sprite-Versetzung zwischen Frames wird über Hardwarepositionsregister übernommen', () => {
  const m = machine();
  sprite(m, 0, { x: 24, color: 2 });
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 2);
  m.bus.cpuWrite(0xd000, 52);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 6);
  assertEqual(pixel(m, 148, 80), 2);
});

test('Sprite-Foreground-Test unterscheidet monochrome Zeichenpixel und Hintergrund', () => {
  const m = machine();
  const chargen = new Uint8Array(4096);
  chargen[8] = 0x80;
  m.loadROM('chargen', chargen);
  m.memory.writeRAM(0x0400 + 3 * 40, 1);
  sprite(m, 0, { y: 75 });
  finishFrame(m);
  assertEqual(m.bus.peek(0xd01f), 1);
});

test('CPU-STA aktiviert Sprite über echtes VIC-Register und erzeugt Sprite-Pixel', () => {
  const m = machine();
  sprite(m, 0);
  m.bus.cpuWrite(0xd015, 0);
  m.loadDiagnosticProgram(new Uint8Array([0xa9, 0x01, 0x8d, 0x15, 0xd0, 0x4c, 0x05, 0xc0]));
  m.processorPort.writePins(0x35);
  finishFrame(m);
  assertEqual(m.bus.peek(0xd015), 1);
  assertEqual(pixel(m, 120, 80), 2);
});

test('Sprite- und Raster-IRQ-Latches bleiben bei selektiver Quittierung unabhängig', () => {
  const m = machine();
  sprite(m, 0, { x: 24 });
  sprite(m, 1, { x: 32 });
  m.bus.cpuWrite(0xd012, 80);
  m.bus.cpuWrite(0xd01a, 5);
  finishFrame(m);
  assertEqual(m.bus.peek(0xd019) & 5, 5);
  m.bus.cpuWrite(0xd019, 1);
  assertEqual(m.bus.peek(0xd019) & 5, 4);
  assertTrue(m.interrupts.isIRQActive());
  m.bus.cpuWrite(0xd019, 4);
  assertEqual(m.interrupts.isIRQActive(), false);
});

test('Das Sprite-Demoprogramm füllt Sprite-RAM und VIC-Register durch echte CPU-Schreibzyklen', () => {
  const m = new C64();
  const size = m.loadSpriteDemo();
  assertTrue(size > 2000);
  m.runCycles(FRAME * 2);
  assertEqual(m.bus.peek(0xd015), 255);
  assertEqual(m.memory.readRAM(0x07f8), 0x20);
  assertEqual(m.memory.readRAM(0x0800), 255);
  assertEqual(m.memory.readRAM(0x0803), 0x80);
  assertEqual(pixel(m, 128, 80), 2);
  assertEqual(pixel(m, 153, 80), 5);
  assertEqual(m.vic.sprites.spriteCollision & 3, 3);
  assertTrue(m.vic.sprites.phi2Steals > 200);
  assertEqual(m.cpu.getState().jammed, false);
});

test('Reale 6510-IRQ-Routine quittiert Sprite-Kollision über D01E und D019', () => {
  const m = machine();
  sprite(m, 0, { x: 24 });
  sprite(m, 1, { x: 32 });
  m.memory.writeRAM(0xc200, 0);
  m.memory.writeRAM(0xfffe, 0x80);
  m.memory.writeRAM(0xffff, 0xc0);
  m.memory.ram.set(new Uint8Array([
    0xee, 0x00, 0xc2,
    0xad, 0x1e, 0xd0,
    0xa9, 0x04,
    0x8d, 0x19, 0xd0,
    0x40
  ]), 0xc080);
  m.loadDiagnosticProgram(new Uint8Array([0x58, 0x4c, 0x01, 0xc0]));
  m.processorPort.writePins(0x35);
  m.bus.cpuWrite(0xd01a, 4);
  finishFrame(m);
  assertTrue(m.memory.readRAM(0xc200) > 0);
  assertTrue(m.cpu.interruptsServiced > 0);
  assertEqual(m.cpu.jammed, false);
});

test('D018-Änderung vor dem Sprite-Pointer-Fetch wirkt noch in derselben Rasterzeile', () => {
  const m = machine();
  sprite(m, 0, { pointer: 0x20 });
  m.memory.writeRAM(0x0bf8, 0x21);
  for (let index = 0; index < 63; index += 1) m.memory.writeRAM(0x0840 + index, 0);
  m.runCycles(79 * 63 + 54);
  m.bus.cpuWrite(0xd018, 0x24);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 6);
  assertEqual(m.vic.sprites.pointer[0], 0x21);
});

test('D018-Änderung nach Pointer-Fetch ändert nicht rückwirkend das geladene Sprite', () => {
  const m = machine();
  sprite(m, 0, { pointer: 0x20 });
  m.memory.writeRAM(0x0bf8, 0x21);
  for (let index = 0; index < 63; index += 1) m.memory.writeRAM(0x0840 + index, 0);
  m.runCycles(79 * 63 + 56);
  m.bus.cpuWrite(0xd018, 0x24);
  finishFrame(m);
  assertEqual(pixel(m, 120, 80), 2);
});

test('Kollisionsregister sind auf allen VIC-Registerspiegeln lesbar', () => {
  const m = machine();
  sprite(m, 0, { x: 24 });
  sprite(m, 1, { x: 32 });
  finishFrame(m);
  assertEqual(m.bus.peek(0xd05e), 3);
  assertEqual(m.bus.cpuRead(0xd09e), 3);
  assertEqual(m.bus.peek(0xd01e), 0);
});
