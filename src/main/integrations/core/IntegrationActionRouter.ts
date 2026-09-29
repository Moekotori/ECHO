import type {
  IntegrationPlaybackAction,
  IntegrationPlaybackActionResult,
} from '../../../shared/types/integrationPlatform';
import type { MainWindowPlaybackControlRequest } from '../../../shared/types/playback';
import { getMainWindowPlaybackCommandRelay } from '../../playback/MainWindowPlaybackCommandRelay';

type PlaybackControlRelay = {
  executeControl: (request: MainWindowPlaybackControlRequest) => Promise<unknown>;
};

export type IntegrationActionRouterOptions = {
  relay?: PlaybackControlRelay;
  now?: () => number;
};

const toControlRequest = (
  action: IntegrationPlaybackAction,
): MainWindowPlaybackControlRequest => {
  switch (action.action) {
    case 'play':
    case 'pause':
    case 'stop':
    case 'previous':
    case 'next':
      return { type: action.action };
    case 'seek':
      return { type: 'seek', positionSeconds: action.positionMs / 1000 };
    case 'setVolume':
      return { type: 'setVolume', volume: action.volume };
    case 'setPlaybackOrder':
      return { type: 'setPlaybackOrder', mode: action.mode };
  }
};

export class IntegrationActionRouter {
  private readonly relay: PlaybackControlRelay;
  private readonly now: () => number;

  constructor(options: IntegrationActionRouterOptions = {}) {
    this.relay = options.relay ?? getMainWindowPlaybackCommandRelay();
    this.now = options.now ?? Date.now;
  }

  async execute(action: IntegrationPlaybackAction): Promise<IntegrationPlaybackActionResult> {
    await this.relay.executeControl(toControlRequest(action));
    return {
      requestId: action.requestId,
      ok: true,
      completedAt: new Date(this.now()).toISOString(),
    };
  }
}

let defaultRouter: IntegrationActionRouter | null = null;

export const getIntegrationActionRouter = (): IntegrationActionRouter => {
  defaultRouter ??= new IntegrationActionRouter();
  return defaultRouter;
};
