import { Gamepad } from './io/Gamepad.js';
import { WorkerRunner } from './workers/WorkerRunner.js';
import { C64 } from './core/C64.js';
import { CanvasRenderer } from './video/CanvasRenderer.js';
import { MouseJoystick } from './io/MouseJoystick.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { FileManager } from './storage/FileManager.js';
import { ROM_FILENAMES, ROM_SIZES } from './utils/Constants.js';

const machine = new C64();
const canvas = document.getElementById('c64-screen');
const renderer = new CanvasRenderer(canvas, { width: machine.vic.width, height: machine.vic.height });
const fileInput = document.getElementById('rom-files');
const loadLocalButton = document.getElementById('load-local-roms');
const romStatus = document.getElementById('rom-status');
const systemStatus = document.getElementById('system-status');
const cpuStatus = document.getElementById('cpu-status');
const ciaStatus = document.getElementById('cia-status');
const vicStatus = document.getElementById('vic-status');
const busTrace = document.getElementById('bus-trace');
const cpuMessage = document.getElementById('cpu-message');
const runButton = document.getElementById('run-continuous');
const audioStart = document.getElementById('audio-start');
const audioStop = document.getElementById('audio-stop');
const audioMessage = document.getElementById('audio-message');
const sidStatus = document.getElementById('sid-status');
const audioEngine = new AudioEngine();
const gamepad = new Gamepad(event => machine.queueInput(event));
const workerRunner = new WorkerRunner();
const driveImport = document.getElementById('drive-import');
const driveSelection = document.getElementById('drive-selection');
const driveStatus = document.getElementById('drive-status');
const driveMessage = document.getElementById('drive-message');
let audioEnabled = false;
let audioEpochCycle = 0;
const videoFrames = [];
const activeKeyCodes = new Set();
let running = false;
let runTimer = null;
let timeAnchor = 0;
let cycleAnchor = 0;
let lastRefresh = 0;
let lastDriveCatalog = '';

const mouseJoystick = new MouseJoystick(
  (port, direction, pressed) => machine.queueInput({ type: 'direction', port, direction, pressed }),
  (port, pressed) => machine.queueInput({ type: 'fire', port, pressed })
);
mouseJoystick.attach(canvas);

function hex(value, length = 2) {
  return `$${(value ?? 0).toString(16).toUpperCase().padStart(length, '0')}`;
}

