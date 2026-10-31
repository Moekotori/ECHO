import { safeStorage } from 'electron';

const prefix = 'plain:';

export class RemoteSourceSecretStore {
  encrypt(secret: string | null | undefined): string | null {
    const normalized = typeof secret === 'string' && secret.length > 0 ? secret : null;
    if (!normalized) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return `${prefix}${Buffer.from(normalized, 'utf8').toString('base64')}`;
    }

    return safeStorage.encryptString(normalized).toString('base64');
  }

  decrypt(encryptedSecret: string | null | undefined): string | null {
    if (!encryptedSecret) {
      return null;
    }

    if (encryptedSecret.startsWith(prefix)) {
      return Buffer.from(encryptedSecret.slice(prefix.length), 'base64').toString('utf8');
    }

    try {
      return safeStorage.decryptString(Buffer.from(encryptedSecret, 'base64'));
    } catch {
      return null;
    }
  }
}
