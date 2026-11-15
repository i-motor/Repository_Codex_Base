import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IECBus } from '../io/IECBus.js';
import { VirtualDrive1541, buildDirectoryListing } from '../storage/VirtualDrive1541.js';
import { DiskDirectory, matchPattern } from '../storage/DiskDirectory.js';
import { D64Image, sectorsPerTrack } from '../storage/D64Image.js';

class TestScheduler {
  constructor() {
    this.now = 0;
    this.events = [];
  }

  schedule(delay, callback) {
    const event = { at: this.now + Math.max(1, delay), callback };
    this.events.push(event);
    return event;
  }

  cancel(event) {
    const index = this.events.indexOf(event);
    if (index >= 0) this.events.splice(index, 1);
  }

  tick() {
    this.now++;
    for (;;) {
      const due = this.events.filter((e) => e.at <= this.now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.cancel(due);
      due.callback();
    }
  }
}

class Controller {
  constructor() {
    this.bus = new IECBus();
    this.scheduler = new TestScheduler();
    this.storage = new DiskDirectory({ name: 'TESTDISK', id: 'T1' });
    this.drive = new VirtualDrive1541({ bus: this.bus, scheduler: this.scheduler, storage: this.storage });
    this.atn = false;
    this.clk = false;
    this.data = false;
  }

  set(atn, clk, data) {
    this.atn = atn;
    this.clk = clk;
    this.data = data;
    this.bus.setControllerOutputs(atn, clk, data);
  }

  wait(cycles) {
    for (let i = 0; i < cycles; i++) this.scheduler.tick();
  }

  waitFor(predicate, limit = 5000) {
    for (let i = 0; i < limit; i++) {
      if (predicate()) return i;
      this.scheduler.tick();
    }
    return -1;
  }

  sendByte(value, eoi = false) {
    if (this.waitFor(() => !this.bus.data, 2000) < 0) return 'device not present';
    this.set(this.atn, false, false);
    this.waitFor(() => this.bus.data);
    if (eoi) {
      if (this.waitFor(() => !this.bus.data, 1000) < 0) return 'no eoi ack';
      this.waitFor(() => this.bus.data);
    }
    this.set(this.atn, true, false);
    for (let bit = 0; bit < 8; bit++) {
      this.wait(10);
      if (!this.bus.data) return 'frame error';
      this.set(this.atn, true, ((value >> bit) & 1) === 0);
      this.wait(5);
      this.set(this.atn, false, this.data);
      this.wait(20);
      this.set(this.atn, true, false);
    }
    return this.waitFor(() => !this.bus.data, 1000) >= 0 ? 'ok' : 'no frame ack';
  }

  command(bytes) {
    this.set(true, true, false);
    this.wait(1000);
    const results = bytes.map((b) => this.sendByte(b));
    return results;
  }

  release() {
    this.set(false, false, false);
    this.wait(50);
  }

  sendData(bytes) {
    const results = bytes.map((b, i) => this.sendByte(b, i === bytes.length - 1));
    return results;
  }

  turnaround() {
    this.set(true, true, true);
    this.wait(20);
    this.set(false, false, true);
    return this.waitFor(() => !this.bus.clk, 2000) >= 0;
  }

  receive(limit = 20000) {
    const bytes = [];
    let eoi = false;
    while (!eoi && bytes.length < limit) {
      if (this.waitFor(() => this.bus.clk, 5000) < 0) return { bytes, error: 'talker not ready' };
      this.set(false, false, false);
      let timedOut = this.waitFor(() => !this.bus.clk, 256) < 0;
      if (timedOut) {
        eoi = true;
        this.set(false, false, true);
        this.wait(60);
        this.set(false, false, false);
        if (this.waitFor(() => !this.bus.clk, 256) < 0) return { bytes, error: 'timeout' };
      }
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (this.waitFor(() => this.bus.clk, 1000) < 0) return { bytes, error: 'bit timeout' };
        value |= (this.bus.data ? 1 : 0) << bit;
        if (this.waitFor(() => !this.bus.clk, 1000) < 0) return { bytes, error: 'bit timeout' };
      }
      this.set(false, false, true);
      bytes.push(value);
    }
    return { bytes, eoi };
  }

  untalk() {
    this.set(true, true, false);
    this.wait(1000);
    const result = this.sendByte(0x5f);
    this.release();
    return result;
  }
}

const ascii = (text) => Array.from(text, (c) => c.charCodeAt(0));

function load(controller, name) {
  controller.command([0x28, 0xf0]);
  controller.set(false, true, false);
  controller.sendData(ascii(name));
  controller.command([0x3f]);
  controller.release();
  controller.command([0x48, 0x60]);
  controller.turnaround();
  const result = controller.receive();
  controller.untalk();
  controller.command([0x28, 0xe0, 0x3f]);
  controller.release();
  return result;
}

