/* cia.js - MOS 6526 CIA: Timer A/B, ICR, Ports mit Datenrichtung, TOD-Uhr */
(function (C64) {
  'use strict';
  const TOD_CYCLES = 98525;   // 1/10 s bei PAL

  class CIA {
    constructor() {
      this.portAIn = null;     // (ausgabeA, ausgabeB) => externe Pegel Port A
      this.portBIn = null;
      this.onPortA = null;     // Rueckruf bei Aenderung Port A
      this.onIrq = null;       // Rueckruf bei steigender IRQ-Flanke (fuer NMI)
      this.reset();
    }

    reset() {
      this.pra = 0; this.prb = 0; this.ddra = 0; this.ddrb = 0;
      this.ta = 0xFFFF; this.tb = 0xFFFF; this.latchA = 0xFFFF; this.latchB = 0xFFFF;
      this.cra = 0; this.crb = 0; this.icr = 0; this.mask = 0; this.sdr = 0;
      this.irqLine = false;
      this.tod = [0, 0, 0, 1]; this.alarm = [0, 0, 0, 0];   // Zehntel, Sek, Min, Std (BCD)
      this.todLatch = null; this.todRun = true; this.todCycles = 0;
    }

    outA() { return (this.pra | ~this.ddra) & 0xFF; }
    outB() { return (this.prb | ~this.ddrb) & 0xFF; }

    raise(bit) {
      this.icr |= bit;
      if ((this.icr & this.mask & 0x1F) && !this.irqLine) {
        this.icr |= 0x80; this.irqLine = true;
        if (this.onIrq) this.onIrq();
      }
    }

    tick(cycles) {
      let ufA = 0;
      if ((this.cra & 0x21) === 0x01) {
        this.ta -= cycles;
        while (this.ta < 0) {
          ufA++;
          if (this.cra & 0x08) { this.cra &= ~1; this.ta = this.latchA; break; }
          this.ta += this.latchA + 1;
        }
        if (ufA) this.raise(1);
      }
      if (this.crb & 1) {
        const mode = this.crb & 0x60;
        const n = mode === 0 ? cycles : (mode === 0x40 || mode === 0x60 ? ufA : 0);
        if (n) {
          this.tb -= n;
          let uf = false;
          while (this.tb < 0) {
            uf = true;
            if (this.crb & 0x08) { this.crb &= ~1; this.tb = this.latchB; break; }
            this.tb += this.latchB + 1;
          }
          if (uf) this.raise(2);
        }
      }
      if (this.todRun) {
        this.todCycles += cycles;
        while (this.todCycles >= TOD_CYCLES) { this.todCycles -= TOD_CYCLES; this.todStep(); }
      }
    }

    todStep() {
      const t = this.tod;
      const inc = (v, max) => { v = (v & 15) === 9 ? (v & 0xF0) + 0x10 : v + 1; return v > max ? 0 : v; };
      if (++t[0] > 9) {
        t[0] = 0; t[1] = inc(t[1], 0x59);
        if (t[1] === 0) {
          t[2] = inc(t[2], 0x59);
          if (t[2] === 0) {
            let h = t[3] & 0x1F, pm = t[3] & 0x80;
            if (h === 0x11) pm ^= 0x80;
            h = h === 0x12 ? 1 : (h === 0x09 ? 0x10 : h + 1);
            t[3] = h | pm;
          }
        }
      }
      if (t[0] === this.alarm[0] && t[1] === this.alarm[1] && t[2] === this.alarm[2] && t[3] === this.alarm[3]) this.raise(4);
    }

    read(r) {
      switch (r) {
        case 0x0: { let v = this.outA(); if (this.portAIn) v &= this.portAIn(v, this.outB()); return v; }
        case 0x1: { let v = this.outB(); if (this.portBIn) v &= this.portBIn(this.outA(), v); return v; }
        case 0x2: return this.ddra;
        case 0x3: return this.ddrb;
        case 0x4: return this.ta & 0xFF;
        case 0x5: return (this.ta >> 8) & 0xFF;
        case 0x6: return this.tb & 0xFF;
        case 0x7: return (this.tb >> 8) & 0xFF;
        case 0x8: { const v = (this.todLatch || this.tod)[0]; this.todLatch = null; return v; }
        case 0x9: return (this.todLatch || this.tod)[1];
        case 0xA: return (this.todLatch || this.tod)[2];
        case 0xB: this.todLatch = this.tod.slice(); return this.todLatch[3];
        case 0xC: return this.sdr;
        case 0xD: { const v = this.icr; this.icr = 0; this.irqLine = false; return v; }
        case 0xE: return this.cra;
        case 0xF: return this.crb;
      }
      return 0xFF;
    }

    write(r, v) {
      switch (r) {
        case 0x0: this.pra = v; if (this.onPortA) this.onPortA(); break;
        case 0x1: this.prb = v; break;
        case 0x2: this.ddra = v; if (this.onPortA) this.onPortA(); break;
        case 0x3: this.ddrb = v; break;
        case 0x4: this.latchA = (this.latchA & 0xFF00) | v; break;
        case 0x5: this.latchA = (this.latchA & 0xFF) | (v << 8); if (!(this.cra & 1)) this.ta = this.latchA; break;
        case 0x6: this.latchB = (this.latchB & 0xFF00) | v; break;
        case 0x7: this.latchB = (this.latchB & 0xFF) | (v << 8); if (!(this.crb & 1)) this.tb = this.latchB; break;
        case 0x8: case 0x9: case 0xA: case 0xB: {
          const i = r - 8, val = i === 3 ? v & 0x9F : (i === 0 ? v & 0x0F : v & 0x7F);
          if (this.crb & 0x80) this.alarm[i] = val;
          else { this.tod[i] = val; if (i === 3) this.todRun = false; if (i === 0) this.todRun = true; }
          break;
        }
        case 0xC: this.sdr = v; break;
        case 0xD:
          if (v & 0x80) this.mask |= v & 0x1F; else this.mask &= ~v;
          if ((this.icr & this.mask & 0x1F) && !this.irqLine) { this.icr |= 0x80; this.irqLine = true; if (this.onIrq) this.onIrq(); }
          break;
        case 0xE: if (v & 0x10) this.ta = this.latchA; this.cra = v & ~0x10; break;
        case 0xF: if (v & 0x10) this.tb = this.latchB; this.crb = v & ~0x10; break;
      }
    }
  }

  C64.CIA = CIA;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
