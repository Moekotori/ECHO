import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const baselinePath = join(root, 'scripts', 'theme-color-baseline.json');

const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'out']);
const tokenFiles = new Set([
  'src\\renderer\\styles\\tokens.css',
  'src/renderer/styles/tokens.css',
  'src\\renderer\\styles\\theme-presets.css',
  'src/renderer/styles/theme-presets.css',
]);

const colorLiteralPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black)\b/i;
const themeSensitiveDeclarationPattern =
  /^\s*(?:color|background(?:-color|-image)?|border(?:-(?:color|top-color|right-color|bottom-color|left-color))?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|accent-color|caret-color|scrollbar-color)\s*:/i;

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...await walk(join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && extname(entry.name) === '.css') {
      files.push(join(directory, entry.name));
    }
  }

  return files;
};

const isAllowedByComment = (lines, index) => {
  const current = lines[index] ?? '';
  const previous = lines[index - 1] ?? '';

  return current.includes('theme-color-allow') || previous.includes('theme-color-allow');
};

const files = await walk(join(root, 'src', 'renderer'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const failures = [];
let legacyFindingCount = 0;
let checkedFindingCount = 0;

for (const file of files) {
  const relativePath = relative(root, file);
  const normalizedPath = relativePath.replaceAll('\\', '/');

  if (tokenFiles.has(relativePath) || tokenFiles.has(normalizedPath)) {
    continue;
  }

  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/u);
  const findings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (
      trimmed.startsWith('--') ||
      !themeSensitiveDeclarationPattern.test(line) ||
      !colorLiteralPattern.test(line) ||
      isAllowedByComment(lines, index)
    ) {
      continue;
    }

    findings.push(`${relativePath}:${index + 1}: use theme tokens instead of hard-coded theme-sensitive colors`);
  }

  const baselineCount = Number(baseline[normalizedPath] ?? 0);
  const overBudget = findings.length > baselineCount;

  if (strict || overBudget) {
    checkedFindingCount += findings.length;
    failures.push(...findings);
  } else {
    legacyFindingCount += findings.length;
  }
}

if (failures.length > 0) {
  console.error('Theme color check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('');
  console.error('Use semantic tokens from src/renderer/styles/tokens.css, or add /* theme-color-allow */ with a reason for rare fixed-color assets.');
  process.exitCode = 1;
} else {
  const legacyNote = strict
    ? ''
    : ` (${legacyFindingCount} legacy findings ignored; run with --strict to audit them)`;
  console.log(`Theme color check passed for ${files.length} CSS files${legacyNote}.`);
}
