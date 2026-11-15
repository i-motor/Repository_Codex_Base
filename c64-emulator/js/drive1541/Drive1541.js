import { CPU6502 } from './CPU6502.js';
import { VIA6522 } from './VIA6522.js';
import { GCRCodec } from './GCRCodec.js';
import { InterruptController } from '../core/InterruptController.js';
import { D64Image } from '../storage/D64Image.js';

export class Drive1541 {
  constructor({ c64Hz = 985248.44, driveHz = 1000000, bus = null } = {}) {
    this.c64Hz = c64Hz;
    this.driveHz = driveHz;
    this.ram = new Uint8Array(2048);
    this.rom = null;
    this.disk = null;
    this.bus = bus;
    this.interrupts = new InterruptController();
    this.cpu = new CPU6502(this.interrupts);
    this.via1 = new VIA6522({
      name: 'iec',
      readPort: port => this.readIECInputs(port),
      onPortChange: () => this.updateIECOutputs(),
      onIRQChange: active => this.interrupts.setIRQ('via1', active)
    });
    this.via2 = new VIA6522({
      name: 'disk',
      readPort: port => port === 'a' ? this.diskByte : this.getDiskInputs(),
      onPortChange: port => { if (port === 'b') this.updateMechanism(); },
      onIRQChange: active => this.interrupts.setIRQ('via2', active)
    });
    this.accumulator = 0;
    this.cycles = 0;
    this.bitPhase = 0;
    this.bitPosition = 0;
    this.gcr = null;
    this.gcrTrack = 0;
    this.diskByte = 0;
    this.shift = 0;
    this.shiftBits = 0;
    this.halfTrack = 36;
    this.stepperPhase = 0;
    this.motorOn = false;
    this.ledOn = false;
    this.writeMode = false;
    this.headTrack = 18;
    this.reset();
  }

  loadROM(buffer) {
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (input.length !== 16384 && input.length !== 32768) throw new RangeError('1541-ROM benötigt 16384 oder 32768 Byte');
    this.rom = input.slice();
    this.reset();
    return this.rom.length;
  }

  mount(image) {
    this.disk = image instanceof D64Image ? image : new D64Image(image);
    this.gcr = null;
    this.gcrTrack = 0;
    this.bitPosition = 0;
    return this.disk.listDirectory();
  }

  reset() {
    this.cpu.powerOn();
    this.interrupts.reset();
    this.via1.reset();
    this.via2.reset();
    this.accumulator = 0;
    this.cycles = 0;
    this.bitPhase = 0;
    this.shiftBits = 0;
    this.motorOn = false;
    this.ledOn = false;
    this.stepperPhase = 0;
    this.halfTrack = 36;
    this.headTrack = 18;
    this.diskByte = 0;
    this.gcr = null;
    this.gcrTrack = 0;
    this.bitPosition = 0;
    this.updateIECOutputs();
  }

  readIECInputs(port) {
    if (port !== 'b') return 255;
    if (!this.bus) return 255;
    let value = 0xff;
    if (!this.bus.sample('DATA')) value &= ~1;
    if (!this.bus.sample('CLOCK')) value &= ~4;
    if (!this.bus.sample('ATN')) value &= ~0x80;
    return value;
  }

  updateIECOutputs() {
    if (!this.bus) return;
    const value = this.via1.orb;
    const ddr = this.via1.ddrb;
    this.bus.drive('1541-hardware', 'DATA', Boolean(ddr & 2) && Boolean(value & 2));
    this.bus.drive('1541-hardware', 'CLOCK', Boolean(ddr & 8) && Boolean(value & 8));
  }

  getDiskInputs() {
    let value = 0xff;
    if (!this.disk) value &= ~0x10;
    return value;
  }

