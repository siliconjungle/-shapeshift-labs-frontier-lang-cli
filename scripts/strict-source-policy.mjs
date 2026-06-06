#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const policyPath = path.join(root, 'frontier.source-policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')).sourcePolicy;
const sourceExtensions = new Set(policy.sourceExtensions ?? ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const excludedSegments = new Set(policy.excludedSegments ?? ['node_modules', 'dist', 'build', 'coverage', 'results', 'reports', 'agent-runs', 'agent-worktrees', '.cache', '.next', '.turbo', 'out']);
const localImportExtensions = new Set(policy.allowedLocalImportExtensions ?? ['.js', '.mjs', '.cjs', '.json', '.node', '.ts', '.tsx', '.jsx']);
const violations = [];
const notes = [];
const files = gitFiles().filter((file) => !hasExcludedSegment(file));
const pkg = readJson('package.json');

requirePackageScripts(pkg);
requireStrictTypeScript();
rejectTrackedArtifacts(files);
for (const file of files) inspectSourceFile(file);

if (violations.length > 0) {
  console.error('frontier strict source policy failed');
  for (const violation of violations) console.error('- ' + violation);
  process.exit(1);
}
console.log('frontier strict source policy ok: ' + files.length + ' tracked/non-ignored files checked' + (notes.length ? ', ' + notes.length + ' baseline exceptions' : ''));

function gitFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

function hasExcludedSegment(file) {
  return file.split(/[\/]+/).some((segment) => excludedSegments.has(segment));
}

function inspectSourceFile(file) {
  const ext = path.extname(file);
  if (!sourceExtensions.has(ext)) return;
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return;
  const text = fs.readFileSync(absolute, 'utf8');
  const lines = countLines(text);
  const chars = text.length;
  const allowance = policy.allowedOversizedFiles?.[file];
  const maxLines = allowance?.maxLines ?? policy.maxLinesPerFile;
  const maxChars = allowance?.maxChars ?? policy.maxCharsPerFile;
  if (lines > maxLines) violations.push(file + ' has ' + lines + ' lines; max is ' + maxLines);
  if (chars > maxChars) violations.push(file + ' has ' + chars + ' chars; max is ' + maxChars);
  if (allowance && (lines > policy.maxLinesPerFile || chars > policy.maxCharsPerFile)) notes.push(file + ': ' + (allowance.reason ?? 'baseline exception'));
  checkLocalImportExtensions(file, text);
  checkComponentBudget(file, text);
}

function checkLocalImportExtensions(file, text) {
  if (policy.localImportExtensions !== 'source') return;
  const importPattern = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (!specifier || !specifier.startsWith('.')) continue;
    const clean = specifier.split(/[?#]/)[0];
    const ext = path.extname(clean);
    if (!ext || !localImportExtensions.has(ext)) violations.push(file + ' imports ' + specifier + ' without an explicit source extension');
  }
}

function checkComponentBudget(file, text) {
  const ext = path.extname(file);
  if (ext !== '.tsx' && ext !== '.jsx') return;
  const max = policy.maxFrontierComponentsPerFile ?? 1;
  const names = new Set();
  const patterns = [
    /\bexport\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /\bexport\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /\bfunction\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /\bexport\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/g,
    /\bconst\s+([A-Z][A-Za-z0-9_]*)\s*=/g
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) names.add(match[1]);
  if (names.size > max) violations.push(file + ' declares ' + names.size + ' component-like symbols; max is ' + max);
}

function requirePackageScripts(pkg) {
  const scripts = pkg.scripts ?? {};
  for (const name of ['build', 'test', 'typecheck', 'lint', 'prepack']) {
    if (!scripts[name]) violations.push('package.json missing scripts.' + name);
  }
  if (scripts.prepack && !scripts.prepack.includes('lint')) violations.push('package.json scripts.prepack must run lint');
}

function requireStrictTypeScript() {
  const configs = ['tsconfig.json', 'test/tsconfig.json']
    .filter((file) => fs.existsSync(path.join(root, file)))
    .map((file) => ({ file, json: readJson(file) }));
  if (configs.length === 0) return;
  if (!configs.some((entry) => entry.json.compilerOptions?.strict === true)) violations.push('no tsconfig enables compilerOptions.strict');
}

function rejectTrackedArtifacts(files) {
  for (const file of files) {
    const segments = file.split(/[\/]+/);
    if (segments.includes('dist') || segments.includes('node_modules') || segments.includes('agent-runs') || segments.includes('agent-worktrees')) violations.push('tracked/generated artifact is not allowed: ' + file);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function countLines(text) {
  if (!text) return 0;
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}
