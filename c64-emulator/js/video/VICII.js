import { PAL, PHI1, buildCycleTable } from './VideoTiming.js';
import { SpriteEngine } from './SpriteEngine.js';
import { BG0, decodeCell, graphicsAddress } from './CharacterGenerator.js';
import { IRQ_SOURCE } from '../utils/Constants.js';

export const VIC_IRQ = Object.freeze({ RASTER: 1, SPRITE_BACKGROUND: 2, SPRITE_SPRITE: 4, LIGHTPEN: 8 });

export class VICII {
  constructor(bus, interrupts, memory, timing = PAL) {
    this.bus = bus;
    this.interrupts = interrupts;
    this.colorRam = memory.colorRam;
    this.sprites = new SpriteEngine();
    this.vmLine = new Uint8Array(40);
    this.colorLine = new Uint8Array(40);
    this.bgColor = new Uint8Array(4);
    this.onFrame = null;
    this.setTiming(timing);
    this.reset();
  }

  setTiming(timing) {
    this.timing = timing;
    this.table = buildCycleTable(timing);
    this.cyclesPerLine = timing.cyclesPerLine;
    this.linesPerFrame = timing.linesPerFrame;
    this.width = this.table.width;
    this.height = timing.linesPerFrame;
    this.frontBuffer = new Uint8Array(this.width * this.height);
    this.backBuffer = new Uint8Array(this.width * this.height);
    this.gfxLine = new Uint8Array(this.width + 32).fill(BG0);
  }

  reset() {
    this.sprites.reset();
    this.cr1 = 0;
    this.cr2 = 0;
    this.memptr = 0;
    this.irqFlags = 0;
    this.irqMask = 0;
    this.rasterCompare = 0;
    this.rasterMatch = false;
    this.borderColor = 0;
    this.bgColor.fill(0);
    this.ssCollision = 0;
    this.sbCollision = 0;
    this.lpx = 0;
    this.lpy = 0;
    this.lightPenInput = false;
    this.lightPenTriggered = false;
    this.raster = this.linesPerFrame - 1;
    this.cycleInLine = 1;
    this.cyc = 1;
    this.vc = 0;
    this.vcbase = 0;
    this.rc = 0;
    this.vmli = 0;
    this.displayState = false;
    this.denLatch = false;
    this.badline = false;
    this.refresh = 0xff;
    this.mainBorder = true;
    this.verticalBorder = true;
    this.ba = true;
    this.baLowCount = 0;
    this.frameCount = 0;
    this.stolenCycles = 0;
    this.vmLine.fill(0);
    this.colorLine.fill(0);
    this.gfxLine.fill(BG0);
    this.updateIrq();
  }

  getFrontBuffer() {
    return this.frontBuffer;
  }

  updateIrq() {
    if (this.interrupts) {
      this.interrupts.setIrq(IRQ_SOURCE.VIC, (this.irqFlags & this.irqMask & 0x0f) !== 0);
    }
  }

  raiseIrq(bits) {
    this.irqFlags |= bits;
    this.updateIrq();
  }

  checkRasterCompare() {
    const match = this.raster === this.rasterCompare;
    if (match && !this.rasterMatch) {
      this.raiseIrq(VIC_IRQ.RASTER);
    }
    this.rasterMatch = match;
  }

  startLine() {
    this.raster++;
    if (this.raster >= this.linesPerFrame) {
      this.raster = 0;
      this.endFrame();
    }
    this.rasterMatch = false;
    if (this.raster !== 0) {
      this.checkRasterCompare();
    }
  }

  endFrame() {
    const done = this.backBuffer;
    this.backBuffer = this.frontBuffer;
    this.frontBuffer = done;
    this.frameCount++;
    this.vcbase = 0;
    this.denLatch = false;
    this.refresh = 0xff;
    this.lightPenTriggered = false;
    if (this.onFrame) {
      this.onFrame(done);
    }
  }

