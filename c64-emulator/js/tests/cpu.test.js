import { test, assertEqual, assertTrue, assertBytes } from './harness.js';
import { CPU6510_OPCODES, getClassification } from '../core/CPU6510Opcodes.js';
import { C64 } from '../core/C64.js';

function machine(program, pc = 0x4000, state = {}) {
  const c64 = new C64();
  c64.processorPort.writePins(0x34);
  c64.memory.ram.set(program, pc);
  c64.cpu.setTestState({ PC: pc, SP: 0xfd, P: 0x24, ...state });
  c64.traceEnabled = true;
  return c64;
}

function untilInstructions(c64, count, maxCycles = 1000) {
  const target = c64.cpu.instructionsExecuted + count;
  let countCycles = 0;
  while (c64.cpu.instructionsExecuted < target && countCycles < maxCycles) {
    c64.step();
    countCycles += 1;
  }
  assertEqual(c64.cpu.instructionsExecuted, target, 'Befehlsabschluss');
  return countCycles;
}

test('Opcode-Tabelle: 256 Einträge, 151 offizielle Opcodes und 12 JAM-Werte', () => {
  assertEqual(CPU6510_OPCODES.length, 256);
  assertEqual(CPU6510_OPCODES.filter(entry => entry.classification === 'official').length, 151);
  assertEqual(CPU6510_OPCODES.filter(entry => entry.classification === 'jam').length, 12);
  assertEqual(getClassification(0x02), 'jam');
  assertEqual(getClassification(0xea), 'official');
  assertEqual(getClassification(0x9f), 'approximate');
});

test('Jeder der 256 Opcodes durchläuft einen tatsächlichen CPU-Mikrocodepfad', () => {
  for (const entry of CPU6510_OPCODES) {
    const c64 = machine([entry.opcode, 0x10, 0x20, 0xea], 0x4000, { X: 0, Y: 0 });
    c64.memory.writeRAM(0x10, 0x20);
    c64.memory.writeRAM(0x11, 0x20);
    c64.memory.writeRAM(0x20, 0x20);
    c64.memory.writeRAM(0x21, 0x20);
    c64.memory.writeRAM(0x2020, 0x41);
    c64.memory.writeRAM(0x2010, 0x41);
    const cycles = untilInstructions(c64, 1, 16);
    assertTrue(cycles >= 2 || entry.mnemonic === 'KIL', `Opcode ${entry.opcode.toString(16)}`);
    if (entry.mnemonic === 'KIL') assertTrue(c64.cpu.jammed);
  }
});

test('RESET benötigt sieben Lesezyklen und liest den echten Hardwarevektor', () => {
  const c64 = new C64();
  c64.processorPort.writePins(0x34);
  c64.memory.writeRAM(0xfffc, 0x78);
  c64.memory.writeRAM(0xfffd, 0x56);
  c64.traceEnabled = true;
  c64.runCycles(7);
  assertEqual(c64.cpu.PC, 0x5678);
  assertEqual(c64.cpu.SP, 0xfd);
  assertBytes(c64.trace.map(entry => entry.address), [0, 0, 0x100, 0x1ff, 0x1fe, 0xfffc, 0xfffd]);
  assertTrue(c64.trace.every(entry => entry.kind === 'read'));
});

test('Der echte M2-Bus führt LDA/STA/INC mit NMOS-Dummy-Write aus', () => {
  const c64 = machine([0xa9, 0x2a, 0x8d, 0x00, 0xc1, 0xee, 0x00, 0xc1, 0x4c, 0x08, 0xc0], 0xc000);
  c64.runCycles(12);
  assertEqual(c64.cpu.A, 0x2a);
  assertEqual(c64.memory.readRAM(0xc100), 0x2b);
  assertEqual(c64.cpu.PC, 0xc008);
  const writes = c64.trace.filter(entry => entry.kind === 'write');
  assertBytes(writes.map(entry => entry.cycle), [5, 10, 11]);
  assertBytes(writes.map(entry => entry.value), [0x2a, 0x2a, 0x2b]);
  assertBytes(writes.map(entry => entry.address), [0xc100, 0xc100, 0xc100]);
});

