import { test, assertEqual, assertTrue, assertThrows, assertBytes } from './harness.js';
import { C64 } from '../core/C64.js';
import { crc32, findScreenText, verifyScenario, verifyManifest } from '../verification/ReferenceHarness.js';
import { SpriteEngine } from '../video/SpriteEngine.js';
import { VideoTiming } from '../video/VideoTiming.js';

function roms(machine) {
  machine.loadROM('basic', new Uint8Array(8192));
  machine.loadROM('kernal', new Uint8Array(8192));
  machine.loadROM('chargen', new Uint8Array(4096));
}

test('M8 Referenz: CRC32 hat bekannten ISO-3309-Prüfwert', () => {
  const bytes = Uint8Array.from('123456789', letter => letter.charCodeAt(0));
  assertEqual(crc32(bytes), 0xcbf43926);
  assertEqual(crc32(new Uint8Array()), 0);
});

test('M8 Referenz: CPU-RMW-Szenario verifiziert drei echte Schreibzugriffe', () => {
  const result = verifyScenario({
    id: 'rmw',
    setup: { program: [0xa9, 0x2a, 0x8d, 0, 0xc1, 0xee, 0, 0xc1] },
    run: { cycles: 12, traceFilter: 'writes' },
    expect: {
      cpu: { A: 0x2a, PC: 0xc008 },
      memory: [{ address: 0xc100, value: 0x2b }],
      trace: [
        { cycle: 5, kind: 'write', address: 0xc100, value: 0x2a },
        { cycle: 10, kind: 'write', address: 0xc100, value: 0x2a },
        { cycle: 11, kind: 'write', address: 0xc100, value: 0x2b }
      ]
    }
  });
  assertEqual(result.status, 'passed');
  assertEqual(result.eventsCaptured, 3);
});

test('M8 Referenz: falscher erwarteter Speicherwert wird als Failure gemeldet', () => {
  const result = verifyScenario({
    id: 'negative-ram', setup: { program: [0xa9, 0x10] },
    run: { cycles: 2 }, expect: { cpu: { A: 0x11 } }
  });
  assertEqual(result.status, 'failed');
  assertEqual(result.mismatches[0].path, 'cpu.A');
});

test('M8 Referenz: falsche Busadresse wird erkannt', () => {
  const result = verifyScenario({
    id: 'negative-bus', setup: { program: [0xa9, 1] },
    run: { cycles: 2, traceFilter: 'reads' },
    expect: { trace: [{ cycle: 0, address: 0xc001 }, { cycle: 1, address: 0xc001 }] }
  });
  assertEqual(result.status, 'failed');
  assertTrue(result.mismatches.some(entry => entry.path === 'trace[0].address'));
});

test('M8 Referenz: fehlende Original-ROMs werden als skipped statt bestanden klassifiziert', () => {
  const result = verifyScenario({ id: 'original', kind: 'rom-boot' });
  assertEqual(result.status, 'skipped');
  assertEqual(result.classification, 'requires-original-roms');
});

test('M8 Referenz: falsche Manifestversion wird zurückgewiesen', () => {
  assertThrows(() => verifyManifest({ format: 'wrong', scenarios: [] }), TypeError);
});

test('M8 Referenz: doppelte Manifest-IDs werden zurückgewiesen', () => {
  assertThrows(() => verifyManifest({ format: 'c64-reference-v1', scenarios: [
    { id: 'dup', setup: { program: [0xea] }, run: { cycles: 2 } },
    { id: 'dup', setup: { program: [0xea] }, run: { cycles: 2 } }
  ] }), Error);
});

test('M8 Referenz: RAM-Bild muss exakt 64 KiB groß sein', () => {
  const result = verifyManifest({ format: 'c64-reference-v1', scenarios: [{
    id: 'bad-image', setup: { memoryImage: 'cpu.bin' }, run: { cycles: 2 }
  }] }, { loadBinary: () => new Uint8Array(128) });
  assertEqual(result[0].status, 'error');
  assertTrue(result[0].reason.includes('65536'));
});

test('M8 Referenz: externes 64-KiB-Abbild wird als CPU-RAM tatsächlich ausgeführt', () => {
  const image = new Uint8Array(65536);
  image.set([0xa9, 0x36, 0x8d, 0x00, 0xc3], 0xc000);
  const result = verifyScenario({
    id: 'external-bin', source: { type: 'external' },
    setup: { memoryImage: 'fixture.bin', cpu: { PC: '$c000' } },
    run: { cycles: 6 }, expect: { memory: [{ address: '$c300', value: 0x36 }] }
  }, { loadBinary: name => name === 'fixture.bin' ? image : null });
  assertEqual(result.status, 'passed');
  assertEqual(result.classification, 'external-candidate');
});

test('M8 Referenz: Bildschirmtext wird ausschließlich aus tatsächlich geschriebenem Screen-RAM erkannt', () => {
  const machine = new C64();
  assertEqual(findScreenText(machine, 'READY.'), -1);
  const text = Array.from('READY.', character => character.charCodeAt(0) & 63);
  machine.memory.ram.set(text, 0x0400 + 40);
  assertEqual(findScreenText(machine, 'READY.'), 0x0400 + 40);
});

test('M8 Referenz: VIC-Rasterposition stimmt nach Frame-Rollover mit Clock überein', () => {
  const m = new C64();
  m.loadDiagnosticProgram(Uint8Array.from([0x4c, 0, 0xc0]));
  m.runCycles(19656 + 4 * 63 + 1);
  const state = m.vic.getState();
  assertEqual(state.frameNumber, 1);
  assertEqual(state.raster, 4);
  assertEqual(state.cycleInLine, 0);
  assertEqual(m.clock.getPosition().cycleInLine, 1);
});

