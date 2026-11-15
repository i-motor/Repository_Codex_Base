import { Clock } from './Clock.js';
import { Memory } from './Memory.js';
import { MemoryBus } from './MemoryBus.js';
import { ProcessorPort } from './ProcessorPort.js';
import { CPU6510 } from './CPU6510.js';
import { InterruptController } from './InterruptController.js';
import { validateRom } from './ROMManager.js';
import { PAL } from '../video/VideoTiming.js';
import { VICII } from '../video/VICII.js';
import { SID } from '../audio/SID6581.js';
import { CIA6526 } from '../io/CIA6526.js';
import { KeyboardMatrix, KeyboardTyper } from '../io/Keyboard.js';
import { Joysticks } from '../io/Joystick.js';
import { IECBus } from '../io/IECBus.js';
import { IRQ_SOURCE, NMI_SOURCE } from '../utils/Constants.js';

export class C64 {
  constructor({ timing = PAL, sidModel = '6581', ciaModel = '6526', sampleRate = 48000 } = {}) {
    this.timing = timing;
    this.clock = new Clock(timing);
    this.memory = new Memory();
    this.bus = new MemoryBus(this.memory);
    this.port = new ProcessorPort(this.clock);
    this.port.onChange = (loram, hiram, charen) => this.bus.setCpuLines(loram, hiram, charen);
    this.cpu = new CPU6510(this.bus, this.port);
    this.interrupts = new InterruptController(this.cpu);
    this.vic = new VICII(this.bus, this.interrupts, this.memory, timing);
    this.sid = new SID({ clock: this.clock, clockHz: timing.clockHz, model: sidModel, sampleRate });
    this.cia1 = new CIA6526({
      name: 'CIA1',
      model: ciaModel,
      onInterrupt: (active) => this.interrupts.setIrq(IRQ_SOURCE.CIA1, active)
    });
    this.cia2 = new CIA6526({
      name: 'CIA2',
      model: ciaModel,
      onInterrupt: (active) => this.interrupts.setNmi(NMI_SOURCE.CIA2, active)
    });
    this.keyboard = new KeyboardMatrix();
    this.typer = new KeyboardTyper(this.keyboard);
    this.joysticks = new Joysticks();
    this.iec = new IECBus();
    this.bus.connect({ vic: this.vic, sid: this.sid, cia1: this.cia1, cia2: this.cia2 });
    this.events = [];
    this.nextEventCycle = Infinity;
    this.breakpoints = new Set();
    this.breakRequested = false;
    this.breakReason = null;
    this.drives = [];
    this.wireCia1();
    this.wireCia2();
    this.vic.onFrame = () => this.onVicFrame();
    this.frameListeners = [];
    this.todPeriod = Math.round(timing.clockHz / timing.todHz);
    this.todCountdown = this.todPeriod;
    this.restorePulseCycles = 2000;
    this.powerOn();
  }

  wireCia1() {
    const resolve = () => this.keyboard.resolve(
      this.cia1.getPortAPins(),
      this.cia1.getPortBPins(),
      this.joysticks.ports[1].bits(),
      this.joysticks.ports[0].bits()
    );
    this.cia1.portAIn = () => resolve().pa;
    this.cia1.portBIn = () => resolve().pb;
    const lightPen = () => {
      const { pb } = resolve();
      this.vic.setLightPen((pb & 0x10) === 0);
    };
    this.cia1.portBOut = lightPen;
    this.cia1.portAOut = lightPen;
    this.keyboard.onChange = lightPen;
    this.joysticks.onChange = lightPen;
  }

  wireCia2() {
    this.cia2.portAOut = (pins) => {
      this.bus.setVicBank(~pins & 3);
      this.iec.setControllerOutputs((pins & 0x08) !== 0, (pins & 0x10) !== 0, (pins & 0x20) !== 0);
    };
    this.cia2.portAIn = (driven) => {
      const lines = 0x3f | (this.iec.clk ? 0x40 : 0) | (this.iec.data ? 0x80 : 0);
      return driven & lines;
    };
    this.cia2.portBIn = (driven) => driven;
  }

  attachDrive(drive) {
    this.drives.push(drive);
    return drive;
  }

  loadRoms({ basic, kernal, chargen }) {
    const results = {};
    for (const [kind, bytes] of Object.entries({ basic, kernal, chargen })) {
      if (!bytes) {
        continue;
      }
      const check = validateRom(kind, bytes);
      if (!check.ok) {
        throw new Error(check.message);
      }
      this.memory.loadRom(kind, bytes);
      results[kind] = check;
    }
    return results;
  }

  get romsReady() {
    const loaded = this.memory.romsLoaded;
    return loaded.basic && loaded.kernal && loaded.chargen;
  }

  powerOn() {
    this.memory.fillPowerOnPattern();
    this.port.reset();
    this.cpu.powerOn();
    this.resetChips();
  }

