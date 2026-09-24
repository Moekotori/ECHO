import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const jsonRequest = async (url, init = {}) => {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || `HTTP ${response.status}`);
    error.code = body?.error?.code;
    error.status = response.status;
    error.requestId = body?.error?.requestId;
    throw error;
  }
  return body;
};

const hostForUrl = (host) => host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

export class EchoLinkV2Client {
  constructor({ apiBaseUrl, accessToken, clientId }) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/u, '');
    this.accessToken = accessToken;
    this.clientId = clientId;
  }

  static async pair(pairingUri, { clientName = 'Node ECHO Link Client', platform = process.platform } = {}) {
    const uri = new URL(pairingUri);
    if (uri.protocol !== 'echo:' || uri.hostname !== 'pair' || uri.searchParams.get('version') !== '2') {
      throw new Error('invalid ECHO Link v2 pairing URI');
    }
    const host = uri.searchParams.get('host');
    const port = Number(uri.searchParams.get('port'));
    const pairingId = uri.searchParams.get('pairingId');
    const secret = uri.searchParams.get('secret');
    if (!host || !Number.isInteger(port) || !pairingId || !secret) {
      throw new Error('incomplete ECHO Link v2 pairing URI');
    }
    const base = `http://${hostForUrl(host)}:${port}/echo-link/v2`;
    const paired = await jsonRequest(`${base}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingId, secret, clientName, platform }),
    });
    return new EchoLinkV2Client(paired);
  }

  headers(extra = {}) {
    return { Authorization: `Bearer ${this.accessToken}`, ...extra };
  }

  status() {
    return jsonRequest(`${this.apiBaseUrl}/status`, { headers: this.headers() });
  }

  action(action, values = {}, requestId = randomUUID()) {
    return jsonRequest(`${this.apiBaseUrl}/actions/playback`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requestId, action, ...values }),
    });
  }

  async createEventTicket() {
    return jsonRequest(`${this.apiBaseUrl}/events/ticket`, {
      method: 'POST',
      headers: this.headers(),
    });
  }

  async streamEvents(onEvent, { signal } = {}) {
    while (!signal?.aborted) {
      try {
        const ticket = await this.createEventTicket();
        const response = await fetch(new URL(ticket.eventsUrl, `${this.apiBaseUrl}/`), {
          headers: { Accept: 'text/event-stream' },
          signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        await this.#consumeSse(response.body, onEvent, signal);
      } catch (error) {
        if (signal?.aborted) return;
        console.error('ECHO Link event stream disconnected:', error.message);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async #consumeSse(body, onEvent, signal) {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      while (!signal?.aborted) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary).replace(/\r/gu, '');
          buffer = buffer.slice(boundary + 2);
          if (!block || block.startsWith(':')) continue;
          const event = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
          const id = block.split('\n').find((line) => line.startsWith('id:'))?.slice(3).trim() || null;
          const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (data) onEvent({ event, id, data: JSON.parse(data) });
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pairingUri = process.argv[2];
  if (!pairingUri) {
    console.error('Usage: node examples/echo-link-v2-client.mjs "echo://pair?..."');
    process.exitCode = 1;
  } else {
    const client = await EchoLinkV2Client.pair(pairingUri);
    const status = await client.status();
    console.log(`Paired with ${status.device.name} as ${client.clientId}. Token is intentionally not printed.`);
    console.log('Initial playback:', status.playback);
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    await client.streamEvents(({ event, data }) => console.log(event, data.snapshot), { signal: controller.signal });
  }
}
