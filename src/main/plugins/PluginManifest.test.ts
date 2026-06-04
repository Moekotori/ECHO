import { describe, expect, it } from 'vitest';
import { normalizePluginManifest } from './PluginManifest';

describe('plugin manifest validation', () => {
  it('normalizes a valid editable local plugin manifest with v2 contributions', () => {
    const manifest = normalizePluginManifest({
      id: 'Echo.Tools',
      name: 'Tools Plugin',
      version: '1.0.0',
      apiVersion: 2,
      minEchoVersion: '26.5.29',
      entry: 'plugin.js',
      panel: 'panel.html',
      permissions: ['playback:read', 'network', 'network'],
      contributes: {
        commands: [{ id: 'Show_Status', title: 'Show Status', description: 'Read current playback status' }],
        panels: [{ id: 'Main', title: 'Main Panel', path: 'panel.html' }],
        metadataProviders: [{ id: 'Online_Tags', title: 'Online Tags', description: 'Suggest metadata' }],
        sourceProviders: [{ id: 'Direct_Url', title: 'Direct URL', description: 'User custom URL' }],
        lyricsProviders: [{ id: 'Lyrics_Online', title: 'Lyrics Online' }],
        coverProviders: [{ id: 'Cover_Online', title: 'Cover Online' }],
        themePresets: [{
          id: 'Aurora_Glass',
          title: 'Aurora Glass',
          description: 'Plugin theme',
          basePreset: 'classic',
          light: { appBg: '#FFFFFF', accent: '#257F96', panelOpacityPercent: 120, motionSpeedSeconds: 20 },
          dark: { appBg: '#08111F', text: '#DDEEFF', glassPercent: 34 },
          preview: 'linear-gradient(135deg, #08111f 0%, #257f96 100%)',
          swatches: ['#08111F', '#257F96', 'bad'],
        }],
        settings: [{ id: 'Mode', title: 'Mode', type: 'select', options: [{ label: 'A', value: 'a' }], defaultValue: 'a' }],
      },
    }, 'echo.tools');

    expect(manifest).toMatchObject({
      id: 'echo.tools',
      entry: 'plugin.js',
      panel: 'panel.html',
      minEchoVersion: '26.5.29',
      permissions: ['playback:read', 'network'],
    });
    expect(manifest.contributes?.commands?.[0]).toMatchObject({ id: 'show_status', title: 'Show Status' });
    expect(manifest.contributes?.panels?.[0]).toMatchObject({ id: 'main', path: 'panel.html' });
    expect(manifest.contributes?.metadataProviders?.[0]).toMatchObject({ id: 'online_tags', title: 'Online Tags' });
    expect(manifest.contributes?.sourceProviders?.[0]).toMatchObject({ id: 'direct_url', title: 'Direct URL' });
    expect(manifest.contributes?.lyricsProviders?.[0]).toMatchObject({ id: 'lyrics_online', title: 'Lyrics Online' });
    expect(manifest.contributes?.coverProviders?.[0]).toMatchObject({ id: 'cover_online', title: 'Cover Online' });
    expect(manifest.contributes?.themePresets?.[0]).toMatchObject({
      id: 'aurora_glass',
      title: 'Aurora Glass',
      basePreset: 'classic',
      light: { appBg: '#ffffff', accent: '#257f96', panelOpacityPercent: 100, motionSpeedSeconds: 8 },
      dark: { appBg: '#08111f', text: '#ddeeff', glassPercent: 34 },
      preview: 'linear-gradient(135deg, #08111f 0%, #257f96 100%)',
      swatches: ['#08111f', '#257f96'],
    });
    expect(manifest.contributes?.settings?.[0]).toMatchObject({ id: 'mode', title: 'Mode', type: 'select', defaultValue: 'a' });
  });

  it('keeps theme preset previews structured and drops empty theme presets', () => {
    const manifest = normalizePluginManifest({
      id: 'echo.theme-safety',
      name: 'Theme Safety',
      version: '1.0.0',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: [],
      contributes: {
        themePresets: [
          {
            id: 'Unsafe_Preview',
            title: 'Unsafe Preview',
            basePreset: 'unknown',
            light: { panel: '#ffffff', glassPercent: '', shadowPercent: true },
            preview: 'linear-gradient(90deg, #111111 0%, #222222 100%), url(https://example.invalid/pixel.png)',
          },
          {
            id: 'No_Tone',
            title: 'No Tone',
            basePreset: 'classic',
            preview: '#ffffff',
          },
        ],
      },
    });

    expect(manifest.contributes?.themePresets).toHaveLength(1);
    expect(manifest.contributes?.themePresets?.[0]).toMatchObject({
      id: 'unsafe_preview',
      title: 'Unsafe Preview',
      basePreset: 'classic',
      light: { panel: '#ffffff' },
    });
    expect(manifest.contributes?.themePresets?.[0]?.preview).toBeUndefined();
  });

  it('rejects paths outside the plugin folder and unsupported entry types', () => {
    expect(() =>
      normalizePluginManifest({
        id: 'echo.bad',
        name: 'Bad',
        version: '1.0.0',
        apiVersion: 1,
        entry: '../plugin.js',
      }),
    ).toThrow('entry must be a file name inside the plugin folder');

    expect(() =>
      normalizePluginManifest({
        id: 'echo.bad',
        name: 'Bad',
        version: '1.0.0',
        apiVersion: 1,
        entry: 'plugin.ts',
      }),
    ).toThrow('entry must be a .js file');
  });

  it('marks invalid plugin ids, api versions, and unknown permissions as unusable', () => {
    expect(() =>
      normalizePluginManifest({
        id: 'ECHO Plugin!',
        name: 'Bad',
        version: '1.0.0',
        apiVersion: 1,
      }),
    ).toThrow('id must use lowercase letters');

    expect(() =>
      normalizePluginManifest({
        id: 'echo.future',
        name: 'Future',
        version: '1.0.0',
        apiVersion: 999,
      }),
    ).toThrow('apiVersion must be between 1 and 2');

    expect(() =>
      normalizePluginManifest({
        id: 'echo.unknown-permission',
        name: 'Unknown Permission',
        version: '1.0.0',
        apiVersion: 2,
        permissions: ['network', 'unknown'],
      }),
    ).toThrow('unknown plugin permission:unknown');
  });
});
