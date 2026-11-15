const DIRECTIONS = Object.freeze({ up: 0, down: 1, left: 2, right: 3 });

export class Joystick {
  constructor() {
    this.states = new Uint8Array(2);
  }

  validatePort(port) {
    if (port !== 1 && port !== 2) throw new RangeError('Joystickport muss 1 oder 2 sein');
    return port - 1;
  }

  setDirection(port, direction, pressed) {
    const index = this.validatePort(port);
    const bit = DIRECTIONS[direction];
    if (bit === undefined) throw new RangeError('Unbekannte Joystickrichtung');
    this.states[index] = pressed ? this.states[index] | (1 << bit) : this.states[index] & ~(1 << bit);
  }

  setFire(port, pressed) {
    const index = this.validatePort(port);
    this.states[index] = pressed ? this.states[index] | 0x10 : this.states[index] & ~0x10;
  }

  getLines(port) {
    return (~this.states[this.validatePort(port)]) & 0xff;
  }

  getState(port) {
    const bits = this.states[this.validatePort(port)];
    return {
      up: Boolean(bits & 1), down: Boolean(bits & 2), left: Boolean(bits & 4),
      right: Boolean(bits & 8), fire: Boolean(bits & 16)
    };
  }

  releaseAll(port = null) {
    if (port === null) this.states.fill(0);
    else this.states[this.validatePort(port)] = 0;
  }
}
