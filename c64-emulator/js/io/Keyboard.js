const MATRIX_ROWS = Object.freeze([
  ['DELETE', 'RETURN', 'CURSOR_RIGHT', 'F7', 'F1', 'F3', 'F5', 'CURSOR_DOWN'],
  ['3', 'W', 'A', '4', 'Z', 'S', 'E', 'LEFT_SHIFT'],
  ['5', 'R', 'D', '6', 'C', 'F', 'T', 'X'],
  ['7', 'Y', 'G', '8', 'B', 'H', 'U', 'V'],
  ['9', 'I', 'J', '0', 'M', 'K', 'O', 'N'],
  ['PLUS', 'P', 'L', 'MINUS', 'PERIOD', 'COLON', 'AT', 'COMMA'],
  ['POUND', 'ASTERISK', 'SEMICOLON', 'HOME', 'RIGHT_SHIFT', 'EQUALS', 'UP_ARROW', 'SLASH'],
  ['1', 'LEFT_ARROW', 'CONTROL', '2', 'SPACE', 'COMMODORE', 'Q', 'RUN_STOP']
]);

const MATRIX_POSITIONS = new Map();
for (let row = 0; row < 8; row += 1) {
  for (let column = 0; column < 8; column += 1) MATRIX_POSITIONS.set(MATRIX_ROWS[row][column], [row, column]);
}

const BASE_CODES = {
  Backspace: ['DELETE'], Delete: ['DELETE'], Insert: ['DELETE'], Enter: ['RETURN'],
  ArrowRight: ['CURSOR_RIGHT'], ArrowLeft: ['LEFT_SHIFT', 'CURSOR_RIGHT'],
  ArrowDown: ['CURSOR_DOWN'], ArrowUp: ['LEFT_SHIFT', 'CURSOR_DOWN'],
  ShiftLeft: ['LEFT_SHIFT'], ShiftRight: ['RIGHT_SHIFT'],
  ControlLeft: ['CONTROL'], ControlRight: ['CONTROL'],
  AltLeft: ['COMMODORE'], AltRight: ['COMMODORE'],
  Escape: ['RUN_STOP'], Space: ['SPACE'], Home: ['HOME'],
  PageUp: ['RESTORE'], F9: ['RESTORE'],
  F1: ['F1'], F2: ['LEFT_SHIFT', 'F1'],
  F3: ['F3'], F4: ['LEFT_SHIFT', 'F3'],
  F5: ['F5'], F6: ['LEFT_SHIFT', 'F5'],
  F7: ['F7'], F8: ['LEFT_SHIFT', 'F7'],
  Backquote: ['LEFT_ARROW'], Backslash: ['POUND'], IntlBackslash: ['POUND'],
  BracketLeft: ['AT'], BracketRight: ['ASTERISK'],
  Minus: ['MINUS'], Equal: ['PLUS'], Semicolon: ['SEMICOLON'],
  Quote: ['COLON'], Comma: ['COMMA'], Period: ['PERIOD'], Slash: ['SLASH']
};

Object.assign(BASE_CODES, {
  NumpadEnter: ['RETURN'], NumpadAdd: ['PLUS'], NumpadSubtract: ['MINUS'],
  NumpadMultiply: ['ASTERISK'], NumpadDivide: ['SLASH'], NumpadDecimal: ['PERIOD']
});
for (let n = 0; n <= 9; n += 1) {
  BASE_CODES[`Digit${n}`] = [String(n)];
  BASE_CODES[`Numpad${n}`] = [String(n)];
}
for (let n = 65; n <= 90; n += 1) BASE_CODES[`Key${String.fromCharCode(n)}`] = [String.fromCharCode(n)];

const MODIFIER_KEYS = new Set(['LEFT_SHIFT', 'RIGHT_SHIFT', 'CONTROL', 'COMMODORE']);

const plain = (...keys) => ({ keys, shift: false });
const shifted = (...keys) => ({ keys, shift: true });
const follow = (...keys) => ({ keys, shift: null });

const DE_SYMBOLS = {
  '!': shifted('1'), '"': shifted('2'), '#': shifted('3'), '$': shifted('4'), '§': shifted('3'),
  '%': shifted('5'), '&': shifted('6'), "'": shifted('7'), '(': shifted('8'), ')': shifted('9'),
  '+': plain('PLUS'), '-': plain('MINUS'), '*': plain('ASTERISK'), '/': plain('SLASH'),
  '=': plain('EQUALS'), ':': plain('COLON'), ';': plain('SEMICOLON'), ',': plain('COMMA'),
  '.': plain('PERIOD'), '@': plain('AT'), '£': plain('POUND'), '\\': plain('POUND'),
  '^': plain('UP_ARROW'), '°': shifted('UP_ARROW'), '_': plain('LEFT_ARROW'),
  '<': shifted('COMMA'), '>': shifted('PERIOD'), '?': shifted('SLASH'),
  '[': shifted('COLON'), ']': shifted('SEMICOLON'),
  'ü': follow('AT'), 'ö': follow('COLON'), 'ä': follow('SEMICOLON'), 'ß': plain('POUND')
};
for (let n = 0; n <= 9; n += 1) DE_SYMBOLS[String(n)] = follow(String(n));
for (let n = 97; n <= 122; n += 1) DE_SYMBOLS[String.fromCharCode(n)] = follow(String.fromCharCode(n - 32));

