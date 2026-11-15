import { test, assertEqual, assertTrue } from './harness.js';
import { Keyboard } from '../io/Keyboard.js';
import { Joystick } from '../io/Joystick.js';
import { InputQueue } from '../io/InputQueue.js';
import { IECBus } from '../io/IECBus.js';
import { C64 } from '../core/C64.js';

test('Tastatur: Taste A schließt PA1/PB2 und wird nur über CIA gelesen', () => {
  const c64 = new C64();
  c64.keyboard.setKey('A', true);
  c64.bus.cpuWrite(0xdc03, 0xff);
  c64.bus.cpuWrite(0xdc01, 0xfb);
  assertEqual(c64.bus.cpuRead(0xdc00) & 2, 0);
  c64.bus.cpuWrite(0xdc01, 0xff);
  assertEqual(c64.bus.cpuRead(0xdc00) & 2, 2);
  c64.bus.cpuWrite(0xdc02, 0xff);
  c64.bus.cpuWrite(0xdc03, 0);
  c64.bus.cpuWrite(0xdc00, 0xfd);
  assertEqual(c64.bus.cpuRead(0xdc01) & 4, 0);
  c64.bus.cpuWrite(0xdc00, 0xfb);
  assertEqual(c64.bus.cpuRead(0xdc01) & 4, 4);
  c64.bus.cpuWrite(0xdc00, 0xfd);
  c64.keyboard.setKey('A', false);
  assertEqual(c64.bus.cpuRead(0xdc01) & 4, 4);
});

const deKey = (kb, code, key, extra = {}) => kb.handleCode(code, true, { key, ...extra });
const contact = (kb, row, column) => Boolean(kb.getRows()[row] & (1 << column));

test('Tastatur DE: Shift+7 erzeugt den ungeshifteten Schrägstrich', () => {
  const kb = new Keyboard('de');
  kb.handleCode('ShiftLeft', true, { key: 'Shift' });
  deKey(kb, 'Digit7', '/');
  assertTrue(contact(kb, 6, 7));
  assertEqual(contact(kb, 1, 7), false);
  assertEqual(contact(kb, 3, 0), false);
  kb.handleCode('Digit7', false);
  assertTrue(contact(kb, 1, 7));
});

test('Tastatur DE: Zeichen folgen der Beschriftung statt der Tastenposition', () => {
  const cases = [
    ['Digit0', '=', 6, 5, false], ['BracketRight', '+', 5, 0, false], ['BracketRight', '*', 6, 1, false],
    ['Slash', '-', 5, 3, false], ['Period', ':', 5, 5, false], ['Comma', ';', 6, 2, false],
    ['Digit2', '"', 7, 3, true], ['Digit8', '(', 3, 3, true], ['Digit9', ')', 4, 0, true],
    ['Backslash', '#', 1, 0, true], ['Minus', '?', 6, 7, true], ['IntlBackslash', '<', 5, 7, true],
    ['IntlBackslash', '>', 5, 4, true], ['KeyZ', 'y', 3, 1, false], ['KeyY', 'z', 1, 4, false]
  ];
  for (const [code, key, row, column, shift] of cases) {
    const kb = new Keyboard('de');
    if ('=*:;"()?>'.includes(key)) kb.handleCode('ShiftLeft', true, { key: 'Shift' });
    deKey(kb, code, key);
    assertTrue(contact(kb, row, column), `Taste ${key}`);
    assertEqual(contact(kb, 1, 7), shift, `SHIFT bei ${key}`);
  }
});

test('Tastatur DE: AltGr+Q ergibt @ ohne CTRL- oder Commodore-Kontakt', () => {
  const kb = new Keyboard('de');
  kb.handleCode('ControlLeft', true, { key: 'Control', ctrl: true });
  kb.handleCode('AltRight', true, { key: 'AltGraph', ctrl: true, alt: true, altGraph: true });
  deKey(kb, 'KeyQ', '@', { ctrl: true, alt: true, altGraph: true });
  assertTrue(contact(kb, 5, 6));
  assertEqual(contact(kb, 7, 2), false);
  assertEqual(contact(kb, 7, 5), false);
  assertEqual(contact(kb, 7, 6), false);
});

test('Tastatur DE: CTRL-Kombinationen bleiben positionsbezogen', () => {
  const kb = new Keyboard('de');
  kb.handleCode('ControlLeft', true, { key: 'Control', ctrl: true });
  deKey(kb, 'Digit2', '2', { ctrl: true });
  assertTrue(contact(kb, 7, 2));
  assertTrue(contact(kb, 7, 3));
});

