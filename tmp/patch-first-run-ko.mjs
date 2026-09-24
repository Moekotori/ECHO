import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src/renderer/i18n/locales/zhCN.ts',
  'src/renderer/i18n/locales/zhTW.ts',
  'src/renderer/i18n/locales/enUS.ts',
  'src/renderer/i18n/locales/jaJP.ts',
];

const line = "  'firstRun.language.ko-KR.description': '메뉴, 가이드 및 설정에 한국어를 사용합니다.',";

for (const rel of files) {
  const path = join(root, rel);
  let s = readFileSync(path, 'utf8');
  if (s.includes("'firstRun.language.ko-KR.description'")) {
    console.log('skip', rel);
    continue;
  }
  const needle = "'firstRun.language.ja-JP.description'";
  const idx = s.indexOf(needle);
  if (idx < 0) {
    console.log('no ja key', rel);
    continue;
  }
  // find end of this entry (first comma after the value)
  const after = s.indexOf(',', idx);
  if (after < 0) {
    console.log('no comma', rel);
    continue;
  }
  s = s.slice(0, after + 1) + '\n' + line + s.slice(after + 1);
  writeFileSync(path, s, 'utf8');
  console.log('patched', rel);
}
