import { test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { SIDEnvelope, SID_RATES } from '../audio/SIDEnvelope.js';
import { SIDVoice } from '../audio/SIDVoice.js';
import { SID6581 } from '../audio/SID6581.js';
import { SIDFilter } from '../audio/SIDFilter.js';
import { C64 } from '../core/C64.js';

function runSID(sid, cycles) {
  for (let i = 0; i < cycles; i += 1) sid.tick();
}

function tone(sid, voice = 0, freq = 0x1d46, waveform = 0x21) {
  const base = voice * 7;
  sid.writeRegister(base, freq & 255);
  sid.writeRegister(base + 1, freq >>> 8);
  sid.writeRegister(base + 5, 0);
  sid.writeRegister(base + 6, 0xf0);
  sid.writeRegister(base + 4, waveform);
}

test('SID besitzt drei unabhängige Stimmen, genau 32 Register und einen 6581-Filter', () => {
  const s = new SID6581();
  assertEqual(s.voices.length, 3);
  assertEqual(s.registers.length, 32);
  assertEqual(s.filter.model, '6581');
  assertEqual(s.cycles, 0);
});

test('SID-Register sind im I/O-Bereich alle 32 Bytes gespiegelt', () => {
  const m = new C64();
  m.bus.cpuWrite(0xd400, 0x34);
  m.bus.cpuWrite(0xd420, 0x56);
  m.bus.cpuWrite(0xd7c1, 0x12);
  assertEqual(m.sid.voices[0].frequency, 0x1256);
  assertEqual(m.sid.registers[0], 0x56);
  assertEqual(m.bus.devices.get('sid'), m.sid);
});

test('CPU-I/O-Banking blendet SID-Register aus und schaltet auf RAM zurück', () => {
  const m = new C64();
  m.processorPort.writePins(0x30);
  m.bus.cpuWrite(0xd400, 0x77);
  assertEqual(m.memory.readRAM(0xd400), 0x77);
  assertEqual(m.sid.registers[0], 0);
  m.processorPort.writePins(0x37);
  m.bus.cpuWrite(0xd400, 0x55);
  assertEqual(m.sid.registers[0], 0x55);
  assertEqual(m.memory.readRAM(0xd400), 0x77);
});

test('SID-Frequenzregister bilden einen 16-Bit-Phasenzuwachs pro CPU-Takt', () => {
  const s = new SID6581();
  tone(s, 0, 0x1234);
  runSID(s, 10);
  assertEqual(s.voices[0].accumulator, 0x1234 * 10);
  assertEqual(s.voices[1].accumulator, 0);
  assertEqual(s.voices[2].accumulator, 0);
});

test('SID-Frequenz 0x1D46 entspricht etwa 440 Hz bei PAL-Takt', () => {
  const hz = 0x1d46 * 985248.44 / 16777216;
  assertTrue(hz > 439 && hz < 441);
});

test('SID-Phasenakkumulator läuft exakt nach 24 Bit um', () => {
  const v = new SIDVoice();
  v.frequency = 0xffff;
  v.accumulator = 0xfffffe;
  v.clockOscillator(false, false);
  assertEqual(v.accumulator, 0x00fffd);
});

test('Dreieckswelle faltet ihre 12-Bit-Amplitude', () => {
  const v = new SIDVoice();
  v.setControl(0x10);
  v.accumulator = 0x000000;
  assertEqual(v.generateWaveform(false), 0);
  v.accumulator = 0x7ff800;
  assertEqual(v.generateWaveform(false), 0xfff);
  v.accumulator = 0x800000;
  assertEqual(v.generateWaveform(false), 0xfff);
  v.accumulator = 0xfff800;
  assertEqual(v.generateWaveform(false), 0);
});

test('Ringmodulation invertiert die Dreiecksamplitude mit dem Modulator-MSB', () => {
  const v = new SIDVoice();
  v.setControl(0x14);
  v.accumulator = 0x200000;
  assertEqual(v.generateWaveform(false), 0x400);
  assertEqual(v.generateWaveform(true), 0xbff);
});

test('Sägezahn liefert das obere 12-Bit-Phasenwort', () => {
  const v = new SIDVoice();
  v.setControl(0x20);
  v.accumulator = 0xabc000;
  assertEqual(v.generateWaveform(), 0xabc);
});

test('Pulswelle reagiert auf die 12-Bit-Pulsbreite', () => {
  const v = new SIDVoice();
  v.setControl(0x40);
  v.pulseWidth = 0x400;
  v.accumulator = 0x3ff000;
  assertEqual(v.generateWaveform(), 4095);
  v.accumulator = 0x400000;
  assertEqual(v.generateWaveform(), 0);
});

test('NOISE-LFSR wird nur durch steigende Oszillator-Bit-19-Flanke getaktet', () => {
  const v = new SIDVoice();
  v.setControl(0x80);
  v.frequency = 1;
  v.accumulator = 0x07fffe;
  const before = v.noiseRegister;
  v.clockOscillator(false, false);
  assertEqual(v.noiseRegister, before);
  v.clockOscillator(false, false);
  assertTrue(v.noiseRegister !== before);
});

test('Kombinierte Wellenformen verwenden deterministische 12-Bit-Verknüpfung', () => {
  const v = new SIDVoice();
  v.setControl(0x30);
  v.accumulator = 0x200000;
  assertEqual(v.generateWaveform(), 0x200 & 0x400);
});

test('TEST-Bit hält den Akkumulator an und setzt den Rauschzustand zurück', () => {
  const v = new SIDVoice();
  v.frequency = 300;
  v.accumulator = 0x345678;
  v.setControl(0x28);
  v.clockOscillator(false, false);
  assertEqual(v.accumulator, 0);
  assertEqual(v.noiseRegister, 0x7ffff8);
  v.setControl(0x20);
  v.clockOscillator(false, false);
  assertEqual(v.accumulator, 300);
});

test('SYNC setzt die Zielphase bei steigender MSB-Flanke der Quellstimme zurück', () => {
  const s = new SID6581();
  s.voices[0].frequency = 100;
  s.voices[0].accumulator = 0x801000;
  s.voices[1].frequency = 30;
  s.voices[1].accumulator = 0x7ffff0;
  s.voices[2].frequency = 50;
  s.voices[2].accumulator = 400;
  s.voices[2].setControl(2);
  s.tick();
  assertEqual(s.voices[2].accumulator, 0);
});

test('ADSR-Attack benutzt alle 16 dokumentierten Rate-Perioden', () => {
  const e = new SIDEnvelope();
  for (let rate = 0; rate < 16; rate += 1) {
    e.reset();
    e.setAD(rate << 4);
    e.setGate(true);
    for (let i = 0; i < SID_RATES[rate] - 1; i += 1) e.tick();
    assertEqual(e.level, 0, `Rate ${rate} vor Abschluss`);
    e.tick();
    assertEqual(e.level, 1, `Rate ${rate} nach Abschluss`);
  }
});

test('ADSR wechselt von Attack in Decay bei Level 255', () => {
  const e = new SIDEnvelope();
  e.setAD(0);
  e.setSR(0xf0);
  e.setGate(true);
  for (let i = 0; i < 255 * 9; i += 1) e.tick();
  assertEqual(e.level, 255);
  assertEqual(e.state, 'decay');
});

test('Decay hält den 4-Bit-Sustainpegel und Release senkt ihn ab', () => {
  const e = new SIDEnvelope();
  e.setAD(0);
  e.setSR(0x80);
  e.setGate(true);
  for (let i = 0; i < 30000; i += 1) e.tick();
  assertEqual(e.level, 136);
  e.setGate(false);
  for (let i = 0; i < 500; i += 1) e.tick();
  assertTrue(e.level < 136);
});

test('ADSR-Ratecounter wird bei Gate-Wechsel nicht künstlich zurückgesetzt', () => {
  const e = new SIDEnvelope();
  e.setAD(0x10);
  e.setGate(true);
  for (let i = 0; i < 13; i += 1) e.tick();
  assertEqual(e.rateCounter, 13);
  e.setGate(false);
  assertEqual(e.rateCounter, 13);
  e.setGate(true);
  assertEqual(e.rateCounter, 13);
});

test('Release aus Null darf nicht auf Level 255 unterlaufen', () => {
  const e = new SIDEnvelope();
  e.setGate(true);
  e.setGate(false);
  for (let i = 0; i < 900; i += 1) e.tick();
  assertEqual(e.level, 0);
});

test('SID-POTX, POTY, OSC3 und ENV3 sind lesbar', () => {
  const s = new SID6581();
  s.setPaddles(17, 210);
  assertEqual(s.readRegister(0x19), 17);
  assertEqual(s.readRegister(0x1a), 210);
  tone(s, 2, 0x5000, 0x21);
  runSID(s, 1000);
  assertEqual(s.readRegister(0x1b), s.voices[2].waveform >>> 4);
  assertEqual(s.readRegister(0x1c), s.voices[2].envelope.level);
});

test('SID-Buslatch ist auf schreibgeschützten Registeradressen nur vorübergehend lesbar', () => {
  const s = new SID6581();
  s.writeRegister(0, 0xa5);
  assertEqual(s.peekRegister(0), 0xa5);
  runSID(s, 8192);
  assertEqual(s.peekRegister(0), 0);
});

test('SID-peek verändert weder Buslatch noch Zeitstempel', () => {
  const s = new SID6581();
  s.writeRegister(0, 0x4c);
  const start = s.latchCycle;
  s.peekRegister(0x1b);
  assertEqual(s.latchCycle, start);
  assertEqual(s.peekRegister(0), 0x4c);
});

test('D418-Masterlautstärke Null erzeugt digitales Schweigen', () => {
  const s = new SID6581();
  tone(s);
  s.writeRegister(0x18, 0);
  for (let i = 0; i < 2000; i += 1) assertEqual(s.tick(), 0);
});

test('D418-Lautstärke skaliert die unverfilterte Stimme', () => {
  const s = new SID6581();
  s.filter.configure(0, 0, 0, 15);
  const one = s.filter.process(1, 0, 0);
  s.filter.configure(0, 0, 0, 5);
  const two = s.filter.process(1, 0, 0);
  assertTrue(Math.abs(one / two - 3) < 0.00001);
});

test('SID-Filter-Cutoff verwendet D415 Bits 0–2 und D416 Bits 3–10', () => {
  const s = new SID6581();
  s.writeRegister(0x15, 0xff);
  s.writeRegister(0x16, 0x80);
  assertEqual(s.filter.cutoff, 0x407);
});

test('Filter-Resonanz und Stimmenrouting werden aus D417 gelesen', () => {
  const s = new SID6581();
  s.writeRegister(0x17, 0xb5);
  assertEqual(s.filter.resonance, 11);
  assertEqual(s.filter.routing, 5);
});

test('Tiefpass, Bandpass und Hochpass erzeugen voneinander abweichende Ausgänge', () => {
  const outputs = [];
  for (const mode of [0x10, 0x20, 0x40]) {
    const f = new SIDFilter();
    f.configure(1200, 1, mode, 15);
    let out = 0;
    for (let i = 0; i < 1000; i += 1) out = f.process(0.5, 0, 0);
    outputs.push(out);
  }
  assertTrue(outputs.every(value => Number.isFinite(value)));
  assertTrue(new Set(outputs.map(value => value.toFixed(5))).size >= 2);
});

test('VOICE3-OFF unterdrückt nur ungefilterte dritte Stimme', () => {
  const f = new SIDFilter();
  f.configure(800, 0, 0x80, 15);
  assertEqual(f.process(0, 0, 1), 0);
  f.configure(800, 4, 0x90, 15);
  let nonzero = 0;
  for (let i = 0; i < 1000; i += 1) nonzero = f.process(0, 0, 1);
  assertTrue(nonzero > 0);
});

test('SID-Modell kann zwischen 6581 und angenähertem 8580 wechseln', () => {
  const f = new SIDFilter();
  f.configure(1024, 0, 0x10, 15);
  const alpha = f.alpha;
  f.setModel('8580');
  assertTrue(f.alpha !== alpha);
  assertEqual(f.model, '8580');
  assertThrows(() => f.setModel('invalid'), RangeError);
});

test('SID-Power-On und Hardware-Reset löschen Register, Phasen und Samplebuffer', () => {
  const m = new C64();
  m.bus.cpuWrite(0xd400, 0xef);
  m.runCycles(1000);
  assertTrue(m.sidResampler.available > 0);
  m.reset();
  assertEqual(m.sid.registers[0], 0);
  assertEqual(m.sid.cycles, 0);
  assertEqual(m.sidResampler.available, 0);
});

test('SID wird mit jedem globalen Master-Zyklus genau einmal fortgeschaltet', () => {
  const m = new C64();
  m.runCycles(240);
  assertEqual(m.sid.cycles, 240);
  assertEqual(m.sidResampler.generated, Math.floor(240 * 48000 / m.clock.profile.cpuHz));
});

test('SID-Sounddemo wird ausschließlich von echten 6510-Befehlen initialisiert', () => {
  const m = new C64();
  const size = m.loadSIDDemo();
  assertTrue(size > 100);
  assertEqual(m.sid.registers[0x18], 0);
  m.runCycles(5000);
  assertEqual(m.sid.registers[0x18], 0x1f);
  assertEqual(m.sid.voices[0].frequency, 0x1168);
  assertEqual(m.sid.voices[1].frequency, 0x15ec);
  assertEqual(m.sid.voices[2].frequency, 0x1d46);
  assertTrue(m.sid.voices[0].envelope.level > 0);
  assertTrue(m.sidResampler.takeSamples().some(value => Math.abs(value) > 0.00001));
});
