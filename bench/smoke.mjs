import { performance } from 'node:perf_hooks';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../dist/index.js';

const start = performance.now();
let bytes = 0;
for (let index = 0; index < 100; index += 1) {
  const lines = [];
  await runCli(['emit', 'test/fixture.frontier', '--target', index % 2 ? 'javascript' : 'typescript'], { log: (value = '') => lines.push(String(value)) });
  bytes += lines.join('\n').length;
}
const nativeDir = mkdtempSync(join(tmpdir(), 'frontier-lang-cli-native-bench-'));
const nativePath = join(nativeDir, 'todo.js');
writeFileSync(nativePath, 'export function addTodo(title) { return { title }; }\n');
let nativeBytes = 0;
for (let index = 0; index < 25; index += 1) {
  const lines = [];
  await runCli(['native-compile', nativePath, '--target', index % 2 ? 'javascript' : 'rust', '--emit-on-blocked'], { log: (value = '') => lines.push(String(value)) });
  nativeBytes += lines.join('\n').length;
}
console.log(JSON.stringify({ emits: 100, nativeCompiles: 25, bytes, nativeBytes, durationMs: Number((performance.now() - start).toFixed(2)) }));