  cycle() {
    const c = this.cycleInLine;
    const t = this.timing;
    const table = this.table;
    const sprites = this.sprites;
    const bus = this.bus;
    this.cyc = c;
    if (c === 1) {
      this.startLine();
    } else if (c === t.rasterIrqLine0Cycle && this.raster === 0) {
      this.checkRasterCompare();
    }
    const raster = this.raster;
    if (raster === 0x30 && (this.cr1 & 0x10)) {
      this.denLatch = true;
    }
    const badline = raster >= 0x30 && raster <= 0xf7 && (raster & 7) === (this.cr1 & 7) && this.denLatch;
    this.badline = badline;
    if (badline) {
      this.displayState = true;
    }

    if (c === t.vcLoadCycle) {
      this.vc = this.vcbase;
      this.vmli = 0;
      if (badline) {
        this.rc = 0;
      }
    } else if (c === t.spriteMcBaseCycle) {
      sprites.updateMcBase();
    } else if (c === t.spriteExpandToggleCycle) {
      sprites.toggleExpansion();
      sprites.checkDma(raster & 0xff);
    } else if (c === t.spriteDmaCycles[1]) {
      sprites.checkDma(raster & 0xff);
    } else if (c === t.rcCheckCycle) {
      if (this.rc === 7) {
        this.displayState = false;
        this.vcbase = this.vc;
      }
      if (badline) {
        this.displayState = true;
      }
      if (this.displayState) {
        this.rc = (this.rc + 1) & 7;
      }
      sprites.startDisplay(raster & 0xff);
    }

    switch (table.phi1Type[c]) {
      case PHI1.SPRITE_POINTER: {
        const n = table.phi1Sprite[c];
        sprites.pointer[n] = bus.vicRead(((this.memptr & 0xf0) << 6) | 0x3f8 | n);
        break;
      }
      case PHI1.SPRITE_DATA: {
        const n = table.phi1Sprite[c];
        if (sprites.dma & (1 << n)) {
          sprites.storeData(n, 1, bus.vicRead(sprites.dataAddress(n)));
        } else {
          bus.vicRead(0x3fff);
        }
        break;
      }
      case PHI1.REFRESH:
        bus.vicRead(0x3f00 | this.refresh);
        this.refresh = (this.refresh - 1) & 0xff;
        break;
      case PHI1.GRAPHICS:
        this.graphicsAccess(c);
        break;
      default:
        bus.vicRead(0x3fff);
    }

    let baLow = (badline && c >= t.badlineBaFirstCycle && c <= t.badlineBaLastCycle) || (sprites.dma & table.spriteBaMask[c]) !== 0;
    if (baLow) {
      this.baLowCount++;
      this.stolenCycles++;
    } else {
      this.baLowCount = 0;
    }
    this.ba = !baLow;
    const aec = this.baLowCount > 3;

    if (badline && c >= t.cAccessFirstCycle && c <= t.cAccessLastCycle) {
      const index = this.vmli;
      if (aec) {
        this.vmLine[index] = bus.vicRead(((this.memptr & 0xf0) << 6) | this.vc);
        this.colorLine[index] = this.colorRam[this.vc] & 0x0f;
      } else {
        this.vmLine[index] = 0xff;
        this.colorLine[index] = bus.phi1Data & 0x0f;
      }
    }
    const s2 = table.phi2Sprite[c];
    if (s2 >= 0 && (sprites.dma & (1 << s2))) {
      const value = aec ? bus.vicRead(sprites.dataAddress(s2)) : 0xff;
      sprites.storeData(s2, table.phi2Byte[c], value);
    }

    this.renderCycle(c, raster);
    this.cycleInLine = c === this.cyclesPerLine ? 1 : c + 1;
  }

  graphicsAccess(c) {
    const mode = ((this.cr1 & 0x60) | (this.cr2 & 0x10)) >> 4;
    let vm = 0;
    let color = 0;
    let address;
    if (this.displayState) {
      vm = this.vmLine[this.vmli];
      color = this.colorLine[this.vmli];
      address = graphicsAddress(mode, true, this.memptr, this.vc, this.rc, vm);
      this.vc = (this.vc + 1) & 0x3ff;
      this.vmli = (this.vmli + 1) & 0x3f;
    } else {
      address = mode & 4 ? 0x39ff : 0x3fff;
    }
    const gdata = this.bus.vicRead(address);
    const column = (c - 1) * 8 + 4 + (this.cr2 & 7);
    decodeCell(mode, gdata, vm, color, this.gfxLine, column);
  }

