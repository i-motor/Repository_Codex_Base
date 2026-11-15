import { JOYSTICK_BITS } from './Joystick.js';

export class MouseJoystick {
  constructor(joysticks, { mode = 'position', deadZone = 0.12, threshold = 6, releaseMs = 90, mapPoint = null } = {}) {
    this.joysticks = joysticks;
    this.mode = mode;
    this.deadZone = deadZone;
    this.threshold = threshold;
    this.releaseMs = releaseMs;
    this.mapPoint = mapPoint;
    this.target = null;
    this.directions = 0;
    this.fire = false;
    this.accumX = 0;
    this.accumY = 0;
    this.releaseTimer = null;
    this.handlers = {
      move: (event) => this.onMove(event),
      down: (event) => this.onButton(event, true),
      up: (event) => this.onButton(event, false),
      leave: () => this.onLeave(),
      click: () => this.onClick(),
      context: (event) => event.preventDefault()
    };
  }

  attach(target) {
    this.detach();
    this.target = target;
    target.addEventListener('mousemove', this.handlers.move);
    target.addEventListener('mousedown', this.handlers.down);
    window.addEventListener('mouseup', this.handlers.up);
    target.addEventListener('mouseleave', this.handlers.leave);
    target.addEventListener('click', this.handlers.click);
    target.addEventListener('contextmenu', this.handlers.context);
  }

  detach() {
    if (!this.target) {
      return;
    }
    const target = this.target;
    target.removeEventListener('mousemove', this.handlers.move);
    target.removeEventListener('mousedown', this.handlers.down);
    window.removeEventListener('mouseup', this.handlers.up);
    target.removeEventListener('mouseleave', this.handlers.leave);
    target.removeEventListener('click', this.handlers.click);
    target.removeEventListener('contextmenu', this.handlers.context);
    this.target = null;
    this.release();
  }

  setMode(mode) {
    this.mode = mode;
    this.release();
    if (mode !== 'relative' && document.pointerLockElement === this.target) {
      document.exitPointerLock();
    }
  }

  get enabled() {
    return this.mode === 'position' || this.mode === 'relative';
  }

  onClick() {
    if (this.mode === 'relative' && this.target && document.pointerLockElement !== this.target && this.target.requestPointerLock) {
      this.target.requestPointerLock();
    }
  }

  onMove(event) {
    if (!this.enabled) {
      return;
    }
    if (this.mode === 'position') {
      const point = this.mapPoint ? this.mapPoint(event.clientX, event.clientY) : this.relativePoint(event);
      const dx = point.x - 0.5;
      const dy = point.y - 0.5;
      let dirs = 0;
      if (dx < -this.deadZone) dirs |= JOYSTICK_BITS.left;
      if (dx > this.deadZone) dirs |= JOYSTICK_BITS.right;
      if (dy < -this.deadZone) dirs |= JOYSTICK_BITS.up;
      if (dy > this.deadZone) dirs |= JOYSTICK_BITS.down;
      this.directions = dirs;
      this.update();
      return;
    }
    if (document.pointerLockElement !== this.target) {
      return;
    }
    this.accumX += event.movementX;
    this.accumY += event.movementY;
    let dirs = 0;
    if (this.accumX < -this.threshold) dirs |= JOYSTICK_BITS.left;
    if (this.accumX > this.threshold) dirs |= JOYSTICK_BITS.right;
    if (this.accumY < -this.threshold) dirs |= JOYSTICK_BITS.up;
    if (this.accumY > this.threshold) dirs |= JOYSTICK_BITS.down;
    this.accumX *= 0.5;
    this.accumY *= 0.5;
    this.directions = dirs;
    this.update();
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.accumX = 0;
      this.accumY = 0;
      this.directions = 0;
      this.update();
    }, this.releaseMs);
  }

  relativePoint(event) {
    const rect = this.target.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  onButton(event, pressed) {
    if (!this.enabled || event.button !== 0) {
      return;
    }
    if (pressed) {
      event.preventDefault();
    }
    this.fire = pressed;
    this.update();
  }

  onLeave() {
    if (this.mode === 'position') {
      this.directions = 0;
      this.update();
    }
  }

  release() {
    this.directions = 0;
    this.fire = false;
    this.update();
  }

  update() {
    const mask = this.directions | (this.fire ? JOYSTICK_BITS.fire : 0);
    this.joysticks.setSourceState('mouse', mask);
  }
}
