export class SpriteEngine {
  constructor() {
    this.x = new Uint16Array(8);
    this.y = new Uint8Array(8);
    this.color = new Uint8Array(8);
    this.mc = new Uint8Array(8);
    this.mcbase = new Uint8Array(8);
    this.expFlop = new Uint8Array(8);
    this.pointer = new Uint8Array(8);
    this.data = new Uint32Array(8);
    this.shiftData = new Uint32Array(8);
    this.shiftPos = new Uint8Array(8);
    this.outColor = new Int8Array(8);
    this.outBehind = new Uint8Array(8);
    this.outMask = new Uint8Array(8);
    this.outMulti = new Uint8Array(8);
    this.reset();
  }

  reset() {
    this.x.fill(0);
    this.y.fill(0);
    this.color.fill(0);
    this.mc.fill(0);
    this.mcbase.fill(0);
    this.expFlop.fill(1);
    this.pointer.fill(0);
    this.data.fill(0);
    this.shiftData.fill(0);
    this.shiftPos.fill(0);
    this.enable = 0;
    this.xexp = 0;
    this.yexp = 0;
    this.multicolor = 0;
    this.priority = 0;
    this.mm0 = 0;
    this.mm1 = 0;
    this.dma = 0;
    this.display = 0;
    this.shifting = 0;
  }

  active() {
    return (this.display | this.shifting) !== 0;
  }

  toggleExpansion() {
    for (let i = 0; i < 8; i++) {
      if (this.yexp & (1 << i)) {
        this.expFlop[i] ^= 1;
      }
    }
  }

  checkDma(rasterLow) {
    for (let i = 0; i < 8; i++) {
      const bit = 1 << i;
      if ((this.enable & bit) && this.y[i] === rasterLow && !(this.dma & bit)) {
        this.dma |= bit;
        this.mcbase[i] = 0;
        if (this.yexp & bit) {
          this.expFlop[i] = 0;
        }
      }
    }
  }

  startDisplay(rasterLow) {
    for (let i = 0; i < 8; i++) {
      const bit = 1 << i;
      this.mc[i] = this.mcbase[i];
      if (this.dma & bit) {
        if (this.y[i] === rasterLow) {
          this.display |= bit;
        }
      } else {
        this.display &= ~bit;
      }
    }
  }

  updateMcBase() {
    for (let i = 0; i < 8; i++) {
      if (this.expFlop[i]) {
        this.mcbase[i] = this.mc[i];
        if (this.mcbase[i] === 63) {
          this.dma &= ~(1 << i);
        }
      }
    }
  }

  writeYExpand(value, crunchCycle) {
    for (let i = 0; i < 8; i++) {
      const bit = 1 << i;
      if (!(value & bit) && !this.expFlop[i]) {
        if (crunchCycle) {
          const mc = this.mc[i];
          const mcbase = this.mcbase[i];
          this.mc[i] = (0x2a & (mcbase & mc)) | (0x15 & (mcbase | mc));
        }
        this.expFlop[i] = 1;
      }
    }
    this.yexp = value;
  }

  dataAddress(sprite) {
    return (this.pointer[sprite] << 6) | this.mc[sprite];
  }

  storeData(sprite, byteIndex, value) {
    const shift = (2 - byteIndex) * 8;
    this.data[sprite] = (this.data[sprite] & ~(0xff << shift)) | (value << shift);
    this.mc[sprite] = (this.mc[sprite] + 1) & 63;
  }

  renderCycle(base, xcoord) {
    const outColor = this.outColor;
    const outMask = this.outMask;
    const outMulti = this.outMulti;
    const outBehind = this.outBehind;
    for (let p = 0; p < 8; p++) {
      outColor[p] = -1;
      outMask[p] = 0;
      outMulti[p] = 0;
      outBehind[p] = 0;
    }
    const candidates = this.display | this.shifting;
    for (let i = 0; i < 8; i++) {
      const bit = 1 << i;
      if (!(candidates & bit)) {
        continue;
      }
      const spriteX = this.x[i];
      const expand = this.xexp & bit;
      const multi = this.multicolor & bit;
      for (let p = 0; p < 8; p++) {
        if (!(this.shifting & bit)) {
          if ((this.display & bit) && xcoord[base + p] === spriteX) {
            this.shifting |= bit;
            this.shiftData[i] = this.data[i];
            this.data[i] = 0;
            this.shiftPos[i] = 0;
          } else {
            continue;
          }
        }
        const pos = this.shiftPos[i];
        const index = expand ? pos >> 1 : pos;
        if (index >= 24) {
          this.shifting &= ~bit;
          break;
        }
        this.shiftPos[i] = pos + 1;
        let colorValue = -1;
        if (multi) {
          const pair = (this.shiftData[i] >> (22 - (index & 0x1e))) & 3;
          if (pair === 1) {
            colorValue = this.mm0;
          } else if (pair === 2) {
            colorValue = this.color[i];
          } else if (pair === 3) {
            colorValue = this.mm1;
          }
        } else if ((this.shiftData[i] >> (23 - index)) & 1) {
          colorValue = this.color[i];
        }
        if (colorValue >= 0) {
          if (outMask[p] === 0) {
            outColor[p] = colorValue;
            outBehind[p] = this.priority & bit ? 1 : 0;
          } else {
            outMulti[p] = 1;
          }
          outMask[p] |= bit;
        }
      }
    }
  }
}
