/**
 * Extracts app_id and API secrets from the Qobuz web player's JavaScript bundle.
 *
 * This is a direct TypeScript port of qobuz-dl/qobuz_dl/bundle.py.
 * Algorithm:
 *   1. Fetch login page, extract bundle.js URL
 *   2. Fetch bundle.js, extract app_id
 *   3. Find initialSeed(base64seed, timezone) calls
 *   4. Build regex to find info/extras for those timezones
 *   5. Concatenate seed+info+extras, remove last 44 chars, base64-decode → secret
 */

import type { QobuzBundleSecrets } from '../../shared/types/qobuz';
import { QobuzApiClient } from './QobuzApiClient';

// Matches: x.initialSeed("base64seed",window.utimezone.paris)
const SEED_TIMEZONE_RE = /[a-z]\.initialSeed\("(?<seed>[\w=]+)",window\.utimezone\.(?<timezone>[a-z]+)\)/g;

const APP_ID_RE = /production:\{api:\{appId:"(\d{9})"/;
const APP_ID_HTML_RE = /appId\s*[:=]\s*"(\d{9})"/i;

// Matches: <script src="/resources/8.1.0-b019/bundle.js"></script>
const BUNDLE_SCRIPT_PATTERNS: RegExp[] = [
  /<script\s+src="(\/resources\/\d+\.\d+\.\d+-[a-z]\d{3}\/bundle\.js)"[^>]*><\/script>/i,
  /src="(\/resources\/[^"]+\/bundle\.js)"/i,
];

export class QobuzBundleExtractor {
  static async extract(): Promise<QobuzBundleSecrets | null> {
    try {
      console.log('[qobuz:bundle] Step 1: fetching login page...');
      const html = await QobuzApiClient.fetchLoginPage();
      console.log('[qobuz:bundle] Step 1 done, html length:', html.length);

      // Step 2: Extract bundle.js URL
      let bundlePath: string | null = null;
      for (const pattern of BUNDLE_SCRIPT_PATTERNS) {
        const match = pattern.exec(html);
        if (match?.[1]) { bundlePath = match[1]; break; }
      }
      if (!bundlePath) {
        const htmlAppId = APP_ID_HTML_RE.exec(html)?.[1];
        if (htmlAppId) {
          return { appId: htmlAppId, secrets: [], bundleVersion: 'html-fallback', extractedAt: Date.now() };
        }
        return null;
      }
      console.log('[qobuz:bundle] Step 2 done, bundle path:', bundlePath);

      // Step 3: Fetch bundle.js
      console.log('[qobuz:bundle] Step 3: fetching bundle...');
      const bundleJs = await QobuzApiClient.fetchBundle(bundlePath);
      console.log('[qobuz:bundle] Step 3 done, bundle size:', bundleJs.length);

      // Step 4: Extract app_id
      const appIdMatch = APP_ID_RE.exec(bundleJs);
      if (!appIdMatch?.[1]) { return null; }
      const appId = appIdMatch[1];
      console.log('[qobuz:bundle] Step 4 done, app_id:', appId);

      // Step 5: Extract secrets
      const secrets = this.extractSecrets(bundleJs);
      console.log('[qobuz:bundle] Step 5 done, secrets count:', secrets.length);

      const versionMatch = /\/resources\/([\d.]+)/.exec(bundlePath);
      return { appId, secrets, bundleVersion: versionMatch?.[1] ?? 'unknown', extractedAt: Date.now() };
    } catch (err) {
      console.error('[qobuz:bundle] extract failed:', err);
      return null;
    }
  }

  /**
   * Direct port of qobuz-dl/qobuz_dl/bundle.py:Bundle.get_secrets()
   */
  private static extractSecrets(bundleJs: string): string[] {
    // Step 1: collect seeds by timezone from initialSeed calls
    const seedMap = new Map<string, string[]>();
    let m: RegExpExecArray | null;
    while ((m = SEED_TIMEZONE_RE.exec(bundleJs)) !== null) {
      const seed = m.groups?.seed;
      const tz = m.groups?.timezone;
      if (seed && tz) seedMap.set(tz, [seed]);
    }
    if (seedMap.size === 0) {
      console.log('[qobuz:bundle] No initialSeed calls found');
      return [];
    }
    console.log('[qobuz:bundle] Found', seedMap.size, 'seed(s):', Array.from(seedMap.keys()));

    // Reorder: Python moves second entry to front
    const entries = Array.from(seedMap.entries());
    if (entries.length >= 2) {
      const second = entries.splice(1, 1)[0];
      entries.unshift(second);
    }

    // Step 2: build info/extras regex with capitalized timezone names
    const tzNames = entries.map(([tz]) => tz.charAt(0).toUpperCase() + tz.slice(1));
    const iePattern = new RegExp(
      `name:"\\w+/(?<timezone>${tzNames.join('|')})",info:"(?<info>[\\w=]+)",extras:"(?<extras>[\\w=]+)"`,
      'g',
    );

    // Step 3: append info and extras for each timezone
    while ((m = iePattern.exec(bundleJs)) !== null) {
      const tz = m.groups?.timezone?.toLowerCase();
      const info = m.groups?.info;
      const extras = m.groups?.extras;
      if (tz && info && extras && seedMap.has(tz)) {
        seedMap.get(tz)!.push(info, extras);
      }
    }
    console.log('[qobuz:bundle] Info/extras matched for timezones:', entries.map(([tz, parts]) => `${tz}:${parts.length} parts`));

    // Step 4: decode each timezone's concatenated parts
    const result: string[] = [];
    for (const [tz, parts] of entries) {
      try {
        const joined = parts.join('');
        const trimmed = joined.slice(0, -44);
        const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim();
        if (decoded.length === 32 && /^[a-f0-9]{32}$/i.test(decoded)) {
          console.log(`[qobuz:bundle] Valid secret for ${tz}`);
          result.push(decoded);
        } else {
          console.log(`[qobuz:bundle] Invalid decode for ${tz}: len=${decoded.length} preview=${decoded.slice(0, 40)}`);
        }
      } catch (err) {
        console.log(`[qobuz:bundle] Decode error for ${tz}:`, err);
      }
    }
    return result;
  }
}
