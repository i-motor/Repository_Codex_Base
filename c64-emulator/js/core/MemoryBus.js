export const PAGE = Object.freeze({
  RAM: 0,
  BASIC: 1,
  KERNAL: 2,
  CHAR: 3,
  IO: 4,
  ROML: 5,
  ROMH: 6,
  OPEN: 7
});

const PAGE_NAMES = ['RAM', 'BASIC', 'KERNAL', 'CHAR', 'IO', 'ROML', 'ROMH', 'OPEN'];

export function computePageMap(loram, hiram, charen, game, exrom) {
  const read = new Uint8Array(16);
  const write = new Uint8Array(16);
  const ultimax = !game && exrom;
  for (let page = 0; page < 16; page++) {
    let type = PAGE.RAM;
    let writeType = PAGE.RAM;
    if (page === 0) {
      type = PAGE.RAM;
    } else if (page < 8) {
      if (ultimax) {
        type = PAGE.OPEN;
        writeType = PAGE.OPEN;
      }
    } else if (page < 0xa) {
      if (ultimax) {
        type = PAGE.ROML;
        writeType = PAGE.ROML;
      } else if (loram && hiram && !exrom) {
        type = PAGE.ROML;
      }
    } else if (page < 0xc) {
      if (ultimax) {
        type = PAGE.OPEN;
        writeType = PAGE.OPEN;
      } else if (game && loram && hiram) {
        type = PAGE.BASIC;
      } else if (!game && !exrom && hiram) {
        type = PAGE.ROMH;
      }
    } else if (page === 0xc) {
      if (ultimax) {
        type = PAGE.OPEN;
        writeType = PAGE.OPEN;
      }
    } else if (page === 0xd) {
      if (ultimax) {
        type = PAGE.IO;
      } else if (loram || hiram) {
        if (charen) {
          type = PAGE.IO;
        } else if (game || hiram) {
          type = PAGE.CHAR;
        }
      }
      if (type === PAGE.IO) {
        writeType = PAGE.IO;
      }
    } else if (ultimax) {
      type = PAGE.ROMH;
      writeType = PAGE.ROMH;
    } else if (hiram) {
      type = PAGE.KERNAL;
    }
    read[page] = type;
    write[page] = writeType;
  }
  return { read, write };
}

export class MemoryBus {
  constructor(memory) {
    this.memory = memory;
    this.ram = memory.ram;
    this.colorRam = memory.colorRam;
    this.basicRom = memory.basicRom;
    this.kernalRom = memory.kernalRom;
    this.charRom = memory.charRom;
    this.vic = null;
    this.sid = null;
    this.cia1 = null;
    this.cia2 = null;
    this.io1 = null;
    this.io2 = null;
    this.cartridge = null;
    this.loram = 1;
    this.hiram = 1;
    this.charen = 1;
    this.game = 1;
    this.exrom = 1;
    this.vicBank = 0;
    this.vicBankBase = 0;
    this.phi1Data = 0xff;
    this.readMap = new Uint8Array(16);
    this.writeMap = new Uint8Array(16);
    this.watchWrite = null;
    this.rebuild();
  }

  connect({ vic = null, sid = null, cia1 = null, cia2 = null, io1 = null, io2 = null } = {}) {
    this.vic = vic;
    this.sid = sid;
    this.cia1 = cia1;
    this.cia2 = cia2;
    this.io1 = io1;
    this.io2 = io2;
  }

  attachCartridge(cartridge) {
    this.cartridge = cartridge;
    this.setCartridgeLines(cartridge ? cartridge.game : 1, cartridge ? cartridge.exrom : 1);
  }

  setCpuLines(loram, hiram, charen) {
    this.loram = loram ? 1 : 0;
    this.hiram = hiram ? 1 : 0;
    this.charen = charen ? 1 : 0;
    this.rebuild();
  }

  setCartridgeLines(game, exrom) {
    this.game = game ? 1 : 0;
    this.exrom = exrom ? 1 : 0;
    this.rebuild();
  }

  setVicBank(bank) {
    this.vicBank = bank & 3;
    this.vicBankBase = this.vicBank << 14;
  }

  rebuild() {
    const { read, write } = computePageMap(this.loram, this.hiram, this.charen, this.game, this.exrom);
    this.readMap.set(read);
    this.writeMap.set(write);
    this.ultimax = !this.game && this.exrom;
  }

