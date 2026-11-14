/* basic.js - BASIC-V2-Interpreter. Arbeitet auf dem tokenisierten Programm im emulierten RAM
   (ab $0801, echtes PRG-Format). Wird ueber einen ROM-Trap aus der CPU-Schleife getaktet. */
(function (C64) {
  'use strict';
  const T = C64.basicTokens.T;
  const MSG = [null, 'TOO MANY FILES', 'FILE OPEN', 'FILE NOT OPEN', 'FILE NOT FOUND', 'DEVICE NOT PRESENT',
    'NOT INPUT FILE', 'NOT OUTPUT FILE', 'MISSING FILE NAME', 'ILLEGAL DEVICE NUMBER', 'NEXT WITHOUT FOR', 'SYNTAX',
    'RETURN WITHOUT GOSUB', 'OUT OF DATA', 'ILLEGAL QUANTITY', 'OVERFLOW', 'OUT OF MEMORY', "UNDEF'D STATEMENT",
    'BAD SUBSCRIPT', "REDIM'D ARRAY", 'DIVISION BY ZERO', 'ILLEGAL DIRECT', 'TYPE MISMATCH', 'STRING TOO LONG',
    'FILE DATA', 'FORMULA TOO COMPLEX', "CAN'T CONTINUE", "UNDEF'D FUNCTION", 'VERIFY', 'LOAD'];
  const E = { NEXT: 10, SYNTAX: 11, RETURN: 12, DATA: 13, QUANTITY: 14, OVERFLOW: 15, MEMORY: 16, UNDEF: 17, SUBSCRIPT: 18,
    REDIM: 19, DIVZERO: 20, DIRECT: 21, TYPE: 22, STRLEN: 23, CONT: 26, UNDEFFN: 27, VERIFY: 28 };

  class BasicError extends Error {
    constructor(code) { super(MSG[code] || 'SYNTAX'); this.code = code; }
  }
  const err = (c) => { throw new BasicError(c); };
  const isDigit = (c) => c >= 48 && c <= 57;
  const isAlpha = (c) => c >= 65 && c <= 90;
  const MAXNUM = 1.70141183e38;

  /* Zahl wie auf dem C64 ausgeben (9 signifikante Stellen) */
  function fmt(x) {
    if (x === 0) return ' 0';
    const sign = x < 0 ? '-' : ' ';
    const a = Math.abs(x);
    let s;
    if (a < 1e9 && a >= 0.01) {
      s = a.toPrecision(9);
      if (s.indexOf('e') < 0) {
        if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
        if (s.charAt(0) === '0' && s.length > 1) s = s.substr(1);
        return sign + s;
      }
    }
    s = a.toExponential(8);
    const p = s.split('e');
    let mant = p[0].replace(/0+$/, '').replace(/\.$/, '');
    const ex = parseInt(p[1], 10);
    return sign + mant + 'E' + (ex < 0 ? '-' : '+') + (Math.abs(ex) < 10 ? '0' : '') + Math.abs(ex);
  }

  /* Zahl ab b[i] lesen (Leerzeichen werden ueberlesen). Liefert {v, i, n} (n = Anzahl Ziffern) */
  function scanNum(b, i, signed) {
    const sp = () => { while (b[i] === 32) i++; };
    let neg = false, s = '', n = 0, c;
    sp();
    if (signed) {
      if (b[i] === 43 || b[i] === T.PLUS) i++;
      else if (b[i] === 45 || b[i] === T.MINUS) { neg = true; i++; }
    }
    for (sp(); isDigit(c = b[i]); sp()) { s += String.fromCharCode(c); n++; i++; }
    if (b[i] === 46) {
      i++; s += '.';
      for (sp(); isDigit(c = b[i]); sp()) { s += String.fromCharCode(c); n++; i++; }
    }
    if (n && b[i] === 69) {
      let j = i + 1, es = '', ed = '';
      while (b[j] === 32) j++;
      if (b[j] === 43 || b[j] === T.PLUS) j++;
      else if (b[j] === 45 || b[j] === T.MINUS) { es = '-'; j++; }
      for (; isDigit(b[j]) || b[j] === 32; j++) if (b[j] !== 32) ed += String.fromCharCode(b[j]);
      s += 'E' + es + (ed || '0'); i = j;
    }
    let v = n ? parseFloat(s) : 0;
    if (!isFinite(v) || v > MAXNUM) err(E.OVERFLOW);
    return { v: neg ? -v : v, i: i, n: n };
  }
  function strBytes(s) { const b = []; for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i)); b.push(0); return b; }

  class Basic {
    constructor(machine) {
      this.machine = machine; this.mem = machine.mem; this.m = machine.mem.ram;
      this.cpu = machine.cpu; this.kernal = machine.kernal;
      this.vars = new Map(); this.arrays = new Map(); this.fns = new Map();
      this.stack = [];
      this.tp = 0x0801; this.curLine = -1;
      this.state = 'input'; this.pending = null; this.skipEnd = false;
      this.cont = null; this.dataPtr = 0; this.cmdLfn = null;
      this.inSys = false; this.cost = 0; this.ticked = 0; this.facValue = 0;
      this.seed = 0x2545F491;
    }

    // ---------------------------------------------------------- Zeiger
    get txttab() { return this.m[0x2B] | (this.m[0x2C] << 8); }
    get vartab() { return this.m[0x2D] | (this.m[0x2E] << 8); }
    set vartab(v) { const m = this.m; m[0x2D] = m[0x2F] = m[0x31] = v & 0xFF; m[0x2E] = m[0x30] = m[0x32] = v >> 8; }
    get memsiz() { return this.m[0x37] | (this.m[0x38] << 8); }
    syncToZP(d) { const t = this.tp + d; this.m[0x7A] = t & 0xFF; this.m[0x7B] = t >> 8; const l = this.curLine < 0 ? 0xFFFF : this.curLine; this.m[0x39] = l & 0xFF; this.m[0x3A] = l >> 8; }
    syncFromZP() { this.tp = this.m[0x7A] | (this.m[0x7B] << 8); }

    out(s) {
      const k = this.kernal;
      for (let i = 0; i < s.length; i++) k.chrout(s.charCodeAt(i));
      this.cost += s.length * 110;
    }

    // ---------------------------------------------------------- Start / Zustaende
    coldStart() {
      const m = this.m;
      m[this.txttab - 1] = 0;
      this.newProgram();
      this.out('\r    **** COMMODORE 64 BASIC V2 ****\r\r 64K RAM SYSTEM  ' + (this.memsiz - this.vartab + 2) + ' BASIC BYTES FREE\r');
      this.ready();
    }

    newProgram() {
      const m = this.m, t = this.txttab;
      m[t] = 0; m[t + 1] = 0;
      this.vartab = t + 2;
      this.clr();
    }

    clr() {
      this.vars.clear(); this.arrays.clear(); this.fns.clear();
      this.stack.length = 0; this.dataPtr = 0; this.cont = null;
      const ms = this.memsiz; this.m[0x33] = ms & 0xFF; this.m[0x34] = ms >> 8;
      this.vartab = this.vartab;
    }

    ready() {
      this.state = 'input'; this.pending = null; this.skipEnd = false; this.cmdLfn = null;
      this.kernal.cancelInput();
      this.kernal.clrchn();
      this.out('\rREADY.\r');
    }

    raise(e) {
      this.kernal.cancelInput();
      this.kernal.clrchn();
      this.out('\r?' + e.message + '  ERROR' + (this.curLine >= 0 ? ' IN ' + this.curLine : ''));
      this.ready();
    }

    runFromML() { this.syncFromZP(); this.state = 'exec'; this.pending = null; }

    sysReturn() {
      const m = this.m, cpu = this.cpu;
      m[0x30C] = cpu.a; m[0x30D] = cpu.x; m[0x30E] = cpu.y; m[0x30F] = cpu.p;
      cpu.p &= ~0x0C;
      this.syncFromZP();
      this.inSys = false;
    }

    /* ein Schritt der Hauptschleife; liefert verbrauchte Taktzyklen */
    step() {
      this.cost = 60; this.ticked = 0;
      try {
        if (this.state === 'input') {
          const line = this.kernal.pollLine(true);
          if (line) this.handleLine(line);
          return this.cost + 240;
        }
        if (this.m[0x91] === 0x7F) { this.doBreak(); return this.cost; }
        if (this.pending) {
          const p = this.pending;
          if (!p()) return this.cost + 200;
          if (this.pending === p) this.pending = null;
          if (!this.skipEnd && this.state === 'exec') this.endStatement();
          this.skipEnd = false;
          return this.cost;
        }
        this.statement();
      } catch (e) {
        if (e instanceof BasicError) this.raise(e);
        else if (e instanceof RangeError) this.raise(new BasicError(E.MEMORY));
        else throw e;
      }
      return this.cost;
    }

    doBreak() {
      this.m[0xC6] = 0;
      if (this.curLine >= 0) this.cont = { tp: this.tp, line: this.curLine };
      this.kernal.cancelInput(); this.kernal.clrchn();
      this.out('\rBREAK' + (this.curLine >= 0 ? ' IN ' + this.curLine : ''));
      this.ready();
    }

    // ---------------------------------------------------------- Programmtext
    findLine(num) {
      const m = this.m;
      let a = this.txttab;
      for (;;) {
        const link = m[a] | (m[a + 1] << 8);
        if (!link) return { a: a, exact: false };
        const n = m[a + 2] | (m[a + 3] << 8);
        if (n >= num) return { a: a, exact: n === num };
        if (link <= a) return { a: a, exact: false };
        a = link;
      }
    }

    relink() {
      const m = this.m;
      let a = this.txttab;
      while (m[a] | m[a + 1]) {
        let p = a + 4;
        while (m[p] && p < 0xFFFF) p++;
        const next = p + 1;
        m[a] = next & 0xFF; m[a + 1] = next >> 8;
        a = next;
        if (a > 0xFFF0) break;
      }
      return a + 2;
    }

    storeLine(num, toks) {
      const m = this.m;
      let f = this.findLine(num);
      if (f.exact) {
        const next = m[f.a] | (m[f.a + 1] << 8), end = this.vartab;
        m.copyWithin(f.a, next, end);
        this.vartab = end - (next - f.a);
      }
      if (toks.length) {
        const len = toks.length + 5, end = this.vartab;
        if (end + len >= this.memsiz) err(E.MEMORY);
        m.copyWithin(f.a + len, f.a, end);
        m[f.a] = 1; m[f.a + 1] = 1; m[f.a + 2] = num & 0xFF; m[f.a + 3] = num >> 8;
        for (let i = 0; i < toks.length; i++) m[f.a + 4 + i] = toks[i];
        m[f.a + 4 + toks.length] = 0;
        this.vartab = end + len;
      }
      this.relink();
      this.clr();
    }

    handleLine(line) {
      const m = this.m;
      let i = 0;
      while (line[i] === 32) i++;
      if (i >= line.length) return;
      if (isDigit(line[i])) {
        let num = 0;
        for (; isDigit(line[i]) || line[i] === 32; i++) {
          if (line[i] === 32) { if (!isDigit(line[i + 1])) break; continue; }
          num = num * 10 + line[i] - 48;
          if (num > 63999) err(E.SYNTAX);
        }
        while (line[i] === 32) i++;
        this.curLine = -1;
        this.storeLine(num, C64.basicTokens.tokenize(line.slice(i)));
        return;
      }
      const toks = C64.basicTokens.tokenize(line.slice(i));
      this.curLine = -1;
      if (toks.length > 250) err(E.STRLEN);
      for (let k = 0; k < toks.length; k++) m[0x200 + k] = toks[k];
      m[0x200 + toks.length] = 0; m[0x201 + toks.length] = 0; m[0x202 + toks.length] = 0;
      this.tp = 0x200;
      this.state = 'exec';
    }

    // ---------------------------------------------------------- Lexer-Helfer
    peekc() { const m = this.m; while (m[this.tp] === 32) this.tp++; return m[this.tp]; }
    expect(c) { if (this.peekc() !== c) err(E.SYNTAX); this.tp++; }
    atEnd() { const c = this.peekc(); return c === 0 || c === 58; }
    endStatement() { if (!this.atEnd()) err(E.SYNTAX); }

    linenum() {
      const m = this.m;
      let n = 0;
      while (isDigit(this.peekc())) {
        n = n * 10 + m[this.tp++] - 48;
        if (n > 63999) err(E.SYNTAX);
      }
      return n;
    }

    skipStatement(p) {
      const m = this.m;
      let q = false;
      for (; ; p++) {
        const c = m[p];
        if (c === 0) return p;
        if (c === 34) q = !q;
        else if (!q && c === 58) return p;
        else if (!q && c === T.REM) { while (m[p]) p++; return p; }
      }
    }

    parseName() {
      let c = this.peekc();
      if (!isAlpha(c)) err(E.SYNTAX);
      let name = String.fromCharCode(c);
      this.tp++;
      for (; ;) {
        c = this.peekc();
        if (!isAlpha(c) && !isDigit(c)) break;
        if (name.length < 2) name += String.fromCharCode(c);
        this.tp++;
      }
      if (c === 37) { name += '%'; this.tp++; } else if (c === 36) { name += '$'; this.tp++; }
      return name;
    }

    // ---------------------------------------------------------- Variablen
    dim(name, dims) {
      let total = 1;
      for (const d of dims) total *= d + 1;
      if (total * (name.endsWith('%') ? 2 : name.endsWith('$') ? 3 : 5) > 40000) err(E.MEMORY);
      const arr = { dims: dims, data: new Array(total).fill(name.endsWith('$') ? '' : 0) };
      this.arrays.set(name, arr);
      return arr;
    }

    indexList() {
      const idx = [];
      do {
        const v = Math.floor(this.numExpr());
        if (v < 0 || v > 32767) err(E.QUANTITY);
        idx.push(v);
      } while (this.peekc() === 44 && ++this.tp);
      this.expect(41);
      return idx;
    }

    ref() {
      const name = this.parseName();
      const last = name.charAt(name.length - 1);
      const t = last === '$' || last === '%' ? last : '';
      if (this.peekc() !== 40) return { a: null, k: name, t: t };
      this.tp++;
      const idx = this.indexList();
      let arr = this.arrays.get(name);
      if (!arr) arr = this.dim(name, idx.map(() => 10));
      if (idx.length !== arr.dims.length) err(E.SUBSCRIPT);
      let flat = 0;
      for (let d = 0; d < idx.length; d++) {
        if (idx[d] > arr.dims[d]) err(E.SUBSCRIPT);
        flat = flat * (arr.dims[d] + 1) + idx[d];
      }
      return { a: arr.data, k: flat, t: t };
    }

    jiffies() { const m = this.m; return (m[0xA0] << 16) | (m[0xA1] << 8) | m[0xA2]; }

    getVar(r) {
      if (r.a) return r.a[r.k];
      if (r.k === 'TI') return this.jiffies();
      if (r.k === 'ST') return this.m[0x90];
      if (r.k === 'TI$') {
        const s = Math.floor(this.jiffies() / 60), p = (n) => (n < 10 ? '0' : '') + n;
        return p(Math.floor(s / 3600) % 24) + p(Math.floor(s / 60) % 60) + p(s % 60);
      }
      const v = this.vars.get(r.k);
      return v === undefined ? (r.t === '$' ? '' : 0) : v;
    }

    assign(r, v) {
      if (r.t === '$') { if (typeof v !== 'string') err(E.TYPE); }
      else {
        if (typeof v !== 'number') err(E.TYPE);
        if (r.t === '%') v = this.toInt16(v);
      }
      if (r.a) { r.a[r.k] = v; return; }
      if (r.k === 'TI' || r.k === 'ST') err(E.SYNTAX);
      if (r.k === 'TI$') {
        if (!/^\d{6}$/.test(v)) err(E.QUANTITY);
        const t = ((+v.substr(0, 2)) * 3600 + (+v.substr(2, 2)) * 60 + (+v.substr(4, 2))) * 60, m = this.m;
        m[0xA0] = (t >> 16) & 0xFF; m[0xA1] = (t >> 8) & 0xFF; m[0xA2] = t & 0xFF;
        return;
      }
      this.vars.set(r.k, v);
    }

    /* bisher verbrauchte Zeit an die Timer weitergeben (damit PEEK/POKE auf I/O zeitlich stimmen) */
    flushTime() {
      const d = this.cost - this.ticked;
      if (d > 0) { this.machine.cia1.tick(d); this.machine.cia2.tick(d); this.ticked = this.cost; this.machine.preTicked = this.ticked; }
    }

    // ---------------------------------------------------------- Zahlen-Helfer
    chk(v) {
      if (v !== v) err(E.QUANTITY);
      if (v > MAXNUM || v < -MAXNUM) err(E.OVERFLOW);
      return (v < 2.93873588e-39 && v > -2.93873588e-39) ? 0 : v;
    }
    toInt16(v) { v = Math.floor(v); if (!(v >= -32768 && v <= 32767)) err(E.QUANTITY); return v; }
    toAddr(v) { v = Math.floor(v); if (!(v >= 0 && v <= 65535)) err(E.QUANTITY); return v; }
    toByte(v) { v = Math.floor(v); if (!(v >= 0 && v <= 255)) err(E.QUANTITY); return v; }
    numExpr() { const v = this.expr(); if (typeof v !== 'number') err(E.TYPE); return v; }
    strExpr() { const v = this.expr(); if (typeof v !== 'string') err(E.TYPE); return v; }
    byteExpr() { return this.toByte(this.numExpr()); }

    setFac(v) {
      const m = this.m;
      this.facValue = v;
      if (!v) { m[0x61] = 0; m[0x62] = m[0x63] = m[0x64] = m[0x65] = 0; m[0x66] = 0; return; }
      const a = Math.abs(v);
      let e = Math.floor(Math.log2(a)) + 1;
      let mant = Math.round(a / Math.pow(2, e) * 4294967296);
      if (mant >= 4294967296) { mant /= 2; e++; }
      if (mant < 2147483648) { mant *= 2; e--; }
      m[0x61] = e + 128; m[0x62] = (mant / 16777216) & 0xFF; m[0x63] = (mant / 65536) & 0xFF; m[0x64] = (mant / 256) & 0xFF; m[0x65] = mant & 0xFF;
      m[0x66] = v < 0 ? 0xFF : 0;
    }
    getFac() {
      const m = this.m;
      if (!m[0x61]) return 0;
      const mant = (m[0x62] * 16777216 + m[0x63] * 65536 + m[0x64] * 256 + m[0x65]) / 4294967296;
      const v = mant * Math.pow(2, m[0x61] - 128);
      return (m[0x66] & 0x80) ? -v : v;
    }

    rnd(x) {
      if (x === 0) return Math.random();
      if (x < 0) this.seed = (Math.floor(-x * 7919) ^ 0x9E3779B9) >>> 0 || 1;
      let t = (this.seed += 0x6D2B79F5) >>> 0;
      this.seed = t;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // ---------------------------------------------------------- Ausdruecke
    expr() {
      let l = this.andExpr();
      while (this.peekc() === T.OR) { this.tp++; const r = this.andExpr(); l = this.logic(l) | this.logic(r); }
      return l;
    }
    andExpr() {
      let l = this.notExpr();
      while (this.peekc() === T.AND) { this.tp++; const r = this.notExpr(); l = this.logic(l) & this.logic(r); }
      return l;
    }
    logic(v) { if (typeof v !== 'number') err(E.TYPE); return this.toInt16(v); }
    notExpr() {
      if (this.peekc() === T.NOT) { this.tp++; return ~this.logic(this.notExpr()); }
      return this.relExpr();
    }
    relExpr() {
      let l = this.addExpr();
      for (; ;) {
        let mask = 0;
        for (; ;) {
          const c = this.peekc();
          if (c === T.GT) mask |= 1; else if (c === T.EQ) mask |= 2; else if (c === T.LT) mask |= 4; else break;
          this.tp++;
        }
        if (!mask) return l;
        const r = this.addExpr();
        if (typeof l !== typeof r) err(E.TYPE);
        l = (mask & (l < r ? 4 : (l === r ? 2 : 1))) ? -1 : 0;
      }
    }
    addExpr() {
      let l = this.mulExpr();
      for (; ;) {
        const c = this.peekc();
        if (c === T.PLUS) {
          this.tp++;
          const r = this.mulExpr();
          if (typeof l !== typeof r) err(E.TYPE);
          if (typeof l === 'string') { l += r; if (l.length > 255) err(E.STRLEN); } else l = this.chk(l + r);
        } else if (c === T.MINUS) {
          this.tp++;
          const r = this.mulExpr();
          if (typeof l !== 'number' || typeof r !== 'number') err(E.TYPE);
          l = this.chk(l - r);
        } else return l;
      }
    }
    mulExpr() {
      let l = this.unary();
      for (; ;) {
        const c = this.peekc();
        if (c !== T.MUL && c !== T.DIV) return l;
        this.tp++;
        const r = this.unary();
        if (typeof l !== 'number' || typeof r !== 'number') err(E.TYPE);
        if (c === T.MUL) l = this.chk(l * r);
        else { if (r === 0) err(E.DIVZERO); l = this.chk(l / r); }
      }
    }
    unary() {
      const c = this.peekc();
      if (c === T.MINUS) { this.tp++; const v = this.unary(); if (typeof v !== 'number') err(E.TYPE); return -v; }
      if (c === T.PLUS) { this.tp++; return this.unary(); }
      return this.powExpr();
    }
    powExpr() {
      let l = this.primary();
      while (this.peekc() === T.POW) {
        this.tp++;
        const r = this.unary();
        if (typeof l !== 'number' || typeof r !== 'number') err(E.TYPE);
        if (l < 0 && r !== Math.floor(r)) err(E.QUANTITY);
        if (l === 0 && r < 0) err(E.DIVZERO);
        l = this.chk(Math.pow(l, r));
      }
      return l;
    }

    strLiteral() {
      const m = this.m;
      let s = '';
      this.tp++;
      while (m[this.tp] !== 0 && m[this.tp] !== 34) s += String.fromCharCode(m[this.tp++]);
      if (m[this.tp] === 34) this.tp++;
      return s;
    }

    primary() {
      const c = this.peekc();
      this.cost += 130;
      if (isDigit(c) || c === 46) { const r = scanNum(this.m, this.tp, false); this.tp = r.i; return r.v; }
      if (isAlpha(c)) return this.getVar(this.ref());
      if (c === 34) return this.strLiteral();
      if (c === 40) { this.tp++; const v = this.expr(); this.expect(41); return v; }
      if (c === T.PI) { this.tp++; return Math.PI; }
      if (c === T.NOT) return this.notExpr();
      if (c === T.FN) {
        this.tp++;
        const name = this.parseName();
        this.expect(40); const arg = this.numExpr(); this.expect(41);
        const d = this.fns.get(name);
        if (!d) err(E.UNDEFFN);
        const old = this.vars.get(d.param), save = this.tp;
        this.vars.set(d.param, arg);
        this.tp = d.tp;
        let v;
        try { v = this.numExpr(); } finally {
          this.tp = save;
          if (old === undefined) this.vars.delete(d.param); else this.vars.set(d.param, old);
        }
        return v;
      }
      if (c >= T.SGN && c <= T.MIDS) { this.tp++; return this.func(c); }
      return err(E.SYNTAX);
    }

    func(tok) {
      this.expect(40);
      let s, n, x;
      switch (tok) {
        case T.LEFTS: case T.RIGHTS:
          s = this.strExpr(); this.expect(44); n = this.byteExpr(); this.expect(41);
          return tok === T.LEFTS ? s.substr(0, n) : (n ? s.slice(-n) : '');
        case T.MIDS:
          s = this.strExpr(); this.expect(44); n = this.byteExpr();
          if (n === 0) err(E.QUANTITY);
          x = 255;
          if (this.peekc() === 44) { this.tp++; x = this.byteExpr(); }
          this.expect(41);
          return s.substr(n - 1, x);
        case T.LEN: s = this.strExpr(); this.expect(41); return s.length;
        case T.ASC: s = this.strExpr(); this.expect(41); if (!s.length) err(E.QUANTITY); return s.charCodeAt(0);
        case T.VAL: s = this.strExpr(); this.expect(41); try { return scanNum(strBytes(s), 0, true).v; } catch (e) { return 0; }
        case T.CHRS: n = this.byteExpr(); this.expect(41); return String.fromCharCode(n);
        case T.STRS: x = this.numExpr(); this.expect(41); return fmt(x);
        case T.FRE: this.expr(); this.expect(41); n = this.freeMem(); return n > 32767 ? n - 65536 : n;
        case T.POS: this.expr(); this.expect(41); return this.kernal.editor.logicalCol();
      }
      x = this.numExpr(); this.expect(41);
      switch (tok) {
        case T.SGN: return x > 0 ? 1 : (x < 0 ? -1 : 0);
        case T.INT: return Math.floor(x);
        case T.ABS: return Math.abs(x);
        case T.USR: return this.usr(x);
        case T.SQR: if (x < 0) err(E.QUANTITY); return Math.sqrt(x);
        case T.RND: return this.rnd(x);
        case T.LOG: if (x <= 0) err(E.QUANTITY); return Math.log(x);
        case T.EXP: if (x > 88.0296919) err(E.OVERFLOW); return this.chk(Math.exp(x));
        case T.COS: return Math.cos(x);
        case T.SIN: return Math.sin(x);
        case T.TAN: return this.chk(Math.tan(x));
        case T.ATN: return Math.atan(x);
        case T.PEEK: x = this.toAddr(x); if (x >= 0xD000 && x < 0xE000) this.flushTime(); return this.mem.read(x);
      }
      return err(E.SYNTAX);
    }

    freeMem() {
      let used = this.vars.size * 7;
      for (const v of this.vars.values()) if (typeof v === 'string') used += v.length;
      for (const [k, a] of this.arrays) {
        const str = k.endsWith('$');
        used += 5 + 2 * a.dims.length + a.data.length * (k.endsWith('%') ? 2 : str ? 3 : 5);
        if (str) for (const s of a.data) used += s.length;
      }
      return Math.max(0, this.memsiz - this.vartab - used);
    }

    usr(x) {
      const cpu = this.cpu, m = this.m, K = C64.Kernal;
      this.setFac(x);
      const ret = K.USRRET - 1;
      cpu.push(ret >> 8); cpu.push(ret & 0xFF);
      cpu.pc = m[0x311] | (m[0x312] << 8);
      this.machine.runUntil(K.USRRET, 20000000);
      cpu.pc = K.MAIN;
      return this.chk(this.getFac());
    }

    // ---------------------------------------------------------- Anweisungen
    statement() {
      const m = this.m;
      let c;
      for (; ;) {
        c = this.peekc();
        if (c === 0) {
          const a = this.tp + 1;
          if (!(m[a] | m[a + 1])) { this.ready(); return; }
          this.curLine = m[a + 2] | (m[a + 3] << 8);
          this.tp = a + 4;
          this.cost += 40;
        } else if (c === 58) this.tp++;
        else break;
      }
      this.cost += 550;
      this.exec(c);
      if (this.state !== 'exec' || this.pending) return;
      if (this.skipEnd) { this.skipEnd = false; return; }
      this.endStatement();
    }

    gotoLine(n) {
      const f = this.findLine(n);
      if (!f.exact) err(E.UNDEF);
      this.tp = f.a - 1;
      this.state = 'exec';
    }

    exec(c) {
      const m = this.m;
      if (c < 0x80) { this.doLet(); return; }
      this.tp++;
      switch (c) {
        case T.END: if (this.curLine >= 0) this.cont = { tp: this.tp, line: this.curLine }; this.ready(); break;
        case T.STOP:
          if (this.curLine >= 0) this.cont = { tp: this.tp, line: this.curLine };
          this.out('\rBREAK' + (this.curLine >= 0 ? ' IN ' + this.curLine : ''));
          this.ready(); break;
        case T.FOR: this.doFor(); break;
        case T.NEXT: this.doNext(); break;
        case T.DATA: this.tp = this.skipStatement(this.tp); break;
        case T.REM: while (m[this.tp]) this.tp++; break;
        case T.INPUTN: this.doInputFile(); break;
        case T.INPUT: this.doInput(); break;
        case T.DIM: this.doDim(); break;
        case T.READ: this.doRead(); break;
        case T.LET: this.doLet(); break;
        case T.GO: this.expect(T.TO); this.gotoLine(this.linenum()); break;
        case T.GOTO: this.gotoLine(this.linenum()); break;
        case T.RUN:
          if (isDigit(this.peekc())) { const n = this.linenum(); this.clr(); this.gotoLine(n); }
          else { this.clr(); m[this.txttab - 1] = 0; this.tp = this.txttab - 1; }
          break;
        case T.IF: this.doIf(); break;
        case T.RESTORE: this.dataPtr = 0; break;
        case T.GOSUB: {
          const n = this.linenum();
          this.pushFrame({ f: 0, tp: this.tp, line: this.curLine });
          this.gotoLine(n); break;
        }
        case T.RETURN: {
          let f = null;
          while (this.stack.length) { const t = this.stack.pop(); if (t.f === 0) { f = t; break; } }
          if (!f) err(E.RETURN);
          this.tp = this.skipStatement(f.tp); this.curLine = f.line; break;
        }
        case T.ON: this.doOn(); break;
        case T.WAIT: {
          const a = this.toAddr(this.numExpr()); this.expect(44);
          const mask = this.byteExpr(); let x = 0;
          if (this.peekc() === 44) { this.tp++; x = this.byteExpr(); }
          this.pending = () => ((this.mem.read(a) ^ x) & mask) !== 0;
          break;
        }
        case T.LOAD: this.doLoad(false); break;
        case T.VERIFY: this.doLoad(true); break;
        case T.SAVE: {
          const a = this.fileArgs();
          this.kernal.saveFile(a.name, a.dev, this.txttab, this.vartab);
          if (this.curLine < 0) this.out('\rSAVING ' + a.name + '\r');
          this.cost += 20000; break;
        }
        case T.DEF: this.doDef(); break;
        case T.POKE: {
          const a = this.toAddr(this.numExpr()); this.expect(44);
          const v = this.byteExpr();
          if (a >= 0xD000 && a < 0xE000) this.flushTime();
          this.mem.write(a, v); break;
        }
        case T.PRINTN: {
          const lfn = this.byteExpr();
          if (this.peekc() === 44) this.tp++;
          this.kernal.chkout(lfn);
          try { this.printList(); } finally { this.kernal.clrchn(); if (this.cmdLfn !== null) try { this.kernal.chkout(this.cmdLfn); } catch (e) { this.cmdLfn = null; } }
          break;
        }
        case T.PRINT: this.printList(); break;
        case T.CONT:
          if (!this.cont) err(E.CONT);
          this.tp = this.cont.tp; this.curLine = this.cont.line; this.skipEnd = true; break;
        case T.LIST: this.doList(); break;
        case T.CLR: this.clr(); break;
        case T.CMD: {
          const lfn = this.byteExpr();
          this.kernal.chkout(lfn); this.cmdLfn = lfn;
          if (this.peekc() === 44) { this.tp++; this.printList(); }
          break;
        }
        case T.SYS: this.doSys(); break;
        case T.OPEN: {
          const lfn = this.byteExpr(); let dev = 1, sa = 0, name = '';
          if (this.peekc() === 44) {
            this.tp++; dev = this.byteExpr();
            if (this.peekc() === 44) {
              this.tp++; sa = this.byteExpr();
              if (this.peekc() === 44) { this.tp++; name = this.strExpr(); }
            }
          }
          if (lfn === 0) err(E.QUANTITY);
          this.kernal.open(lfn, dev, sa, name); break;
        }
        case T.CLOSE: this.kernal.close(this.byteExpr()); break;
        case T.GET: this.doGet(); break;
        case T.NEW: this.endStatement(); this.newProgram(); this.ready(); break;
        default: err(E.SYNTAX);
      }
    }

    pushFrame(f) {
      let size = 0;
      for (const s of this.stack) size += s.f ? 18 : 5;
      if (size + (f.f ? 18 : 5) > 190) err(E.MEMORY);
      this.stack.push(f);
    }

    doLet() {
      const r = this.ref();
      this.expect(T.EQ);
      this.assign(r, this.expr());
    }

    doFor() {
      const name = this.parseName();
      if (name.endsWith('$')) err(E.TYPE);
      if (name.endsWith('%') || this.peekc() === 40) err(E.SYNTAX);
      this.expect(T.EQ);
      const init = this.numExpr();
      this.expect(T.TO);
      const limit = this.numExpr();
      let step = 1;
      if (this.peekc() === T.STEP) { this.tp++; step = this.numExpr(); }
      this.vars.set(name, init);
      const st = this.stack;
      for (let i = st.length - 1; i >= 0 && st[i].f; i--) if (st[i].key === name) { st.length = i; break; }
      this.pushFrame({ f: 1, key: name, limit: limit, step: step, tp: this.tp, line: this.curLine });
    }

    doNext() {
      const st = this.stack;
      this.cost += 350;
      for (; ;) {
        let name = null;
        if (isAlpha(this.peekc())) name = this.parseName();
        let i = st.length - 1;
        for (; ; i--) {
          if (i < 0 || !st[i].f) err(E.NEXT);
          if (name === null || st[i].key === name) break;
        }
        st.length = i + 1;
        const f = st[i];
        const v = this.chk(this.vars.get(f.key) + f.step);
        this.vars.set(f.key, v);
        if (f.step >= 0 ? v <= f.limit : v >= f.limit) { this.tp = f.tp; this.curLine = f.line; return; }
        st.length = i;
        if (this.peekc() !== 44) return;
        this.tp++;
      }
    }

    doIf() {
      const m = this.m;
      const v = this.expr();
      const truth = typeof v === 'string' ? v.length > 0 : v !== 0;
      let c = this.peekc();
      if (c === T.GOTO) this.tp++; else { this.expect(T.THEN); c = 0; }
      if (!truth) { while (m[this.tp]) this.tp++; return; }
      if (c === T.GOTO || isDigit(this.peekc())) { this.gotoLine(this.linenum()); return; }
      this.skipEnd = true;
    }

    doOn() {
      const v = this.byteExpr();
      let tok = this.peekc();
      this.tp++;
      if (tok === T.GO) { this.expect(T.TO); tok = T.GOTO; }
      if (tok !== T.GOTO && tok !== T.GOSUB) err(E.SYNTAX);
      for (let i = 1; ; i++) {
        const n = this.linenum();
        if (i === v) {
          if (tok === T.GOSUB) this.pushFrame({ f: 0, tp: this.tp, line: this.curLine });
          this.gotoLine(n);
          return;
        }
        if (this.peekc() !== 44) return;
        this.tp++;
      }
    }

    doDim() {
      for (; ;) {
        const name = this.parseName();
        if (this.peekc() === 40) {
          this.tp++;
          const dims = this.indexList();
          if (this.arrays.has(name)) err(E.REDIM);
          this.dim(name, dims);
        }
        if (this.peekc() !== 44) return;
        this.tp++;
      }
    }

    doDef() {
      this.expect(T.FN);
      const name = this.parseName();
      this.expect(40);
      const param = this.parseName();
      this.expect(41); this.expect(T.EQ);
      if (this.curLine < 0) err(E.DIRECT);
      this.fns.set(name, { param: param, tp: this.tp });
      this.tp = this.skipStatement(this.tp);
    }

    /* naechstes DATA-Element als PETSCII-String */
    nextData() {
      const m = this.m;
      let p = this.dataPtr || (this.txttab - 1);
      if (m[p] === 44 && this.dataPtr) p++;
      else {
        for (; ;) {
          if (m[p] === 0) {
            const a = p + 1;
            if (!(m[a] | m[a + 1])) err(E.DATA);
            p = a + 4;
          } else if (m[p] === 58) p++;
          while (m[p] === 32) p++;
          if (m[p] === T.DATA) { p++; break; }
          p = this.skipStatement(p);
        }
      }
      while (m[p] === 32) p++;
      let s = '';
      if (m[p] === 34) {
        p++;
        while (m[p] && m[p] !== 34) s += String.fromCharCode(m[p++]);
        if (m[p] === 34) p++;
        while (m[p] && m[p] !== 44 && m[p] !== 58) p++;
      } else {
        while (m[p] && m[p] !== 44 && m[p] !== 58) s += String.fromCharCode(m[p++]);
      }
      this.dataPtr = p;
      return s;
    }

    /* Text -> Zahl, null bei ungueltiger Eingabe */
    parseNum(s) {
      const b = strBytes(s);
      const r = scanNum(b, 0, true);
      let i = r.i;
      while (b[i] === 32) i++;
      if (b[i] !== 0) return null;
      return r.v;
    }

    doRead() {
      for (; ;) {
        const r = this.ref();
        const item = this.nextData();
        if (r.t === '$') this.assign(r, item);
        else { const v = this.parseNum(item); if (v === null) err(E.SYNTAX); this.assign(r, v); }
        if (this.peekc() !== 44) return;
        this.tp++;
      }
    }

    splitInput(line) {
      const items = [];
      let i = 0;
      const n = line.length;
      for (; ;) {
        while (line[i] === 32) i++;
        let s = '';
        if (line[i] === 34) {
          i++;
          while (i < n && line[i] !== 34) s += String.fromCharCode(line[i++]);
          i++;
          while (i < n && line[i] !== 44) i++;
        } else {
          while (i < n && line[i] !== 44) s += String.fromCharCode(line[i++]);
        }
        items.push(s);
        if (i >= n) break;
        i++;
      }
      return items;
    }

    doInput() {
      if (this.curLine < 0) err(E.DIRECT);
      let prompt = '';
      if (this.peekc() === 34) { prompt = this.strLiteral(); this.expect(59); }
      const startTp = this.tp;
      let varTp = startTp, first = true;
      this.out(prompt + '? ');
      this.pending = () => {
        const line = this.kernal.pollLine(false);
        if (!line) return false;
        if (first && !line.length) { this.tp = this.skipStatement(startTp); return true; }
        const items = this.splitInput(line);
        this.tp = varTp;
        let idx = 0;
        for (; ;) {
          const save = this.tp;
          const r = this.ref();
          if (idx >= items.length) { varTp = save; first = false; this.tp = save; this.out('?? '); return false; }
          const it = items[idx++];
          if (r.t === '$') this.assign(r, it);
          else {
            const v = this.parseNum(it);
            if (v === null) { this.out('?REDO FROM START\r' + prompt + '? '); varTp = startTp; first = true; this.tp = startTp; return false; }
            this.assign(r, v);
          }
          if (this.peekc() !== 44) break;
          this.tp++;
        }
        if (idx < items.length) this.out('?EXTRA IGNORED\r');
        return true;
      };
    }

    doInputFile() {
      const k = this.kernal;
      const lfn = this.byteExpr();
      this.expect(44);
      k.chkin(lfn);
      try {
        for (; ;) {
          const r = this.ref();
          // ein Feld lesen: bis Komma oder CR
          let s = '', c;
          if (k.ram[0x99] === 0) err(E.DIRECT);
          for (; ;) {
            c = k.readByte();
            if (c === 13 || c === 44 || (this.m[0x90] & 0x02)) break;
            if (s.length < 255) s += String.fromCharCode(c);
            if (this.m[0x90] & 0x40) break;
          }
          if (r.t === '$') this.assign(r, s.replace(/^ +/, '').replace(/^"(.*)"$/, '$1'));
          else { const v = this.parseNum(s); if (v === null) err(24); this.assign(r, v); }
          if (this.peekc() !== 44) break;
          this.tp++;
        }
      } finally { k.clrchn(); }
    }

    doGet() {
      const k = this.kernal;
      let file = false;
      if (this.peekc() === 35) { this.tp++; k.chkin(this.byteExpr()); this.expect(44); file = true; }
      else if (this.curLine < 0) err(E.DIRECT);
      try {
        for (; ;) {
          const r = this.ref();
          let c;
          if (file && k.ram[0x99] !== 0) c = k.readByte(); else { c = k.getKey(); }
          if (r.t === '$') this.assign(r, c < 0 || (!file && c === 0) ? '' : String.fromCharCode(c));
          else {
            if (c < 0) c = 48;
            if (!isDigit(c) && c !== 32 && c !== 43 && c !== 45 && c !== 46 && c !== 69) err(E.SYNTAX);
            this.assign(r, isDigit(c) ? c - 48 : 0);
          }
          if (this.peekc() !== 44) break;
          this.tp++;
        }
      } finally { if (file) k.clrchn(); }
    }

    printList() {
      const k = this.kernal, screen = () => k.ram[0x9A] === 3;
      let nl = true;
      for (; ;) {
        const c = this.peekc();
        if (c === 0 || c === 58) break;
        if (c === T.TAB || c === T.SPC) {
          this.tp++;
          let n = this.byteExpr();
          this.expect(41);
          if (c === T.TAB) n = screen() ? n - k.editor.logicalCol() : n;
          if (n > 0) this.out((screen() ? '\x1d' : ' ').repeat(n));
          nl = false;
        } else if (c === 59) { this.tp++; nl = false; }
        else if (c === 44) {
          this.tp++;
          const col = screen() ? k.editor.logicalCol() : 0;
          this.out((screen() ? '\x1d' : ' ').repeat(10 - (col % 10)));
          nl = false;
        } else {
          const v = this.expr();
          this.out(typeof v === 'number' ? fmt(v) + (screen() ? '\x1d' : ' ') : v);
          nl = true;
        }
      }
      if (nl) this.out('\r');
    }

    doList() {
      const m = this.m;
      let start = 0, end = 65535;
      if (isDigit(this.peekc())) { start = this.linenum(); end = start; }
      if (this.peekc() === T.MINUS) { this.tp++; end = isDigit(this.peekc()) ? this.linenum() : 65535; }
      this.endStatement();
      let a = this.findLine(start).a;
      this.pending = () => {
        const link = m[a] | (m[a + 1] << 8), num = m[a + 2] | (m[a + 3] << 8);
        if (!link || num > end) { this.ready(); this.skipEnd = true; return true; }
        this.out('\r' + num + ' ' + C64.petscii.str(C64.basicTokens.detokenize(m, a + 4)));
        if (link <= a) { this.ready(); this.skipEnd = true; return true; }
        a = link;
        return false;
      };
    }

    fileArgs() {
      const a = { name: '', dev: 1, sa: 0 };
      if (!this.atEnd()) {
        a.name = this.strExpr();
        if (this.peekc() === 44) {
          this.tp++; a.dev = this.byteExpr();
          if (this.peekc() === 44) { this.tp++; a.sa = this.byteExpr(); }
        }
      }
      return a;
    }

    doLoad(verify) {
      const a = this.fileArgs();
      this.endStatement();
      const direct = this.curLine < 0;
      if (direct) this.out('\rSEARCHING' + (a.name ? ' FOR ' + a.name : '') + '\r');
      const box = { done: false, v: null };
      Promise.resolve(this.kernal.fetchFile(a.name, a.dev)).then((v) => { box.v = v; box.done = true; }, () => { box.done = true; });
      this.pending = () => {
        if (!box.done) return false;
        const v = box.v;
        if (!v || v.bytes.length < 2) err(4);
        const b = v.bytes;
        const addr = a.sa === 0 ? this.txttab : (b[0] | (b[1] << 8));
        if (verify) {
          if (direct) this.out('VERIFYING\r');
          if (this.kernal.copyToRam(b, addr, true) < 0) err(E.VERIFY);
          if (direct) this.out('OK\r');
          return true;
        }
        if (direct) this.out('LOADING\r');
        const end = this.kernal.copyToRam(b, addr, false);
        this.cost += 30000;
        if (direct) {
          this.vartab = end;
          if (a.sa === 0) this.vartab = this.relink();
          this.clr();
          this.ready(); this.skipEnd = true;
        } else {
          if (a.sa === 0) this.vartab = this.relink();
          this.stack.length = 0; this.dataPtr = 0;
          this.m[this.txttab - 1] = 0;
          this.tp = this.txttab - 1;
        }
        return true;
      };
    }

    doSys() {
      const cpu = this.cpu, m = this.m, K = C64.Kernal;
      const addr = this.toAddr(this.numExpr());
      cpu.a = m[0x30C]; cpu.x = m[0x30D]; cpu.y = m[0x30E];
      cpu.p = (m[0x30F] & ~0x10) | 0x20;
      this.syncToZP(0);
      const ret = K.SYSRET - 1;
      cpu.push(ret >> 8); cpu.push(ret & 0xFF);
      cpu.pc = addr;
      this.inSys = true;
      this.skipEnd = true;
    }
  }

  Basic.fmt = fmt;
  C64.BasicError = BasicError;
  C64.Basic = Basic;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
