import { DiskDirectory, normalizeName } from './DiskDirectory.js';

const S = Object.freeze({
  IDLE: 0,
  ATN_ACK: 1,
  RX_WAIT_READY: 2,
  RX_READY_DELAY: 3,
  RX_WAIT_START: 4,
  RX_EOI_ACK: 5,
  RX_BITS: 6,
  RX_FRAME_END: 7,
  RX_ACK_DELAY: 8,
  TURN_WAIT_CLK: 9,
  TURN_DELAY: 10,
  TX_WAIT_LISTENER: 11,
  TX_EOI_WAIT_LOW: 12,
  TX_EOI_WAIT_HIGH: 13,
  TX_BITS: 14,
  TX_WAIT_ACK: 15,
  TX_NODATA: 16,
  TX_GAP: 17,
  IGNORE: 18
});

export const DRIVE_STATE = S;

export const IEC_TIMING = Object.freeze({
  atnAck: 10,
  readyForData: 40,
  eoiTimeout: 200,
  eoiHold: 70,
  frameAck: 20,
  turnaround: 20,
  talkStart: 80,
  clkLowBeforeBits: 40,
  dataSetup: 40,
  dataValid: 80,
  dataHold: 40,
  ackTimeout: 1000,
  byteGap: 100,
  releaseAfterIgnore: 100
});

const STATUS_TEXT = {
  0: 'OK',
  1: 'FILES SCRATCHED',
  30: 'SYNTAX ERROR',
  31: 'SYNTAX ERROR',
  32: 'SYNTAX ERROR',
  33: 'SYNTAX ERROR',
  34: 'SYNTAX ERROR',
  60: 'WRITE FILE OPEN',
  61: 'FILE NOT OPEN',
  62: 'FILE NOT FOUND',
  63: 'FILE EXISTS',
  64: 'FILE TYPE MISMATCH',
  70: 'NO CHANNEL',
  72: 'DISK FULL',
  73: 'CBM DOS V2.6 1541',
  74: 'DRIVE NOT READY'
};

function petsciiToString(bytes) {
  let out = '';
  for (const b of bytes) {
    if (b === 0x0d) break;
    if (b >= 0xc1 && b <= 0xda) out += String.fromCharCode(b - 0x80);
    else if (b >= 0x20 && b < 0x80) out += String.fromCharCode(b);
    else if (b === 0xa0) out += ' ';
  }
  return out;
}

function stringToPetscii(text) {
  return Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
}

export function buildDirectoryListing(storage, loadAddress = 0x0401) {
  const lines = [];
  const header = [0x12, 0x22, ...stringToPetscii(storage.diskName.padEnd(16, ' ')), 0x22, 0x20, ...stringToPetscii(`${storage.diskId} ${storage.dosType || '2A'}`)];
  lines.push({ number: 0, text: header });
  for (const file of storage.listFiles()) {
    const blocks = file.blocks;
    const pad = blocks < 10 ? 3 : blocks < 100 ? 2 : 1;
    const quoted = `"${file.name}"`;
    const type = `${file.closed === false ? '*' : ' '}${file.type}${file.locked ? '<' : ' '}`;
    const text = ' '.repeat(pad) + quoted.padEnd(18, ' ') + type;
    lines.push({ number: blocks, text: stringToPetscii(text) });
  }
  lines.push({ number: storage.blocksFree(), text: stringToPetscii('BLOCKS FREE.'.padEnd(25, ' ')) });
  const bytes = [loadAddress & 0xff, loadAddress >> 8];
  let address = loadAddress;
  for (const line of lines) {
    const length = 4 + line.text.length + 1;
    const next = address + length;
    bytes.push(next & 0xff, next >> 8, line.number & 0xff, line.number >> 8, ...line.text, 0);
    address = next;
  }
  bytes.push(0, 0);
  return new Uint8Array(bytes);
}

