import type {
  HqPlayerPlaybackControlPlan,
  HqPlayerPlaybackControlSendReason,
  HqPlayerPlaybackControlSendResult,
  HqPlayerPlaybackHandoffPlan,
} from '../../../shared/types/hqplayer';

type HqPlayerControlHandoffInput = Omit<HqPlayerPlaybackHandoffPlan, 'control'>;

const cloneEndpoint = (plan: HqPlayerControlHandoffInput): HqPlayerPlaybackControlPlan['endpoint'] => ({
  ...plan.endpoint,
});

const createControlSendState = (
  plan: HqPlayerControlHandoffInput,
  reason: HqPlayerPlaybackControlSendReason | null,
): HqPlayerPlaybackControlSendResult => {
  const at = plan.createdAt;
  const command = plan.source?.startSeconds != null && plan.source.startSeconds >= 1
    ? 'PlayNextURI+Play+Seek'
    : 'PlayNextURI+Play';
  return {
    state: reason ? 'skipped' : 'prepared',
    reason,
    transport: 'official-control-tcp',
    command: reason ? 'none' : command,
    endpoint: cloneEndpoint(plan),
    startedAt: at,
    finishedAt: at,
    elapsedMs: 0,
    message: reason,
    response: null,
  };
};

const createSkippedPlan = (
  plan: HqPlayerControlHandoffInput,
  reason: HqPlayerPlaybackControlPlan['reason'],
): HqPlayerPlaybackControlPlan => ({
  state: 'skipped',
  reason,
  action: 'none',
  transport: 'dry-run',
  endpoint: cloneEndpoint(plan),
  profileName: plan.profileName,
  source: null,
  metadata: null,
  startSeconds: null,
  createdAt: plan.createdAt,
  send: createControlSendState(plan, reason),
});

export const createHqPlayerPlaybackControlPlan = (plan: HqPlayerControlHandoffInput): HqPlayerPlaybackControlPlan => {
  if (plan.state !== 'ready') {
    return createSkippedPlan(plan, 'handoff_not_ready');
  }

  if (!plan.source) {
    return createSkippedPlan(plan, 'source_missing');
  }

  const { source } = plan;
  return {
    state: 'prepared',
    reason: null,
    action: 'play-source',
    transport: 'dry-run',
    endpoint: cloneEndpoint(plan),
    profileName: plan.profileName,
    source: {
      trackId: source.trackId,
      mediaType: source.mediaType,
      url: source.url,
      exposure: source.exposure,
      mimeType: source.mimeType,
      expiresAt: source.expiresAt,
      hasHeaders: Object.keys(source.headers).length > 0,
    },
    metadata: {
      title: source.title,
      artist: source.artist,
      album: source.album,
      durationSeconds: source.durationSeconds,
    },
    startSeconds: source.startSeconds,
    createdAt: plan.createdAt,
    send: createControlSendState(plan, null),
  };
};
