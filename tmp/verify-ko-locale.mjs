import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const locales = ['zhCN', 'zhTW', 'enUS', 'jaJP', 'koKR'];
for (const f of locales) {
  const s = readFileSync(join(root, `src/renderer/i18n/locales/${f}.ts`), 'utf8');
  console.log(f, 'has ko firstRun', s.includes("firstRun.language.ko-KR.description"));
}

const localesTs = readFileSync(join(root, 'src/renderer/i18n/locales.ts'), 'utf8');
console.log('Locale type has ko-KR', localesTs.includes("'ko-KR'"));
console.log('loader has ko-KR', localesTs.includes("koKR"));
console.log('isLocale has ko-KR', localesTs.includes("value === 'ko-KR'"));

const settings = readFileSync(join(root, 'src/renderer/pages/SettingsPage.tsx'), 'utf8');
console.log('settings en/ko', (settings.match(/'en-US':/g) || []).length, (settings.match(/'ko-KR':/g) || []).length);

const ko = readFileSync(join(root, 'src/renderer/i18n/locales/koKR.ts'), 'utf8');
console.log('koKR keys', (ko.match(/^  '/gm) || []).length);
console.log('sample restore', /'app\.window\.restore':\s*'([^']+)'/.exec(ko)?.[1]);
console.log('sample choose', /'firstRun\.language\.choose':\s*'([^']+)'/.exec(ko)?.[1]);
