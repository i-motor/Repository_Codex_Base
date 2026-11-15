import {
  KEY_POSITION,
  POSITIONAL_LAYOUTS,
  RESTORE_CODES,
  SPECIAL_KEYS,
  SYMBOLIC_KEYS,
  typingCombo
} from './KeyboardLayouts.js';

const LSHIFT = KEY_POSITION.LSHIFT;
const RSHIFT = KEY_POSITION.RSHIFT;

export class KeyboardMatrix {
  constructor() {
    this.columns = new Uint8Array(8);
    this.counts = new Uint8Array(64);
    this.shiftOverride = null;
    this.onChange = null;
  }

  press(column, row) {
    const index = column * 8 + row;
    this.counts[index]++;
    this.columns[column] |= 1 << row;
    this.changed();
  }

  release(column, row) {
    const index = column * 8 + row;
    if (this.counts[index] > 0) {
      this.counts[index]--;
    }
    if (this.counts[index] === 0) {
      this.columns[column] &= ~(1 << row);
    }
    this.changed();
  }

  pressKey(name) {
    const pos = KEY_POSITION[name];
    if (!pos) {
      throw new Error(`Unbekannte C64-Taste ${name}`);
    }
    this.press(pos.column, pos.row);
  }

  releaseKey(name) {
    const pos = KEY_POSITION[name];
    if (pos) {
      this.release(pos.column, pos.row);
    }
  }

  isPressed(name) {
    const pos = KEY_POSITION[name];
    return pos ? (this.effectiveColumn(pos.column) & (1 << pos.row)) !== 0 : false;
  }

  releaseAll() {
    this.columns.fill(0);
    this.counts.fill(0);
    this.shiftOverride = null;
    this.changed();
  }

  setShiftOverride(value) {
    this.shiftOverride = value;
    this.changed();
  }

  changed() {
    if (this.onChange) {
      this.onChange();
    }
  }

  effectiveColumn(column) {
    let bits = this.columns[column];
    if (this.shiftOverride === true) {
      if (column === LSHIFT.column) bits |= 1 << LSHIFT.row;
    } else if (this.shiftOverride === false) {
      if (column === LSHIFT.column) bits &= ~(1 << LSHIFT.row);
      if (column === RSHIFT.column) bits &= ~(1 << RSHIFT.row);
    }
    return bits;
  }

  resolve(paDriven, pbDriven, extA = 0xff, extB = 0xff) {
    let pa = paDriven & extA & 0xff;
    let pb = pbDriven & extB & 0xff;
    for (let pass = 0; pass < 8; pass++) {
      const startA = pa;
      const startB = pb;
      for (let column = 0; column < 8; column++) {
        const keys = this.effectiveColumn(column);
        if (keys === 0) {
          continue;
        }
        if (!(pa & (1 << column))) {
          pb &= ~keys;
        }
        if ((pb & keys) !== keys) {
          pa &= ~(1 << column);
        }
      }
      if (pa === startA && pb === startB) {
        break;
      }
    }
    return { pa, pb };
  }
}

export class BrowserKeyboard {
  constructor(matrix, { layout = 'de', mode = 'symbolic', onRestore = null, joysticks = null } = {}) {
    this.matrix = matrix;
    this.layout = layout;
    this.mode = mode;
    this.onRestore = onRestore;
    this.joysticks = joysticks;
    this.joystickKeys = false;
    this.active = new Map();
    this.target = null;
    this.enabled = true;
    this.handleDown = (event) => this.onKeyDown(event);
    this.handleUp = (event) => this.onKeyUp(event);
    this.handleBlur = () => this.releaseAll();
  }

