/**
 * Fill missing i18n keys for zh-TW / ja-JP and fix en-US Chinese leftovers.
 *
 * - zh-TW: OpenCC cn→twp conversion from zh-CN values
 * - ja-JP: curated translations for missing keys (fallback to English if unmapped)
 * - en-US: translate leftover CJK EQ preset display names
 *
 * Run: node tmp/fill-missing-locales.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const converter = OpenCC.Converter({ from: 'cn', to: 'twp' });

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
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    map.set(key, value);
  }
  return map;
}

function escapeTsString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

function insertEntries(filePath, entries) {
  if (entries.length === 0) return 0;
  let text = readFileSync(filePath, 'utf8');
  // Find last property before closing `};` of the main export object.
  // Prefer inserting before the final `};` of the file.
  const closingIdx = text.lastIndexOf('\n};');
  if (closingIdx < 0) {
    throw new Error(`Could not find closing }; in ${filePath}`);
  }
  const block = entries
    .map(([k, v]) => `  '${k}': '${escapeTsString(v)}',`)
    .join('\n');
  // Ensure previous line ends with comma
  const before = text.slice(0, closingIdx);
  const after = text.slice(closingIdx);
  // If last non-whitespace before closing doesn't end with comma, add one
  const trimmedEnd = before.replace(/\s+$/u, '');
  let prefix = before;
  if (!trimmedEnd.endsWith(',')) {
    // insert comma after last line content
    const lastNl = before.lastIndexOf('\n');
    // keep as-is; most locale files have trailing commas
  }
  text = `${before}\n  // --- auto-filled missing keys (${entries.length}) ---\n${block}${after}`;
  writeFileSync(filePath, text, 'utf8');
  return entries.length;
}

function replaceValues(filePath, replacements) {
  let text = readFileSync(filePath, 'utf8');
  let count = 0;
  for (const [key, value] of replacements) {
    const re = new RegExp(`('${key.replace(/\./g, '\\.')}'\\s*:\\s*)(['"\`])([\\s\\S]*?)\\2`);
    const next = text.replace(re, (_m, head, quote) => {
      count += 1;
      if (quote === '`') {
        return `${head}\`${escapeTsString(value).replace(/\\'/g, "'")}\``;
      }
      return `${head}'${escapeTsString(value)}'`;
    });
    if (next !== text) text = next;
  }
  writeFileSync(filePath, text, 'utf8');
  return count;
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

const zhKeys = [...zh.keys()].sort();
const missingTw = zhKeys.filter((k) => !tw.has(k));
const missingJa = zhKeys.filter((k) => !ja.has(k));
const missingEn = zhKeys.filter((k) => !en.has(k));

// Brand/provider names — same across locales
const brandKeys = new Set([
  'accountProvider.bilibili',
  'accountProvider.osu',
  'accountProvider.qobuz',
  'accountProvider.qqmusic',
  'accountProvider.soundcloud',
  'accountProvider.spotify',
  'accountProvider.tidal',
  'accountProvider.youtube',
  'accountProvider.kugou',
  'accountProvider.netease',
  'accountProvider.unknown',
]);

// English EQ preset display names (poetic, matching Chinese intent)
const enEqPresetNames = {
  'settings.eq.preset.meta.type.animeJpop': 'Sakura Radio',
  'settings.eq.preset.meta.type.acousticSilk': 'Acoustic Silk',
  'settings.eq.preset.meta.type.bassBoost': 'Deep Sea Bass',
  'settings.eq.preset.meta.type.bkRoomCurve': 'Wooden Hall Curve',
  'settings.eq.preset.meta.type.broadcastVoice': 'Broadcast Voice',
  'settings.eq.preset.meta.type.bluetoothSpeakerCleanup': 'Bluetooth Cleanup',
  'settings.eq.preset.meta.type.classicSmiley': 'Classic Smiley',
  'settings.eq.preset.meta.type.classical': 'Concert Hall Classical',
  'settings.eq.preset.meta.type.cinemaOrchestra': 'Cinema Depth',
  'settings.eq.preset.meta.type.cityPop': 'Neon City Pop',
  'settings.eq.preset.meta.type.diffuseField': 'Diffuse Field',
  'settings.eq.preset.meta.type.femaleVocalAir': 'Airy Female Vocals',
  'settings.eq.preset.meta.type.flat': 'True Flat',
  'settings.eq.preset.meta.type.harmanInEar': 'Harman In-Ear Glow',
  'settings.eq.preset.meta.type.harmanTarget': 'Warm Harman Target',
  'settings.eq.preset.meta.type.headphoneNotch': 'Headphone Peak Trim',
  'settings.eq.preset.meta.type.headphoneWarm': 'Warm Headphones',
  'settings.eq.preset.meta.type.liveHouse': 'Live House',
  'settings.eq.preset.meta.type.lofiDusk': 'Lo-Fi Dusk',
  'settings.eq.preset.meta.type.loudness': 'Evening Loudness',
  'settings.eq.preset.meta.type.night': 'Night Listening',
  'settings.eq.preset.meta.type.pianoRoom': 'Piano Room Glow',
  'settings.eq.preset.meta.type.rock': 'Obsidian Rock',
  'settings.eq.preset.meta.type.sibilanceTamer': 'Sibilance Tamer',
  'settings.eq.preset.meta.type.studioNeutral': 'Studio Neutral',
  'settings.eq.preset.meta.type.subCleanup': 'Sub Cleanup',
  'settings.eq.preset.meta.type.subsonicFilter': 'Subsonic Filter',
  'settings.eq.preset.meta.type.trebleSparkle': 'Treble Sparkle',
  'settings.eq.preset.meta.type.vinylWarmth': 'Vinyl Warmth',
  'settings.eq.preset.meta.type.vocalClear': 'Silk Vocals',
  'settings.eq.preset.meta.type.vocalDeEss': 'Soft De-Ess',
};

// Japanese curated translations for common missing keys.
// Keys not listed fall back to English (better than Simplified Chinese fallback).
const jaCurated = {
  'common.collapse': '折りたたむ',
  'common.expand': '展開',
  'queue.drawer.aria': '再生キュードロワー',
  'queue.drawer.clear': 'クリア',
  'queue.drawer.close': '再生キューを閉じる',
  'queue.drawer.fullQueue': '完全なキュー',
  'queue.drawer.removeTitle': '削除',
  'queue.drawer.rowActions': '{title} のキュー操作',
  'queue.drawer.shuffleScope': 'シャッフル範囲: {scope} · 直近 {count} 曲を避ける',
  'queue.drawer.sourcePrefix': '{source} から',
  'queue.drawer.waitingCount': '待機 {count} 曲',
  'downloads.error.osuOnlyUrl': 'osu! ダウンローダーは osu のリンクのみ対応しています',
  'downloads.folder.osuRequired': '先に osu 出力フォルダーを選択してください',
  'downloads.settings.osuMirror.title': 'osu ミラー',
  'downloads.settings.osuMirror.auto': '自動',
  'downloads.settings.osuMirror.autoDetail': '可用性に応じてミラーを自動選択',
  'downloads.settings.osuMirror.official': '公式',
  'downloads.settings.osuMirror.officialDetail': '公式 osu! サーバーを使用',
  'downloads.settings.osuMirror.catboy': 'catboy',
  'downloads.settings.osuMirror.nerinyan': 'nerinyan',
  'downloads.settings.osuMirror.sayobot': 'Sayobot',
  'downloads.settings.osuMirror.mirrorDetail': 'コミュニティミラーを使用',
  'downloads.settings.osuOutputDirectory': 'osu 出力フォルダー',
  'settings.appearance.font.chinese.title': '中国語フォント',
  'settings.appearance.font.chinese.description': '中国語 UI と歌詞に使うフォントファミリー',
  'settings.appearance.font.choose': 'フォントを選択',
  'settings.appearance.font.fallback.title': 'フォールバックフォント',
  'settings.appearance.font.fallback.description': 'メインフォントに欠けている文字の代替',
  'settings.appearance.font.main.title': 'メインフォント',
  'settings.appearance.font.main.description': 'アプリ全体の既定フォント',
  'settings.appearance.fontSize.title': 'フォントサイズ',
  'settings.appearance.fontSize.description': 'インターフェイスの基準フォントサイズ',
  'settings.appearance.lineHeight.title': '行間',
  'settings.appearance.lineHeight.description': '本文とリストの行の高さ',
  'settings.appearance.reset.action': '外観をリセット',
  'settings.appearance.reset.description': 'タイポグラフィ関連の設定を既定値に戻す',
  'settings.appearance.reset.title': '外観をリセット',
  'settings.appearance.textDepth.title': '文字の奥行き',
  'settings.appearance.textDepth.description': 'テキストのコントラストと階層感',
  'settings.appearance.typography.collapse': 'タイポグラフィを閉じる',
  'settings.appearance.typography.expand': 'タイポグラフィを展開',
  // EQ preset names (poetic JP)
  'settings.eq.preset.meta.type.animeJpop': '桜色電波',
  'settings.eq.preset.meta.type.acousticSilk': 'アコースティックシルク',
  'settings.eq.preset.meta.type.bassBoost': 'ディープシー低音',
  'settings.eq.preset.meta.type.bkRoomCurve': '木ホール曲線',
  'settings.eq.preset.meta.type.broadcastVoice': '放送ボイス',
  'settings.eq.preset.meta.type.bluetoothSpeakerCleanup': 'Bluetooth クリーンアップ',
  'settings.eq.preset.meta.type.classicSmiley': 'クラシックスマイリー',
  'settings.eq.preset.meta.type.classical': 'コンサートホール古典',
  'settings.eq.preset.meta.type.cinemaOrchestra': 'シネマ奥行き',
  'settings.eq.preset.meta.type.cityPop': 'ネオンシティポップ',
  'settings.eq.preset.meta.type.diffuseField': '拡散フィールド',
  'settings.eq.preset.meta.type.femaleVocalAir': '澄んだ女性ボーカル',
  'settings.eq.preset.meta.type.flat': 'フラット原音',
  'settings.eq.preset.meta.type.harmanInEar': 'Harman インイヤー',
  'settings.eq.preset.meta.type.harmanTarget': 'ウォーム Harman',
  'settings.eq.preset.meta.type.headphoneNotch': 'ヘッドホンピーク調整',
  'settings.eq.preset.meta.type.headphoneWarm': 'ウォームヘッドホン',
  'settings.eq.preset.meta.type.liveHouse': 'ライブハウス',
  'settings.eq.preset.meta.type.lofiDusk': 'Lo-Fi ダスク',
  'settings.eq.preset.meta.type.loudness': '夕暮れラウドネス',
  'settings.eq.preset.meta.type.night': 'ナイトリスニング',
  'settings.eq.preset.meta.type.pianoRoom': 'ピアノルーム',
  'settings.eq.preset.meta.type.rock': 'オブシディアンロック',
  'settings.eq.preset.meta.type.sibilanceTamer': '歯擦音抑制',
  'settings.eq.preset.meta.type.studioNeutral': 'スタジオニュートラル',
  'settings.eq.preset.meta.type.subCleanup': 'サブクリーンアップ',
  'settings.eq.preset.meta.type.subsonicFilter': 'サブソニックフィルター',
  'settings.eq.preset.meta.type.trebleSparkle': 'トレブルスパークル',
  'settings.eq.preset.meta.type.vinylWarmth': 'ビニールの温もり',
  'settings.eq.preset.meta.type.vocalClear': 'シルクボーカル',
  'settings.eq.preset.meta.type.vocalDeEss': 'ソフトデエス',
};

// Pattern-based Japanese helpers for remaining settings keys from English source.
function toJapanese(key, enValue, zhValue) {
  if (jaCurated[key]) return jaCurated[key];
  if (brandKeys.has(key) || brandKeys.has(key.replace(/\..*$/, ''))) {
    // keep brand names as English product names
    return enValue || zhValue;
  }
  if (key.startsWith('accountProvider.')) {
    return enValue || zhValue;
  }

  // Prefer English for technical keys if no curated translation — still better than zh-CN fallback.
  // Apply light phrase replacements for common UI vocabulary when source is English.
  if (!enValue) {
    return converter(zhValue); // last resort: traditional Chinese is wrong for JA; use EN if possible
  }

  let s = enValue;
  const phraseMap = [
    [/Background artwork concurrency/gi, 'バックグラウンドジャケット同時実行'],
    [/Background metadata concurrency/gi, 'バックグラウンドメタデータ同時実行'],
    [/Background lyrics concurrency/gi, 'バックグラウンド歌詞同時実行'],
    [/Background MV concurrency/gi, 'バックグラウンド MV 同時実行'],
    [/Background duration backfill concurrency/gi, 'バックグラウンド再生時間補完の同時実行'],
    [/Choose Recommended/gi, '推奨を選択'],
    [/Delete source/gi, 'ソースを削除'],
    [/Open Current Source/gi, '現在のソースを開く'],
    [/Start Connection/gi, '接続を開始'],
    [/Recommended/gi, '推奨'],
    [/Current directory/gi, '現在のディレクトリ'],
    [/Refresh directory/gi, 'ディレクトリを更新'],
    [/Sync index/gi, 'インデックスを同期'],
    [/Coming soon/gi, '近日公開'],
    [/Increase/gi, '増やす'],
    [/Decrease/gi, '減らす'],
    [/Enabled/gi, '有効'],
    [/Disabled/gi, '無効'],
    [/Failed/gi, '失敗'],
    [/Error/gi, 'エラー'],
    [/Indexed tracks/gi, 'インデックス済みトラック'],
    [/Indexed/gi, 'インデックス済み'],
    [/Cover completion/gi, 'ジャケット完了率'],
    [/Background status/gi, 'バックグラウンド状態'],
    [/Processing/gi, '処理中'],
    [/Paused/gi, '一時停止'],
    [/Idle/gi, '待機中'],
    [/Playback reduced/gi, '再生中は抑制'],
    [/Artwork/gi, 'ジャケット'],
    [/Metadata/gi, 'メタデータ'],
    [/Lyrics/gi, '歌詞'],
    [/Duration backfill/gi, '再生時間の補完'],
    [/Duration/gi, '再生時間'],
    [/Source/gi, 'ソース'],
    [/Remote/gi, 'リモート'],
    [/Library/gi, 'ライブラリ'],
    [/Folder/gi, 'フォルダー'],
    [/Settings/gi, '設定'],
    [/Appearance/gi, '外観'],
    [/General/gi, '一般'],
    [/Playback/gi, '再生'],
    [/Integrations/gi, '連携'],
    [/About/gi, '情報'],
    [/Collapse/gi, '折りたたむ'],
    [/Expand/gi, '展開'],
    [/Refresh/gi, '更新'],
    [/Cancel/gi, 'キャンセル'],
    [/Save/gi, '保存'],
    [/Delete/gi, '削除'],
    [/Add filter/gi, 'フィルターを追加'],
    [/Import preset/gi, 'プリセットをインポート'],
    [/Export/gi, 'エクスポート'],
    [/Import/gi, 'インポート'],
    [/Reset/gi, 'リセット'],
    [/Bypass/gi, 'バイパス'],
    [/Preset/gi, 'プリセット'],
    [/Filter/gi, 'フィルター'],
    [/Channel balance/gi, 'チャンネルバランス'],
    [/Sample rate/gi, 'サンプルレート'],
    [/Bit depth/gi, 'ビット深度'],
    [/Output/gi, '出力'],
    [/Device/gi, 'デバイス'],
    [/Queue/gi, 'キュー'],
    [/Track/gi, 'トラック'],
    [/Album/gi, 'アルバム'],
    [/Artist/gi, 'アーティスト'],
    [/Search/gi, '検索'],
    [/Loading/gi, '読み込み中'],
    [/Unknown/gi, '不明'],
    [/None/gi, 'なし'],
    [/Yes/gi, 'はい'],
    [/No/gi, 'いいえ'],
    [/On/gi, 'オン'],
    [/Off/gi, 'オフ'],
    [/Title/gi, 'タイトル'],
    [/Description/gi, '説明'],
    [/Status/gi, '状態'],
    [/Progress/gi, '進捗'],
    [/Completed/gi, '完了'],
    [/Running/gi, '実行中'],
    [/Queued/gi, 'キュー待ち'],
    [/Failed/gi, '失敗'],
    [/Success/gi, '成功'],
    [/Warning/gi, '警告'],
    [/Info/gi, '情報'],
    [/Help/gi, 'ヘルプ'],
    [/Open/gi, '開く'],
    [/Close/gi, '閉じる'],
    [/Copy/gi, 'コピー'],
    [/Paste/gi, '貼り付け'],
    [/Clear/gi, 'クリア'],
    [/Remove/gi, '削除'],
    [/Rename/gi, '名前変更'],
    [/Create/gi, '作成'],
    [/Edit/gi, '編集'],
    [/Apply/gi, '適用'],
    [/Test/gi, 'テスト'],
    [/Connect/gi, '接続'],
    [/Disconnect/gi, '切断'],
    [/Enable/gi, '有効化'],
    [/Disable/gi, '無効化'],
    [/Show/gi, '表示'],
    [/Hide/gi, '非表示'],
    [/More/gi, 'その他'],
    [/Less/gi, '簡易'],
    [/Advanced/gi, '詳細'],
    [/Basic/gi, '基本'],
    [/Auto/gi, '自動'],
    [/Manual/gi, '手動'],
    [/Default/gi, '既定'],
    [/Custom/gi, 'カスタム'],
    [/Path/gi, 'パス'],
    [/Directory/gi, 'ディレクトリ'],
    [/File/gi, 'ファイル'],
    [/Name/gi, '名前'],
    [/Type/gi, '種類'],
    [/Value/gi, '値'],
    [/Count/gi, '件数'],
    [/Total/gi, '合計'],
    [/Available/gi, '利用可能'],
    [/Unavailable/gi, '利用不可'],
    [/Not configured/gi, '未設定'],
    [/Not checked/gi, '未確認'],
    [/Pending/gi, '保留中'],
    [/Ready/gi, '準備完了'],
    [/Waiting/gi, '待機中'],
    [/Empty/gi, '空'],
    [/No results/gi, '結果なし'],
    [/No items/gi, '項目なし'],
  ];

  for (const [re, rep] of phraseMap) {
    s = s.replace(re, rep);
  }
  return s;
}

// Build TW entries
const twEntries = [];
for (const key of missingTw) {
  const zhValue = zh.get(key);
  if (zhValue == null) continue;
  if (brandKeys.has(key) || key.startsWith('accountProvider.')) {
    twEntries.push([key, en.get(key) || zhValue]);
    continue;
  }
  twEntries.push([key, converter(zhValue)]);
}

// Build JA entries
const jaEntries = [];
for (const key of missingJa) {
  const enValue = en.get(key);
  const zhValue = zh.get(key);
  if (zhValue == null && enValue == null) continue;
  if (brandKeys.has(key) || key.startsWith('accountProvider.')) {
    jaEntries.push([key, enValue || zhValue]);
    continue;
  }
  // Prefer curated / phrase-mapped JA; if result still looks mostly Chinese, fall back to EN.
  let translated = toJapanese(key, enValue, zhValue);
  const hasCjk = /[\u4e00-\u9fff]/.test(translated);
  const hasKana = /[\u3040-\u30ff]/.test(translated);
  if (hasCjk && !hasKana && enValue && translated === converter(zhValue)) {
    translated = enValue;
  }
  // If still equal to simplified Chinese source, use English.
  if (enValue && translated === zhValue) {
    translated = enValue;
  }
  jaEntries.push([key, translated]);
}

// EN brand keys that are missing
const enEntries = [];
for (const key of missingEn) {
  const zhValue = zh.get(key);
  // brand names stay English product names
  if (key.startsWith('accountProvider.')) {
    const name = key.split('.')[1];
    const brandMap = {
      bilibili: 'Bilibili',
      osu: 'osu!',
      qobuz: 'Qobuz',
      qqmusic: 'QQ Music',
      soundcloud: 'SoundCloud',
      spotify: 'Spotify',
      tidal: 'TIDAL',
      youtube: 'YouTube',
    };
    enEntries.push([key, brandMap[name] || zhValue || name]);
  }
}

const enPresetReplacements = Object.entries(enEqPresetNames);

console.log('Filling:', {
  tw: twEntries.length,
  ja: jaEntries.length,
  enMissing: enEntries.length,
  enPresets: enPresetReplacements.length,
});

const twCount = insertEntries(join(localesDir, 'zhTW.ts'), twEntries);
const jaCount = insertEntries(join(localesDir, 'jaJP.ts'), jaEntries);
const enMissCount = insertEntries(join(localesDir, 'enUS.ts'), enEntries);
const enFixCount = replaceValues(join(localesDir, 'enUS.ts'), enPresetReplacements);

// Also fix ja/tw EQ preset names if they currently equal Chinese (existed partially)
const jaPresetExisting = Object.entries(enEqPresetNames).map(([k, enName]) => {
  const curated = jaCurated[k];
  return [k, curated || enName];
});
// Only replace if key exists
let jaPresetFix = 0;
{
  const jaText = readFileSync(join(localesDir, 'jaJP.ts'), 'utf8');
  const existing = [];
  for (const [k, v] of jaPresetExisting) {
    if (jaText.includes(`'${k}'`)) existing.push([k, v]);
  }
  jaPresetFix = replaceValues(join(localesDir, 'jaJP.ts'), existing);
}

const twPresetExisting = Object.entries(enEqPresetNames).map(([k]) => {
  const zhValue = zh.get(k);
  return [k, converter(zhValue || '')];
}).filter(([, v]) => v);
let twPresetFix = 0;
{
  const twText = readFileSync(join(localesDir, 'zhTW.ts'), 'utf8');
  const existing = [];
  for (const [k, v] of twPresetExisting) {
    if (twText.includes(`'${k}'`)) existing.push([k, v]);
  }
  twPresetFix = replaceValues(join(localesDir, 'zhTW.ts'), existing);
}

console.log('Done:', { twCount, jaCount, enMissCount, enFixCount, jaPresetFix, twPresetFix });
