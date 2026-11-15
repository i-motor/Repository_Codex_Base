import { test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { Drive1541 } from '../drive1541/Drive1541.js';
import { VIA6522 } from '../drive1541/VIA6522.js';
import { D64Image } from '../storage/D64Image.js';

function romFixture() {
  const rom = new Uint8Array(16384).fill(0xea);
  rom.set([0xa9,0x42,0x8d,0x00,0x01,0x4c,0x05,0xc0]);
  rom[0x3ffc] = 0;
  rom[0x3ffd] = 0xc0;
  return rom;
}

test('1541-Referenz: Reset-Vektor liest ROM bei $FFFC/$FFFD', () => {
  const drive = new Drive1541();
  drive.loadROM(romFixture());
  for (let i = 0; i < 30; i += 1) drive.step();
  assertEqual(drive.ram[0x100], 0x42);
  assertTrue(drive.cpu.instructionsExecuted >= 2);
});

test('1541-Referenz: 32-KiB-ROM wird bei $8000 eingeblendet', () => {
  const drive = new Drive1541();
  const rom = new Uint8Array(32768).fill(0x5a);
  rom[32764] = 0;
  rom[32765] = 0x80;
  drive.loadROM(rom);
  assertEqual(drive.read(0x8000), 0x5a);
  assertEqual(drive.read(0xbfff), 0x5a);
});

test('VIA-Referenz: Timer 2 PB6 zählt nur negative CNT-Flanken', () => {
  const via = new VIA6522();
  via.writeRegister(11, 0x20);
  via.writeRegister(8, 1);
  via.writeRegister(9, 0);
  for (let i = 0; i < 100; i += 1) via.tick();
  assertEqual(via.t2c, 1);
  via.setPB6(false);
  assertEqual(via.t2c, 0);
  via.setPB6(true);
  via.setPB6(false);
  assertEqual(via.readRegister(13) & 0x20, 0x20);
});

test('1541-Referenz: GCR-Track rotiert bei Motor an', () => {
  const drive = new Drive1541();
  drive.mount(D64Image.create());
  drive.via2.writeRegister(2, 0x04);
  drive.via2.writeRegister(0, 0x04);
  drive.advanceC64Cycles(1000);
  assertTrue(drive.bitPosition > 0);
  drive.via2.writeRegister(0, 0);
  const position = drive.bitPosition;
  drive.advanceC64Cycles(1000);
  assertEqual(drive.bitPosition, position);
});
