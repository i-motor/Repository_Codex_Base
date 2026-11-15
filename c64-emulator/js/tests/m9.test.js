import { test, assertEqual, assertTrue, assertBytes, assertThrows } from './harness.js';
import { D64Image } from '../storage/D64Image.js';
import { GCRCodec } from '../drive1541/GCRCodec.js';
import { VIA6522 } from '../drive1541/VIA6522.js';
import { Drive1541 } from '../drive1541/Drive1541.js';
import { C64 } from '../core/C64.js';
import { Clock } from '../core/Clock.js';
import { VideoTiming } from '../video/VideoTiming.js';
import { PAL_PROFILE, NTSC_PROFILE } from '../utils/Constants.js';
import { SID6581 } from '../audio/SID6581.js';
import { Gamepad } from '../io/Gamepad.js';
import { WorkerRunner } from '../workers/WorkerRunner.js';

function fixture(tracks = 35) {
  const image = D64Image.create({ tracks, name: 'M9 REFERENCE', id: '42' });
  image.writePRG('ALPHA', Uint8Array.of(1,8,0x10,0x20));
  return image;
}

test('M9 D64: 35-Track-Format und erwartete Sektorkapazität', () => {
  const disk = fixture();
  assertEqual(disk.data.length, 174848);
  assertEqual(disk.sectorCount, 683);
  assertEqual(disk.sectorsOnTrack(1), 21);
  assertEqual(disk.sectorsOnTrack(18), 19);
  assertEqual(disk.sectorsOnTrack(25), 18);
  assertEqual(disk.sectorsOnTrack(31), 17);
  assertEqual(disk.getDiskName(), 'M9 REFERENCE');
});

test('M9 D64: 40 Spuren und optionale Fehlerbyte-Tabelle', () => {
  const disk = fixture(40);
  assertEqual(disk.data.length, 196608);
  assertEqual(disk.sectorCount, 768);
  const withErrors = new Uint8Array(197376);
  withErrors.set(disk.exportImage());
  const mounted = new D64Image(withErrors);
  assertEqual(mounted.errors.length, 768);
  assertEqual(mounted.sectorsOnTrack(40), 17);
});

test('M9 D64: sektorbasierter Write/Read-Roundtrip', () => {
  const disk = fixture();
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  disk.writeSector(35, 16, bytes);
  assertBytes(disk.readSector(35, 16), bytes);
  assertBytes(new D64Image(disk.exportImage()).readSector(35, 16), bytes);
});

test('M9 D64: PRG-Verzeichnis und Ladeadressbytes', () => {
  const disk = fixture();
  const entry = disk.listDirectory()[0];
  assertEqual(entry.name, 'ALPHA');
  assertEqual(entry.type, 'PRG');
  assertEqual(entry.blocks, 1);
  assertBytes(disk.readPRG('ALPHA'), Uint8Array.of(1,8,0x10,0x20));
});

test('M9 D64: Sektorketten über mehr als 254 Bytes', () => {
  const disk = fixture();
  const prg = Uint8Array.from({ length: 766 }, (_, i) => (i * 29) & 255);
  disk.writePRG('CHAIN', prg);
  assertEqual(disk.listDirectory()[1].blocks, 4);
  assertBytes(disk.readPRG('CHAIN'), prg);
  assertEqual(disk.freeBlocks(), 664 - 5);
});

test('M9 D64: BAM erkennt belegte Sektoren und Überbelegung', () => {
  const disk = fixture();
  assertEqual(disk.isFree(18, 0), false);
  assertEqual(disk.isFree(18, 1), false);
  assertEqual(disk.isFree(1, 0), false);
  assertThrows(() => disk.offset(18, 19), RangeError);
  assertThrows(() => new D64Image(new Uint8Array(4096)), RangeError);
  assertThrows(() => disk.writePRG('ALPHA', Uint8Array.of(1,8)), Error);
});

test('M9 D64: beschädigte zirkuläre Dateiketten werden abgewiesen', () => {
  const disk = fixture();
  const entry = disk.listDirectory()[0];
  const block = disk.readSector(entry.track, entry.sector);
  block[0] = entry.track;
  block[1] = entry.sector;
  assertThrows(() => disk.readPRG('ALPHA'), Error);
});

test('M9 IEC: D64-Mount macht Original-PRGs auf Gerät 8 sichtbar', () => {
  const machine = new C64();
  assertEqual(machine.mountD64(fixture().exportImage()), 1);
  assertBytes(machine.files.get('ALPHA').data, Uint8Array.of(1,8,0x10,0x20));
  machine.drive8.openChannel(0, 'ALPHA');
  assertEqual(machine.drive8.readChannel(0).value, 1);
  assertEqual(machine.drive8.readChannel(0).value, 8);
  assertEqual(machine.drive8.exportD64().length, 174848);
});