test('LDA absolute,X verwendet beim Seitenwechsel einen Dummy-Read', () => {
  const c64 = machine([0xbd, 0xff, 0x20], 0x4000, { X: 1 });
  c64.memory.writeRAM(0x2100, 0x7e);
  assertEqual(untilInstructions(c64, 1), 5);
  assertBytes(c64.trace.map(entry => entry.address), [0x4000, 0x4001, 0x4002, 0x2000, 0x2100]);
  assertEqual(c64.cpu.A, 0x7e);
});

test('STA absolute,X führt auch ohne Seitenwechsel einen Dummy-Read aus', () => {
  const c64 = machine([0x9d, 0x10, 0x20], 0x4000, { X: 1, A: 0x69 });
  assertEqual(untilInstructions(c64, 1), 5);
  assertBytes(c64.trace.map(entry => entry.address), [0x4000, 0x4001, 0x4002, 0x2011, 0x2011]);
  assertEqual(c64.trace[3].kind, 'read');
  assertEqual(c64.trace[4].kind, 'write');
  assertEqual(c64.memory.readRAM(0x2011), 0x69);
});

test('Indirekter JMP übernimmt den NMOS-Seitenwrap-Bug', () => {
  const c64 = machine([0x6c, 0xff, 0x20]);
  c64.memory.writeRAM(0x20ff, 0x34);
  c64.memory.writeRAM(0x2000, 0x12);
  c64.memory.writeRAM(0x2100, 0xab);
  assertEqual(untilInstructions(c64, 1), 5);
  assertEqual(c64.cpu.PC, 0x1234);
  assertBytes(c64.trace.slice(-2).map(entry => entry.address), [0x20ff, 0x2000]);
});

test('Indexed-indirect wickelt Nullseitenpointer modulo 256', () => {
  const c64 = machine([0xa1, 0xfe], 0x4000, { X: 1 });
  c64.memory.writeRAM(0xff, 0x34);
  c64.memory.writeRAM(0x02, 0xaa);
  c64.memory.writeRAM(0x34aa, 0x58);
  c64.processorPort.writeDDR(0x12);
  c64.memory.writeRAM(0x1234, 0x74);
  assertEqual(untilInstructions(c64, 1), 6);
  assertEqual(c64.cpu.A, 0x74);
});

test('Relative Verzweigung: nicht genommen, genommen, mit Seitenwechsel', () => {
  const no = machine([0xd0, 0x10], 0x4000, { P: 0x22 });
  assertEqual(untilInstructions(no, 1), 2);
  const yes = machine([0xd0, 0xfe], 0x4000, { P: 0x20 });
  assertEqual(untilInstructions(yes, 1), 3);
  assertEqual(yes.cpu.PC, 0x4000);
  const cross = machine([0xd0, 0x02], 0x40fd, { P: 0x20 });
  assertEqual(untilInstructions(cross, 1), 4);
  assertEqual(cross.cpu.PC, 0x4101);
  assertBytes(cross.trace.map(entry => entry.address), [0x40fd, 0x40fe, 0x40ff, 0x4001]);
});

test('JSR und RTS schreiben die reale Rücksprungadresse auf den Stack', () => {
  const c64 = machine([0x20, 0x10, 0x40, 0xea], 0x4000);
  c64.memory.writeRAM(0x4010, 0x60);
  assertEqual(untilInstructions(c64, 1), 6);
  assertEqual(c64.cpu.PC, 0x4010);
  assertEqual(c64.memory.readRAM(0x1fd), 0x40);
  assertEqual(c64.memory.readRAM(0x1fc), 0x02);
  assertEqual(untilInstructions(c64, 1), 6);
  assertEqual(c64.cpu.PC, 0x4003);
  assertEqual(c64.cpu.SP, 0xfd);
});

test('BRK legt PC+2 und B-Flag auf den Stack und liest den IRQ-Vektor', () => {
  const c64 = machine([0x00, 0x00]);
  c64.memory.writeRAM(0xfffe, 0x20);
  c64.memory.writeRAM(0xffff, 0x50);
  assertEqual(untilInstructions(c64, 1), 7);
  assertEqual(c64.cpu.PC, 0x5020);
  assertEqual(c64.memory.readRAM(0x1fc), 0x02);
  assertEqual(c64.memory.readRAM(0x1fb) & 0x30, 0x30);
});

