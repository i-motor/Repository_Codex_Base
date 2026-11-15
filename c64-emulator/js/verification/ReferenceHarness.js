import { C64 } from '../core/C64.js';
import { CPUReferenceMachine } from './CPUReferenceMachine.js';
import { PRGLoader } from '../storage/PRGLoader.js';

function number(value, maximum = 0xffff) {
  let result = value;
  if (typeof value === 'string') {
    const text = value.trim();
    result = text.startsWith('$') ? Number.parseInt(text.slice(1), 16)
      : text.startsWith('0x') ? Number.parseInt(text.slice(2), 16)
        : Number(text);
  }
  if (!Number.isSafeInteger(result) || result < 0 || result > maximum) {
    throw new RangeError(`Ungültiger Referenzwert: ${value}`);
  }
  return result;
}

function bytes(source) {
  if (source instanceof Uint8Array) return source;
  if (!Array.isArray(source)) throw new TypeError('Bytefolge benötigt ein Array');
  return Uint8Array.from(source.map(value => number(value, 255)));
}

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function findScreenText(machine, text) {
  const pattern = Array.from(text, character => character.charCodeAt(0) & 63);
  for (let address = 0x0400; address <= 0x07e8 - pattern.length; address += 1) {
    let matches = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (machine.memory.readRAM(address + index) !== pattern[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return address;
  }
  return -1;
}

function assertMatch(actual, expected, path, mismatches) {
  if (actual !== expected) {
    mismatches.push({ path, expected, actual });
  }
}

function configure(machine, fixture, loader) {
  if (!fixture || typeof fixture !== 'object') return;
  if (fixture.memoryImage) {
    if (!loader) throw new Error('Referenzabbild benötigt einen Binärdatei-Loader');
    const image = loader(fixture.memoryImage);
    if (!(image instanceof Uint8Array) || image.length !== 65536) {
      throw new RangeError('Das externe CPU-Speicherabbild muss genau 65536 Byte enthalten');
    }
    machine.memory.ram.set(image);
  }
  for (const entry of fixture.memory ?? []) {
    machine.memory.writeRAM(number(entry.address), number(entry.value, 255));
  }
  for (const entry of fixture.color ?? []) {
    machine.memory.writeColor(number(entry.index, 1023), number(entry.value, 15));
  }
  if (fixture.program) {
    const address = number(fixture.address ?? 0xc000);
    const program = bytes(fixture.program);
    if (address + program.length > 65536) throw new RangeError('Programm überschreitet den Adressraum');
    machine.memory.ram.set(program, address);
  }
  if (machine.processorPort) machine.processorPort.writePins(number(fixture.port ?? 0x35, 255));
  if (fixture.cpu || fixture.program || fixture.memoryImage) {
    const cpuState = { PC: number(fixture.cpu?.PC ?? fixture.address ?? 0xc000), SP: 0xfd, P: 0x24 };
    for (const [key, value] of Object.entries(fixture.cpu ?? {})) {
      if (!['A', 'X', 'Y', 'SP', 'PC', 'P'].includes(key)) throw new RangeError(`Unbekanntes CPU-Testregister: ${key}`);
      cpuState[key] = number(value, key === 'PC' ? 65535 : 255);
    }
    machine.cpu.setTestState(cpuState);
  }
  for (const entry of fixture.registers ?? []) {
    machine.bus.cpuWrite(number(entry.address), number(entry.value, 255));
  }
  for (const entry of fixture.files ?? []) {
    machine.files.store(entry.name, bytes(entry.bytes));
  }
  if (fixture.irq) machine.interrupts.setIRQ('reference', true);
  if (fixture.nmi) machine.interrupts.setNMI('reference', true);
  if (fixture.rdyLow) machine.externalRDYHigh = false;
}

function compare(machine, expected, events) {
  const mismatches = [];
  for (const [key, value] of Object.entries(expected.cpu ?? {})) {
    assertMatch(machine.cpu.getState()[key], typeof value === 'boolean' ? value : number(value, key === 'PC' ? 65535 : Number.MAX_SAFE_INTEGER), `cpu.${key}`, mismatches);
  }
  for (const entry of expected.memory ?? []) {
    const address = number(entry.address);
    assertMatch(machine.memory.readRAM(address), number(entry.value, 255), `ram.${address.toString(16)}`, mismatches);
  }
  for (const entry of expected.registers ?? []) {
    const address = number(entry.address);
    assertMatch(machine.bus.peek(address), number(entry.value, 255), `peek.${address.toString(16)}`, mismatches);
  }
  if (expected.vic && !machine.vic) throw new Error('Die CPU-Referenzmaschine besitzt keinen VIC-II');
  for (const [key, value] of Object.entries(expected.vic ?? {})) {
    assertMatch(machine.vic.getState()[key], number(value, Number.MAX_SAFE_INTEGER), `vic.${key}`, mismatches);
  }
  for (const [key, value] of Object.entries(expected.clock ?? {})) {
    assertMatch(machine.clock.getPosition()[key], number(value, Number.MAX_SAFE_INTEGER), `clock.${key}`, mismatches);
  }
  for (const [key, value] of Object.entries(expected.interrupts ?? {})) {
    const actual = key === 'irq' ? machine.interrupts.isIRQActive()
      : key === 'nmi' ? machine.interrupts.isNMIActive()
        : undefined;
    assertMatch(actual, value, `interrupts.${key}`, mismatches);
  }
  if (expected.frameCRC32 !== undefined) {
    if (!machine.vic) throw new Error('Framebuffer-Prüfung benötigt den C64-VIC');
    assertMatch(crc32(machine.vic.getFrame().data), number(expected.frameCRC32, 0xffffffff), 'frame.crc32', mismatches);
  }
  if (expected.screenText !== undefined) {
    for (const fragment of expected.screenText) {
      if (findScreenText(machine, fragment) < 0) mismatches.push({ path: 'screenText', expected: fragment, actual: 'nicht gefunden' });
    }
  }
  if (expected.trace) {
    if (expected.trace.length !== events.length) {
      mismatches.push({ path: 'trace.length', expected: expected.trace.length, actual: events.length });
    }
    for (let index = 0; index < Math.min(events.length, expected.trace.length); index += 1) {
      for (const [key, raw] of Object.entries(expected.trace[index])) {
        const actual = events[index][key];
        const target = ['cycle', 'address', 'value'].includes(key) ? number(raw, Number.MAX_SAFE_INTEGER) : raw;
        assertMatch(actual, target, `trace[${index}].${key}`, mismatches);
      }
    }
  }
  return mismatches;
}

function execute(machine, run) {
  const maxCycles = number(run?.maxCycles ?? run?.cycles ?? 0, 50000000);
  const untilPC = run?.untilPC === undefined ? null : number(run.untilPC);
  const repetitions = number(run?.stableInstructions ?? 4, 1000);
  const filter = run?.traceFilter ?? 'all';
  const events = [];
  let reached = untilPC === null;
  let stable = 0;
  let previousInstructions = machine.cpu.instructionsExecuted;
  let elapsed = 0;
  for (; elapsed < maxCycles; elapsed += 1) {
    const event = machine.step();
    if (filter === 'all' || (filter === 'writes' && event.kind === 'write') ||
        (filter === 'reads' && event.kind === 'read') || (filter === 'active' && event.kind !== 'idle')) {
      if (events.length < 32768) events.push(event);
    }
    if (machine.cpu.jammed) break;
    if (untilPC !== null && machine.cpu.instructionsExecuted !== previousInstructions) {
      previousInstructions = machine.cpu.instructionsExecuted;
      stable = machine.cpu.PC === untilPC ? stable + 1 : 0;
      if (stable >= repetitions) {
        reached = true;
        elapsed += 1;
        break;
      }
    }
  }
  return { events, cycles: elapsed, reached, jammed: machine.cpu.jammed };
}

export function verifyScenario(scenario, { loadBinary, roms } = {}) {
  if (!scenario || typeof scenario.id !== 'string' || !scenario.id.trim()) {
    throw new TypeError('Jede Referenz benötigt eine eindeutige ID');
  }
  const kind = scenario.kind ?? 'machine';
  if (kind !== 'machine' && kind !== 'rom-boot') throw new RangeError(`Unbekannter Referenztyp: ${kind}`);
  const hardware = scenario.hardware ?? 'c64';
  if (!['c64', 'cpu6502'].includes(hardware)) throw new RangeError(`Ungültige Referenz-Hardware: ${hardware}`);
  if (kind === 'rom-boot' && hardware !== 'c64') throw new RangeError('Original-ROM-Start benötigt C64-Hardware');
  const machine = hardware === 'cpu6502' ? new CPUReferenceMachine() : new C64();
  if (kind === 'rom-boot') {
    if (!roms?.basic || !roms?.kernal || !roms?.chargen) {
      return { id: scenario.id, status: 'skipped', classification: 'requires-original-roms', reason: 'Originale BASIC-/KERNAL-/CHAR-ROMs fehlen' };
    }
    for (const type of ['basic', 'kernal', 'chargen']) machine.loadROM(type, roms[type]);
    machine.powerOn();
    const budget = number(scenario.run?.maxCycles ?? 4000000, 50000000);
    let found = false;
    let cycles = 0;
    for (; cycles < budget; cycles += 10000) {
      machine.runCycles(Math.min(10000, budget - cycles));
      found = findScreenText(machine, 'COMMODORE') >= 0 && findScreenText(machine, 'READY.') >= 0 && machine.vic.frameNumber > 0;
      if (found || machine.cpu.jammed) break;
    }
    const mismatches = found ? [] : [{ path: 'rom.boot', expected: 'COMMODORE / READY. auf dem VIC-Screen', actual: machine.cpu.jammed ? 'JAM' : 'nicht erreicht' }];
    return { id: scenario.id, status: mismatches.length ? 'failed' : 'passed', classification: 'original-rom', cycles: machine.clock.cycle, mismatches, cpu: machine.cpu.getState() };
  }
  configure(machine, scenario.setup ?? {}, loadBinary);
  const execution = execute(machine, scenario.run ?? {});
  const mismatches = compare(machine, scenario.expect ?? {}, execution.events);
  if (!execution.reached) mismatches.push({ path: 'run.untilPC', expected: scenario.run.untilPC, actual: machine.cpu.PC });
  if (execution.jammed && scenario.expect?.cpu?.jammed !== true) mismatches.push({ path: 'cpu.jammed', expected: false, actual: true });
  return {
    id: scenario.id,
    status: mismatches.length ? 'failed' : 'passed',
    classification: scenario.source?.type === 'external' ? 'external-candidate' : 'local-fixture',
    cycles: machine.clock.cycle,
    mismatches,
    cpu: machine.cpu.getState(),
    frameCRC32: machine.vic ? crc32(machine.vic.getFrame().data) : null,
    eventsCaptured: execution.events.length
  };
}

export function verifyManifest(manifest, options = {}) {
  if (manifest?.format !== 'c64-reference-v1' || !Array.isArray(manifest.scenarios)) {
    throw new TypeError('Ungültiges Referenzmanifest: c64-reference-v1 erwartet');
  }
  const ids = new Set();
  return manifest.scenarios.map(scenario => {
    if (ids.has(scenario.id)) throw new Error(`Doppelte Referenz-ID: ${scenario.id}`);
    ids.add(scenario.id);
    try {
      return verifyScenario(scenario, options);
    } catch (error) {
      return { id: scenario.id, status: 'error', classification: 'execution-error', reason: error.message };
    }
  });
}
