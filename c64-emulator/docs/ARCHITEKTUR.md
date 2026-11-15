# Architekturdefinition: Hardwareorientierter C64-Emulator für Firefox

Version 1.0 – verbindliche Grundlage für alle Implementierungsschritte.

Dieses Dokument beschreibt Module, Schnittstellen, Taktmodell, Speicher- und Interruptmodell,
Datenfluss, Implementierungsreihenfolge und Testplan. Der Quellcode selbst enthält gemäß
Projektvorgabe keine Kommentare; sämtliche Erläuterungen stehen in diesem Dokument, in
`README.md` und in `docs/STATUS.md`.

---

## 1. Leitprinzipien

1. **Ein Takt, ein Buszugriff.** Die kleinste Zeiteinheit ist ein Systemtakt (φ2-Zyklus,
   PAL 985 248 Hz). Jeder Takt besteht aus einer φ1-Hälfte (VIC-II) und einer φ2-Hälfte
   (CPU oder VIC-II). Jeder Buszugriff ist genau einem Takt und einer Takthälfte zugeordnet.
2. **Hardware spricht nur über Hardware-Schnittstellen.** Komponenten kommunizieren über
   Registerzugriffe (Memory-Bus), Signalleitungen (IRQ, NMI, RESET, RDY/BA, AEC, IEC-Leitungen,
   Portpins) und den gemeinsamen Takt. Es gibt keine Abkürzungen über BASIC- oder
   KERNAL-Interna im regulären Laufzeitpfad.
3. **Deterministisch.** Bei gleichem Anfangszustand und gleichen Eingaben (mit Taktstempel)
   entsteht exakt derselbe Zustand. Browserzeit beeinflusst nur, *wann* emuliert wird, nie
   *was*.
4. **Kern ohne Browserabhängigkeit.** Alles unter `js/core`, `js/video` (außer
   `CanvasRenderer`), `js/audio` (außer `AudioEngine`, `SIDWorklet`), `js/io` (Chiplogik,
   Matrix, IEC), `js/basic`, `js/storage` (außer `FileManager`, `IndexedDBStore`) und
   `js/utils` ist in Node.js ohne DOM lauffähig und damit automatisiert testbar.
5. **Keine stillen Näherungen.** Jede bekannte Abweichung von der Hardware wird in
   `docs/STATUS.md` mit Status „näherungsweise“ oder „nicht implementiert“ geführt.

---

## 2. Modulverzeichnis

```
c64-emulator/
├── index.html                    Minimale Anwendungsstruktur, genau ein Canvas
├── css/style.css                 Layout, Canvas-Skalierung, Toolbar-Positionierung
├── docs/
│   ├── ARCHITEKTUR.md            Dieses Dokument
│   └── STATUS.md                 Implementierungs- und Verifikationsstand je Funktion
├── rom/README.md                 Bereitstellung von basic.rom, kernal.rom, chargen.rom
├── README.md                     Start, Bedienung, Tests
└── js/
    ├── main.js                   Browser-Integration: UI, Scheduler, Präsentation
    ├── core/
    │   ├── C64.js                Systemaufbau, Taktschleife, Signalverdrahtung
    │   ├── CPU6510.js            MOS 6502-Kern (mikrozyklisch) + 6510-Variante
    │   ├── OpcodeTable.js        Opcode-Metadaten (CPU, Disassembler, Assembler)
    │   ├── ProcessorPort.js      6510-Port $0000/$0001 inkl. Floating-Bit-Verhalten
    │   ├── Memory.js             RAM, Color-RAM, ROM-Speicher, Einschaltmuster
    │   ├── MemoryBus.js          PLA-Banking, CPU- und VIC-Sicht, I/O-Dekodierung, Open Bus
    │   ├── Clock.js              Emulierte Zeitbasis, Echtzeit-Scheduler (Pacing)
    │   ├── InterruptController.js Wired-OR-Verknüpfung der IRQ-/NMI-Quellen
    │   └── ROMManager.js         ROM-Validierung (Größe, CRC32), Laden aus Datei/URL/DB
    ├── video/
    │   ├── VideoTiming.js        PAL-6569- / NTSC-6567-Parameter und Zyklustabellen
    │   ├── VICII.js              VIC-II-Kern: Raster, Zugriffe, BA/AEC, Rahmen, Ausgabe
    │   ├── SpriteEngine.js       Sprite-DMA, Zähler, Sequenzer, Kollisionen
    │   ├── CharacterGenerator.js Grafiksequenzer: Dekodierung aller 8 Modus-Kombinationen
    │   ├── Palette.js            16-Farben-Palette (RGBA)
    │   └── CanvasRenderer.js     Präsentation des Framebuffers im Canvas
    ├── audio/
    │   ├── SID6581.js            SID-Chip: Register, Takt-Synchronisation, Mischung, Resampling
    │   ├── SIDVoice.js           Oszillator, Wellenformen, Sync, Ringmodulation, Rauschen
    │   ├── SIDEnvelope.js        ADSR-Hüllkurve mit Ratenzähler und Exponentialzähler
    │   ├── SIDFilter.js          Zustandsvariablenfilter (LP/BP/HP, Resonanz), Modellkurven
    │   ├── AudioEngine.js        AudioContext, AudioWorklet-Anbindung, Ratenregelung
    │   └── SIDWorklet.js         AudioWorkletProcessor: Ringpuffer-Wiedergabe
    ├── io/
    │   ├── CIA6526.js            CIA 6526/6526A: Ports, Timer, TOD, SDR, ICR, FLAG
    │   ├── Keyboard.js           8×8-Tastaturmatrix (elektrisch), Browser-Tastaturadapter
    │   ├── KeyboardLayouts.js    Positions- und Zeichen-Zuordnungen (DE, US, symbolisch)
    │   ├── Joystick.js           Zwei digitale Joystickports, Portumschaltung
    │   ├── MouseJoystick.js      Maus als digitaler Joystick (relativ / positionsbasiert)
    │   ├── Gamepad.js            Gamepad-API als Joystickquelle (optional)
    │   └── IECBus.js             Open-Collector-Leitungen ATN, CLK, DATA, RESET
    ├── basic/
    │   ├── BASICV2.js            Tokentabelle, Detokenizer, Programmzeiger-Hilfen
    │   └── BasicTokenizer.js     Text → tokenisiertes PRG, ASCII ↔ PETSCII
    ├── storage/
    │   ├── FileManager.js        Datei-Import/Export (File API, Blob, Download)
    │   ├── PRGLoader.js          PRG-Format, Ladeadresse, Debug-Injektion
    │   ├── Base64Codec.js        Base64-Kodierung, JSON-Container für Binärdaten
    │   ├── DiskDirectory.js      Virtuelle Diskette aus Einzeldateien
    │   ├── D64Image.js           D64-Abbild: BAM, Verzeichnis, Dateiketten
    │   ├── VirtualDrive1541.js   Gerät 8 auf IEC-Leitungsebene (ohne Laufwerks-CPU)
    │   └── IndexedDBStore.js     Persistenz von ROMs und Dateien
    ├── utils/
    │   ├── Constants.js          Adressen, Registernummern, Modellkonstanten
    │   ├── BitOperations.js      BCD, CRC32, Bit-Hilfen (außerhalb der Hotpaths)
    │   ├── Assembler.js          Kleiner 6502-Assembler (Tests, Monitor)
    │   └── Debugger.js           Disassembler, Monitor, Haltepunkte, Trace
    └── tests/                    node:test-Testdateien je Modul + Integration
```

