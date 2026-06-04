import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDlnaPositionInfo,
  getDlnaTransportInfo,
  getSsdpSearchAddresses,
  parseDeviceDescription,
  parseDlnaTime,
  type DlnaDevice,
} from './DlnaClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DLNA device description parsing', () => {
  it('builds SSDP search addresses for every usable IPv4 interface plus the default route', () => {
    expect(getSsdpSearchAddresses({
      ethernet: [
        { address: '192.168.1.231', family: 'IPv4', internal: false, cidr: '192.168.1.231/24', netmask: '255.255.255.0', mac: '00:00:00:00:00:01' },
      ],
      vmware: [
        { address: '192.168.241.1', family: 'IPv4', internal: false, cidr: '192.168.241.1/24', netmask: '255.255.255.0', mac: '00:00:00:00:00:02' },
      ],
      loopback: [
        { address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8', netmask: '255.0.0.0', mac: '00:00:00:00:00:03' },
      ],
      linkLocal: [
        { address: '169.254.1.9', family: 'IPv4', internal: false, cidr: '169.254.1.9/16', netmask: '255.255.0.0', mac: '00:00:00:00:00:04' },
      ],
    })).toEqual([null, '192.168.1.231', '192.168.241.1']);
  });

  it('keeps streamer model details from UPnP device descriptions', () => {
    const device = parseDeviceDescription(
      `<?xml version="1.0"?>
      <root>
        <URLBase>http://192.168.1.42:49152/</URLBase>
        <device>
          <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
          <friendlyName>Living Room Streamer</friendlyName>
          <manufacturer>Silent Angel</manufacturer>
          <modelName>N130</modelName>
          <modelNumber>v2</modelNumber>
          <modelDescription>Network Transport</modelDescription>
          <serialNumber>SA-001</serialNumber>
          <UDN>uuid:streamer-1</UDN>
          <presentationURL>/</presentationURL>
          <serviceList>
            <service>
              <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
              <controlURL>/upnp/control/avtransport</controlURL>
            </service>
            <service>
              <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
              <controlURL>/upnp/control/rendering</controlURL>
            </service>
          </serviceList>
        </device>
      </root>`,
      'http://192.168.1.42:49152/description.xml',
    );

    expect(device).toMatchObject({
      id: 'dlna:uuid:streamer-1',
      name: 'Living Room Streamer',
      model: 'N130',
      manufacturer: 'Silent Angel',
      address: '192.168.1.42',
      discovery: {
        deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1',
        descriptionUrl: 'http://192.168.1.42:49152/description.xml',
        presentationUrl: 'http://192.168.1.42:49152/',
        modelName: 'N130',
        modelNumber: 'v2',
        modelDescription: 'Network Transport',
        serialNumber: 'SA-001',
        udn: 'uuid:streamer-1',
      },
      services: {
        avTransport: {
          controlUrl: 'http://192.168.1.42:49152/upnp/control/avtransport',
        },
        renderingControl: {
          controlUrl: 'http://192.168.1.42:49152/upnp/control/rendering',
        },
      },
    });
  });

  it('parses DLNA clock values without trusting unsupported placeholders', () => {
    expect(parseDlnaTime('01:02:03')).toBe(3723);
    expect(parseDlnaTime('00:03:12.500')).toBe(192);
    expect(parseDlnaTime('NOT_IMPLEMENTED')).toBeNull();
    expect(parseDlnaTime('bad')).toBeNull();
  });

  it('reads transport and position info from SOAP responses', async () => {
    const device: DlnaDevice = {
      id: 'dlna:uuid:streamer-1',
      name: 'Living Room Streamer',
      protocol: 'dlna',
      model: 'N130',
      manufacturer: 'Silent Angel',
      address: '192.168.1.42',
      capabilities: {
        canPlay: true,
        canPause: true,
        canStop: true,
        canSeek: true,
        canSetVolume: true,
        supportsMetadata: true,
        supportsSetNext: false,
        supportedMimeTypes: ['audio/flac'],
        requiresTranscode: false,
      },
      state: 'available',
      lastSeenAt: '2026-05-21T01:00:00.000Z',
      unsupportedReason: null,
      descriptionUrl: 'http://192.168.1.42/description.xml',
      udn: 'uuid:streamer-1',
      services: {
        avTransport: {
          serviceType: 'urn:schemas-upnp-org:service:AVTransport:1',
          controlUrl: 'http://192.168.1.42/upnp/control/avtransport',
        },
        renderingControl: null,
        connectionManager: null,
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <s:Envelope>
            <s:Body>
              <u:GetTransportInfoResponse>
                <CurrentTransportState>PLAYING</CurrentTransportState>
                <CurrentTransportStatus>OK</CurrentTransportStatus>
                <CurrentSpeed>1</CurrentSpeed>
              </u:GetTransportInfoResponse>
            </s:Body>
          </s:Envelope>
        `),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <s:Envelope>
            <s:Body>
              <u:GetPositionInfoResponse>
                <TrackDuration>00:03:00</TrackDuration>
                <RelTime>00:00:42</RelTime>
              </u:GetPositionInfoResponse>
            </s:Body>
          </s:Envelope>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDlnaTransportInfo(device)).resolves.toEqual({
      state: 'PLAYING',
      status: 'OK',
      speed: '1',
    });
    await expect(getDlnaPositionInfo(device)).resolves.toEqual({
      durationSeconds: 180,
      positionSeconds: 42,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
