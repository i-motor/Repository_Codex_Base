# Hardwareorientierter Commodore-64-Emulator für Firefox

Aktueller Projektmeilenstein: **M9**. Das optionale 1541-Hardwaremodell und mehrere Timingbereiche sind weiterhin nur näherungsweise beziehungsweise teilweise implementiert.

## Korrekturen Tastatur und Audio

- **Tastaturmatrix**: Die Zuordnung von CIA-1-Port A (Auswahlleitungen) und Port B (Leseleitungen) war vertauscht, sodass alle nicht symmetrisch liegenden Tasten falsche Zeichen lieferten (z. B. `A` → `R`). Die Matrix entspricht jetzt der C64-Verdrahtung.
- **Deutsches Layout**: `Deutsch (QWERTZ)` bildet das vom Browser gemeldete Zeichen (`event.key`) auf die passende C64-Taste samt nötigem SHIFT-Zustand ab. Ein gedrücktes Host-SHIFT wird unterdrückt, wenn das C64-Zeichen ungeshiftet liegt (Shift+7 → `/`), und ergänzt, wenn es geshiftet liegt (`#` → SHIFT+3). AltGr-Zeichen (`@`, `[`, `]`) lösen weder CTRL noch die Commodore-Taste aus. CTRL-/Alt-Kombinationen bleiben positionsbezogen. Bei deutscher Browsersprache ist das Layout vorausgewählt.
- **Audio**: Die Emulationsschleife erreichte weniger als Echtzeitgeschwindigkeit, wodurch der Audiopuffer dauerhaft leerlief. Sprite-DMA-Planung, Signal-/Interrupt-Verwaltung und die VIC-Pixelschleife wurden ohne Verhaltensänderung beschleunigt (etwa Faktor 2). Die SID-Demo startet die Tonausgabe direkt; ein Neustart der ROMs behält aktiviertes Audio bei. Gibt der Browser die Audioausgabe nicht frei, läuft die Emulation ohne Ton weiter.

## M9 – Erweiterte Kompatibilität (aktueller Stand)

Die vollständige Codebasis M0–M8 ist erhalten. M9 ergänzt D64-Diskettenabbilder, ein separates 1541-Hardwaremodell mit eigener 6502-CPU, zwei VIA-6522-Chips und einer GCR-Lesepipeline, das NTSC-Profil MOS 6567R8, ein umschaltbares SID-8580-Filtermodell, eine native Gamepad-Anbindung und einen eigenständigen Web Worker. Es gibt kein Build-System und keine externen Laufzeitbibliotheken. Die JavaScript-, HTML- und CSS-Dateien enthalten keine Kommentare.

**Qualitätsstatus:** M9 ist eine implementierte, lokal getestete Erweiterung, aber **keine vollständig extern verifizierte 1541- oder C64-Emulation**. Der hardwarebasierte 1541-Modus ist experimentell; der bisherige virtuelle IEC-Endpunkt bleibt der Standard für PRG-LOAD/SAVE. Firmwaregetreues Laufwerksverhalten, alle VIA-Signale, GCR-Schreibvorgänge, analoge SID-Parameter, NTSC-Phasen und die Original-KERNAL-Übertragung mit Gerät 8 sind nicht abschließend bestätigt.

### Start im Firefox

Im Projektverzeichnis:

```sh
python3 -m http.server 8000
```

Anschließend `http://localhost:8000/` öffnen. Hardwaretests: `http://localhost:8000/tests/`.

### Neue Browserfunktionen

