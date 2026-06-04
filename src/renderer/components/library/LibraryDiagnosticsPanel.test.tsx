// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryLabState, LibraryMoveCandidate, LibraryMoveRepairResult } from '../../../shared/types/library';
import { LibraryDiagnosticsPanel } from './LibraryDiagnosticsPanel';

const baseState: LibraryLabState = {
  watcherEnabled: false,
  watcherRunning: false,
  autoRescanEnabled: false,
  moveCandidateEnabled: false,
  moveRepairLabEnabled: false,
  watchedFolderCount: 0,
  totalEventCount: 0,
  pendingPathCount: 0,
  triggeredRescanCount: 0,
  droppedPathCount: 0,
  skippedDeleteEventCount: 0,
  skippedRenameEventCount: 0,
  lastTriggeredRescanAt: null,
  lastRescanError: null,
  watcherLastError: null,
  lastWatcherEventAt: null,
  lastRescanStartedAt: null,
  lastRescanFinishedAt: null,
  lastRescanPathCount: 0,
  lastMetadataBackfillCount: 0,
  placeholderTrackCount: 0,
  lastSkippedByCacheCount: 0,
  moveCandidateCount: 0,
  highConfidenceCount: 0,
  mediumConfidenceCount: 0,
  lowConfidenceCount: 0,
  ambiguousCount: 0,
  lastMoveRepairAt: null,
  lastMoveRepairError: null,
  groupingRefreshQueued: false,
  lastGroupingRefreshDurationMs: null,
  lastGroupingRefreshAt: null,
  groupingRefreshDelayedForPlaybackCount: 0,
  lastGroupingRefreshError: null,
  recentWatcherEvents: [],
};

const highCandidate: LibraryMoveCandidate = {
  candidateId: 'candidate-high',
  confidence: 'high',
  ambiguous: false,
  oldTrackId: 'old',
  oldPath: 'C:\\Music\\old.flac',
  newTrackId: 'new',
  newPath: 'C:\\Music\\new.flac',
  reasonCodes: ['file_identity_match'],
  fileIdentityMatched: true,
  quickHashMatched: false,
  sizeMatched: false,
  durationDelta: null,
  metadataMatched: true,
  createdAt: '2026-05-18T00:00:00.000Z',
};

const dryRunOk: LibraryMoveRepairResult = {
  candidateId: highCandidate.candidateId,
  ok: true,
  blockers: [],
  warnings: [],
  oldTrackId: 'old',
  newTrackId: 'new',
  playlistItemsToRelink: 1,
  playbackHistoryEntriesToRelink: 1,
  playbackHistoryStatsToRelink: 0,
  deletedOldTrackRow: false,
  appliedAt: null,
};

const createApi = (state: LibraryLabState = baseState, candidates: LibraryMoveCandidate[] = []) => {
  let currentState = state;
  const api = {
    getState: vi.fn(async () => currentState),
    setWatcherEnabled: vi.fn(async (enabled: boolean) => {
      currentState = { ...currentState, watcherEnabled: enabled };
      return currentState;
    }),
    setAutoRescanEnabled: vi.fn(async (enabled: boolean) => {
      currentState = { ...currentState, autoRescanEnabled: enabled };
      return currentState;
    }),
    setMoveCandidateEnabled: vi.fn(async (enabled: boolean) => {
      currentState = { ...currentState, moveCandidateEnabled: enabled, moveCandidateCount: enabled ? candidates.length : 0 };
      return currentState;
    }),
    setMoveRepairLabEnabled: vi.fn(async (enabled: boolean) => {
      currentState = { ...currentState, moveRepairLabEnabled: enabled };
      return currentState;
    }),
    startWatcher: vi.fn(async () => {
      currentState = { ...currentState, watcherRunning: true };
      return currentState;
    }),
    stopWatcher: vi.fn(async () => {
      currentState = { ...currentState, watcherRunning: false };
      return currentState;
    }),
    refreshDiagnostics: vi.fn(async () => currentState),
    backfillPlaceholderMetadata: vi.fn(async () => {
      currentState = {
        ...currentState,
        lastMetadataBackfillCount: currentState.placeholderTrackCount,
        lastRescanPathCount: currentState.placeholderTrackCount,
      };
      return currentState;
    }),
    getMoveCandidates: vi.fn(async () => candidates),
    dryRunMoveRepair: vi.fn(async () => dryRunOk),
    applyMoveRepair: vi.fn(async () => ({ ...dryRunOk, deletedOldTrackRow: true, appliedAt: '2026-05-18T00:01:00.000Z' })),
  };

  window.echo = { libraryLab: api } as unknown as Window['echo'];
  return api;
};

