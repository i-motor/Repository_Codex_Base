/* sid.js - SID 6581: 3 Stimmen (Dreieck/Saegezahn/Puls/Rauschen), ADSR, Ringmod, Sync, Filter */
(function (C64) {
  'use strict';
  const CLOCK = 985248;
  const RATES = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];

  class Voice {
    constructor() { this.reset(); }
    reset() {
      this.freq = 0; this.pw = 0; this.ctrl = 0; this.ad = 0; this.sr = 0;
      this.acc = 0; this.lfsr = 0x7FFFF8; this.wrapped = false;
      this.env = 0; this.state = 2; this.rc = 0; this.ec = 0; this.out = 0;
    }
    setCtrl(v) {
      if ((v & 1) && !(this.ctrl & 1)) this.state = 0;
      else if (!(v & 1) && (this.ctrl & 1)) this.state = 2;
      if (v & 8) { this.acc = 0; }
      this.ctrl = v;
    }
    clockEnv(cycles) {
      const period = RATES[this.state === 0 ? this.ad >> 4 : (this.state === 1 ? this.ad & 15 : this.sr & 15)];
      this.rc += cycles;
      while (this.rc >= period) {
        this.rc -= period;
        if (this.state === 0) {
          if (++this.env >= 255) { this.env = 255; this.state = 1; }
          continue;
        }
        const e = this.env;
        const ep = e >= 94 ? 1 : e >= 55 ? 2 : e >= 27 ? 4 : e >= 15 ? 8 : e >= 7 ? 16 : e >= 1 ? 30 : 1;
        if (++this.ec < ep) continue;
        this.ec = 0;
        if (this.state === 1) { if (e > (this.sr >> 4) * 17) this.env--; }
        else if (e > 0) this.env--;
      }
    }
    noise() {
      const l = this.lfsr;
      return (((l >> 20) & 1) << 11) | (((l >> 18) & 1) << 10) | (((l >> 14) & 1) << 9) | (((l >> 11) & 1) << 8) |
        (((l >> 9) & 1) << 7) | (((l >> 5) & 1) << 6) | (((l >> 2) & 1) << 5) | ((l & 1) << 4);
    }
  }

  class SID {
    constructor() {
      this.regs = new Uint8Array(32);
      this.voices = [new Voice(), new Voice(), new Voice()];
      this.sampleRate = 44100;
      this.buffer = new Float32Array(8192);
      this.count = 0;
      this.frac = 0;
      this.potX = 0xFF; this.potY = 0xFF;
      this.reset();
    }

    reset() {
      this.regs.fill(0);
      this.voices.forEach((v) => v.reset());
      this.low = 0; this.band = 0;
      this.updateFilter();
    }

    setSampleRate(sr) { this.sampleRate = sr; this.updateFilter(); }

    updateFilter() {
      const fc = ((this.regs[0x16] << 3) | (this.regs[0x15] & 7));
      const hz = Math.min(30 + fc * 5.8, this.sampleRate / 6.5);
      this.fcoef = 2 * Math.sin(Math.PI * hz / this.sampleRate);
      this.damp = 1.2 - (this.regs[0x17] >> 4) * 0.07;
    }

    read(r) {
      switch (r) {
        case 0x19: return this.potX;
        case 0x1A: return this.potY;
        case 0x1B: return (this.voices[2].out >> 4) & 0xFF;
        case 0x1C: return this.voices[2].env;
      }
      return 0;
    }

    write(r, v) {
      this.regs[r] = v;
      if (r < 21) {
        const vo = this.voices[(r / 7) | 0];
        switch (r % 7) {
          case 0: vo.freq = (vo.freq & 0xFF00) | v; break;
          case 1: vo.freq = (vo.freq & 0xFF) | (v << 8); break;
          case 2: vo.pw = (vo.pw & 0xF00) | v; break;
          case 3: vo.pw = (vo.pw & 0xFF) | ((v & 15) << 8); break;
          case 4: vo.setCtrl(v); break;
          case 5: vo.ad = v; break;
          case 6: vo.sr = v; break;
        }
      } else if (r >= 0x15 && r <= 0x17) this.updateFilter();
    }

    /* Emulation um 'cycles' Taktzyklen vorantreiben, Samples erzeugen */
    clock(cycles) {
      const cps = CLOCK / this.sampleRate;
      this.frac += cycles / cps;
      while (this.frac >= 1) {
        this.frac -= 1;
        const s = this.sample(cps);
        if (this.count < this.buffer.length) this.buffer[this.count++] = s;
      }
    }

    sample(cps) {
      const vs = this.voices;
      for (let i = 0; i < 3; i++) {
        const v = vs[i];
        v.wrapped = false;
        if (v.ctrl & 8) continue;
        const prev = v.acc;
        const next = prev + v.freq * cps;
        let n = Math.floor(next / 1048576) - Math.floor(prev / 1048576);
        if (n > 0 && (v.ctrl & 0x80)) {
          if (n > 16) n = 16;
          let l = v.lfsr;
          while (n--) l = ((l << 1) | (((l >> 22) ^ (l >> 17)) & 1)) & 0x7FFFFF;
          v.lfsr = l;
        }
        if (next >= 16777216) { v.wrapped = true; v.acc = next - 16777216; } else v.acc = next;
        v.clockEnv(cps);
      }
      for (let i = 0; i < 3; i++) {
        if ((vs[i].ctrl & 2) && vs[(i + 2) % 3].wrapped) vs[i].acc = 0;
      }
      const reg17 = this.regs[0x17], reg18 = this.regs[0x18];
      let direct = 0, filt = 0;
      for (let i = 0; i < 3; i++) {
        const v = vs[i], acc = v.acc | 0, c = v.ctrl;
        let w = 0xFFF, any = false;
        if (c & 0x10) {
          let msb = acc & 0x800000;
          if (c & 4) msb ^= (vs[(i + 2) % 3].acc | 0) & 0x800000;
          w &= ((msb ? ~acc : acc) >> 11) & 0xFFF; any = true;
        }
        if (c & 0x20) { w &= acc >> 12; any = true; }
        if (c & 0x40) { w &= ((c & 8) || (acc >> 12) >= v.pw) ? 0xFFF : 0; any = true; }
        if (c & 0x80) { w &= v.noise(); any = true; }
        if (!any) w = 0x800;
        v.out = any ? w : 0;
        const o = (w - 0x800) * v.env / (2048 * 255);
        if (reg17 & (1 << i)) filt += o;
        else if (!(i === 2 && (reg18 & 0x80))) direct += o;
      }
      // Zustandsvariablen-Filter
      const f = this.fcoef;
      this.low += f * this.band;
      const high = filt - this.low - this.damp * this.band;
      this.band += f * high;
      let out = direct;
      if (reg18 & 0x10) out += this.low;
      if (reg18 & 0x20) out += this.band;
      if (reg18 & 0x40) out += high;
      return out * (reg18 & 15) / 15 * 0.33;
    }

    /* erzeugte Samples abholen */
    flush() {
      const out = this.buffer.slice(0, this.count);
      this.count = 0;
      return out;
    }
  }

  C64.SID = SID;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
