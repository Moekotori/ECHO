import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight, Clock3, Headphones, RefreshCw, Search, Star, X } from 'lucide-react';
import type { EqState } from '../../../shared/types/eq';
import type {
  OpraHeadphoneCorrectionBrowseResult,
  OpraHeadphoneCorrectionPreview,
  OpraHeadphoneCorrectionProductResult,
  OpraHeadphoneCorrectionVendorResult,
} from '../../../shared/types/opra';
import { useOptionalI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/locales';
import { getEchoBridge, getEqBridge } from '../../utils/echoBridge';
import { computeEqResponseGainDbAtFrequency, formatFrequencyLabel } from './eqPanelUtils';

type HeadphoneCorrectionPanelProps = {
  eqState: EqState;
  onApplied?: (state: EqState) => void;
  onAppliedStatusRefresh?: () => Promise<void> | void;
};

type StoredHeadphoneProduct = {
  productId: string;
  productName: string;
  vendorId: string;
  vendorName: string;
  assetUrl: string | null;
};

type HeadphoneCorrectionTextKey =
  | 'action.apply'
  | 'action.openSource'
  | 'aria.favorites'
  | 'aria.panel'
  | 'aria.preview'
  | 'aria.products'
  | 'aria.recent'
  | 'aria.search'
  | 'aria.vendors'
  | 'control.detail.empty'
  | 'control.status.disabled'
  | 'control.status.enabled'
  | 'control.status.noPreset'
  | 'control.toggle.enable'
  | 'control.toggle.on'
  | 'curve.aria'
  | 'empty.detail'
  | 'empty.title'
  | 'favorite.add'
  | 'favorite.remove'
  | 'intro.detail'
  | 'intro.kicker'
  | 'message.applied'
  | 'message.cacheEmpty'
  | 'message.chooseBeforeEnable'
  | 'message.disabled'
  | 'message.enabled'
  | 'message.noMatches'
  | 'message.unavailable'
  | 'metric.adjusted'
  | 'metric.filters'
  | 'metric.preamp'
  | 'preset.filterCount'
  | 'preset.panel.empty'
  | 'product.presetCount.many'
  | 'product.presetCount.one'
  | 'search.clear'
  | 'search.placeholder'
  | 'search.refresh'
  | 'search.submit'
  | 'shortcut.favorites'
  | 'shortcut.recent'
  | 'status.eqCount'
  | 'status.productCount'
  | 'status.source.cache'
  | 'status.source.empty'
  | 'status.source.network'
  | 'status.vendorCount'
  | 'title'
  | 'vendors.all'
  | 'vendor.stats';

type HeadphoneCorrectionTranslateOptions = Record<string, string | number>;

const headphoneCorrectionTextZhCN: Record<HeadphoneCorrectionTextKey, string> = {
  'action.apply': '应用耳机校正',
  'action.openSource': '打开来源',
  'aria.favorites': '收藏型号',
  'aria.panel': '耳机校正',
  'aria.preview': '耳机校正预览',
  'aria.products': '耳机型号',
  'aria.recent': '最近使用',
  'aria.search': '按型号或生产商搜索',
  'aria.vendors': '所有生产商',
  'control.detail.empty': '选择一个型号和预设后启用',
  'control.status.disabled': '已关闭',
  'control.status.enabled': '已启用',
  'control.status.noPreset': '未选择预设',
  'control.toggle.enable': '开启',
  'control.toggle.on': '已开启',
  'curve.aria': 'OPRA EQ 曲线预览',
  'empty.detail': '按生产商或型号浏览，找到合适的校正预设。',
  'empty.title': '未选择预设',
  'favorite.add': '收藏型号',
  'favorite.remove': '取消收藏型号',
  'intro.detail': 'OPRA 是开放、社区维护的耳机型号与 EQ 补偿曲线目录。先按生产商浏览，也可以直接搜索型号。',
  'intro.kicker': 'OPRA by Roon',
  'message.applied': '已应用 {vendor} {product}',
  'message.cacheEmpty': 'OPRA 数据库还没有缓存，点刷新库获取品牌和型号。',
  'message.chooseBeforeEnable': '先选择一个生产商、型号和预设。',
  'message.disabled': '耳机校正已关闭。',
  'message.enabled': '耳机校正已启用。',
  'message.noMatches': '没有找到匹配的耳机型号。',
  'message.unavailable': '耳机校正数据库暂不可用。',
  'metric.adjusted': '调整',
  'metric.filters': 'OPRA 滤波器',
  'metric.preamp': '前级',
  'preset.filterCount': '{count} 个 OPRA 滤波器',
  'preset.panel.empty': '选择生产商和型号后会显示可用预设。',
  'product.presetCount.many': '{count} 个预设',
  'product.presetCount.one': '{count} 个预设',
  'search.clear': '清除搜索',
  'search.placeholder': '按型号名称或制造商搜索',
  'search.refresh': '刷新库',
  'search.submit': '搜索',
  'shortcut.favorites': '收藏型号',
  'shortcut.recent': '最近使用',
  'status.eqCount': '{count} 条曲线',
  'status.productCount': '{count} 款耳机',
  'status.source.cache': '本地缓存',
  'status.source.empty': '未缓存',
  'status.source.network': '刚刚更新',
  'status.vendorCount': '{count} 个品牌',
  'title': '耳机校正',
  'vendors.all': '所有生产商',
  'vendor.stats': '{productCount} 款 / {eqCount} 个预设',
};

const headphoneCorrectionTextEnUS: Record<HeadphoneCorrectionTextKey, string> = {
  'action.apply': 'Apply headphone correction',
  'action.openSource': 'Open source',
  'aria.favorites': 'Favorite models',
  'aria.panel': 'Headphone correction',
  'aria.preview': 'Headphone correction preview',
  'aria.products': 'Headphone models',
  'aria.recent': 'Recently used',
  'aria.search': 'Search by model or manufacturer',
  'aria.vendors': 'All manufacturers',
  'control.detail.empty': 'Choose a model and preset before enabling',
  'control.status.disabled': 'Disabled',
  'control.status.enabled': 'Enabled',
  'control.status.noPreset': 'No preset selected',
  'control.toggle.enable': 'Enable',
  'control.toggle.on': 'Enabled',
  'curve.aria': 'OPRA EQ curve preview',
  'empty.detail': 'Browse by manufacturer or model to find a matching correction preset.',
  'empty.title': 'No preset selected',
  'favorite.add': 'Favorite model',
  'favorite.remove': 'Remove favorite model',
  'intro.detail': 'OPRA is an open, community-maintained catalog of headphone models and EQ compensation curves. Browse by manufacturer first, or search for a model directly.',
  'intro.kicker': 'OPRA by Roon',
  'message.applied': 'Applied {vendor} {product}',
  'message.cacheEmpty': 'The OPRA database is not cached yet. Refresh the library to fetch brands and models.',
  'message.chooseBeforeEnable': 'Choose a manufacturer, model, and preset first.',
  'message.disabled': 'Headphone correction is disabled.',
  'message.enabled': 'Headphone correction is enabled.',
  'message.noMatches': 'No matching headphone models found.',
  'message.unavailable': 'Headphone correction database is unavailable.',
  'metric.adjusted': 'Adjusted',
  'metric.filters': 'OPRA filters',
  'metric.preamp': 'Preamp',
  'preset.filterCount': '{count} OPRA filters',
  'preset.panel.empty': 'Choose a manufacturer and model to show available presets.',
  'product.presetCount.many': '{count} presets',
  'product.presetCount.one': '{count} preset',
  'search.clear': 'Clear search',
  'search.placeholder': 'Search by model name or manufacturer',
  'search.refresh': 'Refresh library',
  'search.submit': 'Search',
  'shortcut.favorites': 'Favorite models',
  'shortcut.recent': 'Recently used',
  'status.eqCount': '{count} curves',
  'status.productCount': '{count} headphones',
  'status.source.cache': 'Local cache',
  'status.source.empty': 'Not cached',
  'status.source.network': 'Updated now',
  'status.vendorCount': '{count} brands',
  'title': 'Headphone correction',
  'vendors.all': 'All manufacturers',
  'vendor.stats': '{productCount} models / {eqCount} presets',
};

const headphoneCorrectionTexts: Record<Locale, Record<HeadphoneCorrectionTextKey, string>> = {
  'zh-CN': headphoneCorrectionTextZhCN,
  'zh-TW': headphoneCorrectionTextZhCN,
  'ja-JP': headphoneCorrectionTextEnUS,
  'en-US': headphoneCorrectionTextEnUS,
};

const interpolateText = (text: string, options?: HeadphoneCorrectionTranslateOptions): string => {
  if (!options) {
    return text;
  }

  return Object.entries(options).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value)),
    text,
  );
};

