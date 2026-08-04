import { describe, expect, it } from 'vitest';
import { AirPlayMdnsAdvertiser, airPlay2FeatureMask, createAirPlay2PairingUuid } from './AirPlayMdnsAdvertiser';

type PacketFactory = {
  createPacket: (advertisement: {
    name: string;
    address: string;
    mac: string;
    port: number;
    airPlayPort?: number | null;
    airPlayPublicKey?: string | null;
    model: string;
    airPlay2Experimental?: boolean;
  }, ttl: number) => Buffer;
};

type DnsRecord = {
  name: string;
  type: number;
  data: Buffer;
};

const readDnsName = (packet: Buffer, startOffset: number): { name: string; offset: number } => {
  const labels: string[] = [];
  let offset = startOffset;
  while (offset < packet.length) {
    const length = packet[offset];
    if (length === 0) {
      return { name: labels.join('.'), offset: offset + 1 };
    }
    offset += 1;
    labels.push(packet.toString('utf8', offset, offset + length));
    offset += length;
  }
  throw new Error('unterminated DNS name');
};

const readDnsRecords = (packet: Buffer): DnsRecord[] => {
  const records: DnsRecord[] = [];
  const answerCount = packet.readUInt16BE(6);
  let offset = 12;
  for (let index = 0; index < answerCount; index += 1) {
    const name = readDnsName(packet, offset);
    offset = name.offset;
    const type = packet.readUInt16BE(offset);
    const dataLength = packet.readUInt16BE(offset + 8);
    const dataOffset = offset + 10;
    records.push({
      name: name.name,
      type,
      data: packet.subarray(dataOffset, dataOffset + dataLength),
    });
    offset = dataOffset + dataLength;
  }
  return records;
};

const srvPort = (record: DnsRecord): number => record.data.readUInt16BE(4);

describe('AirPlayMdnsAdvertiser', () => {
  const hasAirPlay2FeatureBit = (bit: number): boolean =>
    ((BigInt(airPlay2FeatureMask) >> BigInt(bit)) & 1n) === 1n;

  it('advertises a classic RAOP audio service without a misleading AirPlay control service', () => {
    const advertiser = new AirPlayMdnsAdvertiser() as unknown as PacketFactory;
    const packet = advertiser.createPacket({
      name: 'ECHO Next (AirPlay)',
      address: '192.168.31.214',
      mac: '60:CF:84:CB:1E:D1',
      port: 6000,
      model: 'ECHO-Next-AirPlay-Spike',
    }, 120);
    const payload = packet.toString('utf8');

    expect(packet.readUInt16BE(6)).toBe(5);
    expect(payload).toContain('_raop');
    expect(payload).toContain('cn=0,1');
    expect(payload).toContain('pw=false');
    expect(payload).toContain('sf=0x4');
    expect(payload).toContain('vs=130.14');
    expect(payload).not.toContain('_airplay');
    expect(payload).not.toContain('ft=');
    expect(payload).not.toContain('features=');
    expect(payload).not.toContain('0x527FFFF7');
    expect(payload).not.toContain('cn=0,1,2,3');
  });

  it('can advertise an opt-in experimental AirPlay 2 discovery service', () => {
    const advertiser = new AirPlayMdnsAdvertiser() as unknown as PacketFactory;
    const packet = advertiser.createPacket({
      name: 'ECHO Next (AirPlay)',
      address: '192.168.31.214',
      mac: '60:CF:84:CB:1E:D1',
      port: 6000,
      airPlayPort: 7000,
      airPlayPublicKey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      model: 'ECHO-Next-AirPlay-Spike',
      airPlay2Experimental: true,
    }, 120);
    const payload = packet.toString('utf8');

    expect(packet.readUInt16BE(6)).toBe(9);
    expect(payload).toContain('_raop');
    expect(payload).toContain('_airplay');
    expect(payload).toContain('deviceid=60:CF:84:CB:1E:D1');
    expect(payload).toContain('features=0x405fca00,0x1c340');
    expect(payload).toContain('ft=0x405fca00,0x1c340');
    expect(payload).toContain('et=0,1,3');
    expect(payload).toContain('cn=0,1,2');
    expect(payload).toContain('vs=366.0');
    expect(payload).toContain('srcvers=366.0');
    expect(payload).toContain(`pi=${createAirPlay2PairingUuid(
      '60:CF:84:CB:1E:D1',
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'airplay',
    )}`);
    expect(payload).toContain('pk=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
  });

  it('routes AirPlay 2 RAOP discovery to the AirPlay 2 control server instead of the native RAOP port', () => {
    const advertiser = new AirPlayMdnsAdvertiser() as unknown as PacketFactory;
    const packet = advertiser.createPacket({
      name: 'ECHO Next (AirPlay)',
      address: '192.168.31.214',
      mac: '60:CF:84:CB:1E:D1',
      port: 6000,
      airPlayPort: 7000,
      airPlayPublicKey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      model: 'ECHO-Next-AirPlay-Spike',
      airPlay2Experimental: true,
    }, 120);
    const srvRecords = readDnsRecords(packet).filter((record) => record.type === 33);
    const raopSrv = srvRecords.find((record) => record.name.endsWith('._raop._tcp.local'));
    const airPlaySrv = srvRecords.find((record) => record.name.endsWith('._airplay._tcp.local'));

    expect(raopSrv).toBeTruthy();
    expect(airPlaySrv).toBeTruthy();
    expect(srvPort(raopSrv!)).toBe(7000);
    expect(srvPort(airPlaySrv!)).toBe(7000);
  });

  it('keeps experimental AirPlay 2 feature bits aligned with implemented receiver paths', () => {
    expect([9, 11, 14, 15, 16, 17, 18, 19, 20, 22, 30, 38, 40, 41, 46, 47, 48].every(hasAirPlay2FeatureBit)).toBe(true);

    expect(hasAirPlay2FeatureBit(21)).toBe(false);
    expect(hasAirPlay2FeatureBit(51)).toBe(false);
    expect(hasAirPlay2FeatureBit(59)).toBe(false);
    expect(hasAirPlay2FeatureBit(60)).toBe(false);
    expect(hasAirPlay2FeatureBit(61)).toBe(false);
  });
});
