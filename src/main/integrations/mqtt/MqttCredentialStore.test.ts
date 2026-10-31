import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MqttCredentialStore, type MqttSecretStore } from './MqttCredentialStore';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('MqttCredentialStore', () => {
  it('persists only an encrypted password envelope', () => {
    const root = mkdtempSync(join(tmpdir(), 'echo-mqtt-credentials-'));
    tempRoots.push(root);
    const filePath = join(root, 'mqtt-credentials.json');
    const secretStore = {
      encrypt: (value: string | null | undefined) => value ? 'safe:encrypted-value' : null,
      decrypt: (value: unknown) => ({
        value: value === 'safe:encrypted-value' ? 'broker-secret' : null,
        rewrite: false,
        preservedEnvelope: null,
      }),
    } as MqttSecretStore;
    const store = new MqttCredentialStore(filePath, secretStore);

    store.setPassword('broker-secret');

    expect(store.hasPassword()).toBe(true);
    expect(store.getPassword()).toBe('broker-secret');
    expect(readFileSync(filePath, 'utf8')).not.toContain('broker-secret');
    expect(readFileSync(filePath, 'utf8')).toContain('safe:encrypted-value');
  });
});