export class VirtualDrive1541 {
  constructor({ bus, scheduler, deviceNumber = 8, storage = null, timing = IEC_TIMING }) {
    this.bus = bus;
    this.scheduler = scheduler;
    this.deviceNumber = deviceNumber;
    this.timing = timing;
    this.storage = storage || new DiskDirectory();
    this.id = bus.attach(this);
    this.activityListener = null;
    this.log = null;
    this.transferCount = 0;
    this.reset();
  }

  reset() {
    this.cancelTimer();
    this.state = S.IDLE;
    this.clkOut = false;
    this.dataOut = false;
    this.bus.setDeviceLines(this.id, false, false);
    this.prevAtn = this.bus.atn;
    this.prevClk = this.bus.clk;
    this.prevData = this.bus.data;
    this.underAtn = false;
    this.listening = false;
    this.talking = false;
    this.secondary = 0;
    this.openPending = false;
    this.nameBuffer = [];
    this.channels = new Map();
    this.rxValue = 0;
    this.rxBits = 0;
    this.rxEoi = false;
    this.txValue = 0;
    this.txEoi = false;
    this.txBit = 0;
    this.setStatus(73, 0, 0);
  }

  mount(storage) {
    this.storage = storage;
    this.channels.clear();
    this.setStatus(0, 0, 0);
  }

  setStatus(code, track = 0, sector = 0) {
    this.statusCode = code;
    const text = STATUS_TEXT[code] || 'ERROR';
    this.status = `${String(code).padStart(2, '0')},${text},${String(track).padStart(2, '0')},${String(sector).padStart(2, '0')}`;
    this.statusBytes = stringToPetscii(`${this.status}\r`);
  }

  setLines(clk, data) {
    this.clkOut = clk;
    this.dataOut = data;
    this.bus.setDeviceLines(this.id, clk, data);
  }

  cancelTimer() {
    if (this.timer) {
      this.scheduler.cancel(this.timer);
      this.timer = null;
    }
  }

  after(delay, action) {
    this.cancelTimer();
    this.timer = this.scheduler.schedule(delay, () => {
      this.timer = null;
      action();
    });
  }

  activity(active) {
    if (this.activityListener) {
      this.activityListener(active);
    }
  }

  onBusChange(bus) {
    const atn = bus.atn;
    const clk = bus.clk;
    const data = bus.data;
    const atnFell = this.prevAtn && !atn;
    const atnRose = !this.prevAtn && atn;
    const clkFell = this.prevClk && !clk;
    const clkRose = !this.prevClk && clk;
    const dataFell = this.prevData && !data;
    const dataRose = !this.prevData && data;
    this.prevAtn = atn;
    this.prevClk = clk;
    this.prevData = data;
    if (atnFell) {
      this.beginAtn();
      return;
    }
    if (atnRose) {
      this.endAtn();
      return;
    }
    switch (this.state) {
      case S.RX_WAIT_READY:
        if (clk) this.readyForData();
        break;
      case S.RX_WAIT_START:
        if (clkFell) {
          this.cancelTimer();
          this.state = S.RX_BITS;
          this.rxBits = 0;
          this.rxValue = 0;
        }
        break;
      case S.RX_BITS:
        if (clkRose) {
          this.rxValue |= (data ? 1 : 0) << this.rxBits;
          this.rxBits++;
          if (this.rxBits === 8) {
            this.state = S.RX_FRAME_END;
          }
        }
        break;
      case S.RX_FRAME_END:
        if (clkFell) {
          this.state = S.RX_ACK_DELAY;
          this.after(this.timing.frameAck, () => this.acknowledgeByte());
        }
        break;
      case S.TURN_WAIT_CLK:
        if (clk) this.turnaround();
        break;
      case S.TX_WAIT_LISTENER:
        if (data) this.listenerReady();
        break;
      case S.TX_EOI_WAIT_LOW:
        if (dataFell || !data) this.state = S.TX_EOI_WAIT_HIGH;
        break;
      case S.TX_EOI_WAIT_HIGH:
        if (dataRose) {
          this.state = S.TX_BITS;
          this.after(this.timing.clkLowBeforeBits, () => this.startBits());
        }
        break;
      case S.TX_WAIT_ACK:
        if (!data) {
          this.cancelTimer();
          this.byteAcknowledged();
        }
        break;
      default:
        break;
    }
  }

