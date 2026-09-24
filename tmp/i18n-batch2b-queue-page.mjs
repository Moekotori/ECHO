import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src/renderer/i18n/locales');

const entries = {
  'queue.page.notice.hiddenMore': { zh: '还有 {count} {unit}', en: '{count} more {unit}', ja: 'ほか {count} {unit}' },
  'queue.page.notice.clearedCount': { zh: '已清空 {count} 首', en: 'Cleared {count} tracks', ja: '{count} 曲をクリアしました' },
  'queue.page.notice.removedCount': { zh: '已移除 {count} 首', en: 'Removed {count} tracks', ja: '{count} 曲を削除しました' },
  'queue.page.notice.movedCount': { zh: '已临时插播 {count} 首', en: 'Inserted {count} tracks next', ja: '{count} 曲を次に挿入しました' },
  'queue.page.action.moveAfter': { zh: '临时插播', en: 'Play next', ja: '次に再生' },
  'queue.page.action.removeSelected': { zh: '移除所选', en: 'Remove selected', ja: '選択を削除' },
  'queue.page.action.clearSelection': { zh: '清除选择', en: 'Clear selection', ja: '選択をクリア' },
  'queue.page.action.undo': { zh: '撤销', en: 'Undo', ja: '元に戻す' },
  'queue.page.receipt.justDone': { zh: '刚刚完成', en: 'Just completed', ja: '完了しました' },
  'queue.page.receipt.undoThis': { zh: '撤销这次操作', en: 'Undo this action', ja: 'この操作を元に戻す' },
  'queue.page.saved.heading': { zh: '已保存队列', en: 'Saved queues', ja: '保存済みキュー' },
  'queue.page.saved.snapshotCount': { zh: '{count} 个快照', en: '{count} snapshots', ja: '{count} 件のスナップショット' },
  'queue.page.saved.trackMeta': { zh: '{count} 首 / {date}', en: '{count} tracks / {date}', ja: '{count} 曲 / {date}' },
  'queue.page.saved.restore': { zh: '恢复', en: 'Restore', ja: '復元' },
  'queue.page.saved.sourceLabel': { zh: '保存队列：{name}', en: 'Saved queue: {name}', ja: '保存キュー: {name}' },
  'queue.page.saved.nameWithTitle': { zh: '{title} 等 {count} 首', en: '{title} and {count} tracks', ja: '{title} ほか {count} 曲' },
  'queue.page.saved.nameQueue': { zh: '队列 {date}', en: 'Queue {date}', ja: 'キュー {date}' },
  'queue.page.columns.titleArtist': { zh: '标题 / 艺术家', en: 'Title / Artist', ja: 'タイトル / アーティスト' },
  'queue.page.columns.source': { zh: '来源', en: 'Source', ja: 'ソース' },
  'queue.page.columns.quality': { zh: '音质', en: 'Quality', ja: '音質' },
  'queue.page.columns.duration': { zh: '时长', en: 'Duration', ja: '時間' },
  'queue.page.undo.clear': { zh: '清空 {count} 首', en: 'Clear {count} tracks', ja: '{count} 曲をクリア' },
  'queue.page.undo.removeTitle': { zh: '移除 {title}', en: 'Remove {title}', ja: '{title} を削除' },
  'queue.page.undo.removeCount': { zh: '移除 {count} 首', en: 'Remove {count} tracks', ja: '{count} 曲を削除' },
  'queue.page.undo.moveCount': { zh: '临时插播 {count} 首', en: 'Insert {count} tracks next', ja: '{count} 曲を次に挿入' },
  'queue.page.undo.playNext': { zh: '插播 {title}', en: 'Play next: {title}', ja: '次に再生: {title}' },
};

function escapeTs(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function insert(file, locale) {
  let text = readFileSync(file, 'utf8');
  const missing = Object.entries(entries).filter(([k]) => !text.includes(`'${k}'`));
  if (!missing.length) return 0;
  const block = missing
    .map(([k, v]) => {
      const value = locale === 'en' ? v.en : locale === 'ja' ? v.ja : locale === 'tw' ? toTw(v.zh) : v.zh;
      return `  '${k}': '${escapeTs(value)}',`;
    })
    .join('\n');
  const idx = text.lastIndexOf('\n};');
  writeFileSync(file, `${text.slice(0, idx)}\n  // --- queue page extra ---\n${block}${text.slice(idx)}`, 'utf8');
  return missing.length;
}

for (const [file, loc] of [
  ['zhCN.ts', 'zh'],
  ['enUS.ts', 'en'],
  ['zhTW.ts', 'tw'],
  ['jaJP.ts', 'ja'],
]) {
  console.log(loc, insert(join(localesDir, file), loc));
}

let localesTs = readFileSync(join(root, 'src/renderer/i18n/locales.ts'), 'utf8');
const toAdd = Object.keys(entries).filter((k) => !localesTs.includes(`'${k}'`));
if (toAdd.length) {
  const union = toAdd.map((k) => `  | '${k}'`).join('\n');
  localesTs = localesTs.replace("| 'crashGuard.summary';", `| 'crashGuard.summary'\n${union};`);
  writeFileSync(join(root, 'src/renderer/i18n/locales.ts'), localesTs, 'utf8');
  console.log('keys', toAdd.length);
}
