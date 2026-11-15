import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../core/Memory.js';
import { MemoryBus } from '../core/MemoryBus.js';
import { InterruptController } from '../core/InterruptController.js';
import { VICII } from '../video/VICII.js';
import { PAL, columnForX } from '../video/VideoTiming.js';

function makeVic() {
  const memory = new Memory();
  const bus = new MemoryBus(memory);
  const cpu = { irqLine: false, nmiLine: false };
  const vic = new VICII(bus, new InterruptController(cpu), memory, PAL);
  vic.write(0x11, 0x1b);
  vic.write(0x16, 0x08);
  vic.write(0x18, 0x14);
  vic.write(0x20, 14);
  vic.write(0x21, 6);
  memory.ram.fill(32, 0x0400, 0x07e8);
  memory.charRom.fill(0);
  return { memory, bus, vic, cpu };
}

function frames(vic, count = 2) {
  for (let i = 0; i < count; i++) {
    const start = vic.frameCount;
    while (vic.frameCount === start) {
      vic.cycle();
    }
  }
}

function pixel(vic, line, x) {
  return vic.getFrontBuffer()[line * vic.width + columnForX(PAL, x)];
}

function solidSprite(memory, pointer, value = 0xff) {
  memory.ram.fill(value, pointer * 64, pointer * 64 + 63);
}

function placeSprite(vic, memory, n, x, y, pointer, color) {
  memory.ram[0x07f8 + n] = pointer;
  vic.write(n * 2, x & 0xff);
  const msb = vic.read(0x10);
  vic.write(0x10, x & 0x100 ? msb | (1 << n) : msb & ~(1 << n));
  vic.write(n * 2 + 1, y);
  vic.write(0x27 + n, color);
  vic.write(0x15, vic.read(0x15) | (1 << n));
}

function runTo(vic, line, cycle) {
  for (let guard = 0; guard < 400000; guard++) {
    if (vic.raster === line && vic.cyc === cycle) return;
    vic.cycle();
  }
  throw new Error('Position nicht erreicht');
}

test('Sprite 0: Darstellung ab Y+1, 21 Zeilen, 24 Pixel breit', () => {
  const { vic, memory } = makeVic();
  solidSprite(memory, 0x80);
  placeSprite(vic, memory, 0, 100, 100, 0x80, 2);
  frames(vic);
  assert.equal(pixel(vic, 100, 100), 6);
  assert.equal(pixel(vic, 101, 100), 2);
  assert.equal(pixel(vic, 101, 123), 2);
  assert.equal(pixel(vic, 101, 124), 6);
  assert.equal(pixel(vic, 101, 99), 6);
  assert.equal(pixel(vic, 121, 100), 2);
  assert.equal(pixel(vic, 122, 100), 6);
});

test('Sprite-DMA: BA in Zyklen 55–59 der Startzeile low', () => {
  const { vic, memory } = makeVic();
  vic.write(0x11, 0x0b);
  solidSprite(memory, 0x80);
  placeSprite(vic, memory, 0, 100, 100, 0x80, 2);
  runTo(vic, 100, 54);
  const low = [];
  for (let i = 0; i < 9; i++) {
    vic.cycle();
    if (!vic.ba) low.push(vic.cyc);
  }
  assert.deepEqual(low, [55, 56, 57, 58, 59]);
});

test('Sprite-Pointer und -Daten aus der aktiven VIC-Bank', () => {
  const { vic, memory, bus } = makeVic();
  bus.setVicBank(1);
  memory.ram.fill(32, 0x4400, 0x47e8);
  memory.ram[0x47f8] = 0x10;
  memory.ram.fill(0xff, 0x4400 + 0, 0x4400);
  memory.ram.fill(0xff, 0x4000 + 0x10 * 64, 0x4000 + 0x10 * 64 + 63);
  vic.write(0x00, 100);
  vic.write(0x01, 100);
  vic.write(0x27, 5);
  vic.write(0x15, 1);
  frames(vic);
  assert.equal(pixel(vic, 105, 110), 5);
});

test('X- und Y-Expansion verdoppeln Breite und Höhe', () => {
  const { vic, memory } = makeVic();
  solidSprite(memory, 0x80);
  placeSprite(vic, memory, 1, 100, 100, 0x80, 7);
  vic.write(0x17, 0x02);
  vic.write(0x1d, 0x02);
  frames(vic, 3);
  assert.equal(pixel(vic, 101, 147), 7);
  assert.equal(pixel(vic, 101, 148), 6);
  assert.equal(pixel(vic, 142, 100), 7);
  assert.equal(pixel(vic, 143, 100), 6);
});

