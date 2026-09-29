import { safeStorage } from 'electron';

const safeStoragePrefix = 'safe:';
const plainFallbackPrefix = 'plain:';

export type DecryptedAccountSecret = {
  value: string | null;
  rewrite: boolean;
  preservedEnvelope: string | null;
};

/** Keeps account secrets bound to the current OS user when Electron encryption is available. */
export class AccountSecretStore {
  encrypt(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    try {
      if (safeStorage.isEncryptionAvailable()) {
        return `${safeStoragePrefix}${safeStorage.encryptString(value).toString('base64')}`;
      }
    } catch {
      // Development shells may not expose an OS credential store. Keep a tagged,
      // reversible fallback so login state is not silently lost.
    }

    return `${plainFallbackPrefix}${Buffer.from(value, 'utf8').toString('base64')}`;
  }

  decrypt(value: unknown): DecryptedAccountSecret {
    if (typeof value !== 'string' || !value) {
      return { value: null, rewrite: false, preservedEnvelope: null };
    }

    if (value.startsWith(safeStoragePrefix)) {
      try {
        return {
          value: safeStorage.decryptString(Buffer.from(value.slice(safeStoragePrefix.length), 'base64')) || null,
          rewrite: false,
          preservedEnvelope: null,
        };
      } catch {
        // Preserve the encrypted envelope on disk. It may become readable again
        // after the OS keychain is unlocked or the app returns to the same user.
        return { value: null, rewrite: false, preservedEnvelope: value };
      }
    }

    if (value.startsWith(plainFallbackPrefix)) {
      const decoded = Buffer.from(value.slice(plainFallbackPrefix.length), 'base64').toString('utf8') || null;
      let encryptionAvailable = false;
      try {
        encryptionAvailable = safeStorage.isEncryptionAvailable();
      } catch {
        // Leave the tagged fallback in place until encryption becomes available.
      }
      return { value: decoded, rewrite: decoded !== null && encryptionAvailable, preservedEnvelope: null };
    }

    // Legacy account files stored the secret directly.
    return { value, rewrite: true, preservedEnvelope: null };
  }
}
