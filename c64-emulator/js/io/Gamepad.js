const DIRECTIONS = ['up', 'down', 'left', 'right'];

export class Gamepad {
  constructor(emit, { port = 2, deadzone = 0.35, provider = null } = {}) {
    if (typeof emit !== 'function') throw new TypeError('Gamepad benötigt Ereignisempfänger');
    this.emit = emit;
    this.provider = provider ?? (() => globalThis.navigator?.getGamepads?.() ?? []);
    this.deadzone = deadzone;
    this.activePort = port;
    this.enabled = false;
    this.states = new Map();
    this.setPort(port);
  }

  setPort(port) {
    if (port !== 1 && port !== 2) throw new RangeError('Ungültiger Gamepad-Port');
    if (this.activePort !== port) this.releaseAll();
    this.activePort = port;
  }

  setEnabled(enabled) {
    if (!enabled) this.releaseAll();
    this.enabled = Boolean(enabled);
  }

  releaseAll() {
    for (const [port, old] of this.states) {
      for (let index = 0; index < 4; index += 1) if (old & (1 << index)) this.emit({ type: 'direction', port, direction: DIRECTIONS[index], pressed: false });
      if (old & 16) this.emit({ type: 'fire', port, pressed: false });
    }
    this.states.clear();
  }

  poll(pads = this.provider()) {
    if (!this.enabled) return;
    const current = new Map();
    const available = Array.from(pads ?? []).filter(pad => pad && pad.connected !== false);
    for (let index = 0; index < Math.min(2, available.length); index += 1) {
      const pad = available[index];
      const port = index === 0 ? this.activePort : 3 - this.activePort;
      const pressed = button => Boolean(pad.buttons?.[button]?.pressed || pad.buttons?.[button]?.value >= 0.5);
      const x = Number(pad.axes?.[0] ?? 0);
      const y = Number(pad.axes?.[1] ?? 0);
      let bits = 0;
      if (y < -this.deadzone || pressed(12)) bits |= 1;
      if (y > this.deadzone || pressed(13)) bits |= 2;
      if (x < -this.deadzone || pressed(14)) bits |= 4;
      if (x > this.deadzone || pressed(15)) bits |= 8;
      if (pressed(0) || pressed(1) || pressed(2) || pressed(3) || pressed(5) || pressed(7)) bits |= 16;
      current.set(port, bits);
    }
    for (const port of [1, 2]) {
      const previous = this.states.get(port) ?? 0;
      const next = current.get(port) ?? 0;
      const difference = previous ^ next;
      for (let bit = 0; bit < 4; bit += 1) {
        if (difference & (1 << bit)) this.emit({ type: 'direction', port, direction: DIRECTIONS[bit], pressed: Boolean(next & (1 << bit)) });
      }
      if (difference & 16) this.emit({ type: 'fire', port, pressed: Boolean(next & 16) });
    }
    this.states = current;
  }
}