function renderCPU(message = '') {
  const state = machine.cpu.getState();
  const clock = machine.clock.getPosition();
  cpuStatus.textContent = `A=${hex(state.A)}  X=${hex(state.X)}  Y=${hex(state.Y)}  SP=${hex(state.SP)}  PC=${hex(state.PC, 4)}  P=${hex(state.P)}\n` +
    `Takte=${clock.cycle}  Befehle=${state.instructionCount}  Interrupts=${state.interruptsServiced}\n` +
    `Status=${state.jammed ? 'JAM/KIL' : state.resetPending ? 'RESET anstehend' : state.sequence ?? 'Befehlsgrenze'}  RAM[$C100]=${hex(machine.memory.readRAM(0xc100))}  IRQ-Zähler[$C200]=${machine.memory.readRAM(0xc200)}`;
  busTrace.textContent = machine.trace.slice(-10).map(event =>
    `${String(event.cycle).padStart(7, ' ')}  ${event.kind.toUpperCase().padEnd(5, ' ')}  ${hex(event.address, 4)}  ` +
    `${event.value === undefined ? '--' : hex(event.value)}  ${event.stage}${event.repeatedRead ? '  RDY' : ''}`
  ).join('\n');
  const cia1 = machine.cia1.getState();
  const cia2 = machine.cia2.getState();
  const vic = machine.vic.getState();
  const joy = port => Object.entries(machine.joystick.getState(port)).filter(([, active]) => active).map(([key]) => key).join(', ') || 'neutral';
  ciaStatus.textContent = `CIA 1  PRA=${hex(cia1.pra)}  PRB=${hex(cia1.prb)}  DDRA=${hex(cia1.ddra)}  DDRB=${hex(cia1.ddrb)}  PA=${hex(cia1.pinsA)}  PB=${hex(cia1.pinsB)}\n` +
    `       TA=${hex(cia1.timerA.counter, 4)}  TB=${hex(cia1.timerB.counter, 4)}  CRA=${hex(cia1.cra)}  CRB=${hex(cia1.crb)}  ICR=${hex(machine.cia1.interruptValue())}\n` +
    `CIA 2  PRA=${hex(cia2.pra)}  DDRA=${hex(cia2.ddra)}  PA=${hex(cia2.pinsA)}  TA=${hex(cia2.timerA.counter, 4)}  TB=${hex(cia2.timerB.counter, 4)}  ICR=${hex(machine.cia2.interruptValue())}\n` +
    `VIC-Bankbasis=${hex(machine.getVICBankBase(), 4)}  IRQ=${machine.interrupts.isIRQActive() ? 'aktiv' : 'inaktiv'}  NMI=${machine.interrupts.isNMIActive() ? 'aktiv' : 'inaktiv'}\n` +
    `Joystick 1: ${joy(1)}   Joystick 2: ${joy(2)}   Tastaturlayout: ${machine.keyboard.layout}`;
  const sprites = vic.sprite;
  vicStatus.textContent = `${machine.videoStandard}  Raster=${String(vic.raster).padStart(3, '0')}  Zyklus=${String(vic.cycleInLine + 1).padStart(2, '0')}/${machine.clock.profile.cyclesPerLine}  Frame=${vic.frameNumber}\n` +
    `D011=${hex(machine.vic.registers[0x11])}  D016=${hex(machine.vic.registers[0x16])}  D018=${hex(machine.vic.registers[0x18])}  D019=${hex(machine.bus.peek(0xd019))}\n` +
    `Screen=${hex(vic.bankBase + vic.screenBase, 4)}  Zeichensatz=${hex(vic.bankBase + vic.charsetBase, 4)}  Badline=${vic.badline ? 'ja' : 'nein'}\n` +
    `Matrix-Fetches=${vic.matrixFetches}  Grafik-Fetches=${vic.graphicsFetches}  DEN-Latch=${vic.denLatched ? '1' : '0'}\n` +
    `Sprites=${hex(machine.bus.peek(0xd015))}  DMA-Pointer=${sprites.pointerFetches}  DMA-Bytes=${sprites.dataFetches}  Gestohlene Φ2-Takte=${sprites.phi2Steals}\n` +
    `Sprite-Sprite-Kollision=${hex(sprites.spriteCollision)}  Sprite-Hintergrund-Kollision=${hex(sprites.dataCollision)}  Prioritäten=${hex(machine.bus.peek(0xd01b))}`;
  const sid = machine.sid;
  const buffer = audioEngine.getBufferStatus();
  sidStatus.textContent = `SID=${sid.filter.model}  SID-Zyklen=${sid.cycles}  PCM erzeugt=${machine.sidResampler.generated}  Im Resampler=${machine.sidResampler.available}\n` +
    sid.voices.map((voice, index) => `Stimme ${index + 1}: FREQ=${hex(voice.frequency, 4)}  PW=${hex(voice.pulseWidth, 3)}  WAVE=${hex(voice.control)}  ENV=${hex(voice.envelope.level)}  PHASE=${hex(voice.accumulator, 6)}`).join('\n') +
    `\nFilter: Cutoff=${sid.filter.cutoff}  Resonanz=${sid.filter.resonance}  Routing=${hex(sid.filter.routing)}  Mode=${hex(sid.filter.mode)}  Volume=${sid.filter.volume}` +
    `\nWeb Audio: ${buffer.active ? 'aktiv' : 'pausiert'}  Samplerate=${audioEngine.initialized ? `${buffer.sampleRate} Hz` : 'nicht initialisiert'}  Puffer=${buffer.buffered}/${buffer.targetSamples} Samples  Unterläufe=${buffer.underruns}`;
  const drive = machine.drive8.getState();
  driveStatus.textContent = `IEC: ATN=${Number(machine.iec.sample('ATN'))} CLOCK=${Number(machine.iec.sample('CLOCK'))} DATA=${Number(machine.iec.sample('DATA'))}  Gerät=${drive.deviceNumber}  ${drive.command}  ${drive.phase}\n` +
    `Laufwerksstatus: ${drive.status}\nDateien: ${drive.files.length}  Kanäle: ${drive.channels.join(', ')}\n` +
    drive.files.map(file => `${file.name.padEnd(16)} ${file.size} Byte  PRG-Start=${hex(file.loadAddress, 4)}`).join('\n');
  if (message) cpuMessage.textContent = message;
}

