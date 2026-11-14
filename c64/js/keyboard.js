/* keyboard.js - Browser-Tastaturevents -> 8x8-Tastaturmatrix (CIA1), Einfuegen aus Zwischenablage */
(function (C64) {
  'use strict';
  // Index = Spalte(PA)*8 + Zeile(PB)
  const LAYOUT = ['DEL', 'RETURN', 'RIGHT', 'F7', 'F1', 'F3', 'F5', 'DOWN',
    '3', 'W', 'A', '4', 'Z', 'S', 'E', 'LSHIFT',
    '5', 'R', 'D', '6', 'C', 'F', 'T', 'X',
    '7', 'Y', 'G', '8', 'B', 'H', 'U', 'V',
    '9', 'I', 'J', '0', 'M', 'K', 'O', 'N',
    '+', 'P', 'L', '-', '.', ':', '@', ',',
    'POUND', '*', ';', 'HOME', 'RSHIFT', '=', 'UP', '/',
    '1', 'LEFT', 'CTRL', '2', 'SPACE', 'CBM', 'Q', 'STOP'];
  const IDX = {};
  LAYOUT.forEach((n, i) => { IDX[n] = i; });
  const LSHIFT = IDX.LSHIFT;

  // Zeichen -> [Taste, Shift]
  const CHARS = {
    '!': ['1', 1], '"': ['2', 1], '#': ['3', 1], '$': ['4', 1], '%': ['5', 1], '&': ['6', 1], "'": ['7', 1],
    '(': ['8', 1], ')': ['9', 1], '<': [',', 1], '>': ['.', 1], '[': [':', 1], ']': [';', 1], '?': ['/', 1],
    '+': ['+', 0], '-': ['-', 0], '.': ['.', 0], ':': [':', 0], '@': ['@', 0], ',': [',', 0], '*': ['*', 0],
    ';': [';', 0], '=': ['=', 0], '/': ['/', 0], '^': ['UP', 0], '_': ['LEFT', 0], '`': ['LEFT', 0],
    '£': ['POUND', 0], '\\': ['POUND', 0], '~': ['UP', 1], 'π': ['UP', 1], '°': ['UP', 0]
  };
  // benannte Tasten -> [Taste, Shift] (null = Shift des Hosts gilt)
  const NAMED = {
    Enter: ['RETURN', null], Backspace: ['DEL', null], Delete: ['DEL', null], Insert: ['DEL', 1],
    ArrowRight: ['RIGHT', null], ArrowLeft: ['RIGHT', 1], ArrowDown: ['DOWN', null], ArrowUp: ['DOWN', 1],
    Home: ['HOME', null], Escape: ['STOP', null], Tab: ['CTRL', null], Control: ['CBM', null], ' ': ['SPACE', null],
    F1: ['F1', 0], F2: ['F1', 1], F3: ['F3', 0], F4: ['F3', 1], F5: ['F5', 0], F6: ['F5', 1], F7: ['F7', 0], F8: ['F7', 1]
  };

  class Keyboard {
    constructor() {
      this.matrix = new Uint8Array(8);    // je Spalte: Bitmaske gedrueckter Zeilen
      this.down = new Map();              // event.code -> {key, shift, t}
      this.hostShift = false;
      this.seq = 0;
      this.pasteQueue = [];
      this.strokes = [];                  // Tastenanschlaege fuer den KERNAL-Scan: {key, mods}
      this.shift = false;
      this.onRestore = null;
      this.onHotkey = null;               // (code) => bool
      this.joystick = null;
    }

    static get LAYOUT() { return LAYOUT; }

    attach(target) {
      target.addEventListener('keydown', (e) => this.keyDown(e));
      target.addEventListener('keyup', (e) => this.keyUp(e));
      target.addEventListener('blur', () => this.releaseAll());
      target.addEventListener('paste', (e) => {
        const t = (e.clipboardData || window.clipboardData).getData('text');
        if (t) this.paste(t);
        e.preventDefault();
      });
    }

    paste(text) { this.pasteQueue.push(...C64.petscii.fromAscii(text)); }

    map(e) {
      const k = e.key;
      if (NAMED[k]) return NAMED[k];
      if (k === 'Dead' && e.code === 'Backquote') return ['UP', 0];
      if (k.length === 1) {
        if (CHARS[k]) return CHARS[k];
        const u = k.toUpperCase();
        if (u >= 'A' && u <= 'Z' && u.length === 1) return [u, e.shiftKey ? 1 : 0];
        if (k >= '0' && k <= '9') return [k, 0];
      }
      return null;
    }

    keyDown(e) {
      if (e.altKey && !e.ctrlKey && this.onHotkey && this.onHotkey(e.code)) { e.preventDefault(); return; }
      if (e.key === 'F11' || e.key === 'F12') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) return;   // Einfuegen zulassen
      if (e.metaKey) return;
      e.preventDefault();
      if (e.key === 'Shift') { this.hostShift = true; this.rebuild(); return; }
      if (e.key === 'PageUp') { if (!e.repeat && this.onRestore) this.onRestore(); return; }
      if (this.joystick && this.joystick.key(e.code, true)) return;
      if (e.repeat) return;
      if (e.key === 'AltGraph' || (e.ctrlKey && e.altKey)) {     // AltGr meldet sich als Strg+Alt
        this.down.delete('ControlLeft');
        if (e.key === 'AltGraph') { this.rebuild(); return; }
      }
      const m = this.map(e);
      if (!m) return;
      const key = IDX[m[0]];
      this.down.set(e.code, { key: key, shift: m[1], t: ++this.seq });
      this.rebuild();
      // Anschlag merken, damit schnelles Tippen (kuerzer als ein Scan-Intervall) nichts verliert
      if (key !== IDX.CTRL && key !== IDX.CBM) {
        this.strokes.push({ key: key, mods: (this.shift ? 1 : 0) | (this.isDown('CBM') ? 2 : 0) | (this.isDown('CTRL') ? 4 : 0) });
      }
    }

    keyUp(e) {
      if (e.key === 'Shift') this.hostShift = e.shiftKey;
      if (this.joystick) this.joystick.key(e.code, false);
      this.down.delete(e.code);
      this.rebuild();
      e.preventDefault();
    }

    releaseAll() { this.down.clear(); this.strokes.length = 0; this.hostShift = false; this.rebuild(); if (this.joystick) this.joystick.releaseKeys(); }

    rebuild() {
      const mx = this.matrix;
      mx.fill(0);
      let shift = this.hostShift, best = 0;
      for (const d of this.down.values()) {
        mx[d.key >> 3] |= 1 << (d.key & 7);
        if (d.shift !== null && d.t > best) { best = d.t; shift = !!d.shift; }
      }
      this.shift = shift;
      if (shift) mx[LSHIFT >> 3] |= 1 << (LSHIFT & 7);
    }

    isDown(name) { const i = IDX[name]; return (this.matrix[i >> 3] >> (i & 7)) & 1; }

    /* CIA1: Port B lesen bei gegebener Ausgabe auf Port A (und umgekehrt) */
    readRows(paOut) {
      let r = 0xFF;
      for (let i = 0; i < 8; i++) if (!(paOut & (1 << i))) r &= ~this.matrix[i];
      return r & 0xFF;
    }
    readCols(pbOut) {
      let r = 0xFF;
      for (let i = 0; i < 8; i++) if (this.matrix[i] & ~pbOut) r &= ~(1 << i);
      return r & 0xFF;
    }
  }

  C64.Keyboard = Keyboard;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
