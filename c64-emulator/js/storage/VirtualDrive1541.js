import { FileManager } from './FileManager.js';
import { D64Image } from './D64Image.js';

const STATUS = Object.freeze({
  OK: '00, OK,00,00\r', NOT_FOUND: '62, FILE NOT FOUND,00,00\r',
  EXISTS: '63, FILE EXISTS,00,00\r', CHANNEL: '70, NO CHANNEL,00,00\r',
  SYNTAX: '30, SYNTAX ERROR,00,00\r', READY: '73, CBM DOS V2.6 1541,00,00\r'
});

function encodeText(text) {
  return Uint8Array.from(text, character => character.charCodeAt(0) & 255);
}

function decodeText(bytes) {
  return Array.from(bytes, byte => String.fromCharCode(byte === 0xa0 ? 32 : byte)).join('').trim();
}

export class VirtualDrive1541 {
  constructor(bus, files = new FileManager(), deviceNumber = 8) {
    if (!Number.isInteger(deviceNumber) || deviceNumber < 4 || deviceNumber > 30) throw new RangeError('Ungültige IEC-Geräteadresse');
    this.bus = bus;
    this.files = files;
    this.deviceNumber = deviceNumber;
    this.events = [];
    this.diskImage = null;
    this.reset();
    bus.attachDevice(this);
  }

  mountD64(source) {
    const image = source instanceof D64Image ? source : new D64Image(source);
    const entries = image.listDirectory();
    const loaded = [];
    for (const entry of entries) {
      if (entry.type !== 'PRG') continue;
      const bytes = image.readPRG(entry.name);
      if (bytes.length < 2) continue;
      loaded.push({ name: entry.name, bytes });
    }
    for (const entry of this.files.list()) this.files.remove(entry.name);
    for (const entry of loaded) this.files.store(entry.name, entry.bytes);
    this.diskImage = image;
    this.reset();
    return loaded.length;
  }

  exportD64() {
    if (!this.diskImage) throw new Error('Kein D64-Abbild eingelegt');
    for (const file of this.files.list()) {
      const stored = this.files.get(file.name).data;
      const existing = this.diskImage.listDirectory().find(entry => entry.name === file.name && entry.type === 'PRG');
      const old = existing ? this.diskImage.readPRG(file.name) : null;
      if (old && old.length === stored.length && old.every((byte, i) => byte === stored[i])) continue;
      this.diskImage.writePRG(file.name, stored, { overwrite: true });
    }
    return this.diskImage.exportImage();
  }

  log(type, value) {
    if (this.events.length >= 256) this.events.shift();
    this.events.push({ cycle: this.bus.cycle, type, value });
  }

  reset() {
    this.channels = new Map();
    this.channels.set(15, { mode: 'status', data: encodeText(STATUS.READY), offset: 0 });
    this.status = STATUS.READY;
    this.listenSelected = false;
    this.talkSelected = false;
    this.activeChannel = 0;
    this.command = 'none';
    this.nameBytes = [];
    this.rxBits = 0;
    this.rxValue = 0;
    this.ackUntil = -1;
    this.attentionUntil = -1;
    this.tx = null;
    this.lastATN = this.bus.sample('ATN');
    this.lastCLOCK = this.bus.sample('CLOCK');
    this.lastRESET = this.bus.sample('RESET');
    this.bus.drive(`drive${this.deviceNumber}`, 'CLOCK', false);
    this.bus.drive(`drive${this.deviceNumber}`, 'DATA', false);
  }

  setStatus(code) {
    this.status = STATUS[code] ?? STATUS.SYNTAX;
    const channel = this.channels.get(15);
    if (channel) {
      channel.data = encodeText(this.status);
      channel.offset = 0;
    }
  }