const formatDb = (value: number): string => `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10} dB`;

const frequencyToX = (frequencyHz: number): number => {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return ((Math.log10(Math.max(20, Math.min(20000, frequencyHz))) - min) / (max - min)) * 100;
};

const gainToY = (gainDb: number): number => 50 - (Math.max(-18, Math.min(18, gainDb)) / 36) * 100;

const opraCurveFrequencyTicksHz = [20, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const opraCurveGainTicksDb = [-12, -6, 0, 6, 12];

const createPreviewPath = (preview: OpraHeadphoneCorrectionPreview | null): string => {
  if (!preview) {
    return '';
  }

  const points = Array.from({ length: 96 }, (_, index) => {
    const t = index / 95;
    const frequency = 20 * (20000 / 20) ** t;
    return `${frequencyToX(frequency).toFixed(2)},${gainToY(computeEqResponseGainDbAtFrequency(preview.preset.bands, frequency)).toFixed(2)}`;
  });

  return `M ${points.join(' L ')}`;
};

const createVendorInitials = (name: string): string =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

const opraFavoriteProductsStorageKey = 'echo-next.opra.favoriteProducts';
const opraRecentProductsStorageKey = 'echo-next.opra.recentProducts';
const maxStoredProducts = 8;

const readStoredProducts = (key: string): StoredHeadphoneProduct[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value): StoredHeadphoneProduct | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return null;
        }

        const input = value as Partial<StoredHeadphoneProduct>;
        if (!input.productId || !input.productName || !input.vendorId || !input.vendorName) {
          return null;
        }

        return {
          productId: String(input.productId),
          productName: String(input.productName),
          vendorId: String(input.vendorId),
          vendorName: String(input.vendorName),
          assetUrl: typeof input.assetUrl === 'string' ? input.assetUrl : null,
        };
      })
      .filter((value): value is StoredHeadphoneProduct => Boolean(value))
      .slice(0, maxStoredProducts);
  } catch {
    return [];
  }
};

