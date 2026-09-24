import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const renderer = join(root, 'src/renderer');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'i18n') continue;
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const cjk = /[\u4e00-\u9fff]/;
const files = walk(renderer);
const results = [];

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!cjk.test(line)) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    // skip pure type/comment blocks
    results.push({
      file: relative(root, f).replace(/\\/g, '/'),
      line: i + 1,
      text: trimmed.slice(0, 200),
    });
  }
}

const byFile = new Map();
for (const r of results) byFile.set(r.file, (byFile.get(r.file) || 0) + 1);
const ranked = [...byFile.entries()].sort((a, b) => b[1] - a[1]);

const report = {
  fileCount: ranked.length,
  lineCount: results.length,
  ranked: ranked.slice(0, 50),
  samples: Object.fromEntries(
    ranked.slice(0, 12).map(([f]) => [f, results.filter((r) => r.file === f).slice(0, 20)]),
  ),
};

writeFileSync(join(root, 'tmp/hardcoded-cjk-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ fileCount: report.fileCount, lineCount: report.lineCount, top: ranked.slice(0, 30) }, null, 2));
