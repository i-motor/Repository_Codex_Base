# Implementierungs- und Verifikationsstand

Stand: 15.11.2026. Diese Tabelle unterscheidet ausdrücklich zwischen

| Kürzel | Bedeutung |
|---|---|
| **I** | implementiert |
| **L** | durch lokale, automatisierte Tests im Repository bestätigt (`npm test`) |
| **E** | durch externe Referenztests bestätigt (lokal bereitgestellt, nicht im Repository) |
| **N** | nur näherungsweise emuliert (bekannte Abweichung, siehe Bemerkung) |
| **F** | noch nicht implementiert |

Es wird **keine vollständige Hardwarekompatibilität behauptet**. Die verbreiteten
C64-Hardware-Testsuiten (Wolfgang Lorenz, VICE-testprogs, SID-Messreihen) wurden bisher
nicht ausgeführt.

Externe Referenzen, die tatsächlich gelaufen sind:

* **Klaus Dormann, 6502 Functional Test** (`6502_functional_test.bin`): erreicht die
  Erfolgsadresse `$3469` (≈ 96 Mio. Takte).
* **Tom Harte, SingleStepTests 6502 (v1)**: Stichprobe der ersten ≈ 300 Fälle je Opcode,
  alle 256 Opcodes, jeweils Register, Speicher **und vollständige Buszyklenfolge**
  (Adresse, Wert, Lese-/Schreibzugriff je Takt): alle bestanden.
* **MEGA65 Open ROMs** (freie KERNAL/BASIC-Neuimplementierung, LGPL-3): Kaltstart bis
  `READY.`, Programmeingabe, `RUN`, `POKE`, Laden/Speichern/Verzeichnis über das
  virtuelle IEC-Laufwerk. Das Open-ROMs-BASIC implementiert u. a. keine
  Fließkomma-Multiplikation; das ist eine Eigenschaft dieser ROMs, nicht des Emulators.
* **Original-ROMs**: Integrationstest vorhanden (`integration.test.js`), konnte mangels
  urheberrechtlich geschützter ROM-Dateien in dieser Umgebung **nicht ausgeführt** werden.

## CPU (MOS 6510)

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| Alle 151 offiziellen Befehlsvarianten | I | L | E | | Harte + Dormann |
| Stabile undokumentierte Opcodes (SLO, RLA, SRE, RRA, SAX, LAX, DCP, ISC, ANC, ALR, ARR, SBX, LAS, NOPs) | I | | E | | Harte inkl. Buszyklen |
| Instabile Opcodes ANE/LXA | I | | E | N | „Magic“-Konstante `$EE` wie in den Harte-Daten; reale Chips streuen |
| SHA/SHX/SHY/TAS inkl. Wegfall von „&(H+1)“ bei RDY | I | L | E | | Grundverhalten extern, RDY-Fall lokal |
| JAM/KIL (12 Opcodes) | I | L | E | | Buszyklen extern bestätigt, nur RESET beendet |
| Mikrozyklische Ausführung, Dummy-Reads/-Writes, Page-Crossing | I | L | E | | |
| BCD mit NMOS-Flagverhalten | I | L | E | | |
| JMP-($xxFF)-Fehler | I | L | E | | |
| IRQ/NMI-Abtastung (vorletzter Takt), CLI/SEI/PLP-Verzögerung, RTI sofort | I | L | | | nach dokumentiertem NMOS-Verhalten, nicht extern geprüft |
| Branch-IRQ-Verzögerung, NMI-Hijacking von BRK/IRQ | I | L | | | |
| RESET-Sequenz (7 Takte, S−3, nur Lesezugriffe) | I | L | | | |
| RDY: Anhalten nur in Lesezyklen | I | L | | | |
| Interrupt-Abtastung während RDY-Stall | I | L | | N | Abtastung läuft im Stall weiter (VICE-ähnlich), Feinheiten ungeprüft |
| Prozessorport $00/$01, Pull-ups, Kassettenbits | I | L | | | |
| Floating-Bits 6/7 (Abfallzeit) | I | L | | N | feste Abfallzeit 350 000 Takte |

## Speicher und Bus

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| 64 KB RAM, 4-Bit-Color-RAM, ROM-Einblendung | I | L | | | |
| PLA: alle 32 Kombinationen aus LORAM/HIRAM/CHAREN/GAME/EXROM | I | L | | | |
| Schreibzugriffe unter ROM ins RAM | I | L | | | |
| I/O-Dekodierung und Spiegelungen | I | L | | | |
| VIC-Sicht, Bankwahl über CIA 2, Zeichen-ROM in Bank 0/2 | I | L | | | |
| Open Bus (VIC-φ1-Wert) | I | L | | N | kein Abklingen, keine CPU-seitigen Buskapazitäten |
| Schreiben auf $00/$01 schreibt φ1-Wert ins RAM | I | L | | | |
| Steckmodule (CRT-Formate, Bankumschaltung) | | | | | **F** – PLA-Leitungen vorbereitet |
| RAM-Einschaltmuster | I | | | N | 64-Byte-Blöcke $00/$FF |

