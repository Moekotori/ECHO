import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });

const entries = {
  'playlists.message.enqueueingPlaylist': {
    zh: '正在按歌单顺序加入下载队列：{name}',
    en: 'Queuing downloads in playlist order: {name}',
    ja: 'プレイリスト順でダウンロードキューに追加中: {name}',
  },
  'playlists.error.noDownloadableTracks': {
    zh: '这个歌单里没有可下载的网络歌曲。',
    en: 'This playlist has no downloadable streaming tracks.',
    ja: 'このプレイリストにはダウンロード可能なストリーム曲がありません。',
  },
  'playlists.message.playlistQueued': {
    zh: '已按歌单顺序加入下载队列：{count} 首',
    en: 'Queued playlist downloads in order: {count} tracks',
    ja: 'プレイリスト順でダウンロードキューに追加しました: {count} 曲',
  },
  'playlists.message.playlistQueuedPartial': {
    zh: '已按歌单顺序加入下载队列：{enqueued} 首，{failed} 首未能解析。',
    en: 'Queued playlist downloads: {enqueued} tracks, {failed} failed to resolve.',
    ja: 'プレイリスト順で追加: {enqueued} 曲、解決失敗 {failed} 曲。',
  },
  'playlists.error.playlistDownloadJobFailed': {
    zh: '添加歌单下载任务失败',
    en: 'Failed to queue playlist downloads',
    ja: 'プレイリストのダウンロード追加に失敗しました',
  },
};

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function insert(file, locale) {
  let t = readFileSync(file, 'utf8');
  let n = 0;
  for (const [k, v] of Object.entries(entries)) {
    if (t.includes(`'${k}'`)) continue;
    const val = locale === 'en' ? v.en : locale === 'ja' ? v.ja : locale === 'tw' ? toTw(v.zh) : v.zh;
    const line = `  '${k}': '${esc(val)}',`;
    const idx = t.lastIndexOf('\n};');
    t = `${t.slice(0, idx)}\n${line}${t.slice(idx)}`;
    n += 1;
  }
  if (n) writeFileSync(file, t);
  return n;
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
  const point = "| 'playlists.error.chooseDownloadFolder';";
  if (locales.includes(point)) {
    locales = locales.replace(point, `${point}\n${union};`);
  } else {
    locales = locales.replace("| 'playlists.error.playlistService';", `| 'playlists.error.playlistService'\n${union};`);
  }
  writeFileSync('src/renderer/i18n/locales.ts', locales);
  console.log('keys', keys.length);
}
