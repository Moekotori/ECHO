import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcRoot = join(projectRoot, 'src');

const runtimeSourcePattern = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;
const ignoredSourcePattern = /(?:^|[\\/])(?:.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)|.*\.d\.ts)$/u;

const forbiddenRuntimeSecrets: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'private key PEM block',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u,
  },
  {
    label: 'ECHO Pro license private key env',
    pattern: /\bECHO_PRO_LICENSE_PRIVATE_KEY(?:_PEM|_FILE)?\b/u,
  },
  {
    label: 'package integrity private key env',
    pattern: /\bECHO_PACKAGE_INTEGRITY_PRIVATE_KEY(?:_PEM|_FILE)?\b/u,
  },
  {
    label: 'ECHO Pro watermark key env',
    pattern: /\bECHO_PRO_WATERMARK_KEY\b/u,
  },
];

const walkFiles = (root: string): string[] => {
  const output: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current)) {
      const entryPath = join(current, entry);
      const info = statSync(entryPath);
      if (info.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (info.isFile()) {
        output.push(entryPath);
      }
    }
  }
  return output.sort((left, right) => left.localeCompare(right));
};

describe('runtime secret boundary', () => {
  it('keeps ECHO signing secrets out of app runtime source', () => {
    const findings: string[] = [];
    for (const filePath of walkFiles(srcRoot)) {
      if (!runtimeSourcePattern.test(filePath) || ignoredSourcePattern.test(filePath)) {
        continue;
      }
      const source = readFileSync(filePath, 'utf8');
      for (const { label, pattern } of forbiddenRuntimeSecrets) {
        if (pattern.test(source)) {
          findings.push(`${relative(projectRoot, filePath)}: ${label}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it('does not package signing scripts with the app runtime', () => {
    const packageJsonPath = join(projectRoot, 'package.json');
    expect(existsSync(packageJsonPath)).toBe(true);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      build?: { files?: unknown[] };
    };
    const packagedFiles = packageJson.build?.files ?? [];
    const packagedFileEntries = packagedFiles.map((entry) => String(entry).replace(/\\/gu, '/'));

    expect(packagedFileEntries.some((entry) => entry === 'scripts/**' || entry.startsWith('scripts/'))).toBe(false);
  });
});