function renderROMStatus(message = '') {
  const status = machine.roms.getStatus();
  romStatus.replaceChildren();
  for (const [type, info] of Object.entries(status)) {
    const item = document.createElement('li');
    item.textContent = `${ROM_FILENAMES[type]}: ${info.loaded ? `${info.size} Byte geladen` : `fehlt (${ROM_SIZES[type]} Byte)`}`;
    romStatus.append(item);
  }
  systemStatus.textContent = message || (machine.roms.isComplete()
    ? 'Alle ROMs geladen. Originaler KERNAL-/BASIC-Start ist über die emulierte 6510-CPU möglich.'
    : 'Ohne vollständige ROMs ist nur die hardwarebasierte VIC-/CPU-Diagnose möglich. Es wird kein BASIC-Bild simuliert.');
}

function resolveROMType(filename) {
  const name = filename.toLowerCase();
  return Object.entries(ROM_FILENAMES).find(([type, expected]) => name === expected || name === `${type}.bin`)?.[0] ?? null;
}

function pause({ keepAudio = false, resetAudio = false } = {}) {
  running = false;
  if (runTimer !== null) clearTimeout(runTimer);
  runTimer = null;
  runButton.textContent = 'Ausführung starten';
  if (resetAudio) {
    audioEnabled = false;
    machine.onFrame = null;
    videoFrames.length = 0;
    audioEngine.resetQueue();
    audioStart.disabled = false;
    audioStop.disabled = true;
    void audioEngine.suspend();
  } else if (!keepAudio && audioEnabled) {
    void audioEngine.suspend();
  }
}

function flushAudio(force = false) {
  if (!audioEnabled && !force) return;
  while (machine.sidResampler.available >= 256 || (force && machine.sidResampler.available > 0)) {
    const count = Math.min(4096, machine.sidResampler.available);
    audioEngine.enqueue(machine.takeAudioSamples(count));
  }
}

function pump() {
  if (!running) return;
  try {
    const now = performance.now();
    let batch;
    let due;
    if (audioEnabled) {
      flushAudio();
      const buffer = audioEngine.getBufferStatus();
      const queued = buffer.buffered + machine.sidResampler.available;
      due = Math.max(0, buffer.targetSamples - queued);
      batch = Math.min(12000, Math.ceil(due * machine.clock.profile.cpuHz / buffer.sampleRate));
    } else {
      const desired = Math.floor((now - timeAnchor) * machine.clock.profile.cpuHz / 1000);
      const executed = machine.clock.cycle - cycleAnchor;
      due = Math.max(0, desired - executed);
      batch = Math.min(12000, due);
      if (due > 250000) {
        timeAnchor = now;
        cycleAnchor = machine.clock.cycle;
      }
    }
    if (batch > 0) machine.runCycles(batch);
    if (audioEnabled) flushAudio();
    if (now - lastRefresh >= 100) {
      const catalog = machine.files.list().map(file => `${file.name}:${file.size}`).join('|');
      if (catalog !== lastDriveCatalog) refreshDriveFiles();
      else renderCPU();
      lastRefresh = now;
    }
    runTimer = setTimeout(pump, due > 0 ? 0 : 4);
  } catch (error) {
    pause({ resetAudio: true });
    renderCPU(`Fehler bei der Ausführung: ${error.message}`);
    audioMessage.textContent = `Audio gestoppt: ${error.message}`;
  }
}

function startContinuous(message = 'Kontinuierliche emulierte Ausführung aktiv.') {
  pause({ keepAudio: true });
  running = true;
  runButton.textContent = 'Ausführung pausieren';
  timeAnchor = performance.now();
  cycleAnchor = machine.clock.cycle;
  lastRefresh = 0;
  renderCPU(message);
  if (audioEnabled) {
    void audioEngine.resume().then(() => { if (running) pump(); }).catch(error => {
      pause({ resetAudio: true });
      audioMessage.textContent = `Audio konnte nicht fortgesetzt werden: ${error.message}`;
    });
  } else pump();
}

