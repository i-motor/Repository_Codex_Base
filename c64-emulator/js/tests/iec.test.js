import { test, assertEqual, assertTrue, assertBytes } from './harness.js';
import { IECBus } from '../io/IECBus.js';
import { VirtualDrive1541 } from '../storage/VirtualDrive1541.js';
import { FileManager } from '../storage/FileManager.js';
import { PRGLoader } from '../storage/PRGLoader.js';
import { C64 } from '../core/C64.js';

function fixture() {
  const bus = new IECBus();
  const files = new FileManager();
  const drive = new VirtualDrive1541(bus, files);
  let cycle = 0;
  const tick = (n = 1) => { for (let i = 0; i < n; i += 1) bus.tick(++cycle); };
  const host = (atn, clock, data) => {
    bus.drive('host', 'ATN', atn);
    bus.drive('host', 'CLOCK', clock);
    bus.drive('host', 'DATA', data);
  };
  const byte = (value, atn) => {
    for (let index = 0; index < 8; index += 1) {
      host(atn, true, !(value & (1 << index)));
      tick(25);
      host(atn, false, !(value & (1 << index)));
      tick(25);
    }
    host(atn, true, false);
    tick(90);
  };
  return { bus, drive, files, tick, host, byte };
}

test('M7 IEC: offene Kollektoren ermöglichen mehrere aktive Low-Treiber', () => {
  const { bus } = fixture();
  bus.drive('a', 'DATA', true);
  bus.drive('b', 'DATA', true);
  assertEqual(bus.sample('DATA'), false);
  bus.drive('a', 'DATA', false);
  assertEqual(bus.sample('DATA'), false);
  bus.drive('b', 'DATA', false);
  assertEqual(bus.sample('DATA'), true);
});

test('M7 IEC: ATN, CLOCK und DATA werden über echte IEC-Kanten dekodiert', () => {
  const { drive, host, tick, byte } = fixture();
  host(true, true, false);
  tick(90);
  byte(0x28, true);
  byte(0xf0, true);
  host(false, true, false);
  tick(90);
  for (const char of 'HELLO') byte(char.charCodeAt(0), false);
  host(true, true, false);
  tick(90);
  byte(0x3f, true);
  assertTrue(drive.events.some(event => event.type === 'command' && event.value === 0x28));
  assertTrue(drive.events.some(event => event.type === 'command' && event.value === 0xf0));
  assertTrue(drive.events.some(event => event.type === 'open' && event.value === '0:HELLO'));
  assertEqual(drive.getState().listening, false);
});

test('M7 IEC: fremde Geräteadressen werden ignoriert', () => {
  const { drive } = fixture();
  drive.receiveCommand(0x29);
  drive.receiveCommand(0xf0);
  assertEqual(drive.getState().listening, false);
  assertEqual(drive.channels.size, 1);
});

test('M7 IEC: LISTEN und TALK wählen das virtuelle Gerät 8', () => {
  const { drive } = fixture();
  drive.receiveCommand(0x28);
  assertEqual(drive.getState().listening, true);
  drive.receiveCommand(0x3f);
  assertEqual(drive.getState().listening, false);
  drive.receiveCommand(0x48);
  assertEqual(drive.getState().talking, true);
  drive.receiveCommand(0x5f);
  assertEqual(drive.getState().talking, false);
});

test('M7 IEC: OPEN und DATA lesen alle PRG-Bytes samt Ladeadresse', () => {
  const { drive, files } = fixture();
  const source = PRGLoader.serialize(0xc000, Uint8Array.from([0xa9, 0x42, 0x60]));
  files.store('MCODE', source);
  drive.receiveCommand(0x28);
  drive.receiveCommand(0xf1);
  for (const char of 'MCODE') drive.receiveByte(char.charCodeAt(0));
  drive.receiveCommand(0x3f);
  drive.receiveCommand(0x48);
  drive.receiveCommand(0x61);
  const bytes = [];
  let last;
  while ((last = drive.readChannel(1)) !== null) bytes.push(last);
  assertBytes(bytes.map(entry => entry.value), source);
  assertEqual(bytes.at(-1).eoi, true);
  assertEqual(bytes[0].eoi, false);
});

