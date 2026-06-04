import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const checkedExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
]);
const ignoredDirectories = new Set([
  '.electron-cache',
  '.git',
  'dist',
  'node_modules',
  'out',
]);
const ignoredFiles = new Set([
  'scripts\\check-encoding.mjs',
  'scripts/check-encoding.mjs',
]);

const suspiciousPatterns = [
  /\uFFFD/u,
  /Ã[\u0080-\uFFFF]/u,
  /Â[\u0080-\uFFFF]/u,
  /â[€™“”€¦–—]/u,
  /鎴戠/u,
  /鏇茬/u,
  /瀵煎/u,
  /涓嬭/u,
  /鍒锋/u,
  /鎵/u,
  /閫氱/u,
  /璇/u,
  /鎾/u,
  /鎼滅/u,
  /绠€/u,
  /绻侀/u,
  /鏃ユ/u,
  /榛樿/u,
  /鎸夎/u,
  /鏈€/u,
  /姝ｅ/u,
  /娌℃/u,
  /闊抽/u,
  /璁剧/u,
  /澶栬/u,
  /濯掍/u,
  /鍏充/u,
  /銆/u,
];

const htmlCharsetPattern = /<meta\s+charset=["']?utf-8["']?\s*\/?>/iu;

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

    if (entry.isFile() && checkedExtensions.has(extname(entry.name))) {
      const filePath = join(directory, entry.name);

      if (!ignoredFiles.has(relative(root, filePath))) {
        files.push(filePath);
      }
    }
  }

  return files;
};

const files = await walk(root);
const failures = [];

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const relativePath = relative(root, file);

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(text)) {
      failures.push(`${relativePath}: suspicious mojibake pattern ${pattern}`);
    }
  }

  if (extname(file) === '.html' && !htmlCharsetPattern.test(text)) {
    failures.push(`${relativePath}: missing UTF-8 charset meta tag`);
  }
}

if (failures.length > 0) {
  console.error('Encoding check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Encoding check passed for ${files.length} text files.`);
}