async function enableAudio({ resumeWithoutAudio = false } = {}) {
  if (audioEnabled) return;
  pause();
  audioStart.disabled = true;
  audioMessage.textContent = 'AudioWorklet wird initialisiert.';
  try {
    await audioEngine.initialize();
    audioEngine.resetQueue();
    machine.configureAudioSampleRate(audioEngine.context.sampleRate);
    videoFrames.length = 0;
    audioEpochCycle = machine.clock.cycle;
    machine.onFrame = frame => {
      videoFrames.push(frame);
      if (videoFrames.length > 20) videoFrames.shift();
    };
    audioEnabled = true;
    const target = audioEngine.getBufferStatus().targetSamples;
    const cycles = Math.ceil(target * machine.clock.profile.cpuHz / audioEngine.context.sampleRate);
    machine.runCycles(cycles);
    flushAudio(true);
    await audioEngine.resume();
    audioStop.disabled = false;
    audioMessage.textContent = `AudioWorklet aktiv, ${audioEngine.context.sampleRate} Hz, ${Math.round(audioEngine.targetSeconds * 1000)} ms Zielpuffer.`;
    startContinuous('Emulierte Ausführung ist an den Audio-Sampleverbrauch gekoppelt.');
  } catch (error) {
    pause({ resetAudio: true });
    audioMessage.textContent = `Audio nicht verfügbar: ${error.message}`;
    if (resumeWithoutAudio) startContinuous('Ausführung ohne Ton aktiv.');
  }
}

function startMachine(withAudio, message) {
  if (withAudio) void enableAudio({ resumeWithoutAudio: true });
  else startContinuous(message);
}

function presentVideo() {
  gamepad.poll();
  if (audioEnabled) {
    const buffer = audioEngine.getBufferStatus();
    const playedCycle = audioEpochCycle + buffer.consumed * machine.clock.profile.cpuHz / buffer.sampleRate;
    let frame = null;
    while (videoFrames.length && videoFrames[0].cycle <= playedCycle) frame = videoFrames.shift();
    if (frame && frame.frameNumber !== renderer.lastPresentedFrame) renderer.present(frame);
  } else {
    const frame = machine.vic.getFrame();
    if (frame.frameNumber > 0 && frame.frameNumber !== renderer.lastPresentedFrame) renderer.present(frame);
  }
  requestAnimationFrame(presentVideo);
}
requestAnimationFrame(presentVideo);

function invoke(action) {
  pause({ resetAudio: true });
  try {
    renderer.lastPresentedFrame = -1;
    renderCPU(action());
  } catch (error) {
    renderCPU(`Fehler: ${error.message}`);
  }
}

function releaseKeys() {
  for (const code of activeKeyCodes) machine.queueInput({ type: 'key', code, pressed: false });
  activeKeyCodes.clear();
}

canvas.addEventListener('keydown', event => {
  const detail = {
    key: event.key, ctrl: event.ctrlKey, alt: event.altKey,
    altGraph: event.getModifierState('AltGraph')
  };
  if (!activeKeyCodes.has(event.code) && !machine.keyboard.isMappedCode(event.code, detail)) return;
  event.preventDefault();
  if (activeKeyCodes.has(event.code)) return;
  activeKeyCodes.add(event.code);
  machine.queueInput({ type: 'key', code: event.code, pressed: true, ...detail });
});

window.addEventListener('keyup', event => {
  if (!activeKeyCodes.has(event.code)) return;
  event.preventDefault();
  activeKeyCodes.delete(event.code);
  machine.queueInput({ type: 'key', code: event.code, pressed: false });
});

canvas.addEventListener('blur', releaseKeys);
window.addEventListener('blur', releaseKeys);

const keyboardLayout = document.getElementById('keyboard-layout');
keyboardLayout.addEventListener('change', event => {
  releaseKeys();
  machine.keyboard.setLayout(event.target.value);
  renderCPU('Tastaturlayout gewechselt.');
});
if ((navigator.language ?? '').toLowerCase().startsWith('de')) keyboardLayout.value = 'de';
machine.keyboard.setLayout(keyboardLayout.value);

document.getElementById('joystick-port').addEventListener('change', event => {
  mouseJoystick.setPort(Number(event.target.value));
  renderCPU(`Maus-Joystick auf Port ${event.target.value} umgeschaltet.`);
});


