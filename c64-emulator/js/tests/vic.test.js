import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../core/Memory.js';
import { MemoryBus } from '../core/MemoryBus.js';
import { InterruptController } from '../core/InterruptController.js';
import { VICII } from '../video/VICII.js';
import { PAL, columnForX, buildCycleTable } from '../video/VideoTiming.js';
import { decodeCell, BG0, BG1, BG2, FOREGROUND } from '../video/CharacterGenerator.js';

function makeVic() {
  const memory = new Memory();
  const bus = new MemoryBus(memory);
  const cpu = { irqLine: false, nmiLine: false };
  const interrupts = new InterruptController(cpu);
  const vic = new VICII(bus, interrupts, memory, PAL);
  return { memory, bus, vic, cpu };
}

function runTo(vic, line, cycle) {
  for (let guard = 0; guard < 400000; guard++) {
    if (vic.raster === line && vic.cyc === cycle) {
      return;
    }
    vic.cycle();
  }
  throw new Error('Rasterposition nicht erreicht');
}

function standardScreen(vic, memory) {
  vic.write(0x11, 0x1b);
  vic.write(0x16, 0x08);
  vic.write(0x18, 0x14);
  vic.write(0x20, 14);
  vic.write(0x21, 6);
  memory.colorRam.fill(1);
}

function pixel(vic, line, x) {
  return vic.getFrontBuffer()[line * vic.width + columnForX(PAL, x)];
}

function finishFrame(vic) {
  const start = vic.frameCount;
  while (vic.frameCount === start) {
    vic.cycle();
  }
}

test('PAL-Timing: 63 Takte × 312 Zeilen je Bild', () => {
  const { vic } = makeVic();
  finishFrame(vic);
  let cycles = 0;
  const start = vic.frameCount;
  while (vic.frameCount === start) {
    vic.cycle();
    cycles++;
  }
  assert.equal(cycles, 63 * 312);
});

test('Zyklustabelle: Sprite-BA-Fenster und X-Koordinaten', () => {
  const table = buildCycleTable(PAL);
  const cyclesFor = (sprite) => [...Array(64).keys()].filter((c) => table.spriteBaMask[c] & (1 << sprite));
  assert.deepEqual(cyclesFor(0), [55, 56, 57, 58, 59]);
  assert.deepEqual(cyclesFor(3), [1, 2, 61, 62, 63]);
  assert.equal(table.xcoord[0], 0x194);
  assert.equal(table.xcoord[(16 - 1) * 8 + 4], 24);
});

test('Raster-IRQ wird im Zyklus 1 der Vergleichszeile ausgelöst (Zeile 0: Zyklus 2)', () => {
  const { vic, cpu } = makeVic();
  vic.write(0x1a, 0x01);
  vic.write(0x12, 100);
  runTo(vic, 99, 63);
  vic.cycle();
  assert.equal(vic.raster, 100);
  assert.equal(vic.cyc, 1);
  assert.equal(vic.irqFlags & 1, 1);
  assert.equal(cpu.irqLine, true);
  assert.equal(vic.read(0x19), 0xf1);
  vic.write(0x19, 0x01);
  assert.equal(cpu.irqLine, false);
  vic.write(0x12, 0);
  runTo(vic, 0, 1);
  assert.equal(vic.irqFlags & 1, 0);
  vic.cycle();
  assert.equal(vic.cyc, 2);
  assert.equal(vic.irqFlags & 1, 1);
});

test('Schreiben des Vergleichswerts auf die aktuelle Zeile löst sofort aus', () => {
  const { vic } = makeVic();
  runTo(vic, 120, 30);
  vic.write(0x12, 120);
  assert.equal(vic.irqFlags & 1, 1);
});

test('Badline: BA 43 Takte low (Zyklen 12–54), Rasterzeile $33 bei YSCROLL=3', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  runTo(vic, 0x33, 1);
  const low = [];
  for (let c = 1; c <= 63; c++) {
    vic.cycle();
    if (!vic.ba) low.push(vic.cyc);
  }
  assert.equal(low.length, 43);
  assert.equal(low[0], 12);
  assert.equal(low[42], 54);
});

test('Keine Badlines bei DEN=0 in Zeile $30', () => {
  const { vic } = makeVic();
  vic.write(0x11, 0x0b);
  runTo(vic, 0x33, 1);
  let low = 0;
  for (let c = 0; c < 63 * 20; c++) {
    vic.cycle();
    if (!vic.ba) low++;
  }
  assert.equal(low, 0);
});

test('Per $D011 erzeugte Badline mitten in der Zeile (FLD/VSP-Grundlage)', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  runTo(vic, 0x34, 20);
  vic.write(0x11, 0x1c);
  let low = 0;
  for (let c = 20; c <= 63; c++) {
    vic.cycle();
    if (!vic.ba) low++;
  }
  assert.equal(low, 54 - 21 + 1);
});

test('Textdarstellung: Zeichen-ROM, Farbe, Bildschirmadresse über $D018', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  memory.charRom.fill(0);
  for (let i = 0; i < 8; i++) memory.charRom[1 * 8 + i] = 0x81;
  memory.ram.fill(32, 0x0400, 0x07e8);
  memory.ram[0x0400] = 1;
  memory.colorRam[0] = 2;
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 24), 2);
  assert.equal(pixel(vic, 51, 25), 6);
  assert.equal(pixel(vic, 51, 31), 2);
  assert.equal(pixel(vic, 51, 32), 6);
  assert.equal(pixel(vic, 30, 100), 14);
  assert.equal(pixel(vic, 100, 10), 14);
  memory.ram.fill(0, 0x0800, 0x0be8);
  vic.write(0x18, 0x24);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 24), 6);
});

