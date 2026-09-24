/**
 * Apply missing locale fills + en-US EQ preset English names.
 * Run: node tmp/build-ja-translations.mjs && node tmp/apply-locale-fill.mjs
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
    if (m[2] === '`' && m[3].includes('${')) continue;
    let value = m[3]
      .replace(/\\n/g, '\n')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    map.set(m[1], value);
  }
  return map;
}

function escapeTsString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

function insertEntries(filePath, entries) {
  if (entries.length === 0) return 0;
  let text = readFileSync(filePath, 'utf8');
  const closingIdx = text.lastIndexOf('\n};');
  if (closingIdx < 0) throw new Error(`No closing }; in ${filePath}`);
  const before = text.slice(0, closingIdx);
  const after = text.slice(closingIdx);
  // Deduplicate against existing keys in file
  const existing = extract(filePath);
  const unique = entries.filter(([k]) => !existing.has(k));
  if (unique.length === 0) return 0;
  const block = unique.map(([k, v]) => `  '${k}': '${escapeTsString(v)}',`).join('\n');
  writeFileSync(filePath, `${before}\n  // --- auto-filled missing keys (${unique.length}) ---\n${block}${after}`, 'utf8');
  return unique.length;
}

function replaceValues(filePath, replacements) {
  let text = readFileSync(filePath, 'utf8');
  let count = 0;
  for (const [key, value] of replacements) {
    const re = new RegExp(`('${key.replace(/\./g, '\\.')}'\\s*:\\s*)(['"\`])([\\s\\S]*?)\\2`);
    const next = text.replace(re, (full, head, quote) => {
      // Only replace when current value looks CJK-only leftover or explicitly targeted
      count += 1;
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
for (const [k, v] of zf) if (!tw.has(k)) tw.set(k, v);

const jaMap = JSON.parse(readFileSync(join(root, 'tmp/ja-missing-translations.json'), 'utf8'));

const zhKeys = [...zh.keys()].sort();
const missingTw = zhKeys.filter((k) => !tw.has(k));
const missingJa = zhKeys.filter((k) => !ja.has(k));
const missingEn = zhKeys.filter((k) => !en.has(k));

const brandMap = {
  bilibili: 'Bilibili',
  osu: 'osu!',
  qobuz: 'Qobuz',
  qqmusic: 'QQ Music',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  tidal: 'TIDAL',
  youtube: 'YouTube',
  kugou: 'Kugou',
  netease: 'NetEase Cloud Music',
  unknown: 'Unknown',
};

const twEntries = missingTw.map((key) => {
  if (key.startsWith('accountProvider.')) {
    const name = key.split('.')[1];
    return [key, brandMap[name] || zh.get(key) || name];
  }
  return [key, converter(zh.get(key) || key)];
});

const jaEntries = missingJa.map((key) => {
  if (jaMap[key]) return [key, jaMap[key]];
  if (key.startsWith('accountProvider.')) {
    const name = key.split('.')[1];
    return [key, brandMap[name] || zh.get(key) || name];
  }
  const enValue = en.get(key);
  if (enValue && !/[\u4e00-\u9fff]/.test(enValue)) return [key, enValue];
  return [key, enValue || zh.get(key) || key];
});

const enEntries = missingEn.map((key) => {
  if (key.startsWith('accountProvider.')) {
    const name = key.split('.')[1];
    return [key, brandMap[name] || name];
  }
  return [key, en.get(key) || zh.get(key) || key];
});

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

const twCount = insertEntries(join(localesDir, 'zhTW.ts'), twEntries);
const jaCount = insertEntries(join(localesDir, 'jaJP.ts'), jaEntries);
const enMissCount = insertEntries(join(localesDir, 'enUS.ts'), enEntries);
const enFixCount = replaceValues(join(localesDir, 'enUS.ts'), Object.entries(enEqPresetNames));

console.log(JSON.stringify({ twCount, jaCount, enMissCount, enFixCount, planned: { tw: twEntries.length, ja: jaEntries.length, en: enEntries.length } }, null, 2));