Abweichungen vom Vorschlag des Projektauftrags und Begründung:

| Ergänzung | Begründung |
|---|---|
| `core/OpcodeTable.js` | Eine einzige Quelle für Opcode-Semantik; CPU, Disassembler und Assembler können nicht auseinanderlaufen. |
| `core/ProcessorPort.js` | Der Port ist Teil des 6510, beeinflusst aber das PLA-Banking; eigene Einheit mit eigener Testbarkeit. Der 6502-Kern bleibt für eine spätere 1541-CPU wiederverwendbar. |
| `audio/SIDFilter.js` | Der Filter ist die numerisch aufwendigste SID-Komponente und wird getrennt getestet. |
| `video/Palette.js` | Farbdefinition getrennt vom Renderer, auch für Tests nutzbar. |
| `io/KeyboardLayouts.js` | Layouttabellen getrennt von der Matrixlogik. |
| `storage/DiskDirectory.js`, `storage/IndexedDBStore.js` | Virtuelle Diskette aus Einzeldateien bzw. Persistenz, getrennt vom IEC-Protokoll. |
| `utils/Assembler.js` | Reproduzierbare Testprogramme ohne handkodierte Hexfolgen. |
| `docs/STATUS.md` | Pflicht-Unterscheidung „implementiert / lokal getestet / extern bestätigt / näherungsweise / fehlt“. |

---

## 3. Verantwortlichkeiten und öffentliche Schnittstellen

Notation: `methode(param) → Rückgabe`. Alle Zahlen sind Ganzzahlen; 8-Bit-Werte liegen im
Bereich 0–255, Adressen 0–65535. Felder ohne Methode sind lesbar, nur wo angegeben auch
schreibbar.

### 3.1 core/C64.js – `class C64`

Verantwortung: Instanziierung und Verdrahtung aller Chips, gemeinsame Taktschleife,
Reset-/Einschaltlogik, Signalführung (IRQ, NMI, RDY/BA, IEC, Portpins, TOD-Takt).

```
constructor({ timing = PAL, sidModel = '6581', ciaModel = '6526', sampleRate = 48000 })
loadRoms({ basic, kernal, chargen })          Uint8Array je ROM, validiert durch ROMManager
powerOn()                                     Kaltstart: RAM-Muster, alle Chips Reset, CPU-Reset
reset()                                       Warmstart: RESET-Leitung, RAM bleibt erhalten
cycle()                                       genau ein Systemtakt
runCycles(n) → ausgeführte Takte              bricht bei Haltepunkt ab
schedule(delay, fn) / cancel(event)           taktgenaue Ereignisplanung (RESTORE-Monoflop,
                                              IEC-Gerät, Tastatur-Haltezeiten)
typeText(text), readScreenText()              Matrix-Tipp-Automat bzw. Bildschirmauszug (Tests)
runFrame() → ausgeführte Takte                bis zum nächsten Rahmenende des VIC-II
pressRestore() / releaseRestore()             RESTORE über monostabile Stufe auf NMI
setAudioSink(fn(Float32Array))                Ziel für erzeugte Audioblöcke
flushAudio()                                  SID bis zum aktuellen Takt nachführen
Felder: clock, cpu, memory, bus, port, interrupts, vic, sid, cia1, cia2,
        keyboard, typer, joysticks, iec, drive8, debugger
```

### 3.2 core/CPU6510.js – `class CPU6502`, `class CPU6510`

Verantwortung: mikrozyklische Ausführung aller 256 Opcodes, Interruptsequenzen, RDY.

```
CPU6502
  constructor(bus)                 bus: { read(addr) → byte, write(addr, byte) }
  reset()                          setzt RESET-Sequenz in Gang (7 Takte, Vektor $FFFC)
  cycle()                          ein Takt; bei rdy=false und Lesezyklus: Stall
  isWriteCycle() → bool            ob der anstehende Takt ein Schreibzyklus ist
  getP() / setP(v)                 Statusregister
  Felder: a, x, y, s, pc, ir, t (Zyklus im Befehl), rdy (Eingang),
          irqLine, nmiLine (Eingänge, true = aktiv), jammed, stalled,
          instructionStart (true im Opcode-Fetch-Takt), totalCycles
CPU6510 extends CPU6502
  constructor(bus, processorPort)  Zugriffe auf $0000/$0001 gehen an den Port
```

### 3.3 core/OpcodeTable.js

```
OPCODES[256] → { mnemonic, mode, kind, bytes }   kind: read|write|rmw|impl|branch|special|jam
MODES                                             Adressierungsart-Konstanten
modeOperandBytes(mode) → 0..2
```

### 3.4 core/ProcessorPort.js – `class ProcessorPort`

```
reset()
read(addr) → byte                 addr 0: DDR, addr 1: Datenregister mit Pin-Rückkopplung
write(addr, value, cycle)
outputs() → { loram, hiram, charen, cassetteWrite, motor }
setCassetteSense(pressed)
onChange = fn(loram, hiram, charen)
```

Verhalten: Ausgänge = Daten & DDR; Eingänge mit Pull-ups (Bits 0–2 lesen bei DDR=0 „1“),
Bit 4 Kassettentaste (1 = nicht gedrückt), Bit 5 Motor; Bits 6/7 und als Eingang
geschaltete Bits 3 halten den zuletzt ausgegebenen Wert für eine modellierte
Entladezeit (Floating-Bit-Verhalten).

### 3.5 core/Memory.js – `class Memory`

```
ram: Uint8Array(65536), colorRam: Uint8Array(1024) (nur Bits 0–3 signifikant)
basicRom: Uint8Array(8192), kernalRom: Uint8Array(8192), charRom: Uint8Array(4096)
fillPowerOnPattern()              64-Byte-Blöcke $00/$FF wie typische DRAM-Einschaltwerte
```