document.getElementById('video-standard').addEventListener('change', event => {
  invoke(() => {
    gamepad.releaseAll();
    machine.setVideoStandard(event.target.value);
    renderer.configureSource(machine.vic.width, machine.vic.height, event.target.value === 'NTSC' ? 0.83 : 0.94);
    return `${event.target.value}-Profil geladen: ${machine.clock.profile.linesPerFrame} Zeilen × ${machine.clock.profile.cyclesPerLine} Takte.`;
  });
});

document.getElementById('gamepad-enabled').addEventListener('change', event => {
  gamepad.setEnabled(event.target.checked);
  renderCPU(event.target.checked ? 'Gamepad-Abfrage aktiviert.' : 'Gamepad-Abfrage deaktiviert.');
});

document.getElementById('gamepad-port').addEventListener('change', event => {
  gamepad.setPort(Number(event.target.value));
});

window.addEventListener('gamepaddisconnected', () => gamepad.poll([]));

const workerButton = document.getElementById('worker-demo');
workerButton.addEventListener('click', async () => {
  workerButton.disabled = true;
  const status = document.getElementById('worker-status');
  status.textContent = 'Unabhängiger C64-Worker-Test läuft.';
  try {
    await workerRunner.start(machine.videoStandard, machine.sid.filter.model);
    await workerRunner.request('demo', { kind: 'sprite' });
    const result = await workerRunner.request('run', { cycles: machine.clock.cyclesPerFrame * 2 });
    const frame = await workerRunner.request('frame');
    status.textContent = `Worker: ${result.cycle} Takte, Frame ${frame.frameNumber}, ${frame.width} × ${frame.height} Pixel. Hauptemulator unverändert.`;
  } catch (error) {
    status.textContent = `Worker-Test nicht verfügbar: ${error.message}`;
  } finally {
    workerRunner.terminate();
    workerButton.disabled = false;
  }
});

const driveRom = document.getElementById('drive-rom');
driveRom.addEventListener('change', async () => {
  const file = driveRom.files?.[0];
  if (!file) return;
  try {
    const size = machine.load1541ROM(await file.arrayBuffer());
    driveMessage.textContent = `1541-ROM geladen (${size} Byte). Der Hardwaremodus ist experimentell.`;
  } catch (error) {
    driveMessage.textContent = `1541-ROM-Fehler: ${error.message}`;
  }
  driveRom.value = '';
});

document.getElementById('hardware-drive-enabled').addEventListener('change', event => {
  pause({ resetAudio: true });
  try {
    machine.setHardwareDriveEnabled(event.target.checked);
    driveMessage.textContent = machine.hardwareDriveEnabled ? '1541-Hardwarepfad aktiv (nicht vollständig kompatibilitätsbestätigt).' : 'Virtuelles IEC-Gerät 8 aktiv.';
  } catch (error) {
    event.target.checked = machine.hardwareDriveEnabled;
    driveMessage.textContent = error.message;
  }
  refreshDriveFiles();
});

document.getElementById('drive-export-d64').addEventListener('click', () => {
  try {
    FileManager.saveBrowserFile('c64-disk.d64', machine.drive8.exportD64());
    driveMessage.textContent = 'D64-Abbild exportiert.';
  } catch (error) {
    driveMessage.textContent = error.message;
  }
});

document.getElementById('integer-scale').addEventListener('change', event => renderer.setIntegerScaling(event.target.checked));

document.getElementById('power-on').addEventListener('click', () => invoke(() => {
  mouseJoystick.reset();
  machine.powerOn();
  return 'Power-On ausgeführt. Der 6510 liest den Reset-Vektor aus der tatsächlichen Speicherabbildung.';
}));

document.getElementById('reset-cpu').addEventListener('click', () => invoke(() => {
  machine.reset();
  return 'Hardware-RESET ausgeführt; RAM bleibt erhalten.';
}));

document.getElementById('step-cycle').addEventListener('click', () => invoke(() => {
  machine.step();
  return 'Ein vollständiger CPU-/VIC-/CIA-Mastertakt ausgeführt.';
}));

document.getElementById('step-instruction').addEventListener('click', () => invoke(() => {
  const before = machine.cpu.instructionsExecuted;
  let cycles = 0;
  while (machine.cpu.instructionsExecuted === before && cycles < 256 && !machine.cpu.jammed) {
    machine.step();
    cycles += 1;
  }
  return `Ausgeführt: ${cycles} Takte bis Befehlsabschluss oder Hardware-Halt.`;
}));

