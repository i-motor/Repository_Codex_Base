import { VideoTiming } from './VideoTiming.js';
import { CharacterGenerator } from './CharacterGenerator.js';
import { SpriteEngine } from './SpriteEngine.js';

export const C64_PALETTE = Object.freeze([
  0x000000, 0xffffff, 0x68372b, 0x70a4b2,
  0x6f3d86, 0x588d43, 0x352879, 0xb8c76f,
  0x6f4f25, 0x433900, 0x9a6759, 0x444444,
  0x6c6c6c, 0x9ad284, 0x6c5eb5, 0x959595
]);

export class VICII {
  constructor({ memory, interrupts, profile } = {}) {
    if (!memory || !interrupts) throw new TypeError('VIC benötigt VICMemory und InterruptController');
    this.memory = memory;
    this.interrupts = interrupts;
    this.timing = new VideoTiming(profile);
    this.width = this.timing.visibleWidth;
    this.height = this.timing.visibleHeight;
    this.frontBuffer = new Uint8Array(this.width * this.height);
    this.backBuffer = new Uint8Array(this.width * this.height);
    this.rowChars = new Uint8Array(40);
    this.rowColors = new Uint8Array(40);
    this.graphics = new Uint8Array(40);
    this.registers = new Uint8Array(0x40);
    this.backgroundColors = [0, 0, 0, 0];
    this.sprites = new SpriteEngine({
      memory: this.memory,
      registers: this.registers,
      screenBase: () => (this.registers[0x18] & 0xf0) << 6,
      irq: bit => this.latchIRQ(bit),
      timing: this.timing
    });
    this.reset();
  }

  reset() {
    this.registers.fill(0);
    this.registers[0x11] = 0x1b;
    this.registers[0x16] = 0xc8;
    this.registers[0x18] = 0x14;
    this.raster = 0;
    this.cycleInLine = 0;
    this.frameNumber = 0;
    this.completedFrames = 0;
    this.dirtyFrame = false;
    this.denLatched = false;
    this.currentBadline = false;
    this.rowIndex = -1;
    this.characterRow = 0;
    this.irqPending = 0;
    this.irqMask = 0;
    this.matrixFetches = 0;
    this.graphicsFetches = 0;
    this.lastMatrixAddress = -1;
    this.lastGraphicsAddress = -1;
    this.sprites.reset();
    this.rowChars.fill(0);
    this.rowColors.fill(0);
    this.graphics.fill(0);
    this.frontBuffer.fill(0);
    this.backBuffer.fill(0);
    this.interrupts.setIRQ('vic', false);
  }

  getRasterCompare() {
    return this.registers[0x12] | ((this.registers[0x11] & 0x80) << 1);
  }

  isIRQActive() {
    return Boolean(this.irqPending & this.irqMask & 15);
  }

  updateIRQ() {
    this.interrupts.setIRQ('vic', Boolean(this.irqPending & this.irqMask & 15));
  }

  latchIRQ(bit) {
    this.irqPending |= bit & 15;
    this.updateIRQ();
  }

  readRegister(address) {
    const reg = address & 0x3f;
    if (reg === 0x11) return (this.registers[reg] & 0x7f) | ((this.raster & 0x100) >>> 1);
    if (reg === 0x12) return this.raster & 255;
    if (reg === 0x19) return this.irqPending | ((this.irqPending & this.irqMask) ? 0x80 : 0x00) | 0x70;
    if (reg === 0x1a) return this.irqMask | 0xf0;
    if (reg === 0x1e) return this.sprites.readCollision('sprite');
    if (reg === 0x1f) return this.sprites.readCollision('data');
    if (reg >= 0x20 && reg <= 0x2e) return this.registers[reg] | 0xf0;
    if (reg >= 0x2f) return 0xff;
    return this.registers[reg];
  }

  peekRegister(address) {
    const reg = address & 0x3f;
    if (reg === 0x1e) return this.sprites.spriteCollision;
    if (reg === 0x1f) return this.sprites.dataCollision;
    return this.readRegister(address);
  }

  writeRegister(address, value) {
    const reg = address & 0x3f;
    const byte = value & 255;
    if (reg === 0x19) {
      this.irqPending &= ~(byte & 15);
      this.updateIRQ();
      return;
    }
    if (reg === 0x1a) {
      this.irqMask = byte & 15;
      this.updateIRQ();
      return;
    }
    if (reg === 0x11 || reg === 0x12) {
      this.registers[reg] = byte;
      return;
    }
    if (reg <= 0x2e && reg !== 0x1e && reg !== 0x1f) this.registers[reg] = byte;
  }

  beginCycle(cycle) {
    const cycleInFrame = cycle % this.timing.cyclesPerFrame;
    const cyclesPerLine = this.timing.profile.cyclesPerLine;
    this.raster = Math.floor(cycleInFrame / cyclesPerLine);
    this.cycleInLine = cycleInFrame % cyclesPerLine;
    if (this.cycleInLine === 0) this.beginLine();
    this.currentGlobalCycle = cycle;
    const spriteRequest = this.sprites.beginCycle(cycle);
    this.currentSpriteSteal = spriteRequest.stealsPhi2;
    const col = this.cycleInLine - 14;
    if (col >= 0 && col < 40 && this.rowIndex >= 0 && this.rowIndex < 25) {
      if (this.currentBadline) {
        const address = (((this.registers[0x18] & 0xf0) << 6) + this.rowIndex * 40 + col) & 0x3fff;
        this.rowChars[col] = this.memory.read(address);
        this.rowColors[col] = this.memory.readColor(this.rowIndex * 40 + col);
        this.matrixFetches += 1;
        this.lastMatrixAddress = address;
      }
      const d011 = this.registers[0x11];
      const mode = CharacterGenerator.mode(d011, this.registers[0x16]);
      const address = CharacterGenerator.dataAddress(this.registers[0x18], this.rowChars[col], this.characterRow, col, this.rowIndex, mode);
      this.graphics[col] = this.memory.read(address);
      this.graphicsFetches += 1;
      this.lastGraphicsAddress = address;
    }
    return this.timing.busRequest(this.raster, this.cycleInLine, this.registers[0x11] & 7, this.denLatched, spriteRequest);
  }

