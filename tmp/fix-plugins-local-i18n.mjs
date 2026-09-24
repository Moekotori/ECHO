/**
 * Generate zh-TW + ja-JP local texts for PluginsPage (same pattern as DspPage).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OpenCC = require('opencc-js');
const toTw = OpenCC.Converter({ from: 'cn', to: 'twp' });
const file = 'src/renderer/pages/PluginsPage.tsx';
let text = readFileSync(file, 'utf8');

function extractObject(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = source.slice(brace, end + 1);
  const map = new Map();
  const re = /'((?:\\'|[^'])+)'\s*:\s*'((?:\\'|[^'])*)'/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    map.set(m[1].replace(/\\'/g, "'"), m[2].replace(/\\'/g, "'"));
  }
  return { map, end: end + 1 };
}

const zh = extractObject(text, 'pluginPageTextZhCN');
const en = extractObject(text, 'pluginPageTextEnUS');

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toJapanese(enValue, zhValue) {
  const source = enValue || zhValue;
  let s = source;
  const pairs = [
    [/Create example plugin/gi, 'サンプルを作成'],
    [/Create example/gi, 'サンプルを作成'],
    [/Delete plugin/gi, 'プラグインを削除'],
    [/Export package/gi, 'パッケージを書き出し'],
    [/Import package/gi, 'パッケージを取り込み'],
    [/Open directory/gi, 'ディレクトリを開く'],
    [/Open plugin directory/gi, 'プラグインディレクトリを開く'],
    [/Refresh logs/gi, 'ログを更新'],
    [/Save settings/gi, '設定を保存'],
    [/Plugin operation failed/gi, 'プラグイン操作に失敗しました'],
    [/Local plugins/gi, 'ローカルプラグイン'],
    [/No plugins yet/gi, 'プラグインはまだありません'],
    [/Select a plugin/gi, 'プラグインを選択'],
    [/Plugin system unavailable/gi, 'プラグインシステムを利用できません'],
    [/Create/gi, '新規'],
    [/Delete/gi, '削除'],
    [/Disable/gi, '無効化'],
    [/Enable/gi, '有効化'],
    [/Refresh/gi, '更新'],
    [/Reload/gi, '再読み込み'],
    [/Error/gi, 'エラー'],
    [/Logs/gi, 'ログ'],
    [/Commands/gi, 'コマンド'],
    [/Permissions/gi, '権限'],
    [/Settings/gi, '設定'],
    [/High risk/gi, '高リスク'],
    [/Low risk/gi, '低リスク'],
    [/Medium risk/gi, '中リスク'],
    [/Trusted/gi, '信頼済み'],
    [/Untrusted/gi, '未信頼'],
    [/None/gi, 'なし'],
    [/Active/gi, '有効'],
    [/Limited/gi, '制限付き'],
    [/Reserved/gi, '予約'],
  ];
  for (const [re, rep] of pairs) s = s.replace(re, rep);
  if (/[\u4e00-\u9fff]/.test(s) && !/[\u3040-\u30ff]/.test(s) && enValue && !/[\u4e00-\u9fff]/.test(enValue)) {
    return enValue;
  }
  return s;
}

function formatObject(name, entries, comment) {
  const lines = entries.map(([k, v]) => `  '${k}': '${esc(v)}',`);
  return `const ${name}: Record<PluginPageTextKey, string> = {\n  // ${comment}\n${lines.join('\n')}\n};\n`;
}

const twEntries = [...zh.map.entries()].map(([k, v]) => [k, toTw(v)]);
const jaEntries = [...zh.map.keys()].map((k) => {
  const z = zh.map.get(k) ?? '';
  const e = en.map.get(k) ?? z;
  return [k, toJapanese(e, z)];
});

text = text.replace(/\nconst pluginPageTextZhTW: Record<PluginPageTextKey, string> = \{[\s\S]*?\n\};\n/m, '\n');
text = text.replace(/\nconst pluginPageTextJaJP: Record<PluginPageTextKey, string> = \{[\s\S]*?\n\};\n/m, '\n');

const en2 = extractObject(text, 'pluginPageTextEnUS');
const insertAt = en2.end;
const twBlock = formatObject('pluginPageTextZhTW', twEntries, 'Traditional Chinese');
const jaBlock = formatObject('pluginPageTextJaJP', jaEntries, 'Japanese');
text = `${text.slice(0, insertAt)}\n\n${twBlock}\n${jaBlock}${text.slice(insertAt)}`;

text = text.replace(
  /const pluginPageTexts: Record<Locale, Record<PluginPageTextKey, string>> = \{[\s\S]*?\};/,
  `const pluginPageTexts: Record<Locale, Record<PluginPageTextKey, string>> = {
  'zh-CN': pluginPageTextZhCN,
  'zh-TW': pluginPageTextZhTW,
  'ja-JP': pluginPageTextJaJP,
  'en-US': pluginPageTextEnUS,
};`,
);

writeFileSync(file, text, 'utf8');
console.log('plugins tw', twEntries.length, 'ja', jaEntries.length);
console.log(jaEntries.slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' | '));
