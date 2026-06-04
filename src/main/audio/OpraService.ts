import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { EqBand, EqFilterType, EqSavePresetRequest } from '../../shared/types/eq';
import {
  eqBandCount,
  eqFrequenciesHz,
  eqMaxFrequencyHz,
  eqMaxGainDb,
  eqMaxPreampDb,
  eqMaxQ,
  eqMinFrequencyHz,
  eqMinGainDb,
  eqMinPreampDb,
  eqMinQ,
} from '../../shared/types/eq';
import type {
  OpraDatabaseStatus,
  OpraHeadphoneCorrectionApplyRequest,
  OpraHeadphoneCorrectionApplyResult,
  OpraHeadphoneCorrectionBrowseRequest,
  OpraHeadphoneCorrectionBrowseResult,
  OpraHeadphoneCorrectionPreview,
  OpraHeadphoneCorrectionProductResult,
  OpraHeadphoneCorrectionSearchRequest,
  OpraHeadphoneCorrectionSearchResult,
  OpraHeadphoneCorrectionVendorResult,
} from '../../shared/types/opra';
import { getEqBridge } from './EqBridge';

type OpraEntryType = 'vendor' | 'product' | 'eq';

type OpraVendorData = {
  name?: unknown;
  logo?: unknown;
  blurb?: unknown;
};

type OpraProductData = {
  vendor_id?: unknown;
  name?: unknown;
  subtype?: unknown;
  line_art_96x64_png?: unknown;
  line_art_svg?: unknown;
};

type OpraEqBandData = {
  type?: unknown;
  frequency?: unknown;
  gain_db?: unknown;
  q?: unknown;
  slope?: unknown;
};

type OpraEqData = {
  product_id?: unknown;
  author?: unknown;
  details?: unknown;
  link?: unknown;
  type?: unknown;
  parameters?: {
    gain_db?: unknown;
    bands?: unknown;
  };
};

type OpraVendor = {
  id: string;
  name: string;
  logoPath: string | null;
  blurb: string | null;
};

type OpraProduct = {
  id: string;
  vendorId: string;
  name: string;
  subtype: string | null;
  assetPath: string | null;
  searchText: string;
};

type OpraEq = {
  id: string;
  productId: string;
  author: string;
  details: string | null;
  link: string | null;
  preampDb: number;
  bands: OpraEqBandData[];
};

type OpraDatabase = {
  vendors: Map<string, OpraVendor>;
  products: Map<string, OpraProduct>;
  eqs: Map<string, OpraEq>;
  eqsByProductId: Map<string, OpraEq[]>;
  status: OpraDatabaseStatus;
};

export type OpraServiceDependencies = {
  cachePath: string;
  fetchText?: (url: string) => Promise<string>;
  now?: () => Date;
};

const opraDatabaseUrl = 'https://opra.roonlabs.net/database_v1.jsonl';
const opraAssetBaseUrl = 'https://opra.roonlabs.net/';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const readText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const readNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim();

const defaultBand = (index: number): EqBand => ({
  frequencyHz: eqFrequenciesHz[index] ?? eqFrequenciesHz[eqFrequenciesHz.length - 1],
  gainDb: 0,
  q: 1,
  filterType: 'peaking',
  enabled: true,
});

const mapOpraFilterType = (value: unknown): EqFilterType | null => {
  switch (value) {
    case 'peak_dip':
      return 'peaking';
    case 'low_shelf':
      return 'lowShelf';
    case 'high_shelf':
      return 'highShelf';
    case 'low_pass':
      return 'lowPass';
    case 'high_pass':
      return 'highPass';
    case 'band_stop':
      return 'notch';
    default:
      return null;
  }
};

const safePresetId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || `opra-${Date.now()}`;

const scoreProduct = (queryTokens: string[], product: OpraProduct, vendor: OpraVendor): number => {
  const haystack = product.searchText;
  if (!queryTokens.every((token) => haystack.includes(token))) {
    return -1;
  }

  const productName = normalizeSearchText(product.name);
  const vendorName = normalizeSearchText(vendor.name);
  let score = 0;
  for (const token of queryTokens) {
    if (productName === token || vendorName === token) {
      score += 120;
    } else if (productName.startsWith(token) || vendorName.startsWith(token)) {
      score += 70;
    } else {
      score += 20;
    }
  }

  return score;
};

export class OpraService {
  private database: OpraDatabase | null = null;

  private readonly cachePath: string;
  private readonly fetchText: (url: string) => Promise<string>;
  private readonly now: () => Date;

