import { test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { BusSignals } from '../core/BusSignals.js';
import { BusArbiter } from '../core/BusArbiter.js';
import { InterruptController } from '../core/InterruptController.js';

test('Open-Collector-Signale bleiben niedrig, solange eine Quelle zieht', () => {
  const signals = new BusSignals();
  signals.drive('IRQ', 'vic', false);
  signals.drive('IRQ', 'cia1', false);
  signals.release('IRQ', 'vic');
  assertEqual(signals.sample('IRQ'), false);
  signals.release('IRQ', 'cia1');
  assertEqual(signals.sample('IRQ'), true);
});

test('Getrennte IRQ-Quellen quittieren sich nicht gegenseitig', () => {
  const controller = new InterruptController();
  controller.setIRQ('vic', true);
  controller.setIRQ('cia1', true);
  controller.setIRQ('vic', false);
  assertTrue(controller.isIRQActive());
  controller.setIRQ('cia1', false);
  assertEqual(controller.isIRQActive(), false);
});

test('Gemeinsamer NMI-Pegel triggert ausschließlich bei neuer Aktivflanke', () => {
  const controller = new InterruptController();
  controller.setNMI('restore', true);
  assertEqual(controller.consumeNMI(), true);
  controller.setNMI('cia2', true);
  assertEqual(controller.consumeNMI(), false);
  controller.setNMI('restore', false);
  controller.setNMI('cia2', false);
  controller.setNMI('cia2', true);
  assertEqual(controller.consumeNMI(), true);
});

test('RDY hält CPU-Lesezyklen an, nicht CPU-Schreibzyklen', () => {
  const arbiter = new BusArbiter();
  const read = arbiter.resolve({ baLow: true, stealsPhi2: false }, { kind: 'read' });
  assertEqual(read.advanceCPU, false);
  assertEqual(read.repeatedRead, true);
  const write = arbiter.resolve({ baLow: true, stealsPhi2: false }, { kind: 'write' });
  assertEqual(write.advanceCPU, true);
  assertEqual(write.owner, 'cpu');
});

test('VIC-Busübernahme meldet Schreibkonflikte explizit', () => {
  const arbiter = new BusArbiter();
  const granted = arbiter.resolve({ baLow: true, stealsPhi2: true }, { kind: 'read' });
  assertEqual(granted.owner, 'vic');
  assertEqual(granted.cpuBusActive, false);
  assertThrows(() => arbiter.resolve({ baLow: true, stealsPhi2: true }, { kind: 'write' }));
});
