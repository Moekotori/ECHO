import { randomUUID } from 'node:crypto';
import dgram, { type RemoteInfo } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces, hostname } from 'node:os';
import type { AddressInfo } from 'node:net';
import type { AudioStatus } from '../../shared/types/audio';
import type { ConnectReceiverClient, ConnectReceiverDebugEvent, ConnectReceiverState, ConnectReceiverStatus } from '../../shared/types/connect';
import { getAudioSession } from '../audio/AudioSession';
import { chooseLocalAddressForRemote } from './ConnectHttpServer';
import {
  avTransportServiceType,
  buildDeviceDescriptionXml,
  buildScpdXml,
  buildSoapFault,
  buildSoapResponse,
  connectionManagerServiceType,
  formatDlnaDuration,
  isReceiverAudioCandidate,
  parseDlnaDuration,
  parseReceiverMetadata,
  parseSoapAction,
  parseSoapArgs,
  receiverDeviceType,
  receiverSinkProtocolInfo,
  renderingControlServiceType,
} from './ConnectReceiverXml';

type NetworkAddress = {
  address: string;
  netmask: string;
};

type ReceiverAudioSession = ReturnType<typeof getAudioSession>;

type ConnectReceiverEvents = {
  status: [ConnectReceiverStatus];
};

type ConnectReceiverDependencies = {
  audioSession?: ReceiverAudioSession;
  uuid?: string;
  advertisedName?: string;
  networkAddresses?: () => NetworkAddress[];
  now?: () => number;
};

class ReceiverSoapError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const ssdpAddress = '239.255.255.250';
const ssdpPort = 1900;
const notifyIntervalMs = 5 * 60 * 1000;
const maxSoapBodyBytes = 512 * 1024;
const maxDebugEvents = 16;

const serviceTargets = [receiverDeviceType, avTransportServiceType, renderingControlServiceType, connectionManagerServiceType];

const normalizeAddress = (address: string | null | undefined): string | null => {
  if (!address) {
    return null;
  }

  const withoutZone = address.split('%')[0];
  if (withoutZone === '::1') {
    return '127.0.0.1';
  }
  return withoutZone.startsWith('::ffff:') ? withoutZone.slice(7) : withoutZone;
};

const isLoopbackAddress = (address: string): boolean => address === '127.0.0.1' || address.startsWith('127.');

const ipv4ToNumber = (address: string): number | null => {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts.reduce((value, part) => (value << 8) + part, 0) >>> 0;
};

export const listReceiverNetworkAddresses = (): NetworkAddress[] =>
  Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === 'IPv4' && !item.internal)
    .map((item) => ({ address: item.address, netmask: item.netmask || '255.255.255.0' }));

export const isAllowedDlnaRemoteAddress = (remoteAddress: string | null | undefined, localAddresses = listReceiverNetworkAddresses()): boolean => {
  const remote = normalizeAddress(remoteAddress);
  if (!remote) {
    return false;
  }
  if (isLoopbackAddress(remote)) {
    return true;
  }

  const remoteNumber = ipv4ToNumber(remote);
  if (remoteNumber === null) {
    return false;
  }

  return localAddresses.some((local) => {
    const localNumber = ipv4ToNumber(local.address);
    const netmaskNumber = ipv4ToNumber(local.netmask);
    return localNumber !== null && netmaskNumber !== null && (remoteNumber & netmaskNumber) === (localNumber & netmaskNumber);
  });
};

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxSoapBodyBytes) {
      throw new ReceiverSoapError(413, 'SOAP body is too large.');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const writeXml = (response: ServerResponse, statusCode: number, body: string): void => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
    'Content-Type': 'text/xml; charset="utf-8"',
  });
  response.end(body);
};

const currentClientFromRequest = (request: IncomingMessage): ConnectReceiverClient => ({
  address: normalizeAddress(request.socket.remoteAddress) ?? request.socket.remoteAddress ?? 'unknown',
  userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  lastSeenAt: new Date().toISOString(),
});

const toTransportState = (state: ConnectReceiverState): string => {
  if (state === 'playing' || state === 'loading') {
    return 'PLAYING';
  }
  if (state === 'paused') {
    return 'PAUSED_PLAYBACK';
  }
  if (state === 'stopped' || state === 'idle') {
    return 'STOPPED';
  }
  return 'NO_MEDIA_PRESENT';
};