  reset() {
    this.cpu.reset();
    this.resetChips();
  }

  resetChips() {
    this.interrupts.reset();
    this.vic.reset();
    this.sid.reset();
    this.cia1.reset();
    this.cia2.reset();
    this.port.reset();
    this.keyboard.releaseAll();
    this.iec.reset();
    this.events = [];
    this.nextEventCycle = Infinity;
    this.interrupts.update();
  }

  schedule(delayCycles, callback) {
    const at = this.clock.cycles + Math.max(1, Math.round(delayCycles));
    const event = { at, callback };
    let index = this.events.length;
    while (index > 0 && this.events[index - 1].at > at) {
      index--;
    }
    this.events.splice(index, 0, event);
    this.nextEventCycle = this.events[0].at;
    return event;
  }

  cancel(event) {
    const index = this.events.indexOf(event);
    if (index >= 0) {
      this.events.splice(index, 1);
      this.nextEventCycle = this.events.length ? this.events[0].at : Infinity;
    }
  }

  processEvents() {
    const now = this.clock.cycles;
    while (this.events.length && this.events[0].at <= now) {
      const event = this.events.shift();
      event.callback(now);
    }
    this.nextEventCycle = this.events.length ? this.events[0].at : Infinity;
  }

  pressRestore() {
    this.interrupts.setNmi(NMI_SOURCE.RESTORE, true);
    this.schedule(this.restorePulseCycles, () => this.interrupts.setNmi(NMI_SOURCE.RESTORE, false));
  }

  releaseRestore() {}

  cycle() {
    this.vic.cycle();
    this.cpu.rdy = this.vic.ba;
    this.cpu.cycle();
    this.cia1.cycle();
    this.cia2.cycle();
    if (--this.todCountdown === 0) {
      this.todCountdown = this.todPeriod;
      this.cia1.todTick();
      this.cia2.todTick();
    }
    this.clock.cycles++;
    if (this.clock.cycles >= this.nextEventCycle) {
      this.processEvents();
    }
  }

  runCycles(count) {
    const vic = this.vic;
    const cpu = this.cpu;
    const cia1 = this.cia1;
    const cia2 = this.cia2;
    const clock = this.clock;
    this.breakRequested = false;
    let executed = 0;
    for (; executed < count; executed++) {
      vic.cycle();
      cpu.rdy = vic.ba;
      cpu.cycle();
      cia1.cycle();
      cia2.cycle();
      if (--this.todCountdown === 0) {
        this.todCountdown = this.todPeriod;
        cia1.todTick();
        cia2.todTick();
      }
      clock.cycles++;
      if (clock.cycles >= this.nextEventCycle) {
        this.processEvents();
      }
      if (this.breakRequested) {
        executed++;
        break;
      }
    }
    this.sid.catchUp(clock.cycles);
    return executed;
  }

  runFrame() {
    const start = this.vic.frameCount;
    let total = 0;
    while (this.vic.frameCount === start && !this.breakRequested) {
      total += this.runCycles(this.timing.cyclesPerLine);
      if (this.breakRequested) {
        break;
      }
    }
    return total;
  }

  runSeconds(seconds) {
    return this.runCycles(this.clock.secondsToCycles(seconds));
  }

  onVicFrame() {
    this.typer.frame();
    for (const listener of this.frameListeners) {
      listener(this.vic.getFrontBuffer());
    }
  }

  addFrameListener(listener) {
    this.frameListeners.push(listener);
  }

  setAudioSink(sink) {
    this.sid.setSink(sink);
  }

  flushAudio() {
    this.sid.catchUp(this.clock.cycles);
  }

  setBreakpoint(address, enabled = true) {
    if (enabled) {
      this.breakpoints.add(address & 0xffff);
    } else {
      this.breakpoints.delete(address & 0xffff);
    }
    this.cpu.onInstruction = this.breakpoints.size
      ? (pc) => {
        if (this.breakpoints.has(pc)) {
          this.breakRequested = true;
          this.breakReason = { type: 'breakpoint', address: pc };
        }
      }
      : null;
  }

  requestBreak(reason = 'user') {
    this.breakRequested = true;
    this.breakReason = { type: reason };
  }

  typeText(text) {
    this.typer.type(text);
  }

  readScreenText(rows = 25) {
    const base = this.vic.screenAddress();
    const lines = [];
    for (let row = 0; row < rows; row++) {
      let line = '';
      for (let col = 0; col < 40; col++) {
        const code = this.memory.ram[(base + row * 40 + col) & 0xffff] & 0x7f;
        let ch;
        if (code === 0) ch = '@';
        else if (code < 27) ch = String.fromCharCode(64 + code);
        else if (code < 32) ch = '[£]↑←'[code - 27];
        else if (code < 64) ch = String.fromCharCode(code);
        else ch = ' ';
        line += ch;
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return lines;
  }
}