test('M9 IEC: SAVE in gemountetes D64 schreibt PRG-Sektorkette', () => {
  const machine = new C64();
  machine.mountD64(fixture().exportImage());
  machine.drive8.openChannel(1, 'BRAVO', 'write');
  for (const byte of [0, 0xc0, 0xa9, 0x2a, 0x60]) machine.drive8.writeChannel(1, byte);
  assertTrue(machine.drive8.closeChannel(1));
  assertBytes(machine.drive8.diskImage.readPRG('BRAVO'), Uint8Array.of(0,0xc0,0xa9,0x2a,0x60));
});

test('M9 GCR: bekannte Commodore-Nibble-Codierung', () => {
  const block = GCRCodec.encode(Uint8Array.of(0, 17, 34, 51));
  assertBytes(block, Uint8Array.of(0x52, 0x96, 0xb9, 0x4a, 0x73));
  assertBytes(GCRCodec.decode(block), Uint8Array.of(0, 17, 34, 51));
});

test('M9 GCR: Sektor-Checksummen und Track-Bytefolge', () => {
  const disk = fixture();
  const bytes = disk.readSector(1, 0);
  const sector = GCRCodec.encodeSector(1, 0, bytes, [52, 50]);
  assertEqual(GCRCodec.decode(sector.header)[0], 8);
  assertEqual(GCRCodec.decode(sector.data)[0], 7);
  assertEqual(GCRCodec.decode(sector.data)[257], bytes.reduce((a,b) => a ^ b, 0));
  assertTrue(GCRCodec.encodeTrack(disk, 1).length > 6000);
  assertThrows(() => GCRCodec.decode(Uint8Array.of(255, 255, 255, 255, 255)), Error);
});

test('M9 VIA: DDRA/DDRB und physische Portpegel', () => {
  const via = new VIA6522({ readPort: () => 0x0f });
  via.writeRegister(2, 0xf0);
  via.writeRegister(0, 0xa0);
  assertEqual(via.readRegister(0), 0xaf);
  via.writeRegister(3, 0xf0);
  via.writeRegister(1, 0x50);
  assertEqual(via.readRegister(1), 0x5f);
});

test('M9 VIA: Timer 1 one-shot und maskierter IRQ', () => {
  const via = new VIA6522();
  via.writeRegister(14, 0xc0);
  via.writeRegister(4, 2);
  via.writeRegister(5, 0);
  for (let i = 0; i < 3; i += 1) via.tick();
  assertEqual(via.readRegister(13) & 0xc0, 0xc0);
  via.readRegister(4);
  assertEqual(via.readRegister(13) & 0x80, 0);
  for (let i = 0; i < 10; i += 1) via.tick();
  assertEqual(via.readRegister(13) & 0x40, 0);
});

test('M9 VIA: Timer 1 continuous, Timer 2 und IER-Quittierung', () => {
  const via = new VIA6522();
  via.writeRegister(11, 0x40);
  via.writeRegister(14, 0xe0);
  via.writeRegister(4, 1);
  via.writeRegister(5, 0);
  via.writeRegister(8, 1);
  via.writeRegister(9, 0);
  for (let i = 0; i < 2; i += 1) via.tick();
  assertEqual(via.readRegister(13) & 0x60, 0x60);
  via.writeRegister(13, 0x60);
  assertEqual(via.readRegister(13) & 0x7f, 0);
  for (let i = 0; i < 2; i += 1) via.tick();
  assertEqual(via.readRegister(13) & 0x40, 0x40);
  assertEqual(via.readRegister(13) & 0x20, 0);
});

test('M9 VIA: CA1/CB1-Flanken und Interruptmasken', () => {
  const via = new VIA6522();
  via.writeRegister(14, 0x92);
  via.setCA1(false);
  assertEqual(via.readRegister(13) & 2, 2);
  via.readRegister(1);
  assertEqual(via.readRegister(13) & 2, 0);
  via.setCB1(false);
  assertEqual(via.readRegister(13) & 0x10, 0x10);
});

test('M9 1541: eigener RAM-/VIA-/ROM-Adressbus', () => {
  const drive = new Drive1541();
  drive.write(0x0100, 0x66);
  assertEqual(drive.read(0x0900), 0x66);
  drive.write(0x1802, 0xff);
  assertEqual(drive.read(0x1802), 0xff);
  drive.loadROM(new Uint8Array(16384).fill(0xea));
  assertEqual(drive.read(0xc000), 0xea);
  assertEqual(drive.read(0x8000), 255);
  assertThrows(() => drive.loadROM(new Uint8Array(1024)), RangeError);
});

