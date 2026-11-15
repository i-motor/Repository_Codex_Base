# Architektur und Modulverträge – M7

## Systemkern

`C64` verbindet `Clock`, `CPU6510`, `CPU6510Microcode`, `MemoryBus`, `ProcessorPort6510`, `InterruptController`, `BusSignals`, `BusArbiter`, die beiden `CIA6526`, `VICMemory`, `VICII`, `SID6581` und `SIDResampler`. Alle Hardwarekomponenten laufen in der zentralen emulierten Taktbasis. Browserzugriffe liegen ausschließlich in `main.js`, den Browser-Eingabemodulen und `CanvasRenderer`.

Die echte MOS-6510-CPU ist der reguläre Maschinencode-Ausführungspfad. Die Kernhardware kommuniziert über die bestehenden Speicher-, Register-, Signal- und Interruptschnittstellen. Die Ausführung des originalen BASIC-V2-ROMs ist Teil dieses CPU-Pfads, kein separater Interpreter.

## Videomodule und Schnittstellen

| Modul | Schnittstelle / Aufgabe |
| --- | --- |
| `video/VideoTiming.js` | `position(cycle)`, `isBadline(...)`, `busRequest(raster,cycleInLine,scrollY,denLatched,spriteRequest)`; PAL-Position, Badline- und zusammengefasster VIC-Busbedarf |
| `video/VICMemory.js` | `getBankBase()`, `read(address14)`, `readColor(index)`; getrennte VIC-Bank und Zeichensatz-ROM-Abbildung |
| `video/CharacterGenerator.js` | `mode(...)`, `dataAddress(...)`, `colorForPixel(state)`, `isForeground(mode,bits,bit,color)`; Pixel und Vordergrundmaske |
| `video/SpriteEngine.js` | `reset()`, `beginCycle(cycle)`, `finishCycle(cycle,grant)`, `busRequest(line,cycle)`, `mixPixel(x,raster,foreground,color,showSprites)`, `readCollision(which)`, `getState()` |
| `video/VICII.js` | `beginCycle(cycle)`, `completeBusCycle(grant)`, `renderCycle()`, `readRegister(reg)`, `writeRegister(reg,value)`, `peekRegister(reg)`, `latchIRQ(bit)`, `getFrame()`, `getState()` |
| `video/CanvasRenderer.js` | `resize()`, `present(frame)`, `setIntegerScaling(enabled)`; alleinige sichtbare Canvas-Ausgabe |

`SpriteEngine` besitzt eigene Pointer, Sprite-Zeilendaten, Datenzeilen-Tags, DMA-Zustände, Kollisions-Latches und Zähler. RAM wird ausschließlich über die injizierte `VICMemory`-Instanz gelesen. Hardwareinterrupts werden durch die `VICII`-IRQ-Latch-Schnittstelle ausgelöst.

## Register und Effekte

| Register | Wirkung |
| --- | --- |
| `$D000–$D00F` | Acht X-/Y-Registerpaare |
| `$D010` | Neuntes X-Bit je Sprite |
| `$D015` | Sprite-Enable |
| `$D017` | Y-Verdopplung |
| `$D01B` | Hintergrundpriorität |
| `$D01C` | Sprite-Multicolor |
| `$D01D` | X-Verdopplung |
| `$D01E` | Sprite-Sprite-Kollision; CPU-Lesen löscht Latch |
| `$D01F` | Sprite-Hintergrund-Kollision; CPU-Lesen löscht Latch |
| `$D025/$D026` | Gemeinsame Sprite-Multicolor-Farben |
| `$D027–$D02E` | Individuelle Sprite-Farben |
| `$D018` | Aktive Bildschirmbasis und damit Sprite-Pointer-Tabelle |
| `$D019` | VIC-Interruptstatus; Schreiben gesetzter Bits quittiert entsprechende Quellen |
| `$D01A` | VIC-Interrupt-Masken |

`MemoryBus` dekodiert `$D000–$D3FF` mit 64-Byte-Spiegelung. Beobachtendes `peekRegister()` verändert keine Kollisions-Latches. Schreibzugriffe auf die read-only Register `$D01E` und `$D01F` werden ignoriert. Die fest eingestellte Vordergrundreihenfolge bevorzugt Kanal 0 vor 1 bis 7. Sprites hinter opaken Grafikvordergrundpixeln werden verborgen, erzeugen aber weiterhin Kollisionen.

