/* kernal.js - KERNAL-Ersatz: ROM-Stubs mit Trap-Opcodes, Sprungtabelle, IRQ-Routine
   (Jiffy-Uhr, Cursor, Tastaturscan), Ein-/Ausgabekanaele, Systeminitialisierung */
(function (C64) {
  'use strict';
  const MAIN = 0xA7AE, SYSRET = 0xE130, USRRET = 0xE138;

  // Dekodiertabellen der Tastaturmatrix (Index = Spalte*8+Zeile)
  const ch = (s) => s.charCodeAt(0);
  const KEY_NORMAL = [20, 13, 29, 136, 133, 134, 135, 17, ch('3'), ch('W'), ch('A'), ch('4'), ch('Z'), ch('S'), ch('E'), 0,
    ch('5'), ch('R'), ch('D'), ch('6'), ch('C'), ch('F'), ch('T'), ch('X'), ch('7'), ch('Y'), ch('G'), ch('8'), ch('B'), ch('H'), ch('U'), ch('V'),
    ch('9'), ch('I'), ch('J'), ch('0'), ch('M'), ch('K'), ch('O'), ch('N'), ch('+'), ch('P'), ch('L'), ch('-'), ch('.'), ch(':'), ch('@'), ch(','),
    92, ch('*'), ch(';'), 19, 0, ch('='), 94, ch('/'), ch('1'), 95, 0, ch('2'), 32, 0, ch('Q'), 3];
  const KEY_SHIFT = [148, 141, 157, 140, 137, 138, 139, 145, ch('#'), 215, 193, ch('$'), 218, 211, 197, 0,
    ch('%'), 210, 196, ch('&'), 195, 198, 212, 216, ch("'"), 217, 199, ch('('), 194, 200, 213, 214,
    ch(')'), 201, 202, ch('0'), 205, 203, 207, 206, 219, 208, 204, 221, ch('>'), ch('['), 186, ch('<'),
    169, 192, ch(']'), 147, 0, ch('='), 222, ch('?'), ch('!'), 95, 0, ch('"'), 160, 0, 209, 131];
  const KEY_CBM = [148, 141, 157, 140, 137, 138, 139, 145, 150, 179, 176, 151, 173, 174, 177, 0,
    152, 178, 172, 153, 188, 187, 163, 189, 154, 183, 165, 155, 191, 180, 184, 190,
    ch(')'), 162, 181, ch('0'), 167, 161, 185, 170, 166, 175, 182, 220, ch('>'), ch('['), 164, ch('<'),
    168, 223, ch(']'), 147, 0, ch('='), 222, ch('?'), 129, 95, 0, 149, 160, 0, 171, 131];
  const KEY_CTRL = KEY_NORMAL.map((c) => (c >= 65 && c <= 90) ? c - 64 : 0);
  [[56, 144], [59, 5], [8, 28], [11, 159], [16, 156], [19, 30], [24, 31], [27, 158], [32, 18], [35, 146]].forEach((p) => { KEY_CTRL[p[0]] = p[1]; });
  const K_LSHIFT = 15, K_RSHIFT = 52, K_CTRL = 58, K_CBM = 61, K_STOP = 63;

  class Kernal {
    constructor(machine) {
      this.machine = machine;
      this.mem = machine.mem; this.ram = machine.mem.ram; this.cpu = machine.cpu;
      this.editor = new C64.ScreenEditor(machine.mem);
      this.keyboard = machine.keyboard;
      this.basic = null;
      this.traps = new Map();
      this.files = new Map();
      this.inFile = null; this.outFile = null;
      this.inputActive = false; this.lineBuf = null; this.lineIdx = 0;
      this.lastKey = 64; this.repeatDelay = 16; this.repeatCount = 4; this.lastMods = 0;
      this.printerLine = '';
      this.pendingIO = null;
      this.buildRoms();
      this.cpu.onTrap = (at) => this.trap(at);
      this.cpu.onJam = (at) => this.jam(at);
    }

    // ------------------------------------------------------------ ROM
    poke(addr, ...bytes) {
      for (const b of bytes) {
        if (addr >= 0xE000) this.mem.kernalRom[addr - 0xE000] = b; else this.mem.basicRom[addr - 0xA000] = b;
        addr++;
      }
    }
    def(addr, fn) { this.poke(addr, 0x02, 0x60); this.traps.set(addr, fn); }

    trap(at) {
      if (!this.mem.isRom(at)) return -1;
      const fn = this.traps.get(at);
      if (!fn) return -1;
      this.cpu.pc = (at + 1) & 0xFFFF;
      try {
        const r = fn.call(this, at);
        return r === undefined ? 24 : r;
      } catch (e) {
        if (e instanceof C64.BasicError) { this.basic.raise(e); this.enterBasic(); return 100; }
        throw e;
      }
    }

    jam(at) {
      // echter C64 friert hier ein; wir kehren nach BASIC zurueck
      this.basic.out('\r?ILLEGAL OPCODE AT ' + at);
      this.basic.ready();
      this.enterBasic();
    }

    /* CPU an die BASIC-Hauptschleife uebergeben */
    enterBasic() {
      this.cpu.sp = 0xFA; this.cpu.pc = MAIN; this.cpu.p &= ~0x0C;
      this.basic.inSys = false;
    }

    /* Ein-/Ausgabe-Trap: Fehler als Carry + Code in A */
    io(fn) {
      return function (at) {
        const cpu = this.cpu;
        try { const r = fn.call(this, at); cpu.p &= ~1; return r; }
        catch (e) {
          if (!(e instanceof C64.BasicError)) throw e;
          cpu.a = e.code; cpu.p |= 1; return 24;
        }
      };
    }

    buildRoms() {
      const cpu = this.cpu, ram = this.ram, ed = this.editor;
      this.mem.kernalRom.fill(0x60);
      this.mem.basicRom.fill(0x60);
      this.traps.clear();
      const setNZ = (v) => { cpu.nz(v & 0xFF); };

      // --- Reset-/Interrupt-Vektoren und echte 6502-Stubs
      this.poke(0xFFFA, 0x43, 0xFE, 0xE2, 0xFC, 0x48, 0xFF);
      this.poke(0xFF48, 0x48, 0x8A, 0x48, 0x98, 0x48, 0xBA, 0xBD, 0x04, 0x01, 0x29, 0x10, 0xF0, 0x03, 0x6C, 0x16, 0x03, 0x6C, 0x14, 0x03);
      this.poke(0xFE43, 0x78, 0x6C, 0x18, 0x03);
      this.poke(0xFE47, 0x02, 0x40);
      this.traps.set(0xFE47, function () { if (this.keyboard.isDown('STOP')) this.runStopRestore(); });
      this.poke(0xEA31, 0x02, 0x4C, 0x7E, 0xEA);
      this.traps.set(0xEA31, function () { this.irqService(); return 400; });
      this.poke(0xEA7E, 0xAD, 0x0D, 0xDC, 0x68, 0xA8, 0x68, 0xAA, 0x68, 0x40);
      this.poke(0xA000, 0x94, 0xE3, 0x7B, 0xE3, 0x43, 0x42, 0x4D, 0x42, 0x41, 0x53, 0x49, 0x43);
      this.poke(0xFF80, 0x03);

      // --- BASIC-Einsprungpunkte
      const main = function () { this.cpu.pc = MAIN; return this.basic.step(); };
      this.def(MAIN, function () {
        if (this.basic.inSys) { this.enterBasic(); this.basic.runFromML(); }
        return main.call(this);
      });
      const warm = function () { this.enterBasic(); this.basic.ready(); return 100; };
      [0xA480, 0xA474, 0xE37B, 0xA483, 0xE386].forEach((a) => this.def(a, warm));
      this.def(SYSRET, function () { this.basic.sysReturn(); this.cpu.pc = MAIN; });
      this.def(USRRET, function (at) { this.cpu.pc = at; return 2; });
      this.def(0xE394, function () { this.machine.reset(); return 100; });
      this.def(0xFCE2, function () { this.machine.reset(); return 100; });
      this.def(0xFE66, function () { this.runStopRestore(); return 100; });
      this.def(0xB248, function () { throw new C64.BasicError(14); });
      this.def(0xAF08, function () { throw new C64.BasicError(11); });
      this.def(0xA659, function () { this.basic.clr(); this.basic.tp = this.basic.txttab; this.basic.syncToZP(-1); });
      this.def(0xA65E, function () { this.basic.clr(); });
      this.def(0xA68E, function () { this.basic.tp = this.basic.txttab; this.basic.syncToZP(-1); });
      this.def(0xA533, function () { this.basic.relink(); });
      this.def(0xAB1E, function () {
        let a = cpu.a | (cpu.y << 8);
        for (let i = 0; i < 256; i++) { const c = this.mem.read(a++ & 0xFFFF); if (!c) break; this.chrout(c); }
      });
      this.def(0xBDCD, function () { this.basic.out(String((cpu.a << 8) | cpu.x)); });
      // Parameterauswertung fuer Maschinenprogramme (SYS adr,a,b ...)
      const withTp = (fn) => function () { const b = this.basic; b.syncFromZP(); fn.call(this, b); b.syncToZP(0); };
      this.def(0xAEFD, withTp((b) => b.expect(44)));
      this.def(0xAEFA, withTp((b) => b.expect(40)));
      this.def(0xAEF7, withTp((b) => b.expect(41)));
      this.def(0xB79E, withTp((b) => { cpu.x = b.byteExpr(); }));
      this.def(0xB79B, withTp((b) => { b.tp++; cpu.x = b.byteExpr(); }));
      this.def(0xAD8A, withTp((b) => { b.setFac(b.numExpr()); }));
      this.def(0xAD9E, withTp((b) => { const v = b.expr(); b.facValue = v; if (typeof v === 'number') b.setFac(v); }));
      const getAdr = (b) => { const v = b.toAddr(b.getFac()); ram[0x14] = v & 0xFF; ram[0x15] = v >> 8; cpu.y = v & 0xFF; cpu.a = v >> 8; };
      this.def(0xB7F7, function () { getAdr(this.basic); });
      this.def(0xB7EB, withTp((b) => { b.setFac(b.numExpr()); getAdr(b); b.expect(44); cpu.x = b.byteExpr(); }));
      this.def(0xB1AA, function () { const v = this.basic.toInt16(this.basic.getFac()) & 0xFFFF; cpu.y = v & 0xFF; cpu.a = v >> 8; ram[0x64] = v >> 8; ram[0x65] = v & 0xFF; });
      this.def(0xB1BF, function () { const v = this.basic.toInt16(this.basic.getFac()) & 0xFFFF; ram[0x64] = v >> 8; ram[0x65] = v & 0xFF; });
      this.def(0xB391, function () { let v = cpu.y | (cpu.a << 8); if (v & 0x8000) v -= 65536; this.basic.setFac(v); });
      this.def(0xB3A2, function () { this.basic.setFac(cpu.y); });

      // --- KERNAL-Sprungtabelle (vektorisierte Routinen als echte JMP (vec))
      const vec = (entry, v, target, fn) => { this.poke(entry, 0x6C, v & 0xFF, v >> 8); this.def(target, fn); };
      vec(0xFFC0, 0x031A, 0xF34A, this.io(function () { this.open(ram[0xB8], ram[0xBA], ram[0xB9], this.fileName()); }));
      vec(0xFFC3, 0x031C, 0xF291, this.io(function () { this.close(cpu.a); }));
      vec(0xFFC6, 0x031E, 0xF20E, this.io(function () { this.chkin(cpu.x); }));
      vec(0xFFC9, 0x0320, 0xF250, this.io(function () { this.chkout(cpu.x); }));
      vec(0xFFCC, 0x0322, 0xF333, function () { this.clrchn(); });
      vec(0xFFCF, 0x0324, 0xF157, function (at) {
        if (ram[0x99] === 0) {
          if (!this.lineBuf) {
            const line = this.pollLine(false);
            if (!line) { cpu.pc = at; return 300; }
            line.push(13); this.lineBuf = line; this.lineIdx = 0;
          }
          cpu.a = this.lineBuf[this.lineIdx++];
          if (this.lineIdx >= this.lineBuf.length) this.lineBuf = null;
        } else cpu.a = this.readByte();
        setNZ(cpu.a); cpu.p &= ~1;
      });
      const chroutTrap = function () { this.chrout(cpu.a); cpu.p &= ~1; return 120; };
      vec(0xFFD2, 0x0326, 0xF1CA, chroutTrap);
      this.def(0xE716, function () { ed.chrout(cpu.a); cpu.p &= ~1; return 120; });
      vec(0xFFE1, 0x0328, 0xF6ED, function () {
        const s = this.keyboard.isDown('STOP');
        cpu.a = s ? 0x7F : 0xFF;
        cpu.p = s ? (cpu.p | 0x03) : (cpu.p & ~0x02);
        if (s) { this.clrchn(); ram[0xC6] = 0; }
      });
      vec(0xFFE4, 0x032A, 0xF13E, function () {
        if (ram[0x99] === 0) { const k = this.getKey(); cpu.a = k < 0 ? 0 : k; } else cpu.a = this.readByte();
        setNZ(cpu.a); cpu.p &= ~1;
      });
      vec(0xFFE7, 0x032C, 0xF32F, function () { this.clall(); });

      this.def(0xFF81, function () { this.screenInit(); });
      this.def(0xFF5B, function () { this.screenInit(); });
      this.def(0xE518, function () { this.screenInit(); });
      this.def(0xFF84, function () { this.ioInit(); });
      this.def(0xFF87, function () { });
      this.def(0xFF8A, function () { this.restoreVectors(); });
      this.def(0xFF8D, function () { });
      this.def(0xFF90, function () { ram[0x9D] = cpu.a; });
      this.def(0xFF99, function () { if (cpu.p & 1) { cpu.x = ram[0x283]; cpu.y = ram[0x284]; } else { ram[0x283] = cpu.x; ram[0x284] = cpu.y; } });
      this.def(0xFF9C, function () { if (cpu.p & 1) { cpu.x = ram[0x281]; cpu.y = ram[0x282]; } else { ram[0x281] = cpu.x; ram[0x282] = cpu.y; } });
      this.def(0xFF9F, function () { this.scnkey(); });
      this.def(0xEA87, function () { this.scnkey(); });
      this.def(0xFFB7, function () { cpu.a = ram[0x90]; setNZ(cpu.a); });
      this.def(0xFFBA, function () { ram[0xB8] = cpu.a; ram[0xBA] = cpu.x; ram[0xB9] = cpu.y; });
      this.def(0xFFBD, function () { ram[0xB7] = cpu.a; ram[0xBB] = cpu.x; ram[0xBC] = cpu.y; });
      this.def(0xFFD5, this.io(function (at) {      // LOAD
        if (!this.pendingIO) {
          const verify = cpu.a !== 0, dest = cpu.x | (cpu.y << 8);
          const r = this.fetchFile(this.fileName(), ram[0xBA]);
          this.pendingIO = { done: false, result: null, verify: verify, dest: dest };
          const p = this.pendingIO;
          Promise.resolve(r).then((v) => { p.result = v; p.done = true; }, () => { p.done = true; });
        }
        const p = this.pendingIO;
        if (!p.done) { cpu.pc = at; return 500; }
        this.pendingIO = null;
        if (!p.result || p.result.bytes.length < 2) throw new C64.BasicError(4);
        const b = p.result.bytes;
        const addr = ram[0xB9] === 0 ? p.dest : (b[0] | (b[1] << 8));
        const end = this.copyToRam(b, addr, p.verify);
        ram[0x90] = end < 0 ? 0x10 : 0;
        const e = end < 0 ? addr + b.length - 2 : end;
        cpu.x = e & 0xFF; cpu.y = (e >> 8) & 0xFF; ram[0xAE] = cpu.x; ram[0xAF] = cpu.y;
        return 2000;
      }));
      this.def(0xFFD8, this.io(function () {       // SAVE
        const start = ram[cpu.a] | (ram[(cpu.a + 1) & 0xFF] << 8), end = cpu.x | (cpu.y << 8);
        this.saveFile(this.fileName(), ram[0xBA], start, end);
        return 2000;
      }));
      this.def(0xFFDB, function () { ram[0xA2] = cpu.a; ram[0xA1] = cpu.x; ram[0xA0] = cpu.y; });
      this.def(0xFFDE, function () { cpu.a = ram[0xA2]; cpu.x = ram[0xA1]; cpu.y = ram[0xA0]; });
      this.def(0xFFEA, function () { this.udtim(); });
      this.def(0xFFED, function () { cpu.x = 40; cpu.y = 25; });
      const plot = function () { if (cpu.p & 1) { cpu.x = ed.row; cpu.y = ed.col; } else { ed.hideCursor(); ed.row = Math.min(cpu.x, 24); ed.col = Math.min(cpu.y, 39); } };
      this.def(0xFFF0, plot); this.def(0xE50A, plot);
      this.def(0xFFF3, function () { cpu.x = 0x00; cpu.y = 0xDC; });
      this.def(0xE544, function () { ed.hideCursor(); ed.clear(); });
      this.def(0xE566, function () { ed.hideCursor(); ed.row = 0; ed.col = 0; });
      this.def(0xE56C, function () { ed.row = ed.row; });
      this.def(0xE8EA, function () { ed.scroll(); });
      this.def(0xE9FF, function () { ed.clearRow(Math.min(cpu.x, 24)); });
    }

    // ------------------------------------------------------------ Initialisierung
    restoreVectors() {
      const v = [0xEA31, 0xFE66, 0xFE47, 0xF34A, 0xF291, 0xF20E, 0xF250, 0xF333, 0xF157, 0xF1CA, 0xF6ED, 0xF13E, 0xF32F, 0xFE66, 0xF4A5, 0xF5ED];
      v.forEach((a, i) => { this.ram[0x314 + i * 2] = a & 0xFF; this.ram[0x315 + i * 2] = a >> 8; });
    }

    ioInit() {
      const m = this.machine, mem = this.mem;
      mem.write(0, 0x2F); mem.write(1, 0x37);
      m.cia1.reset(); m.cia2.reset();
      m.cia1.write(0x2, 0xFF); m.cia1.write(0x3, 0x00); m.cia1.write(0x0, 0x7F);
      m.cia1.write(0x4, 0x25); m.cia1.write(0x5, 0x40);
      m.cia1.write(0xD, 0x7F); m.cia1.write(0xD, 0x81); m.cia1.write(0xE, 0x11);
      m.cia2.write(0x2, 0x3F); m.cia2.write(0x0, 0x97);
      for (let i = 0; i < 25; i++) m.sid.write(i, 0);
    }

    screenInit() {
      const vic = this.machine.vic, ram = this.ram;
      const init = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1B, 0, 0, 0, 0, 0xC8, 0, 0x14, 0x0F, 0, 0, 0, 0, 0, 0,
        14, 6, 1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 6, 7];
      init.forEach((v, i) => vic.write(i, v));
      vic.write(0x19, 0x0F);
      ram[0x288] = 0x04; ram[0x286] = 14; ram[0xC7] = 0; ram[0xD4] = 0; ram[0xD8] = 0;
      ram[0xCC] = 1; ram[0xCF] = 0; ram[0xCD] = 1;
      ram[0x289] = 10; ram[0x28A] = 0; ram[0x28B] = 4; ram[0x28C] = 16; ram[0x291] = 0;
      ram[0xC6] = 0; ram[0xC5] = 64; ram[0xCB] = 64; ram[0x28D] = 0;
      ram[0x9A] = 3; ram[0x99] = 0;
      this.editor.clear();
    }

    /* Kaltstart: Systemvariablen, Vektoren, CHRGET-Routine */
    reset() {
      const ram = this.ram;
      this.files.clear(); this.inFile = this.outFile = null;
      this.inputActive = false; this.lineBuf = null; this.pendingIO = null;
      this.lastKey = 64;
      this.ioInit();
      this.restoreVectors();
      const w16 = (a, v) => { ram[a] = v & 0xFF; ram[a + 1] = v >> 8; };
      [0xE38B, 0xA483, 0xA57C, 0xA71A, 0xA7E4, 0xAE86].forEach((v, i) => w16(0x300 + i * 2, v));
      ram[0x310] = 0x4C; w16(0x311, 0xB248);
      w16(0x281, 0x0800); w16(0x283, 0xA000);
      w16(0x2B, 0x0801); w16(0x37, 0xA000); w16(0x33, 0xA000);
      ram[0x90] = 0; ram[0x91] = 0xFF; ram[0x9D] = 0x80;
      ram[0xA0] = ram[0xA1] = ram[0xA2] = 0;
      // CHRGET/CHRGOT ($0073)
      [0xE6, 0x7A, 0xD0, 0x02, 0xE6, 0x7B, 0xAD, 0x00, 0x08, 0xC9, 0x3A, 0xB0, 0x0A, 0xC9, 0x20, 0xF0, 0xEF, 0x38, 0xE9, 0x30, 0x38, 0xE9, 0xD0, 0x60]
        .forEach((b, i) => { ram[0x73 + i] = b; });
      ram[0x800] = 0;
      this.screenInit();
    }

    runStopRestore() {
      this.ioInit();
      this.restoreVectors();
      this.clrchn();
      this.screenInit();
      this.enterBasic();
      this.basic.ready();
    }

    // ------------------------------------------------------------ IRQ-Dienst
    udtim() {
      const ram = this.ram;
      let t = ((ram[0xA0] << 16) | (ram[0xA1] << 8) | ram[0xA2]) + 1;
      if (t >= 5184000) t = 0;
      ram[0xA0] = t >> 16; ram[0xA1] = (t >> 8) & 0xFF; ram[0xA2] = t & 0xFF;
      ram[0x91] = this.keyboard.isDown('STOP') ? 0x7F : 0xFF;
    }

    irqService() {
      this.udtim();
      this.editor.blink();
      this.scnkey();
    }

    enqueue(c) {
      const ram = this.ram;
      if (ram[0xC6] < ram[0x289]) { ram[0x277 + ram[0xC6]] = c; ram[0xC6]++; }
    }

    getKey() {
      const ram = this.ram, n = ram[0xC6];
      if (!n) return -1;
      const k = ram[0x277];
      ram.copyWithin(0x277, 0x278, 0x277 + n);
      ram[0xC6] = n - 1;
      return k;
    }

    scnkey() {
      const ram = this.ram, mx = this.keyboard.matrix;
      const pq = this.keyboard.pasteQueue;
      if (pq.length && ram[0xC6] === 0) { for (let i = 0; i < 8 && pq.length; i++) this.enqueue(pq.shift()); }
      let key = 64, mods = 0;
      for (let i = 0; i < 64; i++) {
        if (!((mx[i >> 3] >> (i & 7)) & 1)) continue;
        if (i === K_LSHIFT || i === K_RSHIFT) mods |= 1;
        else if (i === K_CBM) mods |= 2;
        else if (i === K_CTRL) mods |= 4;
        else key = i;
      }
      ram[0x28D] = mods; ram[0xCB] = key;
      if ((mods & 3) === 3 && (this.lastMods & 3) !== 3 && !(ram[0x291] & 0x80)) {
        const vic = this.machine.vic;
        vic.write(0x18, vic.regs[0x18] ^ 2);
      }
      this.lastMods = mods;
      const tables = (md) => (md & 4) ? KEY_CTRL : (md & 2) ? KEY_CBM : (md & 1) ? KEY_SHIFT : KEY_NORMAL;
      // neue Anschlaege kommen als Ereignisse von der Tastatur, die Matrix dient der Wiederholung
      const strokes = this.keyboard.strokes;
      if (strokes.length) {
        while (strokes.length) {
          const s = strokes.shift(), sc = tables(s.mods)[s.key];
          if (sc) this.enqueue(sc);
          this.lastKey = s.key;
        }
        ram[0xC5] = this.lastKey;
        this.repeatDelay = 16; this.repeatCount = 4;
        return;
      }
      if (key === 64) { ram[0xC5] = 64; this.lastKey = 64; return; }
      const c = tables(mods)[key];
      if (key !== this.lastKey) { this.lastKey = key; ram[0xC5] = key; this.repeatDelay = 16; this.repeatCount = 4; return; }
      const rp = ram[0x28A];
      const repeatable = (rp & 0x80) || (!(rp & 0x40) && (c === 32 || c === 20 || c === 148 || c === 17 || c === 145 || c === 29 || c === 157));
      if (!repeatable || !c) return;
      if (this.repeatDelay > 0) { this.repeatDelay--; return; }
      if (--this.repeatCount > 0) return;
      this.repeatCount = 4;
      if (ram[0xC6] === 0) this.enqueue(c);
    }

    /* Zeileneingabe ueber den Bildschirmeditor; liefert PETSCII-Array oder null (noch nicht fertig) */
    pollLine(wholeLine) {
      const ed = this.editor;
      if (!this.inputActive) { this.inputActive = true; ed.startInput(wholeLine); }
      ed.cursorOn();
      for (let n = 0; n < 16; n++) {
        const k = this.getKey();
        if (k < 0) return null;
        if (k === 13) { this.inputActive = false; return ed.endInput(); }
        if (k === 3 || k === 131) continue;
        ed.chrout(k);
      }
      return null;
    }

    cancelInput() { this.inputActive = false; this.lineBuf = null; this.editor.cursorOff(); }

    // ------------------------------------------------------------ Kanaele und Dateien
    fileName() {
      const ram = this.ram;
      let s = '';
      const a = ram[0xBB] | (ram[0xBC] << 8);
      for (let i = 0; i < ram[0xB7]; i++) s += String.fromCharCode(this.mem.read((a + i) & 0xFFFF));
      return s;
    }

    /* "NAME,S,W" -> {name, type, mode}; entfernt @ und Laufwerksnummer */
    parseName(raw) {
      let s = C64.petscii.toAscii(raw);
      s = s.replace(/^@/, '').replace(/^[0-9]?:/, '');
      const p = s.split(',');
      return { name: p[0], type: (p[1] || '').charAt(0), mode: (p[2] || '').charAt(0) };
    }

    diskCommand(cmd) {
      const st = C64.storage;
      const m = /^([A-Z])[0-9]?:?(.*)$/.exec(C64.petscii.toAscii(cmd).trim());
      if (!m) return;
      if (m[1] === 'S') { m[2].split(',').forEach((n) => { let k; while ((k = st.find(n))) st.remove(k); }); }
      else if (m[1] === 'R') {
        const p = m[2].split('=');
        const d = p[1] && st.get(p[1]);
        if (d) { st.put(p[0], d); st.remove(p[1]); }
      }
    }

    open(lfn, dev, sa, rawName) {
      if (this.files.has(lfn)) throw new C64.BasicError(2);
      if (this.files.size >= 10) throw new C64.BasicError(1);
      const f = { lfn: lfn, dev: dev, sa: sa & 15, name: '', write: false, data: [], pos: 0, cmd: false };
      if (dev >= 8 && dev <= 11) {
        const st = C64.storage;
        if (f.sa === 15) {
          f.cmd = true; f.cmdBuf = '';
          if (rawName) this.diskCommand(rawName);
          f.data = Array.from('00, OK,00,00\r').map((c) => c.charCodeAt(0));
        } else {
          const n = this.parseName(rawName);
          if (!n.name) throw new C64.BasicError(8);
          f.name = n.name;
          if (n.mode === 'W' || n.mode === 'A' || (!n.mode && f.sa === 1)) {
            f.write = true;
            if (n.mode === 'A') { const old = st.get(n.name); if (old) f.data = Array.from(old); }
          } else if (n.name === '$') f.data = Array.from(st.directory());
          else {
            const key = st.find(n.name);
            if (!key) throw new C64.BasicError(4);
            f.data = Array.from(st.get(key));
          }
        }
      } else if (dev === 4) f.write = true;
      else if (dev !== 0 && dev !== 3) throw new C64.BasicError(5);
      this.files.set(lfn, f);
    }

    close(lfn) {
      const f = this.files.get(lfn);
      if (!f) return;
      if (f.dev >= 8 && f.write) C64.storage.put(f.name, Uint8Array.from(f.data));
      if (f.dev === 4 && this.printerLine) { console.log('[C64-Drucker] ' + this.printerLine); this.printerLine = ''; }
      if (this.inFile === f || this.outFile === f) this.clrchn();
      this.files.delete(lfn);
    }

    clall() { for (const lfn of Array.from(this.files.keys())) this.close(lfn); this.clrchn(); }

    chkin(lfn) {
      const f = this.files.get(lfn);
      if (!f) throw new C64.BasicError(3);
      if (f.write && !f.cmd && f.dev !== 0) throw new C64.BasicError(6);
      this.inFile = f; this.ram[0x99] = f.dev;
    }
    chkout(lfn) {
      const f = this.files.get(lfn);
      if (!f) throw new C64.BasicError(3);
      if (f.dev === 0 || (f.dev >= 8 && !f.write && !f.cmd)) throw new C64.BasicError(7);
      this.outFile = f; this.ram[0x9A] = f.dev;
    }
    clrchn() { this.inFile = this.outFile = null; this.ram[0x99] = 0; this.ram[0x9A] = 3; }

    chrout(c) {
      const dev = this.ram[0x9A], f = this.outFile;
      if (dev === 3 || !f) { this.editor.chrout(c); return; }
      if (dev === 4) {
        if (c === 13) { console.log('[C64-Drucker] ' + this.printerLine); this.printerLine = ''; }
        else this.printerLine += C64.petscii.toAscii(String.fromCharCode(c));
      } else if (f.cmd) {
        if (c === 13) { this.diskCommand(f.cmdBuf); f.cmdBuf = ''; } else f.cmdBuf += String.fromCharCode(c);
      } else f.data.push(c & 0xFF);
    }

    readByte() {
      const f = this.inFile, ram = this.ram;
      if (!f) return 13;
      if (f.pos >= f.data.length) {
        if (f.cmd) { f.pos = 0; }
        else { ram[0x90] |= 0x42; return 13; }
      }
      const b = f.data[f.pos++];
      if (f.pos >= f.data.length) ram[0x90] |= 0x40;
      return b;
    }

    /* Datei holen: {name, bytes} | null, bei Geraet 1 ein Promise (Datei-Dialog) */
    fetchFile(rawName, dev) {
      const st = C64.storage;
      if (dev === 1 || dev === 7) return st.upload();
      if (dev < 8 || dev > 11) throw new C64.BasicError(dev === 0 || dev === 3 ? 9 : 5);
      const n = this.parseName(rawName);
      if (!n.name) throw new C64.BasicError(8);
      if (n.name === '$') return { name: '$', bytes: st.directory() };
      const key = st.find(n.name);
      return key ? { name: key, bytes: st.get(key) } : null;
    }

    /* PRG-Daten (mit 2 Byte Ladeadresse) ins RAM; liefert Endadresse, bei VERIFY-Fehler -1 */
    copyToRam(bytes, addr, verify) {
      const ram = this.ram;
      let a = addr;
      for (let i = 2; i < bytes.length; i++, a++) {
        if (verify) { if (ram[a & 0xFFFF] !== bytes[i]) return -1; } else ram[a & 0xFFFF] = bytes[i];
      }
      return a & 0xFFFF;
    }

    saveFile(rawName, dev, start, end) {
      const n = this.parseName(rawName);
      const len = Math.max(0, end - start);
      const bytes = new Uint8Array(len + 2);
      bytes[0] = start & 0xFF; bytes[1] = start >> 8;
      bytes.set(this.ram.subarray(start, start + len), 2);
      if (dev === 1 || dev === 7) { C64.storage.download(n.name, bytes); return; }
      if (dev < 8 || dev > 11) throw new C64.BasicError(dev === 0 || dev === 3 ? 9 : 5);
      if (!n.name) throw new C64.BasicError(8);
      C64.storage.put(n.name, bytes);
    }
  }

  Kernal.MAIN = MAIN; Kernal.SYSRET = SYSRET; Kernal.USRRET = USRRET;
  C64.Kernal = Kernal;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
