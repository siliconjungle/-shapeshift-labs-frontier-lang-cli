import { performance } from 'node:perf_hooks';
import { runCli } from '../dist/index.js';

const start = performance.now();
let bytes = 0;
for (let index = 0; index < 100; index += 1) {
  const lines = [];
  await runCli(['emit', 'test/fixture.frontier', '--target', index % 2 ? 'javascript' : 'typescript'], { log: (value = '') => lines.push(String(value)) });
  bytes += lines.join('\n').length;
}
console.log(JSON.stringify({ emits: 100, bytes, durationMs: Number((performance.now() - start).toFixed(2)) }));