test('IRQ ist maskierbar, sieben Takte lang und sichert das B-Flag gelöscht', () => {
  const c64 = machine([0xea, 0xea], 0x4000, { P: 0x20 });
  c64.memory.writeRAM(0xfffe, 0x00);
  c64.memory.writeRAM(0xffff, 0x80);
  c64.interrupts.setIRQ('cia1', true);
  assertEqual(untilInstructions(c64, 1), 2);
  c64.runCycles(7);
  assertEqual(c64.cpu.PC, 0x8000);
  assertEqual(c64.cpu.interruptsServiced, 1);
  assertEqual(c64.memory.readRAM(0x1fb) & 0x10, 0);
  assertTrue(!!(c64.cpu.P & 4));
});

test('NMI benötigt eine Flanke und hat Vorrang vor IRQ', () => {
  const c64 = machine([0xea, 0xea], 0x4000, { P: 0x20 });
  c64.memory.writeRAM(0xfffa, 0x34);
  c64.memory.writeRAM(0xfffb, 0x12);
  c64.memory.writeRAM(0xfffe, 0x00);
  c64.memory.writeRAM(0xffff, 0x80);
  c64.interrupts.setIRQ('cia1', true);
  c64.interrupts.setNMI('restore', true);
  c64.runCycles(7);
  assertEqual(c64.cpu.PC, 0x1234);
  assertEqual(c64.interrupts.consumeNMI(), false);
  assertEqual(c64.cpu.interruptsServiced, 1);
});

test('CLI verzögert anstehendes IRQ um einen Folgebefehl', () => {
  const c64 = machine([0x58, 0xea, 0xea], 0x4000);
  c64.memory.writeRAM(0xfffe, 0x00);
  c64.memory.writeRAM(0xffff, 0x80);
  c64.interrupts.setIRQ('test', true);
  assertEqual(untilInstructions(c64, 1), 2);
  assertEqual(c64.cpu.PC, 0x4001);
  assertEqual(untilInstructions(c64, 1), 2);
  c64.runCycles(7);
  assertEqual(c64.cpu.PC, 0x8000);
});

test('RDY niedrig wiederholt CPU-Lesezyklen, ohne Mikrocode fortzuschalten', () => {
  const c64 = machine([0xa9, 0x45]);
  c64.step();
  c64.externalRDYHigh = false;
  c64.runCycles(3);
  assertEqual(c64.cpu.PC, 0x4001);
  assertTrue(c64.trace.slice(-3).every(item => item.repeatedRead && item.address === 0x4001));
  c64.externalRDYHigh = true;
  c64.step();
  assertEqual(c64.cpu.PC, 0x4002);
  assertEqual(c64.cpu.A, 0x45);
});

test('RDY niedrig stoppt keine CPU-Schreibzyklen', () => {
  const c64 = machine([0x85, 0x20], 0x4000, { A: 0x55 });
  c64.step();
  c64.step();
  c64.externalRDYHigh = false;
  c64.step();
  assertEqual(c64.memory.readRAM(0x20), 0x55);
  assertEqual(c64.cpu.instructionsExecuted, 1);
});

test('RMW an I/O-Adressen löst sowohl Dummy-Write als auch End-Write aus', () => {
  const c64 = machine([0xee, 0x20, 0xd0]);
  const writes = [];
  c64.bus.attachDevice('vic', {
    readRegister() { return 0x44; },
    writeRegister(offset, value) { writes.push({ offset, value }); }
  });
  assertEqual(untilInstructions(c64, 1), 6);
  assertEqual(writes.length, 0);
  c64.processorPort.writePins(0x37);
  const io = machine([0xee, 0x20, 0xd0]);
  io.processorPort.writePins(0x37);
  const actual = [];
  io.bus.attachDevice('vic', {
    readRegister() { return 0x44; },
    writeRegister(offset, value) { actual.push([offset, value]); }
  });
  assertEqual(untilInstructions(io, 1), 6);
  assertEqual(actual.length, 2);
  assertBytes(actual.map(row => row[1]), [0x44, 0x45]);
});

test('BCD-ADC und SBC unterscheiden NMOS-Binary-Flags vom BCD-Ergebnis', () => {
  const adc = machine([0xf8, 0x18, 0xa9, 0x50, 0x69, 0x50]);
  untilInstructions(adc, 4);
  assertEqual(adc.cpu.A, 0x00);
  assertTrue(!!(adc.cpu.P & 0x01));
  assertEqual(adc.cpu.P & 0x02, 0);
  assertTrue(!!(adc.cpu.P & 0x80));
  assertTrue(!!(adc.cpu.P & 0x40));
  const sbc = machine([0xf8, 0x38, 0xa9, 0x50, 0xe9, 0x01]);
  untilInstructions(sbc, 4);
  assertEqual(sbc.cpu.A, 0x49);
  assertTrue(!!(sbc.cpu.P & 1));
});

