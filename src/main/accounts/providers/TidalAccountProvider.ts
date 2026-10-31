import type { AccountStatus } from '../../../shared/types/accounts';
import { AccountProviderBase, type StoredAccountRecord } from './AccountProviderBase';

export class TidalAccountProvider extends AccountProviderBase {
  constructor() {
    super('tidal');
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
    return Boolean(record?.refreshToken || record?.accessToken);
  }
}
