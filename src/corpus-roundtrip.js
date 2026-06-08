import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseFrontierFile } from '@shapeshift-labs/frontier-lang-parser';
import {
  compileFrontierDocument,
  createSemanticImportSidecar,
  createUniversalAstFromDocument,
  importNativeSource,
  projectNativeImportToSource,
  readUniversalAstJson,
  writeUniversalAstJson
} from '@shapeshift-labs/frontier-lang-compiler';
import { idFragment, inferLanguage, readOption } from './options.js';

export function runCorpusRoundtrip(inputPath, args) {
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
    semanticImpactRecords: files.reduce((sum, fileResult) => sum + (fileResult.semanticImpactRecords ?? 0), 0),
    weakMergeSignals: files.reduce((sum, fileResult) => sum + (fileResult.weakMergeSignals ?? 0), 0),
    reviewRequiredMergeSignals: files.reduce((sum, fileResult) => sum + (fileResult.reviewRequiredMergeSignals ?? 0), 0),
    projectionReviewRequired: files.filter((fileResult) => fileResult.projectionReviewRequired).length,
    projectionModes: files.reduce((counts, fileResult) => incrementCount(counts, fileResult.projectionMode), {}),
    projectionReviewStatuses: files.reduce((counts, fileResult) => incrementCount(counts, fileResult.projectionReviewStatus), {}),
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
    if (/\.frontier$/i.test(path)) return corpusFrontierFile(path, source, options);
    const imported = importNativeSource({ language, parser: entry.parser ?? options.parser, sourcePath: path, sourceText: source });
    const projection = projectNativeImportToSource(imported);
    const sidecar = createSemanticImportSidecar(imported);
    const projectionReview = projection.metadata?.projectionReview;
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
      projectionReviewStatus: projectionReview?.status,
      projectionReviewRequired: projectionReview?.reviewRequired === true,
      projectionReviewFallbackReasons: projectionReview?.fallbackReasons ?? [],
      projectionLossCount: projection.losses?.length ?? 0,
      semanticImpactRecords: sidecar.semanticImpact?.summary?.total ?? 0,
      weakMergeSignals: sidecar.semanticImpact?.summary?.weakMergeSignals ?? 0,
      reviewRequiredMergeSignals: sidecar.semanticImpact?.summary?.reviewRequiredMergeSignals ?? 0,
      mergeSignalQueryKeys: sidecar.semanticImpact?.summary?.mergeSignalQueryKeys ?? [],
      sidecarQuality: {
        imported: sidecar.quality?.imported === true,
        eligible: sidecar.quality?.eligible === true,
        warnings: sidecar.quality?.warnings?.length ?? 0
      },
      mergeReadiness: (imported.mergeCandidates ?? []).map((candidate) => candidate.readiness),
      jsonBytes: encoded.length
    };
  } catch (error) {
    return { path, language: entry.language ?? inferLanguage(path), kind: 'error', ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function corpusFrontierFile(path, source, options) {
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

function collectCorpusEntries(inputPath) {
  const absolute = resolve(inputPath);
  const stat = statSync(absolute);
  if (stat.isDirectory()) return collectCorpusDirectory(absolute).map((path) => ({ path }));
  if (/\.json$/i.test(absolute)) return readCorpusManifest(absolute);
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
  return rawEntries.map((entry) => typeof entry === 'string' ? { path: resolve(base, entry) } : { ...entry, path: resolve(base, entry.path ?? entry.file) });
}

function isIgnoredCorpusDirectory(name) {
  return name === 'node_modules' || name === '.git' || name === 'dist' || name === 'coverage' || name === '.next';
}

function isCorpusSourceFile(path) {
  return /\.(frontier|[cm]?tsx?|m?jsx?|rs|py|c|h|hpp|cpp|cc|cxx|go|java|kt|cs|swift|php|rb|rake)$/i.test(path);
}

function incrementCount(counts, key) {
  if (key) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}
