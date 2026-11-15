import { C64 } from './core/C64.js';
import { RealTimeScheduler } from './core/Clock.js';
import { guessRomKind, loadRomFromUrl, validateRom } from './core/ROMManager.js';
import { CanvasRenderer } from './video/CanvasRenderer.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { BrowserKeyboard } from './io/Keyboard.js';
import { MouseJoystick } from './io/MouseJoystick.js';
import { GamepadJoystick } from './io/Gamepad.js';
import { DiskDirectory, normalizeName } from './storage/DiskDirectory.js';
import { D64Image } from './storage/D64Image.js';
import { parseP00, parsePrg } from './storage/PRGLoader.js';
import { makeContainer, readContainer } from './storage/Base64Codec.js';
import { IndexedDBStore, STORES } from './storage/IndexedDBStore.js';
import { attachDropTarget, classifyFile, downloadBytes, downloadText, pickFiles, readFileBytes } from './storage/FileManager.js';
import { tokenize } from './basic/BasicTokenizer.js';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const statusElement = $('status');
const store = new IndexedDBStore();
const settingsKey = 'c64-emulator-settings';

const settings = Object.assign({
  port: 2,
  mouse: 'position',
  keyboard: 'symbolic-de',
  numpad: false,
  crop: 'normal',
  integer: false,
  aspect: false,
  sid: '6581',
  autostart: true
}, loadSettings());

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(settingsKey) || '{}');
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    return;
  }
}

let message = '';
function setMessage(text) {
  message = text;
  updateStatus();
}

const c64 = new C64({ sidModel: settings.sid });
const renderer = new CanvasRenderer(canvas, c64.timing, {
  cropMode: settings.crop,
  integerScaling: settings.integer,
  palAspect: settings.aspect
});
const audio = new AudioEngine({ workletUrl: new URL('./audio/SIDWorklet.js', import.meta.url) });
const keyboard = new BrowserKeyboard(c64.keyboard, {
  onRestore: () => c64.pressRestore(),
  joysticks: c64.joysticks,
  clock: c64.clock,
  scheduler: c64
});
const mouse = new MouseJoystick(c64.joysticks, {
  mode: settings.mouse,
  mapPoint: (x, y) => renderer.canvasToScreen(x, y)
});
const gamepad = new GamepadJoystick(c64.joysticks);
const scheduler = new RealTimeScheduler({
  clockHz: c64.timing.clockHz,
  run: (cycles) => c64.runCycles(cycles)
});

let audioWanted = false;
let romsReady = false;
let lastPresented = -1;
let lastStatusTime = 0;
let autostartWatch = null;

function applyKeyboardSetting() {
  const [mode, layout] = settings.keyboard.split('-');
  keyboard.setMode(mode);
  keyboard.setLayout(layout || 'de');
  keyboard.joystickKeys = settings.numpad;
}

function applySettings() {
  c64.joysticks.setActivePort(Number(settings.port));
  mouse.setMode(settings.mouse);
  applyKeyboardSetting();
  renderer.setIntegerScaling(settings.integer);
  renderer.setPalAspect(settings.aspect);
  if (renderer.cropMode !== settings.crop) {
    renderer.setCropMode(settings.crop);
  }
  if (c64.sid.model !== settings.sid) {
    c64.sid.setModel(settings.sid);
  }
  $('sel-port').value = String(settings.port);
  $('sel-mouse').value = settings.mouse;
  $('sel-keyboard').value = settings.keyboard;
  $('chk-numpad').checked = settings.numpad;
  $('sel-crop').value = settings.crop;
  $('chk-integer').checked = settings.integer;
  $('chk-aspect').checked = settings.aspect;
  $('sel-sid').value = settings.sid;
  $('chk-autostart').checked = settings.autostart;
}

function updateStatus() {
  const hz = scheduler.stats.emulatedHz;
  const speed = hz ? `${Math.round((hz / c64.timing.clockHz) * 100)} %` : '–';
  const drive = c64.drive8.state !== 0 ? ' · Laufwerk aktiv' : '';
  const sound = audio.started && !audio.muted ? ` · Puffer ${Math.round((audio.buffered / audio.sampleRate) * 1000)} ms` : '';
  statusElement.textContent = `${message ? `${message} · ` : ''}${c64.timing.name} ${speed}${drive}${sound}`;
}

