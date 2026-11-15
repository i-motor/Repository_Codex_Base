export class BusSignals {
  constructor(names = ['IRQ', 'NMI', 'RESET', 'RDY', 'BA', 'AEC']) {
    this.drivers = new Map(names.map(name => [name, new Map()]));
  }

  drive(name, source, high) {
    const drivers = this.drivers.get(name);
    if (!drivers) throw new RangeError(`Unbekanntes Signal: ${name}`);
    if (!source) throw new TypeError('Signalquelle erforderlich');
    const level = Boolean(high);
    if (drivers.get(source) !== level) drivers.set(source, level);
  }

  release(name, source) {
    const drivers = this.drivers.get(name);
    if (!drivers) throw new RangeError(`Unbekanntes Signal: ${name}`);
    drivers.delete(source);
  }

  sample(name) {
    const drivers = this.drivers.get(name);
    if (!drivers) throw new RangeError(`Unbekanntes Signal: ${name}`);
    return [...drivers.values()].every(Boolean);
  }

  reset() {
    for (const drivers of this.drivers.values()) drivers.clear();
  }
}
