import { CONTROL_BY_NAME, PI_TOKEN, TOKENS, TOKEN_BASE } from './BASICV2.js';

export function asciiToPetscii(ch) {
  const code = ch.charCodeAt(0);
  if (ch === '£') return 0x5c;
  if (ch === '↑') return 0x5e;
  if (ch === '←') return 0x5f;
  if (ch === 'π') return PI_TOKEN;
  if (code >= 0x61 && code <= 0x7a) return code - 0x20;
  if (code >= 0x20 && code <= 0x5d) return code;
  if (ch === '^') return 0x5e;
  if (ch === '_') return 0x5f;
  if (ch === '\\') return 0x5c;
  return 0x20;
}

function readEscape(text, index) {
  const end = text.indexOf('}', index);
  if (end < 0) {
    return null;
  }
  const body = text.slice(index + 1, end).trim();
  let code = null;
  if (/^\$[0-9a-f]{1,2}$/i.test(body)) {
    code = parseInt(body.slice(1), 16);
  } else if (/^[0-9]{1,3}$/.test(body)) {
    code = Number(body);
  } else if (CONTROL_BY_NAME[body.toUpperCase()] !== undefined) {
    code = CONTROL_BY_NAME[body.toUpperCase()];
  }
  if (code === null || code > 255) {
    return null;
  }
  return { code, length: end - index + 1 };
}

export function tokenizeLine(content) {
  const out = [];
  const upper = content.toUpperCase();
  let i = 0;
  let quoted = false;
  let mode = 'normal';
  while (i < content.length) {
    const ch = content[i];
    if (ch === '{') {
      const escape = readEscape(content, i);
      if (escape) {
        out.push(escape.code);
        i += escape.length;
        continue;
      }
    }
    if (ch === '"') {
      quoted = !quoted;
      out.push(0x22);
      i++;
      continue;
    }
    if (quoted || mode === 'rem') {
      out.push(asciiToPetscii(ch));
      i++;
      continue;
    }
    if (mode === 'data') {
      if (ch === ':') {
        mode = 'normal';
      }
      out.push(asciiToPetscii(ch));
      i++;
      continue;
    }
    if (ch === '?') {
      out.push(TOKEN_BASE + TOKENS.indexOf('PRINT'));
      i++;
      continue;
    }
    if (ch === 'π') {
      out.push(PI_TOKEN);
      i++;
      continue;
    }
    let matched = -1;
    for (let t = 0; t < TOKENS.length; t++) {
      const word = TOKENS[t];
      if (upper.startsWith(word, i)) {
        matched = t;
        break;
      }
    }
    if (matched >= 0) {
      out.push(TOKEN_BASE + matched);
      i += TOKENS[matched].length;
      if (TOKENS[matched] === 'REM') mode = 'rem';
      else if (TOKENS[matched] === 'DATA') mode = 'data';
      continue;
    }
    out.push(asciiToPetscii(ch));
    i++;
  }
  return out;
}

export function tokenize(text, { loadAddress = 0x0801 } = {}) {
  const lines = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^\s*(\d+)\s?(.*)$/);
    if (!match) {
      throw new Error(`Zeile ohne Zeilennummer: ${line}`);
    }
    const number = Number(match[1]);
    if (number > 63999) {
      throw new Error(`Zeilennummer zu groß: ${number}`);
    }
    lines.push({ number, bytes: tokenizeLine(match[2]) });
  }
  lines.sort((a, b) => a.number - b.number);
  const out = [loadAddress & 0xff, loadAddress >> 8];
  let address = loadAddress;
  for (const line of lines) {
    const next = address + 4 + line.bytes.length + 1;
    out.push(next & 0xff, next >> 8, line.number & 0xff, line.number >> 8, ...line.bytes, 0);
    address = next;
  }
  out.push(0, 0);
  return new Uint8Array(out);
}