## VIC-II (PAL 6569)

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| 63 Takte × 312 Zeilen, Zyklusplan der Speicherzugriffe | I | L | | | |
| Badlines, BA (Zyklen 12–54), AEC nach 3 Takten | I | L | | | 25 × 43 Stalltakte je Bild verifiziert |
| Per $D011 erzeugte Badlines mitten in der Zeile | I | L | | | Grundlage für FLD/VSP/FLI, Effekte selbst nicht extern geprüft |
| c-Zugriff bei BA < 3 Takte | I | | | N | liest `$FF` / Color-Nibble aus Open Bus |
| VC/VCBASE/RC/VMLI, Display-/Idle-Zustand | I | L | | | |
| Alle 8 Moduskombinationen (inkl. ungültige → Schwarz, Kollisionsverhalten) | I | L | | | |
| Moduswechsel innerhalb eines Zeichens | I | | | N | Modus wird beim g-Zugriff ausgewertet |
| Bildschirm-/Zeichensatz-/Bitmap-Adressierung, $D018, ECM-Adressmaskierung | I | L | | | |
| X/Y-Scrolling, 38/40 Spalten, 24/25 Zeilen, Rahmen-Flipflops | I | L | | | |
| Raster-IRQ (Zyklus 1, Zeile 0 in Zyklus 2), sofortiger IRQ bei Vergleichswert-Schreiben | I | L | | | |
| Registerwirkung innerhalb einer Rasterzeile | I | L | | N | Wirkung ab dem Folgetakt (8-Pixel-Raster), auf Hardware pixelgenauer |
| Hintergrundfarbwechsel pixelgenau zur Ausgabe | I | | | | |
| Refresh-Zugriffe, Idle-Zugriffe ($3FFF/$39FF) | I | | | | beeinflussen Open Bus |
| Lightpen ($D013/$D014, IRQ) | I | | | N | ungetestet, X-Auflösung je Takt |
| NTSC 6567R8 | I | | | N | Tabellen vorhanden, **nicht verifiziert** |
| 6567R56A, 8562/8565-Grauwert-Effekte | | | | | **F** |

## Sprites

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| 8 Sprites, 24×21, Position mit 9. X-Bit, Darstellung ab Y+1 | I | L | | | |
| Sprite-DMA (p/s-Zugriffe), BA-Fenster je Sprite, Pointer aus aktiver Bank | I | L | | | |
| MC/MCBASE, Y-Expansions-Flipflop, Sprite-Crunch | I | L | | | Crunch-Formel nach VICE |
| X-/Y-Expansion, Multicolor | I | L | | | |
| Priorität Sprite/Sprite und Sprite/Hintergrund | I | L | | | |
| Kollisionen, IRQ nur bei vorher leerem Register, Löschen beim Lesen | I | L | | | |
| Pixelgenauer X-Vergleich, Mehrfachauslösung in einer Zeile | I | | | N | Schieberegister wird beim Start geleert |

## SID (6581, optional 8580)

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| 3 Stimmen, 24-Bit-Oszillatoren, Frequenzformel | I | L | | | |
| Dreieck, Sägezahn, Puls, Rauschen (23-Bit-LFSR) | I | L | | | |
| Kombinierte Wellenformen | I | | | N | parametrisches Nachbarbitmodell, keine Chipmessdaten |
| Rauschen kombiniert (LFSR-Rückschreiben) | | | | | **F** |
| Sync, Ringmodulation, Test-Bit | I | L | | | |
| ADSR mit Ratenzähler, Exponentialzähler, Delay-Bug | I | L | | | Periodentabelle nach reSID |
| Filter LP/BP/HP, Resonanz, Routing, Stimme 3 aus | I | L | | N | TPT-Zustandsvariablenfilter, Kennlinien approximiert, keine Nichtlinearität |
| DC-Offset 6581 → $D418-Digis | I | L | | N | vereinfachte DC-Werte |
| OSC3/ENV3, Busrest mit Abklingzeit | I | L | | | |
| POTX/POTY (Paddles, Maus 1351) | | | | | **F** – liefern `$FF` |
| Taktgenaues Nachführen bei Registerzugriff | I | L | | | |
| Resampling + Ratenregelung (±0,5 %), AudioWorklet | I | L | | | im Browser (Chromium) geprüft |