  renderCycle(c, raster) {
    const t = this.timing;
    const base = (c - 1) * 8;
    const fb = this.backBuffer;
    const offset = raster * this.width + base;
    const xcoord = this.table.xcoord;
    const gfx = this.gfxLine;
    const bg = this.bgColor;
    const top = this.cr1 & 0x08 ? 51 : 55;
    const bottom = this.cr1 & 0x08 ? 251 : 247;
    const den = this.cr1 & 0x10;
    if (c === t.verticalBorderCycle) {
      if (raster === bottom) {
        this.verticalBorder = true;
      } else if (raster === top && den) {
        this.verticalBorder = false;
      }
    }
    const checkBorder = this.table.borderCheck[c] === 1;
    const left = this.cr2 & 0x08 ? 24 : 31;
    const right = this.cr2 & 0x08 ? 344 : 335;
    const sprites = this.sprites;
    const spritesActive = sprites.active();
    if (spritesActive) {
      sprites.renderCycle(base, xcoord);
    }
    let ss = 0;
    let sb = 0;
    for (let p = 0; p < 8; p++) {
      if (checkBorder) {
        const x = xcoord[base + p];
        if (x === right) {
          this.mainBorder = true;
        } else if (x === left) {
          if (raster === bottom) {
            this.verticalBorder = true;
          } else if (raster === top && den) {
            this.verticalBorder = false;
          }
          if (!this.verticalBorder) {
            this.mainBorder = false;
          }
        }
      }
      let code = gfx[base + p];
      gfx[base + p] = BG0;
      if (this.verticalBorder) {
        code = BG0;
      }
      const source = code & 0x1f;
      let color = source < 16 ? source : bg[source - 16];
      if (spritesActive) {
        const mask = sprites.outMask[p];
        if (mask !== 0) {
          const foreground = code & 0x80;
          if (sprites.outMulti[p]) {
            ss |= mask;
          }
          if (foreground) {
            sb |= mask;
          }
          if (!(sprites.outBehind[p] && foreground)) {
            color = sprites.outColor[p];
          }
        }
      }
      fb[offset + p] = this.mainBorder ? this.borderColor : color;
    }
    if (ss !== 0) {
      if (this.ssCollision === 0) {
        this.raiseIrq(VIC_IRQ.SPRITE_SPRITE);
      }
      this.ssCollision |= ss;
    }
    if (sb !== 0) {
      if (this.sbCollision === 0) {
        this.raiseIrq(VIC_IRQ.SPRITE_BACKGROUND);
      }
      this.sbCollision |= sb;
    }
  }

  setLightPen(active) {
    if (active && !this.lightPenInput && !this.lightPenTriggered) {
      this.lightPenTriggered = true;
      const x = this.table.xcoord[(this.cyc - 1) * 8];
      this.lpx = (x >> 1) & 0xff;
      this.lpy = this.raster & 0xff;
      this.raiseIrq(VIC_IRQ.LIGHTPEN);
    }
    this.lightPenInput = active;
  }

