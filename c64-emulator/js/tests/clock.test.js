import { test, assertEqual, assertThrows } from './harness.js';
import { Clock } from '../core/Clock.js';
import { PAL_PROFILE } from '../utils/Constants.js';

test('PAL-Raster besitzt 19656 Master-Zyklen je Frame', () => {
  const clock = new Clock();
  assertEqual(clock.cyclesPerFrame, 19656);
  clock.runCycles(63);
  assertEqual(clock.getPosition().raster, 1);
  assertEqual(clock.getPosition().cycleInLine, 0);
  clock.runCycles(19593);
  assertEqual(clock.getPosition().frame, 1);
  assertEqual(clock.getPosition().raster, 0);
});

test('Master-Zyklus wird deterministisch fortgeschaltet', () => {
  const clock = new Clock();
  clock.tick();
  assertEqual(clock.getPosition().cycle, 1);
  assertEqual(clock.getSeconds(), 1 / PAL_PROFILE.cpuHz);
  assertThrows(() => clock.runCycles(-1), RangeError);
});