- **PAL/NTSC**: Im VIC-II-Abschnitt `PAL 6569` oder `NTSC 6567R8` auswählen. Der Wechsel initialisiert die emulierte Maschine neu, einschließlich Audio-/Rasterzeitbasis und Canvas-Geometrie. Die geladenen C64-ROMs und die virtuelle Dateisammlung bleiben erhalten.
- **MOS 6581/8580**: Im SID-Abschnitt das Filtermodell auswählen. Beide Modelle nutzen die vorhandenen digitalen SID-Stimmen und unterschiedliche *näherungsweise* Filtercharakteristiken, keine transistorpräzisen Analogmodelle.
- **D64**: `.d64` über den Laufwerksimport laden. Der Inhalt wird über Directory- und Sektorketten gelesen und dem virtuellen IEC-Gerät 8 als PRG-Dateien zur Verfügung gestellt. Das gemountete Abbild lässt sich wieder exportieren. Neu gespeicherte PRGs werden in D64-Sektoren und BAM eingetragen. Das Beispielabbild `examples/M9-DEMO.d64` enthält `IECDEMO` und `BORDER`.
- **1541-ROM**: Unter `1541-ROM` eine lokal bereitgestellte 16- oder 32-KiB-ROM-Datei auswählen. Der **experimentelle Hardwaremodus** aktiviert die separate 6502/VIA/GCR-Instanz anstelle des bisherigen virtuellen IEC-Gerätes. Es ist kein eingebauter DOS-Interpreter und kein KERNAL-LOAD-Shortcut aktiv. Weil die vollständige 1541-IEC-Timing- und Bitstromschreibemulation noch fehlt, ist der Hardwaremodus nicht als kompatibles Ersatzlaufwerk anzusehen.
- **Gamepad**: Native Gamepad API aktivieren, Port für das erste Gamepad auswählen. Digitale Richtungen werden aus D-Pad und Analogachsen generiert; die Feuer-Taste wird aus Gamepad-Buttons gelesen. Ein zweites angeschlossenes Gamepad verwendet den anderen C64-Port. Beide steuern ausschließlich die Joystick-Eingangsleitungen der emulierten CIA 1.
- **Web Worker**: `Separaten Worker-Test ausführen` startet einen unabhängigen C64 im Modul-Worker, führt eine Sprite-Demo mit emulierten Takten aus und holt ein Framebuffer-Ergebnis ab. Der Worker verändert **nicht** die Hauptthread-Maschine, nicht die laufende Audioausgabe und nicht das sichtbare Canvas. Die Verlagerung des vollständigen interaktiven Echtzeitbetriebs in den Worker ist eine spätere Integrationsaufgabe.

### Neue Module

| Modul | Funktion und aktuelle Grenze |
| --- | --- |
| `js/storage/D64Image.js` | D64-Geometrie (35/40 Tracks), BAM, 256-Byte-Sektoren, Directory, PRG-Ketten, Disk-Write, Scratch, Directory-Erweiterung; 40-Track-ExBAM und besondere Fehlercodeformate nicht vollständig unterstützt |
| `js/drive1541/GCRCodec.js` | Standard-4:5-GCR-Codierung/Decodierung, Header und Sektordaten, kodierte Track-Bytes; GCR-Rohspur/Sync-/Gap-Details angenähert |
| `js/drive1541/CPU6502.js` | Separater NMOS-6502-Kern auf Grundlage der vorhandenen Mikrocode-CPU, ohne 6510-Prozessorport |
| `js/drive1541/VIA6522.js` | Port-DDR, Timer 1/2, IFR/IER, CA-/CB-Eingangsflanken und teilweise Steuerregister; serielle Shift-/Handshake-Ausgänge noch nicht vollständig |
| `js/drive1541/Drive1541.js` | 2-KiB-RAM, 1541-ROM-Mapping, VIA-Adressen, eigene 1-MHz-CPU-Uhr, IEC-Leitungen, Motor/Stepper, GCR-Lesepfad; nicht vollständige Laufwerkslogik |
| `js/io/Gamepad.js` | Gamepad API, D-Pad, Achsen-Deadzone, Buttons, zwei Joystickports, Releases |
| `js/workers/EmulatorWorker.js` | Emulationsinstanz mit Nachrichten für Initialisierung, ROM, Reset, Demos, Zyklen, Framebuffer, PCM und D64 |
| `js/workers/WorkerRunner.js` | Asynchrone Worker-Anfragen, IDs, Fehlerbehandlung und Beenden |
| `js/workers/NodeWorkerAdapter.mjs` | Nur für die isolierte Node-Worker-Integrationstestumgebung |
| `js/utils/Constants.js` | NTSC-6567R8-Hardwareprofil zusätzlich zum bisherigen PAL-Profil |

### Lokale Testläufe

```sh
node --experimental-default-type=module js/tests/run-node.mjs
node js/tests/run-worklet-node.mjs
node js/tests/run-worker-node.mjs
node js/tests/run-m9.mjs --report reports/m9-local.json
```

Die automatisierten M9-Modultests sind nach `d64.test.js`, `drive.test.js`, `ntsc.test.js`, `sid-models.test.js`, `gamepad.test.js`, `worker.test.js` und `m9.test.js` getrennt. Es gibt auch einen PAL-Framebuffer-Vergleich: Eine M9-PAL-Ausführung mit gemountetem D64 und geändertem SID-Modell muss auf der aktuellen Testsequenz dasselbe Bild und denselben CPU-Zustand wie die unveränderte PAL-Basis liefern.

