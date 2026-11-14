/* main.js - Start: Canvas-Skalierung, Frame-Schleife, Ton, Drag & Drop, Hotkeys, Bildschirmmeldungen */
(function (C64) {
  'use strict';
  const FRAME_MS = 1000 / (985248 / (312 * 63));   // PAL: ca. 50,12 Hz

  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('screen');
    const machine = new C64.Machine();
    const vic = machine.vic;
    const audio = new C64.AudioOut(machine.sid);
    canvas.width = vic.width; canvas.height = vic.height;
    const ctx = canvas.getContext('2d');
    const image = new ImageData(new Uint8ClampedArray(vic.fb.buffer), vic.width, vic.height);
    let turbo = false, osdText = '', osdFrames = 0;

    // Canvas proportional an das Fenster anpassen
    function resize() {
      const s = Math.min(window.innerWidth / vic.width, window.innerHeight / vic.height);
      canvas.style.width = Math.floor(vic.width * s) + 'px';
      canvas.style.height = Math.floor(vic.height * s) + 'px';
    }
    window.addEventListener('resize', resize);
    resize();

    function osd(text) { osdText = text.toUpperCase(); osdFrames = 120; }

    /* Meldung mit dem Zeichensatz direkt in den Bildpuffer zeichnen */
    function drawOsd() {
      const fb = vic.fb, W = vic.width, rom = machine.mem.charRom;
      const x0 = 8, y0 = vic.height - 18, w = osdText.length * 8 + 8;
      for (let y = 0; y < 12; y++) fb.fill(0xFF000000, (y0 + y) * W + x0, (y0 + y) * W + x0 + w);
      for (let i = 0; i < osdText.length; i++) {
        const sc = C64.petscii.toScreen(osdText.charCodeAt(i)) & 0x7F;
        for (let y = 0; y < 8; y++) {
          const bits = rom[sc * 8 + y];
          for (let x = 0; x < 8; x++) if (bits & (0x80 >> x)) fb[(y0 + 2 + y) * W + x0 + 4 + i * 8 + x] = 0xFFFFFFFF;
        }
      }
    }

    machine.keyboard.attach(window);
    machine.joystick.attach(window);
    machine.keyboard.onHotkey = (code) => {
      if (code === 'KeyJ') { machine.joystick.port = machine.joystick.port === 2 ? 1 : 2; osd('JOYSTICK PORT ' + machine.joystick.port); return true; }
      if (code === 'KeyT') { turbo = !turbo; osd(turbo ? 'TURBO ON' : 'TURBO OFF'); return true; }
      if (code === 'KeyR') { machine.reset(); osd('RESET'); return true; }
      return false;
    };
    const wake = () => audio.start();
    window.addEventListener('keydown', wake);
    window.addEventListener('mousedown', wake);

    // Dateien per Drag & Drop: PRG (binaer oder Base64) oder 4-KB-Zeichensatz
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      C64.storage.readFile(f).then((r) => {
        if (r.bytes.length === 4096) { machine.mem.charRom.set(r.bytes); osd('CHARSET ' + r.name); return; }
        const addr = machine.loadPrg(r.bytes);
        osd(addr < 0 ? 'LOAD ERROR' : 'LOADED ' + r.name + ' AT ' + addr);
      });
    });

    let last = performance.now(), acc = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      acc += now - last; last = now;
      if (acc > 200) acc = FRAME_MS;
      if (turbo) {
        const t0 = performance.now();
        while (performance.now() - t0 < 12) machine.runFrame();
        machine.sid.flush(); acc = 0;
      } else {
        while (acc >= FRAME_MS) {
          machine.runFrame();
          audio.push(machine.sid.flush());
          acc -= FRAME_MS;
        }
      }
      if (osdFrames > 0) { osdFrames--; drawOsd(); }
      ctx.putImageData(image, 0, 0);
    }
    requestAnimationFrame(frame);

    window.c64 = machine;   // fuer die Entwicklerkonsole
  });
})(window.C64 = window.C64 || {});
