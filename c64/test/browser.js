// Browser-Test (Playwright): echte Tastaturevents, localStorage, Download, Datei-Dialog, Maus-Joystick, Skalierung
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
let fail = 0;
const ok = (n, c, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + n + (c || extra === undefined ? '' : ' -> ' + extra)); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 500 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);
  const text = () => page.evaluate(() => {
    const ram = window.c64.mem.ram; let s = '';
    for (let i = 0; i < 1000; i++) {
      let p = C64.petscii.fromScreen(ram[1024 + i] & 127, false); if (p >= 193 && p <= 218) p -= 128;
      s += (p >= 32 && p < 96 ? String.fromCharCode(p) : '.') + (i % 40 === 39 ? '\n' : '');
    }
    return s;
  });
  const type = async (t) => { await page.keyboard.type(t, { delay: 12 }); await page.waitForTimeout(500); };

  await type('10 print "hallo";2*3:rem (ok)\n');
  await type('save "demo",8\n');
  const stored = await page.evaluate(() => localStorage.getItem('c64disk:DEMO'));
  ok('SAVE -> localStorage als Base64', /^AQg[A-Za-z0-9+/=]+$/.test(stored || ''), stored);
  await type('new\nload "demo",8\n');
  await page.waitForTimeout(600);
  await type('run\n');
  ok('LOAD + RUN', (await text()).includes('HALLO 6'), await text());

  const [download] = await Promise.all([page.waitForEvent('download'), type('save "band"\n')]);
  const file = path.join(require('os').tmpdir(), 'c64-band.b64');
  await download.saveAs(file);
  ok('SAVE (Geraet 1) -> Download ' + download.suggestedFilename(), /^AQg/.test(fs.readFileSync(file, 'utf8')));

  await type('new\n');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), type('load\n')]);
  await chooser.setFiles(file);
  await page.waitForTimeout(800);
  await type('list\n');
  ok('LOAD (Geraet 1) <- Datei-Dialog', (await text()).includes('10 PRINT "HALLO";2*3:REM (OK)'), await text());

  await page.mouse.move(300, 200); await page.waitForTimeout(300); await page.mouse.move(340, 200, { steps: 4 });
  const joy = await page.evaluate(() => window.c64.mem.read(0xDC00) & 0x1F);
  await page.mouse.down();
  const joy2 = await page.evaluate(() => window.c64.mem.read(0xDC00) & 0x1F);
  await page.mouse.up();
  ok('Maus rechts -> Joystick rechts', joy === 0x17, joy);
  ok('Maustaste -> Feuer', (joy2 & 0x10) === 0, joy2);

  const size = async () => page.evaluate(() => { const r = document.getElementById('screen').getBoundingClientRect(); return [r.width, r.height, r.left, r.top]; });
  let s = await size();
  ok('Canvas proportional (breit)', s[1] === 500 && Math.abs(s[0] / s[1] - 384 / 272) < 0.01 && Math.abs(s[2] - (900 - s[0]) / 2) < 1, s);
  await page.setViewportSize({ width: 400, height: 700 });
  await page.waitForTimeout(200);
  s = await size();
  ok('Canvas proportional (hoch)', s[0] === 400 && Math.abs(s[0] / s[1] - 384 / 272) < 0.01, s);

  const t = await page.evaluate(() => { const t0 = performance.now(); for (let i = 0; i < 100; i++) window.c64.runFrame(); window.c64.sid.flush(); return (performance.now() - t0) / 100; });
  ok('Rechenzeit je Frame ' + t.toFixed(2) + ' ms', t < 10);
  ok('keine JS-Fehler', errors.length === 0, errors.join('; '));
  await browser.close();
  console.log(fail ? fail + ' FAILED' : 'ALL OK'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