`run-m9.mjs` unterscheidet lokale Spezifikationsvektoren, echte ausgeführte Worker-Tests und nur bei bereitgestellten externen Dateien mögliche Hardware-Referenzvergleiche. Der Bericht `reports/m9-local.json` enthält ausdrücklich `passed`, `failed`, `skipped` und `error`. Fehlende Original-ROMs und fehlende externe Hardwaredaten zählen **nicht** als bestandene Referenztests.

### Optionale externe Prüfdaten

Externe Dateien werden ausschließlich vom Benutzer bereitgestellt; es wird nichts aus dem Internet geladen. Folgende Argumente sind möglich:

```sh
node js/tests/run-m9.mjs --1541-rom rom/1541.rom --d64 rom/reference.d64 --rom-dir rom --1541-trace tests/references/1541-external.json --sid-trace tests/references/sid-external.json --ntsc-trace tests/references/ntsc-external.json --report reports/m9-external.json
```

- `1541.rom`: 16384 oder 32768 Byte, CPU-/Firmware-Smoke-Test. Das bloße Durchlaufen ist kein Nachweis korrekter ROM- oder IEC-Funktion.
- `reference.d64`: Prüfung, ob ein reales Abbild eingelesen und seine PRG-Ketten dekodiert werden können.
- `basic.rom`, `kernal.rom`, `chargen.rom`: Der bestehende M8-KERNAL-Runner prüft tatsächlichen ROM-Boot, LOAD und SAVE; nur erfolgreiche Einzelfälle erhalten den Status `passed`.
- Externe, unabhängig gewonnene 1541-CPU-/SID-Ausgabe-/NTSC-VIC-Vektoren: Vergleich mit den gegebenen Prüfpunkten. Das Schema ist in `tests/references/*.example.json` dokumentiert. Beispielvektoren sind **keine** unabhängigen Hardwaremessungen.
- Ein praktischer Firefox-Test einschließlich Gamepad, Audio und Workernutzung muss auf einem System mit Firefox separat erfolgen.

### Offene M9-Abnahmekriterien

| Subsystem | Implementiert | Lokal bestätigt | Extern bestätigt |
| --- | --- | --- | --- |
| D64-Lesen/Schreiben | Ja, mit Einschränkungen | Ja | Nein |
| 1541-CPU und ROM-/RAM-Bus | Ja | Ja, synthetisches ROM | Nein |
| 1541-VIA, Mechanik und GCR | Teilweise | Ja, spezifizierte Teilfunktionen | Nein |
| Vollständige 1541-DOS-/IEC-Kompatibilität | Nein | Nein | Nein |
| SID-8580-Filtervariante | Ja, näherungsweise | Ja | Nein |
| NTSC-Raster- und Taktprofil | Ja, näherungsweise | Ja | Nein |
| Gamepad-Eingänge | Ja | Ja, simulierte Gerätewerte | Nein, Firefox-Test offen |
| Eigenständiger Worker-Emulator | Ja | Ja, realer Node-Worker | Nein, Firefox-Test offen |
| Unveränderte PAL-Funktionen | Ja | Ja, lokale Regressionen | Nein, externe Regression offen |

## Vorherige Entwicklungsphasen

## M8 – Referenzverifikation (M7-Hardwarebasis unverändert)

### M7 – IEC-Gerät 8, PRG-LOAD/SAVE und Base64-Dateicontainer

Das Projekt besteht aus nativen ES6-Modulen, HTML5, Canvas 2D und Web Audio mit AudioWorklet. Externe Frameworks, Emulatorbibliotheken und ein Build-System werden nicht verwendet. Alle bereits vorhandenen CPU-, Speicher-, CIA-, VIC-II-, Sprite-, SID- und Audiomodule bleiben Bestandteil des Projektstands.

M7 ergänzt einen virtuellen IEC-Busteilnehmer mit Gerätenummer 8. Seine Kommandos und Nutzdaten werden aus den emulierten ATN-/CLOCK-/DATA-Leitungen abgeleitet. Der C64 greift über die CIA-2-Register darauf zu. Das Laufwerk führt **keine** Erkennung von BASIC-Eingabezeilen aus und schreibt **keine** PRG-Daten direkt in das C64-RAM. Der reguläre Lade- und Speicherpfad soll durch die echten KERNAL-ROM-Routinen und deren serielle Kommunikation erfolgen.

