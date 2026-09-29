import type { AccountStatus } from '../../../shared/types/accounts';
import { AccountProviderBase, type StoredAccountRecord } from './AccountProviderBase';

export class QobuzAccountProvider extends AccountProviderBase {
  constructor() {
    super('qobuz');
  }

  override toStatus(record: StoredAccountRecord | null | undefined): AccountStatus {
    const status = super.toStatus(record);

    return {
      ...status,
      connected: this.isConnected(record),
      displayName: status.displayName ?? status.username,
    };
  }

  protected override isConnected(record: StoredAccountRecord | null | undefined): boolean {
    // Qobuz uses accessToken as user_auth_token, and refreshToken as app_secret
    return typeof record?.accessToken === 'string' && record.accessToken.trim().length > 0;
  }
}