function refreshDiskList() {
  const select = $('disk-files');
  const files = c64.drive8.storage.listFiles();
  select.innerHTML = '';
  for (const file of files) {
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = `${file.name} (${file.type}, ${file.blocks})`;
    select.appendChild(option);
  }
  select.disabled = files.length === 0;
}

async function persistDisk() {
  const storage = c64.drive8.storage;
  try {
    if (storage instanceof D64Image) {
      await store.put(STORES.FILES, 'disk', { kind: 'd64', bytes: storage.toBytes() });
    } else {
      await store.put(STORES.FILES, 'disk', { kind: 'directory', data: storage.toJSON() });
    }
  } catch (error) {
    setMessage(`Speichern in IndexedDB fehlgeschlagen: ${error.message}`);
  }
}

function mountStorage(storage) {
  storage.onChange = () => {
    refreshDiskList();
    persistDisk();
  };
  c64.drive8.mount(storage);
  refreshDiskList();
  persistDisk();
}

async function restoreDisk() {
  try {
    const saved = await store.get(STORES.FILES, 'disk');
    if (saved && saved.kind === 'd64') {
      const image = new D64Image(new Uint8Array(saved.bytes));
      mountStorage(image);
      return;
    }
    if (saved && saved.kind === 'directory') {
      const dir = new DiskDirectory({ name: saved.data.diskName, id: saved.data.diskId });
      for (const file of saved.data.files) {
        dir.files.push({ name: file.name, type: file.type, data: Uint8Array.from(file.data) });
      }
      mountStorage(dir);
      return;
    }
  } catch (error) {
    setMessage(`IndexedDB nicht verfügbar: ${error.message}`);
  }
  mountStorage(new DiskDirectory());
}

async function installRoms(roms, persist) {
  const results = c64.loadRoms(roms);
  if (persist) {
    for (const [kind, bytes] of Object.entries(roms)) {
      if (bytes) {
        try {
          await store.put(STORES.ROMS, kind, bytes);
        } catch {
          continue;
        }
      }
    }
  }
  return results;
}

async function bootIfReady() {
  if (!c64.romsReady) {
    const missing = Object.entries(c64.memory.romsLoaded).filter(([, ok]) => !ok).map(([kind]) => `${kind}.rom`);
    setMessage(`ROM-Dateien fehlen: ${missing.join(', ')} – über „ROMs…“ laden oder in rom/ ablegen`);
    return;
  }
  romsReady = true;
  c64.powerOn();
  scheduler.start();
  setMessage('');
  canvas.focus();
}

async function loadInitialRoms() {
  const roms = {};
  for (const kind of ['basic', 'kernal', 'chargen']) {
    try {
      const stored = await store.get(STORES.ROMS, kind);
      if (stored && validateRom(kind, new Uint8Array(stored)).ok) {
        roms[kind] = new Uint8Array(stored);
        continue;
      }
    } catch {
      roms[kind] = null;
    }
    try {
      roms[kind] = await loadRomFromUrl(kind, new URL(`../rom/${kind}.rom`, import.meta.url));
    } catch {
      roms[kind] = null;
    }
  }
  const available = Object.fromEntries(Object.entries(roms).filter(([, bytes]) => bytes));
  if (Object.keys(available).length) {
    await installRoms(available, true);
  }
  await bootIfReady();
}

async function handleRomFiles(files) {
  const roms = {};
  for (const file of files) {
    const bytes = await readFileBytes(file);
    const kind = guessRomKind(file.name, bytes);
    if (!kind) {
      setMessage(`${file.name}: keine gültige ROM-Größe (${bytes.length} Bytes)`);
      continue;
    }
    roms[kind] = bytes;
  }
  const results = await installRoms(roms, true);
  const info = Object.values(results).map((r) => r.revision).join(', ');
  if (c64.romsReady) {
    scheduler.stop();
    await bootIfReady();
    setMessage(`ROMs geladen: ${info}`);
  } else {
    await bootIfReady();
  }
}