  attach(target) {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.handleDown);
    target.addEventListener('keyup', this.handleUp);
    target.addEventListener('blur', this.handleBlur);
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.handleBlur);
    }
  }

  detach() {
    if (!this.target) {
      return;
    }
    this.target.removeEventListener('keydown', this.handleDown);
    this.target.removeEventListener('keyup', this.handleUp);
    this.target.removeEventListener('blur', this.handleBlur);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.handleBlur);
    }
    this.target = null;
  }

  setLayout(layout) {
    this.releaseAll();
    this.layout = layout;
  }

  setMode(mode) {
    this.releaseAll();
    this.mode = mode;
  }

  joystickMapping(code) {
    switch (code) {
      case 'Numpad8': return 'up';
      case 'Numpad2': return 'down';
      case 'Numpad4': return 'left';
      case 'Numpad6': return 'right';
      case 'Numpad0':
      case 'Numpad5': return 'fire';
      default: return null;
    }
  }

  lookup(event) {
    const special = SPECIAL_KEYS[event.code];
    if (special) {
      return { key: special[0], shift: special[1] === 'shift' ? true : null };
    }
    if (this.mode === 'symbolic' && event.key && event.key.length === 1) {
      const entry = SYMBOLIC_KEYS[event.key];
      if (entry) {
        return { key: entry[0], shift: entry[1] === 'shift' ? true : entry[1] === 'noshift' ? false : false };
      }
    }
    const positional = POSITIONAL_LAYOUTS[this.layout] || POSITIONAL_LAYOUTS.us;
    const name = positional[event.code];
    if (name) {
      return { key: name, shift: null };
    }
    return null;
  }

  onKeyDown(event) {
    if (!this.enabled || event.metaKey || event.code === 'F11' || event.code === 'F12') {
      return;
    }
    if (RESTORE_CODES.includes(event.code)) {
      event.preventDefault();
      if (!event.repeat && this.onRestore) {
        this.onRestore();
      }
      return;
    }
    if (this.joystickKeys && this.joysticks) {
      const direction = this.joystickMapping(event.code);
      if (direction) {
        event.preventDefault();
        this.joysticks.setActive(direction, true);
        return;
      }
    }
    const mapping = this.lookup(event);
    if (!mapping) {
      return;
    }
    event.preventDefault();
    if (event.repeat || this.active.has(event.code)) {
      return;
    }
    this.active.set(event.code, mapping);
    this.matrix.pressKey(mapping.key);
    this.applyShiftOverride();
  }

  onKeyUp(event) {
    if (this.joystickKeys && this.joysticks) {
      const direction = this.joystickMapping(event.code);
      if (direction) {
        event.preventDefault();
        this.joysticks.setActive(direction, false);
        return;
      }
    }
    const mapping = this.active.get(event.code);
    if (!mapping) {
      return;
    }
    event.preventDefault();
    this.active.delete(event.code);
    this.matrix.releaseKey(mapping.key);
    this.applyShiftOverride();
  }

  applyShiftOverride() {
    let override = null;
    for (const mapping of this.active.values()) {
      if (mapping.shift !== null) {
        override = mapping.shift;
      }
    }
    this.matrix.setShiftOverride(override);
  }

  releaseAll() {
    this.active.clear();
    this.matrix.releaseAll();
    if (this.joysticks) {
      this.joysticks.releaseAll();
    }
  }
}

export class KeyboardTyper {
  constructor(matrix, { holdFrames = 2, gapFrames = 2 } = {}) {
    this.matrix = matrix;
    this.holdFrames = holdFrames;
    this.gapFrames = gapFrames;
    this.queue = [];
    this.current = null;
    this.counter = 0;
    this.phase = 'idle';
  }

  type(text) {
    for (const ch of text) {
      const combo = typingCombo(ch);
      if (combo) {
        this.queue.push(combo);
      }
    }
    if (this.phase === 'idle') {
      this.phase = 'gap';
      this.counter = 0;
    }
  }

  get busy() {
    return this.phase !== 'idle';
  }

  frame() {
    if (this.phase === 'idle') {
      return;
    }
    this.counter++;
    if (this.phase === 'hold') {
      if (this.counter >= this.holdFrames) {
        this.matrix.releaseKey(this.current.key);
        this.matrix.setShiftOverride(null);
        this.current = null;
        this.phase = 'gap';
        this.counter = 0;
      }
      return;
    }
    if (this.counter >= this.gapFrames) {
      const next = this.queue.shift();
      if (!next) {
        this.phase = 'idle';
        return;
      }
      this.current = next;
      this.matrix.setShiftOverride(next.shift ? true : false);
      this.matrix.pressKey(next.key);
      this.phase = 'hold';
      this.counter = 0;
    }
  }
}
