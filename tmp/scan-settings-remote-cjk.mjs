import { readFileSync } from 'node:fs';

const cjk = /[\u4e00-\u9fff]/;
const files = [
  'src/renderer/pages/SettingsPage.tsx',
  'src/renderer/components/settings/RemoteSourcesPanel.tsx',
  'src/renderer/pages/PluginsPage.tsx',
  'src/renderer/components/streaming/StreamingSearchPage.tsx',
  'src/renderer/pages/HistoryPage.tsx',
];

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!cjk.test(t)) continue;
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    // skip multi-locale maps already having all langs
    if (t.includes("'en-US'") || t.includes('"en-US"')) continue;
    if (t.includes("t('") || t.includes('t("') || t.includes('t(`')) continue;
    hits.push({ line: i + 1, text: t.slice(0, 160) });
  }
  console.log(`\n## ${f} (${hits.length})`);
  hits.slice(0, 40).forEach((h) => console.log(`${h.line}: ${h.text}`));
}
