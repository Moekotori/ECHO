import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { StreamingProviderName } from '../../shared/types/streaming';

export type ProtectedMusicDownloadProvider = Extract<StreamingProviderName, 'netease' | 'qqmusic' | 'kugou'>;

type DownloadAuthorizationPayload = {
  v: 1;
  provider: ProtectedMusicDownloadProvider;
  providerTrackId: string;
  url: string;
  expiresAt: string;
  issuedAt: string;
};

type DownloadAuthorizationInput = {
  provider: StreamingProviderName;
  providerTrackId: string | null | undefined;
  url: string;
  expiresAt?: string | null;
};

const protectedMusicDownloadProviders = new Set<StreamingProviderName>(['netease', 'qqmusic', 'kugou']);
const authorizationSecret = randomBytes(32);
const maxAuthorizationTtlMs = 5 * 60 * 1000;
const authorizationClockSkewMs = 30 * 1000;

export const protectedMusicDownloadBlockedMessage =
  'DMCA 保护已阻止下载：需要先通过对应音乐平台账号解析播放授权，ECHO 不允许绕过会员或版权检查下载。';

export const isProtectedMusicDownloadProvider = (provider: StreamingProviderName | null | undefined): provider is ProtectedMusicDownloadProvider =>
  Boolean(provider && protectedMusicDownloadProviders.has(provider));

const encodeBase64Url = (value: string | Buffer): string =>
  Buffer.from(value).toString('base64').replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64').toString('utf8');
};

const sign = (encodedPayload: string): string => encodeBase64Url(createHmac('sha256', authorizationSecret).update(encodedPayload).digest());

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeUrl = (url: string): string => url.trim();

const tokenExpiry = (sourceExpiresAt: string | null | undefined, nowMs: number): string => {
  const sourceExpiresAtMs = sourceExpiresAt ? Date.parse(sourceExpiresAt) : NaN;
  const expiresAtMs =
    Number.isFinite(sourceExpiresAtMs) && sourceExpiresAtMs > nowMs
      ? Math.min(sourceExpiresAtMs, nowMs + maxAuthorizationTtlMs)
      : nowMs + maxAuthorizationTtlMs;
  return new Date(expiresAtMs).toISOString();
};

export const createDownloadAuthorizationToken = (input: DownloadAuthorizationInput): string | null => {
  if (!isProtectedMusicDownloadProvider(input.provider) || !input.providerTrackId?.trim() || !input.url.trim()) {
    return null;
  }

  const nowMs = Date.now();
  const payload: DownloadAuthorizationPayload = {
    v: 1,
    provider: input.provider,
    providerTrackId: input.providerTrackId.trim(),
    url: normalizeUrl(input.url),
    expiresAt: tokenExpiry(input.expiresAt, nowMs),
    issuedAt: new Date(nowMs).toISOString(),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
};

export const verifyDownloadAuthorizationToken = (token: string | null | undefined, input: DownloadAuthorizationInput): boolean => {
  if (!isProtectedMusicDownloadProvider(input.provider) || !input.providerTrackId?.trim() || !input.url.trim() || !token?.trim()) {
    return false;
  }

  const [encodedPayload, signature, ...extraParts] = token.trim().split('.');
  if (!encodedPayload || !signature || extraParts.length > 0 || !safeEqual(signature, sign(encodedPayload))) {
    return false;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<DownloadAuthorizationPayload>;
    if (
      payload.v !== 1 ||
      payload.provider !== input.provider ||
      payload.providerTrackId !== input.providerTrackId.trim() ||
      payload.url !== normalizeUrl(input.url)
    ) {
      return false;
    }

    const expiresAtMs = typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : NaN;
    return Number.isFinite(expiresAtMs) && expiresAtMs + authorizationClockSkewMs >= Date.now();
  } catch {
    return false;
  }
};
