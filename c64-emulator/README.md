# Hardwareorientierter Commodore-64-Emulator für Firefox

Ein C64-Emulator in nativem HTML5 und JavaScript (ES-Module, Canvas 2D, Web Audio mit
AudioWorklet) – ohne Frameworks, Bibliotheken oder Build-System. Der Emulator führt echte
6510-Maschinenbefehle mikrozyklisch aus und bildet VIC-II, SID, zwei CIA 6526, PLA-Banking,
Tastaturmatrix, Joystickports und den seriellen IEC-Bus über ihre Hardware-Schnittstellen nach.

* Architektur: [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md)
* Verifikationsstand (implementiert / getestet / extern bestätigt / Näherung / fehlt):
  [`docs/STATUS.md`](docs/STATUS.md)

## Start

```sh
cd c64-emulator
python3 -m http.server 8064
```

Dann in Firefox `http://localhost:8064/` öffnen. Ein lokaler HTTP-Server ist nötig, weil
ES-Module und AudioWorklets nicht über `file://` geladen werden.

### ROM-Dateien

Der Emulator benötigt `basic.rom` (8 KB), `kernal.rom` (8 KB) und `chargen.rom` (4 KB).
Sie sind urheberrechtlich geschützt und deshalb **nicht** enthalten. Möglichkeiten:

1. Dateien in `rom/` ablegen (siehe [`rom/README.md`](rom/README.md)) – sie werden beim
   Start automatisch geladen, oder
2. über die Schaltfläche **ROMs…** auswählen bzw. per Drag & Drop auf das Fenster ziehen.

Geladene ROMs werden geprüft (Größe, CRC32 bekannter Revisionen) und in IndexedDB
gespeichert, sodass sie nur einmal bereitgestellt werden müssen.

## Bedienung

| Funktion | Bedienung |
|---|---|
| Fokus | Klick in das Bild; Tastatureingaben gehen nur bei Fokus an den C64 |
| Tastatur „symbolisch“ | Zeichen wie auf dem PC tippen (`"` → SHIFT+2 usw.), funktioniert mit jedem PC-Layout |
| Tastatur „positionell“ | Tasten nach Lage (DE: Y/Z getauscht); für Spiele |
| RUN/STOP | `Esc` |
| CTRL / C= | `Tab` / linke `Strg` |
| CLR/HOME | `Pos1` (mit Shift: `Ende`) |
| INST/DEL | `Rück` / `Entf` (INST: `Einfg`) |
| Cursor | Pfeiltasten (hoch/links erzeugen SHIFT automatisch) |
| F1–F8 | `F1`–`F8` |
| RESTORE | `Bild↑` oder Schaltfläche **RESTORE** |
| ↑ (Pfeil hoch) | `Bild↓` |
| Joystick | Maus (Modus „Position“: Richtung relativ zur Bildmitte; „relativ“: Klick sperrt den Zeiger, Bewegung = Richtung), linke Maustaste = Feuer; optional Numpad (8/2/4/6, 0/5 = Feuer) und Gamepad |
| Joystickport | Auswahl Port 2 (Standard) oder Port 1 |
| Ton | **Ton an** (Firefox erlaubt Audio erst nach einer Benutzerinteraktion) |
| Warp | ungebremste Emulation, z. B. für langes Laden |
| Reset / Ein/Aus | RESET-Leitung (Warmstart) bzw. Kaltstart |

## Dateien laden und speichern

* **Datei…** oder Drag & Drop: `.prg`, `.p00`, `.d64`, `.bas`/`.txt` (BASIC-Listing, wird
  tokenisiert), `.json` (Base64-Container), ROM-Dateien.
* PRG-Dateien landen auf der **virtuellen Diskette in Laufwerk 8**. Geladen wird wie am
  echten C64 über die KERNAL-Routinen: `LOAD"NAME",8` bzw. `LOAD"NAME",8,1`, Verzeichnis
  mit `LOAD"$",8` und `LIST`.
