import { Socket } from 'node:net';
import type {
  HqPlayerControlInfo,
  HqPlayerEndpoint,
  HqPlayerPlaybackControlPlan,
  HqPlayerPlaybackControlSendReason,
  HqPlayerPlaybackControlSendResult,
  HqPlayerRemotePlaybackMetadata,
  HqPlayerRemotePlaybackState,
  HqPlayerRemotePlaybackStatus,
} from '../../../shared/types/hqplayer';

export type HqPlayerControlSendOptions = {
  timeoutMs?: number;
};

export type HqPlayerControlProbeResult = {
  ok: boolean;
  endpoint: HqPlayerEndpoint;
  elapsedMs: number;
  error: HqPlayerPlaybackControlSendReason | null;
  message: string | null;
  controlInfo: HqPlayerControlInfo | null;
  playbackStatus: HqPlayerRemotePlaybackStatus | null;
};

const hqPlayerControlSendTimeoutMs = 2500;

type HqPlayerControlCommand = 'PlayNextURI' | 'Play' | 'Seek' | 'Stop' | 'GetInfo' | 'Status';

type XmlElementResponse = {
  attributes: Record<string, string>;
  body: string | null;
  raw: string;
};

const escapeXmlAttribute = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');

const unescapeXmlAttribute = (value: string): string =>
  value
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, '\'')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&');

const stripXml = (value: string): string =>
  value
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const getXmlAttributes = (attributes: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(attributes)) !== null) {
    result[match[1]] = unescapeXmlAttribute(match[3] ?? '');
  }
  return result;
};

const findXmlElement = (
  buffer: string,
  command: HqPlayerControlCommand | 'metadata',
): XmlElementResponse | null => {
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const selfClosing = new RegExp(`<\\s*${escapedCommand}\\b([^>]*)/\\s*>`, 'iu').exec(buffer);
  if (selfClosing) {
    const raw = selfClosing[0];
    return {
      attributes: getXmlAttributes(selfClosing[1] ?? ''),
      body: null,
      raw,
    };
  }

  const paired = new RegExp(`<\\s*${escapedCommand}\\b([^>]*)>([\\s\\S]*?)<\\s*/\\s*${escapedCommand}\\s*>`, 'iu')
    .exec(buffer);
  if (!paired) {
    return null;
  }

  const raw = paired[0];
  return {
    attributes: getXmlAttributes(paired[1] ?? ''),
    body: stripXml(paired[2] ?? '') || null,
    raw,
  };
};

const findAnyXmlResponse = (buffer: string): string | null => {
  const withoutDeclaration = buffer.replace(/<\?xml[^>]*\?>\s*/iu, '');
  const selfClosing = /<\s*([A-Za-z][\w:-]*)\b[^>]*\/\s*>/u.exec(withoutDeclaration);
  if (selfClosing) {
    return selfClosing[0];
  }

  const paired = /<\s*([A-Za-z][\w:-]*)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/u.exec(withoutDeclaration);
  return paired?.[0] ?? null;
};

const findRootXmlElementName = (buffer: string): string | null => {
  const withoutDeclaration = buffer.replace(/<\?xml[^>]*\?>\s*/iu, '').trimStart();
  const match = /^<\s*([A-Za-z][\w:-]*)\b/u.exec(withoutDeclaration);
  return match?.[1] ?? null;
};

