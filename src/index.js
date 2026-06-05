#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFrontierFile, parseFrontierSource } from '@shapeshift-labs/frontier-lang-parser';
import { checkDocument } from '@shapeshift-labs/frontier-lang-checker';
import { hashDocumentBase } from '@shapeshift-labs/frontier-lang-kernel';
import { compileFrontierDocument, projectFrontierAst, resolveCapabilityAdapters } from '@shapeshift-labs/frontier-lang-compiler';

export async function runCli(argv = process.argv.slice(2), io = console) {
  const [command, file, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') return help(io);
  if (!file && command !== 'version') throw new Error(`Missing input file for ${command}`);
  const source = file ? readFileSync(file, 'utf8') : '';
  const document = file ? parseFrontierFile(file, source) : parseFrontierSource(source);
  if (command === 'parse') return output(io, document);
  if (command === 'check') return output(io, checkDocument(document, { strictEffects: rest.includes('--strict-effects') }));
  if (command === 'hash') return io.log(hashDocumentBase(document));
  if (command === 'ast') {
    const target = readOption(rest, '--target') ?? 'typescript';
    return output(io, projectFrontierAst(document, target));
  }
  if (command === 'capabilities') {
    const target = readOption(rest, '--target') ?? 'typescript';
    const platform = readOption(rest, '--platform');
    return output(io, resolveCapabilityAdapters(document, target, { platform }));
  }
  if (command === 'emit' || command.startsWith('emit-')) {
    const target = command === 'emit' ? readOption(rest, '--target') ?? 'typescript' : command.slice('emit-'.length);
    const result = compileFrontierDocument(document, { target, check: { strictEffects: rest.includes('--strict-effects') } });
    if (!result.ok) {
      output(io, { ok: false, diagnostics: result.diagnostics });
      return;
    }
    if (rest.includes('--ast')) return output(io, result.ast);
    const outIndex = rest.indexOf('--out');
    if (outIndex >= 0 && rest[outIndex + 1]) writeFileSync(rest[outIndex + 1], result.output); else io.log(result.output);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
function output(io, value) { io.log(JSON.stringify(value, null, 2)); }
function help(io) { io.log('frontier-lang <parse|check|hash|ast|capabilities|emit|emit-ts|emit-js|emit-rust|emit-python|emit-c> <file.frontier> [--target target] [--platform platform] [--ast] [--out file] [--strict-effects]'); }
function readOption(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1];
  }
}

if (isDirectInvocation()) {
  runCli().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
