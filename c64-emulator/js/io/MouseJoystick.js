export class MouseJoystick {
  constructor(onDirection, onFire, port = 2, deadZone = 0.2) {
    this.onDirection = onDirection;
    this.onFire = onFire;
    this.deadZone = deadZone;
    this.port = 2;
    this.active = { up: false, down: false, left: false, right: false };
    this.firing = false;
    this.element = null;
    this.setPort(port);
  }

  setPort(port) {
    if (port !== 1 && port !== 2) throw new RangeError('Ungültiger Joystickport');
    this.reset();
    this.port = port;
  }

  setAxis(x, y) {
    const states = { up: y < -this.deadZone, down: y > this.deadZone, left: x < -this.deadZone, right: x > this.deadZone };
    for (const direction of Object.keys(states)) {
      if (states[direction] !== this.active[direction]) {
        this.onDirection(this.port, direction, states[direction]);
        this.active[direction] = states[direction];
      }
    }
  }

  setFire(pressed) {
    const next = Boolean(pressed);
    if (next !== this.firing) {
      this.onFire(this.port, next);
      this.firing = next;
    }
  }

  reset() {
    if (this.port) {
      for (const direction of Object.keys(this.active)) {
        if (this.active[direction]) this.onDirection(this.port, direction, false);
        this.active[direction] = false;
      }
      if (this.firing) this.onFire(this.port, false);
    }
    this.firing = false;
  }

  attach(element) {
    this.element = element;
    element.addEventListener('pointermove', event => {
      const rect = element.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      this.setAxis(x, y);
    });
    element.addEventListener('pointerleave', () => {
      this.setAxis(0, 0);
      this.setFire(false);
    });
    element.addEventListener('pointerdown', event => {
      if (event.button === 0) {
        this.setFire(true);
        element.focus();
        element.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }
    });
    element.addEventListener('pointerup', event => {
      if (event.button === 0) this.setFire(false);
    });
    element.addEventListener('pointercancel', () => this.reset());
    window.addEventListener('blur', () => this.reset());
  }
}
