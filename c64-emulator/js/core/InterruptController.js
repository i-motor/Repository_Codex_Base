export class InterruptController {
  constructor() {
    this.reset();
  }

  reset() {
    this.irqSources = new Map();
    this.nmiSources = new Map();
    this.irqActive = false;
    this.nmiActive = false;
    this.pendingNMI = false;
    this.resetActive = false;
  }

  static anyActive(sources) {
    for (const active of sources.values()) if (active) return true;
    return false;
  }

  setIRQ(source, active) {
    this.irqSources.set(source, Boolean(active));
    this.irqActive = InterruptController.anyActive(this.irqSources);
  }

  setNMI(source, active) {
    const wasActive = this.nmiActive;
    this.nmiSources.set(source, Boolean(active));
    this.nmiActive = InterruptController.anyActive(this.nmiSources);
    if (!wasActive && this.nmiActive) this.pendingNMI = true;
  }

  setRESET(active) {
    this.resetActive = Boolean(active);
  }

  isIRQActive() {
    return this.irqActive;
  }

  isNMIActive() {
    return this.nmiActive;
  }

  sample() {
    return { irq: this.irqActive, nmiPending: this.pendingNMI, reset: this.resetActive };
  }

  consumeNMI() {
    const pending = this.pendingNMI;
    this.pendingNMI = false;
    return pending;
  }
}
