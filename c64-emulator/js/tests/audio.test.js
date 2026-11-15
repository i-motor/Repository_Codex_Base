import { test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { SIDResampler } from '../audio/SIDResampler.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { C64 } from '../core/C64.js';

function fill(resampler, count, value) {
  for (let i = 0; i < count; i += 1) resampler.pushCycle(value);
}

test('Resampling erzeugt exakt 48.000 Samples nach einer Sekunde emulierter Ganzzahlzyklen', () => {
  const r = new SIDResampler(1000000, 48000);
  fill(r, 1000000, 0.25);
  assertEqual(r.generated, 48000);
  assertEqual(r.available, 48000);
});

test('PAL-Takt in 48 kHz bleibt auf einen Sampleschritt genau', () => {
  const r = new SIDResampler(985248.44, 48000);
  fill(r, 19656, 0);
  assertEqual(r.generated, Math.floor(19656 * 48000 / 985248.44));
});

test('Resampler integriert konstantes Signal amplitudengetreu', () => {
  const r = new SIDResampler(1000000, 48000);
  fill(r, 1000, 0.5);
  const samples = r.takeSamples();
  assertTrue(samples.length > 0);
  for (const sample of samples) assertTrue(Math.abs(sample - 0.5) < 0.000001);
});

test('Resampler bildet eine Stufe als gewichtete Teilintervalle ab', () => {
  const r = new SIDResampler(100, 30);
  fill(r, 3, 0);
  r.pushCycle(1);
  const samples = r.takeSamples();
  assertEqual(samples.length, 1);
  assertTrue(samples[0] > 0 && samples[0] < 1);
});

test('Resampler-Samplepuffer kann in Blöcken ausgelesen werden', () => {
  const r = new SIDResampler(100, 25);
  fill(r, 40, 0.5);
  assertEqual(r.available, 10);
  assertEqual(r.takeSamples(3).length, 3);
  assertEqual(r.takeSamples(6).length, 6);
  assertEqual(r.takeSamples(10).length, 1);
  assertEqual(r.available, 0);
});

test('Resampler-Ringpuffer meldet Überlauf und verwirft die ältesten Daten', () => {
  const r = new SIDResampler(1000, 250, 128);
  fill(r, 1000, 0.25);
  assertEqual(r.generated, 250);
  assertEqual(r.dropped, 122);
  assertEqual(r.available, 128);
  assertEqual(r.takeSamples().length, 128);
});

test('Resampler lehnt ungültige Frequenzen und Sampleanzahlen ab', () => {
  assertThrows(() => new SIDResampler(10, 10), RangeError);
  const r = new SIDResampler();
  assertThrows(() => r.configure(0, 48000), RangeError);
  assertThrows(() => r.takeSamples(-1), RangeError);
});

test('Resampler-Clipping verhindert Werte außerhalb des PCM-Normbereichs', () => {
  const r = new SIDResampler(100, 25);
  fill(r, 4, 2);
  assertEqual(r.takeSamples()[0], 1);
});

test('AudioEngine meldet fehlende Browser-AudioWorklet-APIs eindeutig', async () => {
  const savedContext = globalThis.AudioContext;
  const savedNode = globalThis.AudioWorkletNode;
  try {
    globalThis.AudioContext = undefined;
    globalThis.AudioWorkletNode = undefined;
    const engine = new AudioEngine();
    let failed = false;
    try { await engine.initialize(); } catch (e) { failed = /AudioWorklet/.test(e.message); }
    assertTrue(failed);
  } finally {
    globalThis.AudioContext = savedContext;
    globalThis.AudioWorkletNode = savedNode;
  }
});

test('AudioEngine validiert PCM-Datentyp vor dem Enqueue', () => {
  const e = new AudioEngine();
  e.node = { port: { postMessage() {} } };
  assertThrows(() => e.enqueue([0.1]), TypeError);
  assertEqual(e.getBufferStatus().sent, 0);
});

test('AudioEngine verbucht transferierte Float32Array-Samples und Rückmeldungen', () => {
  const calls = [];
  const e = new AudioEngine();
  e.node = { port: { postMessage(...args) { calls.push(args); } } };
  const samples = Float32Array.from([0.25, -0.25, 0.4]);
  e.enqueue(samples);
  assertEqual(calls.length, 1);
  assertEqual(calls[0][0].type, 'samples');
  assertEqual(calls[0][1][0], samples.buffer);
  assertEqual(e.getBufferStatus().buffered, 3);
  e.consumed = 2;
  assertEqual(e.getBufferStatus().buffered, 1);
  e.resetQueue();
  assertEqual(e.getBufferStatus().sent, 0);
  assertEqual(calls[1][0].type, 'reset');
});

test('AudioEngine initialisiert ein natives Stereo-AudioWorklet mit realer Gerätesamplerate', async () => {
  const previousContext = globalThis.AudioContext;
  const previousNode = globalThis.AudioWorkletNode;
  let loadedURL = null;
  class FakeContext {
    constructor() {
      this.sampleRate = 44100;
      this.state = 'suspended';
      this.destination = {};
      this.audioWorklet = { addModule: async url => { loadedURL = url; } };
    }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  class FakeNode {
    constructor(context, name, options) {
      if (name !== 'c64-sid-pcm' || options.outputChannelCount[0] !== 2) {
        throw new Error('Falsche Worklet-Konfiguration');
      }
      this.context = context;
      this.port = { onmessage: null, sent: [], postMessage: (...args) => this.port.sent.push(args) };
    }
    connect(destination) { this.destination = destination; }
  }
  try {
    globalThis.AudioContext = FakeContext;
    globalThis.AudioWorkletNode = FakeNode;
    const engine = new AudioEngine();
    await engine.initialize();
    assertTrue(loadedURL.endsWith('/SIDWorklet.js'));
    assertEqual(engine.node.destination, engine.context.destination);
    assertEqual(await engine.resume(), 44100);
    assertEqual(engine.getBufferStatus().active, true);
    engine.resetQueue();
    engine.enqueue(Float32Array.from([0.1, -0.2]));
    engine.node.port.onmessage({ data: { type: 'progress', epoch: engine.epoch - 1, consumed: 999, underruns: 999 } });
    assertEqual(engine.consumed, 0);
    engine.node.port.onmessage({ data: { type: 'progress', epoch: engine.epoch, consumed: 1, underruns: 3, available: 1 } });
    assertEqual(engine.getBufferStatus().buffered, 1);
    assertEqual(engine.underruns, 3);
    await engine.suspend();
    assertEqual(engine.getBufferStatus().active, false);
    await engine.close();
    assertEqual(engine.initialized, false);
  } finally {
    globalThis.AudioContext = previousContext;
    globalThis.AudioWorkletNode = previousNode;
  }
});

test('Fertige VIC-Frames werden für Audio-Synchronisierung mit Taktstempel kopiert', () => {
  const frames = [];
  const m = new C64();
  m.onFrame = frame => frames.push(frame);
  m.runCycles(m.clock.cyclesPerFrame * 2);
  assertEqual(frames.length, 2);
  assertEqual(frames[0].cycle, m.clock.cyclesPerFrame);
  assertEqual(frames[1].cycle, m.clock.cyclesPerFrame * 2);
  assertTrue(frames[0].data !== frames[1].data);
  assertTrue(frames[0].data !== m.vic.getFrame().data);
});