document.getElementById('run-batch').addEventListener('click', () => invoke(() => {
  machine.runCycles(10000);
  return '10.000 CPU-/VIC-/CIA-Takte verarbeitet.';
}));

document.getElementById('run-frame').addEventListener('click', () => invoke(() => {
  const framesize = machine.clock.cyclesPerFrame;
  machine.runCycles(framesize - (machine.clock.cycle % framesize));
  return `Ein emulierter ${machine.videoStandard}-Frame abgeschlossen.`;
}));

audioStart.addEventListener('click', () => { void enableAudio(); });

audioStop.addEventListener('click', () => {
  pause({ resetAudio: true });
  audioMessage.textContent = 'Audio deaktiviert. Die Emulation kann ohne Ton fortgesetzt werden.';
  renderCPU();
});

document.getElementById('sid-model').addEventListener('change', event => {
  machine.setSIDModel(event.target.value);
  renderCPU(`SID-Filtermodell: ${event.target.value}`);
});

runButton.addEventListener('click', () => {
  if (running) {
    pause();
    renderCPU('Ausführung pausiert.');
  } else startContinuous('Kontinuierliche Ausführung aktiv. Das Canvas anklicken, um BASIC-Tasten einzugeben.');
});

document.getElementById('boot-roms').addEventListener('click', () => {
  if (!machine.roms.isComplete()) {
    renderROMStatus('Für den originalen BASIC-Start werden alle drei ROMs benötigt.');
    return;
  }
  const withAudio = audioEnabled;
  pause({ resetAudio: true });
  mouseJoystick.reset();
  machine.powerOn();
  renderer.lastPresentedFrame = -1;
  startMachine(withAudio, 'Original-ROMs werden über CPU, CIA und VIC ausgeführt.');
});

document.getElementById('load-demo').addEventListener('click', () => invoke(() => {
  machine.loadDiagnosticProgram(new Uint8Array([0xa9, 0x2a, 0x8d, 0x00, 0xc1, 0xee, 0x00, 0xc1, 0x4c, 0x08, 0xc0]));
  return 'Echtes 6510-Diagnoseprogramm geladen. Nach 12 Takten steht $2B bei $C100.';
}));

document.getElementById('load-cia-demo').addEventListener('click', () => invoke(() => {
  machine.loadCIATimerDemo();
  return '6510-CIA-Demo geladen. 10.000 Takte ausführen: IRQ-Routine erhöht RAM[$C200].';
}));

document.getElementById('load-sid-demo').addEventListener('click', () => {
  invoke(() => {
    const size = machine.loadSIDDemo();
    return `SID-Dreiklang: ${size} Byte 6510-Maschinencode. Die Audioausgabe wird gestartet.`;
  });
  startMachine(true, '');
});

document.getElementById('load-sprite-demo').addEventListener('click', () => invoke(() => {
  const size = machine.loadSpriteDemo();
  machine.runCycles(machine.clock.cyclesPerFrame * 2);
  return `Acht Hardware-Sprites durch ${size} Bytes echten 6510-Code eingerichtet. Zwei PAL-Frames berechnet.`;
}));

document.getElementById('load-vic-demo').addEventListener('click', () => invoke(() => {
  machine.loadVICDemo();
  return 'VIC-Demo als echter 6510-Maschinencode geladen. Ein PAL-Frame zeigt Zeichen aus RAM in VIC-Bank 1.';
}));

async function afterROMLoad(message) {
  const withAudio = audioEnabled;
  pause({ resetAudio: true });
  if (machine.roms.isComplete()) {
    machine.powerOn();
    renderer.lastPresentedFrame = -1;
    renderROMStatus(`${message} Originaler KERNAL-/BASIC-Start ausgelöst.`);
    startMachine(withAudio, 'Original-ROM-Start läuft. Bildschirm und Zeichen werden von der emulierten Hardware erzeugt.');
  } else renderROMStatus(message);
}

