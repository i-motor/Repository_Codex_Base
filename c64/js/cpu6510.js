/* cpu6510.js - MOS 6510: dokumentierte + gaengige illegale Opcodes, IRQ/NMI/BRK */
(function (C64) {
  'use strict';
  const N = 0x80, V = 0x40, B = 0x10, D = 0x08, I = 0x04, Z = 0x02, C = 0x01;
  const IMM = 0, ZP = 1, ZPX = 2, ZPY = 3, ABS = 4, ABX = 5, ABY = 6, IZX = 7, IZY = 8, IMP = 9;

  class CPU6510 {
    constructor(mem) {
      this.mem = mem;
      this.a = 0; this.x = 0; this.y = 0; this.sp = 0xFF; this.p = 0x24; this.pc = 0;
      this.irq = false; this.nmiPending = false;
      this.px = 0; this.extra = 0;
      this.onTrap = null;   // (adresse) => Zyklen oder -1
      this.onJam = null;
      this.ops = new Array(256);
      this.build();
    }

    reset() {
      this.a = this.x = this.y = 0; this.sp = 0xFF; this.p = 0x24;
      this.irq = false; this.nmiPending = false;
      this.pc = this.mem.read16(0xFFFC);
    }

    nmi() { this.nmiPending = true; }
    push(v) { this.mem.write(0x100 | this.sp, v); this.sp = (this.sp - 1) & 0xFF; }
    pop() { this.sp = (this.sp + 1) & 0xFF; return this.mem.read(0x100 | this.sp); }
    nz(v) { this.p = (this.p & 0x7D) | (v & 0x80) | (v ? 0 : Z); return v; }
    setC(c) { this.p = c ? (this.p | C) : (this.p & ~C); }

    interrupt(vector, brk) {
      this.push(this.pc >> 8); this.push(this.pc & 0xFF);
      this.push((this.p & ~B) | 0x20 | (brk ? B : 0));
      this.p |= I;
      this.pc = this.mem.read16(vector);
    }

    step() {
      if (this.nmiPending) { this.nmiPending = false; this.interrupt(0xFFFA, false); return 7; }
      if (this.irq && !(this.p & I)) { this.interrupt(0xFFFE, false); return 7; }
      const at = this.pc;
      const op = this.mem.read(at);
      this.pc = (at + 1) & 0xFFFF;
      if (op === 0x02) {
        const t = this.onTrap ? this.onTrap(at) : -1;
        if (t >= 0) return t;
        if (this.onJam) this.onJam(at);
        return 2;
      }
      const e = this.ops[op];
      this.px = 0; this.extra = 0;
      e.f.call(this, e.m);
      return e.c + (e.pen ? this.px : 0) + this.extra;
    }

    addr(mode) {
      const m = this.mem;
      let a, base, z;
      switch (mode) {
        case IMM: a = this.pc; this.pc = (a + 1) & 0xFFFF; return a;
        case ZP: a = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return a;
        case ZPX: a = (m.read(this.pc) + this.x) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; return a;
        case ZPY: a = (m.read(this.pc) + this.y) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; return a;
        case ABS: a = m.read16(this.pc); this.pc = (this.pc + 2) & 0xFFFF; return a;
        case ABX: base = m.read16(this.pc); this.pc = (this.pc + 2) & 0xFFFF;
          a = (base + this.x) & 0xFFFF; if ((a ^ base) & 0xFF00) this.px = 1; return a;
        case ABY: base = m.read16(this.pc); this.pc = (this.pc + 2) & 0xFFFF;
          a = (base + this.y) & 0xFFFF; if ((a ^ base) & 0xFF00) this.px = 1; return a;
        case IZX: z = (m.read(this.pc) + this.x) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF;
          return m.read(z) | (m.read((z + 1) & 0xFF) << 8);
        case IZY: z = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF;
          base = m.read(z) | (m.read((z + 1) & 0xFF) << 8);
          a = (base + this.y) & 0xFFFF; if ((a ^ base) & 0xFF00) this.px = 1; return a;
      }
      return 0;
    }

    adc(v) {
      const a = this.a, c = this.p & C;
      if (this.p & D) {
        let lo = (a & 15) + (v & 15) + c, hi = (a >> 4) + (v >> 4);
        const bin = (a + v + c) & 0xFF;
        if (lo > 9) { lo += 6; hi++; }
        let p = this.p & ~(N | V | Z | C);
        if (!bin) p |= Z;
        if ((hi << 4) & 0x80) p |= N;
        if ((~(a ^ v) & (a ^ (hi << 4))) & 0x80) p |= V;
        if (hi > 9) hi += 6;
        if (hi > 15) p |= C;
        this.p = p;
        this.a = ((hi << 4) | (lo & 15)) & 0xFF;
      } else {
        const s = a + v + c;
        let p = this.p & ~(V | C);
        if ((~(a ^ v) & (a ^ s)) & 0x80) p |= V;
        if (s > 0xFF) p |= C;
        this.p = p;
        this.a = this.nz(s & 0xFF);
      }
    }

    sbc(v) {
      if (!(this.p & D)) { this.adc(v ^ 0xFF); return; }
      const a = this.a, b = 1 - (this.p & C);
      const s = a - v - b;
      let lo = (a & 15) - (v & 15) - b, hi = (a >> 4) - (v >> 4);
      if (lo < 0) { lo -= 6; hi--; }
      if (hi < 0) hi -= 6;
      let p = this.p & ~(V | C);
      if (((a ^ v) & (a ^ s)) & 0x80) p |= V;
      if (s >= 0) p |= C;
      this.p = p;
      this.nz(s & 0xFF);
      this.a = ((hi << 4) | (lo & 15)) & 0xFF;
    }

    cmp(r, v) { const t = r - v; this.setC(t >= 0); this.nz(t & 0xFF); }
    asl(v) { this.setC(v & 0x80); return this.nz((v << 1) & 0xFF); }
    lsr(v) { this.setC(v & 1); return this.nz(v >> 1); }
    rol(v) { const c = this.p & C; this.setC(v & 0x80); return this.nz(((v << 1) | c) & 0xFF); }
    ror(v) { const c = this.p & C; this.setC(v & 1); return this.nz((v >> 1) | (c << 7)); }
    branch(cond) {
      const rel = this.mem.read(this.pc);
      this.pc = (this.pc + 1) & 0xFFFF;
      if (cond) {
        const t = (this.pc + (rel < 128 ? rel : rel - 256)) & 0xFFFF;
        this.extra = ((t ^ this.pc) & 0xFF00) ? 2 : 1;
        this.pc = t;
      }
    }

    build() {
      const ops = this.ops, self = this;
      const def = (op, f, m, c, pen) => { ops[op] = { f: f, m: m, c: c, pen: !!pen }; };
      const rd = (m) => self.mem.read(self.addr(m));
      // Read-Modify-Write schreibt wie die echte CPU zuerst den alten Wert zurueck (wichtig z.B. fuer INC $D019)
      const rmw = (fn) => function (m) {
        const a = this.addr(m), old = this.mem.read(a);
        this.mem.write(a, old);
        const v = fn.call(this, old);
        this.mem.write(a, v);
        return v;
      };

      for (let i = 0; i < 256; i++) def(i, function () { }, IMP, 2);   // Vorgabe: NOP

      // Gruppe 01: ORA AND EOR ADC STA LDA CMP SBC
      const g1 = [
        function (m) { this.a = this.nz(this.a | rd(m)); },
        function (m) { this.a = this.nz(this.a & rd(m)); },
        function (m) { this.a = this.nz(this.a ^ rd(m)); },
        function (m) { this.adc(rd(m)); },
        function (m) { this.mem.write(this.addr(m), this.a); },
        function (m) { this.a = this.nz(rd(m)); },
        function (m) { this.cmp(this.a, rd(m)); },
        function (m) { this.sbc(rd(m)); }
      ];
      const m1 = [IZX, ZP, IMM, ABS, IZY, ZPX, ABY, ABX];
      const c1 = [6, 3, 2, 4, 5, 4, 4, 4];
      for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
        const op = (a << 5) | (b << 2) | 1;
        if (a === 4) {
          if (b === 2) continue;                       // $89 = NOP #
          def(op, g1[a], m1[b], [6, 3, 2, 4, 6, 4, 5, 5][b], false);
        } else def(op, g1[a], m1[b], c1[b], b === 4 || b === 6 || b === 7);
      }

      // Schiebe-/Zaehlbefehle auf Speicher
      const fASL = rmw(function (v) { return this.asl(v); });
      const fROL = rmw(function (v) { return this.rol(v); });
      const fLSR = rmw(function (v) { return this.lsr(v); });
      const fROR = rmw(function (v) { return this.ror(v); });
      const fDEC = rmw(function (v) { return this.nz((v - 1) & 0xFF); });
      const fINC = rmw(function (v) { return this.nz((v + 1) & 0xFF); });
      const g2 = [fASL, fROL, fLSR, fROR, null, null, fDEC, fINC];
      for (let a = 0; a < 8; a++) {
        if (!g2[a]) continue;
        def((a << 5) | 0x06, g2[a], ZP, 5); def((a << 5) | 0x16, g2[a], ZPX, 6);
        def((a << 5) | 0x0E, g2[a], ABS, 6); def((a << 5) | 0x1E, g2[a], ABX, 7);
      }
      def(0x0A, function () { this.a = this.asl(this.a); }, IMP, 2);
      def(0x2A, function () { this.a = this.rol(this.a); }, IMP, 2);
      def(0x4A, function () { this.a = this.lsr(this.a); }, IMP, 2);
      def(0x6A, function () { this.a = this.ror(this.a); }, IMP, 2);

      // Laden/Speichern X, Y
      const fLDX = function (m) { this.x = this.nz(rd(m)); };
      const fLDY = function (m) { this.y = this.nz(rd(m)); };
      const fSTX = function (m) { this.mem.write(this.addr(m), this.x); };
      const fSTY = function (m) { this.mem.write(this.addr(m), this.y); };
      def(0xA2, fLDX, IMM, 2); def(0xA6, fLDX, ZP, 3); def(0xB6, fLDX, ZPY, 4); def(0xAE, fLDX, ABS, 4); def(0xBE, fLDX, ABY, 4, true);
      def(0xA0, fLDY, IMM, 2); def(0xA4, fLDY, ZP, 3); def(0xB4, fLDY, ZPX, 4); def(0xAC, fLDY, ABS, 4); def(0xBC, fLDY, ABX, 4, true);
      def(0x86, fSTX, ZP, 3); def(0x96, fSTX, ZPY, 4); def(0x8E, fSTX, ABS, 4);
      def(0x84, fSTY, ZP, 3); def(0x94, fSTY, ZPX, 4); def(0x8C, fSTY, ABS, 4);

      // Vergleiche, BIT
      const fCPX = function (m) { this.cmp(this.x, rd(m)); };
      const fCPY = function (m) { this.cmp(this.y, rd(m)); };
      def(0xE0, fCPX, IMM, 2); def(0xE4, fCPX, ZP, 3); def(0xEC, fCPX, ABS, 4);
      def(0xC0, fCPY, IMM, 2); def(0xC4, fCPY, ZP, 3); def(0xCC, fCPY, ABS, 4);
      const fBIT = function (m) { const v = rd(m); this.p = (this.p & ~(N | V | Z)) | (v & 0xC0) | ((this.a & v) ? 0 : Z); };
      def(0x24, fBIT, ZP, 3); def(0x2C, fBIT, ABS, 4);

      // Spruenge
      def(0x10, function () { this.branch(!(this.p & N)); }, IMP, 2);
      def(0x30, function () { this.branch(this.p & N); }, IMP, 2);
      def(0x50, function () { this.branch(!(this.p & V)); }, IMP, 2);
      def(0x70, function () { this.branch(this.p & V); }, IMP, 2);
      def(0x90, function () { this.branch(!(this.p & C)); }, IMP, 2);
      def(0xB0, function () { this.branch(this.p & C); }, IMP, 2);
      def(0xD0, function () { this.branch(!(this.p & Z)); }, IMP, 2);
      def(0xF0, function () { this.branch(this.p & Z); }, IMP, 2);
      def(0x4C, function () { this.pc = this.mem.read16(this.pc); }, IMP, 3);
      def(0x6C, function () {
        const p = this.mem.read16(this.pc);
        this.pc = this.mem.read(p) | (this.mem.read((p & 0xFF00) | ((p + 1) & 0xFF)) << 8);
      }, IMP, 5);
      def(0x20, function () {
        const t = this.mem.read16(this.pc), r = (this.pc + 1) & 0xFFFF;
        this.push(r >> 8); this.push(r & 0xFF); this.pc = t;
      }, IMP, 6);
      def(0x60, function () { const lo = this.pop(); this.pc = ((lo | (this.pop() << 8)) + 1) & 0xFFFF; }, IMP, 6);
      def(0x40, function () { this.p = (this.pop() & ~B) | 0x20; const lo = this.pop(); this.pc = lo | (this.pop() << 8); }, IMP, 6);
      def(0x00, function () { this.pc = (this.pc + 1) & 0xFFFF; this.interrupt(0xFFFE, true); }, IMP, 7);

      // Stack, Flags, Transfers
      def(0x48, function () { this.push(this.a); }, IMP, 3);
      def(0x08, function () { this.push(this.p | B | 0x20); }, IMP, 3);
      def(0x68, function () { this.a = this.nz(this.pop()); }, IMP, 4);
      def(0x28, function () { this.p = (this.pop() & ~B) | 0x20; }, IMP, 4);
      def(0x18, function () { this.p &= ~C; }, IMP, 2); def(0x38, function () { this.p |= C; }, IMP, 2);
      def(0x58, function () { this.p &= ~I; }, IMP, 2); def(0x78, function () { this.p |= I; }, IMP, 2);
      def(0xB8, function () { this.p &= ~V; }, IMP, 2);
      def(0xD8, function () { this.p &= ~D; }, IMP, 2); def(0xF8, function () { this.p |= D; }, IMP, 2);
      def(0xAA, function () { this.x = this.nz(this.a); }, IMP, 2);
      def(0xA8, function () { this.y = this.nz(this.a); }, IMP, 2);
      def(0xBA, function () { this.x = this.nz(this.sp); }, IMP, 2);
      def(0x8A, function () { this.a = this.nz(this.x); }, IMP, 2);
      def(0x9A, function () { this.sp = this.x; }, IMP, 2);
      def(0x98, function () { this.a = this.nz(this.y); }, IMP, 2);
      def(0xCA, function () { this.x = this.nz((this.x - 1) & 0xFF); }, IMP, 2);
      def(0x88, function () { this.y = this.nz((this.y - 1) & 0xFF); }, IMP, 2);
      def(0xE8, function () { this.x = this.nz((this.x + 1) & 0xFF); }, IMP, 2);
      def(0xC8, function () { this.y = this.nz((this.y + 1) & 0xFF); }, IMP, 2);
      def(0xEA, function () { }, IMP, 2);

      // ---- illegale Opcodes ----
      const g3 = [
        function (m) { this.a = this.nz(this.a | fASL.call(this, m)); },            // SLO
        function (m) { this.a = this.nz(this.a & fROL.call(this, m)); },            // RLA
        function (m) { this.a = this.nz(this.a ^ fLSR.call(this, m)); },            // SRE
        function (m) { this.adc(fROR.call(this, m)); },                             // RRA
        null, null,
        function (m) { this.cmp(this.a, fDEC.call(this, m)); },                     // DCP
        function (m) { this.sbc(fINC.call(this, m)); }                              // ISC
      ];
      const c3 = [8, 5, 0, 6, 8, 6, 7, 7];
      for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
        if (!g3[a] || b === 2) continue;
        def((a << 5) | (b << 2) | 3, g3[a], m1[b], c3[b]);
      }
      const fSAX = function (m) { this.mem.write(this.addr(m), this.a & this.x); };
      def(0x83, fSAX, IZX, 6); def(0x87, fSAX, ZP, 3); def(0x8F, fSAX, ABS, 4); def(0x97, fSAX, ZPY, 4);
      const fLAX = function (m) { this.a = this.x = this.nz(rd(m)); };
      def(0xA3, fLAX, IZX, 6); def(0xA7, fLAX, ZP, 3); def(0xAF, fLAX, ABS, 4); def(0xB3, fLAX, IZY, 5, true);
      def(0xB7, fLAX, ZPY, 4); def(0xBF, fLAX, ABY, 4, true); def(0xAB, fLAX, IMM, 2);
      const fANC = function (m) { this.a = this.nz(this.a & rd(m)); this.setC(this.a & 0x80); };
      def(0x0B, fANC, IMM, 2); def(0x2B, fANC, IMM, 2);
      def(0x4B, function (m) { this.a = this.lsr(this.a & rd(m)); }, IMM, 2);       // ALR
      def(0x6B, function (m) {                                                      // ARR
        const v = this.a & rd(m);
        this.a = this.nz((v >> 1) | ((this.p & C) << 7));
        this.setC(this.a & 0x40);
        this.p = (this.p & ~V) | ((((this.a >> 6) ^ (this.a >> 5)) & 1) ? V : 0);
      }, IMM, 2);
      def(0xCB, function (m) {                                                      // SBX
        const t = (this.a & this.x) - rd(m);
        this.setC(t >= 0); this.x = this.nz(t & 0xFF);
      }, IMM, 2);
      def(0xEB, g1[7], IMM, 2);
      def(0x8B, function (m) { this.a = this.nz(this.x & rd(m)); }, IMM, 2);        // XAA (Naeherung)
      def(0xBB, function (m) { this.a = this.x = this.sp = this.nz(rd(m) & this.sp); }, ABY, 4, true);
      const hi1 = (a) => (((a >> 8) + 1) & 0xFF);
      def(0x9C, function (m) { const a = this.addr(m); this.mem.write(a, this.y & hi1(a)); }, ABX, 5);
      def(0x9E, function (m) { const a = this.addr(m); this.mem.write(a, this.x & hi1(a)); }, ABY, 5);
      def(0x9F, function (m) { const a = this.addr(m); this.mem.write(a, this.a & this.x & hi1(a)); }, ABY, 5);
      def(0x93, function (m) { const a = this.addr(m); this.mem.write(a, this.a & this.x & hi1(a)); }, IZY, 6);
      def(0x9B, function (m) { const a = this.addr(m); this.sp = this.a & this.x; this.mem.write(a, this.sp & hi1(a)); }, ABY, 5);
      const fNOP = function (m) { this.addr(m); };
      [0x80, 0x82, 0x89, 0xC2, 0xE2].forEach((o) => def(o, fNOP, IMM, 2));
      [0x04, 0x44, 0x64].forEach((o) => def(o, fNOP, ZP, 3));
      [0x14, 0x34, 0x54, 0x74, 0xD4, 0xF4].forEach((o) => def(o, fNOP, ZPX, 4));
      def(0x0C, fNOP, ABS, 4);
      [0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC].forEach((o) => def(o, fNOP, ABX, 4, true));
      // JAM-Opcodes (ausser $02 = Trap)
      [0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xB2, 0xD2, 0xF2].forEach((o) =>
        def(o, function () { if (this.onJam) this.onJam((this.pc - 1) & 0xFFFF); }, IMP, 2));
    }
  }

  C64.CPU6510 = CPU6510;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
