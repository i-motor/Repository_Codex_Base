import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, asciiToPetscii } from '../basic/BasicTokenizer.js';
import { detokenize, TOKENS, readProgram } from '../basic/BASICV2.js';

test('Tokentabelle umfasst $80–$CB', () => {
  assert.equal(TOKENS.length, 0xcb - 0x80 + 1);
  assert.equal(TOKENS[0x99 - 0x80], 'PRINT');
  assert.equal(TOKENS[0x9e - 0x80], 'SYS');
  assert.equal(TOKENS[0xcb - 0x80], 'GO');
});

test('Tokenisierung: Schlüsselwörter, Strings, Zeilenverkettung', () => {
  const prg = tokenize('10 PRINT "HELLO"\n20 GOTO 10');
  assert.deepEqual(Array.from(prg), [
    0x01, 0x08,
    0x0f, 0x08, 0x0a, 0x00, 0x99, 0x20, 0x22, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x22, 0x00,
    0x18, 0x08, 0x14, 0x00, 0x89, 0x20, 0x31, 0x30, 0x00,
    0x00, 0x00
  ]);
});

test('REM und DATA werden nicht tokenisiert, ? wird zu PRINT', () => {
  const prg = tokenize('10 REM PRINT\n20 DATA TO,1:PRINT\n30 ?1');
  const text = detokenize(prg).text;
  assert.equal(text, '10 REM PRINT\n20 DATA TO,1:PRINT\n30 PRINT1');
  assert.ok(prg.includes(0x8f));
  const line2 = Array.from(prg).indexOf(0x83);
  assert.equal(prg[line2 + 2], 0x54);
});

test('Steuerzeichen-Escapes und Detokenizer-Rundlauf', () => {
  const source = '10 PRINT "{clr}{rvs on}X"\n20 POKE 53280,0:SYS 49152';
  const prg = tokenize(source);
  assert.ok(prg.includes(0x93));
  assert.ok(prg.includes(0x12));
  assert.equal(detokenize(prg).text, source);
  assert.equal(asciiToPetscii('a'), 0x41);
});

test('Programm aus dem Speicher lesen (Zeiger $2B/$2D)', () => {
  const ram = new Uint8Array(65536);
  const prg = tokenize('10 END');
  ram.set(prg.subarray(2), 0x0801);
  ram[0x2b] = 0x01;
  ram[0x2c] = 0x08;
  const end = 0x0801 + prg.length - 2;
  ram[0x2d] = end & 0xff;
  ram[0x2e] = end >> 8;
  assert.deepEqual(Array.from(readProgram({ ram })), Array.from(prg));
});
