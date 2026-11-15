# Originale C64-ROMs

In diesem Verzeichnis können die vom Benutzer bereitgestellten Dateien `basic.rom` (8192 Byte), `kernal.rom` (8192 Byte) und `chargen.rom` (4096 Byte) liegen.

Alternativ können sie in Firefox über die Dateiauswahl der Anwendung geladen werden. Die Emulation führt den KERNAL-RESET-Vektor und den BASIC-V2-Code über die echte 6510-CPU aus und verwendet den VIC-II zur Ausgabe der Bildschirm- und Zeichendaten.

Die ROM-Dateien werden nicht mitgeliefert. Der originale ROM-Start wurde mangels bereitgestellter ROM-Dateien noch nicht mit dieser M6-Version bestätigt.

## M9-Laufwerks-ROM und externe Referenzdaten

Optional kann `1541.rom` mit 16384 oder 32768 Bytes lokal bereitgestellt werden. Das Laufwerks-ROM wird nicht mitgeliefert. Im Browser kann es über das 1541-ROM-Eingabefeld geladen werden; der experimentelle Hardwaremodus ist erst danach aktivierbar. Der ROM-Start im Hardwaremodell ist noch nicht gleichbedeutend mit vollständiger DOS- oder IEC-Kompatibilität.

`reference.d64` kann optional als externes Testabbild bereitgestellt werden. Für den manuellen D64-Test enthält das Projekt eine selbst erzeugte Beispieldiskette `examples/M9-DEMO.d64` mit den vorhandenen Beispiel-PRGs. Die Referenztestdaten des Benutzers bleiben in seinem lokalen Verzeichnis und werden nicht in das ZIP übernommen.