function addFileToDisk(name, data, type = 'PRG') {
  const storage = c64.drive8.storage;
  storage.writeFile(name, data, type, true);
  return normalizeName(name);
}

async function handleFiles(files) {
  let autostartName = null;
  const romFiles = [];
  for (const file of files) {
    const bytes = await readFileBytes(file);
    const kind = classifyFile(file.name, bytes);
    try {
      switch (kind) {
        case 'rom':
          romFiles.push(file);
          break;
        case 'd64': {
          mountStorage(new D64Image(bytes));
          const first = c64.drive8.storage.listFiles().find((f) => f.type === 'PRG');
          autostartName = first ? first.name : null;
          setMessage(`D64 eingelegt: ${file.name}`);
          break;
        }
        case 'container':
          for (const entry of readContainer(new TextDecoder().decode(bytes))) {
            autostartName = addFileToDisk(entry.name, entry.data, entry.type);
          }
          setMessage(`Container importiert: ${file.name}`);
          break;
        case 'basic-text':
          autostartName = addFileToDisk(file.name, tokenize(new TextDecoder().decode(bytes)));
          setMessage(`BASIC-Text tokenisiert: ${file.name}`);
          break;
        case 'p00': {
          const p00 = parseP00(bytes);
          if (!p00) throw new Error('kein gültiges P00');
          autostartName = addFileToDisk(p00.name || file.name, p00.prg);
          break;
        }
        default:
          parsePrg(bytes);
          autostartName = addFileToDisk(file.name, bytes);
          setMessage(`${file.name} auf Laufwerk 8 abgelegt`);
      }
    } catch (error) {
      setMessage(`${file.name}: ${error.message}`);
    }
  }
  if (romFiles.length) {
    await handleRomFiles(romFiles);
  }
  if (autostartName && settings.autostart && romsReady && files.length === 1) {
    autostart(autostartName);
  }
}

function autostart(name) {
  c64.keyboard.releaseAll();
  c64.typeText(`LOAD"${name}",8,1\r`);
  const start = performance.now();
  let sawActivity = false;
  autostartWatch = () => {
    if (c64.typer.busy) {
      return false;
    }
    if (c64.drive8.state !== 0) {
      sawActivity = true;
      return false;
    }
    const screen = c64.readScreenText();
    const lastLines = screen.slice(-6).join('\n');
    if (sawActivity && /READY\./.test(lastLines)) {
      if (/ERROR/.test(lastLines)) {
        setMessage('Autostart: Laden fehlgeschlagen');
      } else {
        c64.typeText('RUN\r');
      }
      return true;
    }
    return performance.now() - start > 600000;
  };
}

function exportContainer() {
  const storage = c64.drive8.storage;
  const files = storage.listFiles().map((info) => {
    const file = storage.readFile(info.name);
    return { name: file.name, type: file.type, data: file.data };
  });
  if (!files.length) {
    setMessage('Keine Dateien zum Exportieren');
    return;
  }
  downloadText('c64-dateien.json', makeContainer(files));
}

function exportD64() {
  const storage = c64.drive8.storage;
  let image = storage;
  if (!(storage instanceof D64Image)) {
    image = new D64Image();
    image.format(storage.diskName, storage.diskId);
    for (const info of storage.listFiles()) {
      const file = storage.readFile(info.name);
      image.writeFile(file.name, file.data, file.type);
    }
  }
  downloadBytes(`${(image.diskName || 'disk').trim().toLowerCase() || 'disk'}.d64`, image.toBytes());
}

function downloadSelectedPrg() {
  const name = $('disk-files').value;
  if (!name) {
    return;
  }
  const file = c64.drive8.storage.readFile(name);
  if (file) {
    downloadBytes(`${file.name.toLowerCase()}.prg`, file.data);
  }
}