const numericVolume = (value: unknown): number => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.min(100, Math.round(next))) : 100;
};

const audioStateToReceiverState = (status: AudioStatus): ConnectReceiverState => {
  switch (status.state) {
    case 'loading':
      return 'loading';
    case 'playing':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'stopped':
    case 'ended':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return 'ready';
  }
};

const soapBool = (value: boolean): string => (value ? '1' : '0');

export const buildReceiverSsdpResponse = (input: { location: string; st: string; uuid: string }): string =>
  [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=1800',
    'EXT:',
    `LOCATION: ${input.location}`,
    'SERVER: Windows/10 UPnP/1.0 ECHO-Next/1.0',
    `ST: ${input.st}`,
    `USN: ${input.st === `uuid:${input.uuid}` ? `uuid:${input.uuid}` : `uuid:${input.uuid}::${input.st}`}`,
    '',
    '',
  ].join('\r\n');

export class ConnectReceiverService extends EventEmitter<ConnectReceiverEvents> {
  private readonly audioSession: ReceiverAudioSession;
  private readonly uuid: string;
  private readonly advertisedName: string;
  private readonly networkAddresses: () => NetworkAddress[];
  private readonly now: () => number;
  private httpServer: Server | null = null;
  private httpPort: number | null = null;
  private ssdpSocket: dgram.Socket | null = null;
  private notifyTimer: NodeJS.Timeout | null = null;
  private currentMetadataXml = '';
  private playbackStartToken = 0;
  private status: ConnectReceiverStatus;

  constructor(dependencies: ConnectReceiverDependencies = {}) {
    super();
    this.audioSession = dependencies.audioSession ?? getAudioSession();
    this.uuid = dependencies.uuid ?? randomUUID();
    this.advertisedName = dependencies.advertisedName ?? `ECHO Next (${hostname() || 'Desktop'})`;
    this.networkAddresses = dependencies.networkAddresses ?? listReceiverNetworkAddresses;
    this.now = dependencies.now ?? Date.now;
    this.status = this.createDisabledStatus();
    this.audioSession.on('status', this.handleAudioStatus);
  }

  getStatus(): ConnectReceiverStatus {
    return this.withAudioPosition(this.status);
  }

  async setEnabled(enabled: boolean): Promise<ConnectReceiverStatus> {
    if (enabled) {
      await this.start();
    } else {
      await this.stop();
    }

    return this.getStatus();
  }

  stopPlayback(): ConnectReceiverStatus {
    this.stopCurrentReceiverAudio();
    this.clearTransportUri(this.status.currentClient);
    this.setStatus({ state: this.status.enabled ? 'idle' : 'disabled' });
    return this.getStatus();
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.audioSession.off?.('status', this.handleAudioStatus);
    this.removeAllListeners();
  }

  private createDisabledStatus(): ConnectReceiverStatus {
    return {
      enabled: false,
      state: 'disabled',
      advertisedName: this.advertisedName,
      addresses: [],
      currentClient: null,
      currentUri: null,
      metadata: null,
      positionSeconds: 0,
      durationSeconds: 0,
      volume: Math.round((this.audioSession.getStatus().volume ?? 1) * 100),
      error: null,
      debugEvents: [],
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private async start(): Promise<void> {
    if (this.status.enabled) {
      return;
    }

    try {
      await this.startHttpServer();
      await this.startSsdp();
      this.setStatus({
        enabled: true,
        state: 'idle',
        addresses: this.receiverUrls(),
        error: null,
      });
      this.sendNotify('ssdp:alive');
      this.notifyTimer = setInterval(() => this.sendNotify('ssdp:alive'), notifyIntervalMs);
    } catch (error) {
      await this.stopNetworkOnly();
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        ...this.createDisabledStatus(),
        state: 'error',
        error: message,
      });
      throw error;
    }
  }

  private async stop(): Promise<void> {
    if (!this.status.enabled && !this.httpServer && !this.ssdpSocket) {
      this.setStatus(this.createDisabledStatus());
      return;
    }

    this.sendNotify('ssdp:byebye');
    this.stopCurrentReceiverAudio();
    await this.stopNetworkOnly();
    this.currentMetadataXml = '';
    this.setStatus(this.createDisabledStatus());
  }

