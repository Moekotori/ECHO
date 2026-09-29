import { basename, extname } from 'node:path';
import type { ConnectMetadata } from '../../shared/types/connect';
import { escapeXml } from './ConnectMetadata';

export const receiverDeviceType = 'urn:schemas-upnp-org:device:MediaRenderer:1';
export const avTransportServiceType = 'urn:schemas-upnp-org:service:AVTransport:1';
export const renderingControlServiceType = 'urn:schemas-upnp-org:service:RenderingControl:1';
export const connectionManagerServiceType = 'urn:schemas-upnp-org:service:ConnectionManager:1';

export const receiverSupportedMimeTypes = ['audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/flac', 'audio/wav', 'audio/ogg'];

export const receiverSinkProtocolInfo = receiverSupportedMimeTypes
  .map((mimeType) => `http-get:*:${mimeType}:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000`)
  .join(',');

const defaultReceiverTitle = 'External stream';
const unknownArtist = 'Unknown Artist';
const videoExtensions = new Set(['.avi', '.mkv', '.mov', '.m4v', '.webm', '.mpg', '.mpeg', '.wmv', '.flv', '.ts']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.tif', '.tiff']);
const noisyUriBasenames = new Set(['song', 'stream', 'play', 'download', 'media', 'audio']);

export const decodeXml = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);?/giu, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#(\d+);?/gu, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    });
};

const decodeXmlDeep = (value: string | null | undefined): string | null => {
  let decoded = decodeXml(value);
  for (let index = 0; decoded && index < 4; index += 1) {
    const next = decodeXml(decoded);
    if (!next || next === decoded) {
      return decoded;
    }
    decoded = next;
  }
  return decoded;
};

const normalizeMetadataXml = (metadataXml: string | null | undefined): string => {
  const decoded = decodeXmlDeep(metadataXml)?.trim() ?? '';
  const cdata = decoded.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/u)?.[1]?.trim();
  return cdata ?? decoded;
};