  updateMechanism() {
    const nextPhase = this.via2.orb & 3;
    const difference = (nextPhase - this.stepperPhase + 4) & 3;
    const nextMotor = Boolean(this.via2.orb & 4);
    if (nextMotor && this.motorOn) {
      if (difference === 1) this.halfTrack = Math.min(84, this.halfTrack + 1);
      if (difference === 3) this.halfTrack = Math.max(2, this.halfTrack - 1);
    }
    this.stepperPhase = nextPhase;
    this.motorOn = nextMotor;
    this.ledOn = Boolean(this.via2.orb & 8);
    this.writeMode = Boolean(this.via2.cb2 === false);
    const track = Math.max(1, Math.min(42, Math.floor((this.halfTrack + 1) / 2)));
    if (track !== this.headTrack) {
      this.headTrack = track;
      this.gcr = null;
      this.bitPosition = 0;
    }
  }

  read(address) {
    const a = address & 0xffff;
    if (a < 0x1800) return this.ram[a & 0x7ff];
    if (a < 0x1c00) return this.via1.readRegister(a);
    if (a < 0x2000) return this.via2.readRegister(a);
    if (this.rom && a >= 0x10000 - this.rom.length) return this.rom[a - (0x10000 - this.rom.length)];
    return 255;
  }

  write(address, value) {
    const a = address & 0xffff;
    if (a < 0x1800) this.ram[a & 0x7ff] = value & 255;
    else if (a < 0x1c00) this.via1.writeRegister(a, value);
    else if (a < 0x2000) this.via2.writeRegister(a, value);
  }

  clockDiskBit() {
    if (!this.motorOn || !this.disk || this.headTrack > this.disk.tracks) return;
    if (!this.gcr || this.gcrTrack !== this.headTrack || this.disk.dirty) {
      this.gcr = GCRCodec.encodeTrack(this.disk, this.headTrack);
      this.gcrTrack = this.headTrack;
      this.disk.dirty = false;
      this.bitPosition = 0;
    }
    if (!this.gcr.length) return;
    const index = this.bitPosition >>> 3;
    const bit = (this.gcr[index] >>> (7 - (this.bitPosition & 7))) & 1;
    this.bitPosition = (this.bitPosition + 1) % (this.gcr.length * 8);
    this.shift = ((this.shift << 1) | bit) & 255;
    this.shiftBits += 1;
    if (this.shiftBits >= 8) {
      this.shiftBits = 0;
      this.diskByte = this.shift;
      this.via2.setCA1(false);
      this.via2.setCA1(true);
    }
  }

  step() {
    const intent = this.cpu.nextBusCycle();
    let value;
    if (intent.kind === 'read') value = this.read(intent.address);
    else if (intent.kind === 'write') this.write(intent.address, intent.value);
    this.cpu.completeBusCycle({ advanceCPU: true, value });
    this.via1.tick();
    this.via2.tick();
    this.updateMechanism();
    const bitRate = this.headTrack <= 17 ? 307692 : this.headTrack <= 24 ? 285714 : this.headTrack <= 30 ? 266667 : 250000;
    this.bitPhase += bitRate;
    while (this.bitPhase >= this.driveHz) {
      this.clockDiskBit();
      this.bitPhase -= this.driveHz;
    }
    this.cycles += 1;
  }

  advanceC64Cycles(count = 1) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Ungültige Taktanzahl');
    this.accumulator += count * this.driveHz;
    let executed = 0;
    while (this.accumulator >= this.c64Hz) {
      this.step();
      this.accumulator -= this.c64Hz;
      executed += 1;
    }
    return executed;
  }

  getState() {
    return {
      cycles: this.cycles, romLoaded: Boolean(this.rom), diskMounted: Boolean(this.disk),
      headTrack: this.headTrack, halfTrack: this.halfTrack, motorOn: this.motorOn,
      ledOn: this.ledOn, bitPosition: this.bitPosition,
      cpu: this.cpu.getState(), via1: this.via1.snapshot(), via2: this.via2.snapshot()
    };
  }
}
