import dgram from 'node:dgram';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { ConnectDevice, ConnectDeviceCapabilities } from '../../shared/types/connect';

export type DlnaService = {
  serviceType: string;
  controlUrl: string;
};

export type DlnaDevice = ConnectDevice & {
  descriptionUrl: string;
  udn: string;
  services: {
    avTransport: DlnaService | null;
    renderingControl: DlnaService | null;
    connectionManager: DlnaService | null;
  };
};

export type DlnaTransportInfo = {
  state: string | null;
  status: string | null;
  speed: string | null;
};

export type DlnaPositionInfo = {
  durationSeconds: number | null;
  positionSeconds: number | null;
};

const ssdpAddress = '239.255.255.250';
const ssdpPort = 1900;
const searchTargets = [
  'urn:schemas-upnp-org:device:MediaRenderer:2',
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:schemas-upnp-org:service:AVTransport:1',
  'upnp:rootdevice',
];

const defaultCapabilities: ConnectDeviceCapabilities = {
  canPlay: true,
  canPause: true,
  canStop: true,
  canSeek: true,
  canSetVolume: true,
  supportsMetadata: true,
  supportsSetNext: false,
  supportedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/ogg'],
  requiresTranscode: false,
};

const isLinkLocalIPv4 = (address: string): boolean => /^169\.254\./u.test(address);

const isIPv4Interface = (item: NetworkInterfaceInfo): boolean =>
  item.family === 'IPv4';

export const getSsdpSearchAddresses = (
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): Array<string | null> => {
  const addresses = Object.values(interfaces)
    .flatMap((items) => items ?? [])
    .filter((item) => isIPv4Interface(item) && !item.internal && !isLinkLocalIPv4(item.address))
    .map((item) => item.address);

  return [null, ...Array.from(new Set(addresses))];
};

const headerValue = (raw: string, name: string): string | null => {
  const line = raw.split(/\r?\n/u).find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line?.slice(line.indexOf(':') + 1).trim() ?? null;
};

const xmlText = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<[^>/:]*:?${tag}\\b[^>]*>([\\s\\S]*?)<\\/[^>/:]*:?${tag}>`, 'iu'));
  return decodeXml(match?.[1]?.trim() ?? null);
};

const xmlBlocks = (xml: string, tag: string): string[] =>
  xml.match(new RegExp(`<[^>/:]*:?${tag}\\b[^>]*>[\\s\\S]*?<\\/[^>/:]*:?${tag}>`, 'giu')) ?? [];

const decodeXml = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
};

const absoluteUrl = (url: string | null, baseUrl: string): string | null => {
  if (!url) {
    return null;
  }

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return null;
  }
};

export const parseDeviceDescription = (xml: string, descriptionUrl: string): DlnaDevice | null => {
  const deviceBlock = xmlBlocks(xml, 'device').find((block) => /MediaRenderer/iu.test(xmlText(block, 'deviceType') ?? ''));
  if (!deviceBlock) {
    return null;
  }

  const urlBase = xmlText(xml, 'URLBase') ?? descriptionUrl;
  const services = xmlBlocks(deviceBlock, 'service');
  const serviceFor = (name: 'AVTransport' | 'RenderingControl' | 'ConnectionManager'): DlnaService | null => {
    const service = services.find((block) => (xmlText(block, 'serviceType') ?? '').includes(`:${name}:`));
    if (!service) {
      return null;
    }

    const serviceType = xmlText(service, 'serviceType');
    const controlUrl = absoluteUrl(xmlText(service, 'controlURL'), urlBase);
    return serviceType && controlUrl ? { serviceType, controlUrl } : null;
  };

  const avTransport = serviceFor('AVTransport');
  if (!avTransport) {
    return null;
  }

  const deviceType = xmlText(deviceBlock, 'deviceType');
  const udn = xmlText(deviceBlock, 'UDN') ?? descriptionUrl;
  const name = xmlText(deviceBlock, 'friendlyName') ?? 'DLNA Renderer';
  const manufacturer = xmlText(deviceBlock, 'manufacturer');
  const modelName = xmlText(deviceBlock, 'modelName');
  const modelNumber = xmlText(deviceBlock, 'modelNumber');
  const modelDescription = xmlText(deviceBlock, 'modelDescription');
  const serialNumber = xmlText(deviceBlock, 'serialNumber');
  const presentationUrl = absoluteUrl(xmlText(deviceBlock, 'presentationURL'), urlBase);
  const host = new URL(descriptionUrl).hostname;
  const model = modelName ?? modelNumber ?? modelDescription ?? null;

  return {
    id: `dlna:${udn}`,
    name,
    protocol: 'dlna',
    model,
    manufacturer,
    address: host,
    capabilities: { ...defaultCapabilities },
    state: 'available',
    lastSeenAt: new Date().toISOString(),
    unsupportedReason: null,
    discovery: {
      deviceType,
      descriptionUrl,
      presentationUrl,
      modelName,
      modelNumber,
      modelDescription,
      serialNumber,
      udn,
    },
    descriptionUrl,
    udn,
    services: {
      avTransport,
      renderingControl: serviceFor('RenderingControl'),
      connectionManager: serviceFor('ConnectionManager'),
    },
  };
};

const requestDeviceDescription = async (location: string): Promise<DlnaDevice | null> => {
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) {
      return null;
    }

    return parseDeviceDescription(await response.text(), response.url || location);
  } catch {
    return null;
  }
};

const parseProtocolInfo = (value: string | null): string[] => {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.split(':')[2]?.trim())
        .filter((item): item is string => Boolean(item)),
    ),
  );
};

export const parseDlnaTime = (value: string | null): number | null => {
  if (!value || value === 'NOT_IMPLEMENTED') {
    return null;
  }

  const [clock] = value.trim().split('.');
  const parts = clock.split(':').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  const [hours, minutes, seconds] = parts;
  return (hours * 3600) + (minutes * 60) + seconds;
};

const createSoapEnvelope = (serviceType: string, action: string, args: Record<string, string | number>): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    '<s:Body>',
    `<u:${action} xmlns:u="${escapeXml(serviceType)}">`,
    ...Object.entries(args).map(([key, value]) => `<${key}>${escapeXml(String(value))}</${key}>`),
    `</u:${action}>`,
    '</s:Body>',
    '</s:Envelope>',
  ].join('');

export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const callDlnaAction = async (
  service: DlnaService,
  action: string,
  args: Record<string, string | number>,
): Promise<string> => {
  const body = createSoapEnvelope(service.serviceType, action, args);
  const response = await fetch(service.controlUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(Buffer.byteLength(body)),
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${service.serviceType}#${action}"`,
    },
    body,
    signal: AbortSignal.timeout(6000),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`DLNA ${action} failed: HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ''}`);
  }

  return text;
};

