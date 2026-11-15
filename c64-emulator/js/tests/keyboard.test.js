import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardMatrix, BrowserKeyboard, KeyboardTyper } from '../io/Keyboard.js';
import { KEY_POSITION, typingCombo } from '../io/KeyboardLayouts.js';
import { Joysticks } from '../io/Joystick.js';

test('Matrixpositionen entsprechen der C64-Belegung (KERNAL-Tastencodes)', () => {
  const code = (name) => KEY_POSITION[name].column * 8 + KEY_POSITION[name].row;
  assert.equal(code('INST_DEL'), 0);
  assert.equal(code('RETURN'), 1);
  assert.equal(code('A'), 10);
  assert.equal(code('LSHIFT'), 15);
  assert.equal(code('SPACE'), 60);
  assert.equal(code('RUN_STOP'), 63);
  assert.equal(code('RSHIFT'), 52);
  assert.equal(code('COMMODORE'), 61);
});

test('Spaltenabfrage über Port A, Zeilen über Port B', () => {
  const matrix = new KeyboardMatrix();
  matrix.pressKey('A');
  assert.equal(matrix.resolve(0xfd, 0xff).pb, 0xfb);
  assert.equal(matrix.resolve(0xfe, 0xff).pb, 0xff);
  assert.equal(matrix.resolve(0x00, 0xff).pb, 0xfb);
});

test('Gleichzeitige Tasten und umgekehrte Abfrage über Port B', () => {
  const matrix = new KeyboardMatrix();
  matrix.pressKey('A');
  matrix.pressKey('LSHIFT');
  assert.equal(matrix.resolve(0xfd, 0xff).pb, 0x7b);
  assert.equal(matrix.resolve(0xff, 0xfb).pa, 0xfd);
});

test('Ghosting: drei Tasten im Rechteck erzeugen eine Phantomtaste', () => {
  const matrix = new KeyboardMatrix();
  matrix.pressKey('A');
  matrix.pressKey('W');
  matrix.pressKey('R');
  const { pb } = matrix.resolve(0xfb, 0xff);
  assert.equal(pb & 0x04, 0);
  assert.equal(pb & 0x02, 0);
});

test('Joystick Port 2 zieht Port A, Port 1 Port B – ohne Tastaturbits zu überschreiben', () => {
  const matrix = new KeyboardMatrix();
  const joysticks = new Joysticks();
  joysticks.setActive('left', true);
  joysticks.setActive('fire', true);
  let { pa, pb } = matrix.resolve(0xff, 0xff, joysticks.ports[1].bits(), joysticks.ports[0].bits());
  assert.equal(pa & 0x1f, 0x0b);
  assert.equal(pb, 0xff);
  matrix.pressKey('Q');
  ({ pa, pb } = matrix.resolve(0x7f, 0xff, joysticks.ports[1].bits(), joysticks.ports[0].bits()));
  assert.equal(pb & 0x40, 0);
  joysticks.setActivePort(1);
  assert.equal(joysticks.ports[0].bits() & 0x1f, 0x0b);
  assert.equal(joysticks.ports[1].bits(), 0xff);
});

test('Shift-Override für symbolische Zeichen', () => {
  const matrix = new KeyboardMatrix();
  matrix.pressKey('LSHIFT');
  matrix.setShiftOverride(false);
  assert.equal(matrix.resolve(0xfd, 0xff).pb & 0x80, 0x80);
  matrix.setShiftOverride(true);
  matrix.releaseKey('LSHIFT');
  assert.equal(matrix.resolve(0xfd, 0xff).pb & 0x80, 0x00);
});

function fakeEvent(type, code, key, extra = {}) {
  return { type, code, key, repeat: false, metaKey: false, shiftKey: false, preventDefault() { this.prevented = true; }, ...extra };
}

test('Browser-Tastatur: symbolisches Mapping mit Mindesthaltezeit in emulierter Zeit', () => {
  const matrix = new KeyboardMatrix();
  const clock = { cycles: 0 };
  const events = [];
  const scheduler = {
    schedule(delay, callback) {
      const event = { at: clock.cycles + delay, callback };
      events.push(event);
      return event;
    },
    cancel(event) {
      events.splice(events.indexOf(event), 1);
    }
  };
  const advance = (n) => {
    clock.cycles += n;
    for (const event of [...events].sort((a, b) => a.at - b.at)) {
      if (event.at <= clock.cycles) {
        events.splice(events.indexOf(event), 1);
        event.callback();
      }
    }
  };
  const keyboard = new BrowserKeyboard(matrix, { clock, scheduler, minHoldCycles: 1000, minGapCycles: 500 });
  const down = fakeEvent('keydown', 'Digit2', '"', { shiftKey: true });
  keyboard.onKeyDown(down);
  assert.equal(down.prevented, true);
  assert.equal(matrix.isPressed('2'), true);
  assert.equal(matrix.isPressed('LSHIFT'), true);
  keyboard.onKeyUp(fakeEvent('keyup', 'Digit2', '"'));
  assert.equal(matrix.isPressed('2'), true);
  advance(1000);
  assert.equal(matrix.isPressed('2'), false);
  keyboard.onKeyDown(fakeEvent('keydown', 'Digit2', '2'));
  assert.equal(matrix.isPressed('2'), false);
  advance(500);
  assert.equal(matrix.isPressed('2'), true);
  assert.equal(matrix.isPressed('LSHIFT'), false);
});

test('Positionelles deutsches Layout tauscht Y und Z', () => {
  const matrix = new KeyboardMatrix();
  const keyboard = new BrowserKeyboard(matrix, { mode: 'positional', layout: 'de' });
  keyboard.onKeyDown(fakeEvent('keydown', 'KeyY', 'z'));
  assert.equal(matrix.isPressed('Z'), true);
  keyboard.onKeyUp(fakeEvent('keyup', 'KeyY', 'z'));
  assert.equal(matrix.isPressed('Z'), false);
  keyboard.onKeyDown(fakeEvent('keydown', 'ArrowUp', 'ArrowUp'));
  assert.equal(matrix.isPressed('CRSR_DOWN'), true);
  assert.equal(matrix.isPressed('LSHIFT'), true);
});

test('Tipp-Automat drückt Tasten bildweise über die Matrix', () => {
  const matrix = new KeyboardMatrix();
  const typer = new KeyboardTyper(matrix, { holdFrames: 1, gapFrames: 1 });
  typer.type('A"');
  const seen = [];
  for (let i = 0; i < 10; i++) {
    typer.frame();
    seen.push(`${matrix.isPressed('A') ? 'A' : ''}${matrix.isPressed('2') ? '2' : ''}${matrix.isPressed('LSHIFT') ? 'S' : ''}`);
  }
  assert.ok(seen.includes('A'));
  assert.ok(seen.includes('2S'));
  assert.equal(typer.busy, false);
  assert.deepEqual(typingCombo('a'), { key: 'A', shift: false });
  assert.deepEqual(typingCombo('?'), { key: 'SLASH', shift: true });
});
