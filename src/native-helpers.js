import { readFileSync } from 'node:fs';
import {
  NativeImportLanguageProfiles,
  createNativeSourcePreservation,
  importNativeSource
} from '@shapeshift-labs/frontier-lang-compiler';
import {
  idFragment,
  inferLanguage,
  readIntegerOption,
  readOption,
  readOptions,
  sourcePreservationOptionsRequested,
  tryParseJson
} from './options.js';

export function importNativeFile(file, source, args, defaults = {}) {
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

export function readNativeImportForProjection(file, source, args) {
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

export function nativeCapabilityLanguages(imported, args) {
  if (args.includes('--all-languages')) return undefined;
  const language = imported?.language;
  if (!language) return undefined;
  const normalized = String(language).toLowerCase();
  const matches = NativeImportLanguageProfiles.filter((profile) => (
    profile.language === normalized || profile.aliases?.includes(normalized)
  ));
  return matches.length ? matches : undefined;
}

export function sliceEntryRefs(args) {
  return [
    ...readOptions(args, '--ref'),
    ...readOptions(args, '--semantic-ref'),
    ...readOptions(args, '--symbol').map((value) => `symbol:${value}`),
    ...readOptions(args, '--region').map((value) => `region:${value}`),
    ...readOptions(args, '--native-node').map((value) => `native:${value}`),
    ...readOptions(args, '--path').map((value) => `path:${value}`)
  ];
}

export function readCurrentSources(args) {
  const paths = readOptions(args, '--source');
  if (!paths.length) return undefined;
  const currentSources = {};
  for (const sourcePath of paths) currentSources[sourcePath] = readFileSync(sourcePath, 'utf8');
  return currentSources;
}
