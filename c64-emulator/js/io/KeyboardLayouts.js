export const MATRIX_KEYS = Object.freeze([
  ['INST_DEL', 'RETURN', 'CRSR_RIGHT', 'F7', 'F1', 'F3', 'F5', 'CRSR_DOWN'],
  ['3', 'W', 'A', '4', 'Z', 'S', 'E', 'LSHIFT'],
  ['5', 'R', 'D', '6', 'C', 'F', 'T', 'X'],
  ['7', 'Y', 'G', '8', 'B', 'H', 'U', 'V'],
  ['9', 'I', 'J', '0', 'M', 'K', 'O', 'N'],
  ['PLUS', 'P', 'L', 'MINUS', 'PERIOD', 'COLON', 'AT', 'COMMA'],
  ['POUND', 'ASTERISK', 'SEMICOLON', 'HOME', 'RSHIFT', 'EQUALS', 'UP_ARROW', 'SLASH'],
  ['1', 'LEFT_ARROW', 'CTRL', '2', 'SPACE', 'COMMODORE', 'Q', 'RUN_STOP']
]);

export const KEY_POSITION = Object.freeze(
  Object.fromEntries(
    MATRIX_KEYS.flatMap((rows, column) => rows.map((name, row) => [name, Object.freeze({ column, row })]))
  )
);

export const SPECIAL_KEYS = Object.freeze({
  Enter: ['RETURN'],
  NumpadEnter: ['RETURN'],
  Backspace: ['INST_DEL'],
  Delete: ['INST_DEL'],
  Insert: ['INST_DEL', 'shift'],
  Home: ['HOME'],
  End: ['HOME', 'shift'],
  Escape: ['RUN_STOP'],
  Tab: ['CTRL'],
  ControlLeft: ['COMMODORE'],
  ControlRight: ['CTRL'],
  ShiftLeft: ['LSHIFT'],
  ShiftRight: ['RSHIFT'],
  ArrowDown: ['CRSR_DOWN'],
  ArrowUp: ['CRSR_DOWN', 'shift'],
  ArrowRight: ['CRSR_RIGHT'],
  ArrowLeft: ['CRSR_RIGHT', 'shift'],
  F1: ['F1'],
  F2: ['F1', 'shift'],
  F3: ['F3'],
  F4: ['F3', 'shift'],
  F5: ['F5'],
  F6: ['F5', 'shift'],
  F7: ['F7'],
  F8: ['F7', 'shift'],
  Space: ['SPACE']
});

export const RESTORE_CODES = Object.freeze(['PageUp']);

const POSITIONAL_US = {
  Backquote: 'LEFT_ARROW',
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5',
  Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
  Minus: 'PLUS', Equal: 'MINUS', IntlYen: 'POUND',
  KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', KeyT: 'T', KeyY: 'Y', KeyU: 'U', KeyI: 'I', KeyO: 'O', KeyP: 'P',
  BracketLeft: 'AT', BracketRight: 'ASTERISK', Backslash: 'POUND',
  KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
  Semicolon: 'COLON', Quote: 'SEMICOLON', IntlBackslash: 'EQUALS',
  KeyZ: 'Z', KeyX: 'X', KeyC: 'C', KeyV: 'V', KeyB: 'B', KeyN: 'N', KeyM: 'M',
  Comma: 'COMMA', Period: 'PERIOD', Slash: 'SLASH',
  PageDown: 'UP_ARROW'
};

const POSITIONAL_DE = {
  ...POSITIONAL_US,
  KeyY: 'Z',
  KeyZ: 'Y',
  Backslash: 'EQUALS',
  IntlBackslash: 'POUND'
};

export const POSITIONAL_LAYOUTS = Object.freeze({
  us: Object.freeze(POSITIONAL_US),
  de: Object.freeze(POSITIONAL_DE)
});

const SYMBOLS = {
  ' ': ['SPACE'],
  '0': ['0'], '1': ['1'], '2': ['2'], '3': ['3'], '4': ['4'],
  '5': ['5'], '6': ['6'], '7': ['7'], '8': ['8'], '9': ['9'],
  '!': ['1', 'shift'], '"': ['2', 'shift'], '#': ['3', 'shift'], '$': ['4', 'shift'],
  '%': ['5', 'shift'], '&': ['6', 'shift'], "'": ['7', 'shift'], '(': ['8', 'shift'],
  ')': ['9', 'shift'],
  '+': ['PLUS'], '-': ['MINUS'], '£': ['POUND'], '@': ['AT'], '*': ['ASTERISK'],
  '^': ['UP_ARROW'], '↑': ['UP_ARROW'], ':': ['COLON'], ';': ['SEMICOLON'], '=': ['EQUALS'],
  ',': ['COMMA'], '.': ['PERIOD'], '/': ['SLASH'],
  '[': ['COLON', 'shift'], ']': ['SEMICOLON', 'shift'], '<': ['COMMA', 'shift'],
  '>': ['PERIOD', 'shift'], '?': ['SLASH', 'shift'], '_': ['LEFT_ARROW'], '←': ['LEFT_ARROW'],
  '\\': ['POUND'], 'π': ['UP_ARROW', 'shift'],
  '\n': ['RETURN'], '\r': ['RETURN']
};

for (let code = 65; code <= 90; code++) {
  const upper = String.fromCharCode(code);
  SYMBOLS[upper.toLowerCase()] = [upper, 'noshift'];
  SYMBOLS[upper] = [upper, 'shift'];
}

export const SYMBOLIC_KEYS = Object.freeze(SYMBOLS);

export function typingCombo(ch) {
  if (/^[A-Za-z]$/.test(ch)) {
    return { key: ch.toUpperCase(), shift: false };
  }
  const entry = SYMBOLS[ch];
  if (!entry) {
    return null;
  }
  return { key: entry[0], shift: entry[1] === 'shift' };
}
