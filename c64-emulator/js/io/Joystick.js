const BITS = Object.freeze({ up: 1, down: 2, left: 4, right: 8, fire: 16 });

export class JoystickPort {
  constructor(number) {
    this.number = number;
    this.state = 0;
    this.sources = new Map();
  }

  setSource(source, mask) {
    if (mask) {
      this.sources.set(source, mask);
    } else {
      this.sources.delete(source);
    }
    let state = 0;
    for (const value of this.sources.values()) {
      state |= value;
    }
    const changed = state !== this.state;
    this.state = state;
    return changed;
  }

  bits() {
    return ~this.state & 0xff;
  }

  pressed(direction) {
    return (this.state & BITS[direction]) !== 0;
  }
}

export class Joysticks {
  constructor() {
    this.ports = [new JoystickPort(1), new JoystickPort(2)];
    this.activePort = 2;
    this.sourceMasks = new Map();
    this.onChange = null;
  }

  setActivePort(number) {
    const previous = this.activePort;
    if (number !== 1 && number !== 2) {
      throw new Error('Joystickport muss 1 oder 2 sein');
    }
    if (previous === number) {
      return;
    }
    for (const [source, mask] of this.sourceMasks) {
      this.ports[previous - 1].setSource(source, 0);
      this.ports[number - 1].setSource(source, mask);
    }
    this.activePort = number;
    this.notify();
  }

  setSourceState(source, mask) {
    if (mask) {
      this.sourceMasks.set(source, mask);
    } else {
      this.sourceMasks.delete(source);
    }
    if (this.ports[this.activePort - 1].setSource(source, mask)) {
      this.notify();
    }
  }

  setActive(direction, pressed, source = 'keys') {
    const bit = BITS[direction];
    if (!bit) {
      return;
    }
    const current = this.sourceMasks.get(source) || 0;
    this.setSourceState(source, pressed ? current | bit : current & ~bit);
  }

  setPortState(number, mask, source = 'direct') {
    if (this.ports[number - 1].setSource(source, mask)) {
      this.notify();
    }
  }

  releaseAll() {
    for (const port of this.ports) {
      port.sources.clear();
      port.state = 0;
    }
    this.sourceMasks.clear();
    this.notify();
  }

  notify() {
    if (this.onChange) {
      this.onChange();
    }
  }
}

export const JOYSTICK_BITS = BITS;