test('M7 IEC: sekundäre Adresse 1 ist auch für PRG-LOAD lesbar', () => {
  const { drive, files } = fixture();
  files.store('PROGRAM', Uint8Array.from([1, 8, 55]));
  drive.receiveCommand(0x28);
  drive.receiveCommand(0xf1);
  for (const char of 'PROGRAM') drive.receiveByte(char.charCodeAt(0));
  drive.receiveCommand(0x3f);
  drive.receiveCommand(0x48);
  drive.receiveCommand(0x61);
  assertEqual(drive.readChannel(1).value, 1);
});

test('M7 IEC: SAVE über DATA- und CLOSE-Kanal persistiert das PRG', () => {
  const { drive, files } = fixture();
  drive.receiveCommand(0x28);
  drive.receiveCommand(0xf1);
  for (const char of 'SAVE1') drive.receiveByte(char.charCodeAt(0));
  drive.receiveCommand(0x3f);
  drive.receiveCommand(0x28);
  drive.receiveCommand(0x61);
  for (const byte of [1, 8, 2, 3, 4]) drive.receiveByte(byte);
  drive.receiveCommand(0x3f);
  drive.receiveCommand(0x28);
  drive.receiveCommand(0xe1);
  assertBytes(files.get('SAVE1').data, [1, 8, 2, 3, 4]);
  assertEqual(drive.channels.has(1), false);
});

test('M7 IEC: ein vorhandenes PRG wird ohne @ nicht überschrieben', () => {
  const { drive, files } = fixture();
  files.store('EXISTS', Uint8Array.from([1, 8, 8]));
  drive.openChannel(1, 'EXISTS', 'write');
  for (const byte of [1, 8, 9]) drive.writeChannel(1, byte);
  drive.closeChannel(1);
  assertEqual(files.get('EXISTS').data[2], 8);
  assertTrue(drive.status.includes('FILE EXISTS'));
});

test('M7 IEC: @-Präfix erlaubt Überschreiben beim SAVE', () => {
  const { drive, files } = fixture();
  files.store('EXISTS', Uint8Array.from([1, 8, 8]));
  drive.openChannel(1, '@EXISTS', 'write');
  for (const byte of [1, 8, 9]) drive.writeChannel(1, byte);
  drive.closeChannel(1);
  assertEqual(files.get('EXISTS').data[2], 9);
});

test('M7 IEC: nicht vorhandene Datei setzt Status 62', () => {
  const { drive } = fixture();
  assertEqual(drive.openChannel(0, 'NOTFOUND'), false);
  assertTrue(drive.status.startsWith('62,'));
});

test('M7 IEC: Statuskanal 15 gibt DOS-Statuszeichenfolge zurück', () => {
  const { drive } = fixture();
  drive.openChannel(0, 'MISS');
  const chars = [];
  let packet;
  while ((packet = drive.readChannel(15))) chars.push(packet.value);
  assertTrue(String.fromCharCode(...chars).includes('FILE NOT FOUND'));
});

test('M7 IEC: DOS-Kommandos Scratch und Rename aktualisieren Dateikatalog', () => {
  const { drive, files } = fixture();
  files.store('OLD', Uint8Array.from([1, 8]));
  drive.executeDOSCommand('R:NEW=OLD');
  assertTrue(files.get('NEW') !== null);
  drive.executeDOSCommand('S:NEW');
  assertEqual(files.list().length, 0);
});

test('M7 IEC: Directory-PRG hat gültige BASIC-Zeilenverkettung', () => {
  const { drive, files } = fixture();
  files.store('DEMO', Uint8Array.from([1, 8, 1]));
  const result = drive.directoryPRG();
  assertEqual(result[0] | result[1] << 8, 0x0801);
  let address = 0x0801;
  let index = 2;
  let lines = 0;
  while (index < result.length - 2) {
    const next = result[index] | result[index + 1] << 8;
    assertTrue(next > address);
    index += next - address;
    address = next;
    lines += 1;
  }
  assertEqual(lines, 3);
  assertBytes(result.subarray(-2), [0, 0]);
});

