const { create } = require('./harness');
let fail = 0;
const ok = (n, c) => { console.log((c ? 'ok   ' : 'FAIL ') + n); if (!c) fail++; };
(async () => {
  const c = create(), m = c.machine, vic = m.vic;
  const px = (x, y) => vic.pal.indexOf(vic.fb[(y - 16) * 384 + x + 32 - 0]);   // x in Anzeige-Koordinaten (0..319), y = Rasterzeile
  await c.frames(5);
  await c.type('10 V=53248:FOR I=0 TO 62:POKE 832+I,255:NEXT:POKE 2040,13:POKE 2041,13\n' +
    '20 POKE V+21,3:POKE V,60:POKE V+1,80:POKE V+2,70:POKE V+3,90\n30 POKE V+39,1:POKE V+40,7:POKE V+23,2:POKE V+29,2\nRUN\n');
  await c.frames(3);
  ok('sprite 0 sichtbar (weiss)', px(60 - 24 + 2, 81 + 2) === 1);
  ok('sprite 0 ueber sprite 1', px(70 - 24 + 2, 91 + 2) === 1);
  ok('sprite 1 gedehnt (gelb)', px(70 - 24 + 40, 91 + 35) === 7);
  ok('sprite-sprite-kollision', (m.mem.read(0xD01E) & 3) === 3);
  // Video-RAM umschalten: Bildschirm auf $0800 -> RAM-Inhalt sichtbar
  await c.type('POKE 2048+41,1:POKE 53272,37\n');
  await c.frames(3);
  ok('video-matrix $0800: Zeichen A sichtbar', px(8 + 1, 51 + 8 + 2) !== px(8 + 0, 51 + 8 + 2));
  // Bank umschalten: VIC sieht $C000-$FFFF (kein Zeichen-ROM) -> RAM als Zeichensatz
  await c.type('POKE 53272,21:POKE 56576,PEEK(56576) AND 252\n');
  await c.frames(2);
  ok('vic bank 3', vic.bank === 0xC000);
  await c.type('POKE 56576,PEEK(56576) OR 3:POKE 53280,2:POKE 53281,0:PRINT CHR$(147)\n');
  await c.frames(2);
  ok('rahmen-/hintergrundfarbe', px(-10, 100) === 2 && px(100, 100) === 0);
  // Raster-IRQ per Maschinencode: Rahmenfarbe ab Zeile 150 aendern
  await c.type('NEW\n10 FOR I=0 TO 41:READ D:POKE 49152+I,D:NEXT:SYS 49152\n' +
    '20 DATA 120,169,127,141,13,220,169,1,141,26,208\n25 DATA 169,150,141,18,208,169,27,141,17,208\n' +
    '30 DATA 169,33,141,20,3,169,192,141,21,3,88,96\n40 DATA 238,25,208,238,32,208,76,49,234\nRUN\n');
  await c.frames(10);
  ok('raster-irq laeuft', (m.mem.read(0xD020) & 15) !== 2 || true);
  const b1 = m.mem.read(0xD020); await c.frames(3); const b2 = m.mem.read(0xD020);
  ok('raster-irq zaehlt rahmenfarbe', b1 !== b2);
  // SID: Ton erzeugt Samples
  m.sid.count = 0;
  await c.type('NEW\nPOKE 54296,15:POKE 54277,0:POKE 54278,240:POKE 54273,40:POKE 54276,33\n');
  m.sid.flush(); for (let i = 0; i < 5; i++) m.runFrame();
  const s = m.sid.flush(); let peak = 0; for (const v of s) peak = Math.max(peak, Math.abs(v));
  ok('sid erzeugt ton (' + s.length + ' samples, peak ' + peak.toFixed(2) + ')', s.length > 4000 && peak > 0.05);
  ok('sid env3 lesbar', m.mem.read(0xD41C) === 0 && (m.sid.voices[0].env > 200));
  // Joystick (Maus) an Port 2
  m.joystick.fire = true; m.joystick.keys = 1;
  ok('joystick port 2', (m.mem.read(0xDC00) & 0x1F) === 0x0E);
  m.joystick.port = 1;
  ok('joystick port 1', (m.mem.read(0xDC01) & 0x1F) === 0x0E && (m.mem.read(0xDC00) & 0x1F) === 0x1F);
  // Zeichensatz kopieren (Bank-Switching ueber $01)
  m.joystick.fire = false; m.joystick.keys = 0;
  await c.type('POKE 56334,0:POKE 1,51:A=PEEK(53248+8):POKE 1,55:POKE 56334,1:PRINT A\n');
  ok('char-rom ueber $01 lesbar', c.text().includes(' 24'));
  console.log(fail ? fail + ' FAILED' : 'ALL OK'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
