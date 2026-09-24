import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

// Use dynamic import of compiled path via tsx loader if available
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  // Prefer vitest-less direct load through tsx registered by spawning - use node with experimental strip types if available
  const { pathToFileURL: p } = await import('node:url');
  try {
    const locales = await import(p(join(root, 'src/renderer/i18n/locales.ts')).href);
    console.log('locales keys sample', locales.fallbackTranslations['audioError.generic']?.slice(0, 20));
  } catch (e) {
    console.error('import failed', e.message);
    // fallback: regex check keys exist in files
    const { readFileSync } = await import('node:fs');
    for (const f of ['zhCN', 'enUS', 'zhTW', 'jaJP']) {
      const t = readFileSync(join(root, `src/renderer/i18n/locales/${f}.ts`), 'utf8');
      const has = t.includes("'audioError.generic'") && t.includes("'error.bridge.desktop'");
      console.log(f, has ? 'has error keys' : 'MISSING');
    }
    const ufe = readFileSync(join(root, 'src/renderer/utils/userFacingError.ts'), 'utf8');
    const aef = readFileSync(join(root, 'src/renderer/components/player/audioErrorFormat.ts'), 'utf8');
    console.log('userFacing uses translateStatic', ufe.includes('translateStatic'));
    console.log('audioError uses translateStatic', aef.includes('translateStatic'));
    console.log('audioError has keys', aef.includes('audioError.corruptFile'));
  }
}

main();
