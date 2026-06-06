#!/usr/bin/env node
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontierFile, parseFrontierSource } from '@shapeshift-labs/frontier-lang-parser';
import { checkDocument } from '@shapeshift-labs/frontier-lang-checker';
import { hashDocumentBase } from '@shapeshift-labs/frontier-lang-kernel';
import {
  NativeImportLanguageProfiles,
  compileNativeSource,
  compileFrontierDocument,
  createNativeSourcePreservation,
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
function output(io, value) { io.log(JSON.stringify(value, null, 2)); }
function outputMaybeFile(io, args, value) {
  const json = JSON.stringify(value, null, 2);
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && args[outIndex + 1]) writeFileSync(args[outIndex + 1], json + '\n'); else io.log(json);
}
function runCorpusRoundtrip(inputPath, args) {
  const target = readOption(args, '--target') ?? 'typescript';
  const entries = collectCorpusEntries(inputPath);
  const files = entries.map((entry) => corpusRoundtripFile(entry, { target, parser: readOption(args, '--parser') }));
  const failed = files.filter((fileResult) => !fileResult.ok);
  return {
    kind: 'frontier.lang.corpusRoundtrip',
    version: 1,
    inputPath,
    target,
    total: files.length,
    passed: files.length - failed.length,
    failed: failed.length,
    sourceMapCount: files.reduce((sum, fileResult) => sum + (fileResult.sourceMapCount ?? 0), 0),
    lossCount: files.reduce((sum, fileResult) => sum + (fileResult.lossCount ?? 0), 0),
    sourcePreservationCount: files.filter((fileResult) => fileResult.sourcePreservationId).length,
    projectionModes: files.reduce((counts, fileResult) => {
      if (fileResult.projectionMode) counts[fileResult.projectionMode] = (counts[fileResult.projectionMode] ?? 0) + 1;
      return counts;
    }, {}),
    readiness: files.reduce((counts, fileResult) => {
      for (const readiness of fileResult.mergeReadiness ?? []) counts[readiness] = (counts[readiness] ?? 0) + 1;
      return counts;
    }, {}),
    files
  };
}

function corpusRoundtripFile(entry, options) {
  const path = entry.path;
  try {
    const source = readFileSync(path, 'utf8');
    const language = entry.language ?? inferLanguage(path);
    if (/\.frontier$/i.test(path)) {
      const document = parseFrontierFile(path, source);
      const envelope = createUniversalAstFromDocument(document, {
        evidence: [{ id: `frontier_lang_cli_corpus_${idFragment(path)}`, kind: 'test', status: 'passed', path, summary: 'Corpus Frontier source parsed into universal AST.' }]
      });
      const encoded = writeUniversalAstJson(envelope);
      const decoded = readUniversalAstJson(encoded);
      const result = compileFrontierDocument(decoded.document, { target: options.target });
      return {
        path,
        language: 'frontier',
        kind: 'frontierSource',
        ok: result.ok && decoded.document.id === document.id,
        hash: result.hash,
        sourceMapCount: envelope.sourceMaps?.length ?? 0,
        lossCount: envelope.losses?.length ?? 0,
        evidenceCount: envelope.evidence?.length ?? 0,
        diagnostics: result.diagnostics,
        outputBytes: result.output.length,
        jsonBytes: encoded.length
      };
    }
    const imported = importNativeSource({
      language,
      parser: entry.parser ?? options.parser,
      sourcePath: path,
      sourceText: source
    });
    const projection = projectNativeImportToSource(imported);
    const encoded = writeUniversalAstJson(imported.universalAst);
    const decoded = readUniversalAstJson(encoded);
    return {
      path,
      language,
      kind: 'nativeSource',
      ok: decoded.document.id === imported.document.id,
      sourceMapCount: imported.sourceMaps?.length ?? 0,
      sourceMapMappingCount: (imported.sourceMaps ?? []).reduce((sum, sourceMap) => sum + (sourceMap.mappings?.length ?? 0), 0),
      lossCount: imported.losses?.length ?? 0,
      evidenceCount: imported.evidence?.length ?? 0,
      symbolCount: imported.semanticIndex?.symbols?.length ?? 0,
      occurrenceCount: imported.semanticIndex?.occurrences?.length ?? 0,
      sourcePreservationId: imported.metadata?.sourcePreservationId,
      sourcePreservationExact: imported.metadata?.sourcePreservation?.summary?.exactSourceAvailable === true,
      projectionMode: projection.mode,
      projectionReadiness: projection.readiness?.readiness,
      projectionLossCount: projection.losses?.length ?? 0,
      mergeReadiness: (imported.mergeCandidates ?? []).map((candidate) => candidate.readiness),
      jsonBytes: encoded.length
    };
  } catch (error) {
    return {
      path,
      language: entry.language ?? inferLanguage(path),
      kind: 'error',
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function collectCorpusEntries(inputPath) {
  const absolute = resolve(inputPath);
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    return collectCorpusDirectory(absolute).map((path) => ({ path }));
  }
  if (/\.json$/i.test(absolute)) {
    return readCorpusManifest(absolute);
  }
  return [{ path: absolute }];
}

function collectCorpusDirectory(root) {
  const files = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (item.isDirectory()) {
      if (!isIgnoredCorpusDirectory(item.name)) files.push(...collectCorpusDirectory(path));
      continue;
    }
    if (item.isFile() && isCorpusSourceFile(path)) files.push(path);
  }
  return files.sort();
}

function readCorpusManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const base = dirname(path);
  const rawEntries = Array.isArray(manifest) ? manifest : manifest.files ?? manifest.entries ?? [];
  return rawEntries.map((entry) => {
    if (typeof entry === 'string') return { path: resolve(base, entry) };
    return {
      ...entry,
      path: resolve(base, entry.path ?? entry.file)
    };
  });
}

