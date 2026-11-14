/* memory.js - RAM, ROM, Farb-RAM, Bank-Switching ($00/$01) und I/O-Dispatch */
(function (C64) {
  'use strict';

  class Memory {
    constructor() {
      this.ram = new Uint8Array(65536);
      this.basicRom = new Uint8Array(8192);
      this.kernalRom = new Uint8Array(8192);
      this.charRom = C64.buildCharRom();
      this.colorRam = new Uint8Array(1024);
      this.ddr = 0x2F;
      this.port = 0x37;
      this.vic = null; this.sid = null; this.cia1 = null; this.cia2 = null;
      this.updateBanks();
    }

    reset() {
      // typisches Einschaltmuster
      for (let i = 0; i < 65536; i++) this.ram[i] = (i & 0x40) ? 0xFF : 0x00;
      this.colorRam.fill(0);
      this.ddr = 0x2F; this.port = 0x37;
      this.updateBanks();
    }

    updateBanks() {
      const p = (this.port | ~this.ddr) & 7;
      this.basicIn = (p & 3) === 3;
      this.kernalIn = (p & 2) !== 0;
      this.ioIn = (p & 3) !== 0 && (p & 4) !== 0;
      this.charIn = (p & 3) !== 0 && (p & 4) === 0;
    }

    isRom(a) {
      return (a >= 0xE000 && this.kernalIn) || (a >= 0xA000 && a < 0xC000 && this.basicIn);
    }

    read(a) {
      if (a < 0xA000) {
        if (a < 2) return a === 0 ? this.ddr : ((this.port & this.ddr) | (~this.ddr & 0x17));
        return this.ram[a];
      }
      if (a < 0xC000) return this.basicIn ? this.basicRom[a - 0xA000] : this.ram[a];
      if (a < 0xD000) return this.ram[a];
      if (a < 0xE000) {
        if (this.ioIn) return this.ioRead(a);
        if (this.charIn) return this.charRom[a - 0xD000];
        return this.ram[a];
      }
      return this.kernalIn ? this.kernalRom[a - 0xE000] : this.ram[a];
    }

    write(a, v) {
      v &= 0xFF;
      if (a < 2) {
        if (a === 0) this.ddr = v; else this.port = v;
        this.updateBanks();
        return;
      }
      if (a >= 0xD000 && a < 0xE000 && this.ioIn) { this.ioWrite(a, v); return; }
      this.ram[a] = v;
    }

    ioRead(a) {
      if (a < 0xD400) return this.vic.read(a & 0x3F);
      if (a < 0xD800) return this.sid.read(a & 0x1F);
      if (a < 0xDC00) return this.colorRam[a - 0xD800] & 0x0F;
      if (a < 0xDD00) return this.cia1.read(a & 0x0F);
      if (a < 0xDE00) return this.cia2.read(a & 0x0F);
      return 0xFF;
    }

    ioWrite(a, v) {
      if (a < 0xD400) this.vic.write(a & 0x3F, v);
      else if (a < 0xD800) this.sid.write(a & 0x1F, v);
      else if (a < 0xDC00) this.colorRam[a - 0xD800] = v & 0x0F;
      else if (a < 0xDD00) this.cia1.write(a & 0x0F, v);
      else if (a < 0xDE00) this.cia2.write(a & 0x0F, v);
    }

    read16(a) { return this.read(a) | (this.read((a + 1) & 0xFFFF) << 8); }
  }

  C64.Memory = Memory;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
