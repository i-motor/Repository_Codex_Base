import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIA6526, ICR } from '../io/CIA6526.js';

function makeCia(model = '6526') {
  const events = [];
  const cia = new CIA6526({ model, onInterrupt: (level) => events.push(level) });
  return { cia, events };
}

function setTimerA(cia, value) {
  cia.write(0x4, value & 0xff);
  cia.write(0x5, value >> 8);
}

test('Timer A: erste Dekrementierung im dritten Takt nach dem Startbefehl', () => {
  const { cia } = makeCia();
  setTimerA(cia, 100);
  cia.write(0xe, 0x01);
  const values = [];
  for (let i = 0; i < 5; i++) {
    cia.cycle();
    values.push(cia.read(0x4));
  }
  assert.deepEqual(values, [100, 100, 99, 98, 97]);
});

test('Timer A kontinuierlich: Periode N+1, ICR-Bit bei jedem Unterlauf', () => {
  const { cia } = makeCia();
  setTimerA(cia, 5);
  cia.write(0xe, 0x01);
  const underflows = [];
  for (let i = 0; i < 30; i++) {
    cia.cycle();
    if (cia.icr & ICR.TA) {
      underflows.push(i);
      cia.read(0xd);
    }
  }
  assert.deepEqual(underflows, [6, 12, 18, 24]);
});

test('Timer A One-Shot stoppt nach dem Unterlauf und lädt den Latch', () => {
  const { cia } = makeCia();
  setTimerA(cia, 3);
  cia.write(0xe, 0x09);
  for (let i = 0; i < 20; i++) cia.cycle();
  assert.equal(cia.cra & 1, 0);
  assert.equal(cia.ta, 3);
  assert.equal(cia.icr & ICR.TA, ICR.TA);
});

test('IRQ-Leitung: 6526 einen Takt nach dem ICR-Bit, 6526A im selben Takt', () => {
  for (const [model, delay] of [['6526', 1], ['6526A', 0]]) {
    const { cia } = makeCia(model);
    cia.write(0xd, 0x81);
    setTimerA(cia, 2);
    cia.write(0xe, 0x01);
    let flagAt = -1;
    let irqAt = -1;
    for (let i = 0; i < 20 && irqAt < 0; i++) {
      cia.cycle();
      if (flagAt < 0 && (cia.icr & ICR.TA)) flagAt = i;
      if (irqAt < 0 && cia.irqActive) irqAt = i;
    }
    assert.equal(irqAt - flagAt, delay, model);
  }
});

test('ICR lesen löscht Flags und gibt die Leitung frei; Maske setzen löst anstehenden IRQ aus', () => {
  const { cia, events } = makeCia('6526A');
  setTimerA(cia, 1);
  cia.write(0xe, 0x09);
  for (let i = 0; i < 6; i++) cia.cycle();
  assert.equal(cia.irqActive, false);
  cia.write(0xd, 0x81);
  assert.equal(cia.irqActive, true);
  assert.equal(cia.read(0xd), 0x81);
  assert.equal(cia.irqActive, false);
  assert.equal(cia.read(0xd), 0x00);
  cia.write(0xd, 0x01);
  assert.equal(cia.mask, 0);
  assert.deepEqual(events, [true, false]);
});

test('Force-Load lädt den Latch ohne Start', () => {
  const { cia } = makeCia();
  setTimerA(cia, 0x1234);
  cia.write(0xe, 0x01);
  for (let i = 0; i < 10; i++) cia.cycle();
  cia.write(0xe, 0x00);
  cia.cycle();
  cia.cycle();
  const stopped = cia.ta;
  cia.write(0x4, 0x00);
  cia.write(0x5, 0x20);
  assert.equal(cia.ta, 0x2000);
  cia.write(0xe, 0x10);
  cia.cycle();
  cia.cycle();
  assert.equal(cia.ta, 0x2000);
  assert.ok(stopped < 0x1234);
});

test('Timer B kaskadiert über Timer-A-Unterläufe', () => {
  const { cia } = makeCia();
  setTimerA(cia, 1);
  cia.write(0x6, 10);
  cia.write(0x7, 0);
  cia.write(0xf, 0x41);
  cia.write(0xe, 0x01);
  for (let i = 0; i < 40; i++) cia.cycle();
  const remaining = cia.tb;
  assert.ok(remaining < 10 && remaining > 0, `tb=${remaining}`);
  for (let i = 0; i < 40; i++) cia.cycle();
  assert.equal(cia.icr & ICR.TB, ICR.TB);
});