  openChannel(number, name, mode = 'read') {
    if (!Number.isInteger(number) || number < 0 || number > 15) throw new RangeError('Ungültiger IEC-Kanal');
    if (number === 15) {
      this.channels.set(15, { mode: 'status', data: encodeText(this.status), offset: 0 });
      return true;
    }
    const requested = String(name ?? '').trim();
    const overwrite = requested.startsWith('@');
    const raw = (overwrite ? requested.slice(1) : requested).replace(/^0:/, '').split(',')[0].replace(/^:/, '');
    const filename = raw || '*';
    if (mode === 'write' || /,W(?:,|$)/i.test(requested)) {
      this.channels.set(number, { mode: 'write', name: filename, overwrite, bytes: [] });
      this.setStatus('OK');
      return true;
    }
    if (filename.startsWith('$')) {
      this.channels.set(number, { mode: 'read', name: filename, data: this.directoryPRG(), offset: 0 });
      this.setStatus('OK');
      return true;
    }
    const file = this.files.match(filename);
    if (!file) {
      this.channels.delete(number);
      this.setStatus('NOT_FOUND');
      return false;
    }
    this.channels.set(number, { mode: 'read', name: file.name, data: file.data, offset: 0 });
    this.setStatus('OK');
    return true;
  }

  closeChannel(number) {
    const channel = this.channels.get(number);
    if (!channel) return false;
    if (channel.mode === 'write') {
      try {
        const bytes = Uint8Array.from(channel.bytes);
        if (this.diskImage) this.diskImage.writePRG(channel.name, bytes, { overwrite: channel.overwrite });
        this.files.store(channel.name, bytes, { overwrite: channel.overwrite });
        this.setStatus('OK');
        this.log('saved', channel.name);
      } catch (error) {
        if (error.message === 'FILE EXISTS') this.setStatus('EXISTS');
        else this.setStatus('SYNTAX');
      }
    }
    if (number !== 15) this.channels.delete(number);
    return true;
  }

  writeChannel(number, byte) {
    const channel = this.channels.get(number);
    if (!channel) {
      this.setStatus('CHANNEL');
      return false;
    }
    if (number === 15) {
      if (!channel.commands) channel.commands = [];
      if (byte === 13) {
        this.executeDOSCommand(decodeText(channel.commands));
        channel.commands.length = 0;
      } else channel.commands.push(byte & 255);
      return true;
    }
    if (channel.mode === 'pending') {
      this.openChannel(number, channel.name, 'write');
      return this.writeChannel(number, byte);
    }
    if (channel.mode !== 'write') {
      this.setStatus('SYNTAX');
      return false;
    }
    if (channel.bytes.length >= 65538) {
      this.setStatus('SYNTAX');
      return false;
    }
    channel.bytes.push(byte & 255);
    return true;
  }

  readChannel(number) {
    let channel = this.channels.get(number);
    if (!channel && number === 0) {
      this.openChannel(0, '*');
      channel = this.channels.get(0);
    }
    if (channel?.mode === 'pending') {
      this.openChannel(number, channel.name, 'read');
      channel = this.channels.get(number);
    }
    if (!channel || !channel.data) {
      this.setStatus('CHANNEL');
      return null;
    }
    if (channel.offset >= channel.data.length) return null;
    const value = channel.data[channel.offset++];
    return { value, eoi: channel.offset === channel.data.length };
  }

  executeDOSCommand(command) {
    const text = String(command).trim().toUpperCase();
    if (text === 'I' || text === 'UJ') {
      this.setStatus('OK');
      return;
    }
    if (text.startsWith('S:')) {
      const file = this.files.match(text.slice(2));
      if (!file) this.setStatus('NOT_FOUND');
      else {
        this.files.remove(file.name);
        this.setStatus('OK');
      }
      return;
    }
    if (text.startsWith('R:')) {
      const parts = text.slice(2).split('=');
      try {
        if (parts.length !== 2) throw new Error('SYNTAX');
        this.files.rename(parts[1], parts[0]);
        this.setStatus('OK');
      } catch (error) {
        this.setStatus(error.message === 'FILE EXISTS' ? 'EXISTS' : error.message === 'FILE NOT FOUND' ? 'NOT_FOUND' : 'SYNTAX');
      }
      return;
    }
    this.setStatus('SYNTAX');
  }

