import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });

const entries = {
  'inboxPage.message.stateUpdated': {
    zh: '已标记为{status} {count} 首。',
    en: 'Marked {count} tracks as {status}.',
    ja: '{count} 曲を {status} にしました。',
  },
  'inboxPage.message.stateUpdatedTruncated': {
    zh: '已标记为{status} {count} 首，已按上限处理前 {limit} 首。',
    en: 'Marked {count} tracks as {status} (limit: first {limit}).',
    ja: '{count} 曲を {status} にしました（上限: 先頭 {limit} 曲）。',
  },
};

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function insert(file, locale) {
  let t = readFileSync(file, 'utf8');
  const missing = Object.entries(entries).filter(([k]) => !t.includes(`'${k}'`));
  if (!missing.length) return 0;
  const block = missing
    .map(([k, v]) => {
      const val = locale === 'en' ? v.en : locale === 'ja' ? v.ja : locale === 'tw' ? toTw(v.zh) : v.zh;
      return `  '${k}': '${esc(val)}',`;
    })
    .join('\n');
  const idx = t.lastIndexOf('\n};');
  writeFileSync(file, `${t.slice(0, idx)}\n${block}${t.slice(idx)}`);
  return missing.length;
}

for (const [f, l] of [
  ['zhCN', 'zh'],
  ['enUS', 'en'],
  ['zhTW', 'tw'],
  ['jaJP', 'ja'],
]) {
  console.log(l, insert(`src/renderer/i18n/locales/${f}.ts`, l));
}

let locales = readFileSync('src/renderer/i18n/locales.ts', 'utf8');
const keys = Object.keys(entries).filter((k) => !locales.includes(`'${k}'`));
if (keys.length) {
  const union = keys.map((k) => `  | '${k}'`).join('\n');
  const point = "| 'playlists.error.playlistService';";
  if (locales.includes(point)) {
    locales = locales.replace(point, `${point}\n${union};`);
  } else {
    locales = locales.replace("| 'error.code.opraUnavailable';", `| 'error.code.opraUnavailable'\n${union};`);
  }
  writeFileSync('src/renderer/i18n/locales.ts', locales);
  console.log('keys', keys);
}