async function toggleAudio() {
  if (!audio.started) {
    audioWanted = true;
    await startAudio();
    return;
  }
  audio.setMuted(!audio.muted);
  c64.setAudioSink(audio.muted || scheduler.warp ? null : (chunk) => audio.push(chunk));
  $('btn-audio').textContent = audio.muted ? 'Ton an' : 'Ton aus';
}

async function startAudio() {
  try {
    await audio.start();
    c64.sid.setSampleRate(audio.sampleRate);
    c64.setAudioSink(scheduler.warp ? null : (chunk) => audio.push(chunk));
    $('btn-audio').textContent = 'Ton aus';
  } catch (error) {
    setMessage(`Audio nicht verfügbar: ${error.message}`);
  }
}

function frame() {
  const vic = c64.vic;
  if (vic.frameCount !== lastPresented) {
    lastPresented = vic.frameCount;
    renderer.present(vic.getFrontBuffer());
  }
  gamepad.poll();
  if (audio.started) {
    c64.sid.setRateAdjust(audio.rateAdjust());
  }
  if (autostartWatch && autostartWatch()) {
    autostartWatch = null;
  }
  const now = performance.now();
  if (now - lastStatusTime > 500) {
    lastStatusTime = now;
    updateStatus();
  }
  requestAnimationFrame(frame);
}

function bindUi() {
  $('btn-roms').addEventListener('click', async () => handleRomFiles(await pickFiles({ accept: '.rom,.bin' })));
  $('btn-load').addEventListener('click', async () => handleFiles(await pickFiles({ accept: '.prg,.d64,.p00,.bas,.txt,.json,.b64,.rom,.bin' })));
  $('btn-download-prg').addEventListener('click', downloadSelectedPrg);
  $('btn-export').addEventListener('click', exportContainer);
  $('btn-export-d64').addEventListener('click', exportD64);
  $('btn-new-disk').addEventListener('click', () => mountStorage(new DiskDirectory()));
  $('btn-reset').addEventListener('click', () => {
    c64.reset();
    canvas.focus();
  });
  $('btn-power').addEventListener('click', () => {
    c64.powerOn();
    canvas.focus();
  });
  $('btn-restore').addEventListener('click', () => {
    c64.pressRestore();
    canvas.focus();
  });
  $('btn-audio').addEventListener('click', toggleAudio);
  $('chk-warp').addEventListener('change', (event) => {
    scheduler.setWarp(event.target.checked);
    if (audio.started) {
      audio.flush();
      c64.setAudioSink(event.target.checked || audio.muted ? null : (chunk) => audio.push(chunk));
    }
    canvas.focus();
  });
  const bind = (id, key, transform = (v) => v) => {
    $(id).addEventListener('change', (event) => {
      const target = event.target;
      settings[key] = transform(target.type === 'checkbox' ? target.checked : target.value);
      saveSettings();
      applySettings();
      canvas.focus();
    });
  };
  bind('sel-port', 'port', Number);
  bind('sel-mouse', 'mouse');
  bind('sel-keyboard', 'keyboard');
  bind('chk-numpad', 'numpad');
  bind('sel-crop', 'crop');
  bind('chk-integer', 'integer');
  bind('chk-aspect', 'aspect');
  bind('sel-sid', 'sid');
  bind('chk-autostart', 'autostart');
  canvas.addEventListener('mousedown', () => canvas.focus());
  const unlockAudio = () => {
    if (audioWanted && !audio.started) {
      startAudio();
    }
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  attachDropTarget(document.body, (files) => handleFiles(files));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      keyboard.releaseAll();
    }
  });
}

async function main() {
  keyboard.attach(canvas);
  mouse.attach(canvas);
  bindUi();
  applySettings();
  await restoreDisk();
  requestAnimationFrame(frame);
  await loadInitialRoms();
  window.c64 = c64;
  window.monitor = (command) => {
    const output = c64.debugger.command(command);
    console.log(output);
    return output;
  };
  window.emulator = { c64, renderer, audio, scheduler, keyboard, mouse };
}

main().catch((error) => setMessage(`Startfehler: ${error.message}`));