### 3.6 core/MemoryBus.js – `class MemoryBus`

Verantwortung: PLA-Logik (LORAM, HIRAM, CHAREN, GAME, EXROM), CPU-Lese-/Schreibsicht,
VIC-Sicht (16-KB-Bank, Zeichen-ROM-Einblendung), I/O-Dekodierung $D000–$DFFF, Open Bus.

```
constructor(memory)
connect({ vic, sid, cia1, cia2, io1, io2 })
setCpuLines(loram, hiram, charen)   vom ProcessorPort
setCartridgeLines(game, exrom)      Vorbereitung Module (Standard: beide high)
setVicBank(bank)                    0..3 von CIA 2 (invertierte PA0/PA1)
read(addr) → byte                   CPU-Sicht, mit Seiteneffekten
write(addr, value)                  CPU-Sicht; ROM-Bereiche schreiben in RAM
vicRead(addr14) → byte              VIC-Sicht; aktualisiert phi1Data
peek(addr) → byte                   seiteneffektfrei (Debugger)
phi1Data                            letzter VIC-Datenbuswert (Open Bus)
mapName(addr) → string              aktuelle Zuordnung (Debugger)
```

I/O-Dekodierung: $D000–$D3FF VIC (Spiegel alle 64 Bytes), $D400–$D7FF SID (Spiegel alle 32),
$D800–$DBFF Color-RAM (obere 4 Bit = Open Bus), $DC00–$DCFF CIA 1 (Spiegel alle 16),
$DD00–$DDFF CIA 2, $DE00–$DEFF I/O 1, $DF00–$DFFF I/O 2 (ohne Modul Open Bus).

### 3.7 core/Clock.js – `class Clock`, `class RealTimeScheduler`

```
Clock
  constructor(timing)              timing.clockHz, cyclesPerLine, linesPerFrame
  cycles                           seit Einschalten vergangene Systemtakte
  cyclesToSeconds(c), secondsToCycles(s)
RealTimeScheduler
  constructor({ clockHz, run(cycles) → ausgeführt, now = performance.now,
                setTimer = setTimeout, maxSliceMs = 40 })
  start() / stop() / setWarp(bool) / setSpeed(factor)
  stats → { emulatedHz, behindMs, droppedMs }
```

Der Scheduler berechnet aus der vergangenen Wanduhrzeit die fälligen Takte, lässt sie in
Scheiben emulieren und verwirft Rückstände über `maxSliceMs` (die Emulation verlangsamt sich
dann sichtbar, statt in eine Aufholspirale zu geraten). `requestAnimationFrame` wird nur zur
Präsentation genutzt.

### 3.8 core/InterruptController.js – `class InterruptController`

```
constructor(cpu)
setIrq(sourceMask, active)        Quellen: VIC=1, CIA1=2, EXP=4
setNmi(sourceMask, active)        Quellen: CIA2=1, RESTORE=2, EXP=4
irqSources, nmiSources            Bitmasken der aktiven Quellen
```

IRQ und NMI sind Open-Collector-Leitungen: Leitung aktiv, solange mindestens eine Quelle
zieht. Die Pegel werden direkt in `cpu.irqLine` / `cpu.nmiLine` gespiegelt; die
Flankenerkennung für NMI liegt in der CPU.

### 3.9 core/ROMManager.js

```
ROM_SPECS = { basic: 8192, kernal: 8192, chargen: 4096 }
KNOWN_ROMS                        CRC32-Liste bekannter Originalrevisionen
validateRom(kind, bytes) → { ok, size, crc32, known, revision, message }
loadRomFromUrl(kind, url) → Promise<Uint8Array>
loadRomFromFile(kind, file) → Promise<Uint8Array>
```

### 3.10 video/VideoTiming.js

```
PAL  = { name, chip:'6569', clockHz:985248, cyclesPerLine:63, linesPerFrame:312,
         firstXCoord:0x194, firstVisibleLine:16, lastVisibleLine:299, ... }
NTSC = { chip:'6567R8', clockHz:1022727, cyclesPerLine:65, linesPerFrame:263, ... }
buildCycleTable(timing) → Tabellen je Zyklus: φ1-Aktion, φ2-Aktion, Sprite-BA-Maske, X-Koordinate
cropRect(timing, mode) → { x, y, width, height } im Framebuffer
```

### 3.11 video/VICII.js – `class VICII`

```
constructor(bus, interrupts, memory, timing)
reset()
cycle()                           ein Takt: φ1-Zugriff, BA/AEC, φ2-Zugriff, 8 Pixel
read(reg) → byte / write(reg, v) / peek(reg)
setLightPen(level)
Felder: ba (true = Bus frei für CPU), aec, raster, cycleInLine,
        frameBuffer (Uint8Array, Farbindex je Pixel), frameCount,
        width, height (gesamter Rasterbereich)
onFrame = fn(frontBuffer)
```

### 3.12 video/SpriteEngine.js – `class SpriteEngine`

```
checkDma(raster, regs)            Zyklen 55/56
startDisplay(raster, regs)        Zyklus 58: MC ← MCBASE, Display-Flag
updateMcBase()                    Zyklus 16 (bzw. 15/16-Logik inkl. Sprite-Crunch)
fetchPointer(i), fetchData(i, n)  p-/s-Zugriffe
renderPixel(i, x) …               Ausgabe in Pixelpuffer des laufenden Zyklus
spriteSprite, spriteData          Kollisionsregister
```

### 3.13 video/CharacterGenerator.js

```
decodeCell(mode, gdata, cdata, out, offset)   schreibt 8 Pixelcodes in den Zeilenpuffer
Pixelcode: Bit 7 = Vordergrund (für Priorität/Kollision), Bits 0–4: 0–15 Direktfarbe,
           16–19 Hintergrundregister $D021–$D024 (Auflösung erst bei Ausgabe)
```

### 3.14 video/CanvasRenderer.js – `class CanvasRenderer`

```
constructor(canvas, timing)
setCropMode('normal' | 'full')
setIntegerScaling(bool), setPalAspect(bool)
resize()                          liest CSS-Größe und devicePixelRatio
present(frameBuffer)              Palettenumsetzung → ImageData → drawImage ohne Glättung
```

### 3.15 audio/SID6581.js, SIDVoice.js, SIDEnvelope.js, SIDFilter.js