  beginAtn() {
    this.cancelTimer();
    this.underAtn = true;
    this.state = S.ATN_ACK;
    this.activity(true);
    this.setLines(false, this.dataOut);
    this.after(this.timing.atnAck, () => {
      this.setLines(false, true);
      this.state = S.RX_WAIT_READY;
      if (this.bus.clk) {
        this.readyForData();
      }
    });
  }

  endAtn() {
    this.underAtn = false;
    this.cancelTimer();
    if (this.state === S.IGNORE) {
      this.setLines(false, false);
      this.state = S.IDLE;
      this.activity(false);
      return;
    }
    if (this.talking) {
      this.setLines(false, false);
      this.state = S.TURN_WAIT_CLK;
      if (this.bus.clk) {
        this.turnaround();
      }
      return;
    }
    if (this.listening) {
      this.setLines(false, true);
      this.state = S.RX_WAIT_READY;
      if (this.bus.clk) {
        this.readyForData();
      }
      return;
    }
    this.setLines(false, false);
    this.state = S.IDLE;
    this.activity(false);
  }

  readyForData() {
    this.state = S.RX_READY_DELAY;
    this.after(this.timing.readyForData, () => {
      this.setLines(false, false);
      this.rxEoi = false;
      this.state = S.RX_WAIT_START;
      if (!this.bus.clk) {
        this.state = S.RX_BITS;
        this.rxBits = 0;
        this.rxValue = 0;
        return;
      }
      this.after(this.timing.eoiTimeout, () => this.eoiDetected());
    });
  }

  eoiDetected() {
    if (this.state !== S.RX_WAIT_START) {
      return;
    }
    this.rxEoi = true;
    this.state = S.RX_EOI_ACK;
    this.setLines(false, true);
    this.after(this.timing.eoiHold, () => {
      this.setLines(false, false);
      this.state = S.RX_WAIT_START;
    });
  }

  acknowledgeByte() {
    this.transferCount++;
    this.setLines(false, true);
    const value = this.rxValue;
    const eoi = this.rxEoi;
    const wasAtn = this.underAtn;
    if (wasAtn) {
      this.handleCommand(value);
    } else {
      this.handleData(value, eoi);
    }
    if (this.state === S.IGNORE) {
      this.after(this.timing.releaseAfterIgnore, () => this.setLines(false, false));
      return;
    }
    this.state = S.RX_WAIT_READY;
    if (this.bus.clk) {
      this.readyForData();
    }
  }

  handleCommand(value) {
    if (this.log) this.log(`ATN ${value.toString(16)}`);
    const group = value & 0xe0;
    const low = value & 0x1f;
    if (group === 0x20) {
      if (value === 0x3f) {
        this.unlisten();
      } else if (low === this.deviceNumber) {
        this.listening = true;
        this.talking = false;
      } else {
        this.notAddressed();
      }
      return;
    }
    if (group === 0x40) {
      if (value === 0x5f) {
        this.talking = false;
      } else if (low === this.deviceNumber) {
        this.talking = true;
        this.listening = false;
      } else {
        this.notAddressed();
      }
      return;
    }
    if (!this.listening && !this.talking) {
      return;
    }
    const sa = value & 0x0f;
    switch (value & 0xf0) {
      case 0x60:
        this.secondary = sa;
        this.openPending = false;
        break;
      case 0xe0:
        this.secondary = sa;
        this.closeChannel(sa);
        break;
      case 0xf0:
        this.secondary = sa;
        this.openPending = true;
        this.nameBuffer = [];
        break;
      default:
        break;
    }
  }

  notAddressed() {
    this.listening = false;
    this.talking = false;
    this.state = S.IGNORE;
  }

  unlisten() {
    this.listening = false;
    if (this.openPending) {
      this.openPending = false;
      this.openChannel(this.secondary, this.nameBuffer);
      this.nameBuffer = [];
    }
    const command = this.channels.get(15);
    if (command && command.commandBuffer.length) {
      this.executeCommand(petsciiToString(command.commandBuffer));
      command.commandBuffer = [];
    }
  }

