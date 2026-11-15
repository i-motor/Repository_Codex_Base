import './memory.test.js';
import './clock.test.js';
import './signals.test.js';
import './cpu.test.js';
import './cia.test.js';
import './keyboard.test.js';
import './vic.test.js';
import './sprites.test.js';
import './sid.test.js';
import './audio.test.js';
import './storage.test.js';
import './iec.test.js';
import './m8.test.js';
import './m9.test.js';
import './d64.test.js';
import './drive.test.js';
import './ntsc.test.js';
import './sid-models.test.js';
import './gamepad.test.js';
import './worker.test.js';
import { runAll } from './harness.js';

const results = await runAll();
for (const result of results) {
  process.stdout.write(`${result.passed ? 'OK' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}\n`);
}
const passed = results.filter(result => result.passed).length;
process.stdout.write(`${passed}/${results.length} Tests bestanden\n`);
if (passed !== results.length) process.exitCode = 1;
