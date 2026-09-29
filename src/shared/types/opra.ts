import type { EqPreset, EqSavePresetRequest, EqState } from './eq';

export type OpraHeadphoneCorrectionSearchRequest = {
  query: string;
  limit?: number;
  refresh?: boolean;
};

export type OpraHeadphoneCorrectionBrowseRequest = {
  vendorId?: string | null;
  productId?: string | null;
  query?: string | null;
  limit?: number;
  refresh?: boolean;
};

export type OpraDatabaseStatus = {
  source: 'network' | 'cache' | 'empty';
  fetchedAt: string | null;
  vendorCount: number;
  productCount: number;
  eqCount: number;
};

export type OpraHeadphoneCorrectionPreview = {
  eqId: string;
  productId: string;
  productName: string;
  productSubtype: string | null;
  vendorId: string;
  vendorName: string;
  author: string;
  details: string | null;
  link: string | null;
  preset: EqSavePresetRequest;
  originalBandCount: number;
  importedBandCount: number;
  skippedBandCount: number;
  adjustedBandCount: number;
  warnings: string[];
};

export type OpraHeadphoneCorrectionProductResult = {
  productId: string;
  productName: string;
  productSubtype: string | null;
  vendorId: string;
  vendorName: string;
  assetUrl: string | null;
  eqs: OpraHeadphoneCorrectionPreview[];
};

export type OpraHeadphoneCorrectionVendorResult = {
  vendorId: string;
  vendorName: string;
  productCount: number;
  eqCount: number;
  logoUrl: string | null;
  sampleAssetUrl: string | null;
};

export type OpraHeadphoneCorrectionSearchResult = {
  query: string;
  results: OpraHeadphoneCorrectionProductResult[];
  status: OpraDatabaseStatus;
};

export type OpraHeadphoneCorrectionBrowseResult = {
  query: string;
  vendorId: string | null;
  productId: string | null;
  vendors: OpraHeadphoneCorrectionVendorResult[];
  products: OpraHeadphoneCorrectionProductResult[];
  selectedProduct: OpraHeadphoneCorrectionProductResult | null;
  status: OpraDatabaseStatus;
};

export type OpraHeadphoneCorrectionApplyRequest = {
  eqId: string;
  enableEq?: boolean;
};

export type OpraHeadphoneCorrectionApplyResult = {
  state: EqState;
  preset: EqPreset;
  preview: OpraHeadphoneCorrectionPreview;
};