```
SID
  constructor({ clock, clockHz, model:'6581'|'8580', sampleRate })
  reset()
  read(reg) → byte                $D419–$D41C lesbar, sonst Datenbus-Rest mit Abklingen
  write(reg, v)                   vor jedem Zugriff: catchUp(clock.cycles)
  catchUp(cycle)                  taktgenaues Nachführen bis zum Zielzeitpunkt
  setModel(m), setSampleRate(r), setRateAdjust(f), setSink(fn)
SIDVoice    clockOscillator(), synchronize(), output() → 12 Bit, control/frequency/pulse
SIDEnvelope clock(), writeControl(gate), level
SIDFilter   setCutoff(fc11), setResonance(res), setMode(bits), process(in) → out
```

### 3.16 audio/AudioEngine.js, SIDWorklet.js

```
AudioEngine
  constructor({ workletUrl })
  async start()                   nach Benutzerinteraktion (Autoplay-Regeln in Firefox)
  push(Float32Array)              Übertragung an den Worklet (Transfer)
  sampleRate, bufferedSamples, underruns
  rateAdjust()                    Regelfaktor für das SID-Resampling (±0,5 %)
SIDWorklet (AudioWorkletProcessor 'c64-sid-output')
  Ringpuffer, meldet Füllstand und Unterläufe per MessagePort
```

### 3.17 io/CIA6526.js – `class CIA6526`

```
constructor({ name, model:'6526'|'6526A', onInterrupt(level) })
reset()
cycle()                           ein φ2-Takt (Timer-Pipeline, Interruptverzögerung)
read(reg) → byte / write(reg, v) / peek(reg)
todTick()                         50/60-Hz-Eingang
setFlag(level)                    negative Flanke setzt ICR-Bit 4
setCnt(level), setSp(level)       serieller Port / Zählereingang
portAIn, portBIn                  Funktionen (driven) → Pinpegel (externe Beschaltung)
portAOut, portBOut                Rückruf bei geänderten Ausgangspins
getPortAPins(), getPortBPins()    PR | ~DDR (CIA-seitig getriebene Pegel)
```

### 3.18 io/Keyboard.js, KeyboardLayouts.js

```
KeyboardMatrix
  press(col, row) / release(col, row) / pressKey(name) / releaseKey(name) / releaseAll()
  setShiftOverride(null | true | false)
  resolve(paDriven, pbDriven, extA, extB) → { pa, pb }   Wired-AND über gedrückte Kontakte
BrowserKeyboard
  constructor(matrix, { layout:'de'|'us', mode:'symbolic'|'positional', onRestore,
                        clock, scheduler, minHoldCycles, minGapCycles })
  attach(target) / detach()
  Kurze Browser-Anschläge werden in emulierter Zeit auf eine Mindesthaltezeit (≈ 40 ms)
  und Mindestpause verlängert, damit die KERNAL-Abfrage (60 Hz) jeden Anschlag sieht.
KeyboardTyper                     tippt Text über die Matrix (Autostart, Tests)
```

### 3.19 io/Joystick.js, MouseJoystick.js, Gamepad.js

```
JoystickPort      set(direction, pressed), bits() → aktive-low 5 Bit (Bit0 hoch … Bit4 Feuer)
Joysticks         ports[0..1], activePort, setActivePort(1|2), onChange
MouseJoystick     attach(canvas), mode 'relative' (Pointer Lock) | 'position', deadZone
GamepadJoystick   poll() → setzt Richtungen am aktiven Port
```

### 3.20 io/IECBus.js – `class IECBus`

```
attach(device)                    device: { onBusChange(bus) }
setControllerOutputs(atn, clk, data)   true = Leitung aktiv (low) – C64-Seite nach Inverter
setDeviceOutputs(id, clk, data)
atn, clk, data                    resultierende Pegel, true = Leitung released (high)
```

### 3.21 storage/VirtualDrive1541.js – `class VirtualDrive1541`

Verantwortung: Gerät 8 als IEC-Teilnehmer auf Leitungsebene. Es antwortet auf ATN,
empfängt Kommandobytes (LISTEN, TALK, SECOND, OPEN, CLOSE, UNLISTEN, UNTALK) und Daten
bitweise im Takt der Leitungen, sendet Daten mit EOI-Signalisierung. Kanäle 0 (Laden),
1 (Speichern), 2–14 (Dateien), 15 (Kommando/Fehlerkanal). Das Gerät kennt keine
BASIC-Befehle; der C64 kommuniziert ausschließlich über die KERNAL-Routinen und CIA 2.

```
constructor({ bus, clock, deviceNumber = 8, storage })
cycle()                           Ereignisverarbeitung (Leitungen, Zeitgeber)
mount(storage)                    DiskDirectory oder D64Image
status                            aktueller Fehlerkanaltext
```

### 3.22 storage/*.js (übrige)

```
PRGLoader     parsePrg(bytes) → { loadAddress, data }; makePrg(addr, data); injectPrg(memory, bytes)
Base64Codec   encode(Uint8Array) → string; decode(string) → Uint8Array; makeContainer/readContainer
DiskDirectory listFiles(), readFile(name), writeFile(name, data, type), deleteFile, renameFile
D64Image      fromBytes(bytes); listFiles(); readFile(); writeFile(); format(); toBytes()
FileManager   pickFiles(accept) → Promise<File[]>, downloadBytes(name, bytes), downloadText
IndexedDBStore put(store, key, value), get(store, key), list(store), delete(store, key)
```

### 3.23 basic/*.js

```
BASICV2         TOKENS, detokenize(prgBytes) → Text, readProgram(memory) → PRG-Bytes
BasicTokenizer  tokenize(text, { loadAddress = 0x0801 }) → Uint8Array (PRG)
                asciiToPetscii(ch), petsciiToAscii(code)
```

### 3.24 utils/*.js

```
Constants      Registeradressen, IRQ/NMI-Quellbits, Gerätenummern
BitOperations  toBcd, fromBcd, crc32(bytes), hex2/hex4
Assembler      assemble(source, origin) → { bytes, labels, origin }
Debugger       disassemble(peek, addr) → { text, length }; Monitor-Befehle;
               Haltepunkte (PC), Einzelschritt (Takt/Befehl), Trace-Ring
```

---

## 4. Gemeinsames Taktmodell

### 4.1 Grundtakt

| Größe | PAL (6569) | NTSC (6567R8) |
|---|---|---|
| Quarz | 17,734475 MHz | 14,31818 MHz |
| Systemtakt φ2 | 985 248 Hz (Quarz/18) | 1 022 727 Hz (Quarz/14) |
| Takte je Rasterzeile | 63 | 65 |
| Rasterzeilen | 312 | 263 |
| Takte je Bild | 19 656 | 17 095 |
| Bildrate | ≈ 50,125 Hz | ≈ 59,826 Hz |

Alle modellabhängigen Werte kommen ausschließlich aus `VideoTiming.js`. Kein anderes Modul
enthält PAL-Konstanten.

