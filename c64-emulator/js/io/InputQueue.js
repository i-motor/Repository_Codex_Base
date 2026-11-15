export class InputQueue {
  constructor() {
    this.items = [];
    this.order = 0;
  }

  enqueue(event, cycle) {
    if (!Number.isSafeInteger(cycle) || cycle < 0) throw new RangeError('Ungültiger Eingabezeitpunkt');
    if (!event || typeof event.type !== 'string') throw new TypeError('Eingabe benötigt einen Typ');
    this.items.push({ cycle, order: this.order++, event: { ...event } });
    this.items.sort((a, b) => a.cycle - b.cycle || a.order - b.order);
  }

  applyUntil(cycle, consumer) {
    let processed = 0;
    while (this.items.length && this.items[0].cycle <= cycle) {
      consumer(this.items.shift().event);
      processed += 1;
    }
    return processed;
  }

  clear() {
    this.items.length = 0;
    this.order = 0;
  }
}