function importNativeFile(file, source, args, defaults = {}) {
  const language = defaults.language ?? readOption(args, '--language') ?? inferLanguage(file);
  const sourceHash = readOption(args, '--source-hash');
  const sourcePreservation = sourcePreservationOptionsRequested(args)
    ? createNativeSourcePreservation({
      language,
      sourcePath: file,
      sourceHash,
      sourceText: source,
      includeSourceText: !args.includes('--omit-source-text'),
      includeTokens: !args.includes('--no-tokens'),
      includeTrivia: !args.includes('--no-trivia'),
      includeDirectives: !args.includes('--no-directives'),
      maxTokens: readIntegerOption(args, '--max-tokens'),
      maxTrivia: readIntegerOption(args, '--max-trivia'),
      maxDirectives: readIntegerOption(args, '--max-directives'),
      metadata: { cli: true }
    })
    : undefined;
  return importNativeSource({
    language,
    parser: readOption(args, '--parser'),
    sourcePath: file,
    sourceHash,
    sourceText: source,
    sourcePreservation,
    nativeAstMetadata: { sourceBytes: source.length }
  });
}

function readNativeImportForProjection(file, source, args) {
  const parsed = tryParseJson(source);
  if (!parsed) return importNativeFile(file, source, args);
  if (parsed.kind === 'frontier.lang.universalAst') {
    const nativeSource = parsed.nativeSources?.[0];
    return {
      id: parsed.metadata?.nativeImportId ?? `import_${idFragment(parsed.id)}`,
      language: parsed.metadata?.sourceLanguage ?? nativeSource?.language ?? readOption(args, '--language') ?? inferLanguage(file),
      sourcePath: parsed.metadata?.sourcePath ?? nativeSource?.sourcePath,
      universalAst: parsed,
      nativeSource,
      nativeAst: nativeSource?.ast,
      semanticIndex: parsed.semanticIndex,
      sourceMaps: parsed.sourceMaps,
      losses: parsed.losses,
      evidence: parsed.evidence,
      metadata: parsed.metadata ?? {}
    };
  }
  return parsed;
}

function nativeCapabilityLanguages(imported, args) {
  if (args.includes('--all-languages')) return undefined;
  const language = imported?.language;
  if (!language) return undefined;
  const normalized = String(language).toLowerCase();
  const matches = NativeImportLanguageProfiles.filter((profile) => (
    profile.language === normalized || profile.aliases?.includes(normalized)
  ));
  return matches.length ? matches : undefined;
}

function sliceEntryRefs(args) {
  return [
    ...readOptions(args, '--ref'),
    ...readOptions(args, '--semantic-ref'),
    ...readOptions(args, '--symbol').map((value) => `symbol:${value}`),
    ...readOptions(args, '--region').map((value) => `region:${value}`),
    ...readOptions(args, '--native-node').map((value) => `native:${value}`),
    ...readOptions(args, '--path').map((value) => `path:${value}`)
  ];
}

function readCurrentSources(args) {
  const paths = readOptions(args, '--source');
  if (!paths.length) return undefined;
  const currentSources = {};
  for (const sourcePath of paths) {
    currentSources[sourcePath] = readFileSync(sourcePath, 'utf8');
  }
  return currentSources;
}

function tryParseJson(source) {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function isIgnoredCorpusDirectory(name) {
  return name === 'node_modules' || name === '.git' || name === 'dist' || name === 'coverage' || name === '.next';
}

function isCorpusSourceFile(path) {
  return /\.(frontier|[cm]?tsx?|m?jsx?|rs|py|c|h|hpp|cpp|cc|cxx|go|java|kt|cs|swift|php|rb|rake)$/i.test(path);
}

function idFragment(value) {
  return String(value ?? 'unknown').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'unknown';
}

function help(io) { io.log('frontier-lang <parse|check|hash|ast|capabilities|to-json|from-json|import|project-native|native-compile|native-coverage|native-capabilities|native-diff|slice|test-slice|roundtrip|corpus-roundtrip|emit|emit-ts|emit-js|emit-rust|emit-python|emit-c> <file> [--after file] [--target target] [--language language] [--parser parser] [--platform platform] [--symbol name] [--region key] [--ref ref] [--source file] [--focused-command command] [--fixture-hint hint] [--ast] [--sidecar] [--sidecar-only] [--source-only] [--stubs] [--emit-on-blocked] [--all-languages] [--out file] [--strict-effects]'); }
function readOption(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function readOptions(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}
function readIntegerOption(args, flag) {
  const value = readOption(args, flag);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function sourcePreservationOptionsRequested(args) {
  return args.includes('--omit-source-text')
    || args.includes('--no-tokens')
    || args.includes('--no-trivia')
    || args.includes('--no-directives')
    || args.includes('--max-tokens')
    || args.includes('--max-trivia')
    || args.includes('--max-directives');
}
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
  if (/\.php$/.test(file)) return 'php';
  if (/\.rb$|\.rake$/.test(file)) return 'ruby';
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
