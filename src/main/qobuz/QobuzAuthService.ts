import type { AccountProvider } from '../../shared/types/accounts';
import type { QobuzAuthState, QobuzLoginResult, QobuzManualCredentials, QobuzTier } from '../../shared/types/qobuz';
import type { StoredAccountRecord } from '../accounts/providers/AccountProviderBase';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { getAccountService } from '../accounts/AccountService';
import { QobuzApiClient, QobuzAuthError } from './QobuzApiClient';
import { QobuzBundleExtractor } from './QobuzBundleExtractor';

const AUTH_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function mapLabelToTier(label: string | null | undefined): QobuzTier | null {
  if (!label) return null;
  const lower = label.toLowerCase();
  if (lower.includes('sublime')) return 'sublime';
  if (lower.includes('studio') || lower.includes('premier') || lower.includes('hi-fi')) return 'studio';
  if (lower.includes('free') || lower.includes('essential')) return 'free';
  return null;
}

export class QobuzAuthService {
  private static instance: QobuzAuthService | null = null;

  private readonly api: QobuzApiClient;
  private state: QobuzAuthState = {
    valid: false,
    tier: null,
    username: null,
    displayName: null,
    avatarUrl: null,
    expiresAt: null,
    lastValidatedAt: 0,
  };
  private lastValidatedMs = 0;

  private restorePromise: Promise<void> | null = null;

  private constructor() {
    this.api = new QobuzApiClient();
    // Auto-restore persisted credentials from AccountService
    try {
      const record = getAccountService().getQobuzStoredRecord();
      if (record?.accessToken) {
        this.api.setUserAuthToken(record.accessToken);
        if (record.tokenType) this.api.setAppId(record.tokenType);
        if (record.refreshToken) this.api.setActiveSecret(record.refreshToken);
        // Validate asynchronously but track the promise so getState() can await if needed
        this.restorePromise = this.validateCredentials()
          .then(() => {
            console.log('[qobuz:auth] Restored from persisted credentials — valid');
            // Broadcast so the streaming page refreshes its provider list
            broadcastQobuzAccountStatuses();
          })
          .catch((err) => {
            // Only mark invalid if no newer login has succeeded in the meantime
            if (!this.state.valid) {
              console.log('[qobuz:auth] Restore validation failed:', err?.message);
              this.state.valid = false;
              this.state.lastValidatedAt = Date.now();
            }
          });
      }
    } catch { /* ignore restore errors */ }
  }

  static getInstance(): QobuzAuthService {
    if (!QobuzAuthService.instance) {
      QobuzAuthService.instance = new QobuzAuthService();
    }
    return QobuzAuthService.instance;
  }

  getApiClient(): QobuzApiClient { return this.api; }
  getState(): QobuzAuthState {
    const copy = { ...this.state };
    console.log('[qobuz:auth] getState called, valid:', copy.valid, 'username:', copy.username);
    return copy;
  }
  isAuthenticated(): boolean { return this.state.valid; }
  get providerName(): AccountProvider { return 'qobuz'; }

  // ── persistence ──────────────────────────────────────────────

  toStoredRecord(): StoredAccountRecord {
    return {
      accessToken: this.api.getUserAuthToken() || undefined,
      refreshToken: this.api.getActiveSecret() || undefined,
      tokenType: this.api.getAppId() || undefined,
      username: this.state.username,
      displayName: this.state.displayName,
      avatarUrl: this.state.avatarUrl,
      lastLoginAt: this.state.valid ? new Date().toISOString() : undefined,
      lastCheckedAt: this.state.valid ? new Date().toISOString() : undefined,
      expiresAt: this.state.expiresAt ? new Date(this.state.expiresAt).toISOString() : undefined,
    };
  }

  async restoreFromRecord(record: StoredAccountRecord | null | undefined): Promise<void> {
    if (!record?.accessToken) { this.clearState(); return; }
    this.api.setUserAuthToken(record.accessToken);
    if (record.tokenType) this.api.setAppId(record.tokenType);
    if (record.refreshToken) this.api.setActiveSecret(record.refreshToken);
    try { await this.validateCredentials(); } catch {
      this.state.valid = false;
      this.state.lastValidatedAt = Date.now();
    }
  }

  // ── token login (primary flow) ───────────────────────────────