const writeStoredProducts = (key: string, products: StoredHeadphoneProduct[]): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(products.slice(0, maxStoredProducts)));
  } catch {
    // OPRA history/favorites are UI conveniences; failing to persist should not block correction.
  }
};

const productToStoredProduct = (product: OpraHeadphoneCorrectionProductResult): StoredHeadphoneProduct => ({
  productId: product.productId,
  productName: product.productName,
  vendorId: product.vendorId,
  vendorName: product.vendorName,
  assetUrl: product.assetUrl,
});

const previewToStoredProduct = (preview: OpraHeadphoneCorrectionPreview): StoredHeadphoneProduct => ({
  productId: preview.productId,
  productName: preview.productName,
  vendorId: preview.vendorId,
  vendorName: preview.vendorName,
  assetUrl: null,
});

export const HeadphoneCorrectionPanel = ({ eqState, onApplied, onAppliedStatusRefresh }: HeadphoneCorrectionPanelProps): JSX.Element => {
  const i18n = useOptionalI18n();
  const localText = headphoneCorrectionTexts[i18n?.locale ?? 'zh-CN'] ?? headphoneCorrectionTextZhCN;
  const t = useCallback((key: HeadphoneCorrectionTextKey, options?: HeadphoneCorrectionTranslateOptions): string => {
    return interpolateText(localText[key], options);
  }, [localText]);
  const [query, setQuery] = useState('');
  const [browse, setBrowse] = useState<OpraHeadphoneCorrectionBrowseResult | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedEqId, setSelectedEqId] = useState('');
  const [busy, setBusy] = useState<'browse' | 'refresh' | 'apply' | 'toggle' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<StoredHeadphoneProduct[]>(() => readStoredProducts(opraFavoriteProductsStorageKey));
  const [recentProducts, setRecentProducts] = useState<StoredHeadphoneProduct[]>(() => readStoredProducts(opraRecentProductsStorageKey));

  const selectedProduct = useMemo<OpraHeadphoneCorrectionProductResult | null>(() => {
    if (!browse) {
      return null;
    }

    return browse.products.find((product) => product.productId === selectedProductId)
      ?? browse.selectedProduct
      ?? null;
  }, [browse, selectedProductId]);
  const selectedPreview = selectedProduct?.eqs.find((preview) => preview.eqId === selectedEqId) ?? selectedProduct?.eqs[0] ?? null;
  const selectedVendor = browse?.vendors.find((vendor) => vendor.vendorId === selectedVendorId) ?? null;
  const previewPath = createPreviewPath(selectedPreview);
  const selectedPreviewActiveFilterCount = selectedPreview?.preset.bands.filter((band) => band.enabled !== false).length ?? 0;
  const status = browse?.status;
  const selectedProductFavorited = Boolean(selectedProduct && favoriteProducts.some((product) => product.productId === selectedProduct.productId));
  const hasAppliedHeadphoneCorrection = eqState.presetName.startsWith('耳机校正 -');
  const headphoneCorrectionEnabled = hasAppliedHeadphoneCorrection && eqState.enabled;
  const controlDetail = hasAppliedHeadphoneCorrection
    ? eqState.presetName.replace(/^耳机校正 -\s*/u, '')
    : selectedPreview
      ? `${selectedPreview.vendorName} / ${selectedPreview.productName} / ${selectedPreview.author}`
      : t('control.detail.empty');

  const loadBrowse = useCallback(async (next: {
    vendorId?: string | null;
    productId?: string | null;
    query?: string;
    refresh?: boolean;
  } = {}): Promise<void> => {
    const eq = getEqBridge();
    if (!eq?.browseHeadphoneCorrections) {
      setMessage(t('message.unavailable'));
      return;
    }

    const nextVendorId = next.vendorId !== undefined ? next.vendorId : selectedVendorId;
    const nextProductId = next.productId !== undefined ? next.productId : selectedProductId;
    const nextQuery = next.query !== undefined ? next.query : query;
    setBusy(next.refresh ? 'refresh' : 'browse');
    setMessage(null);
    try {
      const result = await eq.browseHeadphoneCorrections({
        vendorId: nextVendorId,
        productId: nextProductId,
        query: nextQuery.trim(),
        limit: 90,
        refresh: next.refresh === true,
      });
      setBrowse(result);
      setSelectedVendorId(result.vendorId);
      const nextSelectedProduct = result.selectedProduct ?? null;
      setSelectedProductId(nextSelectedProduct?.productId ?? null);
      setSelectedEqId(nextSelectedProduct?.eqs[0]?.eqId ?? '');
      if (result.status.source === 'empty') {
        setMessage(t('message.cacheEmpty'));
      } else if (result.products.length === 0 && (nextVendorId || nextQuery.trim())) {
        setMessage(t('message.noMatches'));
      }
    } catch (browseError) {
      setMessage(browseError instanceof Error ? browseError.message : String(browseError));
    } finally {
      setBusy(null);
    }
  }, [query, selectedProductId, selectedVendorId, t]);

  useEffect(() => {
    void loadBrowse();
    // Initial OPRA catalog load is intentionally one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseVendor = (vendor: OpraHeadphoneCorrectionVendorResult | null): void => {
    setSelectedVendorId(vendor?.vendorId ?? null);
    setSelectedProductId(null);
    setSelectedEqId('');
    void loadBrowse({ vendorId: vendor?.vendorId ?? null, productId: null });
  };

  const chooseProduct = (product: OpraHeadphoneCorrectionProductResult): void => {
    setSelectedProductId(product.productId);
    setSelectedEqId(product.eqs[0]?.eqId ?? '');
  };

  const openStoredProduct = (product: StoredHeadphoneProduct): void => {
    setQuery('');
    setSelectedVendorId(product.vendorId);
    setSelectedProductId(product.productId);
    setSelectedEqId('');
    void loadBrowse({ vendorId: product.vendorId, productId: product.productId, query: '' });
  };

  const rememberRecentProduct = useCallback((product: StoredHeadphoneProduct): void => {
    setRecentProducts((current) => {
      const next = [product, ...current.filter((item) => item.productId !== product.productId)].slice(0, maxStoredProducts);
      writeStoredProducts(opraRecentProductsStorageKey, next);
      return next;
    });
  }, []);

  const toggleFavoriteProduct = (): void => {
    if (!selectedProduct) {
      return;
    }

    const stored = productToStoredProduct(selectedProduct);
    setFavoriteProducts((current) => {
      const exists = current.some((product) => product.productId === stored.productId);
      const next = exists
        ? current.filter((product) => product.productId !== stored.productId)
        : [stored, ...current].slice(0, maxStoredProducts);
      writeStoredProducts(opraFavoriteProductsStorageKey, next);
      return next;
    });
  };

  const applyCorrection = useCallback(async (preview: OpraHeadphoneCorrectionPreview | null): Promise<void> => {
    if (!preview) {
      return;
    }

    const eq = getEqBridge();
    if (!eq?.applyHeadphoneCorrection) {
      setMessage(t('message.unavailable'));
      return;
    }

    setBusy('apply');
    setMessage(null);
    try {
      const result = await eq.applyHeadphoneCorrection({ eqId: preview.eqId, enableEq: true });
      onApplied?.(result.state);
      await onAppliedStatusRefresh?.();
      rememberRecentProduct(previewToStoredProduct(result.preview));
      setMessage(t('message.applied', { vendor: result.preview.vendorName, product: result.preview.productName }));
    } catch (applyError) {
      setMessage(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setBusy(null);
    }
  }, [onApplied, onAppliedStatusRefresh, rememberRecentProduct, t]);

  const toggleHeadphoneCorrection = useCallback(async (): Promise<void> => {
    const eq = getEqBridge();
    if (!eq) {
      setMessage(t('message.unavailable'));
      return;
    }

    if (hasAppliedHeadphoneCorrection && eq.setEnabled) {
      setBusy('toggle');
      setMessage(null);
      try {
        const nextState = await eq.setEnabled(!eqState.enabled);
        onApplied?.(nextState);
        await onAppliedStatusRefresh?.();
        setMessage(nextState.enabled ? t('message.enabled') : t('message.disabled'));
      } catch (toggleError) {
        setMessage(toggleError instanceof Error ? toggleError.message : String(toggleError));
      } finally {
        setBusy(null);
      }
      return;
    }

    if (selectedPreview) {
      await applyCorrection(selectedPreview);
      return;
    }

    setMessage(t('message.chooseBeforeEnable'));
  }, [applyCorrection, eqState.enabled, hasAppliedHeadphoneCorrection, onApplied, onAppliedStatusRefresh, selectedPreview, t]);

  return (
    <section className="opra-browser" aria-label={t('aria.panel')}>
      <header className="opra-browser-control">
        <div>
          <span>{t('title')}</span>
          <strong>{headphoneCorrectionEnabled ? t('control.status.enabled') : hasAppliedHeadphoneCorrection ? t('control.status.disabled') : t('control.status.noPreset')}</strong>
          <small>{controlDetail}</small>
        </div>
        <label className="opra-enable-switch" data-active={headphoneCorrectionEnabled}>
          <input
            type="checkbox"
            checked={headphoneCorrectionEnabled}
            disabled={busy !== null || (!hasAppliedHeadphoneCorrection && !selectedPreview)}
            onChange={() => void toggleHeadphoneCorrection()}
          />
          <span aria-hidden="true" />
          <strong>{headphoneCorrectionEnabled ? t('control.toggle.on') : t('control.toggle.enable')}</strong>
        </label>
      </header>
      <div className="opra-browser-main">
        <header className="opra-browser-intro">
          <div>
            <span>{t('intro.kicker')}</span>
            <strong>{t('title')}</strong>
          </div>
          <p>{t('intro.detail')}</p>
        </header>

        <form
          className="opra-browser-search"
          onSubmit={(event) => {
            event.preventDefault();
            void loadBrowse({ query, productId: null });
          }}
        >
          <Search size={18} aria-hidden="true" />
          <input
            aria-label={t('aria.search')}
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label={t('search.clear')}
              onClick={() => {
                setQuery('');
                void loadBrowse({ query: '', productId: null });
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
          <button type="submit" disabled={busy !== null}>{t('search.submit')}</button>
          <button type="button" disabled={busy !== null} onClick={() => void loadBrowse({ refresh: true })}>
            <RefreshCw size={15} aria-hidden="true" />{t('search.refresh')}
          </button>
        </form>

        <div className="opra-browser-crumbs">
          <button type="button" data-active={!selectedVendorId} onClick={() => chooseVendor(null)}>{t('vendors.all')}</button>
          {selectedVendor ? (
            <>
              <ChevronRight size={15} aria-hidden="true" />
              <span>{selectedVendor.vendorName}</span>
            </>
          ) : null}
        </div>

        {favoriteProducts.length > 0 || recentProducts.length > 0 ? (
          <div className="opra-shortcuts">
            {favoriteProducts.length > 0 ? (
              <section aria-label={t('aria.favorites')}>
                <header>
                  <Star size={14} aria-hidden="true" />
                  <span>{t('shortcut.favorites')}</span>
                </header>
                <div>
                  {favoriteProducts.map((product) => (
                    <button type="button" key={product.productId} onClick={() => openStoredProduct(product)}>
                      <strong>{product.productName}</strong>
                      <small>{product.vendorName}</small>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {recentProducts.length > 0 ? (
              <section aria-label={t('aria.recent')}>
                <header>
                  <Clock3 size={14} aria-hidden="true" />
                  <span>{t('shortcut.recent')}</span>
                </header>
                <div>
                  {recentProducts.map((product) => (
                    <button type="button" key={product.productId} onClick={() => openStoredProduct(product)}>
                      <strong>{product.productName}</strong>
                      <small>{product.vendorName}</small>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {status ? (
          <div className="opra-browser-status">
            <span>{t('status.vendorCount', { count: status.vendorCount })}</span>
            <span>{t('status.productCount', { count: status.productCount })}</span>
            <span>{t('status.eqCount', { count: status.eqCount })}</span>
            <span>{status.source === 'network' ? t('status.source.network') : status.source === 'cache' ? t('status.source.cache') : t('status.source.empty')}</span>
          </div>
        ) : null}
        {message ? <p className="opra-browser-message">{message}</p> : null}

        {!selectedVendorId && !query.trim() ? (
          <div className="opra-vendor-grid" aria-label={t('aria.vendors')}>
            {(browse?.vendors ?? []).map((vendor) => (
              <button type="button" key={vendor.vendorId} onClick={() => chooseVendor(vendor)}>
                {vendor.logoUrl || vendor.sampleAssetUrl ? <img src={vendor.logoUrl ?? vendor.sampleAssetUrl ?? ''} alt="" loading="lazy" /> : <strong>{createVendorInitials(vendor.vendorName)}</strong>}
                <span>{vendor.vendorName}</span>
                <small>{t('vendor.stats', { productCount: vendor.productCount, eqCount: vendor.eqCount })}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="opra-product-list" aria-label={t('aria.products')}>
            {(browse?.products ?? []).map((product) => (
              <button
                type="button"
                data-active={selectedProduct?.productId === product.productId}
                key={product.productId}
                onClick={() => chooseProduct(product)}
              >
                {product.assetUrl ? <img src={product.assetUrl} alt="" loading="lazy" /> : <Headphones size={34} aria-hidden="true" />}
                <span>
                  <strong>{product.productName}</strong>
                  <small>{product.vendorName}</small>
                </span>
                <em>{t(product.eqs.length === 1 ? 'product.presetCount.one' : 'product.presetCount.many', { count: product.eqs.length })}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="opra-browser-preview" aria-label={t('aria.preview')}>
        <div className="opra-curve">
          <svg viewBox="0 0 100 100" role="img" aria-label={t('curve.aria')} preserveAspectRatio="none">
            <g className="opra-curve-grid">
              {[20, 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequency) => <line key={frequency} x1={frequencyToX(frequency)} x2={frequencyToX(frequency)} y1="0" y2="100" />)}
              {[-18, -12, -6, 0, 6, 12, 18].map((gain) => <line key={gain} x1="0" x2="100" y1={gainToY(gain)} y2={gainToY(gain)} />)}
            </g>
            {previewPath ? <path className="opra-curve-line" d={previewPath} /> : null}
          </svg>
          <div className="opra-curve-frequency-axis" aria-hidden="true">
            {opraCurveFrequencyTicksHz.map((frequency) => (
              <span
                key={frequency}
                style={{ '--opra-axis-position': `${frequencyToX(frequency)}%` } as CSSProperties}
              >
                {formatFrequencyLabel(frequency)}
              </span>
            ))}
          </div>
          <div className="opra-curve-gain-axis" aria-hidden="true">
            {opraCurveGainTicksDb.map((gain) => (
              <span
                key={gain}
                style={{ '--opra-axis-position': `${gainToY(gain)}%` } as CSSProperties}
              >
                {formatDb(gain)}
              </span>
            ))}
          </div>
          {!selectedPreview ? (
            <div className="opra-empty-preset">
              <Headphones size={28} aria-hidden="true" />
              <strong>{t('empty.title')}</strong>
              <span>{t('empty.detail')}</span>
            </div>
          ) : null}
        </div>

        <div className="opra-preset-panel">
          {selectedProduct ? (
            <>
              <div className="opra-selected-product">
                {selectedProduct.assetUrl ? <img src={selectedProduct.assetUrl} alt="" loading="lazy" /> : <Headphones size={36} aria-hidden="true" />}
                <span>
                  <small>{selectedProduct.vendorName}</small>
                  <strong>{selectedProduct.productName}</strong>
                </span>
                <button
                  className="opra-favorite-button"
                  type="button"
                  aria-label={selectedProductFavorited ? t('favorite.remove') : t('favorite.add')}
                  data-active={selectedProductFavorited}
                  onClick={toggleFavoriteProduct}
                >
                  <Star size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="opra-preset-list">
                {selectedProduct.eqs.map((preview) => (
                  <button type="button" data-active={selectedPreview?.eqId === preview.eqId} key={preview.eqId} onClick={() => setSelectedEqId(preview.eqId)}>
                    <span>{preview.author}</span>
                    <small>{preview.details ?? t('preset.filterCount', { count: preview.importedBandCount })}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p>{t('preset.panel.empty')}</p>
          )}

          {selectedPreview ? (
            <>
              <div className="opra-preset-metrics">
                <span><em>{t('metric.preamp')}</em><strong>{formatDb(selectedPreview.preset.preampDb)}</strong></span>
                <span><em>{t('metric.filters')}</em><strong>{selectedPreviewActiveFilterCount}/{selectedPreview.originalBandCount}</strong></span>
                <span><em>{t('metric.adjusted')}</em><strong>{selectedPreview.adjustedBandCount}</strong></span>
              </div>
              {selectedPreview.warnings.length > 0 ? <p>{selectedPreview.warnings.join(' ')}</p> : null}
              <div className="opra-preset-actions">
                {selectedPreview.link ? (
                  <button type="button" onClick={() => void getEchoBridge()?.app?.openExternalUrl(selectedPreview.link!)}>
                    {t('action.openSource')}
                  </button>
                ) : null}
                <button type="button" disabled={busy === 'apply'} onClick={() => void applyCorrection(selectedPreview)}>
                  {t('action.apply')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </section>
  );
};
