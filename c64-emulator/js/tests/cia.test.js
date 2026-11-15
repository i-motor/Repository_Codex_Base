import { test, assertEqual, assertTrue } from './harness.js';
import { CIA6526 } from '../io/CIA6526.js';
import { InterruptController } from '../core/InterruptController.js';
import { C64 } from '../core/C64.js';

function createCIA(line = 'irq') {
  const controller = new InterruptController();
  const cia = new CIA6526({ name: 'test', interruptLine: line, interruptController: controller });
  return { cia, controller };
}

function clock(cia, cycles) {
  for (let i = 0; i < cycles; i += 1) cia.tick();
}

test('CIA: DDRA/DDRB unterscheiden Ausgabelatch und externe Eingänge', () => {
  const { cia } = createCIA();
  cia.setPortInputs('a', 0x3c);
  cia.writeRegister(0, 0xa5);
  cia.writeRegister(2, 0xf0);
  assertEqual(cia.readRegister(0), 0xac);
  assertEqual(cia.readRegister(2), 0xf0);
  cia.setPortInputs('b', 0xfe);
  assertEqual(cia.readRegister(1), 0xfe);
  cia.writeRegister(1, 0x00);
  cia.writeRegister(3, 0x0f);
  assertEqual(cia.readRegister(1), 0xf0);
});

test('CIA: Timer-Latch, Force Load, Stop und Low/High-Register', () => {
  const { cia } = createCIA();
  cia.writeRegister(4, 0x34);
  cia.writeRegister(5, 0x12);
  assertEqual(cia.readRegister(4), 0x34);
  assertEqual(cia.readRegister(5), 0x12);
  cia.writeRegister(14, 0x11);
  assertEqual(cia.readRegister(14), 0x01);
  cia.tick();
  assertEqual(cia.readRegister(4), 0x33);
  cia.writeRegister(4, 0x77);
  assertEqual(cia.readRegister(4), 0x33);
  cia.writeRegister(14, 0x10);
  assertEqual(cia.readRegister(4), 0x77);
  assertEqual(cia.readRegister(5), 0x12);
});

test('CIA: Timer A unterläuft nach Latch+1 Zähltakten und setzt ICR', () => {
  const { cia, controller } = createCIA();
  cia.writeRegister(4, 2);
  cia.writeRegister(5, 0);
  cia.writeRegister(13, 0x81);
  cia.writeRegister(14, 0x11);
  clock(cia, 2);
  assertEqual(cia.timerA.counter, 0);
  assertEqual(cia.peekRegister(13), 0);
  cia.tick();
  assertEqual(cia.timerA.counter, 2);
  assertEqual(cia.readRegister(13), 0x81);
  assertEqual(controller.isIRQActive(), false);
});

test('CIA: Maskierte Unterläufe werden nachträglich bei ICR-Freigabe aktiv', () => {
  const { cia, controller } = createCIA();
  cia.writeRegister(4, 1);
  cia.writeRegister(5, 0);
  cia.writeRegister(14, 0x11);
  clock(cia, 2);
  assertEqual(cia.peekRegister(13), 0x01);
  assertEqual(controller.isIRQActive(), false);
  cia.writeRegister(13, 0x81);
  assertEqual(cia.peekRegister(13), 0x81);
  assertEqual(controller.isIRQActive(), true);
  cia.writeRegister(13, 0x01);
  assertEqual(controller.isIRQActive(), false);
  assertEqual(cia.readRegister(13), 0x01);
  assertEqual(cia.readRegister(13), 0);
});

test('CIA: Timer A und Timer B stoppen im One-Shot-Modus', () => {
  const { cia } = createCIA();
  cia.writeRegister(4, 1);
  cia.writeRegister(5, 0);
  cia.writeRegister(6, 1);
  cia.writeRegister(7, 0);
  cia.writeRegister(14, 0x19);
  cia.writeRegister(15, 0x19);
  clock(cia, 2);
  assertEqual(cia.cra & 1, 0);
  assertEqual(cia.crb & 1, 0);
  assertEqual(cia.readRegister(13) & 3, 3);
  clock(cia, 20);
  assertEqual(cia.peekRegister(13), 0);
});

test('CIA: Timer B kaskadiert Timer-A-Unterläufe', () => {
  const { cia } = createCIA();
  cia.writeRegister(4, 1);
  cia.writeRegister(5, 0);
  cia.writeRegister(6, 1);
  cia.writeRegister(7, 0);
  cia.writeRegister(14, 0x11);
  cia.writeRegister(15, 0x51);
  clock(cia, 3);
  assertEqual(cia.timerB.counter, 0);
  assertEqual(cia.peekRegister(13), 1);
  cia.tick();
  assertEqual(cia.timerB.counter, 1);
  assertEqual(cia.peekRegister(13), 3);
});

