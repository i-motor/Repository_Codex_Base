import { test, assertEqual, assertBytes } from './harness.js';
import { C64 } from '../core/C64.js';

function frame(standard = 'PAL') {
  const machine = new C64({ videoStandard: standard });
  machine.loadVICDemo();
  machine.runCycles(machine.clock.cyclesPerFrame * 2);
  return machine.vic.getFrame().data.slice();
}

test('NTSC-Referenz: PAL-VIC-Bild bleibt bei optionalen M9-Geräten bytegleich', () => {
  const baseline = new C64();
  baseline.loadVICDemo();
  const modified = new C64();
  modified.loadVICDemo();
  modified.setSIDModel('8580');
  modified.mountD64(new Uint8Array(174848));
  const cycles = baseline.clock.cyclesPerFrame * 2;
  baseline.runCycles(cycles);
  modified.runCycles(cycles);
  assertBytes(modified.vic.getFrame().data, baseline.vic.getFrame().data);
  assertEqual(modified.cpu.PC, baseline.cpu.PC);
  assertEqual(modified.clock.cycle, baseline.clock.cycle);
});

test('NTSC-Referenz: vollständiger Frame erzeugt Daten im 404×240-Bereich', () => {
  const picture = frame('NTSC');
  assertEqual(picture.length, 404 * 240);
  assertEqual(picture.some(value => value !== picture[0]), true);
});