test('M9 1541: eigene 6502 führt ROM-Reset und RAM-Write aus', () => {
  const drive = new Drive1541();
  const rom = new Uint8Array(16384).fill(0xea);
  rom.set([0xa9,0x37,0x85,0x20,0x4c,0x04,0xc0], 0);
  rom[0x3ffc] = 0;
  rom[0x3ffd] = 0xc0;
  drive.loadROM(rom);
  for (let i = 0; i < 25; i += 1) drive.step();
  assertEqual(drive.ram[0x20], 0x37);
  assertEqual(drive.cpu.getState().jammed, false);
});

test('M9 1541: unabhängiges Taktverhältnis bleibt über längere Läufe stabil', () => {
  const drive = new Drive1541({ c64Hz: PAL_PROFILE.cpuHz, driveHz: 1000000 });
  const actual = drive.advanceC64Cycles(10000);
  assertEqual(actual, Math.floor(10000 * 1000000 / PAL_PROFILE.cpuHz));
  assertEqual(drive.cycles, actual);
});

test('M9 1541: Motor, Spurwahl und rotierender GCR-Datenpfad', () => {
  const drive = new Drive1541();
  drive.mount(fixture());
  drive.via2.writeRegister(2, 0x0f);
  drive.via2.writeRegister(0, 0x04);
  for (let i = 0; i < 200; i += 1) drive.step();
  assertTrue(drive.motorOn);
  assertTrue(drive.bitPosition > 0);
  assertEqual(drive.headTrack, 18);
  drive.via2.writeRegister(0, 0x05);
  assertEqual(drive.halfTrack, 37);
});

test('M9 1541: Hardwaremodus ist explizit und ROM-pflichtig', () => {
  const machine = new C64();
  assertThrows(() => machine.setHardwareDriveEnabled(true), Error);
  machine.load1541ROM(new Uint8Array(16384));
  machine.setHardwareDriveEnabled(true);
  assertEqual(machine.hardwareDriveEnabled, true);
  assertTrue(!machine.iec.devices.has(machine.drive8));
  machine.runCycles(100);
  assertTrue(machine.hardwareDrive.cycles > 0);
  machine.setHardwareDriveEnabled(false);
  assertTrue(machine.iec.devices.has(machine.drive8));
});

test('M9 NTSC: MOS 6567R8 besitzt 263 Zeilen und 65 Takte', () => {
  assertEqual(NTSC_PROFILE.linesPerFrame, 263);
  assertEqual(NTSC_PROFILE.cyclesPerLine, 65);
  const clock = new Clock(NTSC_PROFILE);
  assertEqual(clock.cyclesPerFrame, 17095);
  clock.runCycles(65);
  assertEqual(clock.getPosition().raster, 1);
  const timing = new VideoTiming(NTSC_PROFILE);
  assertEqual(timing.visibleHeight, 240);
});

test('M9 NTSC: Umschaltung führt vollständigen Raster-Frame aus', () => {
  const machine = new C64();
  machine.setVideoStandard('NTSC');
  assertEqual(machine.clock.cyclesPerFrame, 17095);
  machine.runCycles(17095);
  assertEqual(machine.vic.frameNumber, 1);
  assertEqual(machine.vic.getFrame().data.length, 404 * 240);
});

test('M9 PAL: Wechsel NTSC zu PAL regeneriert 312×63-Profil', () => {
  const machine = new C64({ videoStandard: 'NTSC' });
  machine.setVideoStandard('PAL');
  assertEqual(machine.clock.profile.cpuHz, PAL_PROFILE.cpuHz);
  assertEqual(machine.clock.cyclesPerFrame, 19656);
  machine.runCycles(19656);
  assertEqual(machine.vic.frameNumber, 1);
  assertEqual(machine.vic.getFrame().data.length, 404 * 284);
});

test('M9 SID: 6581 und 8580 verändern das Filtermodell', () => {
  const sid = new SID6581();
  sid.writeRegister(0xd415, 0x07);
  sid.writeRegister(0xd416, 0x60);
  const alpha6581 = sid.filter.alpha;
  sid.setModel('8580');
  assertEqual(sid.filter.model, '8580');
  assertTrue(sid.filter.alpha !== alpha6581);
  assertThrows(() => sid.setModel('unknown'), RangeError);
});

