export class WorkerRunner {
  constructor({ factory = null } = {}) {
    this.factory = factory ?? (() => new Worker(new URL('./EmulatorWorker.js', import.meta.url), { type: 'module' }));
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  async start(videoStandard = 'PAL', sidModel = '6581') {
    if (this.worker) this.terminate();
    this.worker = this.factory();
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(data.error));
    };
    this.worker.onerror = error => {
      for (const pending of this.pending.values()) pending.reject(new Error(error.message || 'Worker-Fehler'));
      this.pending.clear();
    };
    return this.request('init', { videoStandard, sidModel });
  }

  request(command, data = {}) {
    if (!this.worker) return Promise.reject(new Error('Worker nicht initialisiert'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, command, ...data }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  terminate() {
    for (const pending of this.pending.values()) pending.reject(new Error('Worker beendet'));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