const DE_DEAD_CODES = {
  Backquote: plain('UP_ARROW'),
  Equal: plain('LEFT_ARROW')
};

const DE_POSITIONAL = {
  KeyY: ['Z'], KeyZ: ['Y'], AltRight: null,
  Minus: ['POUND'], Equal: ['LEFT_ARROW'], Backquote: ['UP_ARROW'],
  BracketLeft: ['AT'], BracketRight: ['PLUS'], Backslash: ['EQUALS'],
  Semicolon: ['COLON'], Quote: ['SEMICOLON'], Slash: ['MINUS'], IntlBackslash: ['COMMA']
};

export class Keyboard {
  constructor(layout = 'international') {
    this.layout = 'international';
    this.pressedCodes = new Map();
    this.pressedMatrix = new Set();
    this.rows = new Uint8Array(8);
    this.dirty = true;
    this.setLayout(layout);
  }

  setLayout(layout) {
    if (!['international', 'de'].includes(layout)) throw new RangeError('Unbekanntes Tastaturlayout');
    this.layout = layout;
    this.dirty = true;
  }

  mapCode(code) {
    if (this.layout === 'de' && Object.hasOwn(DE_POSITIONAL, code)) return DE_POSITIONAL[code];
    return BASE_CODES[code] ?? null;
  }

  mapEvent(code, detail = null) {
    const key = detail?.key;
    if (this.layout === 'de' && typeof key === 'string') {
      const altGraph = Boolean(detail.altGraph) || (Boolean(detail.ctrl) && Boolean(detail.alt));
      const chord = (Boolean(detail.ctrl) || Boolean(detail.alt)) && !altGraph;
      if (!chord) {
        if (key === 'Dead' && DE_DEAD_CODES[code]) return DE_DEAD_CODES[code];
        if (key.length === 1 && key !== ' ') {
          const symbol = DE_SYMBOLS[key] ?? DE_SYMBOLS[key.toLowerCase()];
          if (symbol) return altGraph && symbol.shift === null ? { keys: symbol.keys, shift: false } : symbol;
          if (altGraph) return null;
        }
      }
    }
    const keys = this.mapCode(code);
    return keys ? { keys, shift: null } : null;
  }

  isMappedCode(code, detail = null) {
    return this.mapEvent(code, detail) !== null;
  }

  handleCode(code, pressed, detail = null) {
    if (!pressed) {
      if (!this.pressedCodes.delete(code)) return this.mapCode(code) !== null;
      this.dirty = true;
      return true;
    }
    const mapped = this.mapEvent(code, detail);
    if (!mapped) return false;
    this.pressedCodes.delete(code);
    this.pressedCodes.set(code, mapped);
    this.dirty = true;
    return true;
  }

  setKey(key, pressed) {
    if (key !== 'RESTORE' && !MATRIX_POSITIONS.has(key)) throw new RangeError('Unbekannte C64-Taste');
    if (pressed) this.pressedMatrix.add(key);
    else this.pressedMatrix.delete(key);
    this.dirty = true;
  }

  getRestorePressed() {
    if (this.pressedMatrix.has('RESTORE')) return true;
    for (const entry of this.pressedCodes.values()) if (entry.keys.includes('RESTORE')) return true;
    return false;
  }

  getRows() {
    if (this.dirty) {
      this.rows.fill(0);
      for (const name of this.pressedMatrix) this.setContact(name);
      let latest = null;
      for (const entry of this.pressedCodes.values()) {
        if (!entry.keys.every(name => MODIFIER_KEYS.has(name))) latest = entry;
      }
      const forced = latest !== null && latest.shift !== null;
      for (const entry of this.pressedCodes.values()) {
        if (entry.shift !== null && entry !== latest) continue;
        for (const name of entry.keys) {
          if (forced && entry !== latest && MODIFIER_KEYS.has(name)) continue;
          this.setContact(name);
        }
      }
      if (forced && latest.shift) this.setContact('LEFT_SHIFT');
      this.dirty = false;
    }
    return this.rows;
  }

  setContact(name) {
    const position = MATRIX_POSITIONS.get(name);
    if (position) this.rows[position[0]] |= 1 << position[1];
  }

  resolveMatrix(pra, prb, ddra, ddrb, joystick1 = 0xff, joystick2 = 0xff) {
    const rows = this.getRows();
    let lows = (((~pra) & ddra) | ((~joystick2) & 0xff)) & 0xff;
    lows |= (((~prb) & ddrb) | ((~joystick1) & 0xff)) << 8;
    let old;
    do {
      old = lows;
      for (let row = 0; row < 8; row += 1) {
        if (!rows[row]) continue;
        const contacts = rows[row] << 8;
        if (lows & (1 << row)) lows |= contacts;
        if (lows & contacts) lows |= 1 << row;
      }
    } while (old !== lows);
    return { a: (~lows) & 0xff, b: (~(lows >>> 8)) & 0xff };
  }

  releaseAll() {
    this.pressedCodes.clear();
    this.pressedMatrix.clear();
    this.rows.fill(0);
    this.dirty = false;
  }
}

export { MATRIX_ROWS };