**Verifikationsgrenze:** Die Leitungskodierung, Kommandodekodierung und Dateikanäle sind lokal durch Tests verifiziert. Eine vollständige erfolgreiche Übertragung mit einem originalen, vom Benutzer bereitgestellten Commodore-KERNAL-ROM ist derzeit **nicht nachgewiesen**. Deshalb ist die Kompatibilität mit beliebigen LOAD-/SAVE-Programmen nicht bestätigt. Das IEC-Protokoll verwendet in Teilen ein vereinfachtes Timing- und EOI-Modell.

## Start

Im entpackten Projektverzeichnis:

```sh
python3 -m http.server 8000
```

Die Anwendung befindet sich unter `http://localhost:8000/`, der Test-Runner unter `http://localhost:8000/tests/`.

Optionaler automatisierter Testlauf mit Node.js ohne zusätzliche Pakete:

```sh
node --experimental-default-type=module js/tests/run-node.mjs
node js/tests/run-worklet-node.mjs
```

## Dateiverwaltung im Browser

1. Unter **Virtuelles IEC-Laufwerk – Gerät 8** eine `.prg`-Datei oder einen `.c64b64`-Container auswählen und **Dateien importieren** ausführen.
2. Alternativ legt **Beispiel-PRGs einlegen** die Projektdateien `examples/IECDEMO.prg` (BASIC-Zeile `10 PRINT "IEC DEVICE 8"`) und `examples/BORDER.prg` (Maschinencode bei `$C500`) auf Gerät 8 ab. Mit `LOAD"BORDER",8,1` und anschließend `SYS 50432` kann das zweite Beispiel die Rahmenfarbe über einen echten 6510-Registerzugriff ändern, sobald die KERNAL-Kommunikation funktioniert.
3. Die Dateiliste zeigt die gespeicherten PRGs samt Dateigröße und zweiby­tiger Ladeadresse. Das virtuelle Laufwerk verwendet die Namen ohne `.prg`-Endung und maximal 16 Zeichen, Groß-/Kleinschreibung wird vereinheitlicht.
4. Bei Bedarf eine einzelne Datei mit **PRG exportieren** oder sämtliche virtuellen Dateien mit **Alle als Base64 exportieren** sichern.
5. Originale `basic.rom` (8192 Byte), `kernal.rom` (8192 Byte) und `chargen.rom` (4096 Byte) im ROM-Bereich bereitstellen und den regulären C64-Start verwenden. Diese ROMs liegen dem Projekt nicht bei.
6. Bei funktionierender ROM-/IEC-Kommunikation kann BASIC über echte KERNAL-Routinen Befehle wie `LOAD"NAME",8`, `LOAD"NAME",8,1`, `SAVE"NAME",8` oder `LOAD"$",8` ausführen.

**KERNAL-LOAD-Diagnose** erzeugt bei `$C000` ein echtes 6510-Maschinenprogramm, das die KERNAL-Einsprungadressen `$FFBA` (SETLFS), `$FFBD` (SETNAM) und `$FFD5` (LOAD) über `JSR` verwendet. **KERNAL-SAVE-Diagnose** nutzt `$FFD8` (SAVE), um 16 vorbereitete Bytes bei `$C300` zu speichern. Beide Funktionen erfordern die ROM-Dateien; sie umgehen die emulierten Leitungen nicht. Das Ergebnis der KERNAL-Rückkehr steht bei `$C220/$C221`. Diese Diagnosen ersetzen keinen erfolgreichen Test mit Original-ROMs.

## Neue Module

| Datei | Verantwortung |
| --- | --- |
| `js/storage/PRGLoader.js` | PRG-Parsing und Serialisierung einschließlich zweiby­tiger Little-Endian-Adresse |
| `js/storage/Base64Codec.js` | Binär-/Base64-Konvertierung und versionierter JSON-Container `c64-base64-v1` |
| `js/storage/FileManager.js` | Virtueller Dateikatalog, PRG-Import, Base64-Import, Browser-Blob-Export, Platzhalternamen |
| `js/storage/VirtualDrive1541.js` | IEC-Gerät 8, Talker-/Listener-Zustände, Dateikanäle, Kommandos, Directory-PRG und DOS-Status |
| `js/io/IECBus.js` | Gemeinsame aktive-low-Leitungen, mehrere Teilnehmer, Gerätetakte und Bus-Reset |
| `js/tests/storage.test.js` | PRG-, Base64-, Dateinamen- und Dateikatalog-Regressionstests |
| `js/tests/iec.test.js` | IEC-Leitungen, Kommandos, DATA-Kanäle, Laden, Speichern, Hardwarezugriffe und Timing |
| `js/tests/run-kernal-iec.mjs` | Optionaler Integrationstest mit vom Benutzer bereitgestellten Original-ROM-Dateien |

