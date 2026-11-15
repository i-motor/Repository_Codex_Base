import { Worker } from 'node:worker_threads';
import { WorkerRunner } from '../workers/WorkerRunner.js';

class NodeAdapter {
  constructor() {
    this.worker = new Worker(new URL('../workers/NodeWorkerAdapter.mjs', import.meta.url), { type: 'module' });
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.(error));
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { return this.worker.terminate(); }
}

const runner = new WorkerRunner({ factory: () => new NodeAdapter() });
try {
  const state = await runner.start('NTSC', '8580');
  if (state.videoStandard !== 'NTSC') throw new Error('Worker hat NTSC nicht übernommen');
  await runner.request('demo', { kind: 'sprite' });
  const result = await runner.request('run', { cycles: 34190 });
  const frame = await runner.request('frame');
  if (result.cycle !== 34190 || frame.frameNumber !== 2) throw new Error('Worker-Taktsynchronisierung fehlgeschlagen');
  if (frame.width !== 404 || frame.height !== 240 || frame.data.length !== 404 * 240) throw new Error('Worker-Framebuffer fehlerhaft');
  const audio = await runner.request('samples', { count: 128 });
  if (!(audio instanceof Float32Array)) throw new Error('Worker-PCM-Format falsch');
  process.stdout.write(`Worker-Integration bestanden: ${result.cycle} Takte, ${frame.frameNumber} NTSC-Frames, ${audio.length} PCM-Samples\n`);
} finally {
  runner.terminate();
}