const requireDlnaService = (service: DlnaService | null, label: string): DlnaService => {
  if (!service) {
    throw new Error(`DLNA device does not expose ${label}.`);
  }

  return service;
};

const enrichCapabilities = async (device: DlnaDevice): Promise<DlnaDevice> => {
  if (!device.services.connectionManager) {
    return device;
  }

  try {
    const response = await callDlnaAction(device.services.connectionManager, 'GetProtocolInfo', {});
    const supportedMimeTypes = parseProtocolInfo(xmlText(response, 'Sink'));
    if (supportedMimeTypes.length === 0) {
      return device;
    }

    return {
      ...device,
      capabilities: {
        ...device.capabilities,
        supportedMimeTypes,
      },
    };
  } catch {
    return device;
  }
};

const discoverSsdpLocations = async (bindAddress: string | null, timeoutMs: number): Promise<Set<string>> => {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const locations = new Set<string>();

  socket.on('message', (message) => {
    const location = headerValue(message.toString('utf8'), 'location');
    if (location) {
      locations.add(location);
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, bindAddress ?? undefined, () => {
      socket.off('error', reject);
      resolve();
    });
  });

  try {
    for (const target of searchTargets) {
      const payload = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${ssdpAddress}:${ssdpPort}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${target}`,
        '',
        '',
      ].join('\r\n');
      socket.send(Buffer.from(payload), ssdpPort, ssdpAddress);
    }

    await delay(timeoutMs);
  } finally {
    socket.close();
  }

  return locations;
};

export const discoverDlnaDevices = async (timeoutMs = 2400): Promise<DlnaDevice[]> => {
  const locations = new Set<string>();
  const settled = await Promise.allSettled(
    getSsdpSearchAddresses().map((address) => discoverSsdpLocations(address, timeoutMs)),
  );
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      continue;
    }
    for (const location of result.value) {
      locations.add(location);
    }
  }

  const devices = (await Promise.all([...locations].map(requestDeviceDescription))).filter(
    (device): device is DlnaDevice => Boolean(device),
  );
  const unique = new Map<string, DlnaDevice>();
  for (const device of devices) {
    unique.set(device.id, device);
  }

  return Promise.all([...unique.values()].map(enrichCapabilities));
};

export const setDlnaTransportUri = (device: DlnaDevice, streamUrl: string, metadataXml: string): Promise<string> =>
  callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'SetAVTransportURI', {
    InstanceID: 0,
    CurrentURI: streamUrl,
    CurrentURIMetaData: metadataXml,
  });

export const setDlnaNextTransportUri = (device: DlnaDevice, streamUrl: string, metadataXml: string): Promise<string> =>
  callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'SetNextAVTransportURI', {
    InstanceID: 0,
    NextURI: streamUrl,
    NextURIMetaData: metadataXml,
  });

export const playDlna = (device: DlnaDevice): Promise<string> =>
  callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'Play', { InstanceID: 0, Speed: 1 });

export const pauseDlna = (device: DlnaDevice): Promise<string> =>
  callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'Pause', { InstanceID: 0 });

export const stopDlna = (device: DlnaDevice): Promise<string> =>
  callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'Stop', { InstanceID: 0 });

export const getDlnaTransportInfo = async (device: DlnaDevice): Promise<DlnaTransportInfo> => {
  const response = await callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'GetTransportInfo', {
    InstanceID: 0,
  });
  return {
    state: xmlText(response, 'CurrentTransportState'),
    status: xmlText(response, 'CurrentTransportStatus'),
    speed: xmlText(response, 'CurrentSpeed'),
  };
};

export const getDlnaPositionInfo = async (device: DlnaDevice): Promise<DlnaPositionInfo> => {
  const response = await callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'GetPositionInfo', {
    InstanceID: 0,
  });
  return {
    durationSeconds: parseDlnaTime(xmlText(response, 'TrackDuration')),
    positionSeconds: parseDlnaTime(xmlText(response, 'RelTime')),
  };
};

export const seekDlna = (device: DlnaDevice, target: string): Promise<string> =>
  callDlnaAction(requireDlnaService(device.services.avTransport, 'AVTransport'), 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: target });

export const setDlnaVolume = (device: DlnaDevice, volumePercent: number): Promise<string> => {
  if (!device.services.renderingControl) {
    throw new Error('该 DLNA 设备没有暴露音量控制。');
  }

  return callDlnaAction(device.services.renderingControl, 'SetVolume', {
    InstanceID: 0,
    Channel: 'Master',
    DesiredVolume: Math.max(0, Math.min(100, Math.round(volumePercent))),
  });
};
