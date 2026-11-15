import { test, assertEqual, assertTrue } from './harness.js';
import { SID6581 } from '../audio/SID6581.js';

function prepare(model) {
  const sid = new SID6581({ model });
  sid.writeRegister(0x00, 0xff);
  sid.writeRegister(0x01, 0x22);
  sid.writeRegister(0x04, 0x21);
  sid.writeRegister(0x05, 0x0a);
  sid.writeRegister(0x06, 0xf0);
  sid.writeRegister(0x15, 0x07);
  sid.writeRegister(0x16, 0x30);
  sid.writeRegister(0x17, 0xf1);
  sid.writeRegister(0x18, 0x1f);
  return sid;
}

test('SID-Modell-Referenz: 6581 und 8580 teilen digitale Oszillatortakte', () => {
  const oldSID = prepare('6581');
  const newSID = prepare('8580');
  for (let i = 0; i < 100; i += 1) {
    oldSID.tick();
    newSID.tick();
    assertEqual(oldSID.voices[0].accumulator, newSID.voices[0].accumulator);
  }
});

test('SID-Modell-Referenz: Filtercharakteristik wird separat berechnet', () => {
  const oldSID = prepare('6581');
  const newSID = prepare('8580');
  assertTrue(oldSID.filter.alpha !== newSID.filter.alpha);
  assertEqual(oldSID.filter.cutoff, newSID.filter.cutoff);
});