fileInput.addEventListener('change', async () => {
  const errors = [];
  let loaded = 0;
  for (const file of fileInput.files) {
    const type = resolveROMType(file.name);
    if (!type) {
      errors.push(`${file.name}: unbekannter Dateiname`);
      continue;
    }
    try {
      machine.loadROM(type, await file.arrayBuffer());
      loaded += 1;
    } catch (error) {
      errors.push(error.message);
    }
  }
  fileInput.value = '';
  await afterROMLoad(`${loaded} ROM-Datei(en) geladen.${errors.length ? ` Fehler: ${errors.join('; ')}` : ''}`);
});

loadLocalButton.addEventListener('click', async () => {
  loadLocalButton.disabled = true;
  const errors = [];
  let loaded = 0;
  for (const [type, filename] of Object.entries(ROM_FILENAMES)) {
    try {
      await machine.roms.loadFromURL(type, `./rom/${filename}`);
      loaded += 1;
    } catch (error) {
      errors.push(`${filename}: ${error.message}`);
    }
  }
  loadLocalButton.disabled = false;
  await afterROMLoad(`${loaded} ROM-Datei(en) aus dem Projektordner geladen.${errors.length ? ` Fehler: ${errors.join('; ')}` : ''}`);
});

function refreshDriveFiles(message = '') {
  const selected = driveSelection.value;
  lastDriveCatalog = machine.files.list().map(file => `${file.name}:${file.size}`).join('|');
  driveSelection.replaceChildren();
  for (const file of machine.files.list()) {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = `${file.name} (${file.size} Byte)`;
    driveSelection.append(option);
  }
  if (selected && machine.files.get(selected)) driveSelection.value = selected;
  renderCPU();
  if (message) driveMessage.textContent = message;
}

document.getElementById('drive-import-action').addEventListener('click', async () => {
  let count = 0;
  const errors = [];
  for (const file of driveImport.files) {
    try {
      if (/\.d64$/i.test(file.name)) count += machine.mountD64(await file.arrayBuffer());
      else count += (await machine.files.importFile(file, { overwrite: true })).length;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  driveImport.value = '';
  refreshDriveFiles(`${count} Datei(en) importiert.${errors.length ? ` Fehler: ${errors.join('; ')}` : ''}`);
});

document.getElementById('drive-load-examples').addEventListener('click', async () => {
  const errors = [];
  let count = 0;
  for (const name of ['IECDEMO', 'BORDER']) {
    try {
      const response = await fetch(`./examples/${name}.prg`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      machine.files.store(name, await response.arrayBuffer(), { overwrite: true });
      count += 1;
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  refreshDriveFiles(`${count} Beispiel-PRGs eingelegt.${errors.length ? ` Fehler: ${errors.join('; ')}` : ''}`);
});

document.getElementById('drive-export-prg').addEventListener('click', () => {
  try {
    const file = machine.files.exportPRG(driveSelection.value);
    FileManager.saveBrowserFile(file.name, file.data);
    driveMessage.textContent = `${file.name} exportiert.`;
  } catch (error) {
    driveMessage.textContent = error.message;
  }
});

document.getElementById('drive-export-base64').addEventListener('click', () => {
  FileManager.saveBrowserFile('c64-disk.c64b64', machine.files.exportContainer(), 'application/json');
  driveMessage.textContent = 'Base64-Dateicontainer exportiert.';
});

document.getElementById('drive-kernal-load').addEventListener('click', () => {
  const name = driveSelection.value;
  if (!name) {
    driveMessage.textContent = 'Zuerst eine PRG-Datei importieren.';
    return;
  }
  invoke(() => {
    machine.installKernalFileDemo('load', name, 1);
    return `KERNAL-LOAD-Diagnose für ${name} bereit. Ausführung starten; Ergebnis bei $C220/$C221. Keine direkte RAM-Ladeabkürzung.`;
  });
});

document.getElementById('drive-kernal-save').addEventListener('click', () => invoke(() => {
  machine.installKernalFileDemo('save', 'M7SAVE', 1);
  return 'KERNAL-SAVE-Diagnose bei $C000 bereit. Original-ROMs erforderlich; danach Dateikatalog aktualisieren.';
}));

machine.traceEnabled = false;
const resizeObserver = new ResizeObserver(() => renderer.resize());
resizeObserver.observe(document.getElementById('screen-host'));
window.addEventListener('resize', () => renderer.resize());
renderROMStatus();
refreshDriveFiles();
renderCPU('M7 bereit. PRG-Dateien in Gerät 8 importieren und KERNAL-/BASIC-Kommunikation testen.');
