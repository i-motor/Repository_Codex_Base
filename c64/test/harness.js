/* Test-Harness (Node): laedt die Kernmodule ohne Browser und steuert die Maschine ueber Tastatureingaben */
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'js');
['petscii', 'charrom', 'memory', 'cpu6510', 'cia', 'vic2', 'sid', 'keyboard', 'joystick', 'storage', 'screeneditor',
  'basic-tokenizer', 'basic', 'kernal', 'machine'].forEach((f) => {
  (0, eval)(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'));
});
const C64 = globalThis.C64;

function create() {
  const m = new C64.Machine();
  const api = {
    machine: m,
    async frames(n) { for (let i = 0; i < n; i++) { m.runFrame(); m.sid.flush(); if (i % 5 === 0) await null; } },
    /* Text eintippen und warten, bis die Eingabe verarbeitet ist */
    async type(text, maxFrames) {
      m.keyboard.paste(text);
      for (let i = 0; i < (maxFrames || 3000); i++) {
        m.runFrame(); m.sid.flush(); await null;
        if (!m.keyboard.pasteQueue.length && m.mem.ram[0xC6] === 0 && m.basic.state === 'input' && i > 2) break;
      }
      await api.frames(2);
    },
    screen() {
      const ram = m.mem.ram, base = ram[0x288] << 8, rows = [];
      for (let r = 0; r < 25; r++) {
        let s = '';
        for (let c = 0; c < 40; c++) {
          let p = C64.petscii.fromScreen(ram[base + r * 40 + c] & 0x7F, false);
          if (p >= 193 && p <= 218) p -= 128;
          s += p >= 32 && p < 96 ? String.fromCharCode(p) : '.';
        }
        rows.push(s.replace(/\s+$/, ''));
      }
      return rows;
    },
    text() { return api.screen().join('\n').replace(/\n+$/, ''); }
  };
  return api;
}
module.exports = { C64, create };
