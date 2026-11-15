export class Clock {
  constructor(timing) {
    this.timing = timing;
    this.cycles = 0;
  }

  get hz() {
    return this.timing.clockHz;
  }

  cyclesToSeconds(cycles) {
    return cycles / this.timing.clockHz;
  }

  secondsToCycles(seconds) {
    return Math.round(seconds * this.timing.clockHz);
  }

  get cyclesPerFrame() {
    return this.timing.cyclesPerLine * this.timing.linesPerFrame;
  }

  get frameRate() {
    return this.timing.clockHz / this.cyclesPerFrame;
  }
}

export class RealTimeScheduler {
  constructor({
    clockHz,
    run,
    now = () => performance.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    maxSliceMs = 40,
    intervalMs = 4
  }) {
    this.clockHz = clockHz;
    this.run = run;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.maxSliceMs = maxSliceMs;
    this.intervalMs = intervalMs;
    this.running = false;
    this.warp = false;
    this.speed = 1;
    this.timer = null;
    this.debt = 0;
    this.lastTime = 0;
    this.stats = { emulatedHz: 0, droppedMs: 0, slices: 0 };
    this.windowStart = 0;
    this.windowCycles = 0;
    this.tick = () => this.step();
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastTime = this.now();
    this.windowStart = this.lastTime;
    this.windowCycles = 0;
    this.debt = 0;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  setWarp(enabled) {
    this.warp = !!enabled;
    this.lastTime = this.now();
    this.debt = 0;
  }

  setSpeed(factor) {
    this.speed = Math.max(0.05, Math.min(10, factor));
  }

  schedule() {
    this.timer = this.setTimer(this.tick, this.warp ? 0 : this.intervalMs);
  }

  step() {
    this.timer = null;
    if (!this.running) {
      return;
    }
    const time = this.now();
    let elapsed = time - this.lastTime;
    this.lastTime = time;
    if (elapsed > this.maxSliceMs) {
      this.stats.droppedMs += elapsed - this.maxSliceMs;
      elapsed = this.maxSliceMs;
    }
    let due;
    if (this.warp) {
      due = Math.round(this.clockHz * 0.02);
    } else {
      this.debt += (elapsed / 1000) * this.clockHz * this.speed;
      due = Math.floor(this.debt);
    }
    if (due > 0) {
      const done = this.run(due);
      if (!this.warp) {
        this.debt -= done;
        if (done < due) {
          this.debt = 0;
        }
      }
      this.windowCycles += done;
      this.stats.slices++;
    }
    const windowMs = time - this.windowStart;
    if (windowMs >= 1000) {
      this.stats.emulatedHz = Math.round((this.windowCycles * 1000) / windowMs);
      this.windowStart = time;
      this.windowCycles = 0;
    }
    if (this.running) {
      this.schedule();
    }
  }
}