## Sprite-Speicherpfad

Jeder Sprite-Pointer wird an `(screenBase + $3F8 + spriteIndex) & $3FFF` aus der VIC-Speichersicht gelesen. Der Pointer wählt einen 64-Byte-Block an `pointer * 64` innerhalb der aktuellen 16-KB-VIC-Bank. Jede Sprite-Datenzeile enthält drei Byte, für 21 Zeilen insgesamt 63 Datenbytes. Bei Y-Verdopplung verwendet die aktuelle Näherung dieselbe logische Zeile zweimal.

Der Datenpfad ist `VICMemory → SpriteEngine-Pointer-/Datenregister → Pixelmischung → VICII-Framebuffer → CanvasRenderer`. Alle acht Kanäle können innerhalb derselben Rasterzeile Daten bereitstellen. Ein X-MSB erlaubt Positionen bis 511; X-Verdopplung vergrößert die Breite auf 48 Pixel, Y-Verdopplung die Höhe auf 42 Pixel.

Bei Mehrfarben-Sprites ist die Zweibitgruppe `00` transparent, `01` verwendet `$D025`, `10` die individuelle Spritefarbe und `11` `$D026`. Jede Multicolor-Gruppe besitzt zwei Ausgangspixel; mit horizontaler Verdopplung vier.

## Gemeinsamer PAL-Takt und Busarbitrierung

Die emulierte PAL-Taktbasis enthält 312 Rasterzeilen mit je 63 CPU-Takten und je acht Dot-Positionen. Die Ausführung eines `C64.step()` verarbeitet die Eingangsereignisse, VIC-Beginn und Φ1-Datenzugriffe, BA/AEC/RDY-Arbitrierung, einen CPU-Busmikrozyklus beziehungsweise VIC-Φ2-DMA, VIC-Pixelmischung, CIA-Timer und Interruptsignale.

Das M5-DMA-Modell verteilt vier Sprite-Slot-Ereignisse auf zwei CPU-Takte: Pointer in Φ1, Datenbyte 0 in Φ2, Datenbyte 1 in der nächsten Φ1-Phase und Datenbyte 2 in der nächsten Φ2-Phase. Die definierten **nullbasierten** Slotstartzyklen sind `(54 + 2 * spriteIndex) % 63` und können die Rastergrenze überschreiten. Späte Slots laden Daten für die nächste Rasterzeile; frühe Slots laden Daten für die laufende Rasterzeile. Dieses Modell ist reproduzierbar, aber seine exakte elektrische 6569-Zeitposition ist **nicht hardwareverifiziert**.

Für aktive Sprite-Transfers wird der benötigte Φ2-Buszyklus über `SpriteEngine.busRequest()` angefordert. `VideoTiming.busRequest()` kombiniert diese Anforderung mit den vorhandenen Badline-Steals. BA wird im modellierten Zeitraum bereits drei CPU-Takte vor der ersten benötigten Φ2-Busphase aktiv. Bei AEC-low gehört der CPU-Bus dem VIC; RDY hält CPU-Lesezyklen an, während CPU-Schreibzyklen gemäß den bestehenden Busregeln nicht allein durch RDY verloren gehen dürfen. CIAs laufen auch während des CPU-Stalls weiter.

M5 implementiert kein transistorgenaues Verhalten der 6569-MC-/MCBASE-Register, der vertikalen Expansion-Flipflops, Sprite-Crunching-Sonderfälle oder aller Border-Opening-Tricks. Die internen DMA-Zähler sind eine aus der aktuellen Zeilenposition abgeleitete funktionale Näherung. Eine eigene Validierung durch echte 6569-Testprogramme bleibt notwendig.

## Rastergrafik und Sprite-Kollisionen

`VICII.renderCycle()` verarbeitet die sichtbaren acht Dots eines CPU-Takts. Der `CharacterGenerator` liefert Farbindex und eine Vordergrund-/Hintergrundentscheidung. Die `SpriteEngine` prüft transparente und opake Sprite-Pixel, wählt den höchstpriorisierten sichtbaren Spritekanal und aktualisiert die Kollisions-Latches.

