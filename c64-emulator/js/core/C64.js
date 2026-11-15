import { Clock } from './Clock.js';
import { VIDEO_PROFILES } from '../utils/Constants.js';
import { Drive1541 } from '../drive1541/Drive1541.js';
import { D64Image } from '../storage/D64Image.js';
import { Memory } from './Memory.js';
import { ProcessorPort6510 } from './ProcessorPort6510.js';
import { ROMManager } from './ROMManager.js';
import { MemoryBus } from './MemoryBus.js';
import { BusSignals } from './BusSignals.js';
import { BusArbiter } from './BusArbiter.js';
import { InterruptController } from './InterruptController.js';
import { CPU6510 } from './CPU6510.js';
import { CIA6526 } from '../io/CIA6526.js';
import { Keyboard } from '../io/Keyboard.js';
import { Joystick } from '../io/Joystick.js';
import { InputQueue } from '../io/InputQueue.js';
import { IECBus } from '../io/IECBus.js';
import { VirtualDrive1541 } from '../storage/VirtualDrive1541.js';
import { FileManager } from '../storage/FileManager.js';
import { VICMemory } from '../video/VICMemory.js';
import { VICII } from '../video/VICII.js';
import { SID6581 } from '../audio/SID6581.js';
import { SIDResampler } from '../audio/SIDResampler.js';

export class C64 {
  constructor({ videoStandard = 'PAL', sidModel = '6581' } = {}) {
    if (!VIDEO_PROFILES[videoStandard]) throw new RangeError('Unbekannter Videostandard');
    this.videoStandard = videoStandard;
    this.clock = new Clock(VIDEO_PROFILES[videoStandard]);
    this.memory = new Memory();
    this.processorPort = new ProcessorPort6510();
    this.roms = new ROMManager();
    this.bus = new MemoryBus(this.memory, this.roms, this.processorPort);
    this.signals = new BusSignals();
    this.arbiter = new BusArbiter();
    this.interrupts = new InterruptController();
    this.cpu = new CPU6510(this.interrupts);
    this.keyboard = new Keyboard();
    this.joystick = new Joystick();
    this.inputQueue = new InputQueue();
    this.iec = new IECBus();
    this.files = new FileManager();
    this.drive8 = new VirtualDrive1541(this.iec, this.files, 8);
    this.hardwareDrive = new Drive1541({ c64Hz: this.clock.profile.cpuHz, bus: this.iec });
    this.hardwareDriveEnabled = false;
    this.cia1 = new CIA6526({
      name: 'cia1', interruptController: this.interrupts, interruptLine: 'irq',
      portResolver: port => {
        const pins = this.keyboard.resolveMatrix(
          this.cia1.pra, this.cia1.prb, this.cia1.ddra, this.cia1.ddrb,
          this.joystick.getLines(1), this.joystick.getLines(2)
        );
        return pins[port];
      }
    });
    this.cia2 = new CIA6526({
      name: 'cia2', interruptController: this.interrupts, interruptLine: 'nmi',
      portResolver: (port, cia, fallback) => {
        if (port === 'b') return fallback;
        let inputs = 0xff;
        if (!this.iec.sample('CLOCK')) inputs &= ~0x40;
        if (!this.iec.sample('DATA')) inputs &= ~0x80;
        return ((cia.pra & cia.ddra) | (inputs & ~cia.ddra)) & 0xff;
      },
      onPortChange: () => this.updateIECOutputs()
    });
    this.bus.attachDevice('cia1', this.cia1);
    this.bus.attachDevice('cia2', this.cia2);
    this.vicMemory = new VICMemory(this.memory, this.roms, () => this.cia2.getPortPins('a'));
    this.vic = new VICII({ memory: this.vicMemory, interrupts: this.interrupts, profile: this.clock.profile });
    this.bus.attachDevice('vic', this.vic);
    this.sid = new SID6581({ cpuHz: this.clock.profile.cpuHz, model: sidModel });
    this.sidResampler = new SIDResampler(this.clock.profile.cpuHz, 48000);
    this.bus.attachDevice('sid', this.sid);
    this.externalRDYHigh = true;
    this.trace = [];
    this.traceCapacity = 4096;
    this.traceEnabled = false;
    this.onFrame = null;
    this.lastNotifiedFrame = 0;
    this.todAccumulator = 0;
    this.powerOn();
  }