  constructor(dependencies: OpraServiceDependencies) {
    this.cachePath = dependencies.cachePath;
    this.fetchText = dependencies.fetchText ?? (async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`opra_fetch_failed_${response.status}`);
      }
      return response.text();
    });
    this.now = dependencies.now ?? (() => new Date());
  }

  async search(request: OpraHeadphoneCorrectionSearchRequest): Promise<OpraHeadphoneCorrectionSearchResult> {
    const query = typeof request.query === 'string' ? request.query.trim() : '';
    const database = await this.loadDatabase(request.refresh === true);
    const queryTokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    const limit = clamp(Math.round(Number(request.limit ?? 12)), 1, 30);

    if (queryTokens.length === 0 || normalizeSearchText(query).length < 2) {
      return {
        query,
        results: [],
        status: database.status,
      };
    }

    const scoredProducts = Array.from(database.products.values())
      .map((product) => {
        const vendor = database.vendors.get(product.vendorId) ?? { id: product.vendorId, name: product.vendorId, logoPath: null, blurb: null };
        return { product, vendor, score: scoreProduct(queryTokens, product, vendor) };
      })
      .filter(({ product, score }) => score >= 0 && (database.eqsByProductId.get(product.id)?.length ?? 0) > 0)
      .sort((left, right) => right.score - left.score || left.vendor.name.localeCompare(right.vendor.name) || left.product.name.localeCompare(right.product.name))
      .slice(0, limit);

    return {
      query,
      results: scoredProducts.map(({ product, vendor }) => this.createProductResult(database, product, vendor)),
      status: database.status,
    };
  }

  async browse(request: OpraHeadphoneCorrectionBrowseRequest = {}): Promise<OpraHeadphoneCorrectionBrowseResult> {
    const database = await this.loadDatabase(request.refresh === true);
    const query = typeof request.query === 'string' ? request.query.trim() : '';
    const normalizedQuery = normalizeSearchText(query);
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const requestedVendorId = typeof request.vendorId === 'string' ? request.vendorId.trim() : '';
    const requestedProductId = typeof request.productId === 'string' ? request.productId.trim() : '';
    const limit = clamp(Math.round(Number(request.limit ?? 80)), 1, 240);
    const vendors = this.createVendorResults(database);

    const matchingProducts = Array.from(database.products.values())
      .filter((product) => (database.eqsByProductId.get(product.id)?.length ?? 0) > 0)
      .filter((product) => !requestedVendorId || product.vendorId === requestedVendorId)
      .map((product) => {
        const vendor = database.vendors.get(product.vendorId) ?? { id: product.vendorId, name: product.vendorId, logoPath: null, blurb: null };
        const score = queryTokens.length > 0 ? scoreProduct(queryTokens, product, vendor) : 0;
        return { product, vendor, score };
      })
      .filter(({ score }) => queryTokens.length === 0 || score >= 0)
      .sort((left, right) => (
        queryTokens.length > 0
          ? right.score - left.score || left.vendor.name.localeCompare(right.vendor.name) || left.product.name.localeCompare(right.product.name)
          : left.product.name.localeCompare(right.product.name) || left.vendor.name.localeCompare(right.vendor.name)
      ))
      .slice(0, limit);

    const selectedProduct = requestedProductId ? database.products.get(requestedProductId) ?? null : null;
    const selectedVendor = selectedProduct
      ? database.vendors.get(selectedProduct.vendorId) ?? { id: selectedProduct.vendorId, name: selectedProduct.vendorId, logoPath: null, blurb: null }
      : null;

    return {
      query,
      vendorId: requestedVendorId || null,
      productId: selectedProduct?.id ?? null,
      vendors,
      products: matchingProducts.map(({ product, vendor }) => this.createProductResult(database, product, vendor)),
      selectedProduct: selectedProduct && selectedVendor ? this.createProductResult(database, selectedProduct, selectedVendor) : null,
      status: database.status,
    };
  }

  async apply(request: OpraHeadphoneCorrectionApplyRequest): Promise<OpraHeadphoneCorrectionApplyResult> {
    const eqId = typeof request.eqId === 'string' ? request.eqId.trim() : '';
    const database = await this.loadDatabase(false);
    const eq = database.eqs.get(eqId);
    if (!eq) {
      throw new Error('opra_eq_not_found');
    }

    const product = database.products.get(eq.productId);
    if (!product) {
      throw new Error('opra_product_not_found');
    }
    const vendor = database.vendors.get(product.vendorId) ?? { id: product.vendorId, name: product.vendorId, logoPath: null, blurb: null };
    const preview = this.createPreview(eq, product, vendor);
    const eqBridge = getEqBridge();
    const preset = eqBridge.savePreset(preview.preset);
    const state = await eqBridge.setPreset(preset.id);
    if (request.enableEq !== false && !state.enabled) {
      return {
        preset,
        preview,
        state: await eqBridge.setEnabled(true),
      };
    }

    return { preset, preview, state };
  }

  private async loadDatabase(refresh: boolean): Promise<OpraDatabase> {
    if (this.database && !refresh) {
      return this.database;
    }

    let source: OpraDatabaseStatus['source'] = 'cache';
    let fetchedAt: string | null = null;
    let rawText: string | null = null;

    if (refresh || !existsSync(this.cachePath)) {
      try {
        rawText = await this.fetchText(opraDatabaseUrl);
        fetchedAt = this.now().toISOString();
        mkdirSync(dirname(this.cachePath), { recursive: true });
        writeFileSync(this.cachePath, rawText, 'utf8');
        writeFileSync(`${this.cachePath}.meta.json`, JSON.stringify({ fetchedAt }, null, 2), 'utf8');
        source = 'network';
      } catch (error) {
        if (!existsSync(this.cachePath)) {
          throw error;
        }
      }
    }

    if (rawText === null && existsSync(this.cachePath)) {
      rawText = readFileSync(this.cachePath, 'utf8');
      fetchedAt = this.readCachedFetchedAt();
      source = 'cache';
    }

    if (rawText === null) {
      this.database = this.parseDatabase('', 'empty', null);
      return this.database;
    }

    this.database = this.parseDatabase(rawText, source, fetchedAt);
    return this.database;
  }

  private readCachedFetchedAt(): string | null {
    try {
      const meta = asRecord(JSON.parse(readFileSync(`${this.cachePath}.meta.json`, 'utf8')) as unknown);
      return readText(meta?.fetchedAt);
    } catch {
      return null;
    }
  }

  private parseDatabase(rawText: string, source: OpraDatabaseStatus['source'], fetchedAt: string | null): OpraDatabase {
    const vendors = new Map<string, OpraVendor>();
    const products = new Map<string, OpraProduct>();
    const eqs = new Map<string, OpraEq>();
    const eqsByProductId = new Map<string, OpraEq[]>();

    for (const line of rawText.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const record = asRecord(JSON.parse(line) as unknown);
        const type = readText(record?.type) as OpraEntryType | null;
        const id = readText(record?.id);
        const data = asRecord(record?.data);
        if (!id || !data) {
          continue;
        }

        if (type === 'vendor') {
          const vendorData = data as OpraVendorData;
          vendors.set(id, {
            id,
            name: readText(vendorData.name) ?? id,
            logoPath: readText(vendorData.logo),
            blurb: readText(vendorData.blurb),
          });
        } else if (type === 'product') {
          const productData = data as OpraProductData;
          const vendorId = readText(productData.vendor_id);
          const name = readText(productData.name);
          if (!vendorId || !name) {
            continue;
          }
          const assetPath = readText(productData.line_art_96x64_png) ?? readText(productData.line_art_svg);
          const vendorName = vendors.get(vendorId)?.name ?? vendorId;
          products.set(id, {
            id,
            vendorId,
            name,
            subtype: readText(productData.subtype),
            assetPath,
            searchText: normalizeSearchText(`${vendorName} ${name} ${id.replace(/[:_]+/g, ' ')}`),
          });
        } else if (type === 'eq') {
          const eqData = data as OpraEqData;
          if (eqData.type !== 'parametric_eq') {
            continue;
          }
          const productId = readText(eqData.product_id);
          const bands = Array.isArray(eqData.parameters?.bands) ? eqData.parameters.bands as OpraEqBandData[] : [];
          if (!productId || bands.length === 0) {
            continue;
          }
          const eq: OpraEq = {
            id,
            productId,
            author: readText(eqData.author) ?? 'OPRA',
            details: readText(eqData.details),
            link: readText(eqData.link),
            preampDb: readNumber(eqData.parameters?.gain_db) ?? 0,
            bands,
          };
          eqs.set(id, eq);
          const productEqs = eqsByProductId.get(productId) ?? [];
          productEqs.push(eq);
          eqsByProductId.set(productId, productEqs);
        }
      } catch {
        continue;
      }
    }

    return {
      vendors,
      products,
      eqs,
      eqsByProductId,
      status: {
        source,
        fetchedAt,
        vendorCount: vendors.size,
        productCount: products.size,
        eqCount: eqs.size,
      },
    };
  }

  private createProductResult(database: OpraDatabase, product: OpraProduct, vendor: OpraVendor): OpraHeadphoneCorrectionProductResult {
    const productEqs = database.eqsByProductId.get(product.id) ?? [];
    return {
      productId: product.id,
      productName: product.name,
      productSubtype: product.subtype,
      vendorId: vendor.id,
      vendorName: vendor.name,
      assetUrl: product.assetPath ? `${opraAssetBaseUrl}${product.assetPath}` : null,
      eqs: productEqs.map((eq) => this.createPreview(eq, product, vendor)),
    };
  }

  private createVendorResults(database: OpraDatabase): OpraHeadphoneCorrectionVendorResult[] {
    return Array.from(database.vendors.values())
      .map((vendor) => {
        const vendorProducts = Array.from(database.products.values())
          .filter((product) => product.vendorId === vendor.id && (database.eqsByProductId.get(product.id)?.length ?? 0) > 0);
        const eqCount = vendorProducts.reduce((count, product) => count + (database.eqsByProductId.get(product.id)?.length ?? 0), 0);
        const sampleAssetPath = vendorProducts.find((product) => product.assetPath)?.assetPath ?? null;
        return {
          vendorId: vendor.id,
          vendorName: vendor.name,
          productCount: vendorProducts.length,
          eqCount,
          logoUrl: vendor.logoPath ? `${opraAssetBaseUrl}${vendor.logoPath}` : null,
          sampleAssetUrl: sampleAssetPath ? `${opraAssetBaseUrl}${sampleAssetPath}` : null,
        };
      })
      .filter((vendor) => vendor.productCount > 0)
      .sort((left, right) => right.eqCount - left.eqCount || left.vendorName.localeCompare(right.vendorName));
  }

  private createPreview(eq: OpraEq, product: OpraProduct, vendor: OpraVendor): OpraHeadphoneCorrectionPreview {
    const warnings: string[] = [];
    const bands: EqBand[] = Array.from({ length: eqBandCount }, (_, index) => ({
      ...defaultBand(index),
      enabled: false,
    }));
    let importedBandCount = 0;
    let skippedBandCount = 0;
    let adjustedBandCount = 0;

    eq.bands.slice(0, eqBandCount).forEach((input, index) => {
      const filterType = mapOpraFilterType(input.type);
      const frequency = readNumber(input.frequency);
      if (!filterType || frequency === null) {
        skippedBandCount += 1;
        return;
      }

      const rawGainDb = readNumber(input.gain_db) ?? 0;
      const rawQ = readNumber(input.q) ?? (input.slope ? 0.707 : 1);
      const frequencyHz = clamp(frequency, eqMinFrequencyHz, eqMaxFrequencyHz);
      const gainDb = filterType === 'lowPass' || filterType === 'highPass'
        ? 0
        : clamp(rawGainDb, eqMinGainDb, eqMaxGainDb);
      const q = clamp(rawQ, eqMinQ, eqMaxQ);
      if (frequencyHz !== frequency || gainDb !== rawGainDb || q !== rawQ || input.slope) {
        adjustedBandCount += 1;
      }
      bands[index] = {
        frequencyHz,
        gainDb,
        q,
        filterType,
        enabled: true,
      };
      importedBandCount += 1;
    });

    if (eq.bands.length > eqBandCount) {
      skippedBandCount += eq.bands.length - eqBandCount;
    }

    const preampDb = clamp(eq.preampDb, eqMinPreampDb, eqMaxPreampDb);
    if (preampDb !== eq.preampDb) {
      adjustedBandCount += 1;
    }
    if (adjustedBandCount > 0) {
      warnings.push('部分 OPRA 参数已按 ECHO 安全范围调整。');
    }
    if (skippedBandCount > 0) {
      warnings.push(`${skippedBandCount} 个 OPRA 滤波器暂不支持，已跳过。`);
    }

    const nameParts = [vendor.name, product.name, eq.author].filter(Boolean);
    const presetName = `耳机校正 - ${nameParts.join(' / ')}`.slice(0, 64);
    const presetId = safePresetId(`opra-${eq.id}`);

    return {
      eqId: eq.id,
      productId: product.id,
      productName: product.name,
      productSubtype: product.subtype,
      vendorId: vendor.id,
      vendorName: vendor.name,
      author: eq.author,
      details: eq.details,
      link: eq.link,
      preset: {
        id: presetId,
        name: presetName,
        preampDb,
        bands,
      },
      originalBandCount: eq.bands.length,
      importedBandCount,
      skippedBandCount,
      adjustedBandCount,
      warnings,
    };
  }
}

let singleton: OpraService | null = null;

export const getOpraService = (): OpraService => {
  if (!singleton) {
    singleton = new OpraService({
      cachePath: join(app.getPath('userData'), 'opra', 'database_v1.jsonl'),
    });
  }
  return singleton;
};
