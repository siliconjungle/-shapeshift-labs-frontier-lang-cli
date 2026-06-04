import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../dist/index.js';

const lines = [];
await runCli(['hash', 'test/fixture.frontier'], { log: (value = '') => lines.push(String(value)) });
assert.match(lines[0], /^fnv1a32:/);
lines.length = 0;
await runCli(['emit-ts', 'test/fixture.frontier'], { log: (value = '') => lines.push(String(value)) });
assert.match(lines.join('\n'), /export interface Todo/);

const binDir = mkdtempSync(join(tmpdir(), 'frontier-lang-cli-bin-'));
const binPath = join(binDir, 'frontier-lang');
symlinkSync(join(process.cwd(), 'dist/index.js'), binPath);
const binRun = spawnSync(process.execPath, [binPath, 'hash', 'test/fixture.frontier'], { encoding: 'utf8' });
assert.equal(binRun.status, 0, binRun.stderr);
assert.match(binRun.stdout.trim(), /^fnv1a32:/);
