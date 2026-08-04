import { createSocket, type Socket } from 'node:dgram';

export type EchoLinkMdnsAdvertisement = {
  name: string;
  deviceId: string;
  address: string;
  port: number;
  version: number;
};

const mdnsAddress = '224.0.0.251';
const mdnsPort = 5353;
const serviceType = '_echo-link._tcp.local';
const serviceEnumerator = '_services._dns-sd._udp.local';

const writeName = (name: string): Buffer => {
  const parts = name.split('.').filter(Boolean);
  return Buffer.concat([
    ...parts.map((part) => {
      const body = Buffer.from(part, 'utf8');
      return Buffer.concat([Buffer.from([Math.min(63, body.byteLength)]), body.subarray(0, 63)]);
    }),
    Buffer.from([0]),
  ]);
};

const writeString = (value: string): Buffer => {
  const body = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from([Math.min(255, body.byteLength)]), body.subarray(0, 255)]);
};

const record = (name: string, type: number, ttl: number, data: Buffer, rrClass = 1): Buffer => Buffer.concat([
  writeName(name),
  Buffer.from([(type >> 8) & 0xff, type & 0xff, (rrClass >> 8) & 0xff, rrClass & 0xff]),
  Buffer.from([(ttl >> 24) & 0xff, (ttl >> 16) & 0xff, (ttl >> 8) & 0xff, ttl & 0xff]),
  Buffer.from([(data.byteLength >> 8) & 0xff, data.byteLength & 0xff]),
  data,
]);

const ptrRecord = (name: string, target: string, ttl: number): Buffer => record(name, 12, ttl, writeName(target));

const srvRecord = (name: string, host: string, port: number, ttl: number): Buffer => record(
  name,
  33,
  ttl,
  Buffer.concat([
    Buffer.from([0, 0, 0, 0, (port >> 8) & 0xff, port & 0xff]),
    writeName(host),
  ]),
  0x8001,
);

const txtRecord = (name: string, values: string[], ttl: number): Buffer => record(name, 16, ttl, Buffer.concat(values.map(writeString)), 0x8001);

const aRecord = (name: string, address: string, ttl: number): Buffer => record(
  name,
  1,
  ttl,
  Buffer.from(address.split('.').map((part) => Number(part) & 0xff)),
  0x8001,
);

const safeDnsLabel = (value: string): string =>
  value
    .replace(/[.\r\n]+/gu, ' ')
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .trim()
    .slice(0, 48) || 'PC ECHO';

export class EchoLinkMdnsAdvertiser {
  private socket: Socket | null = null;
  private advertisement: EchoLinkMdnsAdvertisement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(advertisement: EchoLinkMdnsAdvertisement): Promise<void> {
    await this.stop(false);
    this.advertisement = advertisement;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => {
        socket.off('listening', ready);
        reject(error);
      };
      const ready = (): void => {
        socket.off('error', fail);
        try {
          socket.addMembership(mdnsAddress, advertisement.address);
          socket.setMulticastInterface(advertisement.address);
          socket.setMulticastTTL(255);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      };
      socket.once('error', fail);
      socket.once('listening', ready);
      socket.bind(mdnsPort);
    });

    await this.announce(false);
    this.timer = setInterval(() => {
      void this.announce(false).catch(() => undefined);
    }, 60_000);
    this.timer.unref?.();
  }

  async stop(goodbye = true): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (goodbye) {
      await this.announce(true).catch(() => undefined);
    }
    const socket = this.socket;
    this.socket = null;
    this.advertisement = null;
    if (!socket) {
      return;
    }
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  private async announce(goodbye: boolean): Promise<void> {
    const socket = this.socket;
    const advertisement = this.advertisement;
    if (!socket || !advertisement) {
      return;
    }

    const ttl = goodbye ? 0 : 120;
    const instance = `${safeDnsLabel(advertisement.name)}.${serviceType}`;
    const host = `${advertisement.deviceId.replace(/[^a-zA-Z0-9-]/gu, '').slice(0, 48) || 'echo-link'}.local`;
    const packet = Buffer.concat([
      Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 6, 0, 0, 0, 0]),
      ptrRecord(serviceEnumerator, serviceType, ttl),
      ptrRecord(serviceType, instance, ttl),
      srvRecord(instance, host, advertisement.port, ttl),
      txtRecord(instance, [`name=${advertisement.name}`, `version=${advertisement.version}`, `deviceId=${advertisement.deviceId}`], ttl),
      aRecord(host, advertisement.address, ttl),
      aRecord(`${safeDnsLabel(advertisement.name)}.local`, advertisement.address, ttl),
    ]);

    await new Promise<void>((resolve, reject) => {
      socket.send(packet, 0, packet.length, mdnsPort, mdnsAddress, (error) => (error ? reject(error) : resolve()));
    });
  }
}
