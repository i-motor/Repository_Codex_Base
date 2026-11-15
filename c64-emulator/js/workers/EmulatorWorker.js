import { C64 } from '../core/C64.js';

let machine = new C64();

async function execute(command, data = {}) {
  switch (command) {
    case 'init':
      machine = new C64({ videoStandard: data.videoStandard ?? 'PAL', sidModel: data.sidModel ?? '6581' });
      return machine.getDiagnostics();
    case 'rom':
      machine.loadROM(data.type, data.bytes);
      return machine.roms.getStatus();
    case 'reset':
      machine.powerOn();
      return machine.cpu.getState();
    case 'demo':
      if (data.kind === 'vic') machine.loadVICDemo();
      else if (data.kind === 'sprite') machine.loadSpriteDemo();
      else if (data.kind === 'sid') machine.loadSIDDemo();
      else throw new RangeError('Unbekannte Worker-Demo');
      return machine.cpu.getState();
    case 'run':
      machine.runCycles(data.cycles);
      return { cycle: machine.clock.cycle, cpu: machine.cpu.getState(), frame: machine.vic.frameNumber };
    case 'frame': {
      const frame = machine.vic.getFrame();
      return { width: frame.width, height: frame.height, data: frame.data.slice(), palette: frame.palette, frameNumber: frame.frameNumber };
    }
    case 'samples': return machine.takeAudioSamples(data.count);
    case 'state': return machine.getDiagnostics();
    case 'disk': return machine.mountD64(data.bytes);
    default: throw new RangeError('Unbekannter Worker-Befehl');
  }
}

self.onmessage = async ({ data }) => {
  const { id, command } = data;
  try {
    const result = await execute(command, data);
    const transfers = [];
    if (result?.data instanceof Uint8Array || result instanceof Float32Array) transfers.push((result.data ?? result).buffer);
    self.postMessage({ id, ok: true, result }, transfers);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
};
