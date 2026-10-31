import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';

type DecryptedMqttSecret = {
  value: string | null;
  rewrite: boolean;
};

export type MqttSecretStore = {
  encrypt: (value: string | null | undefined) => string | null;
  decrypt: (value: unknown) => DecryptedMqttSecret;
};

class OsMqttSecretStore implements MqttSecretStore {
  encrypt(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('mqtt_secure_storage_unavailable');
    }
    return `safe:${safeStorage.encryptString(value).toString('base64')}`;
  }

  decrypt(value: unknown): DecryptedMqttSecret {
    if (typeof value !== 'string' || !value.startsWith('safe:')) {
      return { value: null, rewrite: false };
    }
    try {
      return {
        value: safeStorage.decryptString(Buffer.from(value.slice('safe:'.length), 'base64')) || null,
        rewrite: false,
      };
    } catch {
      return { value: null, rewrite: false };
    }
  }
}

type StoredMqttCredentials = {
  version: 1;
  encryptedPassword: string | null;
};

const emptyCredentials = (): StoredMqttCredentials => ({
  version: 1,
  encryptedPassword: null,
});

export class MqttCredentialStore {
  constructor(
    private readonly storagePath = join(app.getPath('userData'), 'mqtt-credentials.json'),
    private readonly secretStore: MqttSecretStore = new OsMqttSecretStore(),
  ) {}

  hasPassword(): boolean {
    return Boolean(this.read().encryptedPassword);
  }

  getPassword(): string | null {
    const stored = this.read();
    const decrypted = this.secretStore.decrypt(stored.encryptedPassword);
    if (decrypted.rewrite && decrypted.value) {
      this.write({
        version: 1,
        encryptedPassword: this.secretStore.encrypt(decrypted.value),
      });
    }
    return decrypted.value;
  }

  setPassword(password: string | null): void {
    this.write({
      version: 1,
      encryptedPassword: this.secretStore.encrypt(password && password.length > 0 ? password : null),
    });
  }

  private read(): StoredMqttCredentials {
    if (!existsSync(this.storagePath)) {
      return emptyCredentials();
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storagePath, 'utf8')) as Partial<StoredMqttCredentials>;
      return {
        version: 1,
        encryptedPassword: typeof parsed.encryptedPassword === 'string'
          ? parsed.encryptedPassword
          : null,
      };
    } catch {
      return emptyCredentials();
    }
  }

  private write(value: StoredMqttCredentials): void {
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
      chmodSync(temporaryPath, 0o600);
    } catch {
      // Windows ACLs remain authoritative when chmod is unavailable.
    }
    renameSync(temporaryPath, this.storagePath);
  }
}
