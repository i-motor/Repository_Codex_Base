const NO_REQUEST = Object.freeze({ baLow: false, stealsPhi2: false });

export class SpriteEngine {
  constructor({ memory, registers, screenBase, irq, timing }) {
    this.memory = memory;
    this.registers = registers;
    this.screenBase = screenBase;
    this.irq = irq;
    this.timing = timing;
    this.pointer = new Uint8Array(8);
    this.data = new Uint8Array(24);
    this.lineTag = new Float64Array(8);
    this.dmaCounter = new Uint8Array(8);
    this.dmaActive = new Uint8Array(8);
    this.pending = new Array(8);
    this.trace = [];
    this.traceEnabled = false;
    this.traceLimit = 256;
    this.reset();
  }

  reset() {
    this.pointer.fill(0);
    this.data.fill(0);
    this.lineTag.fill(-1);
    this.dmaCounter.fill(0);
    this.dmaActive.fill(0);
    this.pending.fill(null);
    this.spriteCollision = 0;
    this.dataCollision = 0;
    this.pointerFetches = 0;
    this.dataFetches = 0;
    this.phi2Steals = 0;
    this.lastPointerAddress = -1;
    this.lastDataAddress = -1;
    this.lineNumber = -1;
    this.tablePerLine = -1;
    this.trace.length = 0;
  }

  slotStart(sprite) {
    return (54 + sprite * 2) % this.timing.profile.cyclesPerLine;
  }

  rowFor(sprite, raster) {
    const startY = this.registers[1 + sprite * 2];
    const expanded = Boolean(this.registers[0x17] & (1 << sprite));
    const delta = raster - startY;
    if (!(this.registers[0x15] & (1 << sprite)) || delta < 0 || delta >= (expanded ? 42 : 21)) return -1;
    return expanded ? (delta >>> 1) : delta;
  }

  targetLine(lineNumber, sprite) {
    return lineNumber + (this.slotStart(sprite) >= 54 ? 1 : 0);
  }

  activeAt(lineNumber, sprite) {
    const target = this.targetLine(lineNumber, sprite);
    const raster = ((target % this.timing.profile.linesPerFrame) + this.timing.profile.linesPerFrame) % this.timing.profile.linesPerFrame;
    return this.rowFor(sprite, raster) >= 0;
  }

  slotTables() {
    const perLine = this.timing.profile.cyclesPerLine;
    if (this.tablePerLine !== perLine) {
      this.tablePerLine = perLine;
      this.firstSlot = new Int8Array(perLine).fill(-1);
      this.secondSlot = new Int8Array(perLine).fill(-1);
      this.nearSlot = new Uint8Array(perLine);
      for (let sprite = 0; sprite < 8; sprite += 1) {
        const start = this.slotStart(sprite);
        this.firstSlot[start] = sprite;
        this.secondSlot[(start + 1) % perLine] = sprite;
      }
      for (let position = 0; position < perLine; position += 1) {
        for (let lead = 0; lead <= 3; lead += 1) {
          const target = (position + lead) % perLine;
          if (this.firstSlot[target] >= 0 || this.secondSlot[target] >= 0) this.nearSlot[position] = 1;
        }
      }
    }
    return perLine;
  }

  stealsAt(lineNumber, cycleInLine) {
    const perLine = this.slotTables();
    const first = this.firstSlot[cycleInLine];
    if (first >= 0 && this.activeAt(lineNumber, first)) return true;
    const second = this.secondSlot[cycleInLine];
    if (second >= 0) {
      const startLine = this.slotStart(second) === perLine - 1 ? lineNumber - 1 : lineNumber;
      if (this.activeAt(startLine, second)) return true;
    }
    return false;
  }

  busRequest(lineNumber, cycleInLine) {
    const perLine = this.slotTables();
    if (!this.registers[0x15] || !this.nearSlot[cycleInLine]) return NO_REQUEST;
    const steal = this.stealsAt(lineNumber, cycleInLine);
    let baLow = steal;
    for (let lead = 1; lead <= 3 && !baLow; lead += 1) {
      const absolute = lineNumber * perLine + cycleInLine + lead;
      if (this.stealsAt(Math.floor(absolute / perLine), absolute % perLine)) baLow = true;
    }
    return baLow ? { baLow, stealsPhi2: steal } : NO_REQUEST;
  }

  record(cycle, phase, sprite, kind, address, value) {
    if (!this.traceEnabled) return;
    if (this.trace.length >= this.traceLimit) this.trace.shift();
    this.trace.push({ cycle, phase, sprite, kind, address, value });
  }

  readPointer(sprite, cycle) {
    const address = (this.screenBase() + 0x3f8 + sprite) & 0x3fff;
    const value = this.memory.read(address);
    this.pointer[sprite] = value;
    this.lastPointerAddress = address;
    this.pointerFetches += 1;
    this.record(cycle, 1, sprite, 'pointer', address, value);
    return value;
  }

  readData(sprite, index, cycle, phase) {
    const transfer = this.pending[sprite];
    if (!transfer) return;
    const address = ((transfer.pointer << 6) + transfer.row * 3 + index) & 0x3fff;
    const value = this.memory.read(address);
    transfer.bytes[index] = value;
    this.lastDataAddress = address;
    this.dataFetches += 1;
    this.record(cycle, phase, sprite, 'data', address, value);
    if (index === 2) {
      this.data.set(transfer.bytes, sprite * 3);
      this.lineTag[sprite] = transfer.targetLine;
      this.dmaCounter[sprite] = transfer.row * 3;
      this.pending[sprite] = null;
    }
  }