  handleData(value) {
    if (this.openPending) {
      this.nameBuffer.push(value);
      return;
    }
    const sa = this.secondary;
    if (sa === 15) {
      const channel = this.ensureCommandChannel();
      channel.commandBuffer.push(value);
      if (value === 0x0d) {
        this.executeCommand(petsciiToString(channel.commandBuffer));
        channel.commandBuffer = [];
      }
      return;
    }
    const channel = this.channels.get(sa);
    if (channel && channel.mode === 'write') {
      channel.buffer.push(value);
    }
  }

  ensureCommandChannel() {
    let channel = this.channels.get(15);
    if (!channel) {
      channel = { mode: 'command', commandBuffer: [] };
      this.channels.set(15, channel);
    }
    return channel;
  }

  parseName(raw) {
    let text = petsciiToString(raw);
    let replace = false;
    if (text.startsWith('@')) {
      replace = true;
      text = text.slice(1);
    }
    const colon = text.indexOf(':');
    if (colon >= 0 && colon <= 2) {
      text = text.slice(colon + 1);
    }
    const parts = text.split(',');
    const name = parts[0];
    let type = null;
    let mode = null;
    for (const part of parts.slice(1)) {
      const p = part.trim().toUpperCase();
      if (p === 'P' || p === 'PRG') type = 'PRG';
      else if (p === 'S' || p === 'SEQ') type = 'SEQ';
      else if (p === 'U' || p === 'USR') type = 'USR';
      else if (p === 'R') mode = 'read';
      else if (p === 'W') mode = 'write';
      else if (p === 'A') mode = 'append';
    }
    return { name, type, mode, replace };
  }

  openChannel(sa, rawName) {
    if (sa === 15) {
      const channel = this.ensureCommandChannel();
      if (rawName.length) {
        this.executeCommand(petsciiToString(rawName));
      }
      return channel;
    }
    const { name, type, mode, replace } = this.parseName(rawName);
    const writing = sa === 1 || mode === 'write';
    if (!writing && name.startsWith('$')) {
      this.channels.set(sa, { mode: 'read', data: buildDirectoryListing(this.storage), pos: 0, name: '$' });
      this.setStatus(0);
      return null;
    }
    if (writing) {
      if (!name) {
        this.setStatus(34);
        return null;
      }
      const exists = this.storage.readFile(name);
      if (exists && !replace && exists.name === normalizeName(name)) {
        this.setStatus(63);
        this.channels.set(sa, { mode: 'error' });
        return null;
      }
      this.channels.set(sa, { mode: 'write', buffer: [], name, type: type || (sa === 1 ? 'PRG' : 'SEQ'), replace: true });
      this.setStatus(0);
      return null;
    }
    const file = this.storage.readFile(name || '*');
    if (!file) {
      this.channels.set(sa, { mode: 'error' });
      this.setStatus(62);
      return null;
    }
    this.channels.set(sa, { mode: 'read', data: file.data, pos: 0, name: file.name });
    this.setStatus(0);
    return null;
  }

  closeChannel(sa) {
    const channel = this.channels.get(sa);
    if (!channel) {
      return;
    }
    if (channel.mode === 'write') {
      try {
        this.storage.writeFile(channel.name, Uint8Array.from(channel.buffer), channel.type, channel.replace);
        this.setStatus(0);
      } catch (error) {
        this.setStatus(72);
      }
    }
    if (sa !== 15) {
      this.channels.delete(sa);
    }
  }

