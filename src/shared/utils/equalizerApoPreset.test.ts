import { describe, expect, it } from 'vitest';
import { eqBandCount } from '../types/eq';
import { expandEqualizerApoIncludes, formatEqualizerApoGraphicEqPreset, formatEqualizerApoPreset, parseEqualizerApoPreset } from './equalizerApoPreset';

describe('parseEqualizerApoPreset', () => {
  it('imports Equalizer APO parametric filters and preamp', () => {
    const preset = parseEqualizerApoPreset(`
Preamp: -6 dB
Filter  1: ON  PK       Fc    20,0 Hz  Gain   10,0 dB  Q  1,00
Filter 2: OFF LS Fc 105 Hz Gain -3.5 dB Q 0.70
Filter 3: ON HP Fc 30 Hz Q 0.71
`, { name: 'Desk APO' });

    expect(preset.name).toBe('Desk APO');
    expect(preset.preampDb).toBe(-6);
    expect(preset.importedFilterCount).toBe(3);
    expect(preset.bands[0]).toMatchObject({
      frequencyHz: 20,
      gainDb: 10,
      q: 1,
      filterType: 'peaking',
      enabled: true,
    });
    expect(preset.bands[1]).toMatchObject({
      frequencyHz: 105,
      gainDb: -3.5,
      filterType: 'lowShelf',
      enabled: false,
    });
    expect(preset.bands[2]).toMatchObject({
      frequencyHz: 30,
      gainDb: 0,
      filterType: 'highPass',
      enabled: true,
    });
  });

  it('maps GraphicEQ points onto the ECHO 31-band curve', () => {
    const preset = parseEqualizerApoPreset(`
GraphicEQ: 20 -6; 31 -3; 62 0; 125 3; 250 6; 500 3; 1000 0; 2000 -3; 4000 -6; 8000 -3; 16000 0
`);

    expect(preset.graphicEqPointCount).toBe(11);
    expect(preset.importedFilterCount).toBe(0);
    expect(preset.bands).toHaveLength(eqBandCount);
    expect(preset.bands[2]).toMatchObject({ frequencyHz: 31.5, filterType: 'peaking' });
    expect(preset.bands[2].gainDb).toBeCloseTo(-2.9, 1);
    expect(preset.bands[11]).toMatchObject({ frequencyHz: 250, gainDb: 6, filterType: 'peaking' });
    expect(preset.bands[29]).toMatchObject({ frequencyHz: 16000, gainDb: 0, filterType: 'peaking' });
  });

  it('imports multi-line Equalizer APO GraphicEQ without swallowing following directives', () => {
    const preset = parseEqualizerApoPreset(`
Preamp: -2 dB
GraphicEQ: 20 -6; 31 -3; 62 0;
125 3; 250 6; 500 3;
1000 0; 2000 -3; 4000 -6
Filter 1: ON PK Fc 1000 Hz Gain 9 dB Q 1
`);

    expect(preset.preampDb).toBe(-2);
    expect(preset.graphicEqPointCount).toBe(9);
    expect(preset.importedFilterCount).toBe(1);
    expect(preset.bands[0]).toMatchObject({ frequencyHz: 1000, gainDb: 9, filterType: 'peaking' });
    expect(preset.warnings.join(' ')).toContain('GraphicEQ was ignored');
  });

  it('limits APO filter imports to the native 31-band engine', () => {
    const filters = Array.from({ length: eqBandCount + 2 }, (_, index) =>
      `Filter ${index + 1}: ON PK Fc ${100 + index} Hz Gain ${index} dB Q 1`,
    ).join('\n');

    const preset = parseEqualizerApoPreset(filters);

    expect(preset.bands).toHaveLength(eqBandCount);
    expect(preset.importedFilterCount).toBe(eqBandCount);
    expect(preset.skippedFilterCount).toBe(2);
    expect(preset.warnings[0]).toContain(`Only the first ${eqBandCount}`);
  });

  it('exports ECHO bands as Equalizer APO text that can be imported again', () => {
    const text = formatEqualizerApoPreset({
      name: 'Round Trip',
      preampDb: -5.5,
      bands: [
        { frequencyHz: 80, gainDb: 3, q: 0.7, filterType: 'lowShelf', enabled: true },
        { frequencyHz: 1000, gainDb: -2.5, q: 1.4, filterType: 'peaking', enabled: false },
        { frequencyHz: 18000, gainDb: 0, q: 0.71, filterType: 'lowPass', enabled: true },
      ],
    });

    expect(text).toContain('Preamp: -5.5 dB');
    expect(text).toContain('Filter 1: ON LS Fc 80 Hz Gain 3 dB Q 0.7');
    expect(text).toContain('Filter 2: OFF PK Fc 1000 Hz Gain -2.5 dB Q 1.4');
    expect(text).toContain('Filter 3: ON LP Fc 18000 Hz Q 0.71');

    const imported = parseEqualizerApoPreset(text, { name: 'Round Trip' });
    expect(imported.preampDb).toBe(-5.5);
    expect(imported.importedFilterCount).toBe(3);
    expect(imported.bands[0]).toMatchObject({ frequencyHz: 80, gainDb: 3, q: 0.7, filterType: 'lowShelf', enabled: true });
    expect(imported.bands[1]).toMatchObject({ frequencyHz: 1000, gainDb: -2.5, q: 1.4, filterType: 'peaking', enabled: false });
    expect(imported.bands[2]).toMatchObject({ frequencyHz: 18000, gainDb: 0, q: 0.71, filterType: 'lowPass', enabled: true });
  });

  it('exports ECHO bands as Equalizer APO GraphicEQ text that can be imported again', () => {
    const text = formatEqualizerApoGraphicEqPreset({
      name: 'Graphic Round Trip',
      preampDb: -3,
      bands: [
        { frequencyHz: 20, gainDb: -4, q: 1, filterType: 'peaking', enabled: true },
        { frequencyHz: 1000, gainDb: 2.5, q: 2, filterType: 'peaking', enabled: true },
        { frequencyHz: 20000, gainDb: 8, q: 1, filterType: 'peaking', enabled: false },
      ],
    });

    expect(text).toContain('Preamp: -3 dB');
    expect(text).toContain('GraphicEQ: 20 -4; 1000 2.5; 20000 0');

    const imported = parseEqualizerApoPreset(text, { name: 'Graphic Round Trip' });
    expect(imported.preampDb).toBe(-3);
    expect(imported.importedFilterCount).toBe(0);
    expect(imported.graphicEqPointCount).toBe(3);
    expect(imported.bands).toHaveLength(eqBandCount);
    expect(imported.bands[0]).toMatchObject({ frequencyHz: 20, gainDb: -4, filterType: 'peaking', enabled: true });
    expect(imported.bands[15].gainDb).toBeCloseTo(1.7, 1);
    expect(imported.bands[30]).toMatchObject({ frequencyHz: 20000, gainDb: 0, filterType: 'peaking', enabled: true });
  });

  it('expands Equalizer APO Include files before parsing', () => {
    const files = new Map<string, string>([
      ['nested.txt', 'Filter 2: ON HS Fc 12000 Hz Gain 3 dB Q 0.8'],
      ['child.txt', 'Filter 1: ON LS Fc 80 Hz Gain 4 dB Q 0.7\nInclude: nested.txt'],
    ]);
    const expanded = expandEqualizerApoIncludes('Preamp: -6 dB\nInclude: child.txt', (includePath, context) => {
      expect(context.depth).toBeGreaterThan(0);
      const content = files.get(includePath);
      return content ? { content, sourcePath: includePath } : null;
    }, { sourcePath: 'root.txt' });

    expect(expanded.includedFileCount).toBe(2);
    expect(expanded.skippedIncludeCount).toBe(0);

    const imported = parseEqualizerApoPreset(expanded.content);
    expect(imported.preampDb).toBe(-6);
    expect(imported.importedFilterCount).toBe(2);
    expect(imported.bands[0]).toMatchObject({ frequencyHz: 80, gainDb: 4, q: 0.7, filterType: 'lowShelf' });
    expect(imported.bands[1]).toMatchObject({ frequencyHz: 12000, gainDb: 3, q: 0.8, filterType: 'highShelf' });
  });

  it('reports unsupported APO routing directives and skips channel-scoped filters', () => {
    const preset = parseEqualizerApoPreset(`
Preamp: -4 dB
Device: Speakers
Channel: L
Filter 1: ON PK Fc 250 Hz Gain 6 dB Q 1
Copy: L=R
Channel: L R
Filter 2: ON PK Fc 1000 Hz Gain -2 dB Q 1.4
`);

    expect(preset.preampDb).toBe(-4);
    expect(preset.unsupportedDirectiveCount).toBe(4);
    expect(preset.unsupportedDirectiveSummary).toEqual({
      Channel: 2,
      Copy: 1,
      Device: 1,
    });
    expect(preset.channelScopedFilterCount).toBe(1);
    expect(preset.importedFilterCount).toBe(1);
    expect(preset.skippedFilterCount).toBe(1);
    expect(preset.bands[0]).toMatchObject({ frequencyHz: 1000, gainDb: -2, q: 1.4, filterType: 'peaking' });
    expect(preset.warnings.join(' ')).toContain('routing or processing directives');
    expect(preset.warnings.join(' ')).toContain('channel-scoped');
  });

  it('reports APO BW and Bandwidth filters converted to Q', () => {
    const preset = parseEqualizerApoPreset(`
Preamp: -3 dB
Filter 1: ON PK Fc 500 Hz Gain 2 dB BW 1
Filter 2: ON PK Fc 2000 Hz Gain -3 dB Bandwidth 0.5
Filter 3: ON PK Fc 4000 Hz Gain 1 dB BW Oct 1.25
Filter 4: ON PK Fc 8000 Hz Gain -1 dB Bandwidth Oct 0.75
`);

    expect(preset.bandwidthFilterCount).toBe(4);
    expect(preset.importedFilterCount).toBe(4);
    expect(preset.bands[0]).toMatchObject({ frequencyHz: 500, gainDb: 2, filterType: 'peaking' });
    expect(preset.bands[0].q).toBeCloseTo(1.41, 1);
    expect(preset.bands[1]).toMatchObject({ frequencyHz: 2000, gainDb: -3, filterType: 'peaking' });
    expect(preset.bands[1].q).toBeGreaterThan(2);
    expect(preset.bands[2]).toMatchObject({ frequencyHz: 4000, gainDb: 1, filterType: 'peaking' });
    expect(preset.bands[2].q).toBeGreaterThan(1);
    expect(preset.bands[3]).toMatchObject({ frequencyHz: 8000, gainDb: -1, filterType: 'peaking' });
    expect(preset.bands[3].q).toBeGreaterThan(1);
    expect(preset.warnings.join(' ')).toContain('BW/Bandwidth');
  });

  it('imports APO filter values when units or labels are adjacent to numbers', () => {
    const preset = parseEqualizerApoPreset(`
Preamp:-5dB
Filter 1: ON PK Fc 1000Hz Gain -3dB Q1.4
Filter 2: ON LS Fc80Hz Gain2.5dB Q0.7
`);

    expect(preset.preampDb).toBe(-5);
    expect(preset.importedFilterCount).toBe(2);
    expect(preset.bands[0]).toMatchObject({ frequencyHz: 1000, gainDb: -3, q: 1.4, filterType: 'peaking' });
    expect(preset.bands[1]).toMatchObject({ frequencyHz: 80, gainDb: 2.5, q: 0.7, filterType: 'lowShelf' });
  });
});
