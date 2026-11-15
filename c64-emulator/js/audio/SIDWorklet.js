class SIDPCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = [];
    this.current = null;
    this.offset = 0;
    this.available = 0;
    this.consumed = 0;
    this.underruns = 0;
    this.renderCount = 0;
    this.started = false;
    this.epoch = 0;
    this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'reset') {
        this.epoch = data.epoch ?? this.epoch + 1;
        this.blocks.length = 0;
        this.current = null;
        this.offset = 0;
        this.available = 0;
        this.consumed = 0;
        this.underruns = 0;
        this.renderCount = 0;
        this.started = false;
      } else if (data?.type === 'samples' && data.samples instanceof Float32Array && data.samples.length) {
        this.blocks.push(data.samples);
        this.available += data.samples.length;
        this.started = true;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    const left = output[0];
    const right = output[1];
    for (let i = 0; i < left.length; i += 1) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.blocks.length ? this.blocks.shift() : null;
        this.offset = 0;
      }
      let value = 0;
      if (this.current) {
        value = this.current[this.offset++];
        this.available -= 1;
        this.consumed += 1;
      } else if (this.started) {
        this.underruns += 1;
      }
      left[i] = value;
      if (right) right[i] = value;
    }
    this.renderCount += 1;
    if ((this.renderCount & 7) === 0) {
      this.port.postMessage({
        type: 'progress', epoch: this.epoch, consumed: this.consumed,
        available: this.available, underruns: this.underruns
      });
    }
    return true;
  }
}

registerProcessor('c64-sid-pcm', SIDPCMPlayer);