test('Timer B zählt CNT-Flanken', () => {
  const { cia } = makeCia();
  cia.write(0x6, 3);
  cia.write(0x7, 0);
  cia.write(0xf, 0x21);
  for (let i = 0; i < 3; i++) cia.cycle();
  for (let n = 0; n < 2; n++) {
    cia.setCnt(false);
    cia.setCnt(true);
    cia.cycle();
  }
  assert.equal(cia.tb, 1);
});

test('PB6 Toggle-Ausgang bei Timer-A-Unterlauf', () => {
  const { cia } = makeCia();
  setTimerA(cia, 2);
  cia.write(0xe, 0x07);
  const levels = [];
  for (let i = 0; i < 12; i++) {
    cia.cycle();
    levels.push((cia.read(0x1) >> 6) & 1);
  }
  assert.ok(levels.includes(0) && levels.includes(1));
  assert.equal(levels[0], 1);
});

test('TOD: 50-Hz-Teiler, BCD-Zählung, Latch und Halt', () => {
  const { cia } = makeCia();
  cia.write(0xe, 0x80);
  cia.cycle();
  cia.write(0xb, 0x11);
  cia.write(0xa, 0x59);
  cia.write(0x9, 0x59);
  cia.write(0x8, 0x09);
  for (let i = 0; i < 5; i++) cia.todTick();
  assert.equal(cia.read(0xb), 0x92);
  assert.equal(cia.read(0xa), 0x00);
  assert.equal(cia.read(0x9), 0x00);
  assert.equal(cia.read(0x8), 0x00);
  cia.read(0xb);
  for (let i = 0; i < 50; i++) cia.todTick();
  assert.equal(cia.read(0x9), 0x00);
  assert.equal(cia.read(0x8), 0x00);
  assert.equal(cia.read(0x9), 0x01);
  cia.write(0xb, 0x01);
  for (let i = 0; i < 50; i++) cia.todTick();
  assert.equal(cia.read(0x9), 0x01);
  cia.write(0x8, 0x00);
  for (let i = 0; i < 5; i++) cia.todTick();
  assert.equal(cia.read(0x8), 0x01);
});

test('TOD-Alarm setzt ICR-Bit 2', () => {
  const { cia } = makeCia();
  cia.write(0xe, 0x80);
  cia.cycle();
  cia.write(0xf, 0x80);
  cia.cycle();
  cia.write(0xb, 0x01);
  cia.write(0xa, 0x00);
  cia.write(0x9, 0x00);
  cia.write(0x8, 0x03);
  cia.write(0xf, 0x00);
  cia.cycle();
  cia.write(0xb, 0x01);
  cia.write(0xa, 0x00);
  cia.write(0x9, 0x00);
  cia.write(0x8, 0x00);
  cia.read(0xd);
  for (let i = 0; i < 15; i++) cia.todTick();
  assert.equal(cia.icr & ICR.ALARM, ICR.ALARM);
});

test('Serieller Port: 8 Bit Ausgabe mit Timer A, danach ICR-Bit 3', () => {
  const { cia } = makeCia();
  const bits = [];
  cia.onSerialOut = (bit) => bits.push(bit);
  setTimerA(cia, 1);
  cia.write(0xe, 0x41);
  cia.write(0xc, 0xa5);
  for (let i = 0; i < 80; i++) cia.cycle();
  assert.deepEqual(bits, [1, 0, 1, 0, 0, 1, 0, 1]);
  assert.equal(cia.icr & ICR.SP, ICR.SP);
});

test('FLAG: negative Flanke setzt ICR-Bit 4', () => {
  const { cia } = makeCia();
  cia.setFlag(false);
  assert.equal(cia.icr & ICR.FLAG, ICR.FLAG);
  cia.read(0xd);
  cia.setFlag(false);
  assert.equal(cia.icr & ICR.FLAG, 0);
});

test('Ports: Datenrichtung, Pull-ups und externe Beschaltung', () => {
  const { cia } = makeCia();
  const outputs = [];
  cia.portAOut = (v) => outputs.push(v);
  cia.portBIn = (driven) => driven & 0xf0;
  assert.equal(cia.read(0x0), 0xff);
  cia.write(0x2, 0x0f);
  cia.write(0x0, 0x05);
  assert.equal(cia.read(0x0), 0xf5);
  assert.equal(cia.read(0x1), 0xf0);
  assert.deepEqual(outputs, [0xf0, 0xf5]);
});
