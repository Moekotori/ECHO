import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LibraryLabState, LibraryMoveCandidate, LibraryMoveRepairResult } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { getLibraryLabBridge } from '../../utils/echoBridge';

const emptyState: LibraryLabState = {
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

const statusFields: Array<{ key: keyof LibraryLabState; label: string }> = [
  { key: 'watcherEnabled', label: 'watcherEnabled' },
  { key: 'watcherRunning', label: 'watcherRunning' },
  { key: 'autoRescanEnabled', label: 'autoRescanEnabled' },
  { key: 'watchedFolderCount', label: 'watchedFolderCount' },
  { key: 'totalEventCount', label: 'totalEventCount' },
  { key: 'pendingPathCount', label: 'pendingPathCount' },
  { key: 'triggeredRescanCount', label: 'triggeredRescanCount' },
  { key: 'droppedPathCount', label: 'droppedPathCount' },
  { key: 'skippedDeleteEventCount', label: 'skippedDeleteEventCount' },
  { key: 'skippedRenameEventCount', label: 'skippedRenameEventCount' },
  { key: 'lastTriggeredRescanAt', label: 'lastTriggeredRescanAt' },
  { key: 'lastRescanError', label: 'lastRescanError' },
  { key: 'watcherLastError', label: 'watcherLastError' },
  { key: 'lastWatcherEventAt', label: 'lastWatcherEventAt' },
  { key: 'lastRescanStartedAt', label: 'lastRescanStartedAt' },
  { key: 'lastRescanFinishedAt', label: 'lastRescanFinishedAt' },
  { key: 'lastRescanPathCount', label: 'lastRescanPathCount' },
  { key: 'lastMetadataBackfillCount', label: 'lastMetadataBackfillCount' },
  { key: 'placeholderTrackCount', label: 'placeholderTrackCount' },
  { key: 'lastSkippedByCacheCount', label: 'lastSkippedByCacheCount' },
  { key: 'moveCandidateCount', label: 'moveCandidateCount' },
  { key: 'highConfidenceCount', label: 'highConfidenceCount' },
  { key: 'mediumConfidenceCount', label: 'mediumConfidenceCount' },
  { key: 'lowConfidenceCount', label: 'lowConfidenceCount' },
  { key: 'ambiguousCount', label: 'ambiguousCount' },
  { key: 'moveRepairLabEnabled', label: 'moveRepairLabEnabled' },
  { key: 'lastMoveRepairAt', label: 'lastMoveRepairAt' },
  { key: 'lastMoveRepairError', label: 'lastMoveRepairError' },
  { key: 'groupingRefreshQueued', label: 'groupingRefreshQueued' },
  { key: 'lastGroupingRefreshDurationMs', label: 'lastGroupingRefreshDurationMs' },
  { key: 'lastGroupingRefreshAt', label: 'lastGroupingRefreshAt' },
  { key: 'groupingRefreshDelayedForPlaybackCount', label: 'groupingRefreshDelayedForPlaybackCount' },
  { key: 'lastGroupingRefreshError', label: 'lastGroupingRefreshError' },
];

const formatValue = (value: LibraryLabState[keyof LibraryLabState]): string => {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (value === null || value === '') {
    return '-';
  }

  return String(value);
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const canApplyCandidate = (
  candidate: LibraryMoveCandidate | null,
  dryRunResult: LibraryMoveRepairResult | null,
): boolean => {
  if (!candidate || !dryRunResult) {
    return false;
  }

  return dryRunResult.candidateId === candidate.candidateId && dryRunResult.ok && !candidate.ambiguous && candidate.confidence !== 'low';
};

export const LibraryDiagnosticsPanel = (): JSX.Element => {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [labState, setLabState] = useState<LibraryLabState>(emptyState);
  const [candidates, setCandidates] = useState<LibraryMoveCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<LibraryMoveRepairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const bridge = getLibraryLabBridge();
  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.candidateId === selectedCandidateId) ?? null,
    [candidates, selectedCandidateId],
  );
  const applyEnabled = labState.moveRepairLabEnabled && canApplyCandidate(selectedCandidate, dryRunResult);

  const runAction = useCallback(
    async (actionName: string, work: () => Promise<void>): Promise<void> => {
      setBusyAction(actionName);
      setError(null);
      try {
        await work();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setBusyAction(null);
      }
    },
    [],
  );

  const refreshDiagnostics = useCallback(async (): Promise<LibraryLabState> => {
    if (!bridge) {
      throw new Error('Library Lab API is unavailable');
    }

    const nextState = await bridge.refreshDiagnostics();
    setLabState(nextState);
    return nextState;
  }, [bridge]);

  const refreshMoveCandidates = useCallback(async (): Promise<void> => {
    if (!bridge) {
      throw new Error('Library Lab API is unavailable');
    }

    const nextCandidates = await bridge.getMoveCandidates({ limit: 100 });
    setCandidates(nextCandidates);
    if (!nextCandidates.some((candidate) => candidate.candidateId === selectedCandidateId)) {
      setSelectedCandidateId(nextCandidates[0]?.candidateId ?? null);
      setDryRunResult(null);
    }
    await refreshDiagnostics();
  }, [bridge, refreshDiagnostics, selectedCandidateId]);

  useEffect(() => {
    let cancelled = false;
    if (!isExpanded) {
      return undefined;
    }

    if (!bridge) {
      setError('Library Lab API is unavailable');
      return;
    }

    void bridge
      .getState()
      .then((nextState) => {
        if (!cancelled) {
          setLabState(nextState);
          if (nextState.moveCandidateEnabled) {
            void refreshMoveCandidates();
          }
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(toErrorMessage(loadError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bridge, isExpanded, refreshMoveCandidates]);

  const handleToggle = (key: 'watcher' | 'autoRescan' | 'moveCandidate' | 'moveRepair', enabled: boolean): void => {
    if (!bridge) {
      setError('Library Lab API is unavailable');
      return;
    }

    void runAction(`toggle-${key}`, async () => {
      const nextState =
        key === 'watcher'
          ? await bridge.setWatcherEnabled(enabled)
          : key === 'autoRescan'
            ? await bridge.setAutoRescanEnabled(enabled)
            : key === 'moveCandidate'
              ? await bridge.setMoveCandidateEnabled(enabled)
              : await bridge.setMoveRepairLabEnabled(enabled);
      setLabState(nextState);
      setDryRunResult(null);
      if (key === 'moveCandidate' && enabled) {
        await refreshMoveCandidates();
      }
      if (key === 'moveCandidate' && !enabled) {
        setCandidates([]);
        setSelectedCandidateId(null);
      }
    });
  };

  const handleStartWatcher = (): void => {
    if (!bridge) {
      setError('Library Lab API is unavailable');
      return;
    }

    void runAction('start-watcher', async () => {
      setLabState(await bridge.startWatcher());
    });
  };

  const handleStopWatcher = (): void => {
    if (!bridge) {
      setError('Library Lab API is unavailable');
      return;
    }

    void runAction('stop-watcher', async () => {
      setLabState(await bridge.stopWatcher());
    });
  };

  const handleBackfillPlaceholderMetadata = (): void => {
    if (!bridge) {
      setError('Library Lab API is unavailable');
      return;
    }

    void runAction('backfill-placeholder-metadata', async () => {
      const nextState = await bridge.backfillPlaceholderMetadata();
      setLabState(nextState);
      setMessage(
        nextState.lastMetadataBackfillCount > 0
          ? `Placeholder metadata backfill queued for ${nextState.lastMetadataBackfillCount} track(s).`
          : 'No placeholder metadata tracks need backfill.',
      );
    });
  };

  const handleDryRun = (): void => {
    if (!bridge || !selectedCandidate) {
      return;
    }

    void runAction('dry-run', async () => {
      const result = await bridge.dryRunMoveRepair(selectedCandidate.candidateId);
      setDryRunResult(result);
      setMessage(result.ok ? 'Dry run passed.' : `Dry run blocked: ${result.blockers.join(', ')}`);
    });
  };

  const handleApply = (): void => {
    if (!bridge || !selectedCandidate || !applyEnabled) {
      return;
    }

    if (!window.confirm('Apply selected library move repair?')) {
      return;
    }

    void runAction('apply', async () => {
      const result = await bridge.applyMoveRepair(selectedCandidate.candidateId);
      setDryRunResult(result);
      setMessage(result.ok ? 'Move repair applied.' : `Apply blocked: ${result.blockers.join(', ')}`);
      await refreshMoveCandidates();
      await refreshDiagnostics();
    });
  };

  return (
    <section className="settings-cache-panel settings-library-lab-panel" aria-labelledby="library-lab-title" data-expanded={isExpanded}>
      <div className="settings-cache-header">
        <div>
          <h3 id="library-lab-title">Library Lab</h3>
          <p className="settings-inline-note">{t('libraryDiagnostics.lab.description')}</p>
        </div>
        <button
          className="settings-collapse-toggle settings-library-lab-toggle"
          type="button"
          aria-controls="library-lab-body"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>

      {isExpanded ? (
        <div id="library-lab-body" className="settings-library-lab-body">
      <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
        <label className="settings-inline-toggle">
          <span>Enable Library Watcher</span>
          <input
            aria-label="Enable Library Watcher"
            type="checkbox"
            checked={labState.watcherEnabled}
            onChange={(event) => handleToggle('watcher', event.currentTarget.checked)}
          />
        </label>
        <label className="settings-inline-toggle">
          <span>Enable Auto Rescan for add/change</span>
          <input
            aria-label="Enable Auto Rescan for add/change"
            type="checkbox"
            checked={labState.autoRescanEnabled}
            onChange={(event) => handleToggle('autoRescan', event.currentTarget.checked)}
          />
        </label>
        <label className="settings-inline-toggle">
          <span>Enable Move Candidate Diagnostics</span>
          <input
            aria-label="Enable Move Candidate Diagnostics"
            type="checkbox"
            checked={labState.moveCandidateEnabled}
            onChange={(event) => handleToggle('moveCandidate', event.currentTarget.checked)}
          />
        </label>
        <label className="settings-inline-toggle">
          <span>Enable Move Repair Lab</span>
          <input
            aria-label="Enable Move Repair Lab"
            type="checkbox"
            checked={labState.moveRepairLabEnabled}
            onChange={(event) => handleToggle('moveRepair', event.currentTarget.checked)}
          />
        </label>
      </div>

      <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
        <button type="button" className="settings-action-button" disabled={!labState.watcherEnabled || busyAction !== null} onClick={handleStartWatcher}>
          Start Watcher
        </button>
        <button type="button" className="settings-action-button" disabled={busyAction !== null} onClick={handleStopWatcher}>
          Stop Watcher
        </button>
        <button
          type="button"
          className="settings-action-button"
          disabled={busyAction !== null}
          onClick={() => void runAction('refresh-diagnostics', async () => {
            await refreshDiagnostics();
          })}
        >
          Refresh Diagnostics
        </button>
        <button
          type="button"
          className="settings-action-button"
          disabled={!labState.moveCandidateEnabled || busyAction !== null}
          onClick={() => void runAction('refresh-candidates', refreshMoveCandidates)}
        >
          Refresh Move Candidates
        </button>
        <button
          type="button"
          className="settings-action-button"
          disabled={labState.placeholderTrackCount <= 0 || busyAction !== null}
          onClick={handleBackfillPlaceholderMetadata}
        >
          Backfill Placeholder Metadata
        </button>
        {labState.moveRepairLabEnabled ? (
          <>
            <button
              type="button"
              className="settings-action-button"
              disabled={!selectedCandidate || selectedCandidate.ambiguous || selectedCandidate.confidence === 'low' || busyAction !== null}
              onClick={handleDryRun}
            >
              Dry Run Selected Move
            </button>
            <button type="button" className="settings-danger-button" disabled={!applyEnabled || busyAction !== null} onClick={handleApply}>
              Apply Selected Move
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className="settings-error-text" role="alert">{error}</p> : null}
      {message ? <p className="settings-inline-note" role="status">{message}</p> : null}

      <div className="settings-library-lab-status" aria-label="Library Lab status">
        {statusFields.map((field) => (
          <div className="settings-library-lab-status-item" key={field.key}>
            <span>{field.label}</span>
            <strong>{formatValue(labState[field.key])}</strong>
          </div>
        ))}
      </div>

      <div className="settings-library-lab-table-wrap" aria-label="Recent watcher events">
        <table className="settings-library-lab-table settings-library-lab-table--events">
          <thead>
            <tr>
              <th>timestamp</th>
              <th>eventType</th>
              <th>path</th>
              <th>sizeBytes</th>
              <th>stableForMs</th>
            </tr>
          </thead>
          <tbody>
            {labState.recentWatcherEvents.map((event) => (
              <tr key={`${event.timestamp}:${event.folderId}:${event.path}:${event.eventType}`} data-event-type={event.eventType}>
                <td>{event.timestamp}</td>
                <td>{event.eventType}</td>
                <td title={event.path}>{event.path}</td>
                <td>{event.sizeBytes ?? '-'}</td>
                <td>{event.stableForMs ?? '-'}</td>
              </tr>
            ))}
            {labState.recentWatcherEvents.length === 0 ? (
              <tr>
                <td colSpan={5}>No watcher events yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="settings-library-lab-table-wrap">
        <table className="settings-library-lab-table">
          <thead>
            <tr>
              <th>Select</th>
              <th>confidence</th>
              <th>ambiguous</th>
              <th>oldPath</th>
              <th>newPath</th>
              <th>reasonCodes</th>
              <th>fileIdentityMatched</th>
              <th>quickHashMatched</th>
              <th>sizeMatched</th>
              <th>durationDelta</th>
              <th>metadataMatched</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr key={candidate.candidateId} data-confidence={candidate.confidence}>
                <td>
                  <input
                    aria-label={`Select move candidate ${candidate.candidateId}`}
                    type="radio"
                    name="library-move-candidate"
                    checked={selectedCandidateId === candidate.candidateId}
                    onChange={() => {
                      setSelectedCandidateId(candidate.candidateId);
                      setDryRunResult(null);
                    }}
                  />
                </td>
                <td>{candidate.confidence}</td>
                <td>{String(candidate.ambiguous)}</td>
                <td title={candidate.oldPath}>{candidate.oldPath}</td>
                <td title={candidate.newPath}>{candidate.newPath}</td>
                <td>{candidate.reasonCodes.join(', ')}</td>
                <td>{String(candidate.fileIdentityMatched)}</td>
                <td>{String(candidate.quickHashMatched)}</td>
                <td>{String(candidate.sizeMatched)}</td>
                <td>{candidate.durationDelta ?? '-'}</td>
                <td>{String(candidate.metadataMatched)}</td>
              </tr>
            ))}
            {candidates.length === 0 ? (
              <tr>
                <td colSpan={11}>No move candidates.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
        </div>
      ) : null}
    </section>
  );
};
