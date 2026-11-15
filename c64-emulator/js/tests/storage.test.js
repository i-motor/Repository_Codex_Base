import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, makeContainer, readContainer } from '../storage/Base64Codec.js';
import { parsePrg, makePrg, injectPrg, parseP00 } from '../storage/PRGLoader.js';
import { classifyFile } from '../storage/FileManager.js';
import { Memory } from '../core/Memory.js';

test('Base64: Rundlauf für alle Restlängen und Vergleich mit Buffer', () => {
  for (let length = 0; length < 40; length++) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
    const text = encode(bytes);
    assert.equal(text, Buffer.from(bytes).toString('base64'));
    assert.deepEqual(Array.from(decode(text)), Array.from(bytes));
  }
  assert.throws(() => decode('ab$c'));
});

test('Base64-Container: Export und Import mit Größenprüfung', () => {
  const files = [{ name: 'EINS', type: 'PRG', data: Uint8Array.from([1, 8, 0xea]) }];
  const json = makeContainer(files);
  const back = readContainer(json);
  assert.equal(back[0].name, 'EINS');
  assert.deepEqual(Array.from(back[0].data), [1, 8, 0xea]);
  const broken = JSON.parse(json);
  broken.files[0].size = 99;
  assert.throws(() => readContainer(JSON.stringify(broken)));
  assert.throws(() => readContainer('{"format":"anders"}'));
});

test('PRG: Ladeadresse, Erzeugung, Injektion setzt BASIC-Zeiger', () => {
  const prg = makePrg(0x0801, Uint8Array.from([1, 2, 3]));
  assert.deepEqual(Array.from(prg), [0x01, 0x08, 1, 2, 3]);
  const parsed = parsePrg(prg);
  assert.equal(parsed.loadAddress, 0x0801);
  assert.equal(parsed.endAddress, 0x0804);
  const memory = new Memory();
  injectPrg(memory, prg);
  assert.equal(memory.ram[0x0802], 2);
  assert.equal(memory.ram[0x2d] | (memory.ram[0x2e] << 8), 0x0804);
  assert.throws(() => parsePrg(Uint8Array.from([0])));
  assert.throws(() => parsePrg(Uint8Array.from([0xff, 0xff, 1, 2])));
});

test('P00-Container und Dateiklassifizierung', () => {
  const header = new Uint8Array(26);
  header.set(Array.from('C64File', (c) => c.charCodeAt(0)), 0);
  header.set(Array.from('NAME', (c) => c.charCodeAt(0)), 8);
  const p00 = new Uint8Array([...header, 0x01, 0x08, 0x00]);
  const parsed = parseP00(p00);
  assert.equal(parsed.name, 'NAME');
  assert.equal(parsed.prg.length, 3);
  assert.equal(classifyFile('x.d64', new Uint8Array(10)), 'd64');
  assert.equal(classifyFile('kernal.rom', new Uint8Array(8192)), 'rom');
  assert.equal(classifyFile('prog.prg', new Uint8Array(10)), 'prg');
  assert.equal(classifyFile('listing.bas', new Uint8Array(10)), 'basic-text');
});
