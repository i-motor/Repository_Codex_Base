class SidOutputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.capacity = opts.capacity || 32768;
    this.target = opts.target || 4096;
    this.ring = new Float32Array(this.capacity);
    this.readPos = 0;
    this.writePos = 0;
    this.count = 0;
    this.primed = false;
    this.underruns = 0;
    this.overruns = 0;
    this.last = 0;
    this.blocks = 0;
    this.port.onmessage = (event) => this.receive(event.data);
  }

  receive(data) {
    if (data && data.command === 'flush') {
      this.readPos = 0;
      this.writePos = 0;
      this.count = 0;
      this.primed = false;
      return;
    }
    if (data && data.command === 'target') {
      this.target = data.value;
      return;
    }
    const chunk = data;
    for (let i = 0; i < chunk.length; i++) {
      if (this.count >= this.capacity) {
        this.readPos = (this.readPos + 1) % this.capacity;
        this.count--;
        this.overruns++;
      }
      this.ring[this.writePos] = chunk[i];
      this.writePos = (this.writePos + 1) % this.capacity;
      this.count++;
    }
    if (!this.primed && this.count >= this.target) {
      this.primed = true;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const frames = left.length;
    for (let i = 0; i < frames; i++) {
      let sample;
      if (this.primed && this.count > 0) {
        sample = this.ring[this.readPos];
        this.readPos = (this.readPos + 1) % this.capacity;
        this.count--;
        this.last = sample;
      } else {
        if (this.primed) {
          this.underruns++;
          this.primed = false;
        }
        this.last *= 0.995;
        sample = this.last;
      }
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][i] = sample;
      }
    }
    this.blocks++;
    if (this.blocks % 16 === 0) {
      this.port.postMessage({ buffered: this.count, underruns: this.underruns, overruns: this.overruns });
    }
    return true;
  }
}

registerProcessor('c64-sid-output', SidOutputProcessor);
