/* machine.js - verdrahtet CPU, Speicher, VIC, SID, CIAs, Tastatur, Joystick, KERNAL und BASIC;
   Zeilen-/Frame-Takt (PAL: 312 Zeilen x 63 Zyklen) */
(function (C64) {
  'use strict';
  const LINES = 312, CYCLES_PER_LINE = 63;

  class Machine {
    constructor() {
      const mem = this.mem = new C64.Memory();
      this.cpu = new C64.CPU6510(mem);
      this.vic = mem.vic = new C64.VIC2(mem);
      this.sid = mem.sid = new C64.SID();
      this.cia1 = mem.cia1 = new C64.CIA();
      this.cia2 = mem.cia2 = new C64.CIA();
      this.keyboard = new C64.Keyboard();
      this.joystick = new C64.Joystick();
      this.keyboard.joystick = this.joystick;
      this.kernal = new C64.Kernal(this);
      this.basic = this.kernal.basic = new C64.Basic(this);
      this.budget = 0; this.preTicked = 0;

      const kb = this.keyboard, joy = this.joystick;
      this.cia1.portAIn = (outA, outB) => joy.lines(2) & kb.readCols(outB & joy.lines(1));
      this.cia1.portBIn = (outA, outB) => joy.lines(1) & kb.readRows(outA & joy.lines(2));
      this.cia2.onPortA = () => { this.vic.bank = (~this.cia2.outA() & 3) << 14; };
      this.cia2.onIrq = () => this.cpu.nmi();
      kb.onRestore = () => this.cpu.nmi();
      this.reset();
    }

    reset() {
      this.mem.reset();
      this.vic.reset();
      this.sid.reset();
      this.cpu.reset();
      this.kernal.reset();
      this.kernal.enterBasic();
      this.basic.coldStart();
      this.budget = 0;
    }

    stepCpu() {
      const cpu = this.cpu;
      cpu.irq = this.vic.irqLine || this.cia1.irqLine;
      const c = cpu.step();
      const t = c - this.preTicked;
      this.preTicked = 0;
      if (t > 0) { this.cia1.tick(t); this.cia2.tick(t); }
      return c;
    }

    /* CPU laufen lassen, bis der PC die Adresse erreicht (fuer USR) */
    runUntil(pc, maxCycles) {
      let n = 0;
      while (this.cpu.pc !== pc && n < maxCycles) n += this.stepCpu();
      return n;
    }

    runFrame() {
      const vic = this.vic, sid = this.sid;
      for (let line = 0; line < LINES; line++) {
        vic.beginLine(line);
        const bad = vic.isBadLine(line);
        this.budget += bad ? 23 : CYCLES_PER_LINE;
        while (this.budget > 0) this.budget -= this.stepCpu();
        if (bad) { this.cia1.tick(40); this.cia2.tick(40); }
        sid.clock(CYCLES_PER_LINE);
        vic.renderLine(line);
      }
    }

    /* PRG-Daten (mit Ladeadresse) direkt in den Speicher legen, z.B. per Drag & Drop */
    loadPrg(bytes) {
      if (bytes.length < 3) return -1;
      const addr = bytes[0] | (bytes[1] << 8), b = this.basic;
      if (addr === 0x0801 || addr === 0x0401) {
        this.kernal.copyToRam(bytes, b.txttab, false);
        b.vartab = b.relink();
        b.clr();
        return b.txttab;
      }
      this.kernal.copyToRam(bytes, addr, false);
      return addr;
    }
  }

  C64.Machine = Machine;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
