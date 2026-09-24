import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EchoLinkPairedClient, EchoLinkV2Scope } from '../../shared/types/echoLink';

type StoredClient = EchoLinkPairedClient & {
  tokenHash: string;
};

type StoredClientFile = {
  version: 1;
  clients: StoredClient[];
};

export type EchoLinkV2ClientStoreOptions = {
  filePath?: string | null;
  maxClients?: number;
};

const normalizeText = (value: unknown, maxLength: number): string | null =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : null;

const allowedScopes = new Set<EchoLinkV2Scope>([
  'status:read',
  'events:read',
  'playback:control',
]);

export const hashEchoLinkAccessToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const safeHashEquals = (left: string, right: string): boolean => {
  try {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
};

const toPublicClient = (client: StoredClient): EchoLinkPairedClient => ({
  id: client.id,
  name: client.name,
  platform: client.platform,
  scopes: [...client.scopes],
  createdAt: client.createdAt,
  lastSeenAt: client.lastSeenAt,
});

export class EchoLinkV2ClientStore {
  private readonly filePath: string | null;
  private readonly maxClients: number;
  private clients: StoredClient[];

  constructor(options: EchoLinkV2ClientStoreOptions = {}) {
    this.filePath = options.filePath ?? null;
    this.maxClients = options.maxClients ?? 32;
    this.clients = this.load();
  }

  listClients(): EchoLinkPairedClient[] {
    return this.clients.map(toPublicClient);
  }

  authenticate(accessToken: string): EchoLinkPairedClient | null {
    const tokenHash = hashEchoLinkAccessToken(accessToken);
    const match = this.clients.find((client) => safeHashEquals(client.tokenHash, tokenHash));
    return match ? toPublicClient(match) : null;
  }

  addClient(input: {
    id: string;
    name: string;
    platform: string | null;
    tokenHash: string;
    scopes: EchoLinkV2Scope[];
    createdAt: string;
  }): EchoLinkPairedClient {
    if (this.clients.length >= this.maxClients) {
      throw new Error('paired_client_limit_reached');
    }
    if (this.clients.some((client) => client.id === input.id)) {
      throw new Error('paired_client_id_conflict');
    }

    const client: StoredClient = {
      id: input.id,
      name: normalizeText(input.name, 80) ?? 'ECHO Link Client',
      platform: normalizeText(input.platform, 80),
      tokenHash: input.tokenHash,
      scopes: [...new Set(input.scopes.filter((scope) => allowedScopes.has(scope)))],
      createdAt: input.createdAt,
      lastSeenAt: null,
    };
    this.clients.push(client);
    this.persist();
    return toPublicClient(client);
  }

  revokeClient(clientId: string): boolean {
    const next = this.clients.filter((client) => client.id !== clientId);
    if (next.length === this.clients.length) {
      return false;
    }
    this.clients = next;
    this.persist();
    return true;
  }

  touchClient(clientId: string, observedAt: string): void {
    const client = this.clients.find((item) => item.id === clientId);
    if (!client) {
      return;
    }
    const previous = client.lastSeenAt ? Date.parse(client.lastSeenAt) : 0;
    const next = Date.parse(observedAt);
    if (!client.lastSeenAt || !Number.isFinite(next) || next - previous >= 60_000) {
      client.lastSeenAt = observedAt;
      this.persist();
    }
  }

  private load(): StoredClient[] {
    if (!this.filePath) {
      return [];
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoredClientFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.clients)) {
        return [];
      }
      return parsed.clients
        .filter((client): client is StoredClient =>
          Boolean(client) &&
          typeof client.id === 'string' &&
          typeof client.name === 'string' &&
          typeof client.tokenHash === 'string' &&
          Array.isArray(client.scopes) &&
          typeof client.createdAt === 'string',
        )
        .slice(0, this.maxClients)
        .map((client) => ({
          ...client,
          platform: normalizeText(client.platform, 80),
          scopes: client.scopes.filter((scope) => allowedScopes.has(scope)),
          lastSeenAt: normalizeText(client.lastSeenAt, 64),
        }));
    } catch {
      return [];
    }
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify({ version: 1, clients: this.clients } satisfies StoredClientFile, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(tempPath, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Windows ACLs are authoritative; chmod is best-effort.
    }
  }
}