  read(register) {
    const reg = register & 0x3f;
    const s = this.sprites;
    if (reg < 0x10) {
      const n = reg >> 1;
      return reg & 1 ? s.y[n] : s.x[n] & 0xff;
    }
    switch (reg) {
      case 0x10: {
        let msb = 0;
        for (let i = 0; i < 8; i++) {
          if (s.x[i] & 0x100) msb |= 1 << i;
        }
        return msb;
      }
      case 0x11: return (this.cr1 & 0x7f) | ((this.raster & 0x100) >> 1);
      case 0x12: return this.raster & 0xff;
      case 0x13: return this.lpx;
      case 0x14: return this.lpy;
      case 0x15: return s.enable;
      case 0x16: return this.cr2 | 0xc0;
      case 0x17: return s.yexp;
      case 0x18: return this.memptr | 0x01;
      case 0x19: return this.irqFlags | 0x70 | ((this.irqFlags & this.irqMask & 0x0f) ? 0x80 : 0);
      case 0x1a: return this.irqMask | 0xf0;
      case 0x1b: return s.priority;
      case 0x1c: return s.multicolor;
      case 0x1d: return s.xexp;
      case 0x1e: {
        const value = this.ssCollision;
        this.ssCollision = 0;
        return value;
      }
      case 0x1f: {
        const value = this.sbCollision;
        this.sbCollision = 0;
        return value;
      }
      case 0x20: return this.borderColor | 0xf0;
      case 0x21:
      case 0x22:
      case 0x23:
      case 0x24: return this.bgColor[reg - 0x21] | 0xf0;
      case 0x25: return s.mm0 | 0xf0;
      case 0x26: return s.mm1 | 0xf0;
      default:
        if (reg >= 0x27 && reg <= 0x2e) {
          return s.color[reg - 0x27] | 0xf0;
        }
        return 0xff;
    }
  }

  peek(register) {
    const reg = register & 0x3f;
    if (reg === 0x1e) return this.ssCollision;
    if (reg === 0x1f) return this.sbCollision;
    return this.read(reg);
  }

  write(register, value) {
    const reg = register & 0x3f;
    const v = value & 0xff;
    const s = this.sprites;
    if (reg < 0x10) {
      const n = reg >> 1;
      if (reg & 1) {
        s.y[n] = v;
      } else {
        s.x[n] = (s.x[n] & 0x100) | v;
      }
      return;
    }
    switch (reg) {
      case 0x10:
        for (let i = 0; i < 8; i++) {
          s.x[i] = (s.x[i] & 0xff) | (v & (1 << i) ? 0x100 : 0);
        }
        return;
      case 0x11:
        this.cr1 = v;
        this.rasterCompare = (this.rasterCompare & 0xff) | ((v & 0x80) << 1);
        if (this.raster === 0x30 && (v & 0x10)) {
          this.denLatch = true;
        }
        this.checkRasterCompare();
        return;
      case 0x12:
        this.rasterCompare = (this.rasterCompare & 0x100) | v;
        this.checkRasterCompare();
        return;
      case 0x15: s.enable = v; return;
      case 0x16: this.cr2 = v & 0x3f; return;
      case 0x17: s.writeYExpand(v, this.cyc === this.timing.spriteCrunchCycle); return;
      case 0x18: this.memptr = v & 0xfe; return;
      case 0x19:
        this.irqFlags &= ~v & 0x0f;
        this.updateIrq();
        return;
      case 0x1a:
        this.irqMask = v & 0x0f;
        this.updateIrq();
        return;
      case 0x1b: s.priority = v; return;
      case 0x1c: s.multicolor = v; return;
      case 0x1d: s.xexp = v; return;
      case 0x20: this.borderColor = v & 0x0f; return;
      case 0x21:
      case 0x22:
      case 0x23:
      case 0x24: this.bgColor[reg - 0x21] = v & 0x0f; return;
      case 0x25: s.mm0 = v & 0x0f; return;
      case 0x26: s.mm1 = v & 0x0f; return;
      default:
        if (reg >= 0x27 && reg <= 0x2e) {
          s.color[reg - 0x27] = v & 0x0f;
        }
    }
  }

  screenAddress() {
    return (this.bus.vicBankBase | ((this.memptr & 0xf0) << 6)) & 0xffff;
  }

  charsetAddress() {
    return (this.bus.vicBankBase | ((this.memptr & 0x0e) << 10)) & 0xffff;
  }

  getState() {
    return {
      raster: this.raster,
      cycle: this.cycleInLine,
      vc: this.vc,
      vcbase: this.vcbase,
      rc: this.rc,
      vmli: this.vmli,
      displayState: this.displayState,
      badline: this.badline,
      ba: this.ba,
      mainBorder: this.mainBorder,
      verticalBorder: this.verticalBorder,
      irqFlags: this.irqFlags,
      irqMask: this.irqMask,
      spriteDma: this.sprites.dma,
      spriteDisplay: this.sprites.display
    };
  }
}
