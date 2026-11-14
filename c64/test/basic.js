const { create, C64 } = require('./harness');
let fail = 0;
function check(name, got, want) {
  const ok = typeof want === 'function' ? want(got) : got.includes(want);
  if (!ok) { fail++; console.log('FAIL ' + name + '\n--- got:\n' + got + '\n--- want: ' + want); } else console.log('ok   ' + name);
}
async function run(prog, extraFrames, keys) {
  const c = create();
  await c.frames(5);
  await c.type('NEW\n' + prog + '\n');
  await c.type('PRINT CHR$(147);:RUN\n');
  if (keys) { await c.frames(20); await c.type(keys); }
  if (extraFrames) await c.frames(extraFrames);
  return c;
}
(async () => {
  let c;
  c = await run('10 GOSUB 100:PRINT "B":END\n100 PRINT "A":RETURN');
  check('gosub', c.text(), 'A\nB\n\nREADY.');
  c = await run('10 READ A,B$,C:PRINT A;B$;C:RESTORE:READ X:PRINT X\n20 DATA 1,"HI, YOU",3.5');
  check('data', c.text(), ' 1 HI, YOU 3.5\n 1');
  c = await run('10 DIM A(5,5):A(2,3)=7:B(10)=4:PRINT A(2,3)+B(10):PRINT B(11)');
  check('arrays', c.text(), ' 11\n\n?BAD SUBSCRIPT  ERROR IN 10');
  c = await run('10 DEF FN S(X)=X*X+1:PRINT FN S(3):A%=7.9:PRINT A%:PRINT 7 AND 3;7 OR 8;NOT 0');
  check('def/int/logic', c.text(), ' 10\n 7\n 3  15 -1');
  c = await run('10 ON 2 GOTO 100,200,300\n100 PRINT "ONE":END\n200 PRINT "TWO":END\n300 PRINT "THREE"');
  check('on goto', c.text(), 'TWO');
  c = await run('10 IF 1=1 THEN PRINT "Y":GOTO 30\n20 PRINT "N"\n30 IF 1=2 THEN PRINT "BAD":PRINT "BAD2"\n40 PRINT "END"');
  check('if', c.text(), (t) => t.includes('Y\nEND') && !t.includes('BAD') && !t.includes('N\n'));
  c = await run('10 PRINT STR$(12)+"A";VAL("3.5E2");ASC("A");CHR$(66);\n15 PRINT RIGHT$("HELLO",3);INT(-1.5);SGN(-3);ABS(-2)\n20 PRINT 100000000;1000000000;.01;.001;1/0');
  check('functions', c.text(), ' 12A 350  65 BLLO-2 -1  2\n 100000000  1E+09  .01  1E-03\n?DIVISION BY ZERO  ERROR IN 20');
  c = await run('10 POKE 1024,1:POKE 55296,1:PRINT\n20 PRINT PEEK(1024);PEEK(53280)AND15;PEEK(53281)AND15;FRE(0)');
  check('poke/peek', c.text(), (t) => t.startsWith('A') && t.includes(' 1  14  6 '));
  c = await run('10 FOR I=3 TO 1 STEP -1:PRINT I;:NEXT I\n15 FOR J=1 TO 2:FOR K=1 TO 2:PRINT J*K;:NEXT K,J\n20 NEXT');
  check('for/next', c.text(), ' 3  2  1  1  2  2  4\n?NEXT WITHOUT FOR  ERROR IN 20');
  c = await run('10 INPUT "NAME";N$,A:PRINT "HI ";N$;A+1', 30, 'BOB,41\n');
  check('input', c.text(), 'NAME? BOB,41\nHI BOB 42');
  c = await run('10 INPUT A:PRINT A*2', 30, 'XY\n5\n');
  check('input redo', c.text(), '?REDO FROM START\n? 5\n 10');
  c = await run('10 GET A$:IF A$="" THEN 10\n20 PRINT "KEY ";A$', 30, 'Q');
  check('get', c.text(), 'KEY Q');
  c = await run('10 PRINT "A";TAB(10);"B";SPC(3);"C":PRINT "X","Y":PRINT TI$;" ";ST');
  check('tab/spc', c.text(), 'A         B   C\nX         Y\n000000  0');
  c = await run('10 A=5:STOP\n20 PRINT "CONT";A', 10, 'CONT\n');
  check('stop/cont', c.text(), 'BREAK IN 10\nREADY.\nCONT\nCONT 5');
  c = await run('10 PRINT 1+"A"');
  check('type mismatch', c.text(), '?TYPE MISMATCH  ERROR IN 10');
  c = await run('10 GOTO 99');
  check('undef', c.text(), "?UNDEF'D STATEMENT  ERROR IN 10");
  // Tokenizer-Abkuerzung, GO TO, ?
  c = await run('10 ?"Q":GO TO 30\n20 ?"NO"\n30 P\xcf 1024,2:?');
  check('abbrev', c.text(), (t) => t.startsWith('B') || t.includes('Q'));
  // Maschinencode: SYS mit Parameteruebergabe, USR, CHROUT
  c = await run('10 FOR I=0 TO 11:READ D:POKE 49152+I,D:NEXT:SYS 49152:PRINT "BACK"\n20 DATA 169,72,32,210,255,169,73,32,210,255,96,0');
  check('sys chrout', c.text(), 'HIBACK');
  c = await run('10 FOR I=0 TO 8:READ D:POKE 49152+I,D:NEXT:SYS 49152,77:PRINT PEEK(251)\n20 DATA 32,253,174,32,158,183,134,251,96');
  check('sys params', c.text(), ' 77');
  // IRQ-Vektor umbiegen: eigener Handler zaehlt $FB hoch und springt nach $EA31
  c = await run('10 FOR I=0 TO 22:READ D:POKE 49152+I,D:NEXT:POKE 251,0:SYS 49152\n15 FOR I=1 TO 300:NEXT:PRINT PEEK(251)>5;TI>0\n20 DATA 120,169,13,141,20,3,169,192,141,21,3,88,96,230,251,76,49,234,0,0,0,0,0');
  check('irq vector', c.text(), '-1 -1');
  // Rasterzeile und CIA-Timer leben
  c = await run('10 A=PEEK(53266):FOR I=1 TO 20:NEXT:B=PEEK(53266):PRINT A<>B\n20 PRINT PEEK(56324)<>PEEK(56324)');
  check('raster/timer', c.text(), '-1\n-1');
  // SAVE / LOAD / Verzeichnis / Dateien (localStorage-Ersatz im Speicher)
  c = create(); await c.frames(5);
  await c.type('10 PRINT "SAVED PROGRAM"\nSAVE "TEST",8\nNEW\nLOAD "TEST",8\n', 600);
  await c.type('PRINT CHR$(147);:RUN\n');
  check('save/load', c.text(), 'SAVED PROGRAM');
  check('base64', C64.storage.toBase64(C64.storage.get('TEST')).slice(0, 4), 'AQgX');
  await c.type('LOAD "$",8\n', 600); await c.type('PRINT CHR$(147);:LIST\n');
  check('directory', c.text(), '"TEST"');
  await c.type('NEW\n10 OPEN 2,8,2,"DAT,S,W":PRINT#2,"HELLO":PRINT#2,42:CLOSE 2\n20 OPEN 2,8,2,"DAT,S,R":INPUT#2,A$,B:CLOSE 2:PRINT A$;B;ST\nPRINT CHR$(147);:RUN\n');
  check('seq files', c.text(), 'HELLO 42');
  console.log(fail ? fail + ' FAILED' : 'ALL OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
