import { readFileSync } from 'node:fs';
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

const missingTw = [...zh.keys()].filter((k) => !tw.has(k)).sort();
const missingJa = [...zh.keys()].filter((k) => !ja.has(k)).sort();

console.log('TW remote missing count', missingTw.filter((k) => k.startsWith('settings.remote.')).length);
console.log(missingTw.filter((k) => k.startsWith('settings.remote.')).slice(0, 40).join('\n'));
console.log('--- JA remote missing sample ---');
console.log(missingJa.filter((k) => k.startsWith('settings.remote.')).slice(0, 40).join('\n'));
console.log('--- sample zh values for first 5 remote missing ---');
for (const k of missingTw.filter((k) => k.startsWith('settings.remote.')).slice(0, 5)) {
  console.log(k);
  console.log('  zh:', zh.get(k));
  console.log('  en:', en.get(k));
}