### 4.2 Ablauf eines Systemtakts (`C64.cycle()`)

```
            φ1 (erste Takthälfte)                φ2 (zweite Takthälfte)
          ┌───────────────────────────┐      ┌──────────────────────────────────┐
 Takt n:  │ VIC-II: p/s/r/g/i-Zugriff │      │ AEC low:  VIC c-/s-Zugriff        │
          │ BA berechnen              │      │ AEC high: CPU-Zugriff (wenn RDY  │
          │ 8 Pixel erzeugen          │      │           oder Schreibzyklus)    │
          └───────────────────────────┘      └──────────────────────────────────┘
          danach: CIA1.cycle(), CIA2.cycle(), TOD-Teiler, IEC-Ereignisse, clock.cycles++
          SID: wird bei jedem Registerzugriff und am Scheibenende taktgenau nachgeführt
```

Reihenfolge im Code:

1. `vic.cycle()` – führt die φ1-Aktion des aktuellen Rasterzyklus aus, bestimmt BA
   (Badline-Zyklen 12–54, Sprite-Fenster), führt ggf. die φ2-Aktion aus (c-Zugriffe
   15–54, s-Zugriffe), erzeugt 8 Pixel, prüft Raster-IRQ. Setzt `cpu.rdy = ba`.
2. `cpu.cycle()` – Ist `rdy` false und der anstehende Takt ein Lesezyklus, verharrt die CPU
   (Zustand unverändert, `stalled = true`). Schreibzyklen laufen bei RDY low weiter; da BA
   drei Takte vor AEC fällt und ein 6502 höchstens drei Schreibzyklen in Folge ausführt, ist
   die CPU spätestens beim ersten AEC-low-Takt angehalten.
3. `cia1.cycle()`, `cia2.cycle()` – Timer-Pipeline. Die CIA-Taktung nach dem CPU-Zugriff
   entspricht der φ1-Flanke des Folgetakts im Pipeline-Modell (Startverzögerung, Lade- und
   One-Shot-Verzögerung, IRQ-Verzögerung des alten 6526 um einen Takt).
4. TOD-Teiler (Netzfrequenz 50 Hz bei PAL), IEC-Gerät, Zähler `clock.cycles++`.

Der SID wird „lazy“, aber taktgenau betrieben: Vor jedem Registerzugriff ruft er
`catchUp(clock.cycles)` auf und taktet seine Oszillatoren und Hüllkurven Takt für Takt bis
zum Zugriffszeitpunkt. Dadurch ist das Ergebnis identisch mit einer Takt-für-Takt-Ausführung,
spart aber Funktionsaufrufe. Am Ende jeder Emulationsscheibe wird ebenfalls nachgeführt.

### 4.3 RDY, BA, AEC

* `BA` (VIC → CPU-RDY): low in Badlines von Zyklus 12 bis 54 und für Sprite *n* in den
  Zyklen *cₙ−3* … *cₙ+1* (PAL: c₀=58, c₁=60, c₂=62, c₃=1, c₄=3, c₅=5, c₆=7, c₇=9), sofern die
  DMA des Sprites aktiv ist.
* `AEC`: low in der φ2-Hälfte, wenn der VIC zugreift (c-/s-Zugriff) und BA bereits ≥ 3 Takte
  low war. War BA kürzer low (z. B. bei per `$D011` erzeugter Badline mitten in der Zeile),
  liest der VIC statt des Speichers `$FF` (Näherung des Open-Bus-Zustands, CPU treibt noch).
* Die CPU erhält `rdy = BA`. RDY wirkt nur auf Lesezyklen.
* Für die instabilen Opcodes SHA/SHX/SHY/TAS wird vermerkt, ob die CPU im Takt vor dem
  Schreibzugriff angehalten war (Wegfall des „& (H+1)“ wie auf realer Hardware).

### 4.4 Interrupt-Abtastung in der CPU

* Am Ende jedes ausgeführten oder angehaltenen Takts werden IRQ (pegelgesteuert, maskiert
  durch I) und NMI (Flankenspeicher) abgetastet: `prev ← run; run ← irqLine && !I`.
* Am Ende des letzten Befehlstakts entscheidet `prev` (Zustand am Ende des vorletzten Takts),
  ob statt des nächsten Opcodes eine Interruptsequenz folgt. Daraus ergeben sich die
  bekannten Effekte: CLI/SEI/PLP wirken um einen Befehl verzögert, RTI sofort; ein IRQ
  muss mindestens zwei Takte vor dem Opcode-Fetch anliegen.
* Genommener Branch ohne Seitenwechsel: im letzten Takt neu aufgetretene Interrupts werden
  um einen Befehl verzögert.
* NMI-Hijacking: Liegt während der ersten Takte einer BRK/IRQ-Sequenz eine NMI-Flanke vor,
  wird der NMI-Vektor verwendet.
* Nach einer Hardware-Interruptsequenz wird mindestens ein Befehl der Behandlungsroutine
  ausgeführt.

### 4.5 Echtzeitbezug und Synchronität von Bild und Ton

```
  Wanduhr (performance.now) ──► RealTimeScheduler ──► C64.runCycles(n)
                                                         │
                         ┌───────────────────────────────┼─────────────────────┐
                         ▼                               ▼                     ▼
                  VIC-Framebuffer (doppelt)      SID-Samples (Resampling)   Zustände
                         │                               │
          requestAnimationFrame                 AudioEngine.push ──► SIDWorklet (Ringpuffer)
          präsentiert letztes fertiges Bild             ▲                     │
                                                         └── Füllstand ◄──────┘
                                                             Ratenregelung ±0,5 %
```

* Die emulierte Zeit folgt der Wanduhr. Bild und Ton entstehen aus derselben Taktbasis und
  sind dadurch inhärent synchron.
* Der SID resampelt von 985 248 Hz auf die Ausgaberate (Kastenfilter-Mittelung je
  Ausgabesample + Filter auf Ausgaberate). Das Verhältnis wird anhand des vom Worklet
  gemeldeten Füllstands um höchstens ±0,5 % geregelt, damit Drift zwischen Wanduhr und
  Audiouhr keinen Über- oder Unterlauf erzeugt (keine hörbare Tonhöhenänderung).
* Verspätete oder ausgelassene `requestAnimationFrame`-Aufrufe ändern nichts an der
  Emulation; es wird lediglich ein Bild nicht gezeigt.