Die vorhandenen Dateien `js/core/C64.js`, `js/main.js`, `index.html`, `js/tests/runner.js`, `js/tests/run-node.mjs` und die Architekturdokumentation wurden erweitert.

## IEC-Verdrahtung

| CIA-2-Adresse | Anschluss | Aktivität |
| --- | --- | --- |
| `$DD00`, PA3 | IEC ATN OUT | CIA-Ausgang 1 zieht IEC-Leitung niedrig |
| `$DD00`, PA4 | IEC CLOCK OUT | CIA-Ausgang 1 zieht IEC-Leitung niedrig |
| `$DD00`, PA5 | IEC DATA OUT | CIA-Ausgang 1 zieht IEC-Leitung niedrig |
| `$DD00`, PA6 | IEC CLOCK IN | Eingangsbit zeigt tatsächlichen Leitungspegel |
| `$DD00`, PA7 | IEC DATA IN | Eingangsbit zeigt tatsächlichen Leitungspegel |
| `$DD02` | DDRA | Konfiguriert die Ausgangsbits |

Diese Zuordnung korrigiert die abweichende PA2-/PA3-/PA4-Ausgangsbelegung aus M6. Die IEC-Leitungen sind offen-kollektorartig aufgelöst: Jeder Teilnehmer kann die Leitung niedrig ziehen; ohne Treiber ist sie hoch. Das CIA-2-VIC-Bank-Banking auf PA0/PA1 bleibt davon unabhängig.

Der zentrale `C64.step()` ruft `IECBus.tick()` je emuliertem CPU-Takt auf. Gerät 8 verarbeitet auf dem Bus dekodierte Sekundäradressen, Kommandos und seriell empfangene Nutzdaten. Der Talker erzeugt selbst CLOCK- und DATA-Leitungsänderungen. PRG-Header werden an den C64 übergeben und nicht bereits beim Import aus dem PRG entfernt.

## Gerät 8 und unterstützte Funktionen

- IEC-Kommandogruppen LISTEN, TALK, UNLISTEN, UNTALK, OPEN, CLOSE und DATA einschließlich Sekundärkanalnummern.
- Dateikanäle zum Lesen, Schreiben und für DOS-Status, einschließlich Sekundäradresse 0 und 1.
- PRG-Daten mit zwei Ladeadressbytes; die Interpretation der LOAD-Sekundäradresse verbleibt beim KERNAL.
- Dateiname mit `*` und `?`, Großschreibung und optionalem `0:`-Präfix.
- `@` zum Überschreiben, wenn der Schreibkanal geöffnet wird.
- `LOAD"$",8`-Daten in Form eines verketteten BASIC-Directory-PRG.
- DOS-Statuskanal 15, `I`, `UJ`, `S:name` und `R:neu=alt` in vereinfachter Form.
- Binärer PRG-Dateikatalog bleibt beim C64-Reset erhalten; offene Kanäle werden zurückgesetzt.

`VirtualDrive1541` ist ein **protokollorientiertes Softwarelaufwerk**, keine echte MOS-6502-/6522-VIA-/GCR-Emulation. D64, relative Dateien, vollständige DOS-Kommandos und Kopierschutz sind nicht Bestandteil dieses Meilensteins.

## Base64-Containerformat

Ein exportierter Container verwendet die folgende Struktur:

```json
{
  "format": "c64-base64-v1",
  "files": [
    {
      "name": "DEMO",
      "type": "prg",
      "encoding": "base64",
      "data": "AQg="
    }
  ]
}
```

`data` enthält alle PRG-Dateibytes einschließlich Ladeadresse. Die Base64-Importfunktion validiert Struktur, Dateityp und PRG-Länge, bevor Dateien in den virtuellen Katalog übernommen werden.

## Referenztest mit eigenen Original-ROMs