test('CIA: Timer B kaskadiert nur bei CNT hoch, wenn Modus 11 gesetzt', () => {
  const { cia } = createCIA();
  cia.writeRegister(4, 0);
  cia.writeRegister(5, 0);
  cia.writeRegister(6, 1);
  cia.writeRegister(7, 0);
  cia.writeRegister(14, 0x11);
  cia.writeRegister(15, 0x71);
  cia.setCNT(false);
  clock(cia, 5);
  assertEqual(cia.timerB.counter, 1);
  cia.setCNT(true);
  clock(cia, 2);
  assertEqual(cia.peekRegister(13) & 2, 2);
});

test('CIA: CNT-getriebene Timer zählen nur auf steigenden Flanken', () => {
  const { cia } = createCIA();
  cia.writeRegister(4, 1);
  cia.writeRegister(5, 0);
  cia.writeRegister(14, 0x31);
  clock(cia, 5);
  assertEqual(cia.timerA.counter, 1);
  cia.setCNT(false);
  cia.tick();
  cia.setCNT(true);
  cia.tick();
  assertEqual(cia.timerA.counter, 0);
  clock(cia, 5);
  assertEqual(cia.timerA.counter, 0);
  cia.setCNT(false);
  cia.setCNT(true);
  cia.tick();
  assertEqual(cia.peekRegister(13) & 1, 1);
});

test('CIA: PB6/PB7 erzeugen Timer-Toggle und One-Cycle-Pulse', () => {
  const { cia } = createCIA();
  cia.writeRegister(4, 0);
  cia.writeRegister(5, 0);
  cia.writeRegister(6, 1);
  cia.writeRegister(7, 0);
  cia.writeRegister(14, 0x17);
  cia.writeRegister(15, 0x13);
  cia.tick();
  assertEqual(cia.readRegister(1) & 0x40, 0x40);
  cia.tick();
  assertEqual(cia.readRegister(1) & 0x80, 0x80);
  cia.tick();
  assertEqual(cia.readRegister(1) & 0x80, 0);
  assertEqual(cia.readRegister(1) & 0x40, 0x40);
  cia.tick();
  assertEqual(cia.readRegister(1) & 0x40, 0);
});

test('CIA: FLAG löst ausschließlich bei fallender Flanke aus', () => {
  const { cia, controller } = createCIA('nmi');
  cia.writeRegister(13, 0x90);
  cia.setFLAG(false);
  assertEqual(controller.consumeNMI(), true);
  assertEqual(cia.peekRegister(13), 0x90);
  cia.setFLAG(false);
  assertEqual(controller.consumeNMI(), false);
  cia.readRegister(13);
  cia.setFLAG(true);
  cia.setFLAG(false);
  assertEqual(controller.consumeNMI(), true);
});

test('CIA: Serial-Eingang übernimmt acht SP-Bits auf CNT-Flanken', () => {
  const { cia } = createCIA();
  cia.writeRegister(13, 0x88);
  for (const bit of [1, 0, 1, 0, 0, 1, 0, 1]) {
    cia.setSP(Boolean(bit));
    cia.setCNT(false);
    cia.tick();
    cia.setCNT(true);
    cia.tick();
  }
  assertEqual(cia.readRegister(12), 0xa5);
  assertEqual(cia.peekRegister(13), 0x88);
});

test('CIA: Serial-Ausgabe beendet acht Bits nach 16 Timer-A-Unterläufen', () => {
  const { cia } = createCIA();
  cia.writeRegister(4, 0);
  cia.writeRegister(5, 0);
  cia.writeRegister(14, 0x51);
  cia.writeRegister(12, 0xa5);
  clock(cia, 15);
  assertEqual(cia.serialOutputBusy, true);
  cia.tick();
  assertEqual(cia.serialOutputBusy, false);
  assertEqual(cia.peekRegister(13) & 8, 8);
});

test('CIA: TOD mit 50-Hz-Netzimpulsen und Stopp durch Stunden-Write', () => {
  const { cia } = createCIA();
  cia.writeRegister(14, 0x80);
  cia.writeRegister(11, 0x01);
  for (let i = 0; i < 8; i += 1) cia.tick({ todPulse: true });
  assertEqual(cia.peekRegister(8), 0);
  cia.writeRegister(8, 0);
  for (let i = 0; i < 5; i += 1) cia.tick({ todPulse: true });
  assertEqual(cia.readRegister(8), 1);
});

test('CIA: TOD-Alarm setzt eigenes ICR-Bit und Read-Hours latcht die Uhr', () => {
  const { cia } = createCIA();
  cia.writeRegister(14, 0x80);
  cia.writeRegister(15, 0x80);
  cia.writeRegister(11, 1);
  cia.writeRegister(10, 0);
  cia.writeRegister(9, 0);
  cia.writeRegister(8, 1);
  cia.writeRegister(15, 0);
  cia.writeRegister(13, 0x84);
  cia.writeRegister(11, 1);
  cia.writeRegister(8, 0);
  cia.readRegister(11);
  for (let i = 0; i < 5; i += 1) cia.tick({ todPulse: true });
  assertEqual(cia.peekRegister(8), 0);
  assertEqual(cia.readRegister(8), 0);
  assertEqual(cia.readRegister(8), 1);
  assertEqual(cia.readRegister(13), 0x84);
});

