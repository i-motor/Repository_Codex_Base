/* joystick.js - Maus als Joystick: Bewegung = Richtung, Maustaste = Feuer (zusaetzlich Ziffernblock) */
(function (C64) {
  'use strict';
  const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, FIRE = 16;
  const HOLD_MS = 110, THRESHOLD = 2;
  const KEYS = { Numpad8: UP, Numpad2: DOWN, Numpad4: LEFT, Numpad6: RIGHT, Numpad0: FIRE, Numpad5: FIRE,
    Numpad7: UP | LEFT, Numpad9: UP | RIGHT, Numpad1: DOWN | LEFT, Numpad3: DOWN | RIGHT };

  class Joystick {
    constructor() {
      this.port = 2;
      this.until = [0, 0, 0, 0];   // Ablaufzeit je Richtung
      this.fire = false;
      this.keys = 0;
      this.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }

    attach(target) {
      target.addEventListener('mousemove', (e) => this.move(e.movementX || 0, e.movementY || 0));
      target.addEventListener('mousedown', (e) => { if (e.button === 0) this.fire = true; });
      target.addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; });
      target.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    move(dx, dy) {
      const t = this.now() + HOLD_MS;
      if (dy <= -THRESHOLD) { this.until[0] = t; this.until[1] = 0; }
      if (dy >= THRESHOLD) { this.until[1] = t; this.until[0] = 0; }
      if (dx <= -THRESHOLD) { this.until[2] = t; this.until[3] = 0; }
      if (dx >= THRESHOLD) { this.until[3] = t; this.until[2] = 0; }
    }

    key(code, down) {
      const b = KEYS[code];
      if (!b) return false;
      if (down) this.keys |= b; else this.keys &= ~b;
      return true;
    }
    releaseKeys() { this.keys = 0; this.fire = false; }

    /* aktive Bits (1 = betaetigt) */
    state() {
      const n = this.now();
      let s = this.keys;
      for (let i = 0; i < 4; i++) if (this.until[i] > n) s |= 1 << i;
      if (this.fire) s |= FIRE;
      return s;
    }
    /* Pegel fuer den CIA-Port (0 = betaetigt) */
    lines(port) { return port === this.port ? (0xFF & ~this.state()) : 0xFF; }
  }

  C64.Joystick = Joystick;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
