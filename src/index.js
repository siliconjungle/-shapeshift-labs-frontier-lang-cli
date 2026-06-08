#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFrontierFile, parseFrontierSource } from '@shapeshift-labs/frontier-lang-parser';
import { checkDocument } from '@shapeshift-labs/frontier-lang-checker';
import { hashDocumentBase } from '@shapeshift-labs/frontier-lang-kernel';
import {
  compileNativeSource,
  compileFrontierDocument,
  createNativeImportCoverageMatrix,
  createSemanticImportSidecar,
  createSemanticSlice,
  createUniversalAstFromDocument,
  createUniversalCapabilityMatrix,
  diffNativeSources,
  importNativeSource,
  projectNativeImportToSource,
  projectFrontierAst,
  readSemanticSliceJson,
  readUniversalAstJson,
  resolveCapabilityAdapters,
  testSemanticSlice,
  writeSemanticSliceJson,
  writeUniversalAstJson
} from '@shapeshift-labs/frontier-lang-compiler';
import { output, outputMaybeFile } from './cli-output.js';
import { runCorpusRoundtrip } from './corpus-roundtrip.js';
import { help } from './help.js';
import {
  importNativeFile,
  nativeCapabilityLanguages,
  readCurrentSources,
  readNativeImportForProjection,
  sliceEntryRefs
} from './native-helpers.js';
import {
  idFragment,
  inferLanguage,
  readIntegerOption,
  readOption,
  readOptions,
  tryParseJson
} from './options.js';

export async function runCli(argv = process.argv.slice(2), io = console) {
  const [command, file, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') return help(io);
  if (!file && command !== 'version') throw new Error(`Missing input file for ${command}`);
  if (command === 'corpus-roundtrip') {
    return outputMaybeFile(io, rest, runCorpusRoundtrip(file, rest));
  }
  const source = file ? readFileSync(file, 'utf8') : '';
  if (command === 'from-json') {
    const envelope = readUniversalAstJson(source);
    const target = readOption(rest, '--target') ?? 'typescript';
    const result = compileFrontierDocument(envelope.document, { target, check: { strictEffects: rest.includes('--strict-effects') } });
    if (rest.includes('--ast')) return output(io, result.ast);
    return io.log(result.output);
  }
  if (command === 'import') {
    const imported = importNativeFile(file, source, rest);
    if (rest.includes('--sidecar-only')) return outputMaybeFile(io, rest, createSemanticImportSidecar(imported));
    if (rest.includes('--sidecar')) {
      return outputMaybeFile(io, rest, { import: imported, sidecar: createSemanticImportSidecar(imported) });
    }
    return outputMaybeFile(io, rest, imported);
  }
  if (command === 'project-native') {
    const imported = readNativeImportForProjection(file, source, rest);
    const projection = projectNativeImportToSource(imported, { preferPreservedSource: !rest.includes('--stubs') });
    if (rest.includes('--source-only')) {
      const outIndex = rest.indexOf('--out');
      if (outIndex >= 0 && rest[outIndex + 1]) writeFileSync(rest[outIndex + 1], projection.sourceText);
      else io.log(projection.sourceText);
      return;
    }
    return outputMaybeFile(io, rest, projection);
  }
  if (command === 'native-compile') {
    const parsed = tryParseJson(source);
    const input = parsed ? readNativeImportForProjection(file, source, rest) : {
      language: readOption(rest, '--language') ?? inferLanguage(file),
      parser: readOption(rest, '--parser'),
      sourcePath: readOption(rest, '--source-path') ?? file,
      sourceHash: readOption(rest, '--source-hash'),
      sourceText: source,
      nativeAstMetadata: { sourceBytes: source.length, cli: true }
    };
    const result = compileNativeSource(input, {
      target: readOption(rest, '--target'),
      parser: readOption(rest, '--parser'),
      emitOnBlocked: rest.includes('--emit-on-blocked'),
      metadata: { cli: true, inputPath: file }
    });
    if (rest.includes('--source-only')) {
      const outIndex = rest.indexOf('--out');
      if (outIndex >= 0 && rest[outIndex + 1]) writeFileSync(rest[outIndex + 1], result.output);
      else io.log(result.output);
      return;
    }
    return outputMaybeFile(io, rest, result);
  }
  if (command === 'native-coverage') {
    const language = readOption(rest, '--language') ?? inferLanguage(file);
    const imported = importNativeFile(file, source, rest, { language });
    return outputMaybeFile(io, rest, createNativeImportCoverageMatrix({ imports: [imported] }));
  }
  if (command === 'native-capabilities') {
    const imported = readNativeImportForProjection(file, source, rest);
    const target = readOption(rest, '--target');
    return outputMaybeFile(io, rest, createUniversalCapabilityMatrix({
      imports: [imported],
      languages: nativeCapabilityLanguages(imported, rest),
      targets: target ? [target] : undefined
    }));
  }
  if (command === 'native-diff') {
    const afterPath = readOption(rest, '--after');
    if (!afterPath) throw new Error('native-diff requires --after <file>');
    const afterSource = readFileSync(afterPath, 'utf8');
    const language = readOption(rest, '--language') ?? inferLanguage(afterPath) ?? inferLanguage(file);
    return outputMaybeFile(io, rest, diffNativeSources({
      id: readOption(rest, '--id'),
      language,
      parser: readOption(rest, '--parser'),
      sourcePath: readOption(rest, '--source-path') ?? afterPath,
      beforeSourceText: source,
      afterSourceText: afterSource,
      beforeSourceHash: readOption(rest, '--before-source-hash'),
      afterSourceHash: readOption(rest, '--after-source-hash'),
      regionPrefix: readOption(rest, '--region-prefix'),
      evidenceId: readOption(rest, '--evidence-id'),
      patchId: readOption(rest, '--patch-id'),
      mergeCandidateId: readOption(rest, '--merge-candidate-id'),
      metadata: { cli: true, beforePath: file, afterPath }
    }));
  }
  if (command === 'slice') {
    const imported = readNativeImportForProjection(file, source, rest);
    const slice = createSemanticSlice(imported, {
      id: readOption(rest, '--id'),
      entryRefs: sliceEntryRefs(rest),
      includeDependencies: !rest.includes('--no-deps'),
      maxDependencyDepth: readIntegerOption(rest, '--max-depth'),
      includeSourceText: !rest.includes('--no-source-text'),
      maxExcerptBytes: readIntegerOption(rest, '--max-excerpt-bytes'),
      focusedCommands: readOptions(rest, '--focused-command'),
      fixtureHints: readOptions(rest, '--fixture-hint'),
      metadata: { cli: true, inputPath: file }
    });
    if (rest.includes('--json-stable')) {
      const json = writeSemanticSliceJson(slice);
      const outIndex = rest.indexOf('--out');
      if (outIndex >= 0 && rest[outIndex + 1]) writeFileSync(rest[outIndex + 1], json + '\n');
      else io.log(json);
      return;
    }
    return outputMaybeFile(io, rest, slice);
  }
  if (command === 'test-slice') {
    const slice = readSemanticSliceJson(source);
    return outputMaybeFile(io, rest, testSemanticSlice(slice, {
      id: readOption(rest, '--id'),
      requireSourceMapLinks: !rest.includes('--no-source-map-links'),
      currentSources: readCurrentSources(rest),
      metadata: { cli: true, inputPath: file }
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