test('CIA: TOD rollt BCD-Sekunden und Stunden mit 12h-AM/PM korrekt', () => {
  const { cia } = createCIA();
  cia.writeRegister(14, 0x80);
  cia.writeRegister(11, 0x11);
  cia.writeRegister(10, 0x59);
  cia.writeRegister(9, 0x59);
  cia.writeRegister(8, 9);
  for (let i = 0; i < 5; i += 1) cia.tick({ todPulse: true });
  assertEqual(cia.readRegister(9), 0);
  assertEqual(cia.readRegister(10), 0);
  assertEqual(cia.readRegister(11), 0x92);
});

test('CIA: Registerspiegelung $DC0D/$DC1D setzt denselben ICR-Zustand', () => {
  const c64 = new C64();
  c64.processorPort.writePins(0x35);
  c64.bus.cpuWrite(0xdc1d, 0x81);
  c64.bus.cpuWrite(0xdc04, 0);
  c64.bus.cpuWrite(0xdc05, 0);
  c64.bus.cpuWrite(0xdc0e, 0x11);
  c64.step();
  assertEqual(c64.bus.cpuRead(0xdc1d), 0x81);
  assertEqual(c64.bus.cpuRead(0xdc0d), 0);
});

test('CIA: Timer B kann vollständig über CNT statt PHI2 laufen', () => {
  const { cia } = createCIA();
  cia.writeRegister(6, 1);
  cia.writeRegister(7, 0);
  cia.writeRegister(15, 0x31);
  clock(cia, 3);
  assertEqual(cia.timerB.counter, 1);
  for (let n = 0; n < 2; n += 1) {
    cia.setCNT(false);
    cia.tick();
    cia.setCNT(true);
    cia.tick();
  }
  assertEqual(cia.timerB.counter, 1);
  assertEqual(cia.peekRegister(13) & 2, 2);
});

test('CIA: ICR-Lesevorgang löscht nur die eigene CIA-Interruptquelle', () => {
  const c64 = new C64();
  c64.interrupts.setIRQ('vic', true);
  c64.cia1.writeRegister(13, 0x81);
  c64.cia1.writeRegister(4, 0);
  c64.cia1.writeRegister(5, 0);
  c64.cia1.writeRegister(14, 0x11);
  c64.cia1.tick();
  assertEqual(c64.interrupts.isIRQActive(), true);
  assertEqual(c64.bus.cpuRead(0xdc0d), 0x81);
  assertEqual(c64.cia1.isInterruptActive(), false);
  assertEqual(c64.interrupts.isIRQActive(), true);
  c64.interrupts.setIRQ('vic', false);
  assertEqual(c64.interrupts.isIRQActive(), false);
});

test('CIA: 60-Hz-TOD benötigt sechs Netzimpulse je Zehntelsekunde', () => {
  const { cia } = createCIA();
  cia.writeRegister(11, 0x01);
  cia.writeRegister(8, 0);
  for (let i = 0; i < 5; i += 1) cia.tick({ todPulse: true });
  assertEqual(cia.readRegister(8), 0);
  cia.tick({ todPulse: true });
  assertEqual(cia.readRegister(8), 1);
});

test('CIA: TOD schaltet 12 PM auf 1 PM ohne PM-Wechsel', () => {
  const { cia } = createCIA();
  cia.writeRegister(14, 0x80);
  cia.writeRegister(11, 0x92);
  cia.writeRegister(10, 0x59);
  cia.writeRegister(9, 0x59);
  cia.writeRegister(8, 9);
  for (let i = 0; i < 5; i += 1) cia.tick({ todPulse: true });
  assertEqual(cia.readRegister(11), 0x81);
});

test('CIA: TOD schaltet 11 PM auf 12 AM mit PM-Wechsel', () => {
  const { cia } = createCIA();
  cia.writeRegister(14, 0x80);
  cia.writeRegister(11, 0x91);
  cia.writeRegister(10, 0x59);
  cia.writeRegister(9, 0x59);
  cia.writeRegister(8, 9);
  for (let i = 0; i < 5; i += 1) cia.tick({ todPulse: true });
  assertEqual(cia.readRegister(11), 0x12);
});

test('CIA: Unmaskiertes FLAG-ICR bleibt beim Lesen ohne Interruptbit 7', () => {
  const { cia } = createCIA();
  cia.setFLAG(false);
  assertEqual(cia.readRegister(13), 0x10);
  assertEqual(cia.peekRegister(13), 0);
});

test('CIA: Reset löscht laufende Timer, ICR-Masken und Port-DDR', () => {
  const { cia, controller } = createCIA('nmi');
  cia.writeRegister(13, 0x91);
  cia.writeRegister(2, 0xff);
  cia.writeRegister(14, 0x11);
  cia.tick();
  cia.setFLAG(false);
  assertEqual(controller.isNMIActive(), true);
  cia.reset();
  assertEqual(cia.icrMask, 0);
  assertEqual(cia.icrPending, 0);
  assertEqual(cia.ddra, 0);
  assertEqual(cia.cra, 0);
  assertEqual(controller.isNMIActive(), false);
});
