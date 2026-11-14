# C64 im Browser

C64-Emulation in reinem HTML5/JavaScript ohne Abhängigkeiten. Die gesamte Ausgabe wird in ein
einziges Canvas gerendert, das sich proportional an das Browserfenster anpasst.

**Start:** `index.html` im Browser öffnen (funktioniert direkt per Doppelklick, kein Server nötig).

## Module (`js/`)

| Modul | Aufgabe |
|---|---|
| `petscii.js` | Umrechnung PETSCII ↔ Bildschirmcode ↔ ASCII |
| `charrom.js` | Zeichensatz-ROM (2 × 256 Zeichen, 8×8) |
| `memory.js` | 64 KB RAM, ROM-Abbilder, Farb-RAM, Bank-Switching über `$00/$01`, I/O-Dispatch |
| `cpu6510.js` | 6510-CPU: dokumentierte und gängige illegale Opcodes, Dezimalmodus, IRQ/NMI/BRK |
| `cia.js` | CIA 6526: Timer A/B, ICR, Ports, TOD-Uhr (CIA1 → IRQ, CIA2 → NMI, VIC-Bank) |
| `vic2.js` | VIC-II: Rasterzeilen-Renderer, alle Text-/Bitmap-Modi, Sprites, Kollisionen, Raster-IRQ |
| `sid.js` | SID: 3 Stimmen, Wellenformen, ADSR, Ringmodulation, Sync, Filter |
| `audio.js` | WebAudio-Ausgabe |
| `keyboard.js` | Tastaturevents → 8×8-Tastaturmatrix, Einfügen aus der Zwischenablage |
| `joystick.js` | Maus als Joystick |
| `storage.js` | LOAD/SAVE über localStorage und Datei-Dialog/Download (Base64) |
| `screeneditor.js` | Bildschirmeditor (Cursor, Steuerzeichen, Quote-Modus, Scrollen, logische Zeilen) |
| `kernal.js` | KERNAL-Ersatz: Sprungtabelle, IRQ-Routine, Tastaturscan, Kanäle |
| `basic-tokenizer.js` | BASIC-V2-Tokenizer und -Detokenizer |
| `basic.js` | BASIC-V2-Interpreter auf dem tokenisierten Programm im emulierten RAM |
| `machine.js` | Verdrahtung und Takt (PAL: 312 Zeilen × 63 Zyklen) |
| `main.js` | Canvas, Frame-Schleife, Drag & Drop, Hotkeys |

## Bedienung

| Host | C64 |
|---|---|
| Esc | RUN/STOP |
| Bild↑ (PageUp) | RESTORE (Esc + Bild↑ = RUN/STOP-RESTORE) |
| Tab | CTRL |
| Strg | C= (Strg+Shift schaltet Groß-/Kleinschrift) |
| Pos1 / Shift+Pos1 | HOME / CLR |
| Backspace, Entf / Einfg | DEL / INST |
| Pfeiltasten, F1–F8 | Cursor, Funktionstasten |
| `^`, `_`, `\` | ↑, ←, £ |
| Strg+V | Text als Tastatureingabe einfügen |
| Alt+J | Maus-Joystick zwischen Port 2 (Standard) und Port 1 umschalten |
| Alt+T | Turbo an/aus |
| Alt+R | Reset |

Maus: Bewegung = Joystick-Richtung, linke Taste = Feuer. Zusätzlich Ziffernblock (8/2/4/6, 0 = Feuer).

## LOAD und SAVE

| Gerät | Speicherort |
|---|---|
| 8 („Diskette“) | `localStorage` des Browsers, Inhalt Base64. `LOAD"$",8` + `LIST` zeigt das Verzeichnis |
| 1 („Datasette“, Standard ohne Geräteangabe) | `SAVE"NAME"` lädt `NAME.prg.b64` herunter, `LOAD` öffnet den Datei-Dialog |

Geladen werden Base64-Dateien und rohe `.prg`-Dateien. Dateien lassen sich auch per Drag & Drop auf
das Fenster laden. `OPEN/PRINT#/INPUT#/GET#/CLOSE` arbeiten auf Gerät 8 mit sequentiellen Dateien,
`OPEN 15,8,15,"S:NAME"` löscht eine Datei.

## Grenzen

- Die Original-ROMs sind urheberrechtlich geschützt und liegen nicht bei. BASIC und KERNAL sind in
  JavaScript nachgebaut; im ROM-Bereich stehen nur Einsprungpunkte. Maschinenprogramme, die
  undokumentierte ROM-Routinen anspringen, laufen daher nicht.
- BASIC-Variablen liegen in JavaScript-Strukturen, nicht im emulierten RAM hinter dem Programm.
- Der Zeichensatz ist nachgezeichnet. Eine 4096 Byte große Zeichensatzdatei kann per Drag & Drop
  eingesetzt werden.
- Der VIC rendert zeilenweise, Änderungen mitten in einer Rasterzeile wirken erst ab der nächsten.

## Tests

```
node test/basic.js     # BASIC, Maschinencode, Dateien
node test/video.js     # VIC, Sprites, Raster-IRQ, SID, Joystick
node test/browser.js   # Browser-Test, benötigt Playwright
```