test('Multicolor-Sprite nutzt $D025/$D026 und Spritefarbe', () => {
  const { vic, memory } = makeVic();
  for (let i = 0; i < 63; i += 3) {
    memory.ram[0x80 * 64 + i] = 0b01101100;
    memory.ram[0x80 * 64 + i + 1] = 0;
    memory.ram[0x80 * 64 + i + 2] = 0;
  }
  placeSprite(vic, memory, 0, 100, 100, 0x80, 2);
  vic.write(0x1c, 0x01);
  vic.write(0x25, 10);
  vic.write(0x26, 13);
  frames(vic);
  assert.deepEqual([100, 101, 102, 103, 104, 105, 106, 107].map((x) => pixel(vic, 105, x)), [10, 10, 2, 2, 13, 13, 6, 6]);
});

test('Sprite-Priorität: niedrigere Nummer vorn, MDP hinter Vordergrund', () => {
  const { vic, memory } = makeVic();
  solidSprite(memory, 0x80);
  placeSprite(vic, memory, 0, 100, 100, 0x80, 2);
  placeSprite(vic, memory, 1, 110, 100, 0x80, 5);
  memory.charRom.fill(0xff, 8, 16);
  memory.colorRam.fill(1);
  memory.ram[0x0400 + 7 * 40 + 11] = 1;
  frames(vic);
  assert.equal(pixel(vic, 105, 112), 2);
  vic.write(0x1b, 0x01);
  frames(vic);
  const line = 51 + 7 * 8 + 1;
  vic.write(0x01, line - 1);
  vic.write(0x03, line - 1);
  frames(vic);
  assert.equal(pixel(vic, line, 24 + 88 + 1), 1);
  assert.equal(pixel(vic, line, 24 + 80 - 1), 2);
});

test('Sprite-Sprite-Kollision: Register, IRQ nur beim ersten Bit, Löschen beim Lesen', () => {
  const { vic, memory, cpu } = makeVic();
  solidSprite(memory, 0x80);
  placeSprite(vic, memory, 0, 100, 100, 0x80, 2);
  placeSprite(vic, memory, 3, 110, 105, 0x80, 5);
  vic.write(0x1a, 0x04);
  frames(vic);
  assert.equal(vic.read(0x1e), 0x09);
  assert.equal(vic.irqFlags & 0x04, 0x04);
  assert.equal(cpu.irqLine, true);
  assert.equal(vic.peek(0x1e), 0x00);
  vic.write(0x19, 0x04);
  assert.equal(cpu.irqLine, false);
});

test('Sprite-Hintergrund-Kollision nur mit Vordergrundpixeln', () => {
  const { vic, memory } = makeVic();
  solidSprite(memory, 0x80);
  placeSprite(vic, memory, 2, 30, 60, 0x80, 2);
  frames(vic);
  assert.equal(vic.read(0x1f), 0);
  memory.charRom.fill(0xff, 8, 16);
  memory.ram[0x0400 + 1 * 40 + 1] = 1;
  frames(vic);
  assert.equal(vic.read(0x1f), 0x04);
  assert.equal(vic.read(0x1f), 0x00);
});

test('Alle acht Sprites gleichzeitig in einer Zeile', () => {
  const { vic, memory } = makeVic();
  solidSprite(memory, 0x80);
  for (let n = 0; n < 8; n++) {
    placeSprite(vic, memory, n, 30 + n * 30, 120, 0x80, 1 + n);
  }
  frames(vic);
  for (let n = 0; n < 8; n++) {
    assert.equal(pixel(vic, 125, 30 + n * 30 + 5), 1 + n);
  }
});

test('Sprites werden vom Rahmen überdeckt, Neuntes X-Bit', () => {
  const { vic, memory } = makeVic();
  solidSprite(memory, 0x80);
  placeSprite(vic, memory, 0, 0x150, 100, 0x80, 2);
  frames(vic);
  assert.equal(pixel(vic, 101, 0x150), 2);
  assert.equal(pixel(vic, 101, 0x158), 14);
});

test('Sprite-Crunch: Löschen von MxYE in Zyklus 15 verändert MC', () => {
  const { vic } = makeVic();
  vic.sprites.expFlop[0] = 0;
  vic.sprites.mc[0] = 0x2a;
  vic.sprites.mcbase[0] = 0x15;
  vic.sprites.yexp = 1;
  vic.cyc = 15;
  vic.write(0x17, 0x00);
  assert.equal(vic.sprites.mc[0], (0x2a & (0x15 & 0x2a)) | (0x15 & (0x15 | 0x2a)));
  assert.equal(vic.sprites.expFlop[0], 1);
});