Überschneiden sich mindestens zwei opake Sprite-Pixel, werden alle beteiligten Kanäle in `$D01E` gesetzt und die VIC-IRQ-Quelle 2 (`$D019` Bit 2) gelatcht. Trifft ein opakes Sprite-Pixel auf Grafikvordergrund, wird sein Bit in `$D01F` gesetzt und die VIC-IRQ-Quelle 1 (`$D019` Bit 1) gelatcht. Lesezugriffe löschen nur die jeweiligen Kollisions-Latches, nicht automatisch die IRQ-Quellen. Quellen werden über `$D019` unabhängig quittiert und über `$D01A` maskiert. Ein weiter bestehender Überlappungszustand kann nach erneutem Latchsetzen weitere Interrupts erzeugen.

Sprite-Registeränderungen wirken auf folgende Pixelausgabepositionen. Bereits abgeholte Sprite-Daten werden nicht rückwirkend durch späteres `$D018`-Schreiben verändert. Bestimmte Spezialfälle beim exakten Dot-Latch und bei Border-Freigaben bleiben Näherungen.

## Canvas, ROMs und Diagnose

Der Framebuffer ist ein doppelter `Uint8Array`-Puffer mit 404 × 284 Farbindizes einschließlich Border. Das sichtbare HTML5-Canvas wird mit ImageData, deaktivierter Interpolation und proportionaler Skalierung aktualisiert. `requestAnimationFrame` steuert nur die Darstellung fertig berechneter Frames.

`C64.loadSpriteDemo()` installiert 2.759 Byte 6510-Maschinencode, der die Pointer, Sprite-Daten und Register über echte CPU-Schreibzyklen einrichtet. Die Demo lädt keine ROMs und erzeugt keine direkt gezeichnete Schein-Grafik.

Für den originalen ROM-Start müssen `basic.rom`, `kernal.rom` und `chargen.rom` vom Benutzer geladen werden. Der zusätzliche ROM-Test wird ohne diese Dateien nicht als erfolgreich gewertet.

## Verifikation und verbleibende Meilensteine

M7 enthält 228 lokal bestandene Tests einschließlich PRG-, Base64- und IEC-Tests. Externe 6569-/6581-Referenztests, ein bestätigter BASIC-V2-Originalstart, ein echter KERNAL-LOAD/SAVE-Test und ein praktischer Firefox-Audiotest bleiben offen. ROM-Banking, CPU, CIA und sämtliche bisherigen Grafik-/Sprite-Tests bleiben als Regressionstests erhalten.

## M6 – SID- und Audioarchitektur

### SID-Registerpfad

`C64` erzeugt `SID6581` mit dem PAL-Taktprofil und registriert das Gerät im vorhandenen `MemoryBus` unter dem Gerätebezeichner `sid`. Das Mapping `$D400–$D7FF` spiegelt die untersten fünf Adressbits. Das tatsächliche CPU-I/O-Banking über den 6510-Port bleibt unverändert. `cpuRead()` und `cpuWrite()` können die SID-Lese-/Schreibzustände ändern; `peekRegister()` darf keine Register-Seiteneffekte haben.

`SID6581.writeRegister(reg,value)` hält ein eigenes 32-Byte-Registerarray. Die Register `$00–$14` werden je sieben Registern auf eine von drei `SIDVoice`-Instanzen abgebildet. `$15–$18` konfigurieren Cutoff, Routing, Resonanz, Filtermodus und Masterlautstärke. POTX/POTY, OSC3 und ENV3 sind als lesbare Register realisiert. Schreib-only-Register geben ein zeitlich begrenztes, vereinfachtes SID-Datenbuslatch zurück.

### Digitale Stimme

`SIDVoice` enthält `frequency`, `pulseWidth`, `control`, einen 24-Bit-Phasenakkumulator und einen 23-Bit-Noise-LFSR. In jedem CPU-Master-Zyklus erhöht der Frequenzwert den Akkumulator modulo 2^24. Aus den oberen Phasenbits werden Dreieck, Sägezahn, Puls und Rauschen erzeugt. Der LFSR wird bei steigender Flanke des Oszillator-Bits 19 fortgeschaltet. Ringmodulation verwendet das Quell-MSB, und ein Quell-MSB-Übergang kann im Sync-Modus die Zielphase zurücksetzen. Die Modulatorverkettung ist Stimme 3 → 1, 1 → 2 und 2 → 3.

