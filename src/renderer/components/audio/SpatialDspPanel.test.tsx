// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDspRackState } from '../../../shared/types/dspRack';

const bridge = vi.hoisted(() => ({
  setCrossfeedState: vi.fn(),
  setStereoFieldState: vi.fn(),
  setChannelMatrixState: vi.fn(),
}));

vi.mock('../../utils/echoBridge', () => ({ getEqBridge: () => bridge }));

import { ChannelMatrixPanel, CrossfeedPanel, StereoFieldPanel } from './SpatialDspPanel';

describe('spatial DSP control panels', () => {
  const defaults = defaultDspRackState();

  beforeEach(() => {
    bridge.setCrossfeedState.mockImplementation(async (state) => ({ ...defaults.crossfeed, ...state }));
    bridge.setStereoFieldState.mockImplementation(async (state) => ({ ...defaults.stereoField, ...state }));
    bridge.setChannelMatrixState.mockImplementation(async (state) => ({ ...defaults.channelMatrix, ...state }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('applies crossfeed amount and cutoff through the typed bridge', async () => {
    render(<CrossfeedPanel state={defaults.crossfeed} onApplied={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('馈送量'), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('低通截止'), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: '应用参数' }));
    await waitFor(() => expect(bridge.setCrossfeedState).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.4, cutoffHz: 900 })));
  });

  it('applies Mid Side width and gains through the typed bridge', async () => {
    render(<StereoFieldPanel state={defaults.stereoField} onApplied={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('声场宽度'), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText('侧声道增益'), { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: '应用参数' }));
    await waitFor(() => expect(bridge.setStereoFieldState).toHaveBeenCalledWith(expect.objectContaining({ width: 1.25, sideGainDb: -2 })));
  });

  it('turns the swap preset into an explicit two by two matrix', async () => {
    render(<ChannelMatrixPanel state={defaults.channelMatrix} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '左右交换' }));
    fireEvent.click(screen.getByRole('button', { name: '应用参数' }));
    await waitFor(() => expect(bridge.setChannelMatrixState).toHaveBeenCalledWith(expect.objectContaining({
      leftToLeft: 0,
      rightToLeft: 1,
      leftToRight: 1,
      rightToRight: 0,
    })));
  });
});