  private async stopNetworkOnly(): Promise<void> {
    if (this.notifyTimer) {
      clearInterval(this.notifyTimer);
      this.notifyTimer = null;
    }
    if (this.ssdpSocket) {
      this.ssdpSocket.close();
      this.ssdpSocket = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
      this.httpPort = null;
    }
  }

  private async startHttpServer(): Promise<void> {
    if (this.httpServer && this.httpPort) {
      return;
    }

    this.httpServer = createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(0, '0.0.0.0', () => {
        const address = this.httpServer!.address() as AddressInfo | null;
        if (!address || typeof address.port !== 'number') {
          reject(new Error('DLNA receiver HTTP server did not bind to a TCP port.'));
          return;
        }
        this.httpPort = address.port;
        this.httpServer!.off('error', reject);
        resolve();
      });
    });
  }

  private async startSsdp(): Promise<void> {
    if (this.ssdpSocket) {
      return;
    }

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, remote) => this.handleSsdpMessage(message, remote));
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(ssdpPort, () => {
        socket.off('error', reject);
        try {
          socket.setMulticastTTL(4);
          for (const address of this.networkAddresses()) {
            try {
              socket.addMembership(ssdpAddress, address.address);
            } catch {
              // Some adapters reject membership while disconnected; other interfaces can still serve discovery.
            }
          }
        } catch {
          // Discovery can still work for unicast M-SEARCH responses on many stacks.
        }
        resolve();
      });
    });
    this.ssdpSocket = socket;
  }

  private receiverUrls(remoteAddress?: string | null): string[] {
    if (!this.httpPort) {
      return [];
    }

    const addresses = this.networkAddresses().map((item) => item.address);
    const selected = remoteAddress ? chooseLocalAddressForRemote(remoteAddress) : null;
    const unique = Array.from(new Set([selected, ...addresses].filter((value): value is string => Boolean(value))));
    return unique.map((address) => `http://${address}:${this.httpPort}/dlna/description.xml`);
  }

  private setStatus(next: Partial<ConnectReceiverStatus> | ConnectReceiverStatus): void {
    this.status = {
      ...this.status,
      ...next,
      updatedAt: next.updatedAt ?? new Date(this.now()).toISOString(),
    };
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private addDebugEvent(event: Omit<ConnectReceiverDebugEvent, 'id' | 'at'>): void {
    const nextEvent: ConnectReceiverDebugEvent = {
      ...event,
      id: randomUUID(),
      at: new Date(this.now()).toISOString(),
    };
    this.status = {
      ...this.status,
      debugEvents: [nextEvent, ...this.status.debugEvents].slice(0, maxDebugEvents),
      updatedAt: nextEvent.at,
    };
    this.emitStatus();
  }

  private recordHttpEvent(request: IncomingMessage, input: { path: string; action?: string | null; statusCode: number; message?: string | null }): void {
    this.addDebugEvent({
      remoteAddress: normalizeAddress(request.socket.remoteAddress),
      method: request.method ?? 'HTTP',
      path: input.path,
      action: input.action ?? null,
      statusCode: input.statusCode,
      message: input.message ?? null,
    });
  }

  private readonly handleAudioStatus = (audioStatus: AudioStatus): void => {
    if (!this.status.enabled || !this.status.currentUri) {
      return;
    }

    if (
      audioStatus.currentFilePath &&
      audioStatus.currentFilePath !== this.status.currentUri &&
      ['loading', 'playing', 'paused'].includes(audioStatus.state)
    ) {
      this.playbackStartToken += 1;
      this.currentMetadataXml = '';
      this.setStatus({
        state: 'idle',
        currentUri: null,
        metadata: null,
        positionSeconds: 0,
        durationSeconds: 0,
        error: null,
      });
      return;
    }

    if (audioStatus.currentFilePath !== this.status.currentUri) {
      return;
    }

    this.setStatus({
      state: audioStateToReceiverState(audioStatus),
      positionSeconds: Math.max(0, audioStatus.positionSeconds || 0),
      durationSeconds: Math.max(this.status.metadata?.durationSeconds ?? 0, audioStatus.durationSeconds || 0),
      volume: Math.round((audioStatus.volume ?? 1) * 100),
      error: audioStatus.error,
    });
  };

  private withAudioPosition(status: ConnectReceiverStatus): ConnectReceiverStatus {
    const audioStatus = this.audioSession.getStatus();
    if (!status.currentUri || audioStatus.currentFilePath !== status.currentUri) {
      return status;
    }

    return {
      ...status,
      state: audioStateToReceiverState(audioStatus),
      positionSeconds: Math.max(0, audioStatus.positionSeconds || 0),
      durationSeconds: Math.max(status.durationSeconds, audioStatus.durationSeconds || 0),
      volume: Math.round((audioStatus.volume ?? 1) * 100),
      error: audioStatus.error,
    };
  }

  private handleSsdpMessage(message: Buffer, remote: RemoteInfo): void {
    const raw = message.toString('utf8');
    if (!/^M-SEARCH \* HTTP\/1\.1/iu.test(raw) || !/MAN:\s*"?ssdp:discover"?/iu.test(raw)) {
      return;
    }

    const st = raw.match(/^ST:\s*(.+)$/imu)?.[1]?.trim() ?? '';
    const targets = this.matchSsdpTargets(st);
    if (targets.length === 0 || !this.ssdpSocket || !isAllowedDlnaRemoteAddress(remote.address, this.networkAddresses())) {
      return;
    }

    const location = this.receiverUrls(remote.address)[0];
    this.addDebugEvent({
      remoteAddress: normalizeAddress(remote.address),
      method: 'M-SEARCH',
      path: st || 'ssdp:discover',
      action: null,
      statusCode: 200,
      message: `SSDP response: ${targets.join(', ')}`,
    });
    for (const target of targets) {
      const response = buildReceiverSsdpResponse({ location, st: target, uuid: this.uuid });
      this.ssdpSocket.send(Buffer.from(response), remote.port, remote.address);
    }
  }

  private matchSsdpTargets(st: string): string[] {
    const uuidTarget = `uuid:${this.uuid}`;
    if (st === 'ssdp:all') {
      return ['upnp:rootdevice', uuidTarget, ...serviceTargets];
    }
    if (st === 'upnp:rootdevice' || st === uuidTarget || serviceTargets.includes(st)) {
      return [st];
    }
    return [];
  }

  private sendNotify(subType: 'ssdp:alive' | 'ssdp:byebye'): void {
    if (!this.ssdpSocket || !this.httpPort) {
      return;
    }

    const urls = this.receiverUrls();
    const nts = this.advertisementTargets();
    for (const location of urls) {
      for (const target of nts) {
        const payload = [
          'NOTIFY * HTTP/1.1',
          `HOST: ${ssdpAddress}:${ssdpPort}`,
          'CACHE-CONTROL: max-age=1800',
          `LOCATION: ${location}`,
          `NT: ${target.nt}`,
          `NTS: ${subType}`,
          'SERVER: Windows/10 UPnP/1.0 ECHO-Next/1.0',
          `USN: ${target.usn}`,
          '',
          '',
        ].join('\r\n');
        this.ssdpSocket.send(Buffer.from(payload), ssdpPort, ssdpAddress);
      }
    }
  }

  private advertisementTargets(): Array<{ nt: string; usn: string }> {
    const uuidTarget = `uuid:${this.uuid}`;
    return [
      { nt: 'upnp:rootdevice', usn: `${uuidTarget}::upnp:rootdevice` },
      { nt: uuidTarget, usn: uuidTarget },
      ...serviceTargets.map((target) => ({ nt: target, usn: `${uuidTarget}::${target}` })),
    ];
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'GET' && url.pathname === '/dlna/description.xml') {
        const host = chooseLocalAddressForRemote(normalizeAddress(request.socket.remoteAddress));
        this.recordHttpEvent(request, { path: url.pathname, statusCode: 200, message: 'device description' });
        writeXml(
          response,
          200,
          buildDeviceDescriptionXml({
            uuid: this.uuid,
            friendlyName: this.advertisedName,
            manufacturer: 'ECHO Next',
            modelName: 'ECHO Next DLNA Receiver',
            baseUrl: `http://${host}:${this.httpPort}`,
          }),
        );
        return;
      }

      if (request.method === 'GET' && url.pathname === '/dlna/avtransport.xml') {
        this.recordHttpEvent(request, { path: url.pathname, statusCode: 200, message: 'AVTransport SCPD' });
        writeXml(response, 200, buildScpdXml('avTransport'));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/dlna/rendering-control.xml') {
        this.recordHttpEvent(request, { path: url.pathname, statusCode: 200, message: 'RenderingControl SCPD' });
        writeXml(response, 200, buildScpdXml('renderingControl'));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/dlna/connection-manager.xml') {
        this.recordHttpEvent(request, { path: url.pathname, statusCode: 200, message: 'ConnectionManager SCPD' });
        writeXml(response, 200, buildScpdXml('connectionManager'));
        return;
      }

      if (request.method === 'POST' && url.pathname.startsWith('/dlna/control/')) {
        await this.handleControlRequest(url.pathname, request, response);
        return;
      }

      if ((request.method === 'SUBSCRIBE' || request.method === 'UNSUBSCRIBE') && url.pathname.startsWith('/dlna/event/')) {
        this.recordHttpEvent(request, { path: url.pathname, statusCode: 200, message: 'event subscription acknowledged' });
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          SID: `uuid:${this.uuid}`,
          TIMEOUT: 'Second-1800',
        });
        response.end();
        return;
      }

      this.recordHttpEvent(request, { path: url.pathname, statusCode: 404, message: 'not found' });
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addDebugEvent({
        remoteAddress: normalizeAddress(request.socket.remoteAddress),
        method: request.method ?? 'HTTP',
        path: request.url ?? '/',
        action: null,
        statusCode: 500,
        message,
      });
      writeXml(response, error instanceof ReceiverSoapError ? 500 : 500, buildSoapFault(error instanceof ReceiverSoapError ? error.code : 501, message));
    }
  }

  private async handleControlRequest(pathname: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const remoteAddress = normalizeAddress(request.socket.remoteAddress);
    if (!isAllowedDlnaRemoteAddress(remoteAddress, this.networkAddresses())) {
      this.setStatus({
        state: 'error',
        currentClient: currentClientFromRequest(request),
        error: `Rejected DLNA control request from ${remoteAddress ?? 'unknown remote'}.`,
      });
      response.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }

    let action: string | null = null;
    try {
      const body = await readRequestBody(request);
      action = parseSoapAction(request.headers.soapaction, body);
      if (!action) {
        throw new ReceiverSoapError(401, 'Invalid SOAP action.');
      }
      const args = parseSoapArgs(body, action);
      const client = currentClientFromRequest(request);

      let result: { serviceType: string; values?: Record<string, string | number> };
      if (pathname.endsWith('/avtransport')) {
        result = await this.handleAvTransportAction(action, args, client);
      } else if (pathname.endsWith('/rendering-control')) {
        result = await this.handleRenderingControlAction(action, args, client);
      } else if (pathname.endsWith('/connection-manager')) {
        result = this.handleConnectionManagerAction(action);
      } else {
        throw new ReceiverSoapError(401, 'Unknown control endpoint.');
      }

      this.recordHttpEvent(request, { path: pathname, action, statusCode: 200, message: 'SOAP OK' });
      writeXml(response, 200, buildSoapResponse(result.serviceType, action, result.values));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordHttpEvent(request, {
        path: pathname,
        action,
        statusCode: error instanceof ReceiverSoapError ? 500 : 500,
        message,
      });
      throw error;
    }
  }

  private async handleAvTransportAction(
    action: string,
    args: Record<string, string>,
    client: ConnectReceiverClient,
  ): Promise<{ serviceType: string; values?: Record<string, string | number> }> {
    this.setStatus({ currentClient: client, error: null });

    switch (action) {
      case 'SetAVTransportURI':
        this.setTransportUri(args.CurrentURI, args.CurrentURIMetaData ?? '', client);
        return { serviceType: avTransportServiceType };
      case 'SetNextAVTransportURI':
        return { serviceType: avTransportServiceType };
      case 'SetPlayMode':
        return { serviceType: avTransportServiceType };
      case 'Play':
        this.startPlaybackFromControl();
        return { serviceType: avTransportServiceType };
      case 'Pause':
        await this.audioSession.pause();
        this.setStatus({ state: 'paused' });
        return { serviceType: avTransportServiceType };
      case 'Stop':
        this.playbackStartToken += 1;
        this.audioSession.stop();
        this.setStatus({ state: 'stopped', positionSeconds: 0 });
        return { serviceType: avTransportServiceType };
      case 'Seek':
        await this.seek(args.Target);
        return { serviceType: avTransportServiceType };
      case 'GetTransportInfo':
        return {
          serviceType: avTransportServiceType,
          values: {
            CurrentTransportState: toTransportState(this.getStatus().state),
            CurrentTransportStatus: this.getStatus().error ? 'ERROR_OCCURRED' : 'OK',
            CurrentSpeed: '1',
          },
        };
      case 'GetPositionInfo':
        return { serviceType: avTransportServiceType, values: this.positionInfoValues() };
      case 'GetMediaInfo':
        return { serviceType: avTransportServiceType, values: this.mediaInfoValues() };
      case 'GetDeviceCapabilities':
        return { serviceType: avTransportServiceType, values: { PlayMedia: 'NETWORK', RecMedia: '', RecQualityModes: '' } };
      case 'GetTransportSettings':
        return { serviceType: avTransportServiceType, values: { PlayMode: 'NORMAL', RecQualityMode: 'NOT_IMPLEMENTED' } };
      case 'GetCurrentTransportActions':
        return {
          serviceType: avTransportServiceType,
          values: { Actions: this.status.currentUri ? 'Play,Stop,Pause,Seek' : 'Play' },
        };
      default:
        throw new ReceiverSoapError(401, `Unsupported AVTransport action: ${action}`);
    }
  }

  private async handleRenderingControlAction(
    action: string,
    args: Record<string, string>,
    client: ConnectReceiverClient,
  ): Promise<{ serviceType: string; values?: Record<string, string | number> }> {
    this.setStatus({ currentClient: client, error: null });

    switch (action) {
      case 'SetVolume': {
        const volume = numericVolume(args.DesiredVolume);
        await this.audioSession.setOutput({ volume: volume / 100 });
        this.setStatus({ volume });
        return { serviceType: renderingControlServiceType };
      }
      case 'GetVolume':
        return { serviceType: renderingControlServiceType, values: { CurrentVolume: this.getStatus().volume } };
      case 'SetMute':
        return { serviceType: renderingControlServiceType };
      case 'GetMute':
        return { serviceType: renderingControlServiceType, values: { CurrentMute: soapBool(false) } };
      case 'GetVolumeDB':
        return { serviceType: renderingControlServiceType, values: { CurrentVolume: 0 } };
      case 'GetVolumeDBRange':
        return { serviceType: renderingControlServiceType, values: { MinValue: -10240, MaxValue: 0 } };
      default:
        throw new ReceiverSoapError(401, `Unsupported RenderingControl action: ${action}`);
    }
  }

  private handleConnectionManagerAction(action: string): { serviceType: string; values?: Record<string, string | number> } {
    switch (action) {
      case 'GetProtocolInfo':
        return { serviceType: connectionManagerServiceType, values: { Source: '', Sink: receiverSinkProtocolInfo } };
      case 'GetCurrentConnectionIDs':
        return { serviceType: connectionManagerServiceType, values: { ConnectionIDs: '0' } };
      case 'GetCurrentConnectionInfo':
        return {
          serviceType: connectionManagerServiceType,
          values: {
            RcsID: '0',
            AVTransportID: '0',
            ProtocolInfo: receiverSinkProtocolInfo.split(',')[0],
            PeerConnectionManager: '',
            PeerConnectionID: '-1',
            Direction: 'Input',
            Status: 'OK',
          },
        };
      default:
        throw new ReceiverSoapError(401, `Unsupported ConnectionManager action: ${action}`);
    }
  }

  private setTransportUri(uriValue: string | undefined, metadataXml: string, client: ConnectReceiverClient): void {
    const uri = uriValue?.trim();
    if (!uri) {
      this.clearTransportUri(client);
      return;
    }
    if (!/^https?:\/\//iu.test(uri)) {
      throw new ReceiverSoapError(714, 'Only HTTP audio streams are supported.');
    }

    const candidate = isReceiverAudioCandidate(uri, metadataXml);
    if (!candidate.ok) {
      throw new ReceiverSoapError(714, candidate.reason ?? 'Unsupported media.');
    }

    const metadata = parseReceiverMetadata(metadataXml, uri);
    this.currentMetadataXml = metadataXml;
    this.playbackStartToken += 1;
    if (this.status.currentUri && this.status.currentUri !== uri) {
      this.stopCurrentReceiverAudio();
    }
    this.setStatus({
      enabled: true,
      state: 'ready',
      currentClient: client,
      currentUri: uri,
      metadata,
      positionSeconds: 0,
      durationSeconds: metadata.durationSeconds,
      error: null,
    });
  }

  private stopCurrentReceiverAudio(): void {
    this.playbackStartToken += 1;
    if (this.status.currentUri && this.audioSession.getStatus().currentFilePath === this.status.currentUri) {
      this.audioSession.stop();
    }
  }

  private clearTransportUri(client: ConnectReceiverClient | null): void {
    this.playbackStartToken += 1;
    this.currentMetadataXml = '';
    this.setStatus({
      state: 'stopped',
      currentClient: client,
      currentUri: null,
      metadata: null,
      positionSeconds: 0,
      durationSeconds: 0,
      error: null,
    });
  }

  private startPlaybackFromControl(): void {
    if (!this.status.currentUri) {
      throw new ReceiverSoapError(701, 'No media URI has been set.');
    }

    const token = this.playbackStartToken + 1;
    this.playbackStartToken = token;
    this.setStatus({ state: 'loading', error: null });

    void this.playCurrentUri(token).catch((error: unknown) => {
      if (token !== this.playbackStartToken) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', error: message });
    });
  }

  private async playCurrentUri(token: number): Promise<void> {
    const uri = this.status.currentUri;
    if (!uri) {
      throw new ReceiverSoapError(701, 'No media URI has been set.');
    }

    const audioStatus = this.audioSession.getStatus();
    if (audioStatus.currentFilePath === uri && audioStatus.state === 'paused') {
      await this.audioSession.play();
    } else {
      await this.audioSession.playLocalFile({
        filePath: uri,
        startSeconds: this.status.positionSeconds,
      });
    }

    if (token !== this.playbackStartToken || this.status.currentUri !== uri) {
      return;
    }

    const nextStatus = this.audioSession.getStatus();
    this.setStatus({
      state: audioStateToReceiverState(nextStatus),
      positionSeconds: nextStatus.positionSeconds,
      durationSeconds: Math.max(this.status.durationSeconds, nextStatus.durationSeconds || 0),
      volume: Math.round((nextStatus.volume ?? 1) * 100),
      error: nextStatus.error,
    });
  }

  private async seek(target: string | undefined): Promise<void> {
    if (!this.status.currentUri) {
      throw new ReceiverSoapError(701, 'No media URI has been set.');
    }

    const seconds = parseDlnaDuration(target);
    await this.audioSession.seek(seconds);
    this.setStatus({ positionSeconds: seconds });
  }

  private positionInfoValues(): Record<string, string | number> {
    const status = this.getStatus();
    const duration = formatDlnaDuration(status.durationSeconds);
    const position = formatDlnaDuration(status.positionSeconds);
    return {
      Track: status.currentUri ? '1' : '0',
      TrackDuration: duration,
      TrackMetaData: this.currentMetadataXml,
      TrackURI: status.currentUri ?? '',
      RelTime: position,
      AbsTime: position,
      RelCount: '2147483647',
      AbsCount: '2147483647',
    };
  }

  private mediaInfoValues(): Record<string, string | number> {
    const status = this.getStatus();
    return {
      NrTracks: status.currentUri ? '1' : '0',
      MediaDuration: formatDlnaDuration(status.durationSeconds),
      CurrentURI: status.currentUri ?? '',
      CurrentURIMetaData: this.currentMetadataXml,
      NextURI: '',
      NextURIMetaData: '',
      PlayMedium: status.currentUri ? 'NETWORK' : 'NONE',
      RecordMedium: 'NOT_IMPLEMENTED',
      WriteStatus: 'NOT_IMPLEMENTED',
    };
  }
}

let receiverService: ConnectReceiverService | null = null;

export const getConnectReceiverService = (): ConnectReceiverService => {
  receiverService ??= new ConnectReceiverService();
  return receiverService;
};

export const disposeConnectReceiverService = async (): Promise<void> => {
  await receiverService?.dispose();
  receiverService = null;
};
