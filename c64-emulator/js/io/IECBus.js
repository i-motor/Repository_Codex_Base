export class IECBus {
  constructor() {
    this.drivers = new Map(['ATN', 'CLOCK', 'DATA', 'SRQ', 'RESET'].map(line => [line, new Map()]));
    this.devices = new Set();
    this.cycle = 0;
  }

  attachDevice(device) {
    if (!device || typeof device.tick !== 'function') throw new TypeError('IEC-Gerät benötigt tick()');
    this.devices.add(device);
    return device;
  }

  detachDevice(device) {
    this.devices.delete(device);
  }

  drive(source, line, low) {
    const drivers = this.drivers.get(line);
    if (!drivers || typeof source !== 'string' || source.length === 0) throw new RangeError('Ungültiger IEC-Treiber oder Leitung');
    if (low) drivers.set(source, true);
    else drivers.delete(source);
  }

  sample(line) {
    const drivers = this.drivers.get(line);
    if (!drivers) throw new RangeError('Unbekannte IEC-Leitung');
    return drivers.size === 0;
  }

  tick(cycle = this.cycle + 1) {
    this.cycle = cycle;
    for (const device of this.devices) device.tick(cycle);
  }

  reset() {
    for (const sources of this.drivers.values()) sources.clear();
    this.cycle = 0;
    for (const device of this.devices) device.reset?.();
  }

  snapshot() {
    return Object.fromEntries([...this.drivers.keys()].map(line => [line, this.sample(line)]));
  }
}
