import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Clock3, Headphones, RefreshCw, Search, Star, X } from 'lucide-react';
import type { EqState } from '../../../shared/types/eq';
import type {
  OpraHeadphoneCorrectionBrowseResult,
  OpraHeadphoneCorrectionPreview,
  OpraHeadphoneCorrectionProductResult,
  OpraHeadphoneCorrectionVendorResult,
} from '../../../shared/types/opra';
import { getEchoBridge, getEqBridge } from '../../utils/echoBridge';
import { computeEqResponseGainDbAtFrequency } from './eqPanelUtils';

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

const formatDb = (value: number): string => `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10} dB`;

const frequencyToX = (frequencyHz: number): number => {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return ((Math.log10(Math.max(20, Math.min(20000, frequencyHz))) - min) / (max - min)) * 100;
};

const gainToY = (gainDb: number): number => 50 - (Math.max(-18, Math.min(18, gainDb)) / 36) * 100;

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
      : '选择一个型号和 preset 后启用';

  const loadBrowse = useCallback(async (next: {
    vendorId?: string | null;
    productId?: string | null;
    query?: string;
    refresh?: boolean;
  } = {}): Promise<void> => {
    const eq = getEqBridge();
    if (!eq?.browseHeadphoneCorrections) {
      setMessage('耳机校正数据库暂不可用。');
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
        setMessage('OPRA 数据库还没有缓存，点刷新库获取品牌和型号。');
      } else if (result.products.length === 0 && (nextVendorId || nextQuery.trim())) {
        setMessage('没有找到匹配的耳机型号。');
      }
    } catch (browseError) {
      setMessage(browseError instanceof Error ? browseError.message : String(browseError));
    } finally {
      setBusy(null);
    }
  }, [query, selectedProductId, selectedVendorId]);

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
      setMessage('耳机校正数据库暂不可用。');
      return;
    }

    setBusy('apply');
    setMessage(null);
    try {
      const result = await eq.applyHeadphoneCorrection({ eqId: preview.eqId, enableEq: true });
      onApplied?.(result.state);
      await onAppliedStatusRefresh?.();
      rememberRecentProduct(previewToStoredProduct(result.preview));
      setMessage(`已应用 ${result.preview.vendorName} ${result.preview.productName}`);
    } catch (applyError) {
      setMessage(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setBusy(null);
    }
  }, [onApplied, onAppliedStatusRefresh, rememberRecentProduct]);

  const toggleHeadphoneCorrection = useCallback(async (): Promise<void> => {
    const eq = getEqBridge();
    if (!eq) {
      setMessage('耳机校正数据库暂不可用。');
      return;
    }

    if (hasAppliedHeadphoneCorrection && eq.setEnabled) {
      setBusy('toggle');
      setMessage(null);
      try {
        const nextState = await eq.setEnabled(!eqState.enabled);
        onApplied?.(nextState);
        await onAppliedStatusRefresh?.();
        setMessage(nextState.enabled ? '耳机校正已启用。' : '耳机校正已关闭。');
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

    setMessage('先选择一个生产商、型号和 preset。');
  }, [applyCorrection, eqState.enabled, hasAppliedHeadphoneCorrection, onApplied, onAppliedStatusRefresh, selectedPreview]);

  return (
    <section className="opra-browser" aria-label="耳机校正">
      <header className="opra-browser-control">
        <div>
          <span>耳机校正</span>
          <strong>{headphoneCorrectionEnabled ? '已启用' : hasAppliedHeadphoneCorrection ? '已关闭' : '未选择 preset'}</strong>
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
          <strong>{headphoneCorrectionEnabled ? '开启中' : '开启'}</strong>
        </label>
      </header>
      <div className="opra-browser-main">
        <header className="opra-browser-intro">
          <div>
            <span>OPRA by Roon</span>
            <strong>耳机校正</strong>
          </div>
          <p>OPRA 是开放、社区维护的耳机型号与 EQ 补偿曲线目录。先按生产商浏览，也可以直接搜索型号。</p>
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
            aria-label="按型号或生产商搜索"
            placeholder="按型号名称或制造商搜索"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                setQuery('');
                void loadBrowse({ query: '', productId: null });
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
          <button type="submit" disabled={busy !== null}>搜索</button>
          <button type="button" disabled={busy !== null} onClick={() => void loadBrowse({ refresh: true })}>
            <RefreshCw size={15} aria-hidden="true" />刷新库
          </button>
        </form>

        <div className="opra-browser-crumbs">
          <button type="button" data-active={!selectedVendorId} onClick={() => chooseVendor(null)}>所有生产商</button>
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
              <section aria-label="收藏型号">
                <header>
                  <Star size={14} aria-hidden="true" />
                  <span>收藏型号</span>
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
              <section aria-label="最近使用">
                <header>
                  <Clock3 size={14} aria-hidden="true" />
                  <span>最近使用</span>
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
            <span>{status.vendorCount} 个品牌</span>
            <span>{status.productCount} 款耳机</span>
            <span>{status.eqCount} 条曲线</span>
            <span>{status.source === 'network' ? '刚刚更新' : status.source === 'cache' ? '本地缓存' : '未缓存'}</span>
          </div>
        ) : null}
        {message ? <p className="opra-browser-message">{message}</p> : null}

        {!selectedVendorId && !query.trim() ? (
          <div className="opra-vendor-grid" aria-label="所有生产商">
            {(browse?.vendors ?? []).map((vendor) => (
              <button type="button" key={vendor.vendorId} onClick={() => chooseVendor(vendor)}>
                {vendor.logoUrl || vendor.sampleAssetUrl ? <img src={vendor.logoUrl ?? vendor.sampleAssetUrl ?? ''} alt="" loading="lazy" /> : <strong>{createVendorInitials(vendor.vendorName)}</strong>}
                <span>{vendor.vendorName}</span>
                <small>{vendor.productCount} 款 / {vendor.eqCount} preset</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="opra-product-list" aria-label="耳机型号">
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
                <em>{product.eqs.length} preset{product.eqs.length === 1 ? '' : 's'}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="opra-browser-preview" aria-label="耳机校正预览">
        <div className="opra-curve">
          <svg viewBox="0 0 100 100" role="img" aria-label="OPRA EQ curve preview" preserveAspectRatio="none">
            <g className="opra-curve-grid">
              {[20, 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequency) => <line key={frequency} x1={frequencyToX(frequency)} x2={frequencyToX(frequency)} y1="0" y2="100" />)}
              {[-18, -12, -6, 0, 6, 12, 18].map((gain) => <line key={gain} x1="0" x2="100" y1={gainToY(gain)} y2={gainToY(gain)} />)}
            </g>
            {previewPath ? <path className="opra-curve-line" d={previewPath} /> : null}
          </svg>
          {!selectedPreview ? (
            <div className="opra-empty-preset">
              <Headphones size={28} aria-hidden="true" />
              <strong>No preset selected</strong>
              <span>Browse by manufacturer or model and find the perfect preset for you.</span>
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
                  aria-label={selectedProductFavorited ? '取消收藏型号' : '收藏型号'}
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
                    <small>{preview.details ?? `${preview.importedBandCount} OPRA filters`}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p>选择生产商和型号后会显示可用 preset。</p>
          )}

          {selectedPreview ? (
            <>
              <div className="opra-preset-metrics">
                <span><em>Preamp</em><strong>{formatDb(selectedPreview.preset.preampDb)}</strong></span>
                <span><em>OPRA filters</em><strong>{selectedPreviewActiveFilterCount}/{selectedPreview.originalBandCount}</strong></span>
                <span><em>调整</em><strong>{selectedPreview.adjustedBandCount}</strong></span>
              </div>
              {selectedPreview.warnings.length > 0 ? <p>{selectedPreview.warnings.join(' ')}</p> : null}
              <div className="opra-preset-actions">
                {selectedPreview.link ? (
                  <button type="button" onClick={() => void getEchoBridge()?.app?.openExternalUrl(selectedPreview.link!)}>
                    打开来源
                  </button>
                ) : null}
                <button type="button" disabled={busy === 'apply'} onClick={() => void applyCorrection(selectedPreview)}>
                  应用耳机校正
                </button>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </section>
  );
};
