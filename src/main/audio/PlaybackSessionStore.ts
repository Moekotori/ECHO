import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type { AudioPlaybackState, AudioStatus } from '../../shared/types/audio';
import type {
  PersistedPlaybackRepeatMode,
  PersistedPlaybackSessionResume,
  PersistedPlaybackSessionV1,
  PersistedPlaylistPlaybackSnapshot,
  PersistedPlaylistPlaybackState,
  PersistedQueueItem,
  PersistedQueueSource,
} from '../../shared/types/playback';
import type { LibraryTrack } from '../../shared/types/library';

const activeSessionId = 'active';
const playbackSessionSchemaSql = `
CREATE TABLE IF NOT EXISTS playback_queue_session (
  id TEXT PRIMARY KEY CHECK (id = 'active'),
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const runtimePragmas = [
  'busy_timeout = 5000',
  'journal_mode = WAL',
  'synchronous = FULL',
] as const;

const repeatModes = new Set<PersistedPlaybackRepeatMode>(['off', 'one', 'all']);
const queueSourceTypes = new Set(['songs', 'album', 'artist', 'folder', 'streaming', 'local-file', 'manual']);
const playbackStates = new Set<AudioPlaybackState>(['idle', 'loading', 'playing', 'paused', 'stopped', 'ended', 'error']);
const receiverIdentityPrefixes = ['dlna-receiver:', 'airplay-receiver:'];

type PlaybackSessionRow = {
  version: number;
  payload_json: string;
  updated_at: string;
};

type PlaybackSessionStoreOptions = {
  now?: () => Date;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteNonNegative = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
};

const nowIso = (now: () => Date): string => now().toISOString();

const normalizeRepeatMode = (value: unknown): PersistedPlaybackRepeatMode =>
  typeof value === 'string' && repeatModes.has(value as PersistedPlaybackRepeatMode)
    ? value as PersistedPlaybackRepeatMode
    : 'off';

const isLibraryTrackSnapshot = (value: unknown): value is LibraryTrack =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.path === 'string' &&
  typeof value.title === 'string' &&
  typeof value.artist === 'string' &&
  typeof value.album === 'string' &&
  typeof value.albumArtist === 'string' &&
  typeof value.duration === 'number' &&
  isRecord(value.fieldSources);

const isQueueSource = (value: unknown): value is PersistedQueueSource =>
  isRecord(value) &&
  typeof value.type === 'string' &&
  typeof value.label === 'string' &&
  queueSourceTypes.has(value.type);

const isQueueItemSnapshot = (value: unknown): value is PersistedQueueItem =>
  isRecord(value) &&
  typeof value.queueId === 'string' &&
  typeof value.addedAt === 'string' &&
  isQueueSource(value.source) &&
  isLibraryTrackSnapshot(value.track);

const normalizeResume = (
  value: unknown,
  queueItems: PersistedQueueItem[],
  fallbackUpdatedAt: string,
): PersistedPlaybackSessionResume | null => {
  if (!isRecord(value)) {
    return null;
  }

  const filePath = typeof value.filePath === 'string' && value.filePath.trim() ? value.filePath : null;
  const positionMs = finiteNonNegative(value.positionMs);
  const durationMs = finiteNonNegative(value.durationMs);
  const state = typeof value.state === 'string' && playbackStates.has(value.state as AudioPlaybackState)
    ? value.state as AudioPlaybackState
    : 'paused';

  if (!filePath || positionMs === null || durationMs === null) {
    return null;
  }

  const queueId = typeof value.queueId === 'string' ? value.queueId : null;
  const trackId = typeof value.trackId === 'string' ? value.trackId : null;
  const hasMatchingQueueItem = queueItems.some((item) =>
    (queueId && item.queueId === queueId) ||
    (trackId && item.track.id === trackId) ||
    item.track.path === filePath,
  );

  if (!hasMatchingQueueItem) {
    return null;
  }

  return {
    queueId,
    trackId,
    filePath,
    positionMs: Math.round(positionMs),
    durationMs: Math.round(durationMs),
    state,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt,
  };
};

const normalizePlaylistSnapshot = (
  value: unknown,
  fallbackUpdatedAt: string,
): PersistedPlaylistPlaybackSnapshot | null => {
  const session = normalizePersistedPlaybackSession(
    isRecord(value) ? { ...value, version: 1, updatedAt: fallbackUpdatedAt } : value,
    fallbackUpdatedAt,
  );
  if (!session) {
    return null;
  }

  return {
    items: session.items,
    currentQueueId: session.currentQueueId,
    currentTrackId: session.currentTrackId,
    lastPlayedTrack: session.lastPlayedTrack,
    history: session.history,
    mode: session.mode,
    resume: session.resume,
  };
};

const normalizePlaylistPlayback = (
  value: unknown,
  fallbackUpdatedAt: string,
): PersistedPlaylistPlaybackState | null => {
  if (!isRecord(value) || value.active !== true) {
    return null;
  }

  const snapshot = normalizePlaylistSnapshot(value.snapshot, fallbackUpdatedAt);
  if (!snapshot) {
    return null;
  }

  return {
    active: true,
    label: typeof value.label === 'string' ? value.label : null,
    playlistId: typeof value.playlistId === 'string' ? value.playlistId : null,
    snapshot,
  };
};

export const normalizePersistedPlaybackSession = (
  value: unknown,
  fallbackUpdatedAt = new Date().toISOString(),
): PersistedPlaybackSessionV1 | null => {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }

  const items = Array.isArray(value.items) ? value.items.filter(isQueueItemSnapshot) : [];
  const queueIds = new Set(items.map((item) => item.queueId));
  const currentQueueId = typeof value.currentQueueId === 'string' && queueIds.has(value.currentQueueId)
    ? value.currentQueueId
    : null;
  const currentTrackId = typeof value.currentTrackId === 'string'
    ? value.currentTrackId
    : currentQueueId
      ? items.find((item) => item.queueId === currentQueueId)?.track.id ?? null
      : null;
  const lastPlayedTrack = isLibraryTrackSnapshot(value.lastPlayedTrack) ? value.lastPlayedTrack : null;
  const history = Array.isArray(value.history)
    ? value.history.filter((item): item is PersistedQueueItem => isQueueItemSnapshot(item) && queueIds.has(item.queueId))
    : [];
  const mode: Record<string, unknown> = isRecord(value.mode) ? value.mode : {};
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : fallbackUpdatedAt;

  return {
    version: 1,
    items,
    currentQueueId,
    currentTrackId,
    lastPlayedTrack,
    history,
    mode: {
      isShuffleEnabled: mode.isShuffleEnabled === true,
      repeatMode: normalizeRepeatMode(mode.repeatMode),
      automixEnabled: mode.automixEnabled === true,
      autoFillQueueEnabled: mode.autoFillQueueEnabled === true,
    },
    resume: normalizeResume(value.resume, items, updatedAt),
    updatedAt,
    playlistPlayback: normalizePlaylistPlayback(value.playlistPlayback, updatedAt),
  };
};

const isReceiverIdentity = (value: string | null | undefined): boolean =>
  Boolean(value && receiverIdentityPrefixes.some((prefix) => value.startsWith(prefix)));

const findResumeQueueItem = (
  session: PersistedPlaybackSessionV1,
  status: Pick<AudioStatus, 'currentFilePath' | 'currentTrackId'>,
): PersistedQueueItem | null => {
  if (session.currentQueueId) {
    const current = session.items.find((item) => item.queueId === session.currentQueueId) ?? null;
    if (
      current &&
      (current.track.id === status.currentTrackId ||
        current.track.path === status.currentFilePath ||
        (!status.currentTrackId && !status.currentFilePath))
    ) {
      return current;
    }
  }

  return session.items.find((item) =>
    (status.currentTrackId && item.track.id === status.currentTrackId) ||
    (status.currentFilePath && item.track.path === status.currentFilePath),
  ) ?? null;
};

export const createResumeFromAudioStatus = (
  session: PersistedPlaybackSessionV1,
  status: AudioStatus,
  updatedAt: string,
): PersistedPlaybackSessionResume | null => {
  if (
    status.state === 'idle' ||
    status.state === 'stopped' ||
    status.state === 'ended' ||
    !status.currentFilePath ||
    isReceiverIdentity(status.currentFilePath) ||
    isReceiverIdentity(status.currentTrackId)
  ) {
    return null;
  }

  const item = findResumeQueueItem(session, status);
  if (!item) {
    return null;
  }

  return {
    queueId: item.queueId,
    trackId: status.currentTrackId ?? item.track.id,
    filePath: status.currentFilePath,
    positionMs: Math.round(Math.max(0, status.positionSeconds) * 1000),
    durationMs: Math.round(Math.max(0, status.durationSeconds || item.track.duration) * 1000),
    state: status.state,
    updatedAt,
  };
};

const defaultPlaybackSessionPath = (): string => join(app.getPath('userData'), 'echo-playback-session.sqlite');

export class PlaybackSessionStore {
  private database: Database.Database | null = null;
  private cachedSession: PersistedPlaybackSessionV1 | null | undefined;
  private readonly now: () => Date;

  constructor(private readonly databasePath = defaultPlaybackSessionPath(), options: PlaybackSessionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  load(): PersistedPlaybackSessionV1 | null {
    if (this.cachedSession !== undefined) {
      return this.cachedSession;
    }

    try {
      const row = this.getDatabase()
        .prepare<[string], PlaybackSessionRow>('SELECT version, payload_json, updated_at FROM playback_queue_session WHERE id = ?')
        .get(activeSessionId);

      if (!row || row.version !== 1) {
        this.cachedSession = null;
        return null;
      }

      this.cachedSession = normalizePersistedPlaybackSession(JSON.parse(row.payload_json), row.updated_at);
      return this.cachedSession;
    } catch {
      this.cachedSession = null;
      return null;
    }
  }

  save(session: PersistedPlaybackSessionV1): PersistedPlaybackSessionV1 {
    const updatedAt = nowIso(this.now);
    const normalized = normalizePersistedPlaybackSession({ ...session, updatedAt }, updatedAt);
    if (!normalized) {
      throw new Error('Invalid playback queue session payload');
    }

    this.getDatabase()
      .prepare(
        `INSERT INTO playback_queue_session (id, version, payload_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(activeSessionId, normalized.version, JSON.stringify(normalized), normalized.updatedAt);

    this.cachedSession = normalized;
    return normalized;
  }

  saveWithAudioStatus(session: PersistedPlaybackSessionV1, status: AudioStatus): PersistedPlaybackSessionV1 {
    const updatedAt = nowIso(this.now);
    const normalized = normalizePersistedPlaybackSession({ ...session, updatedAt }, updatedAt);
    if (!normalized) {
      throw new Error('Invalid playback queue session payload');
    }
    const shouldClearResume = status.state === 'idle' || status.state === 'stopped' || status.state === 'ended';

    return this.save({
      ...normalized,
      resume: shouldClearResume ? null : createResumeFromAudioStatus(normalized, status, updatedAt) ?? normalized.resume,
      updatedAt,
    });
  }

  saveResumeFromAudioStatus(status: AudioStatus): PersistedPlaybackSessionV1 | null {
    const current = this.load();
    if (!current) {
      return null;
    }

    const updatedAt = nowIso(this.now);
    return this.save({
      ...current,
      resume: createResumeFromAudioStatus(current, status, updatedAt),
      updatedAt,
    });
  }

  clearResume(): PersistedPlaybackSessionV1 | null {
    const current = this.load();
    if (!current) {
      return null;
    }

    return this.save({
      ...current,
      resume: null,
      updatedAt: nowIso(this.now),
    });
  }

  clear(): void {
    try {
      this.getDatabase().prepare('DELETE FROM playback_queue_session WHERE id = ?').run(activeSessionId);
    } finally {
      this.cachedSession = null;
    }
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.cachedSession = undefined;
  }

  private getDatabase(): Database.Database {
    if (this.database) {
      return this.database;
    }

    if (this.databasePath !== ':memory:') {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }

    const database = new Database(this.databasePath);
    for (const pragma of runtimePragmas) {
      database.pragma(pragma);
    }
    database.exec(playbackSessionSchemaSql);
    this.database = database;
    return database;
  }
}

let defaultPlaybackSessionStore: PlaybackSessionStore | null = null;

export const getPlaybackSessionStore = (): PlaybackSessionStore => {
  defaultPlaybackSessionStore ??= new PlaybackSessionStore();
  return defaultPlaybackSessionStore;
};

export const closeDefaultPlaybackSessionStore = (): void => {
  defaultPlaybackSessionStore?.close();
  defaultPlaybackSessionStore = null;
};
