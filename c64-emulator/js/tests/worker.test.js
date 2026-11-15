import { test, assertEqual, assertTrue } from './harness.js';
import { WorkerRunner } from '../workers/WorkerRunner.js';

test('Worker-Referenz: asynchrone Anfragen behalten ihre eindeutigen IDs', async () => {
  class FakeWorker {
    postMessage(data) {
      const delay = data.command === 'slow' ? 5 : 0;
      setTimeout(() => this.onmessage({ data: { id: data.id, ok: true, result: data.command } }), delay);
    }
    terminate() {}
  }
  const worker = new WorkerRunner({ factory: () => new FakeWorker() });
  await worker.start();
  const result = await Promise.all([worker.request('slow'), worker.request('fast')]);
  assertEqual(result[0], 'slow');
  assertEqual(result[1], 'fast');
  assertEqual(worker.pending.size, 0);
  worker.terminate();
});