  directoryPRG() {
    const diskName = this.diskImage?.getDiskName() ?? 'VIRTUAL DISK';
    const lines = [{ number: 0, text: `0 \"${diskName}\" 00 2A` }];
    for (const entry of this.files.list()) {
      const blocks = Math.max(1, Math.ceil(entry.size / 254));
      lines.push({ number: blocks, text: `\"${entry.name.padEnd(16)}\" PRG` });
    }
    lines.push({ number: this.diskImage?.freeBlocks() ?? 664, text: 'BLOCKS FREE.' });
    const bytes = [1, 8];
    let address = 0x0801;
    for (const line of lines) {
      const body = [...encodeText(line.text)];
      const next = address + 2 + 2 + body.length + 1;
      bytes.push(next & 255, next >>> 8, line.number & 255, line.number >>> 8, ...body, 0);
      address = next;
    }
    bytes.push(0, 0);
    return Uint8Array.from(bytes);
  }

  finishName() {
    if (this.command !== 'name') return;
    const name = decodeText(this.nameBytes);
    if (this.activeChannel === 15) {
      this.openChannel(15, name);
      if (name) this.executeDOSCommand(name);
    }
    else this.channels.set(this.activeChannel, { mode: 'pending', name });
    this.log('open', `${this.activeChannel}:${name}`);
    this.nameBytes = [];
    this.command = 'none';
  }

  receiveCommand(value) {
    this.log('command', value);
    if (value === 0x3f) {
      this.finishName();
      this.listenSelected = false;
      this.command = 'none';
      return;
    }
    if (value === 0x5f) {
      this.talkSelected = false;
      this.tx = null;
      this.command = 'none';
      return;
    }
    if ((value & 0xe0) === 0x20) {
      this.finishName();
      this.listenSelected = (value & 31) === this.deviceNumber;
      this.talkSelected = false;
      this.command = 'none';
      return;
    }
    if ((value & 0xe0) === 0x40) {
      this.finishName();
      this.talkSelected = (value & 31) === this.deviceNumber;
      this.listenSelected = false;
      this.command = 'none';
      return;
    }
    if (!this.listenSelected && !this.talkSelected) return;
    const channel = value & 15;
    this.activeChannel = channel;
    if ((value & 0xf0) === 0xf0 && this.listenSelected) {
      this.finishName();
      this.command = 'name';
      this.nameBytes = [];
    } else if ((value & 0xf0) === 0xe0 && this.listenSelected) {
      this.finishName();
      this.closeChannel(channel);
      this.command = 'none';
    } else if ((value & 0xf0) === 0x60) {
      this.finishName();
      this.command = this.listenSelected ? 'data-in' : 'data-out';
    }
  }

  receiveByte(value, attention = false) {
    if (attention) {
      this.receiveCommand(value);
      return;
    }
    if (!this.listenSelected) return;
    if (this.command === 'name') this.nameBytes.push(value);
    else if (this.command === 'data-in') this.writeChannel(this.activeChannel, value);
    else if (this.activeChannel === 15) this.writeChannel(15, value);
    this.log('rx', value);
  }

  beginTransmit(cycle) {
    const channel = this.channels.get(this.activeChannel);
    if (!channel && this.activeChannel === 0) this.openChannel(0, '*');
    let source = this.channels.get(this.activeChannel);
    if (source?.mode === 'pending') {
      this.openChannel(this.activeChannel, source.name, 'read');
      source = this.channels.get(this.activeChannel);
    }
    if (!source?.data) return;
    this.tx = { state: 'ready', until: cycle + 70, byte: null, bit: 0, eoi: false, ackSeen: false };
    this.log('talk', this.activeChannel);
  }

