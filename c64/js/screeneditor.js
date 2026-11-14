/* screeneditor.js - Bildschirmeditor des KERNAL: Cursor, Steuerzeichen, Quote-/Insert-Modus,
   Scrollen, logische Zeilen (bis 80 Zeichen). Arbeitet direkt auf Bildschirm- und Farb-RAM. */
(function (C64) {
  'use strict';
  const COLS = 40, ROWS = 25;
  const COLOR_CODES = { 144: 0, 5: 1, 28: 2, 159: 3, 156: 4, 30: 5, 31: 6, 158: 7, 129: 8, 149: 9, 150: 10, 151: 11, 152: 12, 153: 13, 154: 14, 155: 15 };

  class ScreenEditor {
    constructor(mem) {
      this.mem = mem;
      this.ram = mem.ram;
      this.link = new Uint8Array(ROWS + 1);   // 1 = Fortsetzung der Zeile darueber
      this.inputRow = -1; this.inputCol = 0; this.wholeLine = true;
    }

    get base() { return this.ram[0x288] << 8; }
    get row() { return Math.min(this.ram[0xD6], ROWS - 1); }
    set row(v) { this.ram[0xD6] = v; const a = this.base + v * COLS; this.ram[0xD1] = a & 0xFF; this.ram[0xD2] = a >> 8; this.ram[0xF3] = this.ram[0xD1]; this.ram[0xF4] = 0xD8 + ((v * COLS) >> 8); }
    get col() { return Math.min(this.ram[0xD3], COLS - 1); }
    set col(v) { this.ram[0xD3] = v; }
    get color() { return this.ram[0x286] & 15; }

    put(r, c, code, color) {
      this.ram[this.base + r * COLS + c] = code;
      this.mem.colorRam[r * COLS + c] = color === undefined ? this.color : color;
    }
    get(r, c) { return this.ram[this.base + r * COLS + c]; }

    clear() {
      const b = this.base;
      this.ram.fill(32, b, b + 1000);
      this.mem.colorRam.fill(this.color, 0, 1000);
      this.link.fill(0);
      this.row = 0; this.col = 0;
      this.ram[0xCF] = 0;
    }

    clearRow(r) {
      const b = this.base + r * COLS;
      this.ram.fill(32, b, b + COLS);
      this.mem.colorRam.fill(this.color, r * COLS, r * COLS + COLS);
    }

    scroll() {
      const b = this.base, cr = this.mem.colorRam;
      this.ram.copyWithin(b, b + COLS, b + 1000);
      cr.copyWithin(0, COLS, 1000);
      this.clearRow(ROWS - 1);
      for (let i = 0; i < ROWS - 1; i++) this.link[i] = this.link[i + 1];
      this.link[ROWS - 1] = 0; this.link[0] = 0;
      if (this.inputRow > 0) this.inputRow--;
    }

    insertRow(r) {
      const b = this.base, cr = this.mem.colorRam;
      this.ram.copyWithin(b + (r + 1) * COLS, b + r * COLS, b + 960);
      cr.copyWithin((r + 1) * COLS, r * COLS, 960);
      for (let i = ROWS - 1; i > r; i--) this.link[i] = this.link[i - 1];
      this.clearRow(r);
    }

    firstRow(r) { while (r > 0 && this.link[r]) r--; return r; }
    lastRow(r) { while (r < ROWS - 1 && this.link[r + 1]) r++; return r; }

    down() {
      let r = this.row + 1;
      if (r >= ROWS) { this.scroll(); r = ROWS - 1; }
      this.row = r;
    }

    newline() {
      this.row = this.lastRow(this.row);
      this.col = 0;
      this.down();
      this.link[this.row] = 0;
    }

    advance() {
      let c = this.col + 1, r = this.row;
      if (c < COLS) { this.col = c; return; }
      this.col = 0;
      if (r < ROWS - 1 && this.link[r + 1]) { this.row = r + 1; return; }
      if (this.link[r]) { this.down(); this.link[this.row] = 0; return; }
      if (r === ROWS - 1) { this.scroll(); r = ROWS - 2; }
      this.insertRow(r + 1);
      this.link[r + 1] = 1;
      this.row = r + 1;
    }

    hideCursor() {
      const ram = this.ram;
      if (ram[0xCF]) { this.put(this.row, this.col, ram[0xCE], ram[0x287]); ram[0xCF] = 0; }
      ram[0xCD] = 2;
    }
    cursorOn() { if (this.ram[0xCC]) { this.ram[0xCC] = 0; this.ram[0xCD] = 1; } }
    cursorOff() { this.hideCursor(); this.ram[0xCC] = 1; }

    /* einmal je Jiffy aus der IRQ-Routine */
    blink() {
      const ram = this.ram;
      if (ram[0xCC]) return;
      if (--ram[0xCD] & 0xFF) return;
      ram[0xCD] = 20;
      const r = this.row, c = this.col;
      if (!ram[0xCF]) {
        ram[0xCE] = this.get(r, c); ram[0x287] = this.mem.colorRam[r * COLS + c];
        ram[0xCF] = 1;
        this.put(r, c, ram[0xCE] ^ 0x80);
      } else { this.put(r, c, ram[0xCE], ram[0x287]); ram[0xCF] = 0; }
    }

    chrout(c) {
      const ram = this.ram;
      c &= 0xFF;
      if (ram[0xCF] || !ram[0xCC]) this.hideCursor();
      if (c === 13 || c === 141) {
        this.newline();
        ram[0xD4] = 0; ram[0xD8] = 0; ram[0xC7] = 0;
        return;
      }
      if ((c & 0x7F) >= 32) {
        if (c === 34) ram[0xD4] ^= 1;
        let sc = C64.petscii.toScreen(c);
        if (ram[0xC7]) sc |= 0x80;
        this.put(this.row, this.col, sc);
        if (ram[0xD8]) ram[0xD8]--;
        this.advance();
        return;
      }
      // Steuerzeichen
      if ((ram[0xD8] && c !== 148) || (ram[0xD4] && c !== 20)) {
        this.put(this.row, this.col, c < 32 ? c | 0x80 : (c & 0x7F) | 0xC0);
        if (ram[0xD8]) ram[0xD8]--;
        this.advance();
        return;
      }
      if (COLOR_CODES[c] !== undefined) { ram[0x286] = COLOR_CODES[c]; return; }
      let r = this.row, col = this.col;
      switch (c) {
        case 17: this.down(); break;
        case 145: if (r > 0) this.row = r - 1; break;
        case 29:
          if (col < COLS - 1) this.col = col + 1; else { this.col = 0; this.down(); }
          break;
        case 157:
          if (col > 0) this.col = col - 1; else if (r > 0) { this.row = r - 1; this.col = COLS - 1; }
          break;
        case 19: this.row = 0; this.col = 0; break;
        case 147: this.clear(); break;
        case 18: ram[0xC7] = 1; break;
        case 146: ram[0xC7] = 0; break;
        case 14: this.mem.vic.write(0x18, this.mem.vic.regs[0x18] | 2); break;
        case 142: this.mem.vic.write(0x18, this.mem.vic.regs[0x18] & ~2); break;
        case 8: ram[0x291] = 0x80; break;
        case 9: ram[0x291] = 0; break;
        case 20: {   // DEL
          if (col === 0) {
            if (r === 0) break;
            r--; col = COLS - 1;
            this.row = r; this.col = col;
            this.put(r, col, 32);
            break;
          }
          col--;
          const end = this.lastRow(r) * COLS + COLS - 1, b = this.base, cr = this.mem.colorRam;
          for (let p = r * COLS + col; p < end; p++) { ram[b + p] = ram[b + p + 1]; cr[p] = cr[p + 1]; }
          ram[b + end] = 32; cr[end] = this.color;
          this.col = col;
          break;
        }
        case 148: {  // INST
          const end = this.lastRow(r) * COLS + COLS - 1, b = this.base, cr = this.mem.colorRam;
          const pos = r * COLS + col;
          if (ram[b + end] !== 32 || pos === end) break;
          for (let p = end; p > pos; p--) { ram[b + p] = ram[b + p - 1]; cr[p] = cr[p - 1]; }
          ram[b + pos] = 32; cr[pos] = this.color;
          ram[0xD8]++;
          break;
        }
      }
    }

    /* logische Spalte (0..79) fuer TAB/POS */
    logicalCol() { return this.col + (this.link[this.row] ? COLS : 0); }

    startInput(wholeLine) {
      this.wholeLine = !!wholeLine;
      this.inputRow = this.row; this.inputCol = this.col;
    }

    /* logische Zeile unter dem Cursor als PETSCII lesen, Cursor dahinter setzen, CR ausgeben */
    endInput() {
      this.cursorOff();
      const first = this.firstRow(this.row), last = this.lastRow(this.row);
      let start = first * COLS;
      if (!this.wholeLine && this.inputRow >= first && this.inputRow <= last) start = this.inputRow * COLS + this.inputCol;
      let end = last * COLS + COLS - 1;
      const b = this.base, ram = this.ram;
      while (end >= start && ram[b + end] === 32) end--;
      const out = [];
      let quote = false;
      for (let p = start; p <= end; p++) {
        const ch = C64.petscii.fromScreen(ram[b + p], quote);
        if (ch === 34) quote = !quote;
        out.push(ch);
      }
      this.row = last;
      this.chrout(13);
      this.inputRow = -1;
      return out;
    }
  }

  C64.ScreenEditor = ScreenEditor;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
