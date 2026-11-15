import { IO_RANGES } from '../utils/Constants.js';

export class MemoryBus {
  constructor(memory, roms, processorPort) {
    this.memory = memory;
    this.roms = roms;
    this.processorPort = processorPort;
    this.devices = new Map();
    this.lastData = 0xff;
  }

  resetBusLatch() {
    this.lastData = 0xff;
  }

  attachDevice(name, device) {
    if (!Object.hasOwn(IO_RANGES, name)) throw new RangeError(`Unbekanntes I/O-Gerät: ${name}`);
    if (!device || typeof device.readRegister !== 'function' || typeof device.writeRegister !== 'function') {
      throw new TypeError('I/O-Gerät benötigt readRegister und writeRegister');
    }
    this.devices.set(name, device);
  }

  detachDevice(name) {
    this.devices.delete(name);
  }

  getMapping() {
    const bits = this.processorPort.getBankBits();
    const loram = Boolean(bits & 1);
    const hiram = Boolean(bits & 2);
    const charen = Boolean(bits & 4);
    return {
      bits,
      basic: loram && hiram,
      kernal: hiram,
      d000: !(loram || hiram) ? 'ram' : charen ? 'io' : 'chargen'
    };
  }

  cpuRead(address, context = {}) {
    const value = this.readMapped(address & 0xffff, context, false);
    this.lastData = value & 0xff;
    return this.lastData;
  }

  cpuWrite(address, value, context = {}) {
    const target = address & 0xffff;
    const byte = value & 0xff;
    this.lastData = byte;
    if (target === 0x0000) {
      this.processorPort.writeDDR(byte);
    } else if (target === 0x0001) {
      this.processorPort.writePins(byte);
    } else if (target >= 0xd000 && target <= 0xdfff && this.getMapping().d000 === 'io') {
      this.writeIO(target, byte, context);
    } else {
      this.memory.writeRAM(target, byte);
    }
  }

  peek(address) {
    return this.readMapped(address & 0xffff, {}, true);
  }

  readMapped(address, context, observeOnly) {
    if (address === 0x0000) return this.processorPort.readDDR();
    if (address === 0x0001) return this.processorPort.readPins();
    const map = this.getMapping();
    if (address >= 0xa000 && address <= 0xbfff && map.basic) {
      return this.roms.read('basic', address - 0xa000) ?? this.lastData;
    }
    if (address >= 0xd000 && address <= 0xdfff) {
      if (map.d000 === 'chargen') {
        return this.roms.read('chargen', address - 0xd000) ?? this.lastData;
      }
      if (map.d000 === 'io') return this.readIO(address, context, observeOnly);
    }
    if (address >= 0xe000 && map.kernal) {
      return this.roms.read('kernal', address - 0xe000) ?? this.lastData;
    }
    return this.memory.readRAM(address);
  }

  findDevice(address) {
    for (const [name, range] of Object.entries(IO_RANGES)) {
      if (address >= range.start && address <= range.end) {
        return { device: this.devices.get(name), offset: (address - range.start) & range.mirrorMask };
      }
    }
    return null;
  }

  readIO(address, context, observeOnly) {
    if (address >= 0xd800 && address <= 0xdbff) {
      return (this.lastData & 0xf0) | this.memory.readColor(address - 0xd800);
    }
    const resolved = this.findDevice(address);
    if (!resolved?.device) return this.lastData;
    if (observeOnly) {
      return typeof resolved.device.peekRegister === 'function'
        ? (resolved.device.peekRegister(resolved.offset) & 0xff)
        : this.lastData;
    }
    return resolved.device.readRegister(resolved.offset, context) & 0xff;
  }

  writeIO(address, value, context) {
    if (address >= 0xd800 && address <= 0xdbff) {
      this.memory.writeColor(address - 0xd800, value);
      return;
    }
    const resolved = this.findDevice(address);
    resolved?.device?.writeRegister(resolved.offset, value, context);
  }
}