  read(address) {
    switch (this.readMap[address >> 12]) {
      case 0: return this.ram[address];
      case 1: return this.basicRom[address & 0x1fff];
      case 2: return this.kernalRom[address & 0x1fff];
      case 3: return this.charRom[address & 0x0fff];
      case 4: return this.ioRead(address);
      case 5: return this.cartridge ? this.cartridge.readRoml(address & 0x1fff) : this.phi1Data;
      case 6: return this.cartridge ? this.cartridge.readRomh(address & 0x1fff) : this.phi1Data;
      default: return this.phi1Data;
    }
  }

  write(address, value) {
    if (this.watchWrite !== null) {
      this.watchWrite(address, value);
    }
    switch (this.writeMap[address >> 12]) {
      case 0:
        this.ram[address] = value;
        return;
      case 4:
        this.ioWrite(address, value);
        return;
      case 5:
      case 6:
        if (this.cartridge) {
          this.cartridge.writeRom(address, value);
        }
        return;
      default:
        return;
    }
  }

  ioRead(address) {
    switch ((address >> 8) & 0x0f) {
      case 0x0:
      case 0x1:
      case 0x2:
      case 0x3:
        return this.vic ? this.vic.read(address & 0x3f) : this.phi1Data;
      case 0x4:
      case 0x5:
      case 0x6:
      case 0x7:
        return this.sid ? this.sid.read(address & 0x1f) : this.phi1Data;
      case 0x8:
      case 0x9:
      case 0xa:
      case 0xb:
        return (this.colorRam[address & 0x3ff] & 0x0f) | (this.phi1Data & 0xf0);
      case 0xc:
        return this.cia1 ? this.cia1.read(address & 0x0f) : this.phi1Data;
      case 0xd:
        return this.cia2 ? this.cia2.read(address & 0x0f) : this.phi1Data;
      case 0xe:
        return this.io1 ? this.io1.read(address) : this.phi1Data;
      default:
        return this.io2 ? this.io2.read(address) : this.phi1Data;
    }
  }

  ioWrite(address, value) {
    switch ((address >> 8) & 0x0f) {
      case 0x0:
      case 0x1:
      case 0x2:
      case 0x3:
        if (this.vic) this.vic.write(address & 0x3f, value);
        return;
      case 0x4:
      case 0x5:
      case 0x6:
      case 0x7:
        if (this.sid) this.sid.write(address & 0x1f, value);
        return;
      case 0x8:
      case 0x9:
      case 0xa:
      case 0xb:
        this.colorRam[address & 0x3ff] = value & 0x0f;
        return;
      case 0xc:
        if (this.cia1) this.cia1.write(address & 0x0f, value);
        return;
      case 0xd:
        if (this.cia2) this.cia2.write(address & 0x0f, value);
        return;
      case 0xe:
        if (this.io1) this.io1.write(address, value);
        return;
      default:
        if (this.io2) this.io2.write(address, value);
    }
  }

  vicRead(address) {
    let value;
    if ((address & 0x3000) === 0x3000 && this.ultimax) {
      value = this.cartridge ? this.cartridge.readRomh((address & 0x0fff) | 0x1000) : this.ram[this.vicBankBase | address];
    } else if ((address & 0x3000) === 0x1000 && (this.vicBank & 1) === 0 && !this.ultimax) {
      value = this.charRom[address & 0x0fff];
    } else {
      value = this.ram[this.vicBankBase | (address & 0x3fff)];
    }
    this.phi1Data = value;
    return value;
  }

  vicPeek(address) {
    if ((address & 0x3000) === 0x1000 && (this.vicBank & 1) === 0 && !this.ultimax) {
      return this.charRom[address & 0x0fff];
    }
    return this.ram[this.vicBankBase | (address & 0x3fff)];
  }

  peek(address) {
    switch (this.readMap[address >> 12]) {
      case 0: return this.ram[address];
      case 1: return this.basicRom[address & 0x1fff];
      case 2: return this.kernalRom[address & 0x1fff];
      case 3: return this.charRom[address & 0x0fff];
      case 4: {
        const area = (address >> 8) & 0x0f;
        if (area < 4) return this.vic ? this.vic.peek(address & 0x3f) : 0xff;
        if (area < 8) return this.sid ? this.sid.peek(address & 0x1f) : 0xff;
        if (area < 0xc) return this.colorRam[address & 0x3ff] & 0x0f;
        if (area === 0xc) return this.cia1 ? this.cia1.peek(address & 0x0f) : 0xff;
        if (area === 0xd) return this.cia2 ? this.cia2.peek(address & 0x0f) : 0xff;
        return 0xff;
      }
      default: return 0xff;
    }
  }

  mapName(address) {
    return PAGE_NAMES[this.readMap[address >> 12]];
  }
}
