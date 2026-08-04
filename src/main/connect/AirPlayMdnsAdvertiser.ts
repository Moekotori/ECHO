import { createHash } from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';

export type AirPlayMdnsAdvertisement = {
  name: string;
  address: string;
  mac: string;
  port: number;
  airPlayPort?: number | null;
  airPlayPublicKey?: string | null;
  model: string;
  airPlay2Experimental?: boolean;
};

const mdnsAddress = '224.0.0.251';
const mdnsPort = 5353;
const raopServiceName = '_raop._tcp.local';
const airPlayServiceName = '_airplay._tcp.local';
const serviceEnumerator = '_services._dns-sd._udp.local';
const recordClassInternet = 1;
const recordClassCacheFlush = 0x8001;
const classicAirPlayVersion = '130.14';
const airPlay2SourceVersion = '366.0';
// AirPlay2 experimental receiver: HomeKit/transient pairing + FairPlay + iOS-compatible audio capability flags.
export const airPlay2FeatureMask = 0x1c340405fca00;
export const airPlay2FeatureBits = '0x405fca00,0x1c340';

const cleanMac = (mac: string): string => {
  const cleaned = mac.replace(/[^a-fA-F0-9]/gu, '').toUpperCase();
  return cleaned.length === 12 ? cleaned : '024543484F00';
};

const colonMac = (mac: string): string => cleanMac(mac).match(/.{1,2}/gu)?.join(':') ?? '02:45:43:48:4F:00';