test('Undokumentierter SLO kombiniert ASL, Dummy-Write und ORA', () => {
  const c64 = machine([0x07, 0x20], 0x4000, { A: 0x01 });
  c64.memory.writeRAM(0x20, 0x81);
  assertEqual(untilInstructions(c64, 1), 5);
  assertEqual(c64.cpu.A, 0x03);
  assertEqual(c64.memory.readRAM(0x20), 0x02);
  assertBytes(c64.trace.filter(item => item.kind === 'write').map(item => item.value), [0x81, 0x02]);
});

test('JAM blockiert die CPU bis zum Hardware-RESET', () => {
  const c64 = machine([0x02, 0xea]);
  assertEqual(untilInstructions(c64, 1), 2);
  assertTrue(c64.cpu.jammed);
  c64.runCycles(20);
  assertEqual(c64.cpu.PC, 0x4001);
  c64.memory.writeRAM(0xfffc, 0x00);
  c64.memory.writeRAM(0xfffd, 0x50);
  c64.reset();
  c64.processorPort.writePins(0x34);
  c64.runCycles(7);
  assertEqual(c64.cpu.PC, 0x5000);
  assertEqual(c64.cpu.jammed, false);
});

test('Ein normaler STA-Zugriff erreicht echte memory-mapped I/O-Register', () => {
  const c64 = machine([0xa9, 0x09, 0x8d, 0x20, 0xd0]);
  c64.processorPort.writePins(0x37);
  const received = [];
  c64.bus.attachDevice('vic', {
    readRegister() { return 0; },
    writeRegister(offset, value) { received.push([offset, value]); }
  });
  untilInstructions(c64, 2);
  assertEqual(received.length, 1);
  assertBytes(received[0], [0x20, 0x09]);
});

test('Alle 151 offiziellen Opcodes haben ihre Basiszykluszahl ohne Page-Crossing', () => {
  const read = new Set('ADC AND BIT CMP CPX CPY EOR LDA LDX LDY ORA SBC'.split(' '));
  const write = new Set('STA STX STY'.split(' '));
  const rmw = new Set('ASL LSR ROL ROR INC DEC'.split(' '));
  const branch = new Set('BPL BMI BVC BVS BCC BCS BNE BEQ'.split(' '));
  const cyclesRead = { imm: 2, zp: 3, zpx: 4, zpy: 4, abs: 4, absx: 4, absy: 4, izx: 6, izy: 5 };
  const cyclesWrite = { zp: 3, zpx: 4, zpy: 4, abs: 4, absx: 5, absy: 5, izx: 6, izy: 6 };
  const cyclesModify = { zp: 5, zpx: 6, abs: 6, absx: 7 };
  for (const entry of CPU6510_OPCODES.filter(item => item.classification === 'official')) {
    const { mnemonic, mode } = entry;
    const expected = read.has(mnemonic) ? cyclesRead[mode]
      : write.has(mnemonic) ? cyclesWrite[mode]
      : rmw.has(mnemonic) ? mode === 'acc' ? 2 : cyclesModify[mode]
      : branch.has(mnemonic) ? null
      : mnemonic === 'BRK' ? 7
      : mnemonic === 'JSR' || mnemonic === 'RTS' || mnemonic === 'RTI' ? 6
      : mnemonic === 'JMP' ? mode === 'ind' ? 5 : 3
      : mnemonic === 'PHP' || mnemonic === 'PHA' ? 3
      : mnemonic === 'PLP' || mnemonic === 'PLA' ? 4
      : mode === 'imp' ? 2 : undefined;
    if (branch.has(mnemonic)) continue;
    assertTrue(expected !== undefined, `${mnemonic}:${mode}`);
    const c64 = machine([entry.opcode, 0x10, 0x20]);
    c64.memory.writeRAM(0x10, 0x30);
    c64.memory.writeRAM(0x11, 0x20);
    c64.memory.writeRAM(0x2030, 0x45);
    const actual = untilInstructions(c64, 1, 16);
    assertEqual(actual, expected, `Opcode $${entry.opcode.toString(16).padStart(2, '0')} ${mnemonic}:${mode}`);
  }
});