test('RAM-Zeichensatz über $D018 und VIC-Bankumschaltung', () => {
  const { vic, memory, bus } = makeVic();
  standardScreen(vic, memory);
  vic.write(0x18, 0x1c);
  memory.ram.fill(0, 0x3000, 0x3800);
  memory.ram[0x3000 + 5 * 8] = 0xff;
  memory.ram.fill(5, 0x0400, 0x07e8);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 24), 1);
  assert.equal(pixel(vic, 52, 24), 6);
  bus.setVicBank(1);
  memory.ram.fill(0, 0x4400, 0x47e8);
  memory.ram.fill(0, 0x7000, 0x7800);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 24), 6);
});

test('38-Spalten- und 24-Zeilen-Modus verschieben die Rahmenvergleiche', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  memory.charRom.fill(0xff);
  memory.ram.fill(0, 0x0400, 0x07e8);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 24), 1);
  assert.equal(pixel(vic, 51, 343), 1);
  assert.equal(pixel(vic, 51, 344), 14);
  vic.write(0x16, 0x00);
  vic.write(0x11, 0x13);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 60, 30), 14);
  assert.equal(pixel(vic, 60, 31), 1);
  assert.equal(pixel(vic, 60, 334), 1);
  assert.equal(pixel(vic, 60, 335), 14);
  assert.equal(pixel(vic, 54, 100), 14);
  assert.equal(pixel(vic, 55, 100), 1);
  assert.equal(pixel(vic, 246, 100), 1);
  assert.equal(pixel(vic, 247, 100), 14);
});

test('Horizontales Scrolling verschiebt die Grafik um XSCROLL Pixel', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  memory.charRom.fill(0);
  for (let i = 0; i < 8; i++) memory.charRom[8 + i] = 0x80;
  memory.ram.fill(32, 0x0400, 0x07e8);
  memory.ram[0x0401] = 1;
  vic.write(0x16, 0x0b);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 32), 6);
  assert.equal(pixel(vic, 51, 35), 1);
});

test('Vertikales Scrolling verschiebt Badline und erste Textzeile', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  memory.charRom.fill(0);
  memory.charRom[8] = 0xff;
  memory.ram.fill(32, 0x0400, 0x07e8);
  memory.ram[0x0400] = 1;
  vic.write(0x11, 0x1d);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 24), 6);
  assert.equal(pixel(vic, 53, 24), 1);
});

test('Bitmap-Modus: Adresse über VC/RC, Farben aus Videomatrix', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  vic.write(0x11, 0x3b);
  vic.write(0x18, 0x18);
  memory.ram.fill(0, 0x2000, 0x4000);
  memory.ram[0x2000] = 0xf0;
  memory.ram[0x2000 + 8] = 0x0f;
  memory.ram.fill(0x27, 0x0400, 0x07e8);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 51, 24), 2);
  assert.equal(pixel(vic, 51, 28), 7);
  assert.equal(pixel(vic, 51, 32), 7);
  assert.equal(pixel(vic, 51, 36), 2);
});

test('Ungültige Moduskombination erzeugt Schwarz', () => {
  const { vic, memory } = makeVic();
  standardScreen(vic, memory);
  vic.write(0x11, 0x7b);
  memory.ram.fill(0xff, 0x2000, 0x4000);
  finishFrame(vic);
  finishFrame(vic);
  assert.equal(pixel(vic, 60, 100), 0);
});

test('Grafiksequenzer: Dekodierung aller acht Moduskombinationen', () => {
  const out = new Uint8Array(8);
  decodeCell(0, 0b10000001, 0x00, 5, out, 0);
  assert.deepEqual([...out], [5 | FOREGROUND, BG0, BG0, BG0, BG0, BG0, BG0, 5 | FOREGROUND]);
  decodeCell(1, 0b00011011, 0x00, 0x0d, out, 0);
  assert.deepEqual([...out], [BG0, BG0, BG1, BG1, BG2 | FOREGROUND, BG2 | FOREGROUND, 5 | FOREGROUND, 5 | FOREGROUND]);
  decodeCell(1, 0b10000000, 0x00, 0x05, out, 0);
  assert.equal(out[0], 5 | FOREGROUND);
  decodeCell(2, 0b10000000, 0x3a, 0, out, 0);
  assert.equal(out[0], 3 | FOREGROUND);
  assert.equal(out[1], 0x0a);
  decodeCell(3, 0b00011011, 0x3a, 9, out, 0);
  assert.deepEqual([...out], [BG0, BG0, 3, 3, 0x0a | FOREGROUND, 0x0a | FOREGROUND, 9 | FOREGROUND, 9 | FOREGROUND]);
  decodeCell(4, 0b10000000, 0xc1, 7, out, 0);
  assert.equal(out[0], 7 | FOREGROUND);
  assert.equal(out[1], BG0 + 3);
  decodeCell(5, 0b11000000, 0, 0x08, out, 0);
  assert.equal(out[0], FOREGROUND);
  decodeCell(6, 0b10000000, 0xff, 0x0f, out, 0);
  assert.equal(out[0], FOREGROUND);
  assert.equal(out[1], 0);
  decodeCell(7, 0b01000000, 0xff, 0x0f, out, 0);
  assert.equal(out[0], 0);
});

test('Register-Lesewerte mit unbenutzten Bits', () => {
  const { vic } = makeVic();
  vic.write(0x16, 0x00);
  vic.write(0x18, 0x00);
  vic.write(0x20, 0x00);
  assert.equal(vic.read(0x16), 0xc0);
  assert.equal(vic.read(0x18), 0x01);
  assert.equal(vic.read(0x20), 0xf0);
  assert.equal(vic.read(0x1a), 0xf0);
  assert.equal(vic.read(0x2f), 0xff);
  assert.equal(vic.read(0x3f), 0xff);
});
