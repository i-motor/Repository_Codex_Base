// Screenshot im echten Browser (Playwright): node test/shot.js <ausgabe.png> [tastatureingabe] [breite] [hoehe]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [out, keys, w, h] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w || 1000, height: +h || 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(1500);
  if (keys) {
    await page.evaluate((k) => window.c64.keyboard.paste(k), keys);
    await page.waitForTimeout(6000);
  }
  await page.screenshot({ path: out });
  const box = await page.evaluate(() => { const r = document.getElementById('screen').getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight]; });
  console.log('canvas/window', box.join(' '), 'errors', errors);
  await browser.close();
})();