`SIDEnvelope` besitzt eine eigene ADSR-Zustandsmaschine mit 15-Bit-Ratecounter, 16 dokumentierten Perioden, exponentiellem Decay-/Release-Teiler und Sustain-Pegel. Es gibt kein separates JavaScript-Musiksystem. SID-Wellenform und ADSR-Zustand sind ausschließliche Folgen des emulierten Zeitverlaufs und der Registerwerte.

### Filter

`SIDFilter` verarbeitet die drei Stimmensignale mit einem numerischen Zustandsvariablenfilter. Routing erfolgt durch `$D417`, Filtermodus/Voice-3-Off/Volume durch `$D418`. Cutoff und Resonanz beeinflussen die Koeffizienten. Die Auswahl `6581` oder `8580` ändert den angenäherten Cutoff-Verlauf; beide Profile sind nicht analog vermessen und nicht modellgenau zu bewerten.

### Zeit- und Audiofluss

Pro `C64.step()` wird nach CPU- und VIC-Busoperationen sowie CIA-Timerfortschaltung genau ein `SID6581.tick()` ausgeführt. Anschließend wird der Samplewert an `SIDResampler.pushCycle()` übergeben. `Clock.tick()` erhöht den gemeinsamen Emulationszähler erst nach dem SID-Takt. Damit verläuft die Oszillatorzeit unabhängig davon, ob ein AudioWorklet gestartet oder ein Canvas-Frame angezeigt wurde.

Die numerische Resamplingphase wächst pro Master-Zyklus um die Browser-Samplerate; die Schwelle ist die emulierte CPU-Taktfrequenz. Ein Ausgangssample enthält die anteilig gewichtete Summe der SID-Zykluswerte, die in das entsprechende Sampleintervall fallen. Die zeitliche Menge der generierten Samples ist deshalb unabhängig von Browser-Timern. `SIDResampler` verwendet einen vorallokierten `Float32Array`-Ringpuffer und meldet Überläufe.

`AudioEngine` erstellt nach Browserbenutzeraktion einen nativen `AudioContext`, lädt `SIDWorklet.js` per `audioWorklet.addModule()` und verbindet einen `AudioWorkletNode` mit der Geräteausgabe. Der Hauptthread sendet ausschließlich fertig erzeugte `Float32Array`-Blöcke über `MessagePort`. `SIDWorklet` liest diese Blöcke in der Echtzeit-`process()`-Funktion und füllt zwei Ausgabekanäle mit identischen PCM-Werten. Das Worklet führt keinerlei C64-Emulationszyklen aus.

`AudioEngine` führt Session-IDs für Reset und Fortschrittsmeldungen, sodass veraltete Statistiken nach einem Audio-Neustart nicht die neue FIFO-Berechnung verfälschen. Unterläufe erzeugen Stille und werden gezählt; sie führen nicht zu künstlicher Beschleunigung oder Verlangsamung der emulierten CPU-/SID-Zeitbasis.

### Audio-/Video-Verhältnis

Bei aktivem Ton liest `main.js` die vom Worklet gemeldete Anzahl tatsächlich verbrauchter PCM-Samples. Der Emulator berechnet so viele zusätzliche Master-Zyklen, dass ein konfigurierbarer Zielvorlauf von etwa 170 ms erhalten bleibt. `requestAnimationFrame` steuert weiterhin nur die Canvas-Präsentation.

Ein beim VIC-Frameabschluss ausgelöster optionaler `C64.onFrame`-Callback erhält eine Kopie des fertig berechneten Farbindex-Framebuffers mit dem emulierten Zykluszeitstempel. Der UI-Layer verwaltet eine begrenzte Queue. Die Präsentationszeit wird näherungsweise als `audioEpochCycle + consumedSamples * cpuHz / sampleRate` berechnet. Nur Frames mit einem Zeitstempel kleiner oder gleich dieser Zeit werden angezeigt. Bei aussetzendem Rendering werden ältere fertige Frames übersprungen, ohne emulierte Hardwarezyklen zu überspringen.

Das Verfahren synchronisiert die Präsentation zum Rückmeldestand des Audiothreads, aber die Worklet-Telemetrie erfolgt blockweise. Eine samplegenaue Synchronität mit dem tatsächlichen DAC-Zeitpunkt, einschließlich Audio-Geräteausgabelatenz, ist nicht nachgewiesen.

