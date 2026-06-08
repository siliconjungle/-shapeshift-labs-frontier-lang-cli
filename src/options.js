export function readOption(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function readOptions(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

export function readIntegerOption(args, flag) {
  const value = readOption(args, flag);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function sourcePreservationOptionsRequested(args) {
  return args.includes('--omit-source-text')
    || args.includes('--no-tokens')
    || args.includes('--no-trivia')
    || args.includes('--no-directives')
    || args.includes('--max-tokens')
    || args.includes('--max-trivia')
    || args.includes('--max-directives');
}

export function tryParseJson(source) {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function idFragment(value) {
  return String(value ?? 'unknown').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'unknown';
}

export function inferLanguage(file) {
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