const input = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const button = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement;
const openLab = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'Expand' }));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as Partial<Window>).echo;
});

describe('LibraryDiagnosticsPanel', () => {
  it('keeps Library Lab collapsed by default', async () => {
    const api = createApi();
    render(<LibraryDiagnosticsPanel />);

    expect(await screen.findByRole('button', { name: 'Expand', expanded: false })).toBeTruthy();
    expect(screen.queryByLabelText('Enable Library Watcher')).toBeNull();
    expect(api.getState).not.toHaveBeenCalled();
  });

  it('keeps all Lab toggles off by default', async () => {
    createApi();
    render(<LibraryDiagnosticsPanel />);

    await openLab();

    expect(input('Enable Library Watcher').checked).toBe(false);
    expect(input('Enable Auto Rescan for add/change').checked).toBe(false);
    expect(input('Enable Move Candidate Diagnostics').checked).toBe(false);
    expect(input('Enable Move Repair Lab').checked).toBe(false);
    expect(button('Start Watcher').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Apply Selected Move' })).toBeNull();
  });

  it('allows Start Watcher after the watcher toggle is enabled', async () => {
    const api = createApi();
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    fireEvent.click(await screen.findByLabelText('Enable Library Watcher'));

    await waitFor(() => expect(button('Start Watcher').disabled).toBe(false));
    fireEvent.click(button('Start Watcher'));
    await waitFor(() => expect(api.startWatcher).toHaveBeenCalledTimes(1));
  });

  it('hides Apply while Move Repair Lab is disabled', async () => {
    createApi({ ...baseState, moveCandidateEnabled: true }, [highCandidate]);
    render(<LibraryDiagnosticsPanel />);

    await openLab();

    expect(screen.queryByRole('button', { name: 'Dry Run Selected Move' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Selected Move' })).toBeNull();
  });

  it('enables Apply only after a successful dry run', async () => {
    createApi({ ...baseState, moveCandidateEnabled: true, moveRepairLabEnabled: true }, [highCandidate]);
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await screen.findByLabelText(`Select move candidate ${highCandidate.candidateId}`);
    expect(button('Apply Selected Move').disabled).toBe(true);

    fireEvent.click(button('Dry Run Selected Move'));

    await waitFor(() => expect(button('Apply Selected Move').disabled).toBe(false));
  });

  it('does not allow Apply for an ambiguous candidate', async () => {
    const ambiguousCandidate = { ...highCandidate, candidateId: 'candidate-ambiguous', ambiguous: true };
    createApi({ ...baseState, moveCandidateEnabled: true, moveRepairLabEnabled: true }, [ambiguousCandidate]);
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await screen.findByLabelText(`Select move candidate ${ambiguousCandidate.candidateId}`);

    expect(button('Dry Run Selected Move').disabled).toBe(true);
    expect(button('Apply Selected Move').disabled).toBe(true);
  });

  it('does not allow Apply for a low confidence candidate', async () => {
    const lowCandidate = { ...highCandidate, candidateId: 'candidate-low', confidence: 'low' as const };
    createApi({ ...baseState, moveCandidateEnabled: true, moveRepairLabEnabled: true }, [lowCandidate]);
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await screen.findByLabelText(`Select move candidate ${lowCandidate.candidateId}`);

    expect(button('Dry Run Selected Move').disabled).toBe(true);
    expect(button('Apply Selected Move').disabled).toBe(true);
  });

  it('asks for confirmation before applying', async () => {
    const api = createApi({ ...baseState, moveCandidateEnabled: true, moveRepairLabEnabled: true }, [highCandidate]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await screen.findByLabelText(`Select move candidate ${highCandidate.candidateId}`);
    fireEvent.click(button('Dry Run Selected Move'));
    await waitFor(() => expect(button('Apply Selected Move').disabled).toBe(false));
    fireEvent.click(button('Apply Selected Move'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.applyMoveRepair).not.toHaveBeenCalled();
  });

  it('refreshes diagnostics after Apply succeeds', async () => {
    const api = createApi({ ...baseState, moveCandidateEnabled: true, moveRepairLabEnabled: true }, [highCandidate]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await screen.findByLabelText(`Select move candidate ${highCandidate.candidateId}`);
    fireEvent.click(button('Dry Run Selected Move'));
    await waitFor(() => expect(button('Apply Selected Move').disabled).toBe(false));
    fireEvent.click(button('Apply Selected Move'));

    await waitFor(() => expect(api.applyMoveRepair).toHaveBeenCalledTimes(1));
    expect(api.refreshDiagnostics).toHaveBeenCalled();
    expect(api.getMoveCandidates).toHaveBeenCalled();
  });

  it('shows API failures in the panel', async () => {
    const api = createApi({ ...baseState, watcherEnabled: true });
    api.startWatcher.mockRejectedValueOnce(new Error('watch failed'));
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await waitFor(() => expect(button('Start Watcher').disabled).toBe(false));
    fireEvent.click(button('Start Watcher'));

    expect((await screen.findByRole('alert')).textContent).toContain('watch failed');
  });

  it('does not apply automatically during load, toggle, refresh, or dry run', async () => {
    const api = createApi({ ...baseState, moveCandidateEnabled: true, moveRepairLabEnabled: true }, [highCandidate]);
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await screen.findByLabelText(`Select move candidate ${highCandidate.candidateId}`);
    fireEvent.click(button('Refresh Diagnostics'));
    await waitFor(() => expect(api.refreshDiagnostics).toHaveBeenCalled());
    fireEvent.click(button('Refresh Move Candidates'));
    await waitFor(() => expect(api.getMoveCandidates).toHaveBeenCalled());
    fireEvent.click(button('Dry Run Selected Move'));

    await waitFor(() => expect(api.dryRunMoveRepair).toHaveBeenCalledTimes(1));
    expect(api.applyMoveRepair).not.toHaveBeenCalled();
  });

  it('shows watcher rescan and placeholder metadata diagnostics', async () => {
    createApi({
      ...baseState,
      lastWatcherEventAt: '2026-05-18T01:00:00.000Z',
      lastRescanStartedAt: '2026-05-18T01:00:01.000Z',
      lastRescanFinishedAt: '2026-05-18T01:00:02.000Z',
      lastRescanPathCount: 3,
      lastMetadataBackfillCount: 2,
      placeholderTrackCount: 4,
      lastSkippedByCacheCount: 1,
    });
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await screen.findByText('lastMetadataBackfillCount');
    expect(screen.getByText('placeholderTrackCount')).toBeTruthy();
    expect(screen.getByText('lastSkippedByCacheCount')).toBeTruthy();
    expect(screen.getByText('2026-05-18T01:00:02.000Z')).toBeTruthy();
  });

  it('queues placeholder metadata backfill manually without applying move repair', async () => {
    const api = createApi({ ...baseState, placeholderTrackCount: 2 });
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    await waitFor(() => expect(button('Backfill Placeholder Metadata').disabled).toBe(false));
    fireEvent.click(button('Backfill Placeholder Metadata'));

    await waitFor(() => expect(api.backfillPlaceholderMetadata).toHaveBeenCalledTimes(1));
    expect(api.applyMoveRepair).not.toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent).toContain('Placeholder metadata backfill queued for 2 track(s).');
  });

  it('shows recent watcher events for delete diagnostics without changing library rows', async () => {
    createApi({
      ...baseState,
      watcherEnabled: true,
      watcherRunning: true,
      totalEventCount: 1,
      skippedDeleteEventCount: 1,
      recentWatcherEvents: [{
        timestamp: '2026-05-18T01:00:00.000Z',
        folderId: 'folder-1',
        eventType: 'unlink',
        path: 'C:\\Music\\deleted.flac',
        extension: '.flac',
        stableForMs: 500,
      }],
    });
    render(<LibraryDiagnosticsPanel />);

    await openLab();
    expect(await screen.findByText('C:\\Music\\deleted.flac')).toBeTruthy();
    expect(screen.getByText('unlink')).toBeTruthy();
  });
});