* Warp-Modus: Scheduler emuliert so schnell wie möglich; Audio wird währenddessen verworfen.
* Threading: Der Emulationskern läuft bewusst im Hauptthread. Er erreicht in Messungen
  ein Vielfaches der Echtzeit, der Audiopuffer (≈ 80 ms) überbrückt Präsentationsschwankungen,
  und Registerlesezugriffe auf den SID (OSC3/ENV3) bleiben ohne Thread-Synchronisation
  exakt. Da der Kern keine DOM-Abhängigkeiten hat, kann er später in einen Web Worker
  verlagert werden (Framebuffer per Transfer, Eingaben per Nachricht, Audio direkt per
  MessagePort an den Worklet).

---

## 5. Speichermodell

### 5.1 CPU-Sicht (PLA)

Zuordnung je 4-KB-Seite in Abhängigkeit von (EXROM, GAME, CHAREN, HIRAM, LORAM):

| Bereich | Bedingung | Quelle |
|---|---|---|
| $0000–$0FFF | immer | RAM ($0000/$0001: Prozessorport in der CPU) |
| $1000–$7FFF | Ultimax | offen, sonst RAM |
| $8000–$9FFF | LORAM ∧ HIRAM ∧ ¬EXROM oder Ultimax | ROML, sonst RAM |
| $A000–$BFFF | LORAM ∧ HIRAM ∧ GAME | BASIC |
|  | HIRAM ∧ ¬GAME ∧ ¬EXROM | ROMH |
|  | Ultimax | offen, sonst RAM |
| $C000–$CFFF | Ultimax | offen, sonst RAM |
| $D000–$DFFF | Ultimax | I/O |
|  | GAME: (LORAM ∨ HIRAM) | CHAREN ? I/O : CHAR-ROM |
|  | 16K-Modul: (LORAM ∨ HIRAM) | CHAREN ? I/O : (HIRAM ? CHAR-ROM : RAM) |
|  | sonst | RAM |
| $E000–$FFFF | Ultimax | ROMH |
|  | HIRAM | KERNAL, sonst RAM |

Schreibzugriffe auf ROM-Bereiche landen im darunterliegenden RAM. Die Zuordnung wird als
Tabelle von 16 Seitentypen vorberechnet und nur bei Änderung von Port- oder Modulleitungen
neu aufgebaut.

### 5.2 Prozessorport

Schreibzugriffe auf $0000/$0001 erreichen zusätzlich das RAM an diesen Adressen, und zwar
mit dem Wert des letzten VIC-Datenbuszyklus (wie auf realer Hardware). Die VIC-Sicht liest
dort das RAM.

### 5.3 VIC-Sicht

* 14 Adressleitungen + Bankauswahl über CIA 2 PA0/PA1 (invertiert): Bank = 3 − (PA & 3).
* Zeichen-ROM erscheint in den Banken 0 und 2 bei $1000–$1FFF.
* Parallel zu jedem c-Zugriff liest der VIC 4 Bit aus dem Color-RAM (12-Bit-Bus).
* Jeder VIC-Zugriff aktualisiert `phi1Data` (Open-Bus-Wert für CPU-Lesezugriffe auf
  unbelegte Adressen, obere Color-RAM-Bits und Schreibzugriffe auf $0000/$0001).

### 5.4 Register mit Seiteneffekten

| Register | Seiteneffekt |
|---|---|
| VIC $D019 | Schreiben von 1-Bits quittiert IRQ-Flags |
| VIC $D01E/$D01F | Lesen löscht das Kollisionsregister |
| VIC $D011/$D012 | Schreiben kann sofortigen Raster-IRQ auslösen |
| CIA $DC0D/$DD0D | Lesen liefert und löscht ICR, gibt IRQ/NMI frei |
| CIA Timer-High | Schreiben bei gestopptem Timer lädt den Zähler |
| CIA TOD | Lesen der Stunden friert Anzeige ein bis Zehntel gelesen; Schreiben der Stunden hält Uhr an |
| SID $D41B/$D41C | Lesen liefert Oszillator 3 / Hüllkurve 3 |
| Dummy-Zugriffe der CPU | werden wie echte Zugriffe ausgeführt (z. B. doppelte Schreibzugriffe bei RMW auf $D019) |

---

## 6. Interruptmodell

```
 VIC-II (Raster, Kollisionen, Lightpen) ─┐
 CIA 1 (Timer, TOD, SDR, FLAG)          ─┼─► IRQ (wired-OR, pegelgesteuert) ─► CPU
 Expansionsport                          ─┘
 CIA 2 (Timer, TOD, SDR, FLAG)          ─┐
 RESTORE (monostabile Stufe)            ─┼─► NMI (wired-OR, CPU flankengesteuert) ─► CPU
 Expansionsport                          ─┘
 Einschalten / Reset-Taste ─────────────────► RESET (alle Chips, CPU-Sequenz)
```

* Jede Quelle hält ihren Ausgang aktiv, bis sie per Registerzugriff quittiert wird.
* Da NMI flankengesteuert ist, löst RESTORE keinen weiteren NMI aus, solange CIA 2 die
  Leitung noch aktiv hält (Hardwareverhalten).
* CIA-Modell 6526 (alt): IRQ-Ausgang einen Takt nach dem Ereignis; 6526A: im selben Takt.

---

## 7. Datenfluss

```
Browser                           Emulationskern                             Browser
────────                          ───────────────                            ───────
keydown/keyup ─► BrowserKeyboard ─► KeyboardMatrix ─┐
mouse/pointer ─► MouseJoystick ──► Joysticks ───────┤
gamepad poll  ─► GamepadJoystick ─────────────────┐ │
                                                  ▼ ▼
                                    CIA1 Port A/B (Wired-AND-Auflösung)
                                                  │ (Register $DC00/$DC01)
                                                  ▼
 ROM-Dateien ─► ROMManager ─► Memory ◄──► MemoryBus ◄──► CPU6510 (Befehle)
                                  ▲          │  ▲
                                  │          │  └──── VIC-II (φ1/φ2, BA) ──► Framebuffer ─► CanvasRenderer ─► Canvas
                                  │          ├──────── SID ──► Samples ─► AudioEngine ─► SIDWorklet ─► Lautsprecher
                                  │          └──────── CIA2 ──► VIC-Bank, IEC-Leitungen
                                  │                              │
 Datei-Import ─► DiskDirectory/D64 ─► VirtualDrive1541 ◄──IECBus─┘
 Datei-Export ◄─ FileManager ◄───────┘ (SAVE erzeugt Dateien auf der virtuellen Diskette)
```

* Eingaben wirken ausschließlich über Portpins (Tastatur, Joystick), die RESTORE-Leitung
  und IEC-Leitungen. Kein Modul schreibt direkt in KERNAL-Puffer.
* LOAD/SAVE laufen über die originalen KERNAL-Routinen (bit-banging über CIA 2) und das
  virtuelle Laufwerk auf Leitungsebene.
