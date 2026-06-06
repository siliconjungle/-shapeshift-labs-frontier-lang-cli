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

for (let index = 0; index < 20; index += 1) {
  const file = join(dir, `native-${index}.js`);
  writeFileSync(file, `export function nativeCase${index}(value) { return value ?? ${index}; }\n`);
  const lines = [];
  const args = ['native-compile', file];
  if (index % 3 === 0) args.push('--target', 'rust', '--emit-on-blocked');
  await runCli(args, { log: (value = '') => lines.push(String(value)) });
  const result = JSON.parse(lines.join('\n'));
  assert.equal(result.kind, 'frontier.lang.nativeSourceCompileResult');
  assert.ok(result.output.length > 0);
  assert.ok(['javascript', 'rust'].includes(result.target));
}

for (let index = 0; index < 20; index += 1) {
  const file = join(dir, `slice-${index}.ts`);
  writeFileSync(file, `export function sliceCliCase${index}(value) { return value + ${index}; }\n`);
  const lines = [];
  await runCli(['slice', file, '--symbol', `sliceCliCase${index}`, '--focused-command', `npm test -- slice-cli-${index}`], { log: (value = '') => lines.push(String(value)) });
  const slice = JSON.parse(lines.join('\n'));
  assert.equal(slice.kind, 'frontier.lang.semanticSlice');
  assert.equal(slice.unresolvedEntryRefs.length, 0);
  assert.ok(slice.sourceMapLinks.length >= 1);
}