Mit lokal vorliegenden ROM-Dateien kann der optionale Test so gestartet werden:

```sh
node --experimental-default-type=module js/tests/run-kernal-iec.mjs rom/basic.rom rom/kernal.rom rom/chargen.rom
```

Alternativ kann als viertes Argument der Pfad einer PRG-Datei übergeben werden. Der Test führt ausschließlich emulierte CPU- und IEC-Zyklen aus, prüft den übertragenen PRG-Inhalt im RAM und zeigt die KERNAL-Rückgabewerte. Ohne diese ROMs wird kein erfolgreicher Original-KERNAL-Test behauptet.

## Tests und Genauigkeitsgrenzen

Der aktuelle lokale Node.js-Regressionslauf umfasst **229 von 229 bestandenen Tests (M7-Ausgangsstand)** einschließlich M0–M6. M7 ergänzt PRG-/Base64-Tests, physische IEC-Kanten, den bitseriellen SAVE-/TALK-Datenfluss, CIA-2-Pinmapping und ein vom 6510 selbst erzeugtes IEC-Kommando.

Die Tests bestätigen weder vollständiges 1541-Serientiming noch EOI-/Turnaround-Randfälle, sämtliche KERNAL-LOAD/SAVE-Varianten oder den echten Firefox-Datei-/Audiogerätebetrieb. Das Statusregister und die Kommandoverarbeitung des virtuellen DOS sind auf die oben angegebenen Funktionen beschränkt. Die noch nicht extern geprüften CPU-, VIC-, Sprite-, CIA- und SID-Eigenschaften aus M0–M6 behalten ihre dokumentierten Einschränkungen.

Der HTML-, CSS- und JavaScript-Quellcode enthält keine Kommentare.

---

## M8 – Reproduzierbare Hardware-Referenzverifikation

M8 ergänzt einen maschinenlesbaren Referenztest-Runner, reproduzierbare CPU-Bustraces, VIC-Rasterprüfungen und einen optionalen, gestuften Original-ROM-Integrationstest. Der alte M7-Testbestand bleibt erhalten. Ein Test, dessen Original-ROM oder externes Testabbild fehlt, wird als `skipped` beziehungsweise `error` behandelt, niemals als bestandene Hardwareverifikation.

### Lokale Regression und Referenz-Fallbeispiele

```sh
node --experimental-default-type=module js/tests/run-node.mjs
node js/tests/run-m8.mjs --report reports/m8-local.json
node js/tests/run-worklet-node.mjs
```

Die lokalen manifestgesteuerten Prüffälle stehen in `tests/references/local-m8.json` und verwenden das Format `c64-reference-v1`. Sie umfassen RMW-Dummy-Writes, absolute X-Seitenwechsel, RDY-Lesezyklen, Raster-IRQ und PAL-Frameabschlüsse. Die erwarteten Buszugriffe sind Takt für Takt angegeben. `js/verification/ReferenceHarness.js` prüft unter anderem CPU-Register, RAM, VIC-Register, Interruptleitungen und zeitlich geordnete Busereignisse. CRC32 über den Farbindex-Framebuffer dient optional als reproduzierbarer Pixelvergleich, nicht als Ersatz für tatsächliche Hardwarebilder.

`js/tests/m8.test.js` enthält zusätzlich Negativtests des Prüfverfahrens, einen 64-KiB-Testabbild-Loader, einen Test des Bootstatus ohne ROMs, einen Sprite-Prioritätsregressionstest und Tests für den Erhalt eines gebooteten C64-Hardwarezustands beim Installieren von KERNAL-Diagnosecode.

### Original-ROM-Start sowie LOAD und SAVE

Die drei Original-ROMs müssen unverändert und mit folgenden Dateinamen in `rom/` bereitgestellt werden:

- `basic.rom`: 8192 Byte
- `kernal.rom`: 8192 Byte
- `chargen.rom`: 4096 Byte

Danach ausführen:

```sh
node js/tests/run-m8-kernal.mjs --rom-dir rom --report reports/m8-rom.json
```

