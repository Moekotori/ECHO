import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const localesDir = join(root, 'src/renderer/i18n/locales');

function extract(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const map = new Map();
  const re = /['"]([a-zA-Z0-9_.]+)['"]\s*:\s*(['"`])([\s\S]*?)\2/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2] === '`' && m[3].includes('${')) continue;
    map.set(m[1], m[3]);
  }
  return map;
}

const zh = extract(join(localesDir, 'zhCN.ts'));
const en = extract(join(localesDir, 'enUS.ts'));
const tw = extract(join(localesDir, 'zhTW.ts'));
const ja = extract(join(localesDir, 'jaJP.ts'));
const ko = extract(join(localesDir, 'koKR.ts'));

const cjk = /[\u4e00-\u9fff]/;
const hangul = /[\uac00-\ud7af]/;
const kana = /[\u3040-\u30ff]/;

const enCjk = [];
for (const [k, v] of en) {
  if (cjk.test(v)) enCjk.push([k, v.slice(0, 80)]);
}

const missing = {
  en: [...zh.keys()].filter((k) => !en.has(k)),
  tw: [...zh.keys()].filter((k) => !tw.has(k)),
  ja: [...zh.keys()].filter((k) => !ja.has(k)),
  ko: [...zh.keys()].filter((k) => !ko.has(k)),
};

let jaSameAsZh = 0;
let jaChineseOnly = 0;
for (const [k, v] of zh) {
  const j = ja.get(k);
  if (!j) continue;
  if (j === v) {
    jaSameAsZh++;
    if (cjk.test(j) && !kana.test(j)) jaChineseOnly++;
  }
}

let koHangul = 0;
let koNoHangul = 0;
const koNoHangulSamples = [];
for (const [k, v] of zh) {
  const kv = ko.get(k);
  if (!kv) continue;
  if (hangul.test(kv)) koHangul++;
  else {
    koNoHangul++;
    if (koNoHangulSamples.length < 20) koNoHangulSamples.push([k, kv.slice(0, 80)]);
  }
}

// Pages with local locale maps missing ko-KR
const rendererRoot = join(root, 'src/renderer');
const localMapHits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(p);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(name)) continue;
    const text = readFileSync(p, 'utf8');
    if (!text.includes("'zh-CN'") && !text.includes('"zh-CN"')) continue;
    const hasKo = text.includes("'ko-KR'") || text.includes('"ko-KR"');
    const hasJa = text.includes("'ja-JP'") || text.includes('"ja-JP"');
    const hasTw = text.includes("'zh-TW'") || text.includes('"zh-TW"');
    const hasEn = text.includes("'en-US'") || text.includes('"en-US"');
    if (hasJa || hasTw || hasEn) {
      localMapHits.push({
        file: relative(root, p).replace(/\\/g, '/'),
        hasEn,
        hasTw,
        hasJa,
        hasKo,
      });
    }
  }
}
walk(rendererRoot);

const report = {
  sizes: { zh: zh.size, en: en.size, tw: tw.size, ja: ja.size, ko: ko.size },
  missingCounts: {
    en: missing.en.length,
    tw: missing.tw.length,
    ja: missing.ja.length,
    ko: missing.ko.length,
  },
  missing,
  enCjkCount: enCjk.length,
  enCjk: enCjk.slice(0, 30),
  jaSameAsZh,
  jaChineseOnly,
  koHangul,
  koNoHangul,
  koNoHangulSamples,
  localMapHits,
};

writeFileSync(join(root, 'tmp/locale-quality.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  sizes: report.sizes,
  missingCounts: report.missingCounts,
  enCjkCount: report.enCjkCount,
  jaSameAsZh: report.jaSameAsZh,
  jaChineseOnly: report.jaChineseOnly,
  koHangul: report.koHangul,
  koNoHangul: report.koNoHangul,
  localMaps: report.localMapHits.length,
  localMapsMissingKo: report.localMapHits.filter((x) => !x.hasKo).length,
}, null, 2));
console.log('missing keys', missing);
console.log('local maps missing ko:', report.localMapHits.filter((x) => !x.hasKo).map((x) => x.file));
console.log('en CJK samples', enCjk.slice(0, 15));
