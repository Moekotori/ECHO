import { describe, expect, it, vi } from 'vitest';
import { TaskbarThumbnailCoverController } from './taskbarThumbnailCover';

const createHelper = () => ({
  attach: vi.fn(() => true),
  setCover: vi.fn(() => true),
  setButtons: vi.fn(() => true),
  setButtonHandler: vi.fn(() => true),
  clear: vi.fn(),
  detach: vi.fn(),
});

describe('TaskbarThumbnailCoverController', () => {
  it('attaches once and applies decoded RGBA artwork', async () => {
    const helper = createHelper();
    const onButtonClick = vi.fn();
    const rgba = Buffer.from([1, 2, 3, 255]);
    const controller = new TaskbarThumbnailCoverController({
      getNativeWindowHandle: () => Buffer.alloc(8, 1),
      onButtonClick,
      loadHelper: () => helper,
      decodeCover: vi.fn(async () => ({ data: rgba, width: 1, height: 1 })),
    });

    await expect(controller.setCover('echo-cover://original/cover-1')).resolves.toBe(true);
    expect(helper.attach).toHaveBeenCalledTimes(1);
    expect(helper.setButtonHandler).toHaveBeenCalledWith(onButtonClick);
    expect(helper.setCover).toHaveBeenCalledWith(rgba, 1, 1);

    await expect(controller.setCover('echo-cover://original/cover-1')).resolves.toBe(true);
    expect(helper.setCover).toHaveBeenCalledTimes(1);
  });

  it('drops stale async artwork and clears the native proxy', async () => {
    const helper = createHelper();
    let finishDecode!: (value: { data: Buffer; width: number; height: number }) => void;
    const controller = new TaskbarThumbnailCoverController({
      getNativeWindowHandle: () => Buffer.alloc(8, 1),
      onButtonClick: vi.fn(),
      loadHelper: () => helper,
      decodeCover: () => new Promise((resolve) => { finishDecode = resolve; }),
    });

    const pending = controller.setCover('https://example.test/old.jpg');
    controller.clear();
    finishDecode({ data: Buffer.from([1, 2, 3, 255]), width: 1, height: 1 });

    await expect(pending).resolves.toBe(false);
    expect(helper.setCover).not.toHaveBeenCalled();
    expect(helper.clear).toHaveBeenCalledOnce();
  });

  it('aborts an obsolete cover download when a newer cover wins', async () => {
    const helper = createHelper();
    const finishes: Array<(value: { data: Buffer; width: number; height: number }) => void> = [];
    const signals: AbortSignal[] = [];
    const controller = new TaskbarThumbnailCoverController({
      getNativeWindowHandle: () => Buffer.alloc(8, 1),
      onButtonClick: vi.fn(),
      loadHelper: () => helper,
      decodeCover: (_url, signal) => new Promise((resolve) => {
        signals.push(signal!);
        finishes.push(resolve);
      }),
    });

    const oldRequest = controller.setCover('https://example.test/old.jpg');
    const newRequest = controller.setCover('https://example.test/new.jpg');
    expect(signals[0]?.aborted).toBe(true);
    finishes[0]!({ data: Buffer.from([1, 1, 1, 255]), width: 1, height: 1 });
    finishes[1]!({ data: Buffer.from([2, 2, 2, 255]), width: 1, height: 1 });

    await expect(oldRequest).resolves.toBe(false);
    await expect(newRequest).resolves.toBe(true);
    expect(helper.setCover).toHaveBeenCalledOnce();
    expect(helper.setCover).toHaveBeenCalledWith(Buffer.from([2, 2, 2, 255]), 1, 1);
  });
});