test('M7 IEC: Reset erhält die eingelegte virtuelle Diskette', () => {
  const { drive, bus, files } = fixture();
  files.store('HELLO', Uint8Array.from([1, 8, 4]));
  drive.openChannel(0, 'HELLO');
  bus.reset();
  assertEqual(files.list().length, 1);
  assertEqual(drive.channels.has(0), false);
  assertEqual(drive.channels.has(15), true);
});

test('M7 CIA2: IEC-Ausgänge liegen auf PA3/PA4/PA5 und reagieren invertiert', () => {
  const c64 = new C64();
  c64.bus.cpuWrite(0xdd02, 0x38);
  c64.bus.cpuWrite(0xdd00, 0x18);
  assertEqual(c64.iec.sample('ATN'), false);
  assertEqual(c64.iec.sample('CLOCK'), false);
  assertEqual(c64.iec.sample('DATA'), true);
  c64.bus.cpuWrite(0xdd00, 0x20);
  assertEqual(c64.iec.sample('ATN'), true);
  assertEqual(c64.iec.sample('CLOCK'), true);
  assertEqual(c64.iec.sample('DATA'), false);
});

test('M7 CIA2: CLOCK und DATA gelangen über PA6/PA7 in die CPU', () => {
  const c64 = new C64();
  c64.iec.drive('test', 'CLOCK', true);
  c64.iec.drive('test', 'DATA', true);
  assertEqual(c64.bus.cpuRead(0xdd00) & 0xc0, 0);
  c64.iec.drive('test', 'DATA', false);
  assertEqual(c64.bus.cpuRead(0xdd00) & 0xc0, 0x80);
});

test('M7 KERNAL: Diagnosecode ruft die echten ROM-Einsprungadressen auf', () => {
  const c64 = new C64();
  for (const name of ['basic', 'kernal', 'chargen']) {
    c64.loadROM(name, new Uint8Array({ basic: 8192, kernal: 8192, chargen: 4096 }[name]));
  }
  const size = c64.installKernalFileDemo('load', 'TEST', 1);
  const bytes = c64.memory.ram.subarray(0xc000, 0xc000 + size);
  const includes = code => bytes.some((value, index) => value === 0x20 && bytes[index + 1] === (code & 255) && bytes[index + 2] === (code >>> 8));
  assertTrue(includes(0xffba));
  assertTrue(includes(0xffbd));
  assertTrue(includes(0xffd5));
  assertEqual(c64.cpu.getState().PC, 0xc000);
});

test('M7 KERNAL: SAVE-Diagnose verwendet $FFD8 und Zero-Page-Startzeiger', () => {
  const c64 = new C64();
  for (const name of ['basic', 'kernal', 'chargen']) {
    c64.loadROM(name, new Uint8Array({ basic: 8192, kernal: 8192, chargen: 4096 }[name]));
  }
  const size = c64.installKernalFileDemo('save', 'M7SAVE');
  const bytes = c64.memory.ram.subarray(0xc000, 0xc000 + size);
  assertTrue(bytes.some((value, index) => value === 0x20 && bytes[index + 1] === 0xd8 && bytes[index + 2] === 0xff));
  assertEqual(c64.memory.readRAM(0xc300), 7);
});

test('M7 IEC: Gerät 8 sendet Bits getaktet auf DATA und CLOCK zurück', () => {
  const { drive, files, bus, tick, host } = fixture();
  files.store('TALK', Uint8Array.from([0x01, 0x08, 0x3c]));
  drive.openChannel(0, 'TALK');
  drive.receiveCommand(0x48);
  drive.receiveCommand(0x60);
  host(false, false, false);
  tick(1);
  drive.beginTransmit(bus.cycle);
  const seen = [];
  let previous = bus.sample('CLOCK');
  for (let i = 0; i < 10000 && seen.length < 8; i += 1) {
    tick();
    const current = bus.sample('CLOCK');
    if (current && !previous) seen.push(Number(bus.sample('DATA')));
    previous = current;
  }
  const received = seen.reduce((value, bit, index) => value | (bit << index), 0);
  assertEqual(received, 0x01);
});

