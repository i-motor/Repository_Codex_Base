export class AudioEngine {
  constructor({ workletUrl, targetSeconds = 0.08, maxCorrection = 0.005 } = {}) {
    this.workletUrl = workletUrl;
    this.targetSeconds = targetSeconds;
    this.maxCorrection = maxCorrection;
    this.context = null;
    this.node = null;
    this.gain = null;
    this.buffered = 0;
    this.underruns = 0;
    this.overruns = 0;
    this.started = false;
    this.muted = false;
    this.smoothedFill = 0;
  }

  get sampleRate() {
    return this.context ? this.context.sampleRate : 48000;
  }

  get targetSamples() {
    return Math.round(this.sampleRate * this.targetSeconds);
  }

  async start() {
    if (this.started) {
      await this.context.resume();
      return;
    }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) {
      throw new Error('Web Audio API nicht verfügbar');
    }
    this.context = new Context({ latencyHint: 'interactive' });
    if (!this.context.audioWorklet) {
      throw new Error('AudioWorklet nicht verfügbar');
    }
    await this.context.audioWorklet.addModule(this.workletUrl);
    this.node = new AudioWorkletNode(this.context, 'c64-sid-output', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { capacity: Math.round(this.sampleRate * 0.5), target: this.targetSamples }
    });
    this.node.port.onmessage = (event) => {
      this.buffered = event.data.buffered;
      this.underruns = event.data.underruns;
      this.overruns = event.data.overruns;
      this.smoothedFill = this.smoothedFill * 0.9 + this.buffered * 0.1;
    };
    this.gain = this.context.createGain();
    this.gain.gain.value = 0.7;
    this.node.connect(this.gain);
    this.gain.connect(this.context.destination);
    await this.context.resume();
    this.started = true;
    this.smoothedFill = this.targetSamples;
  }

  push(chunk) {
    if (!this.node || this.muted) {
      return;
    }
    this.node.port.postMessage(chunk, [chunk.buffer]);
  }

  flush() {
    if (this.node) {
      this.node.port.postMessage({ command: 'flush' });
    }
  }

  setVolume(value) {
    if (this.gain) {
      this.gain.gain.value = value;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) {
      this.flush();
    }
  }

  rateAdjust() {
    const target = this.targetSamples;
    if (!this.started || target === 0) {
      return 1;
    }
    const error = (this.smoothedFill - target) / target;
    const correction = Math.max(-this.maxCorrection, Math.min(this.maxCorrection, error * 0.01));
    return 1 + correction;
  }

  async suspend() {
    if (this.context) {
      await this.context.suspend();
    }
  }
}
