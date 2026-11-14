/* basic-tokenizer.js - BASIC-V2-Schluesselwoerter, Tokenizer (CRUNCH) und Detokenizer (LIST) */
(function (C64) {
  'use strict';
  const KEYWORDS = ['END', 'FOR', 'NEXT', 'DATA', 'INPUT#', 'INPUT', 'DIM', 'READ', 'LET', 'GOTO', 'RUN', 'IF',
    'RESTORE', 'GOSUB', 'RETURN', 'REM', 'STOP', 'ON', 'WAIT', 'LOAD', 'SAVE', 'VERIFY', 'DEF', 'POKE', 'PRINT#',
    'PRINT', 'CONT', 'LIST', 'CLR', 'CMD', 'SYS', 'OPEN', 'CLOSE', 'GET', 'NEW', 'TAB(', 'TO', 'FN', 'SPC(',
    'THEN', 'NOT', 'STEP', '+', '-', '*', '/', '^', 'AND', 'OR', '>', '=', '<', 'SGN', 'INT', 'ABS', 'USR', 'FRE',
    'POS', 'SQR', 'RND', 'LOG', 'EXP', 'COS', 'SIN', 'TAN', 'ATN', 'PEEK', 'LEN', 'STR$', 'VAL', 'ASC', 'CHR$',
    'LEFT$', 'RIGHT$', 'MID$', 'GO'];
  const KW = KEYWORDS.map((k) => Array.from(k).map((ch) => ch.charCodeAt(0)));
  const T = {};
  KEYWORDS.forEach((k, i) => { T[k.replace('(', '').replace('#', 'N').replace('$', 'S')] = 0x80 + i; });
  T.PLUS = 0xAA; T.MINUS = 0xAB; T.MUL = 0xAC; T.DIV = 0xAD; T.POW = 0xAE; T.GT = 0xB1; T.EQ = 0xB2; T.LT = 0xB3; T.PI = 0xFF;

  /* PETSCII-Zeile -> Token-Bytes */
  function tokenize(line) {
    const out = [], n = line.length;
    let i = 0, quote = false, data = false;
    outer:
    while (i < n) {
      const c = line[i];
      if (quote) { out.push(c); if (c === 34) quote = false; i++; continue; }
      if (c === 34) { quote = true; out.push(c); i++; continue; }
      if (c === 32) { out.push(c); i++; continue; }
      if (data) { if (c === 58) data = false; out.push(c); i++; continue; }
      if (c === 63) { out.push(T.PRINT); i++; continue; }
      if (c >= 48 && c <= 59) { out.push(c); i++; continue; }
      if (c >= 128) { if (c === 255) out.push(255); i++; continue; }
      for (let k = 0; k < KW.length; k++) {
        const w = KW[k];
        let j = 0, used = 0;
        for (;;) {
          if (j === w.length) { used = j; break; }
          const ch = line[i + j];
          if (ch === w[j]) { j++; continue; }
          if (j > 0 && ch === (w[j] | 0x80)) used = j + 1;   // Abkuerzung (z.B. pO = POKE)
          break;
        }
        if (!used) continue;
        i += used;
        const tok = 0x80 + k;
        out.push(tok);
        if (tok === T.REM) { while (i < n) out.push(line[i++]); break outer; }
        if (tok === T.DATA) data = true;
        continue outer;
      }
      out.push(c); i++;
    }
    return out;
  }

  /* Token-Bytes (ab Index, bis 0) -> PETSCII-Bytes */
  function detokenize(mem, addr) {
    const out = [];
    let quote = false;
    for (let c; (c = mem[addr]) !== 0; addr++) {
      if (c === 34) quote = !quote;
      if (!quote && c >= 0x80 && c <= 0xCB) { out.push(...KW[c - 0x80]); continue; }
      if (!quote && c === 0xFF) { out.push(255); continue; }
      if (!quote && c > 0xCB) continue;
      out.push(c);
    }
    return out;
  }

  C64.basicTokens = { KEYWORDS: KEYWORDS, T: T, tokenize: tokenize, detokenize: detokenize };
})(typeof window !== 'undefined' ? (window.C64 = window.C64 || {}) : (globalThis.C64 = globalThis.C64 || {}));
