export class SIDResampler {
  constructor(cpuRate = 985248.44, sampleRate = 48000, capacity = 131072) {
    if (!(cpuRate > 0) || !(sampleRate > 0) || sampleRate >= cpuRate ||
        !Number.isSafeInteger(capacity) || capacity < 128) {
      throw new RangeError('Ungültige Resampler-Konfiguration');
    }
    this.cpuRate = cpuRate;
    this.sampleRate = sampleRate;
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
    this.reset();
  }

  reset() {
    this.phase = 0;
    this.integral = 0;
    this.head = 0;
    this.tail = 0;
    this.available = 0;
    this.generated = 0;
    this.dropped = 0;
  }

  configure(cpuRate, sampleRate) {
    if (!(cpuRate > 0) || !(sampleRate > 0) || sampleRate >= cpuRate) {
      throw new RangeError('Ungültige Sampling-Frequenz');
    }
    this.cpuRate = cpuRate;
    this.sampleRate = sampleRate;
    this.reset();
  }

  emit(sample) {
    if (this.available === this.capacity) {
      this.tail = (this.tail + 1) % this.capacity;
      this.available -= 1;
      this.dropped += 1;
    }
    this.buffer[this.head] = Math.max(-1, Math.min(1, sample));
    this.head = (this.head + 1) % this.capacity;
    this.available += 1;
    this.generated += 1;
  }

  pushCycle(sample) {
    const next = this.phase + this.sampleRate;
    if (next < this.cpuRate) {
      this.phase = next;
      this.integral += sample;
      return;
    }
    const first = (this.cpuRate - this.phase) / this.sampleRate;
    this.integral += sample * first;
    this.emit(this.integral * this.sampleRate / this.cpuRate);
    this.integral = sample * (1 - first);
    this.phase = next - this.cpuRate;
  }

  takeSamples(maxCount = this.available) {
    if (!Number.isSafeInteger(maxCount) || maxCount < 0) throw new RangeError('Ungültige Sampleanzahl');
    const count = Math.min(maxCount, this.available);
    const output = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      output[index] = this.buffer[this.tail];
      this.tail = (this.tail + 1) % this.capacity;
    }
    this.available -= count;
    return output;
  }

  getState() {
    return {
      cpuRate: this.cpuRate, sampleRate: this.sampleRate,
      available: this.available, generated: this.generated, dropped: this.dropped,
      phase: this.phase
    };
  }
}
