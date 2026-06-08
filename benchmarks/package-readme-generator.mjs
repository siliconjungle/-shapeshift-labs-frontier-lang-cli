import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const catalogPaths = [
  './package-readme-catalog-part-1.json',
  './package-readme-catalog-part-2.json',
  './package-readme-catalog-part-3.json'
].map((file) => fileURLToPath(new URL(file, import.meta.url)));

export function runPackageReadmeSections({ packageRoot, check = false } = {}) {
  if (!packageRoot) throw new Error('packageRoot is required');

  const packages = readPackageCatalog(catalogPaths);
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const current = packages.find((entry) => entry.name === packageJson.name);
  if (!current) throw new Error('unknown Frontier package in package.json: ' + packageJson.name);

  const readmePath = path.join(packageRoot, 'README.md');
  const currentText = fs.readFileSync(readmePath, 'utf8');
  const relatedPackages = renderRelatedPackages(packages, current);
  const nextText = replaceOrInsertHeadingSection(currentText, '## Related Packages', relatedPackages);
  if (currentText === nextText) return;

  if (check) {
    console.error('README package-family sections are stale.');
    console.error('Run npm run readme:packages to refresh README.md.');
    process.exit(1);
  }
  fs.writeFileSync(readmePath, nextText);
}

export function renderRelatedPackages(packages, currentPackage) {
  const related = packages.filter((entry) => entry.id !== currentPackage.id);
  const tick = String.fromCharCode(96);
  return [
    'The published Frontier package family is generated from one shared package catalog so READMEs stay in sync across packages:',
    '',
    ...related.map((entry) => '- [' + tick + entry.name + tick + '](' + entry.npmUrl + '): ' + entry.role),
    '',
    'Package source repositories:',
    '',
    ...packages.map((entry) => '- [' + tick + entry.repoName + tick + '](' + entry.repoUrl + ')')
  ].join('\n') + '\n';
}

export function replaceOrInsertHeadingSection(text, heading, body) {
  const normalizedBody = body.replace(/\n*$/, '\n\n');
  const start = text.indexOf(heading + '\n');
  if (start !== -1) {
    const bodyStart = start + heading.length + 1;
    const next = findNextHeading(text, bodyStart);
    if (next === -1) return text.slice(0, bodyStart) + '\n' + normalizedBody;
    return text.slice(0, bodyStart) + '\n' + normalizedBody + text.slice(next);
  }
  const insertAt = findNextHeading(text, text.indexOf('\n') + 1);
  if (insertAt === -1) return text.replace(/\n*$/, '\n\n') + heading + '\n\n' + normalizedBody;
  return text.slice(0, insertAt) + '\n' + heading + '\n\n' + normalizedBody + text.slice(insertAt);
}

function readPackageCatalog(files) {
  const chunks = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) throw new Error('package README catalog shard must be an array');
  }
  return chunks.flat();
}

function findNextHeading(text, fromIndex) {
  const headingPattern = /^## .+$/gm;
  headingPattern.lastIndex = fromIndex;
  const match = headingPattern.exec(text);
  return match ? match.index : -1;
}
