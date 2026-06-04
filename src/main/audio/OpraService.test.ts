import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { eqBandCount, eqMaxGainDb, eqMaxPreampDb, eqMinGainDb, eqMinPreampDb } from '../../shared/types/eq';
import { OpraService } from './OpraService';

const jsonLine = (value: unknown): string => JSON.stringify(value);

describe('OpraService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  const createService = (databaseText: string): OpraService => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-opra-'));
    tempDirs.push(dir);
    return new OpraService({
      cachePath: join(dir, 'database_v1.jsonl'),
      fetchText: async () => databaseText,
      now: () => new Date('2026-06-04T00:00:00.000Z'),
    });
  };

  it('searches OPRA products and converts parametric EQ into an ECHO preset', async () => {
    const service = createService([
      jsonLine({ type: 'vendor', id: 'sennheiser', data: { name: 'Sennheiser' } }),
      jsonLine({
        type: 'product',
        id: 'sennheiser::hd650',
        data: {
          vendor_id: 'sennheiser',
          name: 'HD 650',
          type: 'headphones',
          subtype: 'over_the_ear',
          line_art_96x64_png: 'assets/hd650.png',
        },
      }),
      jsonLine({
        type: 'eq',
        id: 'sennheiser:hd650::autoeq_test',
        data: {
          product_id: 'sennheiser::hd650',
          author: 'AutoEQ',
          details: 'Measured by test rig',
          type: 'parametric_eq',
          parameters: {
            gain_db: -5.2,
            bands: [
              { type: 'low_shelf', frequency: 105, gain_db: -3.5, q: 0.7 },
              { type: 'peak_dip', frequency: 3281, gain_db: 4.8, q: 1.88 },
              { type: 'high_shelf', frequency: 10000, gain_db: -0.8, q: 0.7 },
            ],
          },
        },
      }),
    ].join('\n'));

    const result = await service.search({ query: 'HD650', refresh: true });

    expect(result.status).toMatchObject({ source: 'network', vendorCount: 1, productCount: 1, eqCount: 1 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].assetUrl).toBe('https://opra.roonlabs.net/assets/hd650.png');
    expect(result.results[0].eqs[0]).toMatchObject({
      author: 'AutoEQ',
      importedBandCount: 3,
      originalBandCount: 3,
      skippedBandCount: 0,
      adjustedBandCount: 0,
    });
    expect(result.results[0].eqs[0].preset.name).toBe('耳机校正 - Sennheiser / HD 650 / AutoEQ');
    expect(result.results[0].eqs[0].preset.bands).toHaveLength(eqBandCount);
    expect(result.results[0].eqs[0].preset.bands[0]).toMatchObject({ frequencyHz: 105, gainDb: -3.5, q: 0.7, filterType: 'lowShelf' });
    expect(result.results[0].eqs[0].preset.bands[1]).toMatchObject({ frequencyHz: 3281, gainDb: 4.8, q: 1.88, filterType: 'peaking' });
    expect(result.results[0].eqs[0].preset.bands.filter((band) => band.enabled !== false)).toHaveLength(3);
    expect(result.results[0].eqs[0].preset.bands[3]).toMatchObject({ gainDb: 0, enabled: false });
  });

  it('browses vendors and products without requiring a search query', async () => {
    const service = createService([
      jsonLine({ type: 'vendor', id: 'sony', data: { name: 'Sony', logo: 'assets/sony-logo.png' } }),
      jsonLine({ type: 'vendor', id: 'akg', data: { name: 'AKG' } }),
      jsonLine({ type: 'product', id: 'sony::ier-m9', data: { vendor_id: 'sony', name: 'IER-M9', subtype: 'in_ear', line_art_96x64_png: 'assets/ier-m9.png' } }),
      jsonLine({ type: 'product', id: 'akg::k371', data: { vendor_id: 'akg', name: 'K371', subtype: 'over_the_ear' } }),
      jsonLine({
        type: 'eq',
        id: 'sony:ier-m9::autoeq',
        data: {
          product_id: 'sony::ier-m9',
          author: 'AutoEQ',
          type: 'parametric_eq',
          parameters: { gain_db: -4, bands: [{ type: 'peak_dip', frequency: 1000, gain_db: 2, q: 1 }] },
        },
      }),
      jsonLine({
        type: 'eq',
        id: 'akg:k371::autoeq',
        data: {
          product_id: 'akg::k371',
          author: 'AutoEQ',
          type: 'parametric_eq',
          parameters: { gain_db: -5, bands: [{ type: 'peak_dip', frequency: 2000, gain_db: 3, q: 1 }] },
        },
      }),
    ].join('\n'));

    const catalog = await service.browse({ refresh: true });
    expect(catalog.vendors.map((vendor) => vendor.vendorName).sort()).toEqual(['AKG', 'Sony']);
    expect(catalog.products).toHaveLength(2);

    const sony = await service.browse({ vendorId: 'sony' });
    expect(sony.vendorId).toBe('sony');
    expect(sony.vendors.find((vendor) => vendor.vendorId === 'sony')?.logoUrl).toBe('https://opra.roonlabs.net/assets/sony-logo.png');
    expect(sony.products).toHaveLength(1);
    expect(sony.products[0]).toMatchObject({ vendorName: 'Sony', productName: 'IER-M9', assetUrl: 'https://opra.roonlabs.net/assets/ier-m9.png' });
    expect(sony.selectedProduct).toBeNull();

    const selected = await service.browse({ vendorId: 'sony', productId: 'sony::ier-m9' });
    expect(selected.selectedProduct?.eqs).toHaveLength(1);
  });

  it('clamps OPRA values to current ECHO safety limits', async () => {
    const service = createService([
      jsonLine({ type: 'vendor', id: 'pud', data: { name: 'Pud' } }),
      jsonLine({ type: 'product', id: 'pud::vogue', data: { vendor_id: 'pud', name: 'Vogue', type: 'headphones', subtype: 'over_the_ear' } }),
      jsonLine({
        type: 'eq',
        id: 'pud:vogue::oratory1990_harman_target',
        data: {
          product_id: 'pud::vogue',
          author: 'oratory1990',
          type: 'parametric_eq',
          parameters: {
            gain_db: -20,
            bands: [
              { type: 'peak_dip', frequency: 790, gain_db: -19, q: 2.8 },
              { type: 'high_shelf', frequency: 7000, gain_db: 13, q: 0.6 },
              { type: 'low_pass', frequency: 21000, slope: 12 },
              { type: 'band_pass', frequency: 1200, q: 1 },
            ],
          },
        },
      }),
    ].join('\n'));

    const result = await service.search({ query: 'vogue', refresh: true });
    const preview = result.results[0].eqs[0];

    expect(preview.preset.preampDb).toBe(eqMinPreampDb);
    expect(preview.preset.preampDb).toBeGreaterThanOrEqual(eqMinPreampDb);
    expect(preview.preset.preampDb).toBeLessThanOrEqual(eqMaxPreampDb);
    expect(preview.preset.bands[0].gainDb).toBe(eqMinGainDb);
    expect(preview.preset.bands[1].gainDb).toBe(eqMaxGainDb);
    expect(preview.preset.bands[2]).toMatchObject({ frequencyHz: 20000, gainDb: 0, filterType: 'lowPass' });
    expect(preview.preset.bands.filter((band) => band.enabled !== false)).toHaveLength(3);
    expect(preview.preset.bands[3]).toMatchObject({ gainDb: 0, enabled: false });
    expect(preview.skippedBandCount).toBe(1);
    expect(preview.adjustedBandCount).toBeGreaterThan(0);
    expect(preview.warnings.join(' ')).toContain('安全范围');
  });
});
