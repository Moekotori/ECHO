import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getAudioSession } from '../audioPublicApi';
import { getAirPlayReceiverSpikeService } from '../connect/AirPlayReceiverSpikeService';

const devApiPort = 5174;
const maxBodyBytes = 64 * 1024;
let devApiServer: Server | null = null;

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        const parsed = raw ? (JSON.parse(raw) as unknown) : {};
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });
    request.on('error', reject);
  });

const requestUrl = (request: IncomingMessage): URL => new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

export const startDevApiServer = (): void => {
  if (!process.env.ELECTRON_RENDERER_URL || devApiServer) {
    return;
  }

  devApiServer = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = requestUrl(request);
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/audio/status') {
        sendJson(response, 200, getAudioSession().getStatus());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/audio/diagnostics') {
        sendJson(response, 200, getAudioSession().getDiagnostics());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/connect/airplay/status') {
        sendJson(response, 200, getAirPlayReceiverSpikeService().getStatus());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/connect/airplay/enabled') {
        const body = await readJsonBody(request);
        sendJson(response, 200, await getAirPlayReceiverSpikeService().setEnabled(body.enabled === true));
        return;
      }

      sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  devApiServer.listen(devApiPort, '127.0.0.1');
  devApiServer.on('error', () => {
    devApiServer = null;
  });
};