### Abnahmetests und offene Referenzverifikation

- SID-Registermapping, Spiegelung, CPU-I/O-Banking und ROM-unabhängiger `STA`-Dreiklang.
- 24-Bit-Oszillatoren, Dreieck, Sägezahn, Puls, Noise-LFSR, Sync, Ring und TEST.
- ADSR-Ratentabelle, Zustandswechsel, Sustain, Release, Ratecounter-Fortlauf und Zero-Hold.
- SID-Lese- und Buslatchregister, Filterrouting, Mastervolume und Cutoff.
- PCM-Samplezahl, Resampling-Gewichtung, Ringpufferüberlauf und Browser-API-Mocks.
- Separater Node-VM-Test der AudioWorklet-Queue einschließlich Unterlauf, Stereo und Reset.
- TIC-genau abgestempelte VIC-Framebuffer-Kopien für browserseitige Präsentationssynchronität.

Erfolgreiche lokale Tests belegen diese konkret geprüften Funktionen. Externe Hardwaretest-Suiten für den 6581, tatsächliche Audioqualität und Firefox-Audioausgabe sind noch nicht bestätigt.

## M7 – Virtueller IEC-Bus und Gerät 8

### Datenmodell

`FileManager` besitzt einen vollständig getrennten virtuellen Katalog aus `Uint8Array`-PRG-Dateien. Die zweiby­tige Little-Endian-Ladeadresse ist Bestandteil jedes Eintrags. `PRGLoader.parse(source)` extrahiert diese Adresse und liefert eine Kopie der Programmdaten; `PRGLoader.serialize(address,data)` erzeugt das PRG-Format. Die Daten werden ohne Direktzugriff auf das emulierte RAM importiert, exportiert oder als `c64-base64-v1`-Container kodiert. Der native Browserdialog transportiert ausschließlich Dateien vom Host in den Laufwerkskatalog und zurück.

### IEC-Hardwareleitungen

`IECBus` besitzt die aktiven-low Leitungen `ATN`, `CLOCK`, `DATA`, `SRQ` und `RESET`. `drive(source,line,low)` fügt einen aktiven Low-Treiber hinzu beziehungsweise entfernt ihn; `sample(line)` liefert den aufgelösten physischen High-Pegel. `attachDevice(device)`, `detachDevice(device)`, `tick(cycle)`, `reset()` und `snapshot()` sind die öffentlichen Verwaltungsschnittstellen. Pro `C64.step()` wird nach dem CPU-Buszugriff `IEC.tick(cycle)` aufgerufen. Gerät 8 kann damit nur zu einer eindeutig bekannten emulierten Zyklusposition auf Signale reagieren.

CIA 2 Port A verwendet PA3 für ATN OUT, PA4 für CLOCK OUT und PA5 für DATA OUT. Aufgrund der invertierenden Treiber zieht ein als Ausgang konfiguriertes gesetztes CIA-Latchbit die entsprechende Busleitung Low. PA6/PA7 liefern CLOCK IN beziehungsweise DATA IN zurück. Die Port-A-Register liegen auf `$DD00`, das Datenrichtungsregister auf `$DD02`. Das bisherige M6-Prototypmapping mit PA2/PA3/PA4 wurde korrigiert. VIC-Bankbits PA0/PA1 bleiben unabhängig.

### Virtuelles Laufwerk

`VirtualDrive1541` implementiert `reset()`, `tick(cycle)`, `receiveByte(value,attention)`, `receiveCommand(value)`, `openChannel(number,name,mode)`, `readChannel(number)`, `writeChannel(number,byte)`, `closeChannel(number)`, `executeDOSCommand(text)`, `directoryPRG()` und `getState()`. Die internen Bytefunktionen sind Ergebnis der Leitungsdekodierung; sie stellen keinen BASIC-Befehlspfad und keine direkte KERNAL-Emulation dar. Sie sind zusätzlich für reproduzierbare Protokoll-Unit-Tests zugänglich.

