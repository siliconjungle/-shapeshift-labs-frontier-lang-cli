#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFrontierFile, parseFrontierSource } from '@shapeshift-labs/frontier-lang-parser';
import { checkDocument } from '@shapeshift-labs/frontier-lang-checker';
import { emitTypeScript } from '@shapeshift-labs/frontier-lang-typescript';
import { hashDocumentBase } from '@shapeshift-labs/frontier-lang-kernel';

export async function runCli(argv = process.argv.slice(2), io = console) {
  const [command, file, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') return help(io);
  if (!file && command !== 'version') throw new Error(`Missing input file for ${command}`);
  const source = file ? readFileSync(file, 'utf8') : '';
  const document = file ? parseFrontierFile(file, source) : parseFrontierSource(source);
  if (command === 'parse') return output(io, document);
  if (command === 'check') return output(io, checkDocument(document, { strictEffects: rest.includes('--strict-effects') }));
  if (command === 'hash') return io.log(hashDocumentBase(document));
  if (command === 'emit-ts') {
    const text = emitTypeScript(document);
    const outIndex = rest.indexOf('--out');
    if (outIndex >= 0 && rest[outIndex + 1]) writeFileSync(rest[outIndex + 1], text); else io.log(text);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
function output(io, value) { io.log(JSON.stringify(value, null, 2)); }
function help(io) { io.log('frontier-lang <parse|check|hash|emit-ts> <file.frontier> [--out file] [--strict-effects]'); }

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runCli().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