const createSendResult = (input: {
  state: HqPlayerPlaybackControlSendResult['state'];
  reason: HqPlayerPlaybackControlSendReason | null;
  endpoint: HqPlayerEndpoint;
  command: HqPlayerPlaybackControlSendResult['command'];
  startedAt: number;
  message?: string | null;
  response?: string | null;
}): HqPlayerPlaybackControlSendResult => {
  const finishedAt = Date.now();
  return {
    state: input.state,
    reason: input.reason,
    transport: 'official-control-tcp',
    command: input.command,
    endpoint: { ...input.endpoint },
    startedAt: new Date(input.startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    elapsedMs: Math.max(0, finishedAt - input.startedAt),
    message: input.message ?? input.reason,
    response: input.response ? input.response.slice(0, 400) : null,
  };
};

export const createSkippedHqPlayerControlSendResult = (
  endpoint: HqPlayerEndpoint,
  reason: HqPlayerPlaybackControlSendReason,
  message?: string | null,
): HqPlayerPlaybackControlSendResult => {
  const startedAt = Date.now();
  return createSendResult({
    state: 'skipped',
    reason,
    endpoint,
    command: 'none',
    startedAt,
    message: message ?? reason,
  });
};

const buildPlayNextUriCommand = (plan: HqPlayerPlaybackControlPlan): string => {
  const attrs = [
    `value="${escapeXmlAttribute(plan.source?.url ?? '')}"`,
    'freewheel="0"',
  ];
  const metadata = {
    song: plan.metadata?.title ?? '',
    artist: plan.metadata?.artist ?? '',
    album: plan.metadata?.album ?? '',
    length: plan.metadata?.durationSeconds != null ? String(plan.metadata.durationSeconds) : '',
    mime_type: plan.source?.mimeType ?? '',
  };
  const metadataAttrs = Object.entries(metadata)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `${key}="${escapeXmlAttribute(value)}"`)
    .join(' ');

  if (!metadataAttrs) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<PlayNextURI ${attrs.join(' ')}/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<PlayNextURI ${attrs.join(' ')}><metadata ${metadataAttrs}/></PlayNextURI>`;
};

const buildSeekCommand = (positionSeconds: number): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Seek position="${Math.max(0, Math.floor(positionSeconds))}"/>`;

const buildStopCommand = (): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<Stop/>';

const buildPlayCommand = (): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<Play last="1"/>';

const buildGetInfoCommand = (): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<GetInfo/>';

const buildStatusCommand = (): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<Status subscribe="0"/>';

const normalizeSocketReason = (error: Error & { code?: string }): HqPlayerPlaybackControlSendReason =>
  error.code === 'ECONNREFUSED'
    ? 'hqplayer_connection_refused'
    : error.code === 'ETIMEDOUT'
      ? 'hqplayer_connection_timeout'
      : 'hqplayer_connection_failed';

const waitForXmlElement = (
  socket: Socket,
  command: HqPlayerControlCommand,
  timeoutMs: number,
): Promise<XmlElementResponse> =>
  new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error('hqplayer_connection_timeout'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const response = findXmlElement(buffer, command);
      if (response) {
        cleanup();
        resolve(response);
        return;
      }

      const rootName = findRootXmlElementName(buffer);
      if (rootName && rootName.toLowerCase() !== command.toLowerCase()) {
        const unexpected = findAnyXmlResponse(buffer);
        if (unexpected) {
          cleanup();
          reject(Object.assign(new Error('hqplayer_protocol_error'), {
            code: 'HQPLAYER_PROTOCOL_ERROR',
            response: unexpected,
          }));
          return;
        }
      }

      if (buffer.length > 65536) {
        cleanup();
        reject(Object.assign(new Error('hqplayer_protocol_error'), { code: 'HQPLAYER_PROTOCOL_ERROR' }));
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(Object.assign(new Error('hqplayer_connection_failed'), { code: 'ECONNRESET' }));
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });

const waitForCommandResponse = (
  socket: Socket,
  command: 'PlayNextURI' | 'Play' | 'Seek' | 'Stop',
  timeoutMs: number,
): Promise<{ raw: string; message: string | null }> =>
  new Promise((resolve, reject) => {
    waitForXmlElement(socket, command, timeoutMs)
      .then((element) => {
        const response = {
          result: element.attributes.result ?? null,
          message: element.body,
          raw: element.raw,
        };

        if (response.result === 'OK') {
          resolve({ raw: response.raw, message: response.message });
          return;
        }

        if (response.result === 'Error') {
          reject(Object.assign(new Error(response.message ?? 'hqplayer_response_error'), {
            code: 'HQPLAYER_RESPONSE_ERROR',
            response: response.raw,
          }));
          return;
        }

        reject(Object.assign(new Error('hqplayer_protocol_error'), { code: 'HQPLAYER_PROTOCOL_ERROR', response: response.raw }));
      })
      .catch(reject);
  });

const connectSocket = (endpoint: HqPlayerEndpoint, timeoutMs: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;

    const cleanup = (): void => {
      socket.off('connect', onConnect);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    };
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };
    const onConnect = (): void => finish(() => resolve(socket));
    const onError = (error: Error): void => finish(() => {
      socket.destroy();
      reject(error);
    });
    const onTimeout = (): void => finish(() => {
      socket.destroy();
      reject(Object.assign(new Error('hqplayer_connection_timeout'), { code: 'ETIMEDOUT' }));
    });

    socket.setTimeout(timeoutMs);
    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.connect({ host: endpoint.host, port: endpoint.port ?? 0 });
  });