test('M8 Fehlerkorrektur: bei Vordergrunddeckung kann ein niedriger priorisierter sichtbarer Sprite erscheinen', () => {
  const registers = new Uint8Array(0x40);
  registers[0x15] = 3;
  registers[0] = 24;
  registers[2] = 24;
  registers[0x1b] = 1;
  registers[0x27] = 2;
  registers[0x28] = 7;
  const engine = new SpriteEngine({
    memory: { read: () => 0xff }, registers, screenBase: () => 0x0400,
    irq: () => {}, timing: new VideoTiming()
  });
  engine.lineNumber = 100;
  engine.lineTag[0] = 100;
  engine.lineTag[1] = 100;
  engine.data.set([0x80, 0, 0, 0x80, 0, 0]);
  assertEqual(engine.mixPixel(120, 100, true, 5, true), 7);
  assertEqual(engine.spriteCollision, 3);
  assertEqual(engine.dataCollision, 3);
});

test('M8 Fehlerkorrektur: beide verdeckten Sprites kollidieren, ohne Farbe zu übermalen', () => {
  const registers = new Uint8Array(0x40);
  registers[0x15] = 3;
  registers[0] = 24;
  registers[2] = 24;
  registers[0x1b] = 3;
  const engine = new SpriteEngine({ memory: { read: () => 0xff }, registers, screenBase: () => 0x400,
    irq: () => {}, timing: new VideoTiming() });
  engine.lineNumber = 100;
  engine.lineTag[0] = 100;
  engine.lineTag[1] = 100;
  engine.data.set([0x80, 0, 0, 0x80, 0, 0]);
  assertEqual(engine.mixPixel(120, 100, true, 5, true), 5);
  assertEqual(engine.spriteCollision, 3);
});

test('M8 KERNAL: Diagnosen können den gebooteten Hardwarezustand erhalten', () => {
  const m = new C64();
  roms(m);
  m.memory.writeRAM(0x0400, 0x42);
  m.cia1.writeRegister(4, 0x10);
  m.cia1.writeRegister(5, 0);
  m.cia1.writeRegister(14, 0x11);
  m.runCycles(100);
  const frames = m.vic.frameNumber;
  const ciaCycles = m.cia1.cycles;
  const size = m.installKernalFileDemo('load', 'M8LOAD', 1, { preserveSystem: true });
  assertTrue(size > 10);
  assertEqual(m.memory.readRAM(0x0400), 0x42);
  assertEqual(m.cia1.cycles, ciaCycles);
  assertEqual(m.vic.frameNumber, frames);
  assertEqual(m.cpu.PC, 0xc000);
});

test('M8 IEC: RESET erhält virtuelle Diskdateien und verwirft offene Kanäle', () => {
  const m = new C64();
  m.files.store('M8', Uint8Array.from([1, 8, 0x55]));
  m.drive8.openChannel(5, 'M8');
  m.powerOn();
  assertEqual(m.files.match('M8').data[2], 0x55);
  assertEqual(m.drive8.channels.has(5), false);
  assertTrue(m.iec.sample('CLOCK'));
  assertTrue(m.iec.sample('DATA'));
});

test('M8 IRQ: maskierte Rasterquelle bleibt gelatcht und kann später IRQ auslösen', () => {
  const m = new C64();
  m.bus.cpuWrite(0xd012, 3);
  m.runCycles(3 * 63 + 1);
  assertEqual(m.interrupts.isIRQActive(), false);
  assertEqual(m.bus.peek(0xd019) & 1, 1);
  m.bus.cpuWrite(0xd01a, 1);
  assertEqual(m.interrupts.isIRQActive(), true);
  m.bus.cpuWrite(0xd019, 1);
  assertEqual(m.interrupts.isIRQActive(), false);
});

test('M8 CPU-Referenzadapter besitzt flaches RAM auch bei $0000 und $0001', () => {
  const result = verifyScenario({
    id: 'flat-zero-page', hardware: 'cpu6502',
    setup: { address: 0xc000, program: [0xa9, 0x56, 0x85, 0, 0xa9, 0x78, 0x85, 1], port: '$34' },
    run: { cycles: 10, traceFilter: 'writes' },
    expect: {
      memory: [{ address: 0, value: 0x56 }, { address: 1, value: 0x78 }],
      cpu: { A: 0x78, PC: 0xc008 },
      trace: [{ cycle: 4, address: 0, kind: 'write' }, { cycle: 9, address: 1, kind: 'write' }]
    }
  });
  assertEqual(result.status, 'passed');
});

test('M8 CPU-Referenzadapter führt 6502-Reset-Vektor ohne ROM-Banking aus', () => {
  const result = verifyScenario({
    id: 'flat-vector', hardware: 'cpu6502',
    setup: { memory: [{ address: 0xfffc, value: 0x00 }, { address: 0xfffd, value: 0x40 }] },
    run: { cycles: 7 },
    expect: { cpu: { PC: 0x4000 } }
  });
  assertEqual(result.status, 'passed');
});

test('M8 Referenz: der reine CPU-Adapter weist VIC-spezifische Prüfpunkte zurück', () => {
  const result = verifyManifest({ format: 'c64-reference-v1', scenarios: [{
    id: 'wrong-target', hardware: 'cpu6502', setup: { program: [0xea] },
    run: { cycles: 2 }, expect: { vic: { raster: 0 } }
  }] });
  assertEqual(result[0].status, 'error');
});
