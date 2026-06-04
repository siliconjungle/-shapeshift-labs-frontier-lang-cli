import assert from 'node:assert/strict';
import { runCli } from '../dist/index.js';
const lines = [];
await runCli(['hash', 'test/fixture.frontier'], { log: (value = '') => lines.push(String(value)) });
assert.match(lines[0], /^fnv1a32:/);
lines.length = 0;
await runCli(['emit-ts', 'test/fixture.frontier'], { log: (value = '') => lines.push(String(value)) });
assert.match(lines.join('\n'), /export interface Todo/);
