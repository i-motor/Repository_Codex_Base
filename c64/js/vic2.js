/* vic2.js - VIC-II (6569 PAL): Rasterzeilen-Renderer, Text-/Bitmap-Modi, Sprites, IRQs */
(function (C64) {
  'use strict';
  const W = 384, H = 272, FIRST_LINE = 16, BORDER_X = 32, LINES = 312;
  const RGB = [0x000000, 0xFFFFFF, 0x68372B, 0x70A4B2, 0x6F3D86, 0x588D43, 0x352879, 0xB8C76F,
    0x6F4F25, 0x433900, 0x9A6759, 0x444444, 0x6C6C6C, 0x9AD284, 0x6C5EB5, 0x959595];

  class VIC2 {
    constructor(mem) {
      this.mem = mem;
      this.width = W; this.height = H;
      this.fb = new Uint32Array(W * H);
      this.pal = new Uint32Array(16);
      for (let i = 0; i < 16; i++) {
        const c = RGB[i];
        this.pal[i] = 0xFF000000 | ((c & 0xFF) << 16) | (c & 0xFF00) | (c >> 16);   // ABGR (little endian)
      }
      this.regs = new Uint8Array(64);
      this.pix = new Uint8Array(336);
      this.fg = new Uint8Array(336);
      this.sprMask = new Uint8Array(336);
      this.bank = 0;
      this.reset();
    }

    reset() {
      this.regs.fill(0);
      this.raster = 0; this.compare = 0; this.irqFlags = 0; this.irqMask = 0;
      this.ssColl = 0; this.sbColl = 0;
    }

    get irqLine() { return (this.irqFlags & this.irqMask & 0x0F) !== 0; }

    /* Speicherzugriff des VIC: 16-KB-Bank, Zeichen-ROM bei $1000 in Bank 0 und 2 */
    vread(a) {
      a = this.bank | (a & 0x3FFF);
      if ((a & 0x7000) === 0x1000) return this.mem.charRom[a & 0x0FFF];
      return this.mem.ram[a];
    }

    read(r) {
      const g = this.regs;
      switch (r) {
        case 0x11: return (g[0x11] & 0x7F) | ((this.raster & 0x100) >> 1);
        case 0x12: return this.raster & 0xFF;
        case 0x13: case 0x14: return 0;
        case 0x16: return g[0x16] | 0xC0;
        case 0x18: return g[0x18] | 0x01;
        case 0x19: return this.irqFlags | 0x70 | (this.irqLine ? 0x80 : 0);
        case 0x1A: return this.irqMask | 0xF0;
        case 0x1E: { const v = this.ssColl; this.ssColl = 0; return v; }
        case 0x1F: { const v = this.sbColl; this.sbColl = 0; return v; }
      }
      if (r >= 0x2F) return 0xFF;
      if (r >= 0x20) return g[r] | 0xF0;
      return g[r];
    }

    write(r, v) {
      if (r >= 0x2F) return;
      switch (r) {
        case 0x11: this.compare = (this.compare & 0xFF) | ((v & 0x80) << 1); break;
        case 0x12: this.compare = (this.compare & 0x100) | v; break;
        case 0x19: this.irqFlags &= ~(v & 0x0F); return;
        case 0x1A: this.irqMask = v & 0x0F; return;
        case 0x1E: case 0x1F: return;
      }
      this.regs[r] = v;
    }

    beginLine(line) {
      this.raster = line;
      if (line === this.compare) this.irqFlags |= 1;
    }

    isBadLine(line) {
      const c1 = this.regs[0x11];
      return (c1 & 0x10) && line >= 0x30 && line <= 0xF7 && (line & 7) === (c1 & 7);
    }

    renderLine(line) {
      const y = line - FIRST_LINE;
      if (y < 0 || y >= H) return;
      const g = this.regs, pal = this.pal, fb = this.fb;
      const off = y * W;
      const border = pal[g[0x20] & 15];
      const c1 = g[0x11], c2 = g[0x16];
      const top = (c1 & 8) ? 51 : 55, bottom = (c1 & 8) ? 251 : 247;
      if (!(c1 & 0x10) || line < top || line >= bottom) {
        fb.fill(border, off, off + W);
        return;
      }
      const pix = this.pix, fg = this.fg;
      const bg0 = g[0x21] & 15;
      pix.fill(bg0); fg.fill(0);

      const gy = line - 48 - (c1 & 7);
      if (gy >= 0 && gy < 200) this.renderGraphics(gy, c1, c2);
      if (g[0x15]) this.renderSprites(line);

      let left = 0, right = 320;
      if (!(c2 & 8)) { left = 7; right = 311; }
      let o = off;
      for (let i = 0; i < BORDER_X; i++) fb[o++] = border;
      for (let x = 0; x < 320; x++) fb[o++] = (x < left || x >= right) ? border : pal[pix[x]];
      for (let i = 0; i < BORDER_X; i++) fb[o++] = border;
    }

    renderGraphics(gy, c1, c2) {
      const g = this.regs, pix = this.pix, fg = this.fg, color = this.mem.colorRam;
      const row = gy >> 3, rc = gy & 7;
      const d018 = g[0x18];
      const vm = (d018 & 0xF0) << 6;
      const cb = (d018 & 0x0E) << 10;
      const bmBase = (d018 & 0x08) << 10;
      const xs = c2 & 7;
      const mode = ((c1 & 0x60) >> 4) | ((c2 & 0x10) >> 4);   // ECM BMM MCM
      const bg0 = g[0x21] & 15, bg1 = g[0x22] & 15, bg2 = g[0x23] & 15;
      let cell = row * 40;
      for (let col = 0; col < 40; col++, cell++) {
        let ch = this.vread(vm + cell);
        const cr = color[cell] & 15;
        let x = col * 8 + xs;
        let data, c;
        switch (mode) {
          case 0:   // Standard-Text
            data = this.vread(cb + ch * 8 + rc);
            for (let b = 0x80; b; b >>= 1, x++) if (data & b) { pix[x] = cr; fg[x] = 1; }
            break;
          case 1:   // Multicolor-Text
            data = this.vread(cb + ch * 8 + rc);
            if (cr & 8) {
              for (let s = 6; s >= 0; s -= 2, x += 2) {
                const p = (data >> s) & 3;
                if (p === 0) continue;
                c = p === 1 ? bg1 : (p === 2 ? bg2 : cr & 7);
                pix[x] = pix[x + 1] = c;
                if (p & 2) fg[x] = fg[x + 1] = 1;
              }
            } else {
              for (let b = 0x80; b; b >>= 1, x++) if (data & b) { pix[x] = cr; fg[x] = 1; }
            }
            break;
          case 2:   // Hires-Bitmap
            data = this.vread(bmBase + cell * 8 + rc);
            for (let b = 0x80; b; b >>= 1, x++) {
              if (data & b) { pix[x] = ch >> 4; fg[x] = 1; } else pix[x] = ch & 15;
            }
            break;
          case 3:   // Multicolor-Bitmap
            data = this.vread(bmBase + cell * 8 + rc);
            for (let s = 6; s >= 0; s -= 2, x += 2) {
              const p = (data >> s) & 3;
              c = p === 0 ? bg0 : (p === 1 ? ch >> 4 : (p === 2 ? ch & 15 : cr));
              pix[x] = pix[x + 1] = c;
              if (p & 2) fg[x] = fg[x + 1] = 1;
            }
            break;
          case 4:   // Extended-Color-Text
            c = g[0x21 + (ch >> 6)] & 15;
            data = this.vread(cb + (ch & 63) * 8 + rc);
            for (let b = 0x80; b; b >>= 1, x++) {
              if (data & b) { pix[x] = cr; fg[x] = 1; } else pix[x] = c;
            }
            break;
          default:  // ungueltige Modi: schwarz
            for (let i = 0; i < 8; i++) pix[x + i] = 0;
        }
      }
    }

    renderSprites(line) {
      const g = this.regs, pix = this.pix, fg = this.fg, sm = this.sprMask;
      const vm = (g[0x18] & 0xF0) << 6;
      const enable = g[0x15];
      let ss = 0, sb = 0;
      sm.fill(0);
      for (let s = 7; s >= 0; s--) {
        const bit = 1 << s;
        if (!(enable & bit)) continue;
        let sl = line - g[s * 2 + 1] - 1;
        const yexp = g[0x17] & bit;
        if (sl < 0 || sl >= (yexp ? 42 : 21)) continue;
        if (yexp) sl >>= 1;
        const ptr = this.vread(vm + 0x3F8 + s) * 64 + sl * 3;
        const data = (this.vread(ptr) << 16) | (this.vread(ptr + 1) << 8) | this.vread(ptr + 2);
        if (!data) continue;
        let x = (g[s * 2] | ((g[0x10] & bit) ? 256 : 0)) - 24;
        const xexp = (g[0x1D] & bit) ? 2 : 1;
        const behind = g[0x1B] & bit;
        const col = g[0x27 + s] & 15;
        if (g[0x1C] & bit) {
          const m0 = g[0x25] & 15, m1 = g[0x26] & 15, w = xexp * 2;
          for (let sh = 22; sh >= 0; sh -= 2) {
            const p = (data >> sh) & 3;
            if (p) {
              const c = p === 1 ? m0 : (p === 2 ? col : m1);
              for (let i = 0; i < w; i++) {
                const px = x + i;
                if (px < 0 || px >= 320) continue;
                if (sm[px]) ss |= sm[px] | bit;
                sm[px] |= bit;
                if (fg[px]) { sb |= bit; if (behind) continue; }
                pix[px] = c;
              }
            }
            x += w;
          }
        } else {
          for (let sh = 23; sh >= 0; sh--) {
            if ((data >> sh) & 1) {
              for (let i = 0; i < xexp; i++) {
                const px = x + i;
                if (px < 0 || px >= 320) continue;
                if (sm[px]) ss |= sm[px] | bit;
                sm[px] |= bit;
                if (fg[px]) { sb |= bit; if (behind) continue; }
                pix[px] = col;
              }
            }
            x += xexp;
          }
        }
      }
      if (ss) { if (!this.ssColl) this.irqFlags |= 4; this.ssColl |= ss; }
      if (sb) { if (!this.sbColl) this.irqFlags |= 2; this.sbColl |= sb; }
    }
  }

  VIC2.LINES = LINES;
  C64.VIC2 = VIC2;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
