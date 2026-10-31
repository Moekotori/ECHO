import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getAudioSession } from '../audioPublicApi';

const devApiPort = 5174;
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