export const createAirPlay2PairingUuid = (mac: string, publicKeyHex: string | null | undefined, suffix: string): string => {
  const hash = createHash('sha256');
  hash.update(cleanMac(mac));
  hash.update(publicKeyHex?.replace(/[^a-fA-F0-9]/gu, '').toUpperCase() ?? '');
  hash.update(suffix);
  const cleaned = hash.digest('hex').toUpperCase();
  return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-4${cleaned.slice(13, 16)}-8${cleaned.slice(17, 20)}-${cleaned.slice(20, 32)}`.toLowerCase();
};

const encodeName = (name: string): Buffer => {
  const labels = name.replace(/\.$/u, '').split('.');
  return Buffer.concat([
    ...labels.map((label) => {
      const content = Buffer.from(label, 'utf8');
      return Buffer.concat([Buffer.from([content.length]), content]);
    }),
    Buffer.from([0]),
  ]);
};

const encodeTxt = (values: string[]): Buffer =>
  Buffer.concat(values.map((value) => {
    const content = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from([Math.min(content.length, 255)]), content.subarray(0, 255)]);
  }));

const encodeRecord = (name: string, type: number, recordClass: number, ttl: number, data: Buffer): Buffer => {
  const header = Buffer.allocUnsafe(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(recordClass, 2);
  header.writeUInt32BE(ttl, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), header, data]);
};

const readName = (packet: Buffer, startOffset: number, depth = 0): { name: string; offset: number } | null => {
  if (depth > 8) {
    return null;
  }

  const labels: string[] = [];
  let offset = startOffset;
  let nextOffset = startOffset;
  let jumped = false;

  while (offset < packet.length) {
    const length = packet[offset];
    if (length === 0) {
      offset += 1;
      if (!jumped) {
        nextOffset = offset;
      }
      return { name: labels.join('.').toLowerCase(), offset: nextOffset };
    }

    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= packet.length) {
        return null;
      }
      const pointer = ((length & 0x3f) << 8) | packet[offset + 1];
      const pointed = readName(packet, pointer, depth + 1);
      if (!pointed) {
        return null;
      }
      labels.push(pointed.name);
      if (!jumped) {
        nextOffset = offset + 2;
      }
      jumped = true;
      return { name: labels.join('.').toLowerCase(), offset: nextOffset };
    }

    offset += 1;
    if (offset + length > packet.length) {
      return null;
    }
    labels.push(packet.subarray(offset, offset + length).toString('utf8'));
    offset += length;
  }

  return null;
};

const parseQuestionNames = (packet: Buffer): Set<string> => {
  const names = new Set<string>();
  if (packet.length < 12) {
    return names;
  }

  const questionCount = packet.readUInt16BE(4);
  let offset = 12;
  for (let index = 0; index < questionCount; index += 1) {
    const result = readName(packet, offset);
    if (!result || result.offset + 4 > packet.length) {
      break;
    }
    names.add(result.name);
    offset = result.offset + 4;
  }
  return names;
};

export class AirPlayMdnsAdvertiser {
  private socket: Socket | null = null;
  private advertisement: AirPlayMdnsAdvertisement | null = null;
  private announceTimers: NodeJS.Timeout[] = [];

  async start(advertisement: AirPlayMdnsAdvertisement): Promise<void> {
    await this.stop(false);
    this.advertisement = advertisement;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('message', (message, remote) => this.handleMessage(message, remote));

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        socket.off('error', onError);
        try {
          socket.addMembership(mdnsAddress, advertisement.address);
          socket.setMulticastInterface(advertisement.address);
          socket.setMulticastTTL(255);
          socket.setMulticastLoopback(true);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      };
      socket.once('error', onError);
      socket.once('listening', onListening);
      socket.bind(mdnsPort);
    });

    this.announce(false);
    this.announceTimers = [250, 1000, 3000].map((delay) => setTimeout(() => this.announce(false), delay));
  }

  async stop(sendGoodbye = true): Promise<void> {
    for (const timer of this.announceTimers) {
      clearTimeout(timer);
    }
    this.announceTimers = [];
    if (sendGoodbye) {
      this.announce(true);
    }
    const socket = this.socket;
    this.socket = null;
    this.advertisement = null;
    if (!socket) {
      return;
    }
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  private handleMessage(message: Buffer, remote: RemoteInfo): void {
    const advertisement = this.advertisement;
    if (!advertisement) {
      return;
    }

    const names = parseQuestionNames(message);
    const raopInstance = this.raopInstanceName(advertisement).toLowerCase();
    const airPlayInstance = this.airPlayInstanceName(advertisement).toLowerCase();
    const hostName = this.hostName(advertisement).toLowerCase();
    if (
      names.has(raopServiceName) ||
      names.has(airPlayServiceName) ||
      names.has(serviceEnumerator) ||
      names.has(raopInstance) ||
      names.has(airPlayInstance) ||
      names.has(hostName)
    ) {
      this.announce(false);
      this.announce(false, { address: remote.address, port: remote.port });
    }
  }

  private announce(goodbye: boolean, target?: { address: string; port: number }): void {
    const socket = this.socket;
    const advertisement = this.advertisement;
    if (!socket || !advertisement) {
      return;
    }

    const packet = this.createPacket(advertisement, goodbye ? 0 : 120);
    socket.send(packet, 0, packet.length, target?.port ?? mdnsPort, target?.address ?? mdnsAddress);
  }

  private createPacket(advertisement: AirPlayMdnsAdvertisement, ttl: number): Buffer {
    const mac = cleanMac(advertisement.mac);
    const raopInstance = this.raopInstanceName(advertisement);
    const airPlayInstance = this.airPlayInstanceName(advertisement);
    const hostName = this.hostName(advertisement);
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0);
    header.writeUInt16BE(0x8400, 2);
    header.writeUInt16BE(0, 4);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(0, 10);

    const advertisedRaopPort = advertisement.airPlay2Experimental && advertisement.airPlayPort
      ? advertisement.airPlayPort
      : advertisement.port;
    const srvData = Buffer.concat([
      Buffer.from([0, 0, 0, 0, (advertisedRaopPort >> 8) & 0xff, advertisedRaopPort & 0xff]),
      encodeName(hostName),
    ]);
    const airPlayPort = advertisement.airPlayPort ?? advertisement.port;
    const airPlaySrvData = Buffer.concat([
      Buffer.from([0, 0, 0, 0, (airPlayPort >> 8) & 0xff, airPlayPort & 0xff]),
      encodeName(hostName),
    ]);
    const addressData = Buffer.from(advertisement.address.split('.').map((part) => Number(part) & 0xff));
    const raopTxtValues = advertisement.airPlay2Experimental
      ? [
        `am=${advertisement.model}`,
        'tp=UDP',
        'sm=false',
        'sv=false',
        'ek=1',
        'et=0,1,3',
        `ft=${airPlay2FeatureBits}`,
        'md=0,1,2',
        'cn=0,1,2',
        'ch=2',
        'pw=false',
        'sf=0x4',
        'ss=16',
        'sr=44100',
        'vn=3',
        `vs=${airPlay2SourceVersion}`,
        'vv=2',
        `pi=${createAirPlay2PairingUuid(mac, advertisement.airPlayPublicKey, 'airplay')}`,
        `pk=${advertisement.airPlayPublicKey ?? '0000000000000000000000000000000000000000000000000000000000000000'}`,
        'txtvers=1',
      ]
      : [
        `am=${advertisement.model}`,
        'tp=UDP',
        'sm=false',
        'sv=false',
        'ek=1',
        'et=0,1',
        'md=0,1,2',
        'cn=0,1',
        'ch=2',
        'pw=false',
        'sf=0x4',
        'ss=16',
        'sr=44100',
        'vn=3',
        `vs=${classicAirPlayVersion}`,
        'txtvers=1',
      ];
    const raopTxtData = encodeTxt(raopTxtValues);
    const airPlayTxtData = encodeTxt([
      `deviceid=${colonMac(mac)}`,
      `features=${airPlay2FeatureBits}`,
      'flags=0x4',
      `model=${advertisement.model}`,
      'manufacturer=Moekotori',
      'pw=false',
      `srcvers=${airPlay2SourceVersion}`,
      'protovers=1.1',
      'vv=2',
      `pi=${createAirPlay2PairingUuid(mac, advertisement.airPlayPublicKey, 'airplay')}`,
      `psi=${createAirPlay2PairingUuid(mac, advertisement.airPlayPublicKey, 'system')}`,
      `pk=${advertisement.airPlayPublicKey ?? '0000000000000000000000000000000000000000000000000000000000000000'}`,
      'txtvers=1',
    ]);

    const records = [
      encodeRecord(serviceEnumerator, 12, recordClassInternet, ttl, encodeName(raopServiceName)),
      encodeRecord(raopServiceName, 12, recordClassInternet, ttl, encodeName(raopInstance)),
      encodeRecord(raopInstance, 33, recordClassCacheFlush, ttl, srvData),
      encodeRecord(raopInstance, 16, recordClassCacheFlush, ttl, raopTxtData),
      encodeRecord(hostName, 1, recordClassCacheFlush, ttl, addressData),
    ];

    if (advertisement.airPlay2Experimental) {
      records.splice(1, 0, encodeRecord(serviceEnumerator, 12, recordClassInternet, ttl, encodeName(airPlayServiceName)));
      records.splice(
        5,
        0,
        encodeRecord(airPlayServiceName, 12, recordClassInternet, ttl, encodeName(airPlayInstance)),
        encodeRecord(airPlayInstance, 33, recordClassCacheFlush, ttl, airPlaySrvData),
        encodeRecord(airPlayInstance, 16, recordClassCacheFlush, ttl, airPlayTxtData),
      );
    }

    header.writeUInt16BE(records.length, 6);
    return Buffer.concat([header, ...records]);
  }

  private raopInstanceName(advertisement: AirPlayMdnsAdvertisement): string {
    return `${cleanMac(advertisement.mac)}@${advertisement.name}.${raopServiceName}`;
  }

  private airPlayInstanceName(advertisement: AirPlayMdnsAdvertisement): string {
    return `${advertisement.name}.${airPlayServiceName}`;
  }

  private hostName(advertisement: AirPlayMdnsAdvertisement): string {
    return `${cleanMac(advertisement.mac)}.local`;
  }
}
