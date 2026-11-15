import { test, assertEqual, assertTrue } from './harness.js';
import { Gamepad } from '../io/Gamepad.js';

function pad(x, y, fire = false) {
  return { connected: true, axes: [x, y], buttons: [{ pressed: fire }] };
}

test('Gamepad-Referenz: analoge Deadzone unterdrückt leichte Auslenkung', () => {
  const input = [];
  const device = new Gamepad(event => input.push(event), { deadzone: 0.35 });
  device.setEnabled(true);
  device.poll([pad(0.2, -0.2)]);
  assertEqual(input.length, 0);
  device.poll([pad(0.5, 0)]);
  assertTrue(input.some(event => event.direction === 'right' && event.pressed));
});

test('Gamepad-Referenz: Portwechsel setzt gehaltene Kontakte zurück', () => {
  const input = [];
  const device = new Gamepad(event => input.push(event));
  device.setEnabled(true);
  device.poll([pad(0, -1, true)]);
  device.setPort(1);
  assertTrue(input.some(event => event.port === 2 && event.type === 'fire' && !event.pressed));
  device.poll([pad(0, -1, true)]);
  assertTrue(input.some(event => event.port === 1 && event.type === 'fire' && event.pressed));
});
