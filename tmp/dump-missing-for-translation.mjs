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
    if (m[2] === '`' && m[3].includes('${')) continue;
    map.set(m[1], m[3]);
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
for (const [k, v] of zf) if (!tw.has(k)) tw.set(k, v);

const missingJa = [...zh.keys()].filter((k) => !ja.has(k)).sort();
const missingTw = [...zh.keys()].filter((k) => !tw.has(k)).sort();

const jaPayload = Object.fromEntries(missingJa.map((k) => [k, { en: en.get(k) ?? null, zh: zh.get(k) ?? null }]));
const twPayload = Object.fromEntries(missingTw.map((k) => [k, { en: en.get(k) ?? null, zh: zh.get(k) ?? null }]));

writeFileSync(join(root, 'tmp/missing-ja-payload.json'), JSON.stringify(jaPayload, null, 2));
writeFileSync(join(root, 'tmp/missing-tw-payload.json'), JSON.stringify(twPayload, null, 2));
console.log('ja', missingJa.length, 'tw', missingTw.length);