  beginLine() {
    if (this.raster === 0) this.denLatched = false;
    if (this.raster === 0x30) this.denLatched = Boolean(this.registers[0x11] & 0x10);
    if (this.raster === this.getRasterCompare()) {
      this.latchIRQ(1);
    }
    const scrollY = this.registers[0x11] & 7;
    const start = 0x30 + scrollY;
    this.rowIndex = this.raster < start ? -1 : Math.floor((this.raster - start) / 8);
    this.characterRow = (this.raster - start) & 7;
    this.currentBadline = this.timing.isBadline(this.raster, scrollY, this.denLatched);
    this.graphics.fill(0);
  }

  completeBusCycle(grant) {
    this.sprites.finishCycle(this.currentGlobalCycle, !this.currentSpriteSteal || grant.owner === 'vic');
  }

  renderCycle() {
    const row = this.raster - this.timing.visibleY;
    if (row < 0 || row >= this.height) {
      this.finishCycle();
      return;
    }
    const xStart = this.cycleInLine * 8 - this.timing.visibleX;
    const xEnd = xStart + 8;
    if (xEnd <= 0 || xStart >= this.width) {
      this.finishCycle();
      return;
    }
    const start = Math.max(0, xStart);
    const end = Math.min(this.width, xEnd);
    const offset = row * this.width;
    const border = this.registers[0x20] & 15;
    const activeDisplay = Boolean(this.registers[0x11] & 0x10) && this.denLatched;
    const verticalStart = (this.registers[0x11] & 0x08) ? 51 : 55;
    const verticalEnd = (this.registers[0x11] & 0x08) ? 251 : 247;
    const vertical = activeDisplay && this.raster >= verticalStart && this.raster < verticalEnd && this.rowIndex >= 0 && this.rowIndex < 25;
    const wide = Boolean(this.registers[0x16] & 0x08);
    const left = this.timing.displayX + (wide ? 0 : 8);
    const right = this.timing.displayX + (wide ? 320 : 312);
    const scrollX = this.registers[0x16] & 7;
    const mode = CharacterGenerator.mode(this.registers[0x11], this.registers[0x16]);
    const backgrounds = this.backgroundColors;
    backgrounds[0] = this.registers[0x21] & 15;
    backgrounds[1] = this.registers[0x22] & 15;
    backgrounds[2] = this.registers[0x23] & 15;
    backgrounds[3] = this.registers[0x24] & 15;
    const spritesOnLine = this.sprites.hasLineData();
    for (let x = start; x < end; x += 1) {
      const absoluteX = x + this.timing.visibleX;
      const visibleGraphics = vertical && absoluteX >= left && absoluteX < right;
      let color = border;
      let foreground = false;
      if (visibleGraphics) {
        const pictureX = absoluteX - this.timing.displayX - scrollX;
        if (pictureX < 0 || pictureX >= 320) {
          color = backgrounds[0];
        } else {
          const col = pictureX >>> 3;
          const bit = pictureX & 7;
          const code = this.rowChars[col];
          const characterColor = this.rowColors[col];
          const bits = this.graphics[col];
          if (mode === 0) {
            foreground = (bits & (0x80 >>> bit)) !== 0;
            color = (foreground ? characterColor : backgrounds[0]) & 15;
          } else {
            color = CharacterGenerator.colorForPixel({ mode, bits, bit, code, color: characterColor, backgrounds, xInChar: bit }) & 15;
            foreground = CharacterGenerator.isForeground(mode, bits, bit, characterColor);
          }
        }
      }
      this.backBuffer[offset + x] = spritesOnLine ? this.sprites.mixPixel(absoluteX, this.raster, foreground, color, visibleGraphics) : color;
    }
    this.finishCycle();
  }

  finishCycle() {
    if (this.raster === this.timing.profile.linesPerFrame - 1 &&
        this.cycleInLine === this.timing.profile.cyclesPerLine - 1) {
      const old = this.frontBuffer;
      this.frontBuffer = this.backBuffer;
      this.backBuffer = old;
      this.completedFrames += 1;
      this.frameNumber = this.completedFrames;
      this.dirtyFrame = true;
    }
  }

  getFrame() {
    return {
      width: this.width,
      height: this.height,
      data: this.frontBuffer,
      palette: C64_PALETTE,
      frameNumber: this.frameNumber
    };
  }

  getState() {
    return {
      raster: this.raster, cycleInLine: this.cycleInLine,
      frameNumber: this.frameNumber, denLatched: this.denLatched,
      badline: this.currentBadline, rowIndex: this.rowIndex,
      irqPending: this.irqPending, irqMask: this.irqMask,
      screenBase: (this.registers[0x18] & 0xf0) << 6,
      charsetBase: (this.registers[0x18] & 0x0e) << 10,
      bankBase: this.memory.getBankBase(),
      matrixFetches: this.matrixFetches,
      graphicsFetches: this.graphicsFetches,
      sprite: this.sprites.getState()
    };
  }
}
