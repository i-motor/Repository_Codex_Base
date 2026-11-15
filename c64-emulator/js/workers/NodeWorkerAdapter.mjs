import { parentPort } from 'node:worker_threads';

globalThis.self = {
  postMessage(data, transfers) { parentPort.postMessage(data, transfers); }
};

await import('./EmulatorWorker.js');
parentPort.on('message', data => globalThis.self.onmessage({ data }));