  /**
   * Authenticate with a user-provided user_auth_token.
   * Automatically extracts app_id + secrets from the Qobuz bundle.
   */
  async loginWithToken(credentials: QobuzManualCredentials): Promise<QobuzLoginResult> {
    const token = credentials.userAuthToken.trim();
    if (!token) {
      return { success: false, tier: null, username: null, displayName: null, avatarUrl: null, error: '请输入 user_auth_token' };
    }

    // Auto-extract app_id + secrets from bundle
    let appId = credentials.appId?.trim() || '';
    let secrets: string[] = credentials.appSecret?.trim() ? [credentials.appSecret.trim()] : [];

    if (!appId || secrets.length === 0) {
      const bundle = await QobuzBundleExtractor.extract();
      if (bundle) {
        appId = appId || bundle.appId;
        if (secrets.length === 0) secrets = bundle.secrets;
      }
    }

    if (!appId) {
      return { success: false, tier: null, username: null, displayName: null, avatarUrl: null, error: '无法自动获取 app_id。请在 qobuz-dl 目录运行 qobuz-dl -r 获取。' };
    }

    this.api.setAppId(appId);
    this.api.setUserAuthToken(token);

    // Validate token by calling user/login
    let loginResponse: Record<string, unknown>;
    try {
      loginResponse = await this.api.loginWithToken(token);
    } catch (err) {
      this.clearState();
      return { success: false, tier: null, username: null, displayName: null, avatarUrl: null, error: err instanceof Error ? err.message : 'Token 验证失败' };
    }

    const user = loginResponse.user as Record<string, unknown> | undefined;
    console.log('[qobuz:auth] login response user keys:', user ? Object.keys(user) : 'null');
    const credential = user?.credential as Record<string, unknown> | undefined;
    const parameters = credential?.parameters as Record<string, unknown> | undefined;

    if (!parameters || Object.keys(parameters).length === 0) {
      this.clearState();
      return { success: false, tier: 'free', username: null, displayName: null, avatarUrl: null, error: 'Qobuz 免费账户不支持串流播放。请升级到 Studio 或 Sublime 订阅。' };
    }

    // Find valid secret
    let secretWarning: string | undefined;
    if (secrets.length > 0) {
      for (const secret of secrets) {
        try {
          const isValid = await this.api.testSecret(secret);
          if (isValid) {
            this.api.setActiveSecret(secret);
            break;
          }
        } catch { /* continue */ }
      }
      if (!this.api.getActiveSecret()) {
        secretWarning = 'API 密钥验证失败，串流和下载功能暂时不可用。请运行 qobuz-dl -r 获取最新密钥。';
      }
    } else {
      secretWarning = '未能自动获取 API 密钥。串流和下载功能暂时不可用。请在 qobuz-dl 目录运行 qobuz-dl -r 获取。';
    }

    const shortLabel = parameters.short_label as string | undefined;
    const tier = mapLabelToTier(shortLabel ?? (credential?.label as string | undefined));
    const displayName = (user?.display_name as string) ?? (user?.login as string) ?? null;

    this.state = {
      valid: true,
      tier,
      username: (user?.login as string) ?? null,
      displayName,
      avatarUrl: (user?.avatar as string) ?? null,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      lastValidatedAt: Date.now(),
    };
    this.lastValidatedMs = Date.now();
    console.log('[qobuz:auth] loginWithToken SUCCESS, state.valid =', this.state.valid);

    return {
      success: true,
      tier,
      username: this.state.username,
      displayName,
      avatarUrl: this.state.avatarUrl,
      error: secretWarning,
    };
  }

  // ── validation ───────────────────────────────────────────────

  async validateCredentials(): Promise<void> {
    if (!this.api.getUserAuthToken() || !this.api.getAppId()) {
      throw new QobuzAuthError('No credentials');
    }
    const response = await this.api.loginWithToken(this.api.getUserAuthToken());
    const user = response.user as Record<string, unknown> | undefined;
    this.state = {
      ...this.state,
      valid: true,
      username: (user?.login as string) ?? this.state.username,
      displayName: (user?.display_name as string) ?? (user?.login as string) ?? this.state.displayName,
      avatarUrl: (user?.avatar as string) ?? this.state.avatarUrl,
      lastValidatedAt: Date.now(),
    };
    this.lastValidatedMs = Date.now();
  }

  async ensureValid(): Promise<void> {
    const now = Date.now();
    if (this.state.valid && this.lastValidatedMs > 0 && now - this.lastValidatedMs < AUTH_CHECK_INTERVAL_MS) return;
    try { await this.validateCredentials(); } catch {
      this.state.valid = false;
      this.state.lastValidatedAt = now;
      throw new QobuzAuthError('Qobuz 认证已过期，请在设置中重新输入 user_auth_token');
    }
  }

  // ── logout ───────────────────────────────────────────────────

  clearState(): void {
    this.api.setUserAuthToken('');
    this.api.setActiveSecret('');
    this.api.setAppId('');
    this.state = {
      valid: false, tier: null, username: null, displayName: null,
      avatarUrl: null, expiresAt: null, lastValidatedAt: Date.now(),
    };
    this.lastValidatedMs = 0;
  }
}

/** Broadcast account status changes so streaming page refreshes providers. */
function broadcastQobuzAccountStatuses(): void {
  try {
    const statuses = getAccountService().getStatuses();
    const qobuzStatus = statuses.find(s => s.provider === 'qobuz');
    console.log('[qobuz:auth] Broadcasting AccountStatusesChanged, qobuz:', JSON.stringify(qobuzStatus));
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannels.AccountStatusesChanged, statuses);
      }
    }
  } catch { /* ignore */ }
}
