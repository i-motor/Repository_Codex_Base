/* petscii.js - Umrechnung PETSCII <-> Bildschirmcode <-> ASCII */
(function (C64) {
  'use strict';
  const P = {};

  /* PETSCII -> Bildschirmcode (druckbare Zeichen) */
  P.toScreen = function (c) {
    if (c < 32) return c | 0x80;            // Steuerzeichen (nur im Quote-Modus sichtbar)
    if (c < 64) return c;
    if (c < 96) return c - 64;
    if (c < 128) return c - 32;
    if (c < 160) return (c - 64) | 0x80;    // Steuerzeichen >= 128 (Quote-Modus)
    if (c < 192) return c - 64;
    if (c < 255) return c - 128;
    return 94;                              // Pi
  };

  /* Bildschirmcode -> PETSCII. inQuote: reverse Zeichen werden zu Steuercodes */
  P.fromScreen = function (s, inQuote) {
    if (inQuote && (s & 0x80)) {
      const t = s & 0x7f;
      if (t < 32) return t;
      if (t >= 64 && t < 96) return t + 64;
    }
    s &= 0x7f;
    if (s < 32) return s + 64;
    if (s < 64) return s;
    if (s < 96) return s + 128;
    return s + 64;
  };

  /* ASCII/Unicode-Text -> PETSCII-Bytes (fuer Einfuegen, Dateinamen) */
  P.fromAscii = function (str) {
    const out = [];
    for (const ch of str) {
      let c = ch.charCodeAt(0);
      if (c === 10) c = 13;
      else if (c === 13) continue;
      else if (c === 9) c = 32;
      else if (c >= 97 && c <= 122) c -= 32;
      else if (ch === '^') c = 94;
      else if (ch === '_') c = 95;
      else if (ch === 'π' || ch === '~') c = 255;
      else if (ch === '£' || ch === '\\') c = 92;
      else if (c < 32 || c > 93) continue;
      out.push(c);
    }
    return out;
  };

  /* PETSCII-String (Zeichencodes 0-255) -> ASCII (Dateinamen, Log) */
  P.toAscii = function (s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 193 && c <= 218) c -= 128;
      if (c >= 32 && c < 127) out += String.fromCharCode(c);
      else out += '_';
    }
    return out;
  };

  P.str = function (bytes) { return String.fromCharCode.apply(null, bytes); };

  C64.petscii = P;
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
