#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFrontierFile, parseFrontierSource } from '@shapeshift-labs/frontier-lang-parser';
import { checkDocument } from '@shapeshift-labs/frontier-lang-checker';
import { hashDocumentBase } from '@shapeshift-labs/frontier-lang-kernel';
import {
  compileFrontierDocument,
  createUniversalAstFromDocument,
  importNativeSource,
  projectFrontierAst,
  readUniversalAstJson,
  resolveCapabilityAdapters,
  writeUniversalAstJson
} from '@shapeshift-labs/frontier-lang-compiler';

export async function runCli(argv = process.argv.slice(2), io = console) {
  const [command, file, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') return help(io);
  if (!file && command !== 'version') throw new Error(`Missing input file for ${command}`);
  const source = file ? readFileSync(file, 'utf8') : '';
  if (command === 'from-json') {
    const envelope = readUniversalAstJson(source);
    const target = readOption(rest, '--target') ?? 'typescript';
    const result = compileFrontierDocument(envelope.document, { target, check: { strictEffects: rest.includes('--strict-effects') } });
    if (rest.includes('--ast')) return output(io, result.ast);
    return io.log(result.output);
  }
  if (command === 'import') {
    const language = readOption(rest, '--language') ?? inferLanguage(file);
    return outputMaybeFile(io, rest, importNativeSource({
      language,
      parser: readOption(rest, '--parser'),
      sourcePath: file,
      sourceHash: readOption(rest, '--source-hash'),
      sourceText: source,
      nativeAstMetadata: { sourceBytes: source.length }
    }));
  }
  const document = file ? parseFrontierFile(file, source) : parseFrontierSource(source);
  if (command === 'to-json') {
    return io.log(writeUniversalAstJson(createUniversalAstFromDocument(document, {
      id: readOption(rest, '--id'),
      evidence: [{ id: 'frontier_lang_cli_to_json', kind: 'import', status: 'passed', path: file, summary: 'Converted Frontier source to universal AST JSON envelope.' }]
    })));
  }
  if (command === 'roundtrip') {
    const target = readOption(rest, '--target') ?? 'typescript';
    const envelope = createUniversalAstFromDocument(document, {
      id: readOption(rest, '--id'),
      evidence: [{ id: 'frontier_lang_cli_roundtrip', kind: 'test', status: 'passed', path: file, summary: `Parsed Frontier source and emitted ${target}.` }]
    });
    const result = compileFrontierDocument(envelope.document, { target, check: { strictEffects: rest.includes('--strict-effects') } });
    return outputMaybeFile(io, rest, {
      ok: result.ok,
      target: result.target,
      hash: result.hash,
      envelope,
      diagnostics: result.diagnostics,
      output: result.output
    });
  }
  if (command === 'parse') return outputMaybeFile(io, rest, document);
  if (command === 'check') return outputMaybeFile(io, rest, checkDocument(document, { strictEffects: rest.includes('--strict-effects') }));
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
function outputMaybeFile(io, args, value) {
  const json = JSON.stringify(value, null, 2);
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && args[outIndex + 1]) writeFileSync(args[outIndex + 1], json + '\n'); else io.log(json);
}
function help(io) { io.log('frontier-lang <parse|check|hash|ast|capabilities|to-json|from-json|import|roundtrip|emit|emit-ts|emit-js|emit-rust|emit-python|emit-c> <file> [--target target] [--language language] [--parser parser] [--platform platform] [--ast] [--out file] [--strict-effects]'); }
function readOption(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function inferLanguage(file) {
  if (!file) return 'unknown';
  if (/\.[cm]?tsx?$/.test(file)) return 'typescript';
  if (/\.m?jsx?$/.test(file)) return 'javascript';
  if (/\.rs$/.test(file)) return 'rust';
  if (/\.py$/.test(file)) return 'python';
  if (/\.c$/.test(file)) return 'c';
  if (/\.cpp$|\.cc$|\.cxx$|\.hpp$|\.h$/.test(file)) return 'cpp';
  if (/\.go$/.test(file)) return 'go';
  if (/\.java$/.test(file)) return 'java';
  if (/\.kt$/.test(file)) return 'kotlin';
  if (/\.cs$/.test(file)) return 'csharp';
  if (/\.swift$/.test(file)) return 'swift';
  return 'unknown';
}

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