test('M7 CPU: echte 6510-STA-Befehle übertragen LISTEN und OPEN über CIA2', () => {
  const machine = new C64();
  const code = [];
  const write = value => code.push(0xa9, value & 255, 0x8d, 0x00, 0xdd);
  const idle = count => { for (let i = 0; i < count; i += 1) code.push(0xea); };
  const send = value => {
    for (let bit = 0; bit < 8; bit += 1) {
      const low = 0x18 | ((value & (1 << bit)) ? 0 : 0x20);
      write(low);
      idle(12);
      write(low & ~0x10);
      idle(12);
    }
    write(0x18);
    idle(55);
  };
  code.push(0xa9, 0x38, 0x8d, 0x02, 0xdd);
  write(0x18);
  idle(65);
  send(0x28);
  send(0xf0);
  const loop = 0xc000 + code.length;
  code.push(0x4c, loop & 255, loop >>> 8);
  machine.loadDiagnosticProgram(Uint8Array.from(code));
  machine.processorPort.writePins(0x37);
  machine.runCycles(12000);
  assertTrue(machine.drive8.events.some(event => event.type === 'command' && event.value === 0x28));
  assertTrue(machine.drive8.events.some(event => event.type === 'command' && event.value === 0xf0));
  assertEqual(machine.drive8.getState().listening, true);
});

test('M7 IEC: Host sendet ein ganzes PRG als bitserielles SAVE auf Gerät 8', () => {
  const { drive, files, host, tick, byte } = fixture();
  host(true, true, false);
  tick(90);
  byte(0x28, true);
  byte(0xf1, true);
  host(false, true, false);
  tick(90);
  for (const char of 'WIRE') byte(char.charCodeAt(0), false);
  host(true, true, false);
  tick(90);
  byte(0x3f, true);
  byte(0x28, true);
  byte(0x61, true);
  host(false, true, false);
  tick(90);
  for (const value of [0x01, 0x08, 0xa9, 0x22, 0x60]) byte(value, false);
  host(true, true, false);
  tick(90);
  byte(0x3f, true);
  byte(0x28, true);
  byte(0xe1, true);
  assertBytes(files.get('WIRE').data, [0x01, 0x08, 0xa9, 0x22, 0x60]);
  assertTrue(drive.events.some(event => event.type === 'saved' && event.value === 'WIRE'));
});

test('M7 IEC: Datenstrom des emulierten Laufwerks wird als LSB-first übertragen', () => {
  const { drive, files, bus, tick, host } = fixture();
  files.store('READ', Uint8Array.from([0xa5, 0x08, 0x3c]));
  drive.openChannel(0, 'READ');
  drive.receiveCommand(0x48);
  drive.receiveCommand(0x60);
  host(false, false, false);
  tick(1);
  drive.beginTransmit(bus.cycle);
  const bytes = [];
  let bits = [];
  let previous = bus.sample('CLOCK');
  for (let i = 0; i < 13000 && bytes.length < 3; i += 1) {
    tick();
    const current = bus.sample('CLOCK');
    if (current && !previous) {
      bits.push(Number(bus.sample('DATA')));
      if (bits.length === 8) {
        bytes.push(bits.reduce((value, bit, index) => value | (bit << index), 0));
        bits = [];
        host(false, false, true);
      }
    }
    if (bus.sample('DATA') === false && bus.sample('CLOCK') === false && bits.length === 0) host(false, false, false);
    previous = current;
  }
  assertBytes(bytes, [0xa5, 0x08, 0x3c]);
});

test('M7 KERNAL: synthetisches Test-ROM führt SETLFS/SETNAM/LOAD über echte JSR-Mikrozyklen aus', () => {
  const machine = new C64();
  const kernal = new Uint8Array(8192).fill(0xea);
  kernal[0x1fba] = 0x60;
  kernal[0x1fbd] = 0x60;
  kernal.set([0xa9, 0x42, 0x60], 0x1fd5);
  machine.loadROM('basic', new Uint8Array(8192));
  machine.loadROM('kernal', kernal);
  machine.loadROM('chargen', new Uint8Array(4096));
  const size = machine.installKernalFileDemo('load', 'TEST');
  machine.runCycles(1000);
  assertEqual(machine.memory.readRAM(0xc220), 0x42);
  assertEqual(machine.cpu.getState().PC, 0xc000 + size - 3);
});
