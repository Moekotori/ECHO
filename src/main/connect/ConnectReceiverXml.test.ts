import { describe, expect, it } from 'vitest';
import { isAllowedDlnaRemoteAddress, buildReceiverSsdpResponse } from './ConnectReceiverService';
import {
  buildDeviceDescriptionXml,
  buildScpdXml,
  buildSoapFault,
  isReceiverAudioCandidate,
  parseReceiverMetadata,
  parseSoapAction,
  parseSoapArgs,
} from './ConnectReceiverXml';

describe('Connect receiver XML and SOAP helpers', () => {
  it('builds MediaRenderer description and SCPD XML', () => {
    const description = buildDeviceDescriptionXml({
      uuid: 'receiver-1',
      friendlyName: 'ECHO Next Test',
      manufacturer: 'ECHO Next',
      modelName: 'Receiver',
      baseUrl: 'http://192.168.1.20:49152',
    });

    expect(description).toContain('urn:schemas-upnp-org:device:MediaRenderer:1');
    expect(description).toContain('<friendlyName>ECHO Next Test</friendlyName>');
    expect(description).toContain('<dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC>');
    expect(description).toContain('/dlna/control/avtransport');
    expect(buildScpdXml('avTransport')).toContain('<name>SetAVTransportURI</name>');
    expect(buildScpdXml('avTransport')).toContain('<relatedStateVariable>AVTransportURI</relatedStateVariable>');
    expect(buildScpdXml('renderingControl')).toContain('<name>GetMute</name>');
    expect(buildScpdXml('connectionManager')).toContain('<name>GetProtocolInfo</name>');
  });

  it('parses namespaced SOAP arguments used by stricter controllers', () => {
    const body = [
      '<s:Envelope><s:Body><u:SetAVTransportURI xmlns:u="urn:test">',
      '<u:InstanceID>0</u:InstanceID>',
      '<u:CurrentURI>http://phone/song.mp3</u:CurrentURI>',
      '<u:CurrentURIMetaData />',
      '</u:SetAVTransportURI></s:Body></s:Envelope>',
    ].join('');

    expect(parseSoapArgs(body, 'SetAVTransportURI')).toMatchObject({
      InstanceID: '0',
      CurrentURI: 'http://phone/song.mp3',
      CurrentURIMetaData: '',
    });
  });

  it('parses SOAP action and decoded metadata arguments', () => {
    const body = [
      '<s:Envelope><s:Body><u:SetAVTransportURI xmlns:u="urn:test">',
      '<InstanceID>0</InstanceID>',
      '<CurrentURI>http://phone/song.mp3</CurrentURI>',
      '<CurrentURIMetaData>&lt;DIDL-Lite&gt;&lt;dc:title&gt;A &amp;amp; B&lt;/dc:title&gt;&lt;/DIDL-Lite&gt;</CurrentURIMetaData>',
      '</u:SetAVTransportURI></s:Body></s:Envelope>',
    ].join('');

    expect(parseSoapAction('"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"', body)).toBe('SetAVTransportURI');
    expect(parseSoapArgs(body, 'SetAVTransportURI')).toMatchObject({
      InstanceID: '0',
      CurrentURI: 'http://phone/song.mp3',
      CurrentURIMetaData: '<DIDL-Lite><dc:title>A &amp; B</dc:title></DIDL-Lite>',
    });
  });

  it('parses receiver metadata with required fallbacks', () => {
    const metadata = parseReceiverMetadata(
      '<DIDL-Lite><item><dc:title></dc:title><upnp:album>Live</upnp:album><res duration="00:03:05">x</res></item></DIDL-Lite>',
      'http://phone.local/media/Fallback%20Song.flac',
    );

    expect(metadata).toEqual({
      title: 'Fallback Song.flac',
      artist: 'Unknown Artist',
      album: 'Live',
      albumArtist: null,
      durationSeconds: 185,
      coverHttpUrl: '',
    });
  });

  it('parses deeply escaped DIDL-Lite metadata and artwork', () => {
    const metadata = parseReceiverMetadata(
      '&amp;lt;DIDL-Lite&amp;gt;&amp;lt;item&amp;gt;&amp;lt;dc:title&amp;gt;晴天&amp;lt;/dc:title&amp;gt;&amp;lt;upnp:artist&amp;gt;周杰伦&amp;lt;/upnp:artist&amp;gt;&amp;lt;upnp:album&amp;gt;叶惠美&amp;lt;/upnp:album&amp;gt;&amp;lt;upnp:albumArtURI&amp;gt;http://cover.test/a.jpg?x=1&amp;amp;y=2&amp;lt;/upnp:albumArtURI&amp;gt;&amp;lt;/item&amp;gt;&amp;lt;/DIDL-Lite&amp;gt;',
      'http://m701.music.126.net/song?id=123',
    );

    expect(metadata).toMatchObject({
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      coverHttpUrl: 'http://cover.test/a.jpg?x=1&y=2',
    });
  });

  it('decodes numeric entities for Japanese metadata', () => {
    const metadata = parseReceiverMetadata(
      '<DIDL-Lite><item><dc:title>&amp;#12471;&amp;#12491;&amp;#12459;&amp;#12523;</dc:title><upnp:artist>Such / &amp;#12520;&amp;#12471;&amp;#12459;</upnp:artist></item></DIDL-Lite>',
      'http://m701.music.126.net/song?id=123',
    );

    expect(metadata.title).toBe('シニカル');
    expect(metadata.artist).toBe('Such / ヨシカ');
  });

  it('does not expose opaque DLNA tokens as song titles', () => {
    const metadata = parseReceiverMetadata(
      '<DIDL-Lite><item><dc:title>NUoqIw37w+aETdIDWJ44r65J83e38sCE=</dc:title></item></DIDL-Lite>',
      'http://m701.music.126.net/stream?id=123',
    );

    expect(metadata.title).toBe('External stream');
    expect(metadata.artist).toBe('Unknown Artist');
  });

  it('does not expose mixed-case stream tokens with only sparse digits', () => {
    const opaqueTitle = 'N8RfPgDeUPDAPIFsYKSAHFRCrcjsaWuesur';
    const metadata = parseReceiverMetadata(
      `<DIDL-Lite><item><dc:title>${opaqueTitle}</dc:title></item></DIDL-Lite>`,
      'http://m701.music.126.net/stream?id=123',
    );

    expect(metadata.title).toBe('External stream');
    expect(parseReceiverMetadata('', `http://phone.local/media/${opaqueTitle}`).title).toBe('External stream');
  });

  it('does not expose dotted opaque stream titles after receiver restore', () => {
    const opaqueTitle = '._92slRtOaWPuniOzuONt9eYvJdvmdXiyOoS8dDGxO';
    const metadata = parseReceiverMetadata(
      `<DIDL-Lite><item><dc:title>${opaqueTitle}</dc:title></item></DIDL-Lite>`,
      'http://m701.music.126.net/stream?id=123',
    );

    expect(metadata.title).toBe('External stream');
    expect(metadata.artist).toBe('Unknown Artist');
  });

  it('does not expose dotted opaque URI basenames as fallback titles', () => {
    const metadata = parseReceiverMetadata('', 'http://phone.local/media/._92slRtOaWPuniOzuONt9eYvJdvmdXiyOoS8dDGxO');

    expect(metadata.title).toBe('External stream');
    expect(metadata.artist).toBe('Unknown Artist');
  });

  it('decodes URL-style metadata and splits title artist fallbacks', () => {
    const metadata = parseReceiverMetadata(
      '<DIDL-Lite><item><dc:title>se+kai+no+shikumi+-+Guiano</dc:title></item></DIDL-Lite>',
      'http://phone.local/stream?id=1',
    );

    expect(metadata.title).toBe('se kai no shikumi');
    expect(metadata.artist).toBe('Guiano');
  });

  it('uses decoded query metadata before noisy stream basenames', () => {
    const metadata = parseReceiverMetadata(
      '',
      'http://phone.local/play?title=Sky+Song&artist=Guiano&album=The+Sky&cover=http%3A%2F%2Fcover.test%2Fa.jpg',
    );

    expect(metadata).toMatchObject({
      title: 'Sky Song',
      artist: 'Guiano',
      album: 'The Sky',
      coverHttpUrl: 'http://cover.test/a.jpg',
    });
  });

  it('avoids showing noisy stream URLs as titles', () => {
    const metadata = parseReceiverMetadata('', 'http://m701.music.126.net/song?id=123');

    expect(metadata.title).toBe('External stream');
    expect(metadata.artist).toBe('Unknown Artist');
  });

  it('rejects obvious non-audio media but allows unknown audio-like streams', () => {
    expect(isReceiverAudioCandidate('http://phone/video.mkv', null).ok).toBe(false);
    expect(isReceiverAudioCandidate('http://phone/photo.jpg', null).ok).toBe(false);
    expect(isReceiverAudioCandidate('http://phone/stream?id=1', '<upnp:class>object.item.audioItem.musicTrack</upnp:class>').ok).toBe(true);
  });

  it('checks same-subnet access and builds SSDP responses', () => {
    const locals = [{ address: '192.168.1.20', netmask: '255.255.255.0' }];

    expect(isAllowedDlnaRemoteAddress('192.168.1.45', locals)).toBe(true);
    expect(isAllowedDlnaRemoteAddress('192.168.2.45', locals)).toBe(false);
    expect(isAllowedDlnaRemoteAddress('::ffff:192.168.1.50', locals)).toBe(true);
    expect(isAllowedDlnaRemoteAddress('127.0.0.1', locals)).toBe(true);
    expect(buildReceiverSsdpResponse({ location: 'http://192.168.1.20:49152/dlna/description.xml', st: 'upnp:rootdevice', uuid: 'abc' }))
      .toContain('USN: uuid:abc::upnp:rootdevice');
  });

  it('builds UPnP SOAP faults', () => {
    const fault = buildSoapFault(714, 'Unsupported media');

    expect(fault).toContain('<errorCode>714</errorCode>');
    expect(fault).toContain('<errorDescription>Unsupported media</errorDescription>');
  });
});