## CIA 6526

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| Ports A/B, DDR, Pull-ups, externe Beschaltung | I | L | | | |
| Timer A/B, Latch, One-Shot/Continuous, Force-Load, Startverzögerung | I | L | | | Zustandsautomat nach Frodo-SC-Modell |
| Unterlaufperiode N+1, IRQ 6526 +1 Takt / 6526A sofort | I | L | | | |
| Timer B: φ2, CNT, Timer-A-Unterlauf, Unterlauf bei CNT high | I | L | | N | Kaskade zählt im selben Takt |
| PB6/PB7-Ausgabe (Puls/Toggle) | I | L | | | |
| TOD mit 50/60-Hz-Teiler, Latch, Halt, Alarm, 12-Uhr-Eigenheit | I | L | | | |
| SDR-Ausgabe über Timer A, Eingabe über CNT | I | L | | N | Eingabe vereinfacht |
| ICR, Maske, FLAG | I | L | | | |
| „Timer-B-Bug“ des alten 6526 (ICR-Lesen im Unterlauftakt) | | | | | **F** |
| Lorenz-CIA-Testsuite | | | | | nicht ausgeführt |

## Eingabe

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| 8×8-Matrix, Wired-AND-Auflösung, Ghosting, Mehrfachtasten | I | L | | | |
| RESTORE über monostabile Stufe auf NMI | I | L | | | |
| Symbolische Belegung (zeichenbasiert, beliebiges PC-Layout) | I | L | | | im Browser geprüft |
| Positionelle Belegung DE/US | I | L | | | |
| Mindesthaltezeit/-pause in emulierter Zeit | I | L | | | verhindert verlorene Kurzanschläge |
| Joystickports 1/2, Umschaltung, Überlagerung mit Matrix | I | L | | | |
| Maus als Joystick (Positionsmodus, relativer Modus mit Pointer Lock) | I | | | | manuell zu prüfen |
| Numpad-Joystick | I | | | | |
| Gamepad-API | I | | | | ungetestet (keine Hardware) |

## Laufwerk, Dateien, BASIC

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| IEC-Leitungen (Open-Collector, ATN/CLK/DATA) über CIA 2 | I | L | | | |
| Virtuelles Laufwerk 8 auf Leitungsebene (ATN, Bytehandshake, EOI, Turnaround) | I | L | E | | mit Open-ROMs-KERNAL geprüft; Original-KERNAL ungeprüft |
| LOAD, LOAD …,8,1, SAVE, `$`-Verzeichnis, `?FILE NOT FOUND` | I | L | E | | |
| Fehlerkanal 15 lesen (Statusmeldung) | I | L | | | |
| Kanäle 2–14 (OPEN/PRINT#/GET#), Befehle I, S, R, N, UJ | I | | | | implementiert, noch ohne automatisierten Test |
| REL-Dateien, M-R/M-W/M-E, B-R/B-W, U1/U2 | | | | | **F** |
| Schnelllader mit Laufwerkscode (True-Drive: 6502, VIA 6522, GCR) | | | | | **F** |
| PRG-Format, P00, Base64-Container (Import/Export) | I | L | | | |
| D64 lesen/schreiben (BAM, Verzeichnis, Ketten) | I | L | | | Fehlerbytes ignoriert, 40 Spuren nur lesend |
| IndexedDB-Persistenz (ROMs, Diskette) | I | | | | im Browser genutzt, nicht automatisiert getestet |
| BASIC-Tokenizer/-Detokenizer (Konvertierung, nicht Laufzeitpfad) | I | L | | | |
| BASIC/KERNAL über Original-ROMs | I | | | | Test vorhanden, mangels ROMs nicht ausgeführt |

## Browser und Zeitbasis

| Funktion | I | L | E | N | Bemerkung |
|---|---|---|---|---|---|
| Ein Canvas, Skalierung proportional/ganzzahlig, devicePixelRatio, ohne Glättung | I | | | | in Chromium geprüft (Playwright) |
| PAL-Pixelseitenverhältnis (optional) | I | | | | |
| Echtzeit-Scheduler unabhängig von requestAnimationFrame | I | L | | | |
| Audio/Video-Synchronität aus gemeinsamer Taktbasis | I | | | | |
| Warp-Modus | I | | | | |
| Debugger/Monitor (`window.monitor`) | I | L | | | |
| Firefox | | | | | **nicht automatisiert getestet** – nur Chromium stand zur Verfügung; ausschließlich Standard-APIs verwendet |
| Web Worker für den Emulationskern | | | | | **F** – bewusst Hauptthread (siehe Architektur) |

## Weitere fehlende Komponenten

Datasette (TAP), Userport/RS-232, Steckmodule (CRT), REU, Snapshots/Savestates,
Paddles/1351-Maus, verifiziertes NTSC.