Bei niedrigem ATN werden die Kommandobytes LISTEN/TALK/UNLISTEN/UNTALK, OPEN/CLOSE und DATA erkannt. Die Nutzdatenbytes werden LSB-first auf CLOCK-Flanken aus DATA gelesen. Der ACK-Zustand und der Beginn des Transfers werden mit emulierten Zyklen approximiert. Beim TALK wechselt Gerät 8 in die Senderrolle und treibt CLOCK/DATA selbst, einschließlich eines vereinfachten EOI-Vorlaufs für das letzte Byte. Kanal- und Dateinamenauswahl bleiben unabhängig von CPU-Register- und BASIC-Syntax.

Die Wahl zwischen einem Lese- und einem Schreibkanal wird beim ersten tatsächlichen TALK-/LISTEN-Datenzugriff aufgelöst. Sekundäradresse 1 wird dadurch nicht pauschal zum Schreibkanal, da die KERNAL-LOAD-Semantik für `$xx,8,1` von der Save-Kanalverwendung abweicht. Bei LOAD enthält der gesendete Datenstrom weiterhin die beiden ursprünglichen PRG-Ladeadressbytes. Der KERNAL entscheidet selbst, an welcher RAM-Adresse die Programmdaten abgelegt werden.

### Kommandos und Fehlerstatus

Gerätekommando `0x20 | deviceNumber` startet LISTEN, `0x40 | deviceNumber` TALK, `0x3F` UNLISTEN und `0x5F` UNTALK. `0xF0 | channel` öffnet, `0xE0 | channel` schließt und `0x60 | channel` wählt einen Datenkanal. Kanal 15 führt vereinfachte DOS-Status- und Dateiverwaltungskommandos aus. Die Dateitypen außerhalb von PRG, gerätespezifische Spezialkommandos und echte D64-Sektorbefehle sind nicht implementiert.

`directoryPRG()` liefert eine BASIC-V2-Zeilenverkettung mit Startadresse `$0801`. Dateien werden unter normalisierten Namen geführt, Wildcards `*`/`?` werden unterstützt; zum Überschreiben dient ein führendes `@`. Beim Zurücksetzen des C64 werden offene Kanäle geschlossen, aber die virtuelle Diskette bleibt eingehängt.

### Original-ROM-Integration

`C64.installKernalFileDemo(action,name,secondary)` erstellt zur Diagnose 6510-Maschinencode bei `$C000`. Der Code führt `JSR $FFBA` für SETLFS, `JSR $FFBD` für SETNAM und anschließend `JSR $FFD5` für LOAD oder `JSR $FFD8` für SAVE aus. Das Ergebnis wird nach `$C220/$C221` geschrieben. Es existiert kein Dateisystem-Kurzschluss in der CPU. Dateiübertragungen müssen vom KERNAL aus über die emulierte CIA-/IEC-Hardware stattfinden. Der optionale `run-kernal-iec.mjs` verifiziert diesen Pfad nur, wenn echte ROM-Dateien lokal vorliegen.

### Tests und verbleibende Timingfragen

Die isolierten Tests decken Dateiübernahme, Base64-Roundtrip, PRG-Ladeadresse, Filename-Wildcards, Dateikanäle, DOS-Status, IEC-Kommandos, Bitdekodierung, Byteübertragung, CIA-2-Pinmapping, echte CPU-STA-Leitungsänderungen und komplette bitserielle SAVE-Datenströme ab. Ohne echte KERNAL-ROM-Dateien ist damit **nicht** belegt, dass sämtliche originalen KERNAL-Handshakes, ATN-Turnaround-Phasen, ACK-Zeiten und EOI-Signale kompatibel sind. Diese Punkte bilden den wichtigsten offenen Kompatibilitätsblock innerhalb M7; vollständige 1541-CPU-/VIA-/Diskettenmechanik bleibt ein späteres Ziel.

---

## M8 – Verifikation und Fehlereingrenzung

### Referenzarchitektur

`js/verification/ReferenceHarness.js` stellt `verifyScenario(scenario,options)`, `verifyManifest(manifest,options)`, `findScreenText(machine,text)` und `crc32(data)` bereit. Die Funktionen enthalten keine Node-spezifischen Imports und lassen sich deshalb im Browser und in Node.js verwenden. Binärdateien und Original-ROMs werden als optionale, injizierte Abhängigkeiten bereitgestellt.

