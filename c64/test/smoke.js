const { create } = require('./harness');
(async () => {
  const c = create();
  await c.frames(10);
  await c.type('10 FOR I=1 TO 3:PRINT I;I*I,"X":NEXT\n20 A$="HELLO":PRINT LEFT$(A$,2)+MID$(A$,3);LEN(A$);1/3;-2^2;1E10;.5\nLIST\nRUN\n');
  console.log(c.text());
})().catch((e) => { console.error(e); process.exit(1); });