export const xmlText = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<[^>/:]*:?${tag}\\b[^>]*>([\\s\\S]*?)<\\/[^>/:]*:?${tag}>`, 'iu'));
  return decodeXmlDeep(match?.[1]?.trim() ?? null);
};

const trimText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const safeDecodeUriComponent = (value: string): string => {
  if (!/%[0-9a-f]{2}|\+/iu.test(value)) {
    return value;
  }

  try {
    return decodeURIComponent(value.replace(/\+/gu, '%20'));
  } catch {
    return value;
  }
};

const hasCjkOrKana = (value: string): boolean => /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);

const looksLikeEncodedBlob = (value: string): boolean => {
  const candidate = value.replace(/^\.+/u, '');
  if (candidate.length < 16 || !/^[A-Za-z0-9+/=_-]+$/u.test(candidate) || hasCjkOrKana(candidate)) {
    return false;
  }

  const digitCount = [...candidate].filter((char) => /\d/u.test(char)).length;
  const upperCount = [...candidate].filter((char) => /[A-Z]/u.test(char)).length;
  const lowerCount = [...candidate].filter((char) => /[a-z]/u.test(char)).length;
  const base64Like =
    /[+/=_-]/u.test(candidate) &&
    (candidate.endsWith('=') || (candidate.length >= 24 && digitCount >= 3 && upperCount >= 3 && lowerCount >= 3));
  const opaqueMixedToken = candidate.length >= 24 && digitCount >= 1 && upperCount >= 4 && lowerCount >= 4;

  return base64Like || opaqueMixedToken;
};

const cleanMetadataText = (value: string | null | undefined): string | null => {
  const trimmed = trimText(value);
  if (!trimmed) {
    return null;
  }

  if (looksLikeEncodedBlob(trimmed)) {
    return null;
  }

  const decoded = trimText(safeDecodeUriComponent(trimmed)) ?? trimmed;
  return looksLikeEncodedBlob(decoded) ? null : decoded;
};

const splitTitleArtist = (title: string, artist: string | null): { title: string; artist: string | null } => {
  if (artist && artist !== unknownArtist) {
    return { title, artist };
  }

  const match = title.match(/^(.{1,120}?)\s+(?:-|\/|\||~|:|\u2013|\u2014|\uff1a|\uff0f)\s+(.{1,120})$/u);
  if (!match) {
    return { title, artist };
  }

  const nextTitle = cleanMetadataText(match[1]);
  const nextArtist = cleanMetadataText(match[2]);
  return nextTitle && nextArtist ? { title: nextTitle, artist: nextArtist } : { title, artist };
};

export const titleFromUri = (uri: string | null | undefined): string | null => {
  if (!uri) {
    return null;
  }

  try {
    const url = new URL(uri);
    const queryTitle = cleanMetadataText(url.searchParams.get('title') ?? url.searchParams.get('name') ?? url.searchParams.get('songName'));
    if (queryTitle) {
      return queryTitle;
    }

    const pathTitle = decodeURIComponent(basename(url.pathname));
    const withoutExtension = pathTitle.replace(/\.[a-z0-9]{2,5}$/iu, '').trim();
    if (withoutExtension && !looksLikeEncodedBlob(withoutExtension) && !noisyUriBasenames.has(withoutExtension.toLowerCase()) && !/^[a-f0-9_-]{12,}$/iu.test(withoutExtension)) {
      return pathTitle;
    }

    return null;
  } catch {
    return basename(uri) || uri;
  }
};

export const parseDlnaDuration = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }

  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.\d+)?$/u);
  if (!match) {
    return 0;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : 0;
};

export const formatDlnaDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(2, '0');
  const rest = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
};

const parseResDuration = (metadataXml: string): number => {
  const match = metadataXml.match(/<[^>/:]*:?res\b[^>]*\sduration=(["'])(.*?)\1/iu);
  return parseDlnaDuration(decodeXmlDeep(match?.[2] ?? null));
};

const queryText = (uri: string, names: string[]): string | null => {
  try {
    const url = new URL(uri);
    for (const name of names) {
      const value = cleanMetadataText(url.searchParams.get(name));
      if (value) {
        return value;
      }
    }
  } catch {
    return null;
  }
  return null;
};

export const parseReceiverMetadata = (metadataXml: string | null | undefined, uri: string): ConnectMetadata => {
  const xml = normalizeMetadataXml(metadataXml);
  const rawTitle = cleanMetadataText(xmlText(xml, 'title')) ?? queryText(uri, ['title', 'name', 'songName']) ?? titleFromUri(uri) ?? defaultReceiverTitle;
  const albumArtist = cleanMetadataText(xmlText(xml, 'albumArtist')) ?? queryText(uri, ['albumArtist']);
  const rawArtist =
    cleanMetadataText(xmlText(xml, 'artist')) ??
    cleanMetadataText(xmlText(xml, 'creator')) ??
    cleanMetadataText(xmlText(xml, 'author')) ??
    queryText(uri, ['artist', 'singer', 'artistName']) ??
    albumArtist ??
    unknownArtist;
  const split = splitTitleArtist(rawTitle, rawArtist);
  const title = split.title;
  const artist = split.artist ?? unknownArtist;
  const album = cleanMetadataText(xmlText(xml, 'album')) ?? queryText(uri, ['album', 'albumName']);
  const coverHttpUrl = cleanMetadataText(xmlText(xml, 'albumArtURI')) ?? cleanMetadataText(xmlText(xml, 'icon')) ?? queryText(uri, ['cover', 'pic', 'image']) ?? '';
  const durationSeconds = parseResDuration(xml);

  return {
    title,
    artist,
    album,
    albumArtist,
    durationSeconds,
    coverHttpUrl,
  };
};

export const isReceiverAudioCandidate = (uri: string, metadataXml: string | null | undefined): { ok: boolean; reason: string | null } => {
  const metadataClass = xmlText(metadataXml ?? '', 'class')?.toLowerCase() ?? '';
  if (metadataClass.includes('videoitem')) {
    return { ok: false, reason: 'video media is not supported by DLNA receiver V1' };
  }
  if (metadataClass.includes('imageitem')) {
    return { ok: false, reason: 'image media is not supported by DLNA receiver V1' };
  }

  const path = (() => {
    try {
      return new URL(uri).pathname;
    } catch {
      return uri;
    }
  })();
  const extension = extname(path).toLowerCase();
  if (videoExtensions.has(extension)) {
    return { ok: false, reason: 'video media is not supported by DLNA receiver V1' };
  }
  if (imageExtensions.has(extension)) {
    return { ok: false, reason: 'image media is not supported by DLNA receiver V1' };
  }

  return { ok: true, reason: null };
};

export const parseSoapAction = (soapActionHeader: string | string[] | undefined, body: string): string | null => {
  const header = typeof soapActionHeader === 'string' ? soapActionHeader : undefined;
  const headerAction = header?.replace(/^"|"$/gu, '').split('#').pop()?.trim();
  if (headerAction) {
    return headerAction;
  }

  return body.match(/<[^>/:]*:?Body\b[^>]*>\s*<[^>/:]*:?([A-Za-z0-9_]+)\b/u)?.[1] ?? null;
};

export const parseSoapArgs = (body: string, action: string): Record<string, string> => {
  const actionMatch = body.match(new RegExp(`<[^>/:]*:?${action}\\b[^>]*>([\\s\\S]*?)<\\/[^>/:]*:?${action}>`, 'iu'));
  const actionBody = actionMatch?.[1] ?? '';
  const args: Record<string, string> = {};
  const pattern = /<(?:(?:[A-Za-z0-9_]+):)?([A-Za-z0-9_]+)\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z0-9_]+):)?\1>/gu;
  const selfClosingPattern = /<(?:(?:[A-Za-z0-9_]+):)?([A-Za-z0-9_]+)\b[^>]*\/>/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(actionBody))) {
    args[match[1]] = decodeXml(match[2].trim()) ?? '';
  }

  while ((match = selfClosingPattern.exec(actionBody))) {
    args[match[1]] ??= '';
  }

  return args;
};

export const buildSoapResponse = (serviceType: string, action: string, values: Record<string, string | number> = {}): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<s:Body>',
    `<u:${action}Response xmlns:u="${escapeXml(serviceType)}">`,
    ...Object.entries(values).map(([key, value]) => `<${key}>${escapeXml(String(value))}</${key}>`),
    `</u:${action}Response>`,
    '</s:Body>',
    '</s:Envelope>',
  ].join('');

export const buildSoapFault = (errorCode: number, description: string): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<s:Body>',
    '<s:Fault>',
    '<faultcode>s:Client</faultcode>',
    '<faultstring>UPnPError</faultstring>',
    '<detail>',
    '<UPnPError xmlns="urn:schemas-upnp-org:control-1-0">',
    `<errorCode>${errorCode}</errorCode>`,
    `<errorDescription>${escapeXml(description)}</errorDescription>`,
    '</UPnPError>',
    '</detail>',
    '</s:Fault>',
    '</s:Body>',
    '</s:Envelope>',
  ].join('');

export const buildDeviceDescriptionXml = (input: {
  uuid: string;
  friendlyName: string;
  manufacturer: string;
  modelName: string;
  baseUrl: string;
}): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0">',
    '<specVersion><major>1</major><minor>0</minor></specVersion>',
    `<URLBase>${escapeXml(input.baseUrl)}</URLBase>`,
    '<device>',
    `<deviceType>${receiverDeviceType}</deviceType>`,
    `<friendlyName>${escapeXml(input.friendlyName)}</friendlyName>`,
    `<manufacturer>${escapeXml(input.manufacturer)}</manufacturer>`,
    `<modelName>${escapeXml(input.modelName)}</modelName>`,
    '<modelNumber>1</modelNumber>',
    '<dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC>',
    '<dlna:X_DLNACAP />',
    `<UDN>uuid:${escapeXml(input.uuid)}</UDN>`,
    '<serviceList>',
    `<service><serviceType>${avTransportServiceType}</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><SCPDURL>/dlna/avtransport.xml</SCPDURL><controlURL>/dlna/control/avtransport</controlURL><eventSubURL>/dlna/event/avtransport</eventSubURL></service>`,
    `<service><serviceType>${renderingControlServiceType}</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId><SCPDURL>/dlna/rendering-control.xml</SCPDURL><controlURL>/dlna/control/rendering-control</controlURL><eventSubURL>/dlna/event/rendering-control</eventSubURL></service>`,
    `<service><serviceType>${connectionManagerServiceType}</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><SCPDURL>/dlna/connection-manager.xml</SCPDURL><controlURL>/dlna/control/connection-manager</controlURL><eventSubURL>/dlna/event/connection-manager</eventSubURL></service>`,
    '</serviceList>',
    '</device>',
    '</root>',
  ].join('');

type ScpdArg = {
  name: string;
  direction: 'in' | 'out';
  state: string;
};

const inArg = (name: string, state = 'A_ARG_TYPE_String'): ScpdArg => ({ name, direction: 'in', state });
const outArg = (name: string, state = 'A_ARG_TYPE_String'): ScpdArg => ({ name, direction: 'out', state });
const instanceArg = inArg('InstanceID', 'A_ARG_TYPE_InstanceID');

const scpdAction = (name: string, args: ScpdArg[] = []): string =>
  [
    '<action>',
    `<name>${name}</name>`,
    args.length > 0
      ? [
          '<argumentList>',
          ...args.map(
            (arg) =>
              `<argument><name>${arg.name}</name><direction>${arg.direction}</direction><relatedStateVariable>${arg.state}</relatedStateVariable></argument>`,
          ),
          '</argumentList>',
        ].join('')
      : '<argumentList />',
    '</action>',
  ].join('');

const avTransportActions: Record<string, ScpdArg[]> = {
  SetAVTransportURI: [instanceArg, inArg('CurrentURI', 'AVTransportURI'), inArg('CurrentURIMetaData', 'AVTransportURIMetaData')],
  SetNextAVTransportURI: [instanceArg, inArg('NextURI', 'AVTransportURI'), inArg('NextURIMetaData', 'AVTransportURIMetaData')],
  Play: [instanceArg, inArg('Speed', 'TransportPlaySpeed')],
  Pause: [instanceArg],
  Stop: [instanceArg],
  Seek: [instanceArg, inArg('Unit', 'A_ARG_TYPE_SeekMode'), inArg('Target', 'A_ARG_TYPE_SeekTarget')],
  SetPlayMode: [instanceArg, inArg('NewPlayMode', 'CurrentPlayMode')],
  GetTransportInfo: [instanceArg, outArg('CurrentTransportState', 'TransportState'), outArg('CurrentTransportStatus', 'TransportStatus'), outArg('CurrentSpeed', 'TransportPlaySpeed')],
  GetPositionInfo: [
    instanceArg,
    outArg('Track', 'CurrentTrack'),
    outArg('TrackDuration', 'CurrentTrackDuration'),
    outArg('TrackMetaData', 'CurrentTrackMetaData'),
    outArg('TrackURI', 'CurrentTrackURI'),
    outArg('RelTime', 'RelativeTimePosition'),
    outArg('AbsTime', 'AbsoluteTimePosition'),
    outArg('RelCount', 'RelativeCounterPosition'),
    outArg('AbsCount', 'AbsoluteCounterPosition'),
  ],
  GetMediaInfo: [
    instanceArg,
    outArg('NrTracks', 'NumberOfTracks'),
    outArg('MediaDuration', 'CurrentMediaDuration'),
    outArg('CurrentURI', 'AVTransportURI'),
    outArg('CurrentURIMetaData', 'AVTransportURIMetaData'),
    outArg('NextURI', 'AVTransportURI'),
    outArg('NextURIMetaData', 'AVTransportURIMetaData'),
    outArg('PlayMedium', 'PlaybackStorageMedium'),
    outArg('RecordMedium', 'RecordStorageMedium'),
    outArg('WriteStatus', 'RecordMediumWriteStatus'),
  ],
  GetDeviceCapabilities: [instanceArg, outArg('PlayMedia', 'PossiblePlaybackStorageMedia'), outArg('RecMedia', 'PossibleRecordStorageMedia'), outArg('RecQualityModes', 'PossibleRecordQualityModes')],
  GetTransportSettings: [instanceArg, outArg('PlayMode', 'CurrentPlayMode'), outArg('RecQualityMode', 'CurrentRecordQualityMode')],
  GetCurrentTransportActions: [instanceArg, outArg('Actions', 'CurrentTransportActions')],
};

const renderingControlActions: Record<string, ScpdArg[]> = {
  SetVolume: [instanceArg, inArg('Channel', 'A_ARG_TYPE_Channel'), inArg('DesiredVolume', 'Volume')],
  GetVolume: [instanceArg, inArg('Channel', 'A_ARG_TYPE_Channel'), outArg('CurrentVolume', 'Volume')],
  SetMute: [instanceArg, inArg('Channel', 'A_ARG_TYPE_Channel'), inArg('DesiredMute', 'Mute')],
  GetMute: [instanceArg, inArg('Channel', 'A_ARG_TYPE_Channel'), outArg('CurrentMute', 'Mute')],
  GetVolumeDB: [instanceArg, inArg('Channel', 'A_ARG_TYPE_Channel'), outArg('CurrentVolume', 'VolumeDB')],
  GetVolumeDBRange: [instanceArg, inArg('Channel', 'A_ARG_TYPE_Channel'), outArg('MinValue', 'VolumeDB'), outArg('MaxValue', 'VolumeDB')],
};

const connectionManagerActions: Record<string, ScpdArg[]> = {
  GetProtocolInfo: [outArg('Source', 'SourceProtocolInfo'), outArg('Sink', 'SinkProtocolInfo')],
  GetCurrentConnectionIDs: [outArg('ConnectionIDs', 'CurrentConnectionIDs')],
  GetCurrentConnectionInfo: [
    inArg('ConnectionID', 'A_ARG_TYPE_ConnectionID'),
    outArg('RcsID', 'A_ARG_TYPE_RcsID'),
    outArg('AVTransportID', 'A_ARG_TYPE_AVTransportID'),
    outArg('ProtocolInfo', 'A_ARG_TYPE_ProtocolInfo'),
    outArg('PeerConnectionManager', 'A_ARG_TYPE_ConnectionManager'),
    outArg('PeerConnectionID', 'A_ARG_TYPE_ConnectionID'),
    outArg('Direction', 'A_ARG_TYPE_Direction'),
    outArg('Status', 'A_ARG_TYPE_ConnectionStatus'),
  ],
};

export const buildScpdXml = (service: 'avTransport' | 'renderingControl' | 'connectionManager'): string => {
  const actions =
    service === 'avTransport'
      ? avTransportActions
      : service === 'renderingControl'
        ? renderingControlActions
        : connectionManagerActions;

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<scpd xmlns="urn:schemas-upnp-org:service-1-0">',
    '<specVersion><major>1</major><minor>0</minor></specVersion>',
    '<actionList>',
    ...Object.entries(actions).map(([name, args]) => scpdAction(name, args)),
    '</actionList>',
    '<serviceStateTable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_String</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_InstanceID</name><dataType>ui4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>AVTransportURI</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>AVTransportURIMetaData</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>TransportState</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>TransportStatus</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>TransportPlaySpeed</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_SeekMode</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_SeekTarget</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentPlayMode</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentTransportActions</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentTrack</name><dataType>ui4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentTrackDuration</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentTrackMetaData</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentTrackURI</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>RelativeTimePosition</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>AbsoluteTimePosition</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>RelativeCounterPosition</name><dataType>i4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>AbsoluteCounterPosition</name><dataType>i4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>NumberOfTracks</name><dataType>ui4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentMediaDuration</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>PlaybackStorageMedium</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>RecordStorageMedium</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>RecordMediumWriteStatus</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>PossiblePlaybackStorageMedia</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>PossibleRecordStorageMedia</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>PossibleRecordQualityModes</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentRecordQualityMode</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_Channel</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>Volume</name><dataType>ui2</dataType><allowedValueRange><minimum>0</minimum><maximum>100</maximum><step>1</step></allowedValueRange></stateVariable>',
    '<stateVariable sendEvents="no"><name>Mute</name><dataType>boolean</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>VolumeDB</name><dataType>i2</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>SinkProtocolInfo</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>CurrentConnectionIDs</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_ConnectionID</name><dataType>i4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_RcsID</name><dataType>i4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_AVTransportID</name><dataType>i4</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_ProtocolInfo</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_ConnectionManager</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_Direction</name><dataType>string</dataType></stateVariable>',
    '<stateVariable sendEvents="no"><name>A_ARG_TYPE_ConnectionStatus</name><dataType>string</dataType></stateVariable>',
    '</serviceStateTable>',
    '</scpd>',
  ].join('');
};