  executeCommand(command) {
    const text = command.replace(/\r$/, '').trim();
    if (!text) {
      return;
    }
    const op = text[0].toUpperCase();
    const argument = text.includes(':') ? text.slice(text.indexOf(':') + 1) : '';
    switch (op) {
      case 'I':
      case 'V':
        this.setStatus(0);
        return;
      case 'U':
        if (/^U[J:]/i.test(text) || /^UI/i.test(text)) {
          this.setStatus(73);
        } else {
          this.setStatus(31);
        }
        return;
      case 'S': {
        let count = 0;
        for (const name of argument.split(',')) {
          if (name) count += this.storage.deleteFile(name);
        }
        this.setStatus(1, count, 0);
        return;
      }
      case 'R': {
        const [newName, oldName] = argument.split('=');
        if (!newName || !oldName) {
          this.setStatus(30);
          return;
        }
        this.setStatus(this.storage.renameFile(oldName, newName) ? 0 : 62);
        return;
      }
      case 'N': {
        const [name, id] = argument.split(',');
        this.storage.format(name, id);
        this.setStatus(0);
        return;
      }
      default:
        this.setStatus(31);
    }
  }

  turnaround() {
    this.state = S.TURN_DELAY;
    this.after(this.timing.turnaround, () => {
      this.setLines(true, false);
      this.after(this.timing.talkStart, () => this.prepareByte());
    });
  }

  nextTalkByte() {
    const sa = this.secondary;
    if (sa === 15) {
      const bytes = this.statusBytes;
      const channel = this.ensureCommandChannel();
      channel.readPos = channel.readPos || 0;
      if (channel.readPos >= bytes.length) {
        return null;
      }
      return { value: bytes[channel.readPos], eoi: channel.readPos === bytes.length - 1 };
    }
    const channel = this.channels.get(sa);
    if (!channel || channel.mode !== 'read' || channel.pos >= channel.data.length) {
      return null;
    }
    return { value: channel.data[channel.pos], eoi: channel.pos === channel.data.length - 1 };
  }

  advanceTalk() {
    const sa = this.secondary;
    if (sa === 15) {
      const channel = this.ensureCommandChannel();
      channel.readPos++;
      if (channel.readPos >= this.statusBytes.length) {
        channel.readPos = 0;
        this.setStatus(0);
      }
      return;
    }
    const channel = this.channels.get(sa);
    if (channel && channel.mode === 'read') {
      channel.pos++;
    }
  }

  prepareByte() {
    const next = this.nextTalkByte();
    this.setLines(false, false);
    if (!next) {
      this.state = S.TX_NODATA;
      return;
    }
    this.txValue = next.value;
    this.txEoi = next.eoi;
    this.state = S.TX_WAIT_LISTENER;
    if (this.bus.data) {
      this.listenerReady();
    }
  }

  listenerReady() {
    if (this.txEoi) {
      this.state = S.TX_EOI_WAIT_LOW;
      return;
    }
    this.state = S.TX_BITS;
    this.after(this.timing.clkLowBeforeBits, () => this.startBits());
  }

  startBits() {
    this.state = S.TX_BITS;
    this.txBit = 0;
    this.setLines(true, false);
    this.after(this.timing.dataHold, () => this.setupBit());
  }

  setupBit() {
    const bit = (this.txValue >> this.txBit) & 1;
    this.setLines(true, bit === 0);
    this.after(this.timing.dataSetup, () => {
      this.setLines(false, bit === 0);
      this.after(this.timing.dataValid, () => {
        this.setLines(true, bit === 0);
        this.txBit++;
        if (this.txBit < 8) {
          this.after(this.timing.dataHold, () => this.setupBit());
        } else {
          this.after(this.timing.dataHold, () => {
            this.setLines(true, false);
            this.state = S.TX_WAIT_ACK;
            if (!this.bus.data) {
              this.byteAcknowledged();
              return;
            }
            this.after(this.timing.ackTimeout, () => {
              this.setLines(false, false);
              this.state = S.IDLE;
            });
          });
        }
      });
    });
  }

  byteAcknowledged() {
    this.transferCount++;
    this.advanceTalk();
    if (this.txEoi) {
      this.state = S.IDLE;
      this.after(this.timing.byteGap, () => {
        if (this.state === S.IDLE) {
          this.setLines(false, false);
          this.activity(false);
        }
      });
      return;
    }
    this.state = S.TX_GAP;
    this.after(this.timing.byteGap, () => this.prepareByte());
  }
}