test('M9 SID: beide Modelle behalten identisches Register- und Zyklusinterface', () => {
  for (const model of ['6581', '8580']) {
    const sid = new SID6581({ model });
    sid.writeRegister(0xd400, 0x11);
    sid.writeRegister(0xd401, 0x22);
    sid.writeRegister(0xd405, 0x08);
    sid.writeRegister(0xd406, 0xf0);
    sid.writeRegister(0xd404, 0x21);
    for (let i = 0; i < 100; i += 1) sid.tick();
    assertEqual(sid.voices[0].frequency, 0x2211);
    assertEqual(sid.cycles, 100);
  }
});

test('M9 Gamepad: Achsen, Buttons, D-Pad und Gegenrichtungen', () => {
  const output = [];
  const gamepad = new Gamepad(event => output.push(event));
  gamepad.setEnabled(true);
  const pad = { connected: true, axes: [-0.8, 0.8], buttons: [{ pressed: true }] };
  gamepad.poll([pad]);
  assertEqual(output.length, 3);
  assertTrue(output.some(item => item.direction === 'left' && item.pressed));
  assertTrue(output.some(item => item.direction === 'down' && item.pressed));
  assertTrue(output.some(item => item.type === 'fire' && item.pressed));
  gamepad.poll([pad]);
  assertEqual(output.length, 3);
  gamepad.poll([]);
  assertEqual(output.length, 6);
});

test('M9 Gamepad: zwei unabhängige C64-Joystickports', () => {
  const machine = new C64();
  const gamepad = new Gamepad(event => machine.queueInput(event));
  gamepad.setEnabled(true);
  gamepad.poll([
    { connected: true, axes: [0, -1], buttons: [] },
    { connected: true, axes: [1, 0], buttons: [] }
  ]);
  machine.step();
  assertEqual(machine.joystick.getState(2).up, true);
  assertEqual(machine.joystick.getState(1).right, true);
  gamepad.setEnabled(false);
  machine.step();
  assertEqual(machine.joystick.getState(2).up, false);
});

test('M9 Worker: request/response und unabhängiges Instanzprotokoll', async () => {
  class FakeWorker {
    postMessage(data) {
      queueMicrotask(() => this.onmessage({ data: { id: data.id, ok: true, result: { command: data.command, cycles: data.cycles ?? 0 } } }));
    }
    terminate() { this.closed = true; }
  }
  const worker = new WorkerRunner({ factory: () => new FakeWorker() });
  const init = await worker.start('NTSC', '8580');
  assertEqual(init.command, 'init');
  const result = await worker.request('run', { cycles: 17095 });
  assertEqual(result.cycles, 17095);
  worker.terminate();
  let rejected = false;
  try { await worker.request('state'); } catch { rejected = true; }
  assertTrue(rejected);
});

test('M9 Integration: PAL-Regression bei aktivierten optionalen Komponenten', () => {
  const machine = new C64();
  machine.mountD64(fixture().exportImage());
  machine.setSIDModel('8580');
  machine.loadSIDDemo();
  machine.runCycles(19656);
  assertEqual(machine.clock.cyclesPerFrame, 19656);
  assertEqual(machine.vic.frameNumber, 1);
  assertEqual(machine.files.get('ALPHA').data[0], 1);
  assertEqual(machine.sid.filter.model, '8580');
});

test('M9 D64: bestehende PRG-Datei überschreiben und Sektoren freigeben', () => {
  const disk = fixture();
  const before = disk.freeBlocks();
  const newData = Uint8Array.from({ length: 520 }, (_, i) => (i * 7) & 255);
  disk.writePRG('ALPHA', newData, { overwrite: true });
  assertEqual(disk.listDirectory().length, 1);
  assertEqual(disk.listDirectory()[0].blocks, 3);
  assertBytes(disk.readPRG('ALPHA'), newData);
  assertEqual(disk.freeBlocks(), before - 2);
  assertEqual(disk.deletePRG('ALPHA'), 3);
  assertEqual(disk.freeBlocks(), before + 1);
});

test('M9 D64: Directory erweitert sich bei mehr als acht Dateien auf Spur 18', () => {
  const disk = D64Image.create();
  for (let i = 0; i < 10; i += 1) disk.writePRG(`FILE${i}`, Uint8Array.of(1,8,i));
  assertEqual(disk.listDirectory().length, 10);
  assertEqual(disk.readSector(18,1)[0], 18);
  assertEqual(disk.readPRG('FILE9')[2], 9);
});

test('M9 D64: Browserimport nach Mount erscheint auch im D64-Export', () => {
  const machine = new C64();
  machine.mountD64(fixture().exportImage());
  machine.files.store('ADDED', Uint8Array.of(1,8,0x60));
  const exported = new D64Image(machine.drive8.exportD64());
  assertBytes(exported.readPRG('ADDED'), Uint8Array.of(1,8,0x60));
});
