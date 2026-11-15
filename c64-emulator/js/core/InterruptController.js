export class InterruptController {
  constructor(cpu = null) {
    this.cpu = cpu;
    this.irqSources = 0;
    this.nmiSources = 0;
  }

  attachCpu(cpu) {
    this.cpu = cpu;
    this.update();
  }

  setIrq(sourceMask, active) {
    const next = active ? this.irqSources | sourceMask : this.irqSources & ~sourceMask;
    if (next !== this.irqSources) {
      this.irqSources = next;
      if (this.cpu) {
        this.cpu.irqLine = next !== 0;
      }
    }
  }

  setNmi(sourceMask, active) {
    const next = active ? this.nmiSources | sourceMask : this.nmiSources & ~sourceMask;
    if (next !== this.nmiSources) {
      this.nmiSources = next;
      if (this.cpu) {
        this.cpu.nmiLine = next !== 0;
      }
    }
  }

  get irq() {
    return this.irqSources !== 0;
  }

  get nmi() {
    return this.nmiSources !== 0;
  }

  update() {
    if (this.cpu) {
      this.cpu.irqLine = this.irqSources !== 0;
      this.cpu.nmiLine = this.nmiSources !== 0;
    }
  }

  reset() {
    this.irqSources = 0;
    this.nmiSources = 0;
    this.update();
  }
}
