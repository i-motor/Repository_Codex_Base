/* audio.js - gibt die vom SID erzeugten Samples ueber WebAudio aus */
(function (C64) {
  'use strict';

  class AudioOut {
    constructor(sid) { this.sid = sid; this.ctx = null; this.next = 0; }

    /* muss aus einer Benutzeraktion heraus aufgerufen werden */
    start() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) {
        try { this.ctx = new AC(); } catch (e) { return; }
        this.gain = this.ctx.createGain();
        this.gain.connect(this.ctx.destination);
        this.sid.setSampleRate(this.ctx.sampleRate);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    push(samples) {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running' || !samples.length) return;
      const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buf.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      const now = ctx.currentTime;
      if (this.next < now + 0.01 || this.next > now + 0.35) this.next = now + 0.06;
      src.start(this.next);
      this.next += buf.duration;
    }
  }

  C64.AudioOut = AudioOut;
})(window.C64 = window.C64 || {});
