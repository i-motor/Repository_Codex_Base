export class AudioEngine {
  constructor({ targetSeconds = 0.17 } = {}) {
    this.targetSeconds = targetSeconds;
    this.context = null;
    this.node = null;
    this.consumed = 0;
    this.sent = 0;
    this.underruns = 0;
    this.workletAvailable = 0;
    this.initialized = false;
    this.epoch = 0;
    this.transition = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass || !globalThis.AudioWorkletNode) {
      throw new Error('AudioWorklet ist in diesem Browser nicht verfügbar');
    }
    const context = new AudioContextClass({ latencyHint: 'playback' });
    try {
      await context.audioWorklet.addModule(new URL('./SIDWorklet.js', import.meta.url).href);
      const node = new AudioWorkletNode(context, 'c64-sid-pcm', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
      });
      node.port.onmessage = event => {
        if (event.data?.type !== 'progress' || event.data.epoch !== this.epoch) return;
        this.consumed = event.data.consumed;
        this.underruns = event.data.underruns;
        this.workletAvailable = event.data.available;
      };
      node.connect(context.destination);
      this.context = context;
      this.node = node;
      this.initialized = true;
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  async resume() {
    await this.initialize();
    this.transition = this.transition.catch(() => {}).then(async () => {
      if (this.context.state === 'running') return;
      let timer;
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Der Browser hat die Audioausgabe nicht freigegeben')), 3000);
      });
      try {
        await Promise.race([this.context.resume(), timeout]);
      } finally {
        clearTimeout(timer);
      }
    });
    await this.transition;
    return this.context.sampleRate;
  }

  async suspend() {
    this.transition = this.transition.catch(() => {}).then(async () => {
      if (this.context && this.context.state === 'running') await this.context.suspend();
    });
    await this.transition;
  }

  resetQueue() {
    this.epoch += 1;
    this.sent = 0;
    this.consumed = 0;
    this.underruns = 0;
    this.workletAvailable = 0;
    this.node?.port.postMessage({ type: 'reset', epoch: this.epoch });
  }

  enqueue(samples) {
    if (!this.node) throw new Error('AudioEngine ist noch nicht initialisiert');
    if (!(samples instanceof Float32Array)) throw new TypeError('AudioEngine benötigt Float32Array');
    if (!samples.length) return;
    this.sent += samples.length;
    this.node.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
  }

  getBufferStatus() {
    const sampleRate = this.context?.sampleRate ?? 48000;
    return {
      active: this.context?.state === 'running', sampleRate,
      targetSamples: Math.round(sampleRate * this.targetSeconds),
      buffered: Math.max(0, this.sent - this.consumed),
      consumed: this.consumed, sent: this.sent,
      underruns: this.underruns, workletAvailable: this.workletAvailable
    };
  }

  async close() {
    if (this.context) await this.context.close();
    this.context = null;
    this.node = null;
    this.initialized = false;
  }
}
