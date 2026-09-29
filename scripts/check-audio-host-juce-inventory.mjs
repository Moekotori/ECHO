import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const jucePattern = /JUCE|Juce|juce/u;

const productionScanTargets = [
  { group: 'cmake', path: 'native/audio-host/CMakeLists.txt' },
  { group: 'source', path: 'native/audio-host/src' },
  { group: 'scripts', path: 'scripts/build-audio-host.mjs' },
  { group: 'scripts', path: 'scripts/test-audio-engine.mjs' },
  { group: 'scripts', path: 'scripts/ensure-audio-host.mjs' },
];

const generatedOrVendorPathPrefixes = [
  'out/',
  'build/',
  'dist/',
  'node_modules/',
  'electron-app/build/',
  'electron-app/dist/',
  'native/audio-host/build/',
  'native/audio-host/out/',
  'native/audio-host/_deps/',
  'native/audio-host/cmake-build-',
];

const allowedReferenceCounts = new Map();

const usage = [
  'Usage: node scripts/check-audio-host-juce-inventory.mjs [--json] [--fail-on-any-production-reference]',
  '',
  'Scans production native audio-host source/build inputs for JUCE references,',
  'excluding generated output and vendor directories such as out/**, build/**,',
  'dist/**, node_modules/**, electron-app/build/**, and native audio-host _deps.',
  '',
  'Default mode compares current references with the explicit shrinkable allowlist',
  'embedded in this script and exits non-zero when new production references exceed it.',
  '',
  '--json emits machine-readable cmake/source/scripts groups.',
  '--fail-on-any-production-reference is the T12 final gate: it exits non-zero',
  '  whenever any production JUCE reference remains, ignoring the allowlist.',
].join('\n');

const normalizeRelativePath = (path) => path.split(sep).join('/');

const toProjectPath = (path) => normalizeRelativePath(relative(projectRoot, path));

const isExcludedPath = (projectPath) => generatedOrVendorPathPrefixes.some((prefix) => projectPath.startsWith(prefix));

const readTextFile = (filePath) => readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

const collectFiles = (targetPath, files = []) => {
  const absolutePath = join(projectRoot, targetPath);
  if (!existsSync(absolutePath)) {
    return files;
  }

  const projectPath = toProjectPath(absolutePath);
  if (isExcludedPath(projectPath)) {
    return files;
  }

  const stats = statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const name of readdirSync(absolutePath).sort((left, right) => left.localeCompare(right))) {
      collectFiles(join(targetPath, name), files);
    }
  } else if (stats.isFile()) {
    files.push(absolutePath);
  }

  return files;
};

const emptyGroups = () => ({
  cmake: [],
  source: [],
  scripts: [],
});

const scanFile = (filePath, group) => {
  const projectPath = toProjectPath(filePath);
  const matches = [];
  const lines = readTextFile(filePath).split('\n');

  lines.forEach((line, index) => {
    if (jucePattern.test(line)) {
      matches.push({
        group,
        file: projectPath,
        line: index + 1,
        text: line.trim(),
      });
    }
  });

  return matches;
};

const scanInventory = () => {
  const groups = emptyGroups();

  for (const target of productionScanTargets) {
    const files = collectFiles(target.path).sort((left, right) => toProjectPath(left).localeCompare(toProjectPath(right)));
    for (const filePath of files) {
      groups[target.group].push(...scanFile(filePath, target.group));
    }
  }

  return groups;
};

const summarizeGroups = (groups) => Object.fromEntries(
  Object.entries(groups).map(([group, matches]) => [group, {
    files: new Set(matches.map((match) => match.file)).size,
    references: matches.length,
  }]),
);

const countByFile = (groups) => {
  const counts = new Map();
  for (const matches of Object.values(groups)) {
    for (const match of matches) {
      counts.set(match.file, (counts.get(match.file) ?? 0) + 1);
    }
  }

  return counts;
};

const compareAllowlist = (groups) => {
  const actualCounts = countByFile(groups);
  const errors = [];
  const warnings = [];
  const allFiles = Array.from(new Set([...actualCounts.keys(), ...allowedReferenceCounts.keys()])).sort();

  for (const file of allFiles) {
    const actual = actualCounts.get(file) ?? 0;
    const expected = allowedReferenceCounts.get(file) ?? 0;
    if (actual > expected) {
      errors.push(`${file}: allowed ${expected}, found ${actual}`);
    } else if (actual < expected) {
      warnings.push(`${file}: allowed ${expected}, found ${actual}; shrink the allowlist when this removal is intentional`);
    }
  }

  return { errors, warnings };
};

const formatGroup = (group, matches) => {
  const byFile = new Map();
  for (const match of matches) {
    const current = byFile.get(match.file) ?? [];
    current.push(match);
    byFile.set(match.file, current);
  }

  const lines = [`[juce-inventory] ${group}: ${matches.length} reference(s) in ${byFile.size} file(s)`];
  for (const [file, fileMatches] of Array.from(byFile.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  ${file}: ${fileMatches.length}`);
    for (const match of fileMatches) {
      lines.push(`    ${match.line}: ${match.text}`);
    }
  }

  return lines.join('\n');
};

const printTextReport = (groups, allowlistErrors, allowlistWarnings, failOnAnyProductionReference) => {
  console.log('[juce-inventory] Production native audio-host JUCE references');
  console.log('[juce-inventory] Generated/vendor outputs are excluded from this source-only scan.');
  for (const [group, matches] of Object.entries(groups)) {
    console.log(formatGroup(group, matches));
  }

  if (failOnAnyProductionReference) {
    console.log('[juce-inventory] --fail-on-any-production-reference enabled; zero production JUCE references are required.');
  } else if (allowlistErrors.length === 0) {
    console.log('[juce-inventory] OK current references are within the explicit allowlist snapshot.');
    for (const warning of allowlistWarnings) {
      console.warn(`[juce-inventory] ${warning}`);
    }
  }
};

const parseArgs = () => {
  const options = {
    json: false,
    failOnAnyProductionReference: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--fail-on-any-production-reference') {
      options.failOnAnyProductionReference = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    } else {
      console.error(`[juce-inventory] Unknown argument: ${arg}`);
      console.error(usage);
      process.exit(1);
    }
  }

  return options;
};

const options = parseArgs();
const groups = scanInventory();
const { errors: allowlistErrors, warnings: allowlistWarnings } = compareAllowlist(groups);
const totalReferences = Object.values(groups).reduce((total, matches) => total + matches.length, 0);
const finalGateErrors = options.failOnAnyProductionReference && totalReferences > 0
  ? [`${totalReferences} production JUCE reference(s) remain`]
  : [];
const errors = options.failOnAnyProductionReference ? finalGateErrors : allowlistErrors;

if (options.json) {
  console.log(JSON.stringify({
    ok: errors.length === 0,
    failOnAnyProductionReference: options.failOnAnyProductionReference,
    excludedPathPrefixes: generatedOrVendorPathPrefixes,
    scanTargets: productionScanTargets,
    summary: summarizeGroups(groups),
    groups,
    allowlist: Object.fromEntries(Array.from(allowedReferenceCounts.entries()).sort(([left], [right]) => left.localeCompare(right))),
    errors,
    warnings: options.failOnAnyProductionReference ? [] : allowlistWarnings,
  }, null, 2));
} else {
  printTextReport(groups, allowlistErrors, allowlistWarnings, options.failOnAnyProductionReference);
  for (const error of errors) {
    console.error(`[juce-inventory] ${error}`);
  }
}

if (errors.length > 0) {
  process.exit(1);
}