* Die Debug-Injektion eines PRG direkt ins RAM (`PRGLoader.injectPrg`) ist ausdrücklich
  als Entwicklungswerkzeug gekennzeichnet und nicht der primäre Ladeweg. Der
  Komfort-Autostart legt die Datei auf die virtuelle Diskette und tippt
  `LOAD"*",8,1` und `RUN` über die Tastaturmatrix.

---

## 8. VIC-II-Detailmodell

### 8.1 Zyklusplan (PAL 6569)

| Zyklus | φ1 | φ2 (wenn AEC low) |
|---|---|---|
| 1–10 | p/s-Zugriffe Sprites 3–7 | s-Zugriffe Sprites 3–7 |
| 11–15 | Refresh (5×) | ab 15: c-Zugriff (Badline) |
| 16–55 | g-Zugriff (Display/Idle) | 16–54: c-Zugriff (Badline) |
| 56–57 | Idle-Zugriff | – |
| 58–63 | p/s-Zugriffe Sprites 0–2 | s-Zugriffe Sprites 0–2 |

### 8.2 Interne Zähler (nach C. Bauer, „The MOS 6567/6569 video controller“)

* VCBASE/VC (10 Bit), RC (3 Bit), VMLI (6 Bit), Display-/Idle-Zustand.
* Zyklus 14: VC ← VCBASE, VMLI ← 0, bei Badline RC ← 0.
* Zyklus 58: RC = 7 → Idle, VCBASE ← VC; im Display-Zustand RC++.
* Badline-Bedingung: RASTER ∈ [$30, $F7] ∧ (RASTER & 7) = YSCROLL ∧ DEN war in Zeile $30 gesetzt.
* Rahmen: Haupt- und vertikales Flipflop mit Vergleichswerten (CSEL: 24/344 bzw. 31/335;
  RSEL: 51/251 bzw. 55/247), Prüfung pixelgenau nach X-Koordinate bzw. in Zyklus 63.

### 8.3 Pixelpipeline

* Framebuffer-Spalte = (Zyklus − 1) · 8 + Pixel; X-Koordinate = (firstXCoord + Spalte) mod
  (8 · Takte je Zeile). Der Framebuffer umfasst den gesamten Rasterbereich (504 × 312 bei PAL),
  der sichtbare Ausschnitt wird erst bei der Präsentation gewählt.
* Ein g-Zugriff in Zyklus *c* wird ab Spalte (c − 1) · 8 + 4 + XSCROLL in einen
  Grafik-Zeilenpuffer dekodiert (Daten bei X = $18 für das erste Zeichen ohne Scrolling).
  Hintergrundfarben werden erst bei der Pixelausgabe aufgelöst, damit Farbwechsel
  innerhalb einer Zeile an der richtigen Stelle wirken.
* Pro Pixel: Rahmenlogik → Sprite-Sequenzer (X-Vergleich pro Pixel) → Priorität →
  Kollisionen → Farbindex in den Framebuffer.
* Registerschreibzugriffe der CPU in Takt *n* wirken ab den Pixeln von Takt *n+1*
  (Näherung: auf echter Hardware verschiebt sich die Wirkung innerhalb des Takts um wenige Pixel).

### 8.4 Sprites

* DMA-Start in Zyklus 55/56 bei MxE ∧ Y-Vergleich; MCBASE ← 0, Y-Expansions-Flipflop.
* Zyklus 58: MC ← MCBASE, Display bei aktiver DMA und Y-Vergleich.
* Zyklus 16: bei gesetztem Expansions-Flipflop MCBASE ← MC, bei MCBASE = 63 DMA aus.
  Schreibzugriff auf $D017 in Zyklus 15 erzeugt den Sprite-Crunch
  (MC ← (0x2A & (MCBASE & MC)) | (0x15 & (MCBASE | MC))).
* Ausgabe ab X-Vergleich, 24 Bit (X-Expansion: doppelte Breite), Multicolor in Bitpaaren.
* Kollisionen setzen Register-Bits; IRQ-Flag nur, wenn das Register vorher 0 war.

---

## 9. CIA-Detailmodell

* Timer als Zustandsautomat (STOP, WAIT_THEN_COUNT, LOAD_THEN_STOP, LOAD_THEN_COUNT,
  LOAD_THEN_WAIT_THEN_COUNT, COUNT, COUNT_THEN_STOP) nach dem Modell von Frodo SC:
  Ein Schreibzugriff auf CRA/CRB wird im folgenden CIA-Takt übernommen; die erste
  Dekrementierung erfolgt im dritten Takt nach dem Startbefehl, Force-Load wirkt nach einem
  Takt. Beim Unterlauf wird aus dem Latch geladen, das ICR-Bit sofort gesetzt und ein Takt
  Pause eingelegt (Periode N+1); One-Shot stoppt den Timer.
* Timer B zählt φ2, CNT-Flanken, Timer-A-Unterläufe (im selben Takt) oder Unterläufe bei
  CNT high.
* PB6/PB7-Ausgabe (Puls/Toggle) bei gesetztem PBON.
* TOD: BCD-Uhr mit Zehnteln, Sekunden, Minuten, Stunden (12 h + PM), 50/60-Hz-Teiler
  nach CRA-Bit 7, Latch beim Lesen, Halt beim Schreiben, Alarm über CRB-Bit 7.
* SDR: Ausgabe mit Timer-A-Unterlauf (zwei Unterläufe je Bit), Eingabe über CNT/SP, ICR-Bit 3
  nach 8 Bit.
* ICR: Lesen löscht und gibt die Leitung frei; Masken-Schreibzugriff mit Set/Clear-Bit;
  IRQ-Verzögerung je Modell.

---

## 10. SID-Detailmodell

* Oszillator: 24-Bit-Akkumulator, Rausch-LFSR (23 Bit) getaktet durch Bit 19, Hard-Sync und
  Ringmodulation über das MSB der Quellstimme, Test-Bit hält den Akkumulator auf 0.
* Wellenformen 12 Bit: Dreieck, Sägezahn, Puls (12-Bit-Vergleich), Rauschen (8 Bits aus dem
  LFSR); Kombinationen über ein Nachbarbit-Modell (näherungsweise).
* Hüllkurve: 15-Bit-Ratenzähler mit Periodentabelle, Exponentialzähler nach Pegelschwellen,
  ADSR-Verzögerungsfehler durch Zählerüberlauf entsteht modellbedingt.
* Filter: TPT-Zustandsvariablenfilter (stabil bis Nyquist), 6581-Kennlinie nichtlinear,
  8580 linear; Resonanz 0–15; Modi beliebig kombinierbar; Stimme 3 abschaltbar.
