/**
 * Generate zh-TW (OpenCC) + ja-JP (from en overrides + curated JA) for DspPage local texts.
 * Also reports en leftovers that still equal zh.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'src/renderer/pages/DspPage.tsx');
let text = readFileSync(file, 'utf8');

function extractObject(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = source.slice(brace, end + 1);
  const map = new Map();
  // Match 'key': 'value' with possible escaped quotes
  const re = /'((?:\\'|[^'])+)'\s*:\s*'((?:\\'|[^'])*)'/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const key = m[1].replace(/\\'/g, "'");
    const value = m[2].replace(/\\'/g, "'");
    map.set(key, value);
  }
  return { map, start, end: end + 1, brace };
}

const zh = extractObject(text, 'dspLocalTextZhCN');
const en = extractObject(text, 'dspLocalTextEnUS');

// Build resolved EN (spread means zh first then overrides)
const resolvedEn = new Map(zh.map);
for (const [k, v] of en.map) resolvedEn.set(k, v);

const stillCjk = [...resolvedEn.entries()].filter(([, v]) => /[\u4e00-\u9fff]/.test(v));
console.log('dsp keys', zh.map.size, 'en explicit', en.map.size, 'resolved still CJK', stillCjk.length);

// Curated Japanese for common DSP UI words — applied after English base
function toJapanese(key, enValue, zhValue) {
  // Prefer translating from English when available and not CJK
  const source = enValue && !/[\u4e00-\u9fff]/.test(enValue) ? enValue : zhValue;

  // Known full-string overrides for quality
  const exact = {
    Clear: 'クリア',
    Reset: 'リセット',
    Save: '保存',
    Refresh: '更新',
    Advanced: '詳細',
    Engine: 'エンジン',
    Compute: 'Compute',
    GPU: 'GPU',
    Active: '有効',
    Off: 'オフ',
    Pro: 'Pro',
  };
  if (exact[source]) return exact[source];

  let s = source;
  const pairs = [
    [/Disable channel compensation/g, 'チャンネル補正をオフ'],
    [/Enable channel compensation/g, 'チャンネル補正をオン'],
    [/Disable FIR/g, 'FIR をオフ'],
    [/Enable FIR/g, 'FIR をオン'],
    [/Enable safely/g, '安全に有効化'],
    [/Import IR/g, 'IR をインポート'],
    [/Refresh status/g, '状態を更新'],
    [/DSP module chain/g, 'DSP モジュールチェーン'],
    [/DSP modules/g, 'DSP モジュール'],
    [/DSP pipeline/g, 'DSP 経路'],
    [/DSP workspace/g, 'DSP ワークスペース'],
    [/PCM sample-rate conversion/g, 'PCM サンプルレート変換'],
    [/ECHO SRC \/ Upsampling/g, 'ECHO SRC / アップサンプリング'],
    [/A\/B native/g, 'A/B ネイティブ'],
    [/Restore upsampling/g, 'アップサンプリングを復元'],
    [/Upsampling active/g, 'アップサンプリング中'],
    [/DSD output bypass/g, 'DSD 出力バイパス'],
    [/Shared output bypass/g, '共有出力バイパス'],
    [/bit-perfect/g, 'bit-perfect'],
    [/Sample rate/g, 'サンプルレート'],
    [/Target rate/g, '目標レート'],
    [/Quality/g, '品質'],
    [/Filter/g, 'フィルター'],
    [/Latency/g, '遅延'],
    [/Headroom/g, 'ヘッドルーム'],
    [/Channel balance/g, 'チャンネルバランス'],
    [/Room correction/g, 'ルーム補正'],
    [/Safety/g, 'セーフティ'],
    [/Bypass/g, 'バイパス'],
    [/Enabled/g, '有効'],
    [/Disabled/g, '無効'],
    [/Loading/g, '読み込み中'],
    [/Error/g, 'エラー'],
    [/Warning/g, '警告'],
    [/Status/g, '状態'],
    [/Output/g, '出力'],
    [/Input/g, '入力'],
    [/Mode/g, 'モード'],
    [/Profile/g, 'プロファイル'],
    [/Preset/g, 'プリセット'],
    [/Auto/g, '自動'],
    [/Manual/g, '手動'],
    [/Native/g, 'ネイティブ'],
    [/Shared/g, '共有'],
    [/Exclusive/g, '排他'],
    [/Direct/g, 'ダイレクト'],
    [/Left/g, '左'],
    [/Right/g, '右'],
    [/Gain/g, 'ゲイン'],
    [/Delay/g, '遅延'],
    [/Trim/g, 'トリム'],
    [/Preamp/g, 'プリアンプ'],
    [/Collapse/g, '折りたたむ'],
    [/Expand/g, '展開'],
    [/Close/g, '閉じる'],
    [/Open/g, '開く'],
    [/Apply/g, '適用'],
    [/Cancel/g, 'キャンセル'],
    [/Delete/g, '削除'],
    [/Import/g, 'インポート'],
    [/Export/g, 'エクスポート'],
    [/Select/g, '選択'],
    [/None/g, 'なし'],
    [/Unknown/g, '不明'],
    [/Ready/g, '準備完了'],
    [/Pending/g, '保留中'],
    [/Failed/g, '失敗'],
    [/Success/g, '成功'],
    [/Realtime/g, 'リアルタイム'],
    [/Offline/g, 'オフライン'],
    [/Experimental/g, '実験的'],
    [/Recommended/g, '推奨'],
    [/Default/g, '既定'],
    [/Custom/g, 'カスタム'],
  ];
  for (const [re, rep] of pairs) s = s.replace(re, rep);

  // If still pure Chinese (untranslated EN leftover that was zh), convert characters poorly for JA is wrong —
  // keep English for product terms when result still looks Chinese-only without kana
  if (/[\u4e00-\u9fff]/.test(s) && !/[\u3040-\u30ff]/.test(s) && enValue && !/[\u4e00-\u9fff]/.test(enValue)) {
    return enValue;
  }
  if (/[\u4e00-\u9fff]/.test(s) && !/[\u3040-\u30ff]/.test(s) && s === zhValue) {
    // leave English product string if we have any en
    return enValue && !/[\u4e00-\u9fff]/.test(enValue) ? enValue : s;
  }
  return s;
}

function escapeTs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatObject(name, entries, headerComment) {
  const lines = entries.map(([k, v]) => `  '${k}': '${escapeTs(v)}',`);
  return `const ${name}: Record<string, string> = {\n  // ${headerComment}\n${lines.join('\n')}\n};\n`;
}

// Build zh-TW from zh
const twEntries = [...zh.map.entries()].map(([k, v]) => [k, toTw(v)]);

// Build ja from resolved en/zh
const jaEntries = [...zh.map.keys()].map((k) => {
  const z = zh.map.get(k) ?? '';
  const e = resolvedEn.get(k) ?? z;
  return [k, toJapanese(k, e, z)];
});

// Also fill remaining CJK in en by translating from key-aware English if missing - leave as-is for now
// Generate full en object without spread of zh for cleanliness? Keep structure: enUS spreads and overrides.

// Insert TW and JA objects after enUS block, update dspLocalTexts map
const enEnd = en.end; // end index after enUS };
// Find position after enUS object
const afterEn = text.indexOf('\n', enEnd);

const twBlock = formatObject('dspLocalTextZhTW', twEntries, 'Traditional Chinese (OpenCC from zh-CN)');
const jaBlock = formatObject('dspLocalTextJaJP', jaEntries, 'Japanese local DSP strings');

// Remove existing TW/JA if re-run
text = text.replace(/\nconst dspLocalTextZhTW: Record<string, string> = \{[\s\S]*?\n\};\n/m, '\n');
text = text.replace(/\nconst dspLocalTextJaJP: Record<string, string> = \{[\s\S]*?\n\};\n/m, '\n');

// Re-find en end after possible mutation
const en2 = extractObject(text, 'dspLocalTextEnUS');
const insertAt = en2.end + 1;
text = `${text.slice(0, insertAt)}\n\n${twBlock}\n${jaBlock}${text.slice(insertAt)}`;

text = text.replace(
  /const dspLocalTexts = \{[\s\S]*?\} as const;/,
  `const dspLocalTexts = {
  'zh-CN': dspLocalTextZhCN,
  'zh-TW': dspLocalTextZhTW,
  'en-US': dspLocalTextEnUS,
  'ja-JP': dspLocalTextJaJP,
} as const;`,
);

writeFileSync(file, text, 'utf8');
console.log('Wrote dspLocalTextZhTW', twEntries.length, 'dspLocalTextJaJP', jaEntries.length);
console.log('sample ja', jaEntries.slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(' | '));
console.log('sample tw', twEntries.slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' | '));
