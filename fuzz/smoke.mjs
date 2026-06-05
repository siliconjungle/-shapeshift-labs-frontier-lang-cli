import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../dist/index.js';

const targets = ['typescript', 'javascript', 'rust', 'python', 'c'];
const dir = mkdtempSync(join(tmpdir(), 'frontier-lang-cli-fuzz-'));
for (let index = 0; index < 50; index += 1) {
  const file = join(dir, `case-${index}.frontier`);
  writeFileSync(file, `
module Case${index} @id("mod_${index}")
type ItemInput @id("type_input_${index}") {
  value: Text
}
entity Item @id("ent_${index}") {
  value @id("field_value_${index}"): Text
}
action updateItem @id("action_${index}") {
  input ItemInput
  writes field_value_${index}
  returns Patch
}
`);
  const lines = [];
  await runCli(['emit', file, '--target', targets[index % targets.length]], { log: (value = '') => lines.push(String(value)) });
  assert.ok(lines.join('\n').length > 0);
}