* Ausgang: Stimmen mit DC-Offset (6581) → Lautstärke-Multiplikation (dadurch funktionieren
  $D418-Digis) → DC-Sperre (Koppelkondensator) → Float32.
* Lesbare Register: POTX/POTY ($FF ohne Paddle), OSC3, ENV3; übrige Register liefern den
  zuletzt geschriebenen Busrest, der nach einer modellabhängigen Zeit abklingt.

---

## 11. IEC-Bus und Laufwerk

* Leitungen als Open-Collector: Pegel = AND aller Teilnehmer. C64-Seite über CIA 2:
  PA3 ATN OUT, PA4 CLK OUT, PA5 DATA OUT (invertiert), PA6 CLK IN, PA7 DATA IN.
* `VirtualDrive1541` implementiert das serielle Protokoll (ATN-Bestätigung, Bytehandshake,
  EOI per Zeitüberschreitung, Turnaround bei TALK) mit festen, hardwarenahen Zeitkonstanten
  in Systemtakten. Dadurch funktionieren LOAD, SAVE, OPEN/CLOSE, GET#, PRINT#, das
  Verzeichnis (`LOAD"$",8`) und der Fehlerkanal über die originalen KERNAL-Routinen.
* Nicht abgedeckt (Ausbaustufe „True Drive“): Schnelllader, die eigenen Code im
  Laufwerk ausführen (M-W/M-E). Dafür vorgesehen: `Drive1541` mit eigener `CPU6502`,
  zwei `VIA6522`, GCR-Spurmodell und 1541-ROM; Schnittstelle zum `IECBus` identisch.

---

## 12. Implementierungsreihenfolge und Meilensteine

| # | Meilenstein | Prüfbares Ergebnis |
|---|---|---|
| M0 | Architektur, Projektgerüst, Konstanten | dieses Dokument; `node --test` läuft |
| M1 | CPU-Kern, Opcodetabelle, Assembler | Unit-Tests aller Opcodes; Dormann-Funktionstest erreicht Erfolgsadresse $3469; Busfolgen gegen SingleStepTests |
| M2 | Memory, MemoryBus, ProcessorPort, InterruptController | Banking-Tests aller 32 PLA-Modi; Open Bus; Port-Bits |
| M3 | CIA 6526 | Timer-Pipeline, Kaskade, One-Shot, ICR, TOD, Alarm, SDR, Tastaturauflösung |
| M4 | VIC-II inkl. Sprites | Raster-IRQ-Zeitpunkt, Badline-Stalls (40–43 Takte), Sprite-DMA-Stalls, Modi, Kollisionen, Rahmen |
| M5 | Systemintegration C64 | Kaltstart mit ROMs bis zum BASIC-Prompt (lokal mit Original- oder Open-ROMs) |
| M6 | Browser: Renderer, Tastatur, Joystick, Maus, Scheduler | Start in Firefox, Eingabe von BASIC-Zeilen, Skalierung |
| M7 | SID, AudioEngine, Worklet | Frequenz-/Hüllkurventests; Ton in Firefox nach Klick |
| M8 | IEC, virtuelles Laufwerk, PRG/D64, Base64, IndexedDB | LOAD/SAVE/Verzeichnis über KERNAL in Integrationstests |
| M9 | Debugger, Tokenizer, Dokumentation des Status | Monitor, Listing-Konvertierung, `docs/STATUS.md` |
| M10 (später) | True-Drive-1541, NTSC-Verifikation, Module (CRT), Datasette | – |

---

## 13. Testplan

Testwerkzeug: `node --test c64-emulator/js/tests/` (Node ≥ 20, keine Abhängigkeiten).

| Bereich | Testfälle | Art |
|---|---|---|
| CPU | jeder Opcode: Ergebnis, Flags, Taktzahl; Page-Crossing; Dummy-Reads/Writes über Bus-Log; BCD (ADC/SBC alle Kombinationen gegen Referenzformel); JMP-($xxFF)-Fehler; Stack; BRK/RTI; IRQ/NMI-Latenz; CLI/SEI-Verzögerung; Branch-IRQ-Verzögerung; NMI-Hijack; RESET; JAM; RDY-Stall nur bei Lesezyklen | lokal |
| CPU extern | Klaus Dormann 6502 Functional Test (lokal bereitgestellt); Tom Harte SingleStepTests 6502 (Stichprobe je Opcode, inkl. Buszyklen) | extern |
| Speicher | 32 PLA-Modi, ROM-Schreibdurchgriff, Color-RAM-Nibble, I/O-Spiegel, Open Bus, Port-Floating-Bits, VIC-Bank/Char-ROM-Sicht | lokal |
| Interrupts | Wired-OR, NMI-Flanke bei gehaltener Leitung, RESTORE + CIA2 | lokal |
| CIA | Timer-Startverzögerung, Unterlaufperiode N+1, Force-Load, One-Shot, Kaskade, ICR-Lesen/Löschen, IRQ-Verzögerung 6526/6526A, TOD-Zählung/Latch/Halt/Alarm, SDR-Ausgabe, PB6/PB7 | lokal |
| VIC | Rasterzähler/Takte je Bild, Raster-IRQ-Zyklus, Badline-Stalls, $D011-induzierte Badline, Modusdekodierung aller 8 Kombinationen, Zeichen-/Bildschirmadressen über $D018 und Bank, Rahmen 38/40 und 24/25, X/Y-Scroll | lokal |
| Sprites | DMA-Stalls je Sprite, Pointer aus aktiver Bank, Y-/X-Expansion, Multicolor, Priorität, Sprite-Sprite- und Sprite-Hintergrund-Kollision mit Löschen beim Lesen | lokal |
| SID | Frequenz → Oszillatorperiode, Wellenformen, Puls-Vergleich, Rausch-LFSR, Sync/Ring, ADSR-Zeiten, OSC3/ENV3, Filter-Frequenzgang (qualitativ), Volume-DC | lokal |
| Tastatur | Matrixauflösung, Mehrfachtasten, Ghosting, Joystick-Überlagerung, Layoutzuordnung | lokal |
| IEC/Laufwerk | Bytehandshake mit einer im Test assemblierten Senderoutine nach KERNAL-Muster, LOAD/SAVE über ROM (lokal bei vorhandenen ROMs) | lokal |
| Integration | Feste Programme mit festen Taktzahlen und erwarteten Registerständen; Kaltstart bis BASIC (falls ROMs vorhanden); PEEK/POKE/SYS über getippte Eingabe | lokal |

Tests, die externe Dateien (ROMs, Referenztests) benötigen, werden mit klarer Meldung
übersprungen, wenn die Dateien fehlen. Sie werden nicht ins Repository aufgenommen.