  updateIECOutputs() {
    const { latch, ddr } = this.cia2.getPortOutputs('a');
    for (const [bit, line] of [[3, 'ATN'], [4, 'CLOCK'], [5, 'DATA']]) {
      this.iec.drive('c64', line, Boolean(ddr & (1 << bit)) && Boolean(latch & (1 << bit)));
    }
  }

  updateSystemSignals() {
    const levels = this.signalLevels;
    const cia1High = !this.cia1.isInterruptActive();
    const vicHigh = !this.vic.isIRQActive();
    const cia2High = !this.cia2.isInterruptActive();
    if (levels.cia1 !== cia1High) this.signals.drive('IRQ', 'cia1', levels.cia1 = cia1High);
    if (levels.vicIRQ !== vicHigh) this.signals.drive('IRQ', 'vic', levels.vicIRQ = vicHigh);
    if (levels.cia2 !== cia2High) this.signals.drive('NMI', 'cia2', levels.cia2 = cia2High);
  }

  resetSignals() {
    this.signals.reset();
    this.signalLevels = { cia1: null, vicIRQ: null, cia2: null, ba: null, aec: null, rdy: null };
  }

  powerOn() {
    this.memory.powerOn();
    this.processorPort.reset();
    this.clock.reset();
    this.resetSignals();
    this.interrupts.reset();
    this.bus.resetBusLatch();
    this.cpu.powerOn();
    this.keyboard.releaseAll();
    this.joystick.releaseAll();
    this.inputQueue.clear();
    this.iec.reset();
    this.hardwareDrive.reset();
    this.cia1.reset();
    this.cia2.reset();
    this.vic.reset();
    this.lastNotifiedFrame = 0;
    this.sid.reset();
    this.sidResampler.reset();
    this.todAccumulator = 0;
    this.updateIECOutputs();
    this.updateSystemSignals();
    this.externalRDYHigh = true;
    this.resetWasActive = false;
    this.trace.length = 0;
  }

  reset() {
    this.processorPort.reset();
    this.resetSignals();
    this.interrupts.reset();
    this.bus.resetBusLatch();
    this.cpu.reset();
    this.cia1.reset();
    this.cia2.reset();
    this.vic.reset();
    this.lastNotifiedFrame = 0;
    this.sid.reset();
    this.sidResampler.reset();
    this.inputQueue.clear();
    this.iec.reset();
    this.hardwareDrive.reset();
    this.todAccumulator = 0;
    this.updateIECOutputs();
    this.updateSystemSignals();
    this.resetWasActive = false;
    this.trace.length = 0;
  }

  setVideoStandard(standard) {
    const profile = VIDEO_PROFILES[standard];
    if (!profile) throw new RangeError('Unbekannter Videostandard');
    if (this.videoStandard === standard) return false;
    this.videoStandard = standard;
    this.clock = new Clock(profile);
    this.vic = new VICII({ memory: this.vicMemory, interrupts: this.interrupts, profile });
    this.bus.attachDevice('vic', this.vic);
    const model = this.sid.filter.model;
    this.sid = new SID6581({ cpuHz: profile.cpuHz, model });
    this.sidResampler = new SIDResampler(profile.cpuHz, this.sidResampler.sampleRate ?? 48000);
    this.bus.attachDevice('sid', this.sid);
    this.hardwareDrive.c64Hz = profile.cpuHz;
    this.powerOn();
    return true;
  }

  setSIDModel(model) {
    this.sid.setModel(model);
  }

