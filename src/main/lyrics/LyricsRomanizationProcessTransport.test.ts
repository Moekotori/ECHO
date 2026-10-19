import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fork: vi.fn(), app: null as EventEmitter | null }));
vi.mock('electron', () => ({ default: {
  utilityProcess: { fork: mocks.fork },
  get app() { return mocks.app; },
} }));
import { createLyricsRomanizationProcess } from './LyricsRomanizationProcessTransport';

const harness = () => {
  const app = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn(() => true) });
  mocks.app = app;
  mocks.fork.mockReturnValue(child);
  const transport = createLyricsRomanizationProcess(new URL('file:///tmp/romanizer.js'));
  return { app, child, transport };
};
const request = { requestId: 1, type: 'romanize' as const, texts: ['君が好き'] };
afterEach(() => vi.clearAllMocks());

describe('romanization process transport', () => {
  it('waits for spawn before sending and forwards replies and exit', () => {
    const { app, child, transport } = harness();
    const reply = vi.fn();
    const exit = vi.fn();
    transport.on('message', reply).on('exit', exit);
    transport.postMessage(request);
    expect(child.postMessage).not.toHaveBeenCalled();
    child.emit('spawn');
    expect(child.postMessage).toHaveBeenCalledWith(request);
    child.emit('message', { requestId: 1, ok: true, results: [] });
    expect(reply).toHaveBeenCalledOnce();
    child.emit('exit', 0);
    expect(exit).toHaveBeenCalledWith(0);
    expect(app.listenerCount('will-quit')).toBe(0);
  });

  it('kills a process that finishes spawning after cancellation without sending queued work', () => {
    const { child, transport } = harness();
    transport.postMessage(request);
    transport.terminate();
    child.emit('spawn');
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.postMessage).not.toHaveBeenCalled();
    expect(() => transport.postMessage(request)).toThrow('closed');
  });

  it('forwards fatal errors and terminates on application quit', () => {
    const { app, child, transport } = harness();
    const error = vi.fn();
    transport.on('error', error);
    child.emit('error', 'FatalError', 'location');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'FatalError: location' }));
    app.emit('will-quit');
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
