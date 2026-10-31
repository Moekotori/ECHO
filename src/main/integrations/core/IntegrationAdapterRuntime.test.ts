import { describe, expect, it, vi } from 'vitest';
import type { IntegrationAdapter } from './IntegrationAdapterRuntime';
import { IntegrationAdapterRuntime } from './IntegrationAdapterRuntime';

const context = {
  events: {
    getSnapshot: vi.fn(),
    subscribe: vi.fn(),
  },
  actions: {
    execute: vi.fn(),
  },
};

describe('IntegrationAdapterRuntime', () => {
  it('owns adapter lifecycle and exposes diagnostics', async () => {
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const adapter: IntegrationAdapter = {
      id: 'test',
      start,
      stop,
      getDiagnostics: () => ({ connected: true }),
    };
    const runtime = new IntegrationAdapterRuntime({ context });

    runtime.register(adapter);
    await runtime.start('test');

    expect(start).toHaveBeenCalledWith(context);
    expect(runtime.getDiagnostics()).toEqual([{
      id: 'test',
      state: 'running',
      error: null,
      details: { connected: true },
    }]);

    await runtime.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate adapter ids', () => {
    const runtime = new IntegrationAdapterRuntime({ context });
    const adapter: IntegrationAdapter = {
      id: 'duplicate',
      start: async () => undefined,
      stop: async () => undefined,
    };
    runtime.register(adapter);
    expect(() => runtime.register(adapter)).toThrow('integration_adapter_already_registered:duplicate');
  });
});