  transmit(cycle) {
    const tx = this.tx;
    const source = `drive${this.deviceNumber}`;
    if (!tx) return;
    if (tx.state === 'ready') {
      if (cycle < tx.until || !this.bus.sample('ATN') || !this.bus.sample('CLOCK')) return;
      const next = this.readChannel(this.activeChannel);
      if (!next) {
        tx.state = 'complete';
        return;
      }
      tx.byte = next.value;
      tx.eoi = next.eoi;
      tx.bit = 0;
      tx.until = cycle + (next.eoi ? 260 : 35);
      tx.state = 'low';
    }
    if (tx.state === 'low') {
      this.bus.drive(source, 'CLOCK', true);
      this.bus.drive(source, 'DATA', !(tx.byte & (1 << tx.bit)));
      if (cycle >= tx.until) {
        this.bus.drive(source, 'CLOCK', false);
        tx.until = cycle + 45;
        tx.state = 'high';
      }
      return;
    }
    if (tx.state === 'high') {
      if (cycle < tx.until) return;
      this.bus.drive(source, 'CLOCK', true);
      tx.bit += 1;
      if (tx.bit === 8) {
        this.bus.drive(source, 'DATA', false);
        tx.until = cycle + 120;
        tx.state = 'ack';
      } else {
        tx.until = cycle + 45;
        tx.state = 'low';
      }
      return;
    }
    if (tx.state === 'ack') {
      if (!this.bus.sample('DATA')) tx.ackSeen = true;
      if (!tx.ackSeen && cycle < tx.until) return;
      if (tx.eoi) {
        tx.state = 'complete';
        this.bus.drive(source, 'CLOCK', false);
      } else {
        const next = this.readChannel(this.activeChannel);
        if (!next) {
          tx.state = 'complete';
          this.bus.drive(source, 'CLOCK', false);
        } else {
          tx.byte = next.value;
          tx.eoi = next.eoi;
          tx.bit = 0;
          tx.state = 'low';
          tx.until = cycle + (next.eoi ? 260 : 45);
        }
      }
      return;
    }
    if (tx.state === 'complete') {
      this.bus.drive(source, 'CLOCK', false);
      this.bus.drive(source, 'DATA', false);
    }
  }

  tick(cycle) {
    const attention = this.bus.sample('ATN');
    const clock = this.bus.sample('CLOCK');
    const reset = this.bus.sample('RESET');
    if (this.lastRESET && !reset) {
      this.reset();
      return;
    }
    if (this.lastATN && !attention) {
      this.finishName();
      this.rxBits = 0;
      this.rxValue = 0;
      this.tx = null;
      this.bus.drive(`drive${this.deviceNumber}`, 'CLOCK', false);
      this.bus.drive(`drive${this.deviceNumber}`, 'DATA', true);
      this.attentionUntil = cycle + 70;
    }
    if (!this.lastATN && attention) {
      this.rxBits = 0;
      this.rxValue = 0;
      this.bus.drive(`drive${this.deviceNumber}`, 'DATA', false);
      if (this.talkSelected && this.command === 'data-out') this.beginTransmit(cycle);
    }
    if (clock && !this.lastCLOCK && !this.tx) {
      const data = this.bus.sample('DATA') ? 1 : 0;
      this.rxValue |= data << this.rxBits;
      this.rxBits += 1;
      if (this.rxBits === 8) {
        this.receiveByte(this.rxValue, !attention);
        this.rxBits = 0;
        this.rxValue = 0;
        this.bus.drive(`drive${this.deviceNumber}`, 'DATA', true);
        this.ackUntil = cycle + 50;
      }
    }
    if (this.attentionUntil >= 0 && cycle >= this.attentionUntil) {
      this.bus.drive(`drive${this.deviceNumber}`, 'DATA', false);
      this.attentionUntil = -1;
    }
    if (this.ackUntil >= 0 && cycle >= this.ackUntil) {
      this.bus.drive(`drive${this.deviceNumber}`, 'DATA', false);
      this.ackUntil = -1;
    }
    if (this.tx && attention) this.transmit(cycle);
    this.lastATN = attention;
    this.lastCLOCK = clock;
    this.lastRESET = reset;
  }

  getState() {
    return { deviceNumber: this.deviceNumber, listening: this.listenSelected, talking: this.talkSelected,
      command: this.command, channel: this.activeChannel, status: this.status.trim(),
      channels: [...this.channels.keys()], files: this.files.list(), disk: this.diskImage?.getDiskName() ?? null, transmissions: this.events.length,
      phase: this.tx?.state ?? 'idle' };
  }
}