test('IEC: Gerät bestätigt ATN, Kommandos LISTEN/OPEN werden angenommen', () => {
  const controller = new Controller();
  assert.deepEqual(controller.command([0x28, 0xf0]), ['ok', 'ok']);
  assert.equal(controller.drive.listening, true);
  assert.equal(controller.drive.openPending, true);
});

test('IEC: nicht vorhandenes Gerät wird erkannt', () => {
  const controller = new Controller();
  const results = controller.command([0x29, 0x60]);
  assert.equal(results[0], 'ok');
  assert.notEqual(results[1], 'ok');
});

test('IEC: Verzeichnis laden ($) liefert BASIC-Listing mit EOI', () => {
  const controller = new Controller();
  controller.storage.writeFile('SPIEL', new Uint8Array(600));
  const result = load(controller, '$');
  assert.equal(result.eoi, true);
  assert.deepEqual(result.bytes, Array.from(buildDirectoryListing(controller.storage)));
});

test('IEC: Datei laden über Kanal 0 inklusive Ladeadresse', () => {
  const controller = new Controller();
  const prg = Uint8Array.from([0x01, 0x08, 1, 2, 3, 4, 5]);
  controller.storage.writeFile('ANDERE', Uint8Array.from([0x01, 0x08, 9]));
  controller.storage.writeFile('DEMO', prg);
  const result = load(controller, 'DEMO');
  assert.deepEqual(result.bytes, Array.from(prg));
  assert.equal(controller.drive.status.startsWith('00'), true);
});

test('IEC: nicht gefundene Datei → Gerät sendet nichts, Status 62', () => {
  const controller = new Controller();
  const result = load(controller, 'FEHLT');
  assert.equal(result.bytes.length, 0);
  assert.equal(result.error, 'timeout');
  assert.ok(controller.drive.status.startsWith('62,FILE NOT FOUND'));
});

test('IEC: Speichern über Kanal 1 legt Datei an', () => {
  const controller = new Controller();
  controller.command([0x28, 0xf1]);
  controller.set(false, true, false);
  controller.sendData(ascii('NEU'));
  controller.command([0x3f]);
  controller.release();
  controller.command([0x28, 0x61]);
  controller.set(false, true, false);
  controller.sendData([0x00, 0xc0, 0xa9, 0x01, 0x60]);
  controller.command([0x3f]);
  controller.release();
  controller.command([0x28, 0xe1, 0x3f]);
  controller.release();
  const file = controller.storage.readFile('NEU');
  assert.ok(file);
  assert.deepEqual(Array.from(file.data), [0x00, 0xc0, 0xa9, 0x01, 0x60]);
});

test('IEC: Fehlerkanal 15 liefert Statusmeldung', () => {
  const controller = new Controller();
  controller.command([0x48, 0x6f]);
  controller.turnaround();
  const result = controller.receive();
  controller.untalk();
  assert.equal(String.fromCharCode(...result.bytes), '73,CBM DOS V2.6 1541,00,00\r');
});

test('Virtuelle Diskette: Muster, Löschen, Umbenennen, freie Blöcke', () => {
  const disk = new DiskDirectory();
  disk.writeFile('test.prg', new Uint8Array(254 * 3));
  disk.writeFile('ZWEI', new Uint8Array(10));
  assert.equal(disk.listFiles()[0].name, 'TEST');
  assert.equal(disk.listFiles()[0].blocks, 3);
  assert.equal(disk.blocksFree(), 664 - 4);
  assert.equal(disk.readFile('T*').name, 'TEST');
  assert.equal(disk.readFile('Z??I').name, 'ZWEI');
  assert.equal(disk.renameFile('ZWEI', 'DREI'), true);
  assert.equal(disk.deleteFile('DREI'), 1);
  assert.equal(matchPattern('*', 'ABC'), true);
  assert.equal(matchPattern('AB', 'ABC'), false);
});

test('D64: Formatieren, Schreiben, Lesen, Verzeichnis und BAM', () => {
  const image = new D64Image();
  assert.equal(image.data.length, 174848);
  assert.equal(image.blocksFree(), 664);
  const data = new Uint8Array(1000).map((_, i) => i & 0xff);
  image.writeFile('DATEI', data, 'PRG');
  assert.equal(image.blocksFree(), 664 - 4);
  const back = image.readFile('DATEI');
  assert.deepEqual(Array.from(back.data), Array.from(data));
  const reloaded = new D64Image(image.toBytes());
  assert.equal(reloaded.listFiles()[0].name, 'DATEI');
  assert.equal(reloaded.listFiles()[0].blocks, 4);
  for (let i = 0; i < 12; i++) reloaded.writeFile(`F${i}`, new Uint8Array(10));
  assert.equal(reloaded.listFiles().length, 13);
  assert.equal(reloaded.deleteFile('F*'), 12);
  assert.equal(reloaded.blocksFree(), 660);
  assert.equal(sectorsPerTrack(1) + sectorsPerTrack(18) + sectorsPerTrack(25) + sectorsPerTrack(35), 21 + 19 + 18 + 17);
});
