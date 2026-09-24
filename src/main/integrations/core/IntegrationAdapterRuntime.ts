import type {
  IntegrationEventEnvelopeV1,
  IntegrationPlaybackAction,
  IntegrationPlaybackActionResult,
  IntegrationPlaybackSnapshotV1,
} from '../../../shared/types/integrationPlatform';
import { getIntegrationActionRouter } from './IntegrationActionRouter';
import { getIntegrationEventHub } from './IntegrationEventHub';

export type IntegrationAdapterEventSource = {
  getSnapshot: () => IntegrationPlaybackSnapshotV1;
  subscribe: (listener: (event: IntegrationEventEnvelopeV1) => void) => () => void;
};

export type IntegrationAdapterActionTarget = {
  execute: (action: IntegrationPlaybackAction) => Promise<IntegrationPlaybackActionResult>;
};

export type IntegrationAdapterContext = {
  events: IntegrationAdapterEventSource;
  actions: IntegrationAdapterActionTarget;
};

export type IntegrationAdapterDiagnostics = {
  id: string;
  state: 'stopped' | 'starting' | 'running' | 'error';
  error: string | null;
};

export interface IntegrationAdapter {
  readonly id: string;
  start(context: IntegrationAdapterContext): Promise<void>;
  stop(): Promise<void>;
  getDiagnostics?(): Record<string, unknown>;
}

type RuntimeEntry = {
  adapter: IntegrationAdapter;
  state: IntegrationAdapterDiagnostics['state'];
  error: string | null;
};

export type IntegrationAdapterRuntimeOptions = {
  context?: IntegrationAdapterContext;
};

export class IntegrationAdapterRuntime {
  private readonly context: IntegrationAdapterContext;
  private readonly entries = new Map<string, RuntimeEntry>();

  constructor(options: IntegrationAdapterRuntimeOptions = {}) {
    this.context = options.context ?? {
      events: getIntegrationEventHub(),
      actions: getIntegrationActionRouter(),
    };
  }

  register(adapter: IntegrationAdapter): void {
    if (this.entries.has(adapter.id)) {
      throw new Error(`integration_adapter_already_registered:${adapter.id}`);
    }
    this.entries.set(adapter.id, { adapter, state: 'stopped', error: null });
  }

  async start(id: string): Promise<void> {
    const entry = this.requireEntry(id);
    if (entry.state === 'running' || entry.state === 'starting') {
      return;
    }
    entry.state = 'starting';
    entry.error = null;
    try {
      await entry.adapter.start(this.context);
      entry.state = 'running';
    } catch (error) {
      entry.state = 'error';
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stop(id: string): Promise<void> {
    const entry = this.requireEntry(id);
    if (entry.state === 'stopped') {
      return;
    }
    try {
      await entry.adapter.stop();
      entry.state = 'stopped';
      entry.error = null;
    } catch (error) {
      entry.state = 'error';
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  getDiagnostics(): Array<IntegrationAdapterDiagnostics & { details: Record<string, unknown> | null }> {
    return Array.from(this.entries.values(), ({ adapter, state, error }) => ({
      id: adapter.id,
      state,
      error,
      details: adapter.getDiagnostics?.() ?? null,
    }));
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(Array.from(this.entries.keys(), (id) => this.stop(id)));
    this.entries.clear();
  }

  private requireEntry(id: string): RuntimeEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`integration_adapter_not_registered:${id}`);
    }
    return entry;
  }
}