test('Tastatur: Mehrfachtasten und matrixbedingte Geisterkontakte', () => {
  const kb = new Keyboard();
  kb.setKey('A', true);
  kb.setKey('W', true);
  kb.setKey('R', true);
  const pins = kb.resolveMatrix(0xfb, 0xff, 0xff, 0);
  assertEqual(pins.b & (1 << 1), 0);
  assertEqual(pins.b & (1 << 2), 0);
  kb.releaseAll();
  assertEqual(kb.resolveMatrix(0xfb, 0xff, 0xff, 0).b, 0xff);
  kb.setKey('A', true);
  assertEqual(kb.resolveMatrix(0xfd, 0xff, 0xff, 0).b, 0xfb);
  assertEqual(kb.resolveMatrix(0xfb, 0xff, 0xff, 0).b, 0xff);
});

test('Tastatur: Cursor-Links und F2 verwenden reale SHIFT-Matrixkontakte', () => {
  const kb = new Keyboard();
  kb.handleCode('ArrowLeft', true);
  kb.handleCode('F2', true);
  const rows = kb.getRows();
  assertTrue(Boolean(rows[1] & 0x80));
  assertTrue(Boolean(rows[0] & 0x04));
  assertTrue(Boolean(rows[0] & 0x10));
  kb.handleCode('ArrowLeft', false);
  assertTrue(Boolean(kb.getRows()[1] & 0x80));
  kb.handleCode('F2', false);
  assertEqual(kb.getRows()[1], 0);
});

test('Tastatur: Deutsches Host-Layout vertauscht Codepositionen Y/Z', () => {
  const kb = new Keyboard('de');
  kb.handleCode('KeyY', true);
  assertTrue(Boolean(kb.getRows()[1] & 0x10));
  kb.handleCode('KeyY', false);
  kb.handleCode('KeyZ', true);
  assertTrue(Boolean(kb.getRows()[3] & 0x02));
  assertEqual(kb.isMappedCode('NoSuchCode'), false);
});

test('Joystick: Beide Ports sind unabhängig und aktiv-low', () => {
  const joy = new Joystick();
  joy.setDirection(1, 'up', true);
  joy.setDirection(1, 'left', true);
  joy.setFire(1, true);
  joy.setDirection(2, 'down', true);
  assertEqual(joy.getLines(1) & 0x1f, 0x0a);
  assertEqual(joy.getLines(2) & 0x1f, 0x1d);
  joy.releaseAll(1);
  assertEqual(joy.getLines(1), 0xff);
  assertEqual(joy.getLines(2) & 2, 0);
});

test('Joystickport 2 liegt auf CIA 1 Port A, Port 1 auf Port B', () => {
  const c64 = new C64();
  c64.joystick.setFire(2, true);
  c64.joystick.setDirection(1, 'right', true);
  assertEqual(c64.bus.cpuRead(0xdc00) & 0x10, 0);
  assertEqual(c64.bus.cpuRead(0xdc01) & 8, 0);
  assertEqual(c64.bus.cpuRead(0xdc00) & 8, 8);
  assertEqual(c64.bus.cpuRead(0xdc01) & 0x10, 0x10);
});

test('InputQueue übernimmt gleichzeitige Ereignisse deterministisch nach Takt', () => {
  const queue = new InputQueue();
  const results = [];
  queue.enqueue({ type: 'a' }, 10);
  queue.enqueue({ type: 'b' }, 5);
  queue.enqueue({ type: 'c' }, 10);
  assertEqual(queue.applyUntil(9, e => results.push(e.type)), 1);
  assertEqual(queue.applyUntil(10, e => results.push(e.type)), 2);
  assertEqual(results.join(','), 'b,a,c');
});

test('C64-InputQueue steuert Tastatur und Joystick erst im fälligen CPU-Takt', () => {
  const c64 = new C64();
  c64.queueInput({ type: 'key', code: 'KeyA', pressed: true }, 3);
  c64.queueInput({ type: 'fire', port: 2, pressed: true }, 3);
  c64.runCycles(3);
  assertEqual(c64.bus.cpuRead(0xdc00) & 0x10, 0x10);
  c64.step();
  assertEqual(c64.bus.cpuRead(0xdc00) & 0x10, 0);
  assertTrue(Boolean(c64.keyboard.getRows()[1] & 4));
});

test('CIA 2 steuert VIC-Bank über tatsächliche Port-Ausgänge', () => {
  const c64 = new C64();
  assertEqual(c64.getVICBankBase(), 0);
  c64.bus.cpuWrite(0xdd02, 3);
  c64.bus.cpuWrite(0xdd00, 0xfe);
  assertEqual(c64.getVICBankBase(), 0x4000);
  c64.bus.cpuWrite(0xdd00, 0xfc);
  assertEqual(c64.getVICBankBase(), 0xc000);
  c64.bus.cpuWrite(0xdd02, 0);
  assertEqual(c64.getVICBankBase(), 0);
});

test('IEC Open Collector: C64 und Laufwerk halten Leitungen unabhängig', () => {
  const bus = new IECBus();
  assertEqual(bus.sample('DATA'), true);
  bus.drive('c64', 'DATA', true);
  bus.drive('drive8', 'DATA', true);
  bus.drive('c64', 'DATA', false);
  assertEqual(bus.sample('DATA'), false);
  bus.drive('drive8', 'DATA', false);
  assertEqual(bus.sample('DATA'), true);
});

