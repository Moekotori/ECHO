// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDspRackState, type CompressorState } from '../../../shared/types/dspRack';

const bridge = vi.hoisted(() => ({
  setCompressorState: vi.fn(),
}));

vi.mock('../../utils/echoBridge', () => ({ getEqBridge: () => bridge }));

import { CompressorPanel } from './CompressorPanel';

describe('CompressorPanel', () => {
  const initial = defaultDspRackState().compressor;

  beforeEach(() => {
    bridge.setCompressorState.mockImplementation(async (next: Partial<CompressorState>) => ({ ...initial, ...next }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('submits edited dynamics parameters through the typed control bridge', async () => {
    const onApplied = vi.fn();
    render(<CompressorPanel state={initial} onApplied={onApplied} />);

    fireEvent.change(screen.getByLabelText('阈值'), { target: { value: '-24' } });
    fireEvent.change(screen.getByLabelText('压缩比'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: '应用参数' }));

    await waitFor(() => expect(bridge.setCompressorState).toHaveBeenCalledWith(expect.objectContaining({
      thresholdDb: -24,
      ratio: 6,
    })));
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ thresholdDb: -24, ratio: 6 }));
  });

  it('awaits the native state when enabling the module', async () => {
    render(<CompressorPanel state={initial} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '已旁路' }));
    await waitFor(() => expect(bridge.setCompressorState).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })));
  });
});