  mountD64(source) {
    const disk = source instanceof D64Image ? source : new D64Image(source);
    const count = this.drive8.mountD64(disk);
    this.hardwareDrive.mount(disk);
    return count;
  }

  load1541ROM(buffer) {
    return this.hardwareDrive.loadROM(buffer);
  }

  setHardwareDriveEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.hardwareDriveEnabled) return false;
    if (next && !this.hardwareDrive.rom) throw new Error('Für den 1541-Hardwaremodus wird ein 1541-ROM benötigt');
    this.hardwareDriveEnabled = next;
    if (next) {
      this.iec.detachDevice(this.drive8);
      this.drive8.reset();
      this.hardwareDrive.reset();
    } else {
      this.hardwareDrive.via1.ddrb = 0;
      this.hardwareDrive.updateIECOutputs();
      this.iec.attachDevice(this.drive8);
      this.drive8.reset();
    }
    this.updateIECOutputs();
    return true;
  }

  loadROM(type, buffer) {
    return this.roms.load(type, buffer);
  }

  loadDiagnosticProgram(bytes, address = 0xc000) {
    if (address < 2 || address > 0xffff || address + bytes.length > 0x10000) {
      throw new RangeError('Diagnoseprogramm außerhalb des RAM');
    }
    for (let index = 0; index < bytes.length; index += 1) {
      this.memory.writeRAM(address + index, bytes[index]);
    }
    this.processorPort.writePins(0x34);
    this.cpu.setTestState({ PC: address, SP: 0xfd, P: 0x24 });
    this.trace.length = 0;
  }

  loadCIATimerDemo() {
    const program = new Uint8Array([
      0x78, 0xa9, 0x35, 0x85, 0x01, 0xa9, 0x2c, 0x8d, 0xfe, 0xff,
      0xa9, 0xc0, 0x8d, 0xff, 0xff, 0xa9, 0x7f, 0x8d, 0x0d, 0xdc,
      0xa9, 0x81, 0x8d, 0x0d, 0xdc, 0xa9, 0x20, 0x8d, 0x04, 0xdc,
      0xa9, 0x00, 0x8d, 0x05, 0xdc, 0xa9, 0x11, 0x8d, 0x0e, 0xdc,
      0x58, 0x4c, 0x29, 0xc0, 0xee, 0x00, 0xc2, 0xad, 0x0d, 0xdc, 0x40
    ]);
    this.cia1.reset();
    this.cia2.reset();
    this.interrupts.reset();
    this.memory.writeRAM(0xc200, 0);
    this.loadDiagnosticProgram(program);
    this.updateSystemSignals();
  }

  loadVICDemo() {
    this.powerOn();
    const bytes = [0x78];
    const store = (address, value) => bytes.push(0xa9, value & 255, 0x8d, address & 255, (address >>> 8) & 255);
    store(0xdd02, 3);
    store(0xdd00, 2);
    store(0xd011, 0x1b);
    store(0xd016, 8);
    store(0xd018, 0x14);
    store(0xd020, 14);
    store(0xd021, 6);
    const glyphs = [
      [0x81, 0xc3, 0xa5, 0x99, 0x81, 0x81, 0x81, 0],
      [0x18, 0x38, 0x58, 0x98, 0xfe, 0x18, 0x18, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0x81, 0x81, 0x81, 0x42, 0x42, 0x24, 0x18, 0],
      [0x7e, 0x18, 0x18, 0x18, 0x18, 0x18, 0x7e, 0],
      [0x3c, 0x42, 0x80, 0x80, 0x80, 0x42, 0x3c, 0]
    ];
    for (let i = 0; i < glyphs.length; i += 1) {
      store(0x4400 + i, i + 1);
      store(0xd800 + i, (i + 2) & 15);
      for (let row = 0; row < 8; row += 1) store(0x5000 + (i + 1) * 8 + row, glyphs[i][row]);
    }
    const idle = 0xc000 + bytes.length;
    bytes.push(0x4c, idle & 255, idle >>> 8);
    this.loadDiagnosticProgram(new Uint8Array(bytes));
    this.processorPort.writePins(0x35);
  }

  loadSpriteDemo() {
    this.powerOn();
    const bytes = [0x78];
    const store = (address, value) => bytes.push(0xa9, value & 255, 0x8d, address & 255, (address >>> 8) & 255);
    store(0xdd02, 3);
    store(0xdd00, 3);
    store(0xd011, 0x1b);
    store(0xd016, 8);
    store(0xd018, 0x14);
    store(0xd020, 14);
    store(0xd021, 6);
    store(0xd025, 11);
    store(0xd026, 10);
    store(0xd01c, 0x0c);
    store(0xd017, 0x10);
    store(0xd01d, 0x20);
    store(0xd01b, 0x40);
    store(0xd010, 0x80);
    const colors = [2, 5, 7, 3, 8, 10, 12, 15];
    for (let sprite = 0; sprite < 8; sprite += 1) {
      const x = sprite === 0 ? 32 : sprite === 1 ? 44 : 24 + sprite * 38;
      const y = sprite < 2 ? 80 : 80 + (sprite & 1) * 55;
      store(0x07f8 + sprite, 0x20 + sprite);
      store(0xd000 + sprite * 2, x & 255);
      store(0xd001 + sprite * 2, y);
      store(0xd027 + sprite, colors[sprite]);
      for (let row = 0; row < 21; row += 1) {
        const multicolor = sprite === 2 || sprite === 3;
        const pattern = multicolor ? [0x6c, 0x6c, 0x6c] : row === 0 || row === 20 ? [255, 255, 255] : [0x80, 0, 1];
        for (let part = 0; part < 3; part += 1) store(0x0800 + sprite * 64 + row * 3 + part, pattern[part]);
      }
    }
    store(0xd015, 0xff);
    const loop = 0xc000 + bytes.length;
    bytes.push(0x4c, loop & 255, loop >>> 8);
    this.loadDiagnosticProgram(new Uint8Array(bytes));
    this.processorPort.writePins(0x35);
    return bytes.length;
  }

  loadSIDDemo() {
    this.powerOn();
    const bytes = [0x78];
    const store = (address, value) => bytes.push(0xa9, value & 255, 0x8d, address & 255, (address >>> 8) & 255);
    this.processorPort.writePins(0x35);
    const frequencies = [0x1168, 0x15ec, 0x1d46];
    const waveforms = [0x11, 0x21, 0x41];
    for (let voice = 0; voice < 3; voice += 1) {
      const base = 0xd400 + voice * 7;
      store(base, frequencies[voice] & 255);
      store(base + 1, frequencies[voice] >>> 8);
      store(base + 2, 0);
      store(base + 3, 8);
      store(base + 5, 0x08);
      store(base + 6, 0xe8);
      store(base + 4, waveforms[voice]);
    }
    store(0xd415, 0);
    store(0xd416, 0x80);
    store(0xd417, 0x57);
    store(0xd418, 0x1f);
    const loop = 0xc000 + bytes.length;
    bytes.push(0x4c, loop & 255, loop >>> 8);
    this.loadDiagnosticProgram(new Uint8Array(bytes));
    this.processorPort.writePins(0x35);
    return bytes.length;
  }

  installKernalFileDemo(action, name = 'DEMO', secondary = 1, { preserveSystem = false } = {}) {
    if (!this.roms.isComplete()) throw new Error('Für KERNAL-Dateioperationen müssen alle Original-ROMs geladen sein');
    if (action !== 'load' && action !== 'save') throw new RangeError('Unbekannte KERNAL-Dateioperation');
    const filename = String(name).toUpperCase();
    if (!filename.length || filename.length > 16 || !/^[A-Z0-9_.$-]+$/.test(filename)) throw new RangeError('Ungültiger KERNAL-Dateiname');
    if (!preserveSystem) this.reset();
    for (let i = 0; i < filename.length; i += 1) this.memory.writeRAM(0xc100 + i, filename.charCodeAt(i));
    const bytes = [0x78];
    const immediate = (opcode, value) => bytes.push(opcode, value & 255);
    const absolute = (opcode, address) => bytes.push(opcode, address & 255, (address >>> 8) & 255);
    immediate(0xa9, 0x3f);
    absolute(0x8d, 0xdd02);
    immediate(0xa9, 0x03);
    absolute(0x8d, 0xdd00);
    immediate(0xa9, 1);
    immediate(0xa2, 8);
    immediate(0xa0, secondary);
    absolute(0x20, 0xffba);
    immediate(0xa9, filename.length);
    immediate(0xa2, 0);
    immediate(0xa0, 0xc1);
    absolute(0x20, 0xffbd);
    if (action === 'load') {
      immediate(0xa9, 0);
      immediate(0xa2, 0);
      immediate(0xa0, 0x08);
      absolute(0x20, 0xffd5);
    } else {
      for (let i = 0; i < 16; i += 1) this.memory.writeRAM(0xc300 + i, (i * 13 + 7) & 255);
      immediate(0xa9, 0);
      absolute(0x8d, 0x00fb);
      immediate(0xa9, 0xc3);
      absolute(0x8d, 0x00fc);
      immediate(0xa9, 0xfb);
      immediate(0xa2, 0x10);
      immediate(0xa0, 0xc3);
      absolute(0x20, 0xffd8);
    }
    absolute(0x8d, 0xc220);
    bytes.push(0x08, 0x68);
    absolute(0x8d, 0xc221);
    const loop = 0xc000 + bytes.length;
    absolute(0x4c, loop);
    if (preserveSystem) {
      this.memory.ram.set(Uint8Array.from(bytes), 0xc000);
      this.processorPort.writePins(0x37);
      this.cpu.setTestState({ PC: 0xc000, SP: 0xfd, P: 0x24 });
      this.trace.length = 0;
    } else {
      this.loadDiagnosticProgram(Uint8Array.from(bytes));
      this.processorPort.writePins(0x37);
    }
    return bytes.length;
  }

  configureAudioSampleRate(sampleRate) {
    this.sidResampler.configure(this.clock.profile.cpuHz, sampleRate);
  }

  takeAudioSamples(count = this.sidResampler.available) {
    return this.sidResampler.takeSamples(count);
  }

  queueInput(event, cycle = this.clock.cycle) {
    this.inputQueue.enqueue(event, cycle);
  }

  applyInput(event) {
    switch (event.type) {
      case 'key':
        this.keyboard.handleCode(event.code, event.pressed, event);
        this.cia2.setFLAG(!this.keyboard.getRestorePressed());
        break;
      case 'matrix':
        this.keyboard.setKey(event.key, event.pressed);
        this.cia2.setFLAG(!this.keyboard.getRestorePressed());
        break;
      case 'direction':
        this.joystick.setDirection(event.port, event.direction, event.pressed);
        break;
      case 'fire':
        this.joystick.setFire(event.port, event.pressed);
        break;
      case 'cnt':
        this[event.chip === 2 ? 'cia2' : 'cia1'].setCNT(event.high);
        break;
      case 'sp':
        this[event.chip === 2 ? 'cia2' : 'cia1'].setSP(event.high);
        break;
      case 'flag':
        this[event.chip === 2 ? 'cia2' : 'cia1'].setFLAG(event.high);
        break;
      default:
        throw new RangeError(`Unbekanntes Eingabeereignis: ${event.type}`);
    }
  }

  getVICBankBase() {
    return ((~this.cia2.getPortPins('a')) & 3) << 14;
  }

  step(vicRequest = null) {
    const cycle = this.clock.cycle;
    this.inputQueue.applyUntil(cycle, event => this.applyInput(event));
    const hardwareRequest = this.vic.beginCycle(cycle);
    const resetActive = this.interrupts.resetActive;
    if (resetActive && !this.resetWasActive) this.cpu.reset();
    this.resetWasActive = resetActive;
    const intent = this.cpu.nextBusCycle();
    const grant = this.arbiter.resolve(vicRequest ?? hardwareRequest, intent, this.externalRDYHigh);
    const levels = this.signalLevels;
    if (levels.ba !== grant.baHigh) this.signals.drive('BA', 'vic', levels.ba = grant.baHigh);
    if (levels.aec !== grant.aecHigh) this.signals.drive('AEC', 'vic', levels.aec = grant.aecHigh);
    if (levels.rdy !== grant.rdyHigh) this.signals.drive('RDY', 'vic', levels.rdy = grant.rdyHigh);
    let value;
    if (grant.cpuBusActive) {
      const context = { cycle, phase: 2, stage: intent.stage, owner: 'cpu' };
      if (intent.kind === 'read') value = this.bus.cpuRead(intent.address, context);
      else if (intent.kind === 'write') this.bus.cpuWrite(intent.address, intent.value, context);
    }
    this.cpu.completeBusCycle({ advanceCPU: grant.advanceCPU, value });
    if (this.hardwareDriveEnabled) this.hardwareDrive.advanceC64Cycles(1);
    this.iec.tick(cycle);
    this.vic.completeBusCycle(grant);
    this.vic.renderCycle();
    if (this.vic.frameNumber !== this.lastNotifiedFrame) {
      this.lastNotifiedFrame = this.vic.frameNumber;
      if (this.onFrame) {
        const frame = this.vic.getFrame();
        this.onFrame({ ...frame, data: frame.data.slice(), cycle: cycle + 1 });
      }
    }
    const traceEvent = {
      cycle, kind: grant.cpuBusActive ? intent.kind : 'idle', address: intent.address,
      value: intent.kind === 'write' ? intent.value : value,
      stage: intent.stage, advanced: grant.advanceCPU,
      repeatedRead: grant.repeatedRead, owner: grant.owner
    };
    if (this.traceEnabled) {
      if (this.trace.length >= this.traceCapacity) this.trace.splice(0, Math.max(1, Math.ceil(this.traceCapacity / 8)));
      this.trace.push(traceEvent);
    }
    this.todAccumulator += this.videoStandard === 'NTSC' ? 60 : 50;
    const todPulse = this.todAccumulator >= this.clock.profile.cpuHz;
    if (todPulse) this.todAccumulator -= this.clock.profile.cpuHz;
    this.cia1.tick({ todPulse });
    this.cia2.tick({ todPulse });
    this.sidResampler.pushCycle(this.sid.tick());
    this.updateSystemSignals();
    this.clock.tick();
    return traceEvent;
  }

  runCycles(count, vicRequest = null) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000000) {
      throw new RangeError('Ungültige Taktanzahl');
    }
    for (let cycle = 0; cycle < count; cycle += 1) this.step(vicRequest);
    return this.cpu.getState();
  }

  getDiagnostics() {
    return {
      phase: 'M9', videoStandard: this.videoStandard, hardwareDriveEnabled: this.hardwareDriveEnabled, hardwareDrive: this.hardwareDrive.getState(), roms: this.roms.getStatus(), mapping: this.bus.getMapping(),
      clock: this.clock.getPosition(), cpu: this.cpu.getState(),
      cia1: this.cia1.getState(), cia2: this.cia2.getState(),
      vicBankBase: this.getVICBankBase(), vic: this.vic.getState(), joystick1: this.joystick.getState(1),
      joystick2: this.joystick.getState(2), iec: this.iec.snapshot(), drive8: this.drive8.getState(),
      sid: this.sid.getState(), audio: this.sidResampler.getState(),
      cpuImplemented: true, vicImplemented: true, sidImplemented: true, ciaImplemented: true
    };
  }
}
