import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SID } from '../audio/SID6581.js';
import { SIDEnvelope, RATE_PERIODS } from '../audio/SIDEnvelope.js';
import { SIDFilter, cutoffHz } from '../audio/SIDFilter.js';

function makeSid(options = {}) {
  const clock = { cycles: 0 };
  const sid = new SID({ clock, clockHz: 985248, sampleRate: 44100, ...options });
  const advance = (n) => {
    clock.cycles += n;
    sid.catchUp(clock.cycles);
  };
  return { sid, clock, advance };
}

test('Oszillator: MSB-Periode = 2^24 / Frequenzregister', () => {
  const { sid } = makeSid();
  const voice = sid.voices[0];
  sid.write(0, 0x00);
  sid.write(1, 0x10);
  let rising = 0;
  for (let i = 0; i < 4096 * 10; i++) {
    voice.clockOscillator();
    if (voice.msbRising) rising++;
  }
  assert.equal(rising, 10);
  assert.ok(Math.abs(sid.frequencyHz(0) - 985248 * 4096 / 16777216) < 1e-9);
});

test('Wellenformen: Sägezahn, Dreieck, Puls mit Pulsbreite', () => {
  const { sid } = makeSid();
  const v = sid.voices[0];
  v.accumulator = 0x400000;
  sid.write(4, 0x20);
  assert.equal(v.output(), 0x400);
  sid.write(4, 0x10);
  assert.equal(v.output(), 0x800);
  v.accumulator = 0xc00000;
  assert.equal(v.output(), 0x7ff);
  sid.write(2, 0x00);
  sid.write(3, 0x08);
  sid.write(4, 0x40);
  v.accumulator = 0x7ff000;
  assert.equal(v.output(), 0x000);
  v.accumulator = 0x800000;
  assert.equal(v.output(), 0xfff);
});

test('Test-Bit hält Akkumulator auf 0 und setzt das Rausch-LFSR zurück', () => {
  const { sid, advance } = makeSid();
  const v = sid.voices[0];
  sid.write(1, 0x40);
  sid.write(4, 0x80);
  advance(5000);
  assert.notEqual(v.noise, 0x7ffff8);
  sid.write(4, 0x88);
  advance(100);
  assert.equal(v.accumulator, 0);
  sid.write(4, 0x80);
  assert.equal(v.noise, 0x7ffff8);
});

test('Rauschen: LFSR wird durch Bit 19 getaktet', () => {
  const { sid } = makeSid();
  const v = sid.voices[0];
  sid.write(1, 0x08);
  sid.write(4, 0x80);
  const start = v.noise;
  for (let i = 0; i < 0x100000 / 0x800; i++) v.clockOscillator();
  assert.notEqual(v.noise, start);
  const values = new Set();
  for (let i = 0; i < 64; i++) {
    for (let k = 0; k < 0x100000 / 0x800; k++) v.clockOscillator();
    values.add(v.noiseOutput());
  }
  assert.ok(values.size > 32);
});

test('Hard-Sync: Stimme 1 wird beim MSB-Anstieg von Stimme 3 zurückgesetzt', () => {
  const { sid } = makeSid();
  const [v1, , v3] = sid.voices;
  sid.write(4, 0x22);
  sid.write(14 + 1, 0x80);
  sid.write(1, 0x01);
  v3.accumulator = 0x7fffff;
  v1.accumulator = 0x123456;
  for (const v of sid.voices) v.clockOscillator();
  for (const v of sid.voices) v.synchronize();
  assert.equal(v1.accumulator, 0);
});

test('Ringmodulation invertiert das Dreieck-MSB mit der Quellstimme', () => {
  const { sid } = makeSid();
  const [v1, , v3] = sid.voices;
  v1.accumulator = 0x400000;
  v3.accumulator = 0x800000;
  sid.write(4, 0x10);
  const plain = v1.output();
  sid.write(4, 0x14);
  assert.equal(v1.output(), (~plain) & 0xfff);
});

test('ADSR: Attack 0 erreicht 255 nach 255 × 9 Takten, Decay bis Sustain', () => {
  const env = new SIDEnvelope();
  env.writeAttackDecay(0x00);
  env.writeSustainRelease(0x80);
  env.writeControl(1);
  let cycles = 0;
  while (env.level < 255 && cycles < 10000) {
    env.clock();
    cycles++;
  }
  assert.equal(env.level, 255);
  assert.ok(Math.abs(cycles - 255 * RATE_PERIODS[0]) <= RATE_PERIODS[0]);
  for (let i = 0; i < 200000 && env.level !== 0x88; i++) env.clock();
  assert.equal(env.level, 0x88);
  env.writeControl(0);
  for (let i = 0; i < 400000 && env.level !== 0; i++) env.clock();
  assert.equal(env.level, 0);
});

test('OSC3 und ENV3 sind lesbar, Schreibregister liefern abklingenden Busrest', () => {
  const { sid, advance } = makeSid();
  sid.write(14, 0x00);
  sid.write(15, 0x10);
  sid.write(14 + 4, 0x21);
  sid.write(14 + 5, 0x00);
  sid.write(14 + 6, 0xf0);
  advance(3000);
  assert.equal(sid.read(0x1b), sid.voices[2].output() >> 4);
  assert.equal(sid.read(0x1c), sid.voices[2].envelope.level);
  assert.ok(sid.read(0x1c) > 200);
  sid.write(0x00, 0x5a);
  assert.equal(sid.read(0x00), 0x5a);
  advance(0x3000);
  assert.equal(sid.read(0x00), 0x00);
  assert.equal(sid.read(0x19), 0xff);
});

test('Resampling: Anzahl Ausgabesamples entspricht Taktzeit', () => {
  const { sid, advance } = makeSid({ chunkSize: 64 });
  let samples = 0;
  sid.setSink((chunk) => { samples += chunk.length; });
  advance(985248);
  samples += sid.bufferIndex;
  assert.ok(Math.abs(samples - 44100) <= 2, `samples=${samples}`);
});

test('6581: Lautstärkeänderung erzeugt hörbaren Sprung (Digi über $D418)', () => {
  const { sid, advance } = makeSid({ chunkSize: 32 });
  const out = [];
  sid.setSink((chunk) => out.push(...chunk));
  sid.write(0x18, 0x00);
  advance(20000);
  out.length = 0;
  sid.write(0x18, 0x0f);
  advance(2000);
  const peak = Math.max(...out.map(Math.abs));
  assert.ok(peak > 0.05, `peak=${peak}`);
});

test('Filter: Tiefpass dämpft hohe Frequenzen, Kennlinien 6581/8580', () => {
  const run = (frequency, mode) => {
    const filter = new SIDFilter('8580', 44100);
    filter.setCutoff(100);
    filter.setResonance(0);
    filter.setMode(mode);
    let energy = 0;
    for (let i = 0; i < 4410; i++) {
      const out = filter.process(Math.sin((2 * Math.PI * frequency * i) / 44100));
      if (i > 1000) energy += out * out;
    }
    return energy;
  };
  assert.ok(run(100, 0x10) > 10 * run(8000, 0x10));
  assert.ok(run(8000, 0x40) > 10 * run(100, 0x40));
  assert.ok(cutoffHz('6581', 0) > 150 && cutoffHz('6581', 2047) > 10000);
  assert.ok(Math.abs(cutoffHz('8580', 2047) - 12025) < 100);
});