test('CIA 2 Port A steuert IEC-Ausgänge und liest externe CLOCK/DATA-Pegel', () => {
  const c64 = new C64();
  c64.bus.cpuWrite(0xdd02, 0x1c);
  c64.bus.cpuWrite(0xdd00, 0xf7);
  assertEqual(c64.iec.sample('ATN'), true);
  assertEqual(c64.iec.sample('CLOCK'), false);
  assertEqual(c64.iec.sample('DATA'), true);
  c64.iec.drive('drive8', 'DATA', true);
  assertEqual(c64.bus.cpuRead(0xdd00) & 0x80, 0);
  c64.iec.drive('drive8', 'DATA', false);
  assertEqual(c64.bus.cpuRead(0xdd00) & 0xc0, 0x80);
});

test('RESTORE erzeugt nur mit freigegebenem CIA-2-FLAG-Interrupt eine NMI-Flanke', () => {
  const c64 = new C64();
  c64.queueInput({ type: 'key', code: 'PageUp', pressed: true });
  c64.step();
  assertEqual(c64.interrupts.sample().nmiPending, false);
  assertEqual(c64.cia2.peekRegister(13), 0x10);
  c64.bus.cpuWrite(0xdd0d, 0x90);
  assertEqual(c64.interrupts.consumeNMI(), true);
  c64.step();
  assertEqual(c64.interrupts.consumeNMI(), false);
  c64.bus.cpuRead(0xdd0d);
  c64.queueInput({ type: 'key', code: 'PageUp', pressed: false });
  c64.step();
  c64.queueInput({ type: 'key', code: 'PageUp', pressed: true });
  c64.step();
  assertEqual(c64.interrupts.consumeNMI(), true);
});

test('CIA-Interrupts werden über die CPU-Vektoren real ausgeführt', () => {
  const c64 = new C64();
  c64.loadCIATimerDemo();
  c64.runCycles(2000);
  assertTrue(c64.memory.readRAM(0xc200) > 0);
  assertTrue(c64.cpu.interruptsServiced > 0);
  assertEqual(c64.cia1.icrMask & 1, 1);
  assertEqual(c64.memory.readRAM(0xfffe), 0x2c);
  assertEqual(c64.memory.readRAM(0xffff), 0xc0);
  assertTrue(c64.trace.length === 0);
});

test('CIA-Timer laufen auch bei durch RDY angehaltener CPU weiter', () => {
  const c64 = new C64();
  c64.cia1.writeRegister(4, 2);
  c64.cia1.writeRegister(5, 0);
  c64.cia1.writeRegister(13, 0x81);
  c64.cia1.writeRegister(14, 0x11);
  c64.externalRDYHigh = false;
  c64.runCycles(3);
  assertEqual(c64.cia1.peekRegister(13), 0x81);
  assertEqual(c64.cpu.getState().PC, 0);
});

test('6510 liest Joystickkontakt tatsächlich über LDA $DC00 und speichert ihn im RAM', () => {
  const c64 = new C64();
  c64.loadDiagnosticProgram(new Uint8Array([0xad, 0x00, 0xdc, 0x8d, 0x00, 0xc3, 0xea]));
  c64.joystick.setFire(2, true);
  c64.runCycles(8);
  assertEqual(c64.memory.readRAM(0xc300) & 0x10, 0);
  assertEqual(c64.cpu.A & 0x10, 0);
});

test('6510 erreicht einen echten CIA-2-FLAG-NMI-Vektor und quittiert den ICR', () => {
  const c64 = new C64();
  c64.processorPort.writePins(0x35);
  c64.memory.ram.set([0x4c, 0x00, 0x40], 0x4000);
  c64.memory.ram.set([0xee, 0x00, 0x60, 0xad, 0x0d, 0xdd, 0x40], 0x5000);
  c64.memory.writeRAM(0xfffa, 0x00);
  c64.memory.writeRAM(0xfffb, 0x50);
  c64.cpu.setTestState({ PC: 0x4000, SP: 0xfd, P: 0x24 });
  c64.cia2.writeRegister(13, 0x90);
  c64.queueInput({ type: 'key', code: 'F9', pressed: true });
  c64.runCycles(50);
  assertEqual(c64.memory.readRAM(0x6000), 1);
  assertTrue(c64.cpu.interruptsServiced >= 1);
  assertEqual(c64.cia2.icrPending & 0x10, 0);
  c64.queueInput({ type: 'key', code: 'F9', pressed: false });
  c64.runCycles(5);
  c64.queueInput({ type: 'key', code: 'F9', pressed: true });
  c64.runCycles(50);
  assertEqual(c64.memory.readRAM(0x6000), 2);
});
