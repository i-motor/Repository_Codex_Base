import { test, assertEqual, assertTrue, assertBytes, assertThrows } from './harness.js';
import { PRGLoader } from '../storage/PRGLoader.js';
import { Base64Codec } from '../storage/Base64Codec.js';
import { FileManager } from '../storage/FileManager.js';

function samplePRG(address = 0x0801, data = [0x10, 0x20, 0x30]) {
  return PRGLoader.serialize(address, Uint8Array.from(data));
}

test('M7 PRG: Zweibyte-Ladeadresse ist Little-Endian', () => {
  const result = PRGLoader.parse(Uint8Array.from([0x01, 0x08, 0x10, 0x20]));
  assertEqual(result.loadAddress, 0x0801);
  assertEqual(result.endAddress, 0x0803);
  assertBytes(result.data, [0x10, 0x20]);
});

test('M7 PRG: Serialisierung bewahrt Adresse und Daten einschließlich Nullbytes', () => {
  const data = Uint8Array.from([0, 255, 32, 0, 128]);
  const packed = PRGLoader.serialize(0xc000, data);
  assertBytes(packed, [0, 0xc0, ...data]);
  assertBytes(PRGLoader.parse(packed).data, data);
});

test('M7 PRG: leeres Programm mit gültigem Header ist zulässig', () => {
  assertEqual(PRGLoader.parse(Uint8Array.from([1, 8])).data.length, 0);
});

test('M7 PRG: fehlerhafte und überlange Dateien werden abgewiesen', () => {
  assertThrows(() => PRGLoader.parse(new Uint8Array([0])), RangeError);
  assertThrows(() => PRGLoader.parse(new Uint8Array(65539)), RangeError);
  assertThrows(() => PRGLoader.serialize(-1, new Uint8Array()), RangeError);
  assertThrows(() => PRGLoader.serialize(0, new Uint8Array(65537)), RangeError);
});

test('M7 Base64: alle 256 Bytewerte bleiben unverändert', () => {
  const source = Uint8Array.from({ length: 256 }, (_, i) => i);
  assertBytes(Base64Codec.decode(Base64Codec.encode(source)), source);
});

test('M7 Base64: größere PRG-Datei wird ohne Stacküberlauf übertragen', () => {
  const source = Uint8Array.from({ length: 50000 }, (_, i) => i & 255);
  assertBytes(Base64Codec.decode(Base64Codec.encode(source)), source);
});

test('M7 Base64: leere Daten und Padding werden korrekt behandelt', () => {
  assertEqual(Base64Codec.encode(new Uint8Array()), '');
  assertBytes(Base64Codec.decode('AA=='), [0]);
  assertBytes(Base64Codec.decode('AQI='), [1, 2]);
});

test('M7 Base64: ungültige Kodierungen werden abgewiesen', () => {
  assertThrows(() => Base64Codec.decode('AAAA!'), TypeError);
  assertThrows(() => Base64Codec.decode('A==='), TypeError);
  assertThrows(() => Base64Codec.decode('ABC'), TypeError);
});

test('M7 Container: JSON importiert und exportiert PRG bytegenau', () => {
  const files = [{ name: 'DEMO', type: 'prg', data: samplePRG() }, { name: 'MACHINE', type: 'prg', data: samplePRG(0xc000) }];
  const result = Base64Codec.importContainer(Base64Codec.exportContainer(files));
  assertEqual(result.length, 2);
  assertEqual(result[1].name, 'MACHINE');
  assertBytes(result[0].data, files[0].data);
});

test('M7 Container: unbekannte Version, fehlende und falsche Felder abgewiesen', () => {
  assertThrows(() => Base64Codec.importContainer('{"format":"v2","files":[]}'), TypeError);
  assertThrows(() => Base64Codec.importContainer('{"format":"c64-base64-v1","files":[{"name":"X","encoding":"base64","type":"prg","data":"AA=="}]}'), RangeError);
  assertThrows(() => Base64Codec.importContainer('{"format":"c64-base64-v1","files":null}'), TypeError);
});

test('M7 FileManager: PRG-Dateikatalog mit maximal 16 Zeichen', () => {
  const files = new FileManager();
  files.store('demo', samplePRG());
  assertEqual(files.list()[0].name, 'DEMO');
  assertEqual(files.get('DEMO').loadAddress, undefined);
  assertEqual(files.list()[0].loadAddress, 0x0801);
  assertThrows(() => files.store('SEHRLANGERDATEINAME', samplePRG()), RangeError);
});

test('M7 FileManager: Rückgabe einer Datei ist eine unabhängige Kopie', () => {
  const files = new FileManager();
  files.store('DEMO', samplePRG());
  files.get('DEMO').data[2] = 0xff;
  assertEqual(files.get('DEMO').data[2], 0x10);
});

test('M7 FileManager: Überschreiben verlangt ausdrückliche Freigabe', () => {
  const files = new FileManager();
  files.store('DEMO', samplePRG());
  assertThrows(() => files.store('demo', samplePRG(0x2000)));
  files.store('demo', samplePRG(0x2000), { overwrite: true });
  assertEqual(files.list()[0].loadAddress, 0x2000);
});

test('M7 FileManager: Platzhalter * und ? finden passende Dateinamen', () => {
  const files = new FileManager();
  files.store('ABC', samplePRG());
  files.store('ACDE', samplePRG());
  assertEqual(files.match('A*C').name, 'ABC');
  assertEqual(files.match('A?DE').name, 'ACDE');
  assertEqual(files.match('Z*'), null);
});

test('M7 FileManager: Umbenennen und Entfernen aktualisieren den Katalog', () => {
  const files = new FileManager();
  files.store('ABC', samplePRG());
  files.rename('ABC', 'XYZ');
  assertEqual(files.get('ABC'), null);
  assertEqual(files.get('xyz').name, 'XYZ');
  assertTrue(files.remove('XYZ'));
  assertEqual(files.list().length, 0);
});

test('M7 FileManager: einzelne Browser-PRG-Dateien werden asynchron importiert', async () => {
  const files = new FileManager();
  const source = samplePRG();
  await files.importFile({ name: 'Demo.prg', arrayBuffer: async () => source.buffer });
  assertBytes(files.exportPRG('DEMO').data, source);
});

test('M7 FileManager: JSON-Containerimport prüft doppelte Namen atomar', () => {
  const files = new FileManager();
  const container = Base64Codec.exportContainer([{ name: 'x', type: 'prg', data: samplePRG() }, { name: 'X', type: 'prg', data: samplePRG() }]);
  assertThrows(() => files.importContainer(container));
  assertEqual(files.list().length, 0);
});

test('M7 FileManager: Base64-Container wird aus Katalogdaten erzeugt', () => {
  const files = new FileManager();
  files.store('DEMO', samplePRG());
  const exported = files.exportContainer();
  const restored = new FileManager();
  restored.importContainer(exported);
  assertBytes(restored.get('DEMO').data, files.get('DEMO').data);
});

test('M7 FileManager: nicht unterstützte Browserdateien werden abgewiesen', async () => {
  const files = new FileManager();
  let caught = false;
  try { await files.importFile({ name: 'text.txt' }); } catch (error) { caught = error instanceof RangeError; }
  assertTrue(caught);
});
