import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });

const entries = {
  'playlists.message.addedToQueue': {
    zh: '已添加 {count} 首可用歌曲到队列',
    en: 'Added {count} playable tracks to the queue',
    ja: '再生可能な {count} 曲をキューに追加しました',
  },
  'playlists.message.downloadQueued': {
    zh: '已加入下载队列：{title}',
    en: 'Queued download: {title}',
    ja: 'ダウンロードキューに追加: {title}',
  },
  'playlists.error.downloadJobFailed': {
    zh: '添加下载任务失败',
    en: 'Failed to create download job',
    ja: 'ダウンロードタスクの作成に失敗しました',
  },
  'playlists.error.playlistDownloadOnlyOnline': {
    zh: '只有可下载的网络歌单支持整歌单下载。',
    en: 'Only downloadable online playlists support whole-playlist download.',
    ja: 'ダウンロード可能なオンラインプレイリストのみ一括ダウンロードに対応しています。',
  },
  'playlists.error.chooseDownloadFolder': {
    zh: '请先在下载页选择下载文件夹。',
    en: 'Choose a download folder on the Downloads page first.',
    ja: '先にダウンロードページでフォルダーを選択してください。',
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
  const point = "| 'inboxPage.message.stateUpdatedTruncated';";
  if (locales.includes(point)) {
    locales = locales.replace(point, `${point}\n${union};`);
  } else {
    locales = locales.replace("| 'playlists.error.playlistService';", `| 'playlists.error.playlistService'\n${union};`);
  }
  writeFileSync('src/renderer/i18n/locales.ts', locales);
  console.log('keys', keys.length);
}
