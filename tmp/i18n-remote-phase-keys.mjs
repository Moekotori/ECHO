import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });

const entries = {
  'settings.remote.ux.phase.idle': { zh: '空闲', en: 'Idle', ja: '待機' },
  'settings.remote.ux.phase.testing': { zh: '测试连接', en: 'Testing connection', ja: '接続テスト' },
  'settings.remote.ux.phase.scanning': { zh: '扫描文件', en: 'Scanning files', ja: 'ファイルをスキャン' },
  'settings.remote.ux.phase.readingMetadata': { zh: '解析元数据', en: 'Reading metadata', ja: 'メタデータを解析' },
  'settings.remote.ux.phase.writingDatabase': { zh: '写入索引', en: 'Writing index', ja: 'インデックスを書き込み' },
  'settings.remote.ux.phase.markingMissing': { zh: '标记缺失', en: 'Marking missing', ja: '不足をマーク' },
  'settings.remote.ux.phase.finished': { zh: '已完成', en: 'Finished', ja: '完了' },
  'settings.remote.ux.phase.cancelled': { zh: '已取消', en: 'Cancelled', ja: 'キャンセル済み' },
  'settings.remote.ux.phase.failed': { zh: '失败', en: 'Failed', ja: '失敗' },
  'settings.remote.ux.issue.listed': {
    zh: '已列出 {name} 的 {kind} 问题。',
    en: 'Listed {kind} issues for {name}.',
    ja: '{name} の {kind} 問題を一覧しました。',
  },
  'settings.remote.ux.issue.none': {
    zh: '{name} 暂时没有 {kind} 问题。',
    en: '{name} has no {kind} issues right now.',
    ja: '{name} に {kind} 問題は今のところありません。',
  },
  'settings.remote.ux.browser.metadataLabel': { zh: '元数据 {status}', en: 'Metadata {status}', ja: 'メタデータ {status}' },
  'settings.remote.ux.browser.coverLabel': { zh: '封面 {status}', en: 'Cover {status}', ja: 'ジャケット {status}' },
  'settings.remote.ux.browser.lyricsLabel': { zh: '歌词 {status}', en: 'Lyrics {status}', ja: '歌詞 {status}' },
  'settings.remote.ux.issue.view': { zh: '查看{kind}问题', en: 'View {kind} issues', ja: '{kind} の問題を表示' },
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
  const point = "| 'streaming.message.albumDownloadFinishedPartial';";
  if (locales.includes(point)) {
    locales = locales.replace(point, `${point}\n${union};`);
  } else {
    locales = locales.replace(
      "| 'playlists.error.playlistDownloadJobFailed';",
      `| 'playlists.error.playlistDownloadJobFailed'\n${union};`,
    );
  }
  writeFileSync('src/renderer/i18n/locales.ts', locales);
  console.log('keys', keys.length);
}