test('RAM-Unterlage und KERNAL-ROM führen echten CPU-Maschinencode über RESET aus', () => {
  const c64 = new C64();
  const kernal = new Uint8Array(8192).fill(0xea);
  kernal.set([0xa9, 0x4a, 0x85, 0x10, 0x4c, 0x04, 0xe0], 0);
  kernal[0x1ffc] = 0x00;
  kernal[0x1ffd] = 0xe0;
  c64.loadROM('kernal', kernal);
  c64.runCycles(12);
  assertEqual(c64.memory.readRAM(0x10), 0x4a);
  assertEqual(c64.cpu.PC, 0xe004);
  assertEqual(c64.cpu.instructionsExecuted, 2);
});

test('Spezifische Statusflag-Vektoren für Shift, BIT, CMP und Transfers', () => {
  const c64 = machine([
    0xa9, 0x81, 0x0a, 0x2a, 0x4a, 0x6a, 0x85, 0x20, 0xa9, 0x40,
    0x24, 0x20, 0xc9, 0x41, 0xaa, 0x8a, 0x48, 0x68
  ]);
  untilInstructions(c64, 2);
  assertEqual(c64.cpu.A, 0x02);
  assertEqual(c64.cpu.P & 1, 1);
  untilInstructions(c64, 2);
  assertEqual(c64.cpu.A, 0x02);
  untilInstructions(c64, 2);
  assertEqual(c64.cpu.A, 0x81);
  assertEqual(c64.memory.readRAM(0x20), 0x81);
  untilInstructions(c64, 2);
  assertEqual(c64.cpu.A, 0x40);
  assertEqual(c64.cpu.P & 0x80, 0x80);
  assertEqual(c64.cpu.P & 0x02, 0x02);
  untilInstructions(c64, 2);
  assertEqual(c64.cpu.P & 0x01, 0);
  assertEqual(c64.cpu.X, 0x40);
  untilInstructions(c64, 3);
  assertEqual(c64.cpu.A, 0x40);
  assertEqual(c64.cpu.SP, 0xfd);
});

test('IRQ nach SEI verwendet das I-Flag vor Abschluss des Befehls', () => {
  const c64 = machine([0x78, 0xea], 0x4000, { P: 0x20 });
  c64.memory.writeRAM(0xfffe, 0x00);
  c64.memory.writeRAM(0xffff, 0x80);
  c64.interrupts.setIRQ('timer', true);
  untilInstructions(c64, 1);
  assertTrue(!!(c64.cpu.P & 4));
  c64.runCycles(7);
  assertEqual(c64.cpu.PC, 0x8000);
});

test('BRK mit nachfolgender NMI-Flanke verwendet NMI-Vektor und BRK-Stackbild', () => {
  const c64 = machine([0x00, 0xea]);
  c64.memory.writeRAM(0xfffa, 0x00);
  c64.memory.writeRAM(0xfffb, 0x90);
  c64.memory.writeRAM(0xfffe, 0x00);
  c64.memory.writeRAM(0xffff, 0x80);
  c64.runCycles(3);
  c64.interrupts.setNMI('restore', true);
  c64.runCycles(4);
  assertEqual(c64.cpu.PC, 0x9000);
  assertEqual(c64.memory.readRAM(0x1fb) & 0x10, 0x10);
});

test('AEC verweigert CPU-Lesezugriff vollständig und erhält CPU-Zustand', () => {
  const c64 = machine([0xa9, 0x67]);
  c64.step();
  const state = c64.cpu.getState();
  const event = c64.step({ baLow: true, stealsPhi2: true });
  assertEqual(event.owner, 'vic');
  assertEqual(event.kind, 'idle');
  assertEqual(c64.cpu.PC, state.PC);
  assertEqual(c64.cpu.A, state.A);
  c64.step();
  assertEqual(c64.cpu.A, 0x67);
});

test('Hardware-RESET-Flanke startet genau eine CPU-Reset-Sequenz', () => {
  const c64 = machine([0xea]);
  c64.memory.writeRAM(0xfffc, 0x00);
  c64.memory.writeRAM(0xfffd, 0x50);
  c64.interrupts.setRESET(true);
  c64.runCycles(7);
  assertEqual(c64.cpu.PC, 0x5000);
  assertEqual(c64.cpu.resetPending, false);
});