Jedes `c64-reference-v1`-Szenario definiert `setup`, `run`, `expect` und eine eindeutige `id`. Unterstützte Prüfpunkte sind CPU-Zustände, RAM-/Registerwerte, VIC-/Clock-Zustände, Interruptleitungen, Screen-RAM-Zeichenketten, Framebuffer-CRC32 und zyklengenau ausgewählte Busereignisse. Externe CPU-Speicherabbilder müssen genau 65536 Byte enthalten. Der Runner bietet CPU-Schrittzahlbegrenzung, Stopp bei JAM und eine stabile PC-Erfolgsbedingung für Testschleifen. Fehlerhafte Erwartungen werden explizit als Testfehler gemeldet.

`js/tests/run-m8.mjs` führt lokale und durch Benutzerdateien ergänzte Referenzmanifeste aus und schreibt optionale JSON-Berichte mit den Einzelstatus `passed`, `failed`, `skipped` und `error`. Fehlende externe Referenzdateien werden nicht automatisch durch generierte Ersatzergebnisse ersetzt. `js/tests/run-m8-kernal.mjs` prüft den vollständigen ROM-Boot als Vorbedingung und startet danach getrennte KERNAL-LOAD- und SAVE-Integrationsfälle. Die tatsächlich verwendeten ROM-SHA-256-Werte werden im Bericht protokolliert.

### Hardwarekorrekturen

Die Sprite-Mischentscheidung wurde pro sichtbarem Kanal getrennt von den Kollisions-Latches umgesetzt. Ein Sprite, das durch seine eigene Hintergrundpriorität verdeckt wird, verhindert nicht pauschal die Darstellung anderer, nicht verdeckter Sprite-Pixel. Die Kollisionsprüfung zählt weiterhin alle im selben Pixel aktiven Spritekanäle.

`C64.installKernalFileDemo(...)` bietet die zusätzliche Option `preserveSystem`. Damit dürfen vorbereitete CPU-Diagnoseprogramme nach einem regulären Boot in RAM eingebracht werden, ohne CIA-Timer und VIC-Zustand zu löschen. Die `CPU6510`-Ausführung bleibt der einzige Pfad für den KERNAL-Aufruf; der virtuelle IEC-Bus wird nicht umgangen.

### Verifikationsstatus

Lokale Testfixtures sind keine externe Bestätigung. Eigene Diagnose-ROMs, synthetische Maschinenprogramme und selbst definierte Bildschirmmuster können nur Regressionen und die spezifizierten lokalen Erwartungen bestätigen. Erst wenn passende Original-ROM-Dateien, externe CPU-Funktionstests und nachvollziehbare VIC-II-Timing- bzw. Bildreferenzen tatsächlich ausgeführt und verglichen wurden, darf der Status der jeweiligen Teilfunktion auf `extern bestätigt` gesetzt werden.

### CPU-Referenzbus

`js/verification/CPUReferenceMachine.js` koppelt die bestehende MOS-6510-Mikrocode-CPU für reine 6502-Funktionstests an ein lineares 64-KiB-RAM und eine eigene monoton steigende Testuhr. Hierbei gibt es ausdrücklich keine VIC-Busdiebstähle, C64-I/O-Adressen oder 6510-Portregister. Das ist für externe 6502-Testabbilder notwendig, die auch die Zero-Page-Adressen `$0000/$0001` als normales RAM verwenden. C64-Hardwaretests benutzen weiterhin den unveränderten vollständigen Maschinenbus. `run-reference.mjs` wurde für reine CPU-Referenztests ebenfalls auf den linearen Bus umgestellt.

---

## M9 – Erweiterte Hardwarearchitektur

### D64-Datenschicht

`D64Image` dekodiert 35- und 40-Track-D64-Abbilder mit 256-Byte-Sektoren und optionaler Sektorfehler-Bytefolge. Es besitzt eigene BAM-, Directory- und PRG-Kettenoperationen. Der virtuelle IEC-Endpunkt `VirtualDrive1541` kann daraus PRG-Dateien als Kanal-0/1-Lesedaten anbieten und durch IEC-SAVE gespeicherte Daten in die gemountete D64 schreiben. Beim Export werden zusätzlich importierte PRG-Einträge in das Abbild synchronisiert. Das Speicherformat ist von der C64-CPU getrennt; ein `LOAD` wird nicht durch BASIC-Textinterpretation erkannt.

