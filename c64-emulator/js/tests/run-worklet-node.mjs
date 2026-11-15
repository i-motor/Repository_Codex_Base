import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

let WorkletClass;
class FakeAudioWorkletProcessor {
  constructor() {
    this.port = { onmessage: null, messages: [], postMessage(message) { this.messages.push(message); } };
  }
}
const source = readFileSync(new URL('../audio/SIDWorklet.js', import.meta.url), 'utf8');
runInNewContext(source, {
  AudioWorkletProcessor: FakeAudioWorkletProcessor,
  Float32Array,
  registerProcessor(name, klass) {
    if (name !== 'c64-sid-pcm') throw new Error('Falscher Worklet-Name');
    WorkletClass = klass;
  }
});
if (!WorkletClass) throw new Error('Worklet nicht registriert');
const processor = new WorkletClass();
const samples = Float32Array.from({ length: 1500 }, (_, i) => (i % 2 ? -0.5 : 0.5));
processor.port.onmessage({ data: { type: 'samples', samples } });
for (let quantum = 0; quantum < 12; quantum += 1) {
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  if (!processor.process([], [[left, right]])) throw new Error('Worklet hat beendet');
  for (let i = 0; i < 128; i += 1) {
    const position = quantum * 128 + i;
    const expected = position < samples.length ? samples[position] : 0;
    if (left[i] !== expected || right[i] !== expected) {
      throw new Error(`PCM-Fehler bei ${position}: ${left[i]} / ${right[i]}`);
    }
  }
}
if (processor.consumed !== 1500 || processor.underruns !== 36 || processor.available !== 0) {
  throw new Error('PCM-Pufferstatistik fehlerhaft');
}
if (processor.port.messages.length !== 1 || processor.port.messages[0].consumed !== 1024) {
  throw new Error('Worklet-Fortschrittsmeldung fehlerhaft');
}
processor.port.onmessage({ data: { type: 'reset' } });
if (processor.consumed !== 0 || processor.available !== 0 || processor.underruns !== 0) {
  throw new Error('Worklet-Reset fehlerhaft');
}
process.stdout.write('AudioWorklet-PCM-Test bestanden: Stereo, Queue, Unterlauf, Fortschritt, Reset\n');
