import { test, assertEqual, assertBytes, assertTrue } from './harness.js';
import { D64Image } from '../storage/D64Image.js';
import { GCRCodec } from '../drive1541/GCRCodec.js';

function makeDisk() {
  return D64Image.create({ name: 'DISK TEST' });
}

test('D64-Referenz: freier BAM-Sektor wird bei PRG-Write belegt', () => {
  const image = makeDisk();
  const before = image.freeBlocks();
  image.writePRG('ONE', Uint8Array.of(1,8,5));
  assertEqual(image.freeBlocks(), before - 1);
  assertEqual(image.isFree(1,0), false);
});

test('D64-Referenz: Partielle letzte Sektorlänge 254 Byte', () => {
  const image = makeDisk();
  const data = Uint8Array.from({ length: 254 }, (_, i) => i);
  image.writePRG('FULL', data);
  assertBytes(image.readPRG('FULL'), data);
  const entry = image.listDirectory()[0];
  assertEqual(image.readSector(entry.track, entry.sector)[1], 255);
});

test('D64-Referenz: Partielle letzte Sektorlänge 1 Byte', () => {
  const image = makeDisk();
  image.writePRG('SHORT', Uint8Array.of(0xff,0xaa));
  const entry = image.listDirectory()[0];
  assertEqual(image.readSector(entry.track, entry.sector)[1], 3);
});

test('GCR-Referenz: alle 256 möglichen Bytewerte verlustfrei', () => {
  const source = Uint8Array.from({ length: 256 }, (_, index) => index);
  assertBytes(GCRCodec.decode(GCRCodec.encode(source)), source);
});
