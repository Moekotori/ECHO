const readline = require('node:readline');

let raop = null;
let receiverHandle = null;
let forwardPcmEvents = true;

const send = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

const stopReceiver = () => {
  if (receiverHandle !== null && raop) {
    try {
      raop.stopReceiver(receiverHandle);
    } catch (error) {
      send({ type: 'log', level: 'warn', message: error && error.message ? error.message : String(error) });
    }
  }
  receiverHandle = null;
  forwardPcmEvents = true;
};

process.on('uncaughtException', (error) => {
  send({ type: 'fatal', message: error && error.stack ? error.stack : String(error) });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  send({ type: 'fatal', message: reason && reason.stack ? reason.stack : String(reason) });
  process.exit(1);
});

try {
  raop = require('@lox-audioserver/node-libraop');
  if (
    typeof raop.startAlacDecoder !== 'function' ||
    typeof raop.decodeAlacFrame !== 'function' ||
    typeof raop.stopAlacDecoder !== 'function'
  ) {
    throw new Error('@lox-audioserver/node-libraop is missing AirPlay 2 ALAC decoder exports');
  }
  raop.setLogHandler?.((event) => {
    const message = event && typeof event === 'object'
      ? [event.source, event.level, event.line].filter(Boolean).join(' ')
      : String(event ?? '');
    send({ type: 'log', level: event && event.level ? event.level : 'info', message });
  }, 'info', 'info', 'warn');
  send({ type: 'ready' });
} catch (error) {
  send({ type: 'fatal', message: error && error.stack ? error.stack : String(error) });
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (!message || typeof message !== 'object') {
    return;
  }

  try {
    if (message.type === 'start') {
      stopReceiver();
      receiverHandle = raop.startReceiver(message.options, (event) => {
        if (event && event.type === 'stream' && event.port) {
          send({ type: 'event', event });
          return;
        }

        if (event && event.type === 'pcm' && !forwardPcmEvents) {
          return;
        }

        send({ type: 'event', event });
      });
      send({ type: 'started', requestId: message.requestId, handle: receiverHandle });
      return;
    }

    if (message.type === 'stop') {
      stopReceiver();
      send({ type: 'stopped', requestId: message.requestId });
      return;
    }

    if (message.type === 'remote') {
      const ok = receiverHandle !== null && raop.sendRemoteCommand
        ? raop.sendRemoteCommand(receiverHandle, message.command)
        : false;
      send({ type: 'remote-result', requestId: message.requestId, ok });
      return;
    }

    if (message.type === 'pcm-forwarding') {
      forwardPcmEvents = message.enabled !== false;
      send({ type: 'pcm-forwarding', requestId: message.requestId, ok: true });
      return;
    }
  } catch (error) {
    send({
      type: 'error',
      requestId: message.requestId,
      message: error && error.stack ? error.stack : String(error),
    });
  }
});

process.once('disconnect', () => process.exit(0));
process.once('SIGTERM', () => {
  stopReceiver();
  process.exit(0);
});