Der Test verifiziert zunächst, ob die Zeichenketten `COMMODORE` und `READY.` durch tatsächliche 6510-ROM-Ausführung im Screen-RAM stehen und der VIC einen Frame abgeschlossen hat. Erst nach diesem Nachweis werden zwei weitere frisch gestartete C64-Systeme für die KERNAL-Routinen vorbereitet. Die LOAD-Diagnose erwartet bei Gerät 8 und Sekundäradresse 1 ein PRG bei `$2000`; die SAVE-Diagnose erwartet die vollständige PRG-Datei mit Ladeadresse `$C300` und 16 Nutzdatenbytes. Dabei müssen IEC-Kommandos tatsächlich über den emulierten Bus laufen. Nur die bestandenen Einzelfälle dürfen als Original-ROM-Verifikation gemeldet werden.

Die Tests rufen keine im Emulator implementierte Sonderbehandlung von LOAD oder SAVE auf. Die vorbereiteten Diagnoseprogramme verwenden die originalen KERNAL-Einsprünge `SETLFS`, `SETNAM`, `LOAD` und `SAVE`. Der Modus `{ preserveSystem: true }` bewahrt den zuvor gebooteten RAM-, CIA- und VIC-Zustand und vermeidet einen künstlichen RESET unmittelbar vor dem KERNAL-Aufruf.

Fehlen ROM-Dateien, wird der vollständige Integrationstest sauber als **übersprungen** protokolliert. Die ROM-Dateien werden aus rechtlichen und reproduzierbaren Gründen nicht mit dem Projektarchiv ausgeliefert. Das M8-Projekt behauptet ohne sie weder einen erfolgreichen Original-BASIC-Start noch kompatible KERNAL-LOAD-/SAVE-Übertragung.

### Externe CPU-Testabbilder

Ein Beispielmanifest für ein lokal bereitgestelltes vollständiges 64-KiB-Testabbild steht unter `tests/references/example-external-6502.json`. Diese CPU-Referenz verwendet `hardware: "cpu6502"` und damit denselben mikrozyklischen CPU-Kern mit flachem 64-KiB-Speicher ohne die C64-Sonderregister `$0000/$0001`. Für C64-spezifische Integrationstests bleibt `hardware: "c64"` verfügbar. Das Binärabbild ist nicht enthalten. Das Manifest kann mit folgendem Befehl ausgeführt werden:

```sh
node js/tests/run-m8.mjs --manifest tests/references/example-external-6502.json --report reports/m8-external.json
```

Größe und SHA-256 der tatsächlich geladenen externen Testabbilder werden im JSON-Bericht erfasst. Die eingetragenen Start- und Erfolgspunkte sind mit der konkreten Version des bereitgestellten Referenztests abzugleichen. Der Runner fordert einen stabilen Erfolgs-PC über mehrere abgeschlossene Instruktionen. Ein erreichter Erfolgs-PC beweist nur den Umfang dieses konkreten Testprogramms; die Takt- und Dummy-Busgenauigkeit wird unabhängig durch Bustraces geprüft. Selbst deklarierte externe Quellen werden zunächst als `external-candidate` klassifiziert, nicht als anderweitig beglaubigte Hardwaremessung.

### In M8 durchgeführte gezielte Korrekturen

- Die Sprite-Pixelmischung behandelt die Hintergrundpriorität jetzt pro Spritekanal, statt die Darstellbarkeit aller überlappenden Sprites ausschließlich vom zuerst gefundenen Kanal abhängig zu machen. Sprite-Sprite- und Sprite-Grafik-Kollisionen bleiben unabhängig davon sichtbar. Die exakte Originalhardwareausgabe ist noch extern zu prüfen.
- Die KERNAL-Dateidiagnose kann nach einem tatsächlichen ROM-Boot ausgeführt werden, ohne vorher den vollständigen Hardwarezustand zurückzusetzen.
- Der neue Referenz-Runner interpretiert Hexwerte aus JSON beim CPU-Start als Zahlen und meldet ungültige Register- und Bildgrößen als Fehler.

### Nicht nachgewiesene M8-Abnahmebedingungen

Ohne vom Benutzer bereitgestellte Original-ROMs und externe CPU-/VIC-II-Testabbilder bleiben der echte KERNAL-/BASIC-Boot, vollständige KERNAL-IEC-Kompatibilität, externe NMOS-CPU-Busverifikation, genaue 6569-Phasen-/Badline-/Sprite-DMA-Timingdaten und die grafische Firefox-Laufzeitprüfung **offen**. Die bisherigen dokumentierten M0–M7-Näherungen bleiben bestehen. Dies ist ein implementierter Referenzprüfrahmen mit lokalen Regressionen, keine Erklärung vollständiger C64-Hardwarekompatibilität.
