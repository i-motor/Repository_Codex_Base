import { JOYSTICK_BITS } from './Joystick.js';

export class GamepadJoystick {
  constructor(joysticks, { deadZone = 0.4 } = {}) {
    this.joysticks = joysticks;
    this.deadZone = deadZone;
    this.enabled = true;
    this.connected = false;
  }

  poll() {
    if (!this.enabled || typeof navigator === 'undefined' || !navigator.getGamepads) {
      return;
    }
    const pads = navigator.getGamepads();
    let pad = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }
    this.connected = pad !== null;
    if (!pad) {
      this.joysticks.setSourceState('gamepad', 0);
      return;
    }
    const pressed = (index) => pad.buttons[index] && pad.buttons[index].pressed;
    const x = pad.axes[0] || 0;
    const y = pad.axes[1] || 0;
    let mask = 0;
    if (x < -this.deadZone || pressed(14)) mask |= JOYSTICK_BITS.left;
    if (x > this.deadZone || pressed(15)) mask |= JOYSTICK_BITS.right;
    if (y < -this.deadZone || pressed(12)) mask |= JOYSTICK_BITS.up;
    if (y > this.deadZone || pressed(13)) mask |= JOYSTICK_BITS.down;
    if (pressed(0) || pressed(1) || pressed(2) || pressed(3)) mask |= JOYSTICK_BITS.fire;
    this.joysticks.setSourceState('gamepad', mask);
  }
}
