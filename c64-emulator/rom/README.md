# ROM-Dateien

Der Emulator führt BASIC V2 und KERNAL aus den originalen ROM-Abbildern aus. Die Dateien
sind urheberrechtlich geschützt und werden nicht mitgeliefert. Lege sie hier ab:

| Datei | Größe | Inhalt | CRC32 (bekannte Revision) |
|---|---|---|---|
| `basic.rom` | 8192 Bytes | BASIC V2, $A000–$BFFF | `f833d117` (901226-01) |
| `kernal.rom` | 8192 Bytes | KERNAL, $E000–$FFFF | `dbe3e7c7` (901227-03), `a5c687b3` (-02), `dce782fa` (-01) |
| `chargen.rom` | 4096 Bytes | Zeichensatz | `ec4272ee` (901225-01) |

Abweichende Prüfsummen werden akzeptiert, solange die Größe stimmt (z. B. modifizierte
KERNAL-Versionen); der Emulator meldet sie dann als „unbekannte Revision“.

Bezugsquellen: Auslesen eines eigenen C64 oder rechtmäßig erworbene Abbilder.

## Freie Alternative

Die [MEGA65 Open ROMs](https://github.com/MEGA65/open-roms) (LGPL-3) sind eine freie
Neuimplementierung von KERNAL und BASIC. Sie booten im Emulator, unterstützen Laden und
Speichern über Laufwerk 8, sind aber unvollständig (z. B. fehlen Teile der
Fließkomma-Arithmetik). Zur Verwendung `kernal_generic.rom`, `basic_generic.rom` und
`chargen_openroms.rom` als `kernal.rom`, `basic.rom` und `chargen.rom` hier ablegen.

Dateien in diesem Verzeichnis mit der Endung `.rom` oder `.bin` sind über `.gitignore` von
der Versionsverwaltung ausgeschlossen.
