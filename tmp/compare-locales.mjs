/**
 * Compare locale dictionaries for missing / untranslated keys.
 * Run: node --experimental-strip-types tmp/compare-locales.mjs
 * or via vitest/tsx if needed.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function loadTs(rel) {
  // Prefer dynamic import of compiled-ish path via tsx registration if available
  const full = join(root, rel);
  try {
    const mod = await import(pathToFileURL(full).href);
    return mod;
  } catch (err) {
    console.error('Failed import', full, err);
    throw err;
  }
}

// Parse keys from TypeScript locale objects by regex (avoid TS runtime)
import { readFileSync } from 'node:fs';

function extractKeysAndValues(filePath) {
  const text = readFileSync(filePath, 'utf8');
  // Match 'key': 'value' or "key": "value" with simple single-line strings
  const map = new Map();
  const re = /['"]([a-zA-Z0-9_.]+)['"]\s*:\s*(['"`])([\s\S]*?)\2/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const quote = m[2];
    let value = m[3];
    // skip template with ${} complexity partially
    if (quote === '`' && value.includes('${')) continue;
    // unescape common sequences
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    map.set(key, value);
  }
  return map;
}

const localesDir = join(root, 'src/renderer/i18n/locales');
const zhCN = extractKeysAndValues(join(localesDir, 'zhCN.ts'));
const enUS = extractKeysAndValues(join(localesDir, 'enUS.ts'));
const zhTW = extractKeysAndValues(join(localesDir, 'zhTW.ts'));
const jaJP = extractKeysAndValues(join(localesDir, 'jaJP.ts'));
const zhFamily = extractKeysAndValues(join(localesDir, 'zhFamily.ts'));
const enFamily = extractKeysAndValues(join(localesDir, 'enFamily.ts'));

// Merge family into main (how exports work)
for (const [k, v] of zhFamily) zhCN.set(k, v);
for (const [k, v] of enFamily) {
  enUS.set(k, v);
  // ja imports enFamily
  if (!jaJP.has(k)) jaJP.set(k, v);
}
// zhTW imports zhFamily as aliases
for (const [k, v] of zhFamily) {
  if (!zhTW.has(k)) zhTW.set(k, v);
}

const zhKeys = [...zhCN.keys()].sort();
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
const hasKana = (s) => /[\u3040-\u30ff]/.test(s);

const missingEn = zhKeys.filter((k) => !enUS.has(k));
const missingTw = zhKeys.filter((k) => !zhTW.has(k));
const missingJa = zhKeys.filter((k) => !jaJP.has(k));

const enWithCjk = [...enUS.entries()].filter(([, v]) => hasCJK(v)).map(([k]) => k);
const enEqualsZh = zhKeys.filter((k) => enUS.has(k) && enUS.get(k) === zhCN.get(k) && hasCJK(enUS.get(k)));
const jaChineseOnly = [...jaJP.entries()]
  .filter(([, v]) => hasCJK(v) && !hasKana(v))
  .map(([k]) => k);
const jaEqualsEnLong = zhKeys.filter((k) => {
  const j = jaJP.get(k);
  const e = enUS.get(k);
  return j && e && j === e && j.length > 12 && !hasKana(j);
});

// Group missing by prefix
function groupByPrefix(keys) {
  const groups = {};
  for (const k of keys) {
    const prefix = k.split('.').slice(0, 2).join('.');
    groups[prefix] = (groups[prefix] || 0) + 1;
  }
  return Object.entries(groups).sort((a, b) => b[1] - a[1]);
}

const report = {
  counts: {
    zhCN: zhCN.size,
    enUS: enUS.size,
    zhTW: zhTW.size,
    jaJP: jaJP.size,
  },
  missing: {
    en: missingEn.length,
    tw: missingTw.length,
    ja: missingJa.length,
  },
  missingEnByPrefix: groupByPrefix(missingEn),
  missingTwByPrefix: groupByPrefix(missingTw),
  missingJaByPrefix: groupByPrefix(missingJa),
  enWithCjk: enWithCjk.length,
  enEqualsZh: enEqualsZh.length,
  jaChineseOnly: jaChineseOnly.length,
  jaEqualsEnLong: jaEqualsEnLong.length,
  sampleMissingEn: missingEn.slice(0, 150),
  sampleMissingTw: missingTw.slice(0, 150),
  sampleMissingJa: missingJa.slice(0, 150),
  sampleEnWithCjk: enWithCjk.slice(0, 60),
  sampleEnEqualsZh: enEqualsZh.slice(0, 60),
  sampleJaChineseOnly: jaChineseOnly.slice(0, 60),
  sampleJaEqualsEnLong: jaEqualsEnLong.slice(0, 60),
  allMissingEn: missingEn,
  allMissingTw: missingTw,
  allMissingJa: missingJa,
};

const outPath = join(root, 'tmp/locale-compare-report.json');
writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log('Wrote', outPath);
console.log(JSON.stringify({
  counts: report.counts,
  missing: report.missing,
  missingEnByPrefix: report.missingEnByPrefix.slice(0, 30),
  missingTwByPrefix: report.missingTwByPrefix.slice(0, 30),
  missingJaByPrefix: report.missingJaByPrefix.slice(0, 30),
  enWithCjk: report.enWithCjk,
  enEqualsZh: report.enEqualsZh,
  jaChineseOnly: report.jaChineseOnly,
  jaEqualsEnLong: report.jaEqualsEnLong,
}, null, 2));
