import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src/renderer/i18n/locales');

function extract(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const map = new Map();
  const re = /['"]([a-zA-Z0-9_.]+)['"]\s*:\s*(['"`])([\s\S]*?)\2/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const quote = m[2];
    let value = m[3];
    if (quote === '`' && value.includes('${')) continue;
    map.set(key, value);
  }
  return map;
}

const zh = extract(join(localesDir, 'zhCN.ts'));
const en = extract(join(localesDir, 'enUS.ts'));
const tw = extract(join(localesDir, 'zhTW.ts'));
const ja = extract(join(localesDir, 'jaJP.ts'));
const zf = extract(join(localesDir, 'zhFamily.ts'));
const ef = extract(join(localesDir, 'enFamily.ts'));
for (const [k, v] of zf) zh.set(k, v);
for (const [k, v] of ef) {
  en.set(k, v);
  if (!ja.has(k)) ja.set(k, v);
}
for (const [k, v] of zf) {
  if (!tw.has(k)) tw.set(k, v);
}

const samples = [
  'app.window.close',
  'queue.drawer.aria',
  'settings.remote.hero.title',
  'common.collapse',
  'settings.eq.action.addFilter',
  'settings.eq.preset.meta.type.flat',
];
for (const k of samples) {
  console.log(k, { zh: zh.has(k), en: en.has(k), tw: tw.has(k), ja: ja.has(k) });
}

const zhKeys = [...zh.keys()].sort();
const missingTw = zhKeys.filter((k) => !tw.has(k));
const missingJa = zhKeys.filter((k) => !ja.has(k));
const missingEn = zhKeys.filter((k) => !en.has(k));

function byPrefix(keys) {
  const g = {};
  for (const k of keys) {
    const p = k.split('.').slice(0, 2).join('.');
    g[p] = (g[p] || 0) + 1;
  }
  return Object.entries(g).sort((a, b) => b[1] - a[1]);
}

const report = {
  counts: { zh: zh.size, en: en.size, tw: tw.size, ja: ja.size },
  missing: { en: missingEn.length, tw: missingTw.length, ja: missingJa.length },
  missingTwByPrefix: byPrefix(missingTw),
  missingJaByPrefix: byPrefix(missingJa),
  missingTw,
  missingJa,
  missingEn,
  enCjk: [...en.entries()].filter(([, v]) => /[\u4e00-\u9fff]/.test(v)).map(([k, v]) => ({ k, v, zh: zh.get(k) })),
};

writeFileSync(join(root, 'tmp/locale-missing-detail.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  counts: report.counts,
  missing: report.missing,
  missingTwByPrefix: report.missingTwByPrefix.slice(0, 25),
  missingJaByPrefix: report.missingJaByPrefix.slice(0, 25),
  enCjk: report.enCjk.length,
  enCjkSample: report.enCjk.slice(0, 5),
}, null, 2));