  beginCycle(cycle) {
    const perLine = this.slotTables();
    const lineNumber = Math.floor(cycle / perLine);
    const position = cycle - lineNumber * perLine;
    if (this.lineNumber !== lineNumber) {
      this.lineNumber = lineNumber;
      const raster = lineNumber % this.timing.profile.linesPerFrame;
      for (let sprite = 0; sprite < 8; sprite += 1) {
        this.dmaActive[sprite] = this.rowFor(sprite, raster) >= 0 ? 1 : 0;
      }
    }
    const first = this.firstSlot[position];
    if (first >= 0) {
      const pointer = this.readPointer(first, cycle);
      const targetLine = this.targetLine(lineNumber, first);
      const targetRaster = targetLine % this.timing.profile.linesPerFrame;
      const row = this.rowFor(first, targetRaster);
      this.pending[first] = row < 0 ? null : {
        pointer, targetLine, row, bytes: new Uint8Array(3)
      };
    }
    const second = this.secondSlot[position];
    if (second >= 0 && second !== first) this.readData(second, 1, cycle, 1);
    return this.busRequest(lineNumber, position);
  }

  finishCycle(cycle, busGranted) {
    const perLine = this.slotTables();
    const position = cycle % perLine;
    const first = this.firstSlot[position];
    const second = this.secondSlot[position];
    if (first < 0 && second < 0) return;
    for (let sprite = 0; sprite < 8; sprite += 1) {
      if (sprite !== first && sprite !== second) continue;
      if (!this.pending[sprite]) continue;
      if (!busGranted) throw new Error('Sprite-DMA benötigt einen belegten Φ2-Buszyklus');
      this.phi2Steals += 1;
      this.readData(sprite, sprite === first ? 0 : 2, cycle, 2);
    }
  }

  hasLineData() {
    const line = this.lineNumber;
    const tags = this.lineTag;
    return tags[0] === line || tags[1] === line || tags[2] === line || tags[3] === line ||
      tags[4] === line || tags[5] === line || tags[6] === line || tags[7] === line;
  }

  mixPixel(x, raster, foreground, baseColor, showSprites) {
    let present = 0;
    let drawable = false;
    let chosenColor = baseColor;
    const line = this.lineNumber;
    for (let sprite = 0; sprite < 8; sprite += 1) {
      if (this.lineTag[sprite] !== line) continue;
      const bit = 1 << sprite;
      const spriteX = this.registers[sprite * 2] | ((this.registers[0x10] & bit) ? 256 : 0);
      const screenX = this.timing.displayX - 24 + spriteX;
      const delta = x - screenX;
      if (delta < 0) continue;
      const expandedX = Boolean(this.registers[0x1d] & bit);
      const pixel = expandedX ? (delta >>> 1) : delta;
      if (pixel >= 24) continue;
      const base = sprite * 3;
      const dataWord = (this.data[base] << 16) | (this.data[base + 1] << 8) | this.data[base + 2];
      let color;
      if (this.registers[0x1c] & bit) {
        const pair = (dataWord >>> (22 - ((pixel >>> 1) << 1))) & 3;
        if (!pair) continue;
        color = pair === 1 ? this.registers[0x25] : pair === 2 ? this.registers[0x27 + sprite] : this.registers[0x26];
      } else {
        if (!(dataWord & (1 << (23 - pixel)))) continue;
        color = this.registers[0x27 + sprite];
      }
      present |= bit;
      if (!drawable && (!foreground || !(this.registers[0x1b] & bit))) {
        drawable = true;
        chosenColor = color & 15;
      }
    }
    if (!present) return baseColor;
    if (present & (present - 1)) {
      const updated = this.spriteCollision | present;
      if (updated !== this.spriteCollision) {
        this.spriteCollision = updated;
        this.irq(4);
      }
    }
    if (foreground) {
      const updated = this.dataCollision | present;
      if (updated !== this.dataCollision) {
        this.dataCollision = updated;
        this.irq(2);
      }
    }
    return showSprites && drawable ? chosenColor : baseColor;
  }

  readCollision(which) {
    if (which === 'sprite') {
      const value = this.spriteCollision;
      this.spriteCollision = 0;
      return value;
    }
    const value = this.dataCollision;
    this.dataCollision = 0;
    return value;
  }

  getState() {
    return {
      pointerFetches: this.pointerFetches,
      dataFetches: this.dataFetches,
      phi2Steals: this.phi2Steals,
      spriteCollision: this.spriteCollision,
      dataCollision: this.dataCollision,
      lastPointerAddress: this.lastPointerAddress,
      lastDataAddress: this.lastDataAddress,
      sprites: Array.from({ length: 8 }, (_, i) => ({
        number: i,
        x: this.registers[2 * i] | ((this.registers[0x10] & (1 << i)) ? 256 : 0),
        y: this.registers[2 * i + 1],
        enabled: Boolean(this.registers[0x15] & (1 << i)),
        pointer: this.pointer[i],
        dmaActive: Boolean(this.dmaActive[i]),
        dataCounter: this.dmaCounter[i],
        lineTag: this.lineTag[i]
      }))
    };
  }
}