const readControlElement = async (
  endpoint: HqPlayerEndpoint,
  command: Extract<HqPlayerControlCommand, 'GetInfo' | 'Status'>,
  xml: string,
  timeoutMs: number,
): Promise<XmlElementResponse> => {
  let socket: Socket | null = null;
  try {
    socket = await connectSocket(endpoint, timeoutMs);
    socket.write(xml);
    return await waitForXmlElement(socket, command, timeoutMs);
  } finally {
    socket?.destroy();
  }
};

const sendControlCommand = async (
  endpoint: HqPlayerEndpoint,
  command: Extract<HqPlayerControlCommand, 'PlayNextURI' | 'Play' | 'Seek' | 'Stop'>,
  xml: string,
  timeoutMs: number,
): Promise<{ raw: string; message: string | null }> => {
  let socket: Socket | null = null;
  try {
    socket = await connectSocket(endpoint, timeoutMs);
    socket.write(xml);
    return await waitForCommandResponse(socket, command, timeoutMs);
  } finally {
    socket?.destroy();
  }
};

const nullIfBlank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
};

const numericAttribute = (attributes: Record<string, string>, name: string): number | null => {
  if (!Object.prototype.hasOwnProperty.call(attributes, name)) {
    return null;
  }

  const parsed = Number(attributes[name]);
  return Number.isFinite(parsed) ? parsed : null;
};

const booleanAttribute = (attributes: Record<string, string>, name: string): boolean | null => {
  const parsed = numericAttribute(attributes, name);
  return parsed == null ? null : parsed !== 0;
};

const mapPlaybackState = (stateCode: number | null): HqPlayerRemotePlaybackState => {
  switch (stateCode) {
    case 0:
      return 'stopped';
    case 1:
      return 'paused';
    case 2:
      return 'playing';
    case 3:
      return 'stop-requested';
    default:
      return 'unknown';
  }
};

const parseControlInfo = (element: XmlElementResponse): HqPlayerControlInfo => ({
  name: nullIfBlank(element.attributes.name),
  product: nullIfBlank(element.attributes.product),
  version: nullIfBlank(element.attributes.version),
  platform: nullIfBlank(element.attributes.platform),
  engine: nullIfBlank(element.attributes.engine),
  receivedAt: new Date().toISOString(),
});

const parsePlaybackMetadata = (attributes: Record<string, string>): HqPlayerRemotePlaybackMetadata => ({
  uri: nullIfBlank(attributes.uri),
  mime: nullIfBlank(attributes.mime),
  title: nullIfBlank(attributes.song),
  artist: nullIfBlank(attributes.artist),
  album: nullIfBlank(attributes.album),
  albumArtist: nullIfBlank(attributes.albumartist),
  composer: nullIfBlank(attributes.composer),
  performer: nullIfBlank(attributes.performer),
  genre: nullIfBlank(attributes.genre),
  date: nullIfBlank(attributes.date),
  sampleRate: numericAttribute(attributes, 'samplerate'),
  bits: numericAttribute(attributes, 'bits'),
  channels: numericAttribute(attributes, 'channels'),
  bitrate: numericAttribute(attributes, 'bitrate'),
});

const parsePlaybackStatus = (element: XmlElementResponse): HqPlayerRemotePlaybackStatus => {
  const attributes = element.attributes;
  const stateCode = numericAttribute(attributes, 'state');
  const metadataElement = findXmlElement(element.raw, 'metadata');
  return {
    state: mapPlaybackState(stateCode),
    stateCode,
    track: numericAttribute(attributes, 'track'),
    trackId: nullIfBlank(attributes.track_id),
    tracksTotal: numericAttribute(attributes, 'tracks_total'),
    queued: booleanAttribute(attributes, 'queued'),
    positionSeconds: numericAttribute(attributes, 'position'),
    durationSeconds: numericAttribute(attributes, 'length'),
    volume: numericAttribute(attributes, 'volume'),
    activeMode: nullIfBlank(attributes.active_mode),
    activeFilter: nullIfBlank(attributes.active_filter),
    activeShaper: nullIfBlank(attributes.active_shaper),
    activeRate: numericAttribute(attributes, 'active_rate'),
    activeBits: numericAttribute(attributes, 'active_bits'),
    activeChannels: numericAttribute(attributes, 'active_channels'),
    inputFill: numericAttribute(attributes, 'input_fill'),
    outputFill: numericAttribute(attributes, 'output_fill'),
    outputDelayUs: numericAttribute(attributes, 'output_delay'),
    apodizing: numericAttribute(attributes, 'apod'),
    metadata: metadataElement ? parsePlaybackMetadata(metadataElement.attributes) : null,
    receivedAt: new Date().toISOString(),
  };
};