Das D64-Backend modelliert Dateiblöcke, aber keine analogen Diskettenflussübergänge. Der GCR-Hardwarepfad wird in einer separaten 1541-Komponente implementiert. Nicht reguläre Diskettenimages, Kopierschutz und 40-Track-BAM-Erweiterungen sind nicht vollständig realisiert.

### Eigenständige 1541-Taktinsel

`Drive1541` enthält 2 KiB RAM, ein ROM-Array mit 16/32 KiB, einen 6502-Mikrozykluskern, zwei VIA 6522 und den Mechanismus-/GCR-Lesepfad. Die C64-Hauptuhr liefert bei aktivem Hardwaremodus die vergangene Zeit über ein rationales Taktverhältnis; die Laufwerks-CPU wird nicht als 1:1-CPU-Taktklon betrieben. IRQs beider VIAs werden im Laufwerk an dessen eigenen InterruptController angeschlossen. IEC-Leitungen werden über `IECBus` physisch aufgelöst.

Der experimentelle Hardwaremodus wird nur nach Laden eines 1541-ROMs aktiviert und ersetzt die bisherige virtuelle IEC-Geräteinstanz. Die isolierten VIA-Grundtests und die Ausführung synthetischen Laufwerks-ROM-Codes liefern **keinen** Nachweis einer vollständig arbeitenden Commodore-1541-Firmware. Insbesondere unvollständige VIA-Shift-/Handshake- und GCR-Schreibfunktionen verhindern die Einstufung als vollständige 1541-Emulation.

### NTSC und SID-Modellwahl

Der Master-Clock akzeptiert `PAL_PROFILE` (312 × 63) oder `NTSC_PROFILE` für den MOS 6567R8 (263 × 65). `VideoTiming` erhält den Profilparameter samt getrenntem sichtbarem Rasterausschnitt; der CanvasRenderer erhält die passende Framebuffergeometrie. Die CIA-TOD-Impulse werden profilabhängig als 50/60-Hz-Taktimpulse erzeugt. Bei Umschaltung wird die emulierte Maschine kontrolliert zurückgesetzt. Der SID-Takt und PCM-Resampler werden auf die neue CPU-Taktfrequenz eingestellt.

Der SID nutzt dieselben drei digitalen Stimmen und Registeradressen, aber getrennte analoge Filter-Näherungen für 6581 und 8580. Die tatsächlich gemessenen Filterkennlinien und Digital-/Analog-Randfälle sind nicht referenzbestätigt. Das NTSC-Timing enthält bisher rasterprofilgenaue Taktzahlen, aber keine vollständig extern bestätigte 6567R8-Bus- und Border-Pipeline.

### Browser-Eingaben und Worker

`Gamepad` liest die native Gamepad API und wandelt analoge und digitale Richtungen in geordnete `InputQueue`-Ereignisse für CIA-1-Joystickkontakte um. `WorkerRunner` und `EmulatorWorker` stellen einen eigenständigen Emulator mit id-basiertem RPC für ROM-, Programm-, Takt-, Framebuffer-, PCM- und D64-Operationen bereit. Der Worker wird im Browser als echtes ES6-Modul geladen. Er ersetzt nicht die laufende Hauptthread-Emulation; eine sichere Übertragung des vollständigen Zustands der Echtzeitmaschine zwischen Threads ist bislang nicht Bestandteil von M9.

### M9-Tests und Validierungsstatus

Separate Tests prüfen D64 und GCR, eigene 6502- und VIA-Register/Zyklen, Sprite-/NTSC-Raster, beide SID-Filtermodelle, Gamepad-Eingangskontakte, das Worker-Protokoll und tatsächliche Worker-Ausführung. Ein byteweiser PAL-Framebuffer-Vergleich schützt die bestehenden PAL-Funktionen. `run-m9.mjs` erstellt Einzelberichte, die lokale Spezifikationsprüfungen (`local-specification`), real ausgeführte Worker-Integration (`node-worker-integration`) und externe, nur bei bereitgestellten Originaldaten mögliche Testfälle unterscheiden. Fehlende Dateien ergeben `skipped`, nicht `passed`.

Die aus M8 noch fehlenden Original-ROM- und Hardware-Referenztests sind weiterhin offen. Daher ist die endgültige M9-Kompatibilitätsabnahme **nicht vollständig erreicht**.