* **Autostart** (Option): Nach dem Ablegen einer einzelnen Datei tippt der Emulator
  `LOAD"NAME",8,1` und danach `RUN` über die Tastaturmatrix.
* `SAVE"NAME",8` speichert auf die virtuelle Diskette. Die Diskette wird in IndexedDB
  gesichert. Export: **PRG ↓** (einzelne Datei), **Base64 ↓** (alle Dateien als
  JSON-Container mit Base64-Inhalten), **D64 ↓** (Diskettenabbild).
* D64-Abbilder werden direkt eingelegt; `SAVE` schreibt dann in das Abbild.

Hinweis: Das Laufwerk ist ein IEC-Gerät auf Leitungsebene ohne eigene Laufwerks-CPU.
Schnelllader, die Code in die 1541 laden, funktionieren deshalb nicht (siehe Status).

## Debugging

In der Browser-Konsole:

```js
monitor('r')            // Register, Rasterposition, Takt
monitor('d e000 10')    // Disassemblieren
monitor('m 0400 64')    // Speicherdump (CPU-Sicht, seiteneffektfrei)
monitor('b c000')       // Haltepunkt; die Emulation hält vor dem Befehl an
monitor('s')            // Einzelschritt
monitor('vic')          // Chipzustand (vic, cia1, cia2, sid, drive)
c64                     // direkter Zugriff auf das Systemobjekt
```

## Tests

```sh
cd c64-emulator
npm test                 # entspricht: node --test "js/tests/**/*.test.js"
```

Node.js ≥ 20, keine Abhängigkeiten. Tests mit externen Referenzdaten werden übersprungen,
wenn die Daten fehlen. Sie werden in `c64-emulator/test-data/` erwartet (nicht im
Repository, per `.gitignore` ausgeschlossen):

| Pfad | Inhalt | Quelle |
|---|---|---|
| `test-data/dormann/6502_functional_test.bin` | Klaus Dormanns 6502 Functional Test | github.com/Klaus2m5/6502_65C02_functional_tests |
| `test-data/harte/00.json` … `ff.json` | Tom Hartes SingleStepTests (6502/v1), auch gekürzt | github.com/SingleStepTests/65x02 |
| `test-data/openroms/*.rom` | MEGA65 Open ROMs (`kernal_generic.rom`, `basic_generic.rom`, `chargen_openroms.rom`) | github.com/MEGA65/open-roms |
| `rom/basic.rom`, `rom/kernal.rom`, `rom/chargen.rom` | Original-ROMs (bekannte CRC32) | eigener C64 |

Alternativ über Umgebungsvariablen `C64_TEST_DATA`, `C64_HARTE_DIR`, `C64_DORMANN_BIN`,
`C64_OPENROMS_DIR`, `C64_ROM_DIR`.

## Projektstruktur

```
index.html, css/style.css     minimale Oberfläche, genau ein Canvas
js/main.js                    Browser-Integration
js/core/                      C64, CPU6510, OpcodeTable, ProcessorPort, Memory, MemoryBus,
                              Clock (Zeitbasis, Scheduler), InterruptController, ROMManager
js/video/                     VICII, VideoTiming, SpriteEngine, CharacterGenerator,
                              Palette, CanvasRenderer
js/audio/                     SID6581, SIDVoice, SIDEnvelope, SIDFilter, AudioEngine, SIDWorklet
js/io/                        CIA6526, Keyboard, KeyboardLayouts, Joystick, MouseJoystick,
                              Gamepad, IECBus
js/storage/                   VirtualDrive1541, DiskDirectory, D64Image, PRGLoader,
                              Base64Codec, IndexedDBStore, FileManager
js/basic/                     BASICV2 (Tokens, Detokenizer), BasicTokenizer
js/utils/                     Constants, BitOperations, Assembler, Debugger
js/tests/                     node:test-Testsuite
```

Der Quellcode enthält gemäß Projektvorgabe keine Kommentare; Erläuterungen stehen in
`docs/`.