const createProbeResult = (input: {
  ok: boolean;
  endpoint: HqPlayerEndpoint;
  startedAt: number;
  error: HqPlayerPlaybackControlSendReason | null;
  message?: string | null;
  controlInfo?: HqPlayerControlInfo | null;
  playbackStatus?: HqPlayerRemotePlaybackStatus | null;
}): HqPlayerControlProbeResult => ({
  ok: input.ok,
  endpoint: { ...input.endpoint },
  elapsedMs: Math.max(0, Date.now() - input.startedAt),
  error: input.error,
  message: input.message ?? input.error,
  controlInfo: input.controlInfo ?? null,
  playbackStatus: input.playbackStatus ?? null,
});

const normalizeControlErrorReason = (error: Error & { code?: string }): HqPlayerPlaybackControlSendReason =>
  error.code === 'HQPLAYER_PROTOCOL_ERROR'
    ? 'hqplayer_protocol_error'
    : error.code === 'HQPLAYER_RESPONSE_ERROR'
      ? 'hqplayer_response_error'
      : normalizeSocketReason(error);

export const probeHqPlayerControlEndpoint = async (
  endpoint: HqPlayerEndpoint,
  options: HqPlayerControlSendOptions = {},
): Promise<HqPlayerControlProbeResult> => {
  const timeoutMs = options.timeoutMs ?? hqPlayerControlSendTimeoutMs;
  const startedAt = Date.now();

  if (!endpoint.port) {
    return createProbeResult({
      ok: false,
      endpoint,
      startedAt,
      error: 'hqplayer_control_port_not_configured',
    });
  }

  try {
    const infoResponse = await readControlElement(endpoint, 'GetInfo', buildGetInfoCommand(), timeoutMs);
    const controlInfo = parseControlInfo(infoResponse);
    let playbackStatus: HqPlayerRemotePlaybackStatus | null = null;
    try {
      const statusResponse = await readControlElement(endpoint, 'Status', buildStatusCommand(), timeoutMs);
      playbackStatus = parsePlaybackStatus(statusResponse);
    } catch {
      playbackStatus = null;
    }

    return createProbeResult({
      ok: true,
      endpoint,
      startedAt,
      error: null,
      message: null,
      controlInfo,
      playbackStatus,
    });
  } catch (error) {
    const reason = error instanceof Error
      ? normalizeControlErrorReason(error as Error & { code?: string })
      : 'hqplayer_connection_failed';
    return createProbeResult({
      ok: false,
      endpoint,
      startedAt,
      error: reason,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const sendHqPlayerPlaybackControlPlan = async (
  plan: HqPlayerPlaybackControlPlan,
  options: HqPlayerControlSendOptions = {},
): Promise<HqPlayerPlaybackControlSendResult> => {
  const timeoutMs = options.timeoutMs ?? hqPlayerControlSendTimeoutMs;
  const startedAt = Date.now();
  const endpoint = plan.endpoint;
  const command = plan.startSeconds && plan.startSeconds >= 1 ? 'PlayNextURI+Play+Seek' : 'PlayNextURI+Play';

  if (plan.state !== 'prepared') {
    return createSendResult({
      state: 'skipped',
      reason: plan.reason ?? 'handoff_not_ready',
      endpoint,
      command: 'none',
      startedAt,
    });
  }

  if (!plan.source) {
    return createSendResult({
      state: 'skipped',
      reason: 'source_missing',
      endpoint,
      command: 'none',
      startedAt,
    });
  }

  if (!endpoint.port) {
    return createSendResult({
      state: 'skipped',
      reason: 'hqplayer_control_port_not_configured',
      endpoint,
      command: 'none',
      startedAt,
    });
  }

  if (plan.source.hasHeaders) {
    return createSendResult({
      state: 'failed',
      reason: 'source_requires_headers',
      endpoint,
      command: 'none',
      startedAt,
      message: 'hqplayer_source_requires_private_headers',
    });
  }

  try {
    const nextUriResponse = await sendControlCommand(endpoint, 'PlayNextURI', buildPlayNextUriCommand(plan), timeoutMs);
    const playResponse = await sendControlCommand(endpoint, 'Play', buildPlayCommand(), timeoutMs);
    let rawResponse = `${nextUriResponse.raw}\n${playResponse.raw}`;

    if (plan.startSeconds && plan.startSeconds >= 1) {
      const seekResponse = await sendControlCommand(endpoint, 'Seek', buildSeekCommand(plan.startSeconds), timeoutMs);
      rawResponse = `${rawResponse}\n${seekResponse.raw}`;
    }

    return createSendResult({
      state: 'sent',
      reason: null,
      endpoint,
      command,
      startedAt,
      response: rawResponse,
    });
  } catch (error) {
    const reason =
      error instanceof Error && (error as Error & { code?: string }).code === 'HQPLAYER_PROTOCOL_ERROR'
        ? 'hqplayer_protocol_error'
        : error instanceof Error && (error as Error & { code?: string }).code === 'HQPLAYER_RESPONSE_ERROR'
          ? 'hqplayer_response_error'
          : error instanceof Error
            ? normalizeSocketReason(error as Error & { code?: string })
            : 'hqplayer_connection_failed';
    const response = typeof (error as { response?: unknown })?.response === 'string'
      ? String((error as { response: string }).response)
      : null;

    return createSendResult({
      state: 'failed',
      reason,
      endpoint,
      command,
      startedAt,
      message: error instanceof Error ? error.message : String(error),
      response,
    });
  }
};

export const sendHqPlayerSeekCommand = async (
  endpoint: HqPlayerEndpoint,
  positionSeconds: number,
  options: HqPlayerControlSendOptions = {},
): Promise<HqPlayerPlaybackControlSendResult> => {
  const timeoutMs = options.timeoutMs ?? hqPlayerControlSendTimeoutMs;
  const startedAt = Date.now();

  if (!endpoint.port) {
    return createSendResult({
      state: 'skipped',
      reason: 'hqplayer_control_port_not_configured',
      endpoint,
      command: 'none',
      startedAt,
    });
  }

  try {
    const response = await sendControlCommand(endpoint, 'Seek', buildSeekCommand(positionSeconds), timeoutMs);
    return createSendResult({
      state: 'sent',
      reason: null,
      endpoint,
      command: 'Seek',
      startedAt,
      response: response.raw,
    });
  } catch (error) {
    const reason =
      error instanceof Error && (error as Error & { code?: string }).code === 'HQPLAYER_PROTOCOL_ERROR'
        ? 'hqplayer_protocol_error'
        : error instanceof Error && (error as Error & { code?: string }).code === 'HQPLAYER_RESPONSE_ERROR'
          ? 'hqplayer_response_error'
          : error instanceof Error
            ? normalizeSocketReason(error as Error & { code?: string })
            : 'hqplayer_connection_failed';
    const response = typeof (error as { response?: unknown })?.response === 'string'
      ? String((error as { response: string }).response)
      : null;

    return createSendResult({
      state: 'failed',
      reason,
      endpoint,
      command: 'Seek',
      startedAt,
      message: error instanceof Error ? error.message : String(error),
      response,
    });
  }
};

export const sendHqPlayerStopCommand = async (
  endpoint: HqPlayerEndpoint,
  options: HqPlayerControlSendOptions = {},
): Promise<HqPlayerPlaybackControlSendResult> => {
  const timeoutMs = options.timeoutMs ?? hqPlayerControlSendTimeoutMs;
  const startedAt = Date.now();

  if (!endpoint.port) {
    return createSendResult({
      state: 'skipped',
      reason: 'hqplayer_control_port_not_configured',
      endpoint,
      command: 'none',
      startedAt,
    });
  }

  try {
    const response = await sendControlCommand(endpoint, 'Stop', buildStopCommand(), timeoutMs);
    return createSendResult({
      state: 'sent',
      reason: null,
      endpoint,
      command: 'Stop',
      startedAt,
      response: response.raw,
    });
  } catch (error) {
    const reason =
      error instanceof Error && (error as Error & { code?: string }).code === 'HQPLAYER_PROTOCOL_ERROR'
        ? 'hqplayer_protocol_error'
        : error instanceof Error && (error as Error & { code?: string }).code === 'HQPLAYER_RESPONSE_ERROR'
          ? 'hqplayer_response_error'
          : error instanceof Error
            ? normalizeSocketReason(error as Error & { code?: string })
            : 'hqplayer_connection_failed';
    const response = typeof (error as { response?: unknown })?.response === 'string'
      ? String((error as { response: string }).response)
      : null;

    return createSendResult({
      state: 'failed',
      reason,
      endpoint,
      command: 'Stop',
      startedAt,
      message: error instanceof Error ? error.message : String(error),
      response,
    });
  }
};
