import type {
  SmtcCommand,
  SmtcDiagnosticEvent,
  SmtcDiagnostics,
  SmtcEnabledActions,
  SmtcHostState,
  SmtcPlaybackState,
  SmtcTrackMetadata,
} from '../../../shared/types/smtc';

export type {
  SmtcCommand,
  SmtcDiagnosticEvent,
  SmtcDiagnostics,
  SmtcEnabledActions,
  SmtcHostState,
  SmtcPlaybackState,
  SmtcTrackMetadata,
};

export interface SmtcService {
  initialize(): void | Promise<void>;
  dispose(): void | Promise<void>;
  stopGracefullyImpl?(timeoutMs?: number): Promise<void>;
  setPlaybackState(state: SmtcPlaybackState): void | Promise<void>;
  setMetadata(metadata: SmtcTrackMetadata): void | Promise<void>;
  setTimeline(positionSeconds: number, durationSeconds: number): void | Promise<void>;
  setEnabledActions(actions: SmtcEnabledActions): void | Promise<void>;
  onCommand(handler: (command: SmtcCommand) => void): () => void;
  getDiagnostics?(): SmtcDiagnostics;
}
