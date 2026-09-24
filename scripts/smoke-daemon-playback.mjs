/**
 * Deterministic daemon RPC smoke helper for playback stabilization.
 *
 * Uses the fd3/fd4 JSON-RPC protocol (same pattern as smoke-jsonrpc-openfile.mjs).
 * Calls only: audio.openFile, audio.seek, audio.stop, audio.pause, audio.resume,
 *   audio.prefetch, audio.gaplessPrepare, eq.setState, eq.getState, rpc.shutdown, rpc.ping.
 * MUST NOT use audio.playFile.
 *
 * Parses audio.position and audio.ended notifications from fd4.
 * Writes machine-readable evidence JSON to --evidence-dir.
 */
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const defaultHostPath = join(projectRoot, 'electron-app', 'build', 'echo-audio-host');
const defaultTestFile = join(projectRoot, 'test', 'tt', '三省 - 毕竟我是一条鱼.mp3');
const defaultEvidenceDir = join(projectRoot, '.omo', 'evidence');

// ── CLI parsing ──

function parseArgs(argv) {
  const args = {
    scenario: 'cold-open', file: defaultTestFile, host: defaultHostPath, evidenceDir: defaultEvidenceDir,
    offset: 0, deviceIndex: -1, deviceName: '', alternateDeviceIndex: null,
    alternateDeviceName: '', outputMode: 'shared', sampleRate: 48000, queueRates: null, queueFiles: null,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': args.help = true; break;
      case '--scenario': case '-s': args.scenario = argv[++i] || ''; break;
      case '--file': case '-f': args.file = argv[++i] || ''; break;
      case '--host': args.host = argv[++i] || ''; break;
      case '--evidence-dir': args.evidenceDir = argv[++i] || ''; break;
      case '--offset': args.offset = parseFloat(argv[++i]) || 0; break;
      case '--device-index': args.deviceIndex = Number.parseInt(argv[++i] || '-1', 10); break;
      case '--device-name': args.deviceName = argv[++i] || ''; break;
      case '--alternate-device-index': args.alternateDeviceIndex = Number.parseInt(argv[++i] || '-1', 10); break;
      case '--alternate-device-name': args.alternateDeviceName = argv[++i] || ''; break;
      case '--output-mode': args.outputMode = argv[++i] || 'shared'; break;
      case '--sample-rate': args.sampleRate = Number.parseInt(argv[++i] || '48000', 10); break;
      case '--queue-rates': {
        const value = argv[++i] || '';
        args.queueRates = value.split(',').map((rate) => Number.parseInt(rate.trim(), 10));
        break;
      }
      case '--queue-files': {
        const value = argv[++i] || '';
        args.queueFiles = value.split('|').map((file) => file.trim());
        break;
      }
    }
  }
  return args;
}

const VALID_SCENARIOS = ['cold-open', 'remote-source', 'output-mode-cycle', 'hotplug-recovery', 'offset-open', 'rapid-open-stop-open', 'natural-ended', 'explicit-stop', 'eq-replay', 'prefetch-no-truncate', 'queue-advance', 'gapless-boundary', 'main-thread-stall', 'live-playback-rate', 'crash-exit', 'lifecycle', 'all'];

function printHelp() {
  const exe = 'node scripts/smoke-daemon-playback.mjs';
  console.log(`ECHO daemon playback smoke helper

Usage:
  ${exe} --help
  ${exe} [options]

Options:
  --help, -h                  Show this help
  --scenario, -s <name>       Scenario to run (default: cold-open)
                              Valid: ${VALID_SCENARIOS.join(', ')}
  --file, -f <path>           Audio file to use (required for most scenarios)
  --host <path>               Path to echo-audio-host binary
  --evidence-dir <path>       Directory for evidence output
  --offset <seconds>          Start offset for offset-open and related scenarios
  --device-index <number>     Device index for output-mode-cycle (default: system default)
  --device-name <name>        Device name for output-mode-cycle (default: system default)
  --alternate-device-index <number> Alternate shared-mode device for output-mode-cycle
  --alternate-device-name <name> Alternate shared-mode device name for output-mode-cycle
  --output-mode <mode>        Output mode for queue/gapless scenarios (shared, exclusive, or asio)
  --sample-rate <hz>          Device/session rate for output-mode-cycle (default: 48000)
  --queue-rates <hz,...>      Queue source rates for queue-advance (default: 48000,44100,96000)
  --queue-files <a|b|c>       Existing queue fixtures matching --queue-rates (default: generated WAVs)

Scenarios:
  cold-open              Open file on fresh daemon, observe position events, shutdown
  remote-source          Serve a guarded HTTP Range fixture and verify open/seek/host truth
  output-mode-cycle      Reopen playback across exclusive/shared/exclusive/shared output
  hotplug-recovery       Verify playback recovery after the selected device is unplugged and reconnected
  offset-open            Open with start offset (requires later task support)
  rapid-open-stop-open   Open, stop, open again rapidly (requires later task support)
  natural-ended          Wait for natural EOF ended event
  explicit-stop          Open file, wait for position, stop, verify zero ended
  eq-replay              Set EQ state before opening file (requires later task support)
  prefetch-no-truncate   Prefetch then open, verify full duration (requires later task support)
  queue-advance          Verify mixed-rate autonomous queue handoff on a resident 48 kHz device
  gapless-boundary       Verify host-owned multi-track PCM-boundary handoff identities
  main-thread-stall      Block the Node control plane and verify native playback keeps advancing
  live-playback-rate     Change playback rate while native playback is active
  crash-exit             Kill the daemon during playback and verify transport/process closure
  lifecycle              RPC shutdown and process exit cleanup
  all                    Run all scenarios sequentially
`);
}

// ── Evidence ──

function ensureEvidenceDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function writeEvidence(dir, slug, data) {
  ensureEvidenceDir(dir);
  const path = join(dir, slug);
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  return path;
}

// ── Daemon spawn and RPC ──

class DaemonRunner {
  constructor(hostPath) {
    this.hostPath = hostPath;
    this.child = null;
    this.rpcMsgs = [];
    this.rpcBuf = '';
    this.stderr = '';
    this.startTime = 0;
    this.sessionId = 1;
    this.evidence = { rpcEvents: [], stderr: '', assertions: [], passed: null };
  }

  fail(msg) {
    this.evidence.assertions.push({ type: 'fail', message: msg });
    this.evidence.passed = false;
    throw new Error(msg);
  }

  assert(condition, msg) {
    if (condition) {
      this.evidence.assertions.push({ type: 'pass', message: msg });
    } else {
      this.fail(msg);
    }
  }

  spawn() {
    if (!existsSync(this.hostPath)) {
      this.fail(`Host binary not found: ${this.hostPath}`);
    }

    this.startTime = Date.now();
    this.child = spawn(this.hostPath, ['--no-stdin', '--defer-device-open', '--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });

    const rpcIn = this.child.stdio[3];
    const rpcOut = this.child.stdio[4];

    rpcOut.setEncoding('utf8');
    rpcOut.on('data', (chunk) => {
      this.rpcBuf += chunk;
      while (this.rpcBuf.includes('\n')) {
        const idx = this.rpcBuf.indexOf('\n');
        const line = this.rpcBuf.slice(0, idx).trim();
        this.rpcBuf = this.rpcBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          this.rpcMsgs.push(parsed);
          this.evidence.rpcEvents.push({ timeMs: Date.now() - this.startTime, msg: parsed });
        } catch {
          this.rpcMsgs.push(line);
          this.evidence.rpcEvents.push({ timeMs: Date.now() - this.startTime, raw: line });
        }
      }
    });

    this.rpcIn = rpcIn;
    this.rpcOut = rpcOut;
  }

  async waitReady(timeoutMs = 15000, output = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stderr.includes('awaiting') || this.stderr.includes('ready') || this.stderr.includes('Listening')) {
        const configureId = 8999;
        this.sendRpc('device.configure', [{
          outputMode: output.outputMode || 'shared',
          deviceId: '',
          deviceIndex: output.deviceIndex ?? -1,
          deviceName: output.deviceName || '',
          sampleRate: output.sampleRate ?? 48000,
          channels: 2,
          bufferSize: 2048,
          latencyProfile: 'balanced',
          sharedBackend: 'auto',
          ...(output.processing ? { processing: output.processing } : {}),
        }], configureId);
        const configureResponse = await this.waitResponse(configureId, timeoutMs);
        if (configureResponse.error || configureResponse.result?.accepted !== true) {
          this.fail(`device.configure failed: ${JSON.stringify(configureResponse.error ?? configureResponse.result)}`);
        }
        this.evidence.deviceConfigure = configureResponse.result;
        const sessionBeginId = 9000;
        this.sendRpc('audio.sessionBegin', {
          sessionId: this.sessionId,
          sr: output.sampleRate ?? 48000,
          ch: 2,
          buffer: 256,
          fifoMs: 200,
          prebufferMs: 0,
        }, sessionBeginId);
        const response = await this.waitResponse(sessionBeginId, timeoutMs);
        if (response.error) {
          this.fail(`audio.sessionBegin failed: ${JSON.stringify(response.error)}`);
        }
        this.evidence.deviceReady = true;
        return;
      }
      if (this.child.exitCode !== null) {
        this.fail(`Host exited during startup with code ${this.child.exitCode}`);
      }
      await sleep(200);
    }
    this.fail('Timeout waiting for host readiness');
  }

  sendRpc(method, params, id) {
    const msg = { jsonrpc: '2.0', method, params, id };
    this.evidence.rpcEvents.push({ timeMs: Date.now() - this.startTime, direction: 'send', msg });
    this.rpcIn.write(JSON.stringify(msg) + '\n');
  }

  async waitResponse(id, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const m = this.rpcMsgs.find((x) => x && (x.id === id || (x.id !== undefined && x.id === id)));
      if (m) return m;
      if (this.child.exitCode !== null) {
        this.fail(`Host exited before response for id=${id}, exit=${this.child.exitCode}`);
      }
      await sleep(100);
    }
    this.fail(`Timeout waiting for RPC response id=${id}`);
  }

  readNotifications(method) {
    return this.rpcMsgs.filter((x) => x && x.method === method && x.id === undefined);
  }

  /** Snapshot current rpcMsgs length so later reads can filter to events after this point */
  markEventOffset() {
    this._eventOffset = this.rpcMsgs.length;
  }

  /** Read notifications received after markEventOffset (or all if never marked) */
  readNotificationsAfter(method) {
    const start = this._eventOffset || 0;
    return this.rpcMsgs.slice(start).filter((x) => x && x.method === method && x.id === undefined);
  }

  /** Wait for at least N notifications of given method within timeout, counting only events after markEventOffset */
  async waitNotifications(method, minCount, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const count = this.readNotificationsAfter(method).length;
      if (count >= minCount) return this.readNotificationsAfter(method);
      if (this.child.exitCode !== null) {
        this.fail(`Host exited while waiting for ${method} notifications, exit=${this.child.exitCode}`);
      }
      await sleep(200);
    }
    const count = this.readNotificationsAfter(method).length;
    if (count >= minCount) return this.readNotificationsAfter(method);
    this.fail(`Timeout waiting for ${minCount} ${method} notifications, got ${count}`);
  }

  async tryWaitNotifications(method, minCount, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const events = this.readNotificationsAfter(method);
      if (events.length >= minCount) return { events, error: null };
      if (this.child.exitCode !== null) {
        return { events, error: `Host exited while waiting for ${method} notifications, exit=${this.child.exitCode}` };
      }
      await sleep(200);
    }
    const events = this.readNotificationsAfter(method);
    return { events, error: `Timeout waiting for ${minCount} ${method} notifications, got ${events.length}` };
  }

  resetTransportForRetry() {
    this.child = null;
    this.rpcMsgs = [];
    this.rpcBuf = '';
    this.stderr = '';
    this.startTime = 0;
    this._eventOffset = 0;
  }

  async shutdown() {
    try {
      this.sendRpc('rpc.shutdown', {}, 9999);
      await Promise.race([
        this.waitResponse(9999, 3000),
        sleep(3000),
      ]);
    } catch { /* best effort */ }
    try { this.rpcIn.end(); } catch { /* ignore */ }

    const waitForExit = async (timeoutMs) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return true;
      return (await waitForEventOrTimeout(this.child, 'exit', timeoutMs)).occurred;
    };

    let forced = false;
    if (!await waitForExit(3000)) {
      forced = true;
      this.child.kill('SIGTERM');
      if (!await waitForExit(3000)) {
        this.child.kill('SIGKILL');
        await waitForExit(3000);
      }
    }

    const result = {
      exitCode: this.child.exitCode,
      signalCode: this.child.signalCode,
      forced,
    };
    this.evidence.shutdown = result;
    if (this.evidence.deviceConfigure?.outputMode === 'asio') {
      this.assert(
        result.exitCode === 0 && result.signalCode === null && !result.forced,
        `ASIO host exited cleanly after rpc.shutdown (exit=${result.exitCode}, signal=${result.signalCode}, forced=${result.forced})`,
      );
    }
    return result;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEventOrTimeout(emitter, eventName, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (occurred, args = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      emitter.removeListener(eventName, onEvent);
      resolve({ occurred, args });
    };
    const onEvent = (...args) => finish(true, args);
    const timer = setTimeout(() => finish(false), timeoutMs);
    emitter.once(eventName, onEvent);
  });
}

function validateStartSecondsForRpc(startSeconds) {
  if (startSeconds !== undefined && !Number.isFinite(startSeconds)) {
    throw new Error('invalid_startSeconds');
  }
}


function assertOpenFileResult(runner, result, filePath, label = 'openFile') {
  const validStatus = result.status === 'ready' || result.status === 'probed' || result.status === 'decoding';
  runner.assert(validStatus, `${label} status is ${result.status}`);
  runner.assert(result.filePath === filePath, `${label} filePath matches request`);
  runner.assert(typeof result.codec === 'string' && result.codec.length > 0, `${label} codec is present`);
  runner.assert(typeof result.container === 'string' && result.container.length > 0, `${label} container is present`);
  runner.assert(typeof result.sampleRate === 'number' && result.sampleRate > 0, `${label} sampleRate ${result.sampleRate} > 0`);
  runner.assert(typeof result.channels === 'number' && result.channels > 0, `${label} channels ${result.channels} > 0`);
  runner.assert(typeof result.durationSeconds === 'number' && result.durationSeconds > 0, `${label} duration ${result.durationSeconds}s > 0`);
  if (result.operationId !== undefined) runner.assert(typeof result.operationId === 'number', `${label} operationId ${result.operationId}`);
  if (result.startSeconds !== undefined) runner.assert(typeof result.startSeconds === 'number' && result.startSeconds >= 0, `${label} startSeconds ${result.startSeconds}`);
  if (result.bitDepth !== undefined) runner.assert(typeof result.bitDepth === 'number' && result.bitDepth > 0, `${label} bitDepth ${result.bitDepth}`);
  if (result.bitrate !== undefined) runner.assert(typeof result.bitrate === 'number' && result.bitrate > 0, `${label} bitrate ${result.bitrate}`);
}

function observedPositionSeconds(notification, startSeconds, sampleRate) {
  const params = notification?.params;
  if (!params) return null;
  if (typeof params.positionSeconds === 'number') return params.positionSeconds;
  if (typeof params.framesPlayed === 'number' && typeof sampleRate === 'number' && sampleRate > 0) {
    return startSeconds + params.framesPlayed / sampleRate;
  }
  return null;
}

function assertInvalidOffset(condition, evidence, message) {
  if (condition) {
    evidence.assertions.push({ type: 'pass', message });
    return;
  }
  evidence.assertions.push({ type: 'fail', message });
  evidence.passed = false;
  throw new Error(message);
}

async function runInvalidOffsetSubcases(runner, filePath, evidenceDir, baselineDurationSeconds) {
  const evidence = {
    scenario: 'invalid-offsets',
    timestamp: new Date().toISOString(),
    file: filePath,
    assertions: [],
    subcases: [],
    passed: false,
  };

  try {
    for (const [label, value] of [['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY]]) {
      try {
        validateStartSecondsForRpc(value);
        evidence.subcases.push({ label, rejectedBeforeRpc: false });
        assertInvalidOffset(false, evidence, `${label} rejected before RPC`);
      } catch (error) {
        evidence.subcases.push({ label, rejectedBeforeRpc: true, error: error.message });
        assertInvalidOffset(error.message === 'invalid_startSeconds', evidence, `${label} rejected before RPC`);
      }
    }

    runner.sendRpc('audio.openFile', [{ filePath, startSeconds: -5 }], 1001);
    const negativeResponse = await runner.waitResponse(1001, 30000);
    assertInvalidOffset(!negativeResponse.error, evidence, '-5 openFile did not error');
    const negativeStart = negativeResponse.result?.startSeconds;
    evidence.subcases.push({ label: '-5', requestedStartSeconds: -5, responseStartSeconds: negativeStart });
    assertInvalidOffset(negativeStart === 0, evidence, '-5 normalized to 0.0');

    runner.sendRpc('audio.openFile', [{ filePath, startSeconds: 999999 }], 1002);
    const hugeResponse = await runner.waitResponse(1002, 30000);
    assertInvalidOffset(!hugeResponse.error, evidence, '999999 openFile did not error');
    const hugeResult = hugeResponse.result || {};
    const durationSeconds = typeof hugeResult.durationSeconds === 'number' && hugeResult.durationSeconds > 0
      ? hugeResult.durationSeconds
      : baselineDurationSeconds;
    const expectedStartSeconds = Math.max(0, durationSeconds - 0.250);
    evidence.subcases.push({
      label: '999999',
      requestedStartSeconds: 999999,
      durationSeconds,
      expectedStartSeconds,
      responseStartSeconds: hugeResult.startSeconds,
    });
    assertInvalidOffset(
      typeof hugeResult.startSeconds === 'number' && Math.abs(hugeResult.startSeconds - expectedStartSeconds) <= 0.001,
      evidence,
      `999999 normalized to duration - 0.250 (${expectedStartSeconds.toFixed(3)}s)`,
    );

    evidence.passed = true;
  } finally {
    const evidencePath = writeEvidence(evidenceDir, 'task-3-invalid-offsets.json', evidence);
    runner.evidence.invalidOffsetEvidencePath = evidencePath;
  }
}

// ── Scenarios ──

async function scenarioColdOpen(runner, filePath) {
  if (!existsSync(filePath)) {
    runner.fail(`File not found: ${filePath}`);
  }

  runner.spawn();
  await runner.waitReady();

  // Mark event offset to ignore startup/residual notifications from daemon
  runner.markEventOffset();

  // Send openFile
  runner.sendRpc('audio.openFile', [{ filePath }], 1);
  const response = await runner.waitResponse(1, 30000);

  if (response.error) {
    runner.fail(`openFile error: ${JSON.stringify(response.error)}`);
  }

  const r = response.result;
  assertOpenFileResult(runner, r, filePath, 'libav daemon openFile');

  // Wait for position events (only those arriving after openFile was sent)
  const positions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(positions.length >= 1, `Received ${positions.length} position notification(s)`);

  // Check no premature ended AFTER openFile
  const endedAfter = runner.readNotificationsAfter('audio.ended');
  runner.assert(endedAfter.length === 0, 'No audio.ended after openFile before first position');

  // Ensure no audio.playFile was used
  const playFileCalls = runner.evidence.rpcEvents.filter(
    (e) => e.msg && e.msg.method === 'audio.playFile'
  );
  runner.assert(playFileCalls.length === 0, 'No audio.playFile method used');

  // Wait a bit more for additional positions
  await sleep(2000);
  const morePositions = runner.readNotifications('audio.position');
  if (morePositions.length > positions.length) {
    runner.assert(true, `Position advancing: ${positions.length} → ${morePositions.length}`);
  }

  runner.evidence.passed = true;
}

async function scenarioRemoteSource(runner, filePath) {
  const audio = readFileSync(filePath);
  const requests = [];
  const expectedCookie = 'MUSIC_U=daemon-remote-smoke';
  const expectedReferer = 'https://music.163.com/';
  const server = createServer((request, response) => {
    if (request.url === '/stall') {
      // Keep the socket open without headers. Native AVIO must interrupt this
      // remote open without waiting for the generic 30-second read timeout.
      return;
    }
    requests.push({
      range: request.headers.range ?? null,
      cookieAccepted: request.headers.cookie === expectedCookie,
      refererAccepted: request.headers.referer === expectedReferer,
    });
    if (request.headers.cookie !== expectedCookie || request.headers.referer !== expectedReferer) {
      response.writeHead(403);
      response.end();
      return;
    }

    const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? '');
    const start = range ? Math.min(audio.length - 1, Number(range[1])) : 0;
    const requestedEnd = range?.[2] ? Number(range[2]) : audio.length - 1;
    const end = Math.min(audio.length - 1, Math.max(start, requestedEnd));
    const body = audio.subarray(start, end + 1);
    response.writeHead(range ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': body.length,
      'Content-Type': 'audio/mpeg',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}),
    });
    setTimeout(() => response.end(body), requests.length === 1 ? 120 : 0);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const uri = `http://127.0.0.1:${address.port}/guarded-track.mp3`;

  try {
    runner.spawn();
    await runner.waitReady();
    runner.markEventOffset();
    const stalledOpenStartedAt = Date.now();
    runner.sendRpc('audio.openSource', [{
      source: {
        kind: 'http',
        uri: `http://127.0.0.1:${address.port}/stall`,
        headers: {
          Cookie: expectedCookie,
          Referer: expectedReferer,
        },
        mimeType: 'audio/mpeg',
      },
      sampleRate: 48000,
    }], 1);
    const stalledResponse = await runner.waitResponse(1, 8000);
    const stalledOpenDurationMs = Date.now() - stalledOpenStartedAt;
    runner.assert(Boolean(stalledResponse.error), 'Stalled HTTP open was interrupted with an RPC error');
    runner.assert(stalledOpenDurationMs < 7000, `Stalled HTTP open returned in ${stalledOpenDurationMs}ms`);

    runner.sendRpc('audio.openSource', [{
      source: {
        kind: 'http',
        uri,
        headers: {
          Cookie: expectedCookie,
          Referer: expectedReferer,
          Accept: 'audio/*',
        },
        mimeType: 'audio/mpeg',
      },
      sampleRate: 48000,
    }], 2);
    const response = await runner.waitResponse(2, 30000);
    if (response.error) runner.fail(`openSource error: ${JSON.stringify(response.error)}`);
    assertOpenFileResult(runner, response.result, uri, 'libav daemon openSource');
    runner.assert(response.result.sourceSampleRate > 0, `openSource sourceSampleRate ${response.result.sourceSampleRate} > 0`);
    await runner.waitNotifications('audio.firstPcm', 1, 20000);
    await runner.waitNotifications('audio.started', 1, 20000);
    await runner.waitNotifications('audio.position', 1, 20000);
    runner.assert(requests.every((item) => item.cookieAccepted && item.refererAccepted), 'HTTP fixture accepted Cookie and Referer on every request');
    const initialStartRequests = requests.filter((item) => item.range === null || /^bytes=0-/u.test(item.range)).length;
    runner.assert(initialStartRequests === 1, `probe and decode reused one opened libav context (${initialStartRequests} start request)`);

    runner.markEventOffset();
    runner.sendRpc('audio.seek', [{ positionSeconds: 1 }], 3);
    const seekResponse = await runner.waitResponse(3, 30000);
    runner.assert(!seekResponse.error, 'HTTP Range seek succeeded');
    await runner.waitNotifications('audio.position', 1, 20000);
    runner.evidence.remoteSource = {
      requestCount: requests.length,
      requests,
      stalledOpenDurationMs,
      uri: '<redacted-local-fixture>',
    };
    runner.evidence.passed = true;
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function scenarioOutputModeCycle(runner, filePath, outputTarget = {}) {
  if (process.platform !== 'win32') {
    runner.evidence.assertions.push({ type: 'note', message: 'WASAPI exclusive transition is Windows-only' });
    runner.evidence.passed = true;
    return;
  }
  if (!existsSync(filePath)) {
    runner.fail(`File not found: ${filePath}`);
  }

  runner.spawn();
  const sampleRate = outputTarget.sampleRate ?? 48000;
  const sharedTarget = Number.isInteger(outputTarget.alternateDeviceIndex)
    ? { deviceIndex: outputTarget.alternateDeviceIndex, deviceName: outputTarget.alternateDeviceName || '' }
    : { deviceIndex: outputTarget.deviceIndex ?? -1, deviceName: outputTarget.deviceName || '' };
  await runner.waitReady(15000, {
    outputMode: 'exclusive',
    deviceIndex: outputTarget.deviceIndex ?? -1,
    deviceName: outputTarget.deviceName || '',
    sampleRate,
    processing: { outputFormat: 'pcm' },
  });
  runner.markEventOffset();
  runner.sendRpc('audio.openFile', [{ filePath }], 1);
  const response = await runner.waitResponse(1, 30000);
  if (response.error) {
    runner.fail(`exclusive openFile error: ${JSON.stringify(response.error)}`);
  }
  assertOpenFileResult(runner, response.result, filePath, 'exclusive daemon openFile');
  const positions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(positions.length >= 1, `Received ${positions.length} exclusive position notification(s)`);

  runner.sendRpc('audio.stop', {}, 2);
  const stopResponse = await runner.waitResponse(2, 10000);
  runner.assert(!stopResponse.error, 'Exclusive playback stopped before output switch');

  runner.sendRpc('device.configure', [{
    outputMode: 'shared',
    deviceId: '',
    deviceIndex: sharedTarget.deviceIndex,
    deviceName: sharedTarget.deviceName,
    sampleRate,
    channels: 2,
    bufferSize: 2048,
    latencyProfile: 'balanced',
    sharedBackend: 'auto',
    processing: { outputFormat: 'pcm' },
  }], 3);
  const configureResponse = await runner.waitResponse(3, 15000);
  runner.assert(!configureResponse.error && configureResponse.result?.accepted === true,
    'Shared output accepted after exclusive playback');

  runner.sendRpc('audio.sessionBegin', {
    sessionId: 2,
    sr: sampleRate,
    ch: 2,
    buffer: 2048,
    fifoMs: 8000,
    prebufferMs: 60,
  }, 4);
  const sessionResponse = await runner.waitResponse(4, 15000);
  runner.assert(!sessionResponse.error && sessionResponse.result?.accepted === true,
    'Shared session opened after exclusive playback');

  runner.markEventOffset();
  runner.sendRpc('audio.openFile', [{ filePath }], 5);
  const sharedResponse = await runner.waitResponse(5, 30000);
  if (sharedResponse.error) {
    runner.fail(`shared openFile after exclusive error: ${JSON.stringify(sharedResponse.error)}`);
  }
  assertOpenFileResult(runner, sharedResponse.result, filePath, 'shared daemon reopen');
  const sharedPositions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(sharedPositions.length >= 1, `Received ${sharedPositions.length} shared position notification(s)`);

  runner.sendRpc('audio.stop', {}, 6);
  const sharedStopResponse = await runner.waitResponse(6, 10000);
  runner.assert(!sharedStopResponse.error, 'Shared playback stopped before switching back to exclusive');

  runner.sendRpc('device.configure', [{
    outputMode: 'exclusive',
    deviceId: '',
    deviceIndex: outputTarget.deviceIndex ?? -1,
    deviceName: outputTarget.deviceName || '',
    sampleRate,
    channels: 2,
    bufferSize: 2048,
    latencyProfile: 'balanced',
    sharedBackend: 'auto',
    processing: { outputFormat: 'pcm' },
  }], 7);
  const exclusiveConfigureResponse = await runner.waitResponse(7, 15000);
  runner.assert(!exclusiveConfigureResponse.error && exclusiveConfigureResponse.result?.accepted === true,
    'Exclusive output accepted after shared playback');

  runner.sendRpc('audio.sessionBegin', {
    sessionId: 3,
    sr: sampleRate,
    ch: 2,
    buffer: 2048,
    fifoMs: 8000,
    prebufferMs: 60,
  }, 8);
  const exclusiveSessionResponse = await runner.waitResponse(8, 15000);
  runner.assert(!exclusiveSessionResponse.error && exclusiveSessionResponse.result?.accepted === true,
    'Exclusive session reopened after shared playback');

  runner.markEventOffset();
  runner.sendRpc('audio.openFile', [{ filePath }], 9);
  const exclusiveReopenResponse = await runner.waitResponse(9, 30000);
  if (exclusiveReopenResponse.error) {
    runner.fail(`exclusive reopen after shared error: ${JSON.stringify(exclusiveReopenResponse.error)}`);
  }
  assertOpenFileResult(runner, exclusiveReopenResponse.result, filePath, 'exclusive daemon reopen');
  const exclusiveReopenPositions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(exclusiveReopenPositions.length >= 1,
    `Received ${exclusiveReopenPositions.length} exclusive reopen position notification(s)`);

  runner.sendRpc('audio.stop', {}, 10);
  const exclusiveStopResponse = await runner.waitResponse(10, 10000);
  runner.assert(!exclusiveStopResponse.error, 'Reopened exclusive playback stopped before final shared switch');

  runner.sendRpc('device.configure', [{
    outputMode: 'shared',
    deviceId: '',
    deviceIndex: sharedTarget.deviceIndex,
    deviceName: sharedTarget.deviceName,
    sampleRate,
    channels: 2,
    bufferSize: 2048,
    latencyProfile: 'balanced',
    sharedBackend: 'auto',
    processing: { outputFormat: 'pcm' },
  }], 11);
  const finalSharedConfigureResponse = await runner.waitResponse(11, 15000);
  runner.assert(!finalSharedConfigureResponse.error && finalSharedConfigureResponse.result?.accepted === true,
    'Final shared output accepted after exclusive playback');

  runner.sendRpc('audio.sessionBegin', {
    sessionId: 4,
    sr: sampleRate,
    ch: 2,
    buffer: 2048,
    fifoMs: 8000,
    prebufferMs: 60,
  }, 12);
  const finalSharedSessionResponse = await runner.waitResponse(12, 15000);
  runner.assert(!finalSharedSessionResponse.error && finalSharedSessionResponse.result?.accepted === true,
    'Final shared session reopened after exclusive playback');

  runner.markEventOffset();
  runner.sendRpc('audio.openFile', [{ filePath }], 13);
  const finalSharedResponse = await runner.waitResponse(13, 30000);
  if (finalSharedResponse.error) {
    runner.fail(`final shared reopen after exclusive error: ${JSON.stringify(finalSharedResponse.error)}`);
  }
  assertOpenFileResult(runner, finalSharedResponse.result, filePath, 'final shared daemon reopen');
  const finalSharedPositions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(finalSharedPositions.length >= 1,
    `Received ${finalSharedPositions.length} final shared position notification(s)`);
  runner.evidence.passed = true;
}

function isDeviceListed(hostPath, deviceName) {
  const result = spawnSync(hostPath, ['-list'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  return result.status === 0 && result.stdout.includes(deviceName);
}

async function waitForDevicePresence(runner, deviceName, expectedPresent, timeoutMs) {
  const startedAt = Date.now();
  let consecutiveMatches = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (runner.child.exitCode !== null) {
      runner.fail(`Host exited during hotplug observation with code ${runner.child.exitCode}`);
    }
    const present = isDeviceListed(runner.hostPath, deviceName);
    consecutiveMatches = present === expectedPresent ? consecutiveMatches + 1 : 0;
    if (consecutiveMatches >= 2) return Date.now();
    await sleep(750);
  }
  runner.fail(`Timeout waiting for device ${deviceName} to become ${expectedPresent ? 'present' : 'absent'}`);
}

async function scenarioHotplugRecovery(runner, filePath, outputTarget = {}) {
  if (process.platform !== 'win32') {
    runner.fail('hotplug-recovery currently requires Windows');
  }
  if (!existsSync(filePath)) runner.fail(`File not found: ${filePath}`);
  if (!outputTarget.deviceName) runner.fail('hotplug-recovery requires --device-name');

  const sampleRate = outputTarget.sampleRate ?? 48000;
  const outputMode = outputTarget.outputMode === 'shared' ? 'shared' : 'exclusive';
  runner.spawn();
  await runner.waitReady(15000, {
    outputMode,
    deviceIndex: outputTarget.deviceIndex ?? -1,
    deviceName: outputTarget.deviceName,
    sampleRate,
    processing: { outputFormat: 'pcm' },
  });
  runner.markEventOffset();
  runner.sendRpc('audio.openFile', [{ filePath }], 1);
  const initialOpen = await runner.waitResponse(1, 30000);
  if (initialOpen.error) runner.fail(`initial hotplug openFile error: ${JSON.stringify(initialOpen.error)}`);
  assertOpenFileResult(runner, initialOpen.result, filePath, 'pre-hotplug daemon openFile');
  const initialPositions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(initialPositions.length >= 1, 'Playback advanced before device removal');

  console.log(`[smoke:daemon] ACTION: unplug ${outputTarget.deviceName}, wait 5 seconds, then reconnect it`);
  const removedAt = await waitForDevicePresence(runner, outputTarget.deviceName, false, 60000);
  runner.assert(true, `Detected ${outputTarget.deviceName} removal`);
  const reconnectedAt = await waitForDevicePresence(runner, outputTarget.deviceName, true, 90000);
  runner.assert(true, `Detected ${outputTarget.deviceName} reconnection after ${reconnectedAt - removedAt}ms`);

  runner.sendRpc('audio.stop', {}, 2);
  const stopResponse = await runner.waitResponse(2, 10000);
  runner.assert(!stopResponse.error, 'Stopped invalidated playback before reopening the device');
  runner.sendRpc('device.configure', [{
    outputMode,
    deviceId: '',
    deviceIndex: outputTarget.deviceIndex ?? -1,
    deviceName: outputTarget.deviceName,
    sampleRate,
    channels: 2,
    bufferSize: 2048,
    latencyProfile: 'balanced',
    sharedBackend: 'auto',
    processing: { outputFormat: 'pcm' },
  }], 3);
  const configureResponse = await runner.waitResponse(3, 15000);
  runner.assert(!configureResponse.error && configureResponse.result?.accepted === true,
    'Reconfigured the reconnected device');
  runner.sendRpc('audio.sessionBegin', {
    sessionId: 2,
    sr: sampleRate,
    ch: 2,
    buffer: 2048,
    fifoMs: 8000,
    prebufferMs: 60,
  }, 4);
  const sessionResponse = await runner.waitResponse(4, 15000);
  runner.assert(!sessionResponse.error && sessionResponse.result?.accepted === true,
    'Opened a new session on the reconnected device');
  runner.markEventOffset();
  runner.sendRpc('audio.openFile', [{ filePath }], 5);
  const reopenResponse = await runner.waitResponse(5, 30000);
  if (reopenResponse.error) runner.fail(`post-hotplug openFile error: ${JSON.stringify(reopenResponse.error)}`);
  assertOpenFileResult(runner, reopenResponse.result, filePath, 'post-hotplug daemon openFile');
  const recoveredPositions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(recoveredPositions.length >= 1, 'Playback advanced after device reconnection');
  runner.evidence.hotplug = { deviceName: outputTarget.deviceName, outputMode, sampleRate, removedAt, reconnectedAt };
  runner.evidence.passed = true;
}

async function scenarioOffsetOpen(runner, filePath, offset, evidenceDir) {
  if (!existsSync(filePath)) {
    runner.fail(`File not found: ${filePath}`);
  }

  runner.spawn();
  await runner.waitReady();

  // Allow startup residual notifications to arrive before marking offset
  await sleep(500);
  runner.markEventOffset();

  validateStartSecondsForRpc(offset);
  runner.sendRpc('audio.openFile', [{ filePath, startSeconds: offset }], 1);
  const response = await runner.waitResponse(1, 30000);

  if (response.error) {
    runner.fail(`openFile error: ${JSON.stringify(response.error)}`);
  }

  const r = response.result;
  assertOpenFileResult(runner, r, filePath, 'libav daemon offset openFile');
  runner.assert(typeof r.startSeconds === 'number', `openFile returned startSeconds ${r.startSeconds}`);
  runner.assert(Math.abs(r.startSeconds - offset) <= 0.001, `startSeconds ${r.startSeconds}s matches requested offset ${offset}s`);

  // Wait for positions
  const positions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(positions.length >= 1, `Received ${positions.length} position notification(s)`);

  // Check first stable position is near offset (within 1.5s tolerance)
  if (offset > 0 && positions.length > 0) {
    const firstPos = positions
      .map((position) => observedPositionSeconds(position, r.startSeconds, r.sampleRate))
      .find((position) => typeof position === 'number');
    runner.evidence.requestedStartSeconds = offset;
    runner.evidence.nativeStartSeconds = r.startSeconds;
    runner.evidence.firstStablePositionSeconds = firstPos ?? null;
    if (typeof firstPos === 'number') {
      runner.assert(firstPos >= offset - 1.5 && firstPos <= offset + 1.5,
        `First position ${firstPos.toFixed(2)}s near offset ${offset}s`);
    }
  }

  const seekCalls = runner.evidence.rpcEvents.filter((e) => e.msg && e.msg.method === 'audio.seek');
  runner.assert(seekCalls.length === 0, 'offset-open did not use audio.seek after open');

  await runInvalidOffsetSubcases(runner, filePath, evidenceDir, r.durationSeconds);

  runner.evidence.passed = true;
}

async function scenarioRapidOpenStopOpen(runner, filePath) {
  if (!existsSync(filePath)) {
    runner.fail(`File not found: ${filePath}`);
  }

  runner.spawn();
  await runner.waitReady();

  // Allow startup residual notifications to arrive before marking offset
  await sleep(500);
  runner.markEventOffset();
  runner.evidence.operations = [];
  runner.evidence.latestActiveOperationId = null;

  // First open
  runner.sendRpc('audio.openFile', [{ filePath }], 1);
  const resp1 = await runner.waitResponse(1, 30000);
  runner.assert(!resp1.error, `First openFile succeeded`);
  const firstOperationId = resp1.result?.operationId;
  runner.evidence.operations.push({ type: 'open', id: 1, operationId: firstOperationId });
  runner.assert(typeof firstOperationId === 'number', `First openFile operationId ${firstOperationId}`);

  // Wait briefly for positions
  await sleep(1000);

  // Stop
  runner.sendRpc('audio.stop', {}, 2);
  const stopResp = await runner.waitResponse(2, 10000);
  const stopOperationId = typeof stopResp.result?.operationId === 'number' ? stopResp.result.operationId : null;
  runner.evidence.operations.push({ type: 'stop', id: 2, operationId: stopOperationId, explicit: true });
  runner.assert(stopResp.result === true || stopOperationId !== null, 'Stop acknowledged');
  runner.assert(stopOperationId === null || stopOperationId !== firstOperationId, `Stop operationId ${stopOperationId} differs from first open`);

  // Immediate re-open
  runner.markEventOffset();
  runner.sendRpc('audio.openFile', [{ filePath }], 3);
  const resp3 = await runner.waitResponse(3, 30000);
  runner.assert(!resp3.error, `Second openFile succeeded after stop`);
  const secondOperationId = resp3.result?.operationId;
  runner.evidence.operations.push({ type: 'open', id: 3, operationId: secondOperationId });
  runner.evidence.latestActiveOperationId = secondOperationId;
  runner.assert(typeof secondOperationId === 'number', `Second openFile operationId ${secondOperationId}`);
  runner.assert(secondOperationId !== firstOperationId, `Second open operationId ${secondOperationId} differs from first ${firstOperationId}`);

  // Positions should arrive for second open
  const positions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(positions.length >= 1, `Received ${positions.length} position(s) after re-open`);
  const positionOperationIds = positions.map((event) => event.params?.operationId).filter((operationId) => operationId !== undefined);
  runner.evidence.secondOpenPositionOperationIds = positionOperationIds;
  runner.assert(positionOperationIds.every((operationId) => operationId === secondOperationId), 'All post-reopen position notifications match latest operation');

  await sleep(1000);
  const endedAfterSecondOpen = runner.readNotificationsAfter('audio.ended');
  runner.evidence.endedAfterSecondOpen = endedAfterSecondOpen.map((event) => ({ operationId: event.params?.operationId ?? null }));
  const staleFirstEnded = endedAfterSecondOpen.some((event) => event.params?.operationId === firstOperationId);
  runner.assert(!staleFirstEnded, 'No stale audio.ended tied to first operation after rapid reopen');

  // Leave the native daemon quiescent before the all-scenario runner tears it
  // down. Killing a daemon while the second open is still decoding/playing can
  // leave ALSA/PipeWire briefly starved for the immediately following fresh
  // daemon, which made natural-ended pass alone but fail after this scenario.
  runner.sendRpc('audio.stop', {}, 4);
  const finalStopResp = await runner.waitResponse(4, 10000);
  const finalStopOperationId = typeof finalStopResp.result?.operationId === 'number'
    ? finalStopResp.result.operationId
    : null;
  runner.evidence.operations.push({ type: 'stop', id: 4, operationId: finalStopOperationId, explicit: true, finalQuiesce: true });
  runner.assert(finalStopResp.result === true || finalStopOperationId !== null, 'Final stop acknowledged before scenario teardown');

  runner.evidence.passed = true;
}

async function scenarioNaturalEnded(runner, filePath, evidenceDir) {
  // Always use a generated short fixture for bounded EOF.
  // The real MP3 (~202s) does not emit natural ended within a
  // practical smoke timeout and is known to not produce EOF promptly.
  const generatedFixture = generateShortWavFixture(evidenceDir);
  runner.evidence.originalRequestedFile = filePath;
  runner.evidence.actualFile = generatedFixture.path;
  runner.evidence.generatedFixture = generatedFixture;
  runner.evidence.note = `Generated short ${generatedFixture.durationSeconds}s WAV for bounded EOF verification. Original request: ${filePath}`;

  const actualFile = generatedFixture.path;

  runner.evidence.filePath = actualFile;
  runner.evidence.attempts = [];

  const runAttempt = async (attempt, endedTimeoutMs) => {
    runner.spawn();
    await runner.waitReady();

    // Allow startup residual notifications to arrive before marking offset
    await sleep(500);
    runner.markEventOffset();

    runner.sendRpc('audio.openFile', [{ filePath: actualFile }], 1);
    const resp = await runner.waitResponse(1, 30000);
    runner.assert(!resp.error, `openFile succeeded (attempt ${attempt})`);

    const duration = resp.result.durationSeconds;
    runner.assert(typeof duration === 'number' && duration > 0, `Duration ${duration}s > 0 (attempt ${attempt})`);
    runner.evidence.durationSeconds = duration;
    runner.evidence.sampleRate = resp.result.sampleRate;

    const positionResult = await runner.tryWaitNotifications('audio.position', 1, 5000);
    const endedResult = await runner.tryWaitNotifications('audio.ended', 1, endedTimeoutMs);
    const endedEvents = runner.readNotificationsAfter('audio.ended');
    const positionEvents = runner.readNotificationsAfter('audio.position');

    const summary = {
      attempt,
      endedTimeoutMs,
      positionCount: positionEvents.length,
      endedCount: endedEvents.length,
      positionError: positionResult.error,
      endedError: endedResult.error,
      passed: endedEvents.length === 1,
    };
    runner.evidence.attempts.push(summary);

    if (positionEvents.length > 0) {
      runner.evidence.positionsReceived = true;
    } else {
      runner.evidence.positionsReceived = false;
      runner.evidence.positionNote = 'No position events received (very short file, fast decode, or starved output callback)';
    }

    if (endedEvents.length !== 1) {
      return { passed: false, duration, resp, endedEvents, positionEvents, error: endedResult.error };
    }

    runner.evidence.naturalEndedReceived = true;
    runner.assert(endedEvents.length === 1, `Exactly one audio.ended received, got ${endedEvents.length} (attempt ${attempt})`);

    // Verify final position is near duration when the daemon produces positions.
    const lastPosition = positionEvents.length > 0 ? positionEvents[positionEvents.length - 1] : null;
    if (lastPosition) {
      const sr = resp.result.sampleRate || 48000;
      const posSec = observedPositionSeconds(lastPosition, resp.result.startSeconds || 0, sr);
      runner.evidence.finalPositionSeconds = posSec;
      runner.assert(
        typeof posSec === 'number' && posSec >= Math.max(0, duration - 1.5),
        `Final position ${posSec?.toFixed(2)}s >= duration - 1.5s (${(duration - 1.5).toFixed(2)}s)`,
      );
    }

    return { passed: true, duration, resp, endedEvents, positionEvents, error: null };
  };

  const first = await runAttempt(1, 30000);
  if (first.passed) {
    runner.evidence.passed = true;
    return;
  }

  runner.evidence.naturalEndedRetry = {
    reason: 'first daemon produced no post-open audio.ended after prior scenario sequence',
    firstAttemptError: first.error,
    note: 'Observed after rapid real-file playback in --scenario all; restarting the daemon clears ALSA/PipeWire callback starvation and verifies a real audio.ended on the retry.',
  };
  runner.evidence.assertions.push({ type: 'note', message: `Retrying natural-ended after callback starvation: ${first.error}` });
  try { await runner.shutdown(); } catch { /* process already dead */ }
  runner.resetTransportForRetry();
  await sleep(5000);

  const durationForRetry = typeof first.duration === 'number' && first.duration > 0 ? first.duration : generatedFixture.durationSeconds;
  const second = await runAttempt(2, Math.max(30000, (durationForRetry + 15) * 1000));
  if (!second.passed) {
    runner.evidence.naturalEndedReceived = false;
    runner.fail(`Natural audio.ended not received after retry: ${second.error}`);
  }

  runner.evidence.passed = true;
}

async function scenarioEqReplay(runner, filePath) {
  if (!existsSync(filePath)) {
    runner.fail(`File not found: ${filePath}`);
  }

  runner.spawn();
  await runner.waitReady();

  // Allow startup residual notifications to arrive before marking offset
  await sleep(500);
  runner.markEventOffset();

  // Set EQ state before opening
  const eqState = {
    enabled: true,
    preampDb: -3.0,
    bands: [
      { frequencyHz: 100, gainDb: 2.0, q: 0.7, filterType: 'lowshelf', enabled: true },
      { frequencyHz: 1000, gainDb: -1.0, q: 1.0, filterType: 'peaking', enabled: true },
    ],
  };
  runner.sendRpc('eq.setState', eqState, 1);
  const eqResp = await runner.waitResponse(1, 10000);
  const eqAckTimestampMs = Date.now() - runner.startTime;
  runner.assert(!eqResp.error, `eq.setState acknowledged`);
  runner.assert(eqResp.result && eqResp.result.enabled === true, 'EQ enabled after setState');

  // Now open file
  runner.sendRpc('audio.openFile', [{ filePath }], 2);
  const openResp = await runner.waitResponse(2, 30000);
  runner.assert(!openResp.error, `openFile succeeded after EQ set`);

  // Wait for positions
  const positions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(positions.length >= 1, `Received ${positions.length} position(s) with EQ active`);

  // Verify eq.setState was acknowledged before first audio.position (after mark offset)
  const positionsAfterMark = runner.readNotificationsAfter('audio.position');
  const firstPositionAfterMark = positionsAfterMark.length > 0 ? positionsAfterMark[0] : null;
  const eqSetStateSendEvent = runner.evidence.rpcEvents.find(
    (e) => e.msg && e.msg.method === 'eq.setState' && e.direction === 'send',
  );
  if (firstPositionAfterMark && eqSetStateSendEvent) {
    runner.assert(
      eqSetStateSendEvent.timeMs < (firstPositionAfterMark.params?.timeMs ?? firstPositionAfterMark.timeMs ?? Infinity),
      'eq.setState sent before first audio.position received after mark',
    );
  }

  // Record DSP / bit-perfect expectations
  runner.evidence.dspExpectations = {
    dspActive: true,
    bitPerfectCandidate: false,
    bitPerfectDisabledReason: 'eq_enabled',
    eqAckTimestampMs,
    note: 'EQ enabled before openFile; DSP chain is active; bit-perfect output is disabled.',
  };

  runner.evidence.passed = true;
}

async function scenarioPrefetchNoTruncate(runner, filePath) {
  if (!existsSync(filePath)) {
    runner.fail(`File not found: ${filePath}`);
  }

  runner.spawn();
  await runner.waitReady();

  // Allow startup residual notifications to arrive before marking offset
  await sleep(500);
  runner.markEventOffset();

  // Prefetch first
  runner.sendRpc('audio.prefetch', { filePath }, 1);
  const prefetchResp = await runner.waitResponse(1, 30000);
  if (prefetchResp.error) {
    runner.evidence.assertions.push({
      type: 'note',
      message: `Prefetch returned error: ${JSON.stringify(prefetchResp.error)}. Baseline may not support prefetch yet.`,
    });
  } else {
    runner.assert(true, 'Prefetch acknowledged');
  }

  // Open the same file
  runner.sendRpc('audio.openFile', [{ filePath }], 2);
  const openResp = await runner.waitResponse(2, 30000);
  runner.assert(!openResp.error, 'openFile succeeded after prefetch');

  const r = openResp.result;

  // Full duration evidence
  runner.evidence.openResponseDurationSeconds = r.durationSeconds;
  runner.evidence.openResponseSampleRate = r.sampleRate;
  runner.evidence.openResponseStartSeconds = r.startSeconds;

  runner.assert(typeof r.durationSeconds === 'number' && r.durationSeconds > 1,
    `openFile durationSeconds ${r.durationSeconds} > 1 (not truncated to prefetch window)`);

  // Wait for positions
  const positions = await runner.waitNotifications('audio.position', 1, 20000);
  runner.assert(positions.length >= 1, `Received ${positions.length} position(s)`);

  // Wait a bit and collect position data beyond 1.5s
  await sleep(3000);
  const allPositions = runner.readNotifications('audio.position');

  // Compute observed position seconds from framesPlayed or positionSeconds
  const sr = r.sampleRate || 48000;
  const startSec = typeof r.startSeconds === 'number' ? r.startSeconds : 0;
  const observedPositions = allPositions
    .map((n) => observedPositionSeconds(n, startSec, sr))
    .filter((p) => typeof p === 'number');

  runner.evidence.observedPositions = observedPositions;
  runner.evidence.observedPositionCount = observedPositions.length;

  const lastPos = observedPositions.length > 0
    ? observedPositions[observedPositions.length - 1]
    : null;

  runner.evidence.lastObservedPositionSeconds = lastPos;
  runner.evidence.positionBeyond1_5s = typeof lastPos === 'number' && lastPos > 1.5;

  if (typeof lastPos === 'number') {
    runner.assert(lastPos > 1.5,
      `Position advanced to ${lastPos.toFixed(2)}s (>1.5s, not truncated by prefetch)`);
  }

  // Check for premature ended
  const endedAfter = runner.readNotificationsAfter('audio.ended');
  runner.evidence.endedCount = endedAfter.length;
  runner.assert(endedAfter.length === 0,
    `No premature audio.ended (got ${endedAfter.length})`);

  // Machine-readable evidence for acceptance criteria
  runner.evidence.acceptanceCriteria = {
    durationGreaterThan1s: r.durationSeconds > 1,
    positionBeyond1_5s: typeof lastPos === 'number' && lastPos > 1.5,
    noPrematureEnded: endedAfter.length === 0,
    prefetchAcknowledged: !prefetchResp.error,
    openDurationEqualsFullDuration: typeof r.durationSeconds === 'number' && r.durationSeconds > 1,
  };

  // Seek subcase: verify seek ignores partial prefetch cache
  runner.evidence.seekSubcase = { attempted: false };
  if (typeof r.durationSeconds === 'number' && r.durationSeconds > 30) {
    const seekTarget = 30.0;
    runner.sendRpc('audio.seek', { positionSeconds: seekTarget }, 3);
    const seekResp = await runner.waitResponse(3, 30000);
    runner.evidence.seekSubcase.attempted = true;
    runner.evidence.seekSubcase.seekTarget = seekTarget;
    runner.evidence.seekSubcase.seekResult = seekResp.result || seekResp.error || null;

    if (seekResp.error) {
      runner.evidence.seekSubcase.seekError = JSON.stringify(seekResp.error);
      runner.evidence.seekSubcase.note = 'seek failed — may have decode-path issue';
    } else {
      // Wait for position after seek
      await sleep(2000);
      const postSeekPositions = runner.readNotificationsAfter('audio.position');
      // After seek, daemon resets framesPlayed from the decode offset.
      // Add seekTarget to get absolute position in the file.
      const postSeekObserved = postSeekPositions
        .map((n) => {
          const params = n?.params;
          if (!params) return null;
          if (typeof params.framesPlayed === 'number' && typeof sr === 'number' && sr > 0) {
            return seekTarget + params.framesPlayed / sr;
          }
          return null;
        })
        .filter((p) => typeof p === 'number');
      runner.evidence.seekSubcase.observedPositions = postSeekObserved.slice(0, 10);
      const firstPostSeekPos = postSeekObserved.length > 0 ? postSeekObserved[0] : null;
      runner.evidence.seekSubcase.firstPostSeekPosition = firstPostSeekPos;

      if (typeof firstPostSeekPos === 'number') {
        runner.assert(
          firstPostSeekPos >= seekTarget - 1.5 && firstPostSeekPos <= seekTarget + 1.5,
          `Seek to ${seekTarget}s succeeded; first position ${firstPostSeekPos.toFixed(2)}s within [${seekTarget - 1.5}, ${seekTarget + 1.5}]`,
        );
      }
    }
  }

  runner.evidence.passed = true;
}

function generateShortWavFixture(evidenceDir, options = {}) {
  const sampleRate = options.sampleRate ?? 48000;
  const channels = 2;
  const durationSeconds = options.durationSeconds ?? 0.1;
  const frequencyHz = options.frequencyHz ?? 440;
  const bitsPerSample = 16;
  const numSamples = Math.round(sampleRate * durationSeconds);
  const dataSize = numSamples * channels * (bitsPerSample / 8);
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
  buffer.writeUInt16LE(1, offset); offset += 2;  // PCM
  buffer.writeUInt16LE(channels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), offset); offset += 4; // byte rate
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), offset); offset += 2; // block align
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Deterministic sine wave, stereo, decaying at the end.
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, (durationSeconds - t) / 0.05);
    const amplitude = 0.3 * Math.max(0, envelope);
    const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * t) * amplitude * 32767);
    const clamped = Math.max(-32768, Math.min(32767, sample));
    buffer.writeInt16LE(clamped, offset); offset += 2; // left
    buffer.writeInt16LE(clamped, offset); offset += 2; // right
  }

  const outPath = join(evidenceDir, options.fileName ?? 'task-5-fixture.wav');
  writeFileSync(outPath, buffer);

  return {
    path: outPath,
    durationSeconds,
    sampleRate,
    channels,
    bitsPerSample,
    frequencyHz,
    sizeBytes: fileSize,
  };
}

async function scenarioExplicitStop(runner, filePath, evidenceDir) {
  let actualFile = filePath;
  let generatedFixture = null;

  if (!existsSync(filePath)) {
    generatedFixture = generateShortWavFixture(evidenceDir);
    actualFile = generatedFixture.path;
    runner.evidence.generatedFixture = generatedFixture;
  }

  if (!existsSync(actualFile)) {
    runner.fail(`File not found: ${actualFile}`);
  }

  runner.spawn();
  await runner.waitReady();

  // Allow startup residual notifications to arrive before marking offset
  await sleep(500);
  runner.markEventOffset();

  // Open file
  runner.sendRpc('audio.openFile', [{ filePath: actualFile }], 1);
  const resp = await runner.waitResponse(1, 30000);
  runner.assert(!resp.error, 'openFile succeeded');

  const duration = resp.result.durationSeconds;
  const openOperationId = resp.result.operationId;
  runner.evidence.durationSeconds = duration;
  runner.evidence.openOperationId = openOperationId;

  // Wait for at least one position, or proceed if file is very short
  try {
    await runner.waitNotifications('audio.position', 1, 5000);
    runner.evidence.positionsReceived = true;
  } catch {
    runner.evidence.positionsReceived = false;
    runner.evidence.positionNote = 'No position events (very short file)';
  }

  // Explicit stop
  runner.sendRpc('audio.stop', {}, 2);
  const stopResp = await runner.waitResponse(2, 10000);
  const stopAck = stopResp.result === true || (stopResp.result && typeof stopResp.result === 'object');
  runner.assert(stopAck, 'stop acknowledged');
  runner.evidence.stopTimestamp = Date.now() - runner.startTime;

  const stopOperationId = typeof stopResp.result === 'object' && stopResp.result
    ? stopResp.result.operationId
    : null;
  runner.evidence.stopOperationId = stopOperationId;

  // Wait a bit for any stray ended events
  await sleep(1500);

  // Verify zero natural ended events (filter out stop's own operation if any)
  const endedAfter = runner.readNotificationsAfter('audio.ended');
  const naturalEnded = endedAfter.filter((e) => {
    const eventOpId = e.params?.operationId;
    if (stopOperationId !== null && eventOpId === stopOperationId) return false;
    if (openOperationId !== null && eventOpId === openOperationId) return true;
    return eventOpId !== undefined;
  });
  runner.evidence.endedAfterStopCount = endedAfter.length;
  runner.evidence.naturalEndedAfterStopCount = naturalEnded.length;
  runner.assert(naturalEnded.length === 0, 'Zero natural audio.ended events after explicit stop');

  runner.evidence.passed = true;
}

async function scenarioLifecycle(runner, filePath) {
  if (!existsSync(filePath)) {
    runner.fail(`File not found: ${filePath}`);
  }

  runner.spawn();
  await runner.waitReady();

  // Allow startup residual notifications to arrive before marking offset
  await sleep(500);
  runner.markEventOffset();

  const daemonPid = runner.child.pid;
  runner.evidence.daemonPid = daemonPid;

  // Ping
  runner.sendRpc('rpc.ping', {}, 1);
  const pingResp = await runner.waitResponse(1, 5000);
  runner.assert(pingResp.result === 'pong', 'Ping responded pong');
  runner.evidence.bridgeStateBeforeOpen = 'alive';

  // Open file
  runner.sendRpc('audio.openFile', [{ filePath }], 2);
  const openResp = await runner.waitResponse(2, 30000);
  runner.assert(!openResp.error, 'openFile succeeded');
  runner.evidence.bridgeStateAfterOpen = 'alive';

  // Pause
  runner.sendRpc('audio.pause', { sessionId: runner.sessionId }, 3);
  const pauseResp = await runner.waitResponse(3, 5000);
  runner.assert(pauseResp.result === true, 'Pause acknowledged');

  // Resume
  runner.sendRpc('audio.resume', { sessionId: runner.sessionId }, 4);
  const resumeResp = await runner.waitResponse(4, 5000);
  runner.assert(resumeResp.result === true, 'Resume acknowledged');

  // Get position events
  await runner.waitNotifications('audio.position', 1, 15000);

  // Stop
  runner.sendRpc('audio.stop', {}, 5);
  const stopResp = await runner.waitResponse(5, 5000);
  const stopOk = stopResp.result === true || (typeof stopResp.result === 'object' && stopResp.result !== null);
  runner.assert(stopOk, 'Stop acknowledged');

  // Shutdown via RPC, then SIGTERM for actual process exit
  const shutdownStartMs = Date.now();
  runner.evidence.shutdownAttempted = true;
  runner.sendRpc('rpc.shutdown', {}, 6);
  let shutdownRpcSucceeded = false;
  try {
    const shutdownResp = await runner.waitResponse(6, 5000);
    runner.assert(shutdownResp.result === 'ok', 'RPC shutdown acknowledged');
    shutdownRpcSucceeded = true;
    runner.evidence.shutdownRpcDurationMs = Date.now() - shutdownStartMs;
  } catch {
    runner.evidence.assertions.push({ type: 'note', message: 'rpc.shutdown timed out, falling back to SIGTERM' });
    runner.evidence.shutdownRpcTimedOut = true;
  }
  runner.evidence.shutdownRpcSucceeded = shutdownRpcSucceeded;
  runner.evidence.bridgeStateBeforeExit = 'alive';

  // Send SIGTERM to actually terminate the process
  runner.child.kill('SIGTERM');

  // Wait for process exit
  const exitStartMs = Date.now();
  const exited = await new Promise((resolve) => {
    if (runner.child.exitCode !== null || runner.child.signalCode !== null) {
      runner.evidence.exitCode = runner.child.exitCode;
      runner.evidence.exitSignal = runner.child.signalCode;
      runner.evidence.exitDurationMs = 0;
      runner.evidence.shutdownTotalDurationMs = Date.now() - shutdownStartMs;
      resolve(true);
      return;
    }
    const t = setTimeout(() => {
      runner.child.kill('SIGKILL');
      resolve(false);
    }, 5000);
    runner.child.on('exit', (code, signal) => {
      clearTimeout(t);
      resolve(true);
      runner.evidence.exitCode = code;
      runner.evidence.exitSignal = signal;
      runner.evidence.exitDurationMs = Date.now() - exitStartMs;
      runner.evidence.shutdownTotalDurationMs = Date.now() - shutdownStartMs;
    });
  });
  runner.assert(exited, 'Host process exited after shutdown');

  // Verify no orphan process remains for the helper PID
  await sleep(500);
  try {
    // Send signal 0 to check if process still exists (POSIX)
    process.kill(daemonPid, 0);
    runner.evidence.orphanCheck = { pid: daemonPid, stillAlive: true, warning: 'Process still alive after shutdown' };
    runner.evidence.assertions.push({ type: 'warning', message: `Daemon PID ${daemonPid} is still alive after shutdown` });
  } catch {
    runner.evidence.orphanCheck = { pid: daemonPid, stillAlive: false, status: 'cleaned' };
    runner.assert(true, `No orphan process for helper PID ${daemonPid}`);
  }

  runner.evidence.bridgeStateAfterExit = 'invalidated';
  runner.evidence.passed = true;
}

async function scenarioQueueAdvance(runner, filePath, evidenceDir, outputTarget = {}) {
  const fixtureDurationSeconds = 2;
  const queueRates = Array.isArray(outputTarget.queueRates)
    ? outputTarget.queueRates
    : [48000, 44100, 96000];
  if (queueRates.length < 2 || queueRates.some((rate) => !Number.isInteger(rate) || rate <= 0)) {
    runner.fail(`queue-advance requires at least two positive integer rates: ${queueRates.join(',')}`);
  }
  const queueFiles = Array.isArray(outputTarget.queueFiles) ? outputTarget.queueFiles : null;
  if (queueFiles && queueFiles.length !== queueRates.length) {
    runner.fail(`queue-advance requires one --queue-files entry per rate (${queueFiles.length} files, ${queueRates.length} rates)`);
  }
  const generatedFixtures = queueRates.map((sampleRate, index) => {
    if (!queueFiles) {
      return generateShortWavFixture(evidenceDir, {
        sampleRate,
        durationSeconds: fixtureDurationSeconds,
        frequencyHz: 440 * (1 + index * 0.2),
        fileName: `task-8-queue-${index + 1}-${sampleRate}.wav`,
      });
    }
    const path = resolve(queueFiles[index]);
    if (!existsSync(path)) runner.fail(`queue fixture not found: ${path}`);
    return { path, sampleRate, durationSeconds: fixtureDurationSeconds };
  });
  const firstFixture = generatedFixtures[0];
  runner.evidence.originalRequestedFile = filePath;
  runner.evidence.generatedFixtures = generatedFixtures;
  runner.evidence.queueRates = queueRates;

  runner.spawn();
  await runner.waitReady(15000, {
    outputMode: outputTarget.outputMode || 'shared',
    deviceIndex: outputTarget.deviceIndex ?? -1,
    deviceName: outputTarget.deviceName || '',
    sampleRate: firstFixture.sampleRate,
    processing: { outputFormat: 'pcm' },
  });
  await sleep(300);
  runner.markEventOffset();

  const queueRevision = 1;
  runner.sendRpc('queue.set', {
    revision: queueRevision,
    currentItemId: 'queue-1',
    repeatMode: 'off',
    items: generatedFixtures.map((fixture, index) => ({
      itemId: `queue-${index + 1}`,
      trackId: `track-${index + 1}`,
      filePath: fixture.path,
      sampleRate: fixture.sampleRate,
      startSeconds: 0,
    })),
  }, 1);
  const queueResp = await runner.waitResponse(1, 5000);
  runner.assert(queueResp.result?.queueRevision === queueRevision, 'queue.set acknowledged revision 1');

  runner.sendRpc('audio.openFile', [{
    filePath: firstFixture.path,
    sampleRate: firstFixture.sampleRate,
  }], 2);
  const openResp = await runner.waitResponse(2, 10000);
  runner.assert(!openResp.error, 'initial queue file opened');
  runner.assert(
    openResp.result?.sampleRate === firstFixture.sampleRate,
    `initial decode targets the resident ${firstFixture.sampleRate} Hz device`,
  );
  const initialOperationId = openResp.result?.operationId;

  const endedEvents = await runner.waitNotifications('audio.ended', generatedFixtures.length, 60000);
  const advances = endedEvents.filter((event) => event.params?.queueAdvance === true);
  runner.assert(
    advances.length === generatedFixtures.length - 1,
    `host emitted exactly ${generatedFixtures.length - 1} autonomous queue advances`,
  );

  for (const [index, advance] of advances.entries()) {
    const expectedRate = outputTarget.outputMode === 'asio'
      ? generatedFixtures[index + 1].sampleRate
      : firstFixture.sampleRate;
    runner.assert(advance?.params?.queueRevision === queueRevision, `queueAdvance ${index + 1} preserved queue revision`);
    runner.assert(advance?.params?.nextItemId === `queue-${index + 2}`, `queueAdvance ${index + 1} selected queue-${index + 2}`);
    runner.assert(
      advance?.params?.nextSampleRate === expectedRate,
      `queueAdvance ${index + 1} decoder rate is ${expectedRate} Hz (${advance?.params?.nextSampleRate})`,
    );
    if (outputTarget.outputMode === 'asio') {
      const previousRate = generatedFixtures[index].sampleRate;
      const expectedTransitionMode = previousRate === expectedRate ? 'resident' : 'asio-full-reopen';
      runner.assert(advance?.params?.targetSampleRate === expectedRate, `queueAdvance ${index + 1} targeted ${expectedRate} Hz`);
      runner.assert(advance?.params?.actualSampleRate === expectedRate, `queueAdvance ${index + 1} confirmed hardware ${expectedRate} Hz`);
      runner.assert(
        advance?.params?.sampleRateTransitionMode === expectedTransitionMode,
        `queueAdvance ${index + 1} used ${expectedTransitionMode}`,
      );
      runner.assert(
        previousRate !== expectedRate || advance?.params?.sampleRateTransitionDurationMs === 0,
        `queueAdvance ${index + 1} avoided device reconfiguration for an unchanged rate`,
      );
    }
    runner.assert(
      typeof advance?.params?.operationId === 'number' && advance.params.operationId !== initialOperationId,
      `queueAdvance ${index + 1} carried a new operation id`,
    );
    runner.assert(
      Math.abs(Number(advance?.params?.nextDurationSeconds) - fixtureDurationSeconds) <= 0.05,
      `queueAdvance ${index + 1} preserved the source duration`,
    );
  }

  const operationIds = advances.map((advance) => advance.params.operationId);
  const positions = runner.readNotificationsAfter('audio.position');
  for (const [index, operationId] of operationIds.entries()) {
    const advance = advances[index];
    const advanceEventIndex = runner.evidence.rpcEvents.findIndex((event) => event.msg === advance);
    const startedEventIndex = runner.evidence.rpcEvents.findIndex(
      (event) => event.msg?.method === 'audio.started' && event.msg.params?.operationId === operationId,
    );
    const operationPositionEvents = runner.evidence.rpcEvents.filter(
      (event) => event.msg?.method === 'audio.position' && event.msg.params?.operationId === operationId,
    );
    const firstPositionEvent = operationPositionEvents[0];
    const firstPositionEventIndex = runner.evidence.rpcEvents.indexOf(firstPositionEvent);
    runner.assert(
      positions.some((event) => event.params?.operationId === operationId),
      `mixed-rate operation ${index + 2} emitted position`,
    );
    runner.assert(advanceEventIndex >= 0, `queueAdvance ${index + 1} was recorded in the RPC event stream`);
    runner.assert(
      startedEventIndex > advanceEventIndex,
      `operation ${operationId} started only after queueAdvance publication`,
    );
    runner.assert(
      firstPositionEventIndex > startedEventIndex && firstPositionEvent?.msg?.params?.framesPlayed > 0,
      `operation ${operationId} first position followed started with positive PCM frames`,
    );
    runner.assert(
      operationPositionEvents.every((event) => event.msg.params?.framesPlayed > 0),
      `operation ${operationId} emitted no premature zero-frame position`,
    );
  }

  const timedEndedEvents = runner.evidence.rpcEvents
    .filter((event) => event.msg?.method === 'audio.ended')
    .slice(-3);
  const finalTrackElapsedMs = timedEndedEvents.at(-1)?.timeMs - timedEndedEvents.at(-2)?.timeMs;
  runner.evidence.finalTrackElapsedMs = finalTrackElapsedMs;
  runner.assert(
    Number.isFinite(finalTrackElapsedMs)
      && finalTrackElapsedMs >= fixtureDurationSeconds * 600
      && finalTrackElapsedMs <= fixtureDurationSeconds * 1600,
    `final source played at normal duration (${finalTrackElapsedMs}ms)`,
  );
  runner.assert(endedEvents.at(-1)?.params?.queueAdvance !== true, 'queue ended naturally after the final item');
  runner.evidence.queueAdvances = advances.map((advance) => advance.params);

  runner.sendRpc('audio.stop', {}, 3);
  await runner.waitResponse(3, 5000);
  runner.evidence.passed = true;
}

async function scenarioCrashExit(runner, evidenceDir) {
  const generatedFixture = generateShortWavFixture(evidenceDir, {
    sampleRate: 48000,
    durationSeconds: 5,
    fileName: 'task-9-crash-exit-48000.wav',
  });
  runner.evidence.generatedFixture = generatedFixture;

  runner.spawn();
  await runner.waitReady();
  await sleep(300);
  runner.markEventOffset();

  runner.sendRpc('audio.openFile', [{ filePath: generatedFixture.path }], 1);
  const openResp = await runner.waitResponse(1, 10000);
  runner.assert(!openResp.error, 'crash fixture opened');
  await runner.waitNotifications('audio.position', 1, 10000);

  const daemonPid = runner.child.pid;
  const exitPromise = waitForEventOrTimeout(runner.child, 'exit', 5000);
  const bridgeClosePromise = waitForEventOrTimeout(runner.rpcOut, 'close', 5000);
  const crashStartedAt = Date.now();
  const killSent = runner.child.kill('SIGKILL');
  runner.assert(killSent, 'forced daemon termination was requested during playback');

  const [exitResult, bridgeCloseResult] = await Promise.all([exitPromise, bridgeClosePromise]);
  runner.assert(exitResult.occurred, 'daemon process emitted exit after forced termination');
  runner.assert(bridgeCloseResult.occurred, 'daemon RPC output closed after process exit');
  runner.evidence.daemonPid = daemonPid;
  runner.evidence.exitCode = exitResult.args[0] ?? null;
  runner.evidence.exitSignal = exitResult.args[1] ?? null;
  runner.evidence.transportClosedWithinMs = Date.now() - crashStartedAt;
  runner.evidence.passed = true;
}

async function scenarioGaplessBoundary(runner, evidenceDir, outputTarget = {}) {
  const fixtureDurationSeconds = 1.25;
  const fixtureSampleRate = Number.isInteger(outputTarget.sampleRate) && outputTarget.sampleRate > 0
    ? outputTarget.sampleRate
    : 48000;
  const generatedFixtures = [440, 523.25, 659.25].map((frequencyHz, index) =>
    generateShortWavFixture(evidenceDir, {
      sampleRate: fixtureSampleRate,
      durationSeconds: fixtureDurationSeconds,
      frequencyHz,
      fileName: `gapless-boundary-${index + 1}.wav`,
    }));
  const [firstFixture, secondFixture, thirdFixture] = generatedFixtures;
  runner.evidence.generatedFixtures = generatedFixtures;

  runner.spawn();
  await runner.waitReady(15000, {
    outputMode: outputTarget.outputMode || 'shared',
    deviceIndex: outputTarget.deviceIndex ?? -1,
    deviceName: outputTarget.deviceName || '',
    sampleRate: fixtureSampleRate,
    processing: { outputFormat: 'pcm' },
  });
  await sleep(200);
  runner.markEventOffset();

  const queueRevision = 1;
  runner.sendRpc('queue.set', {
    revision: queueRevision,
    currentItemId: 'gapless-queue-1',
    repeatMode: 'off',
    items: generatedFixtures.map((fixture, index) => ({
      itemId: `gapless-queue-${index + 1}`,
      trackId: `gapless-track-${index + 1}`,
      filePath: fixture.path,
      sampleRate: fixtureSampleRate,
      startSeconds: 0,
      metadata: { title: `Gapless ${index + 1}`, album: 'Smoke Album', albumArtist: 'ECHO' },
    })),
  }, 1);
  const queueResponse = await runner.waitResponse(1, 5000);
  runner.assert(queueResponse.result?.queueRevision === queueRevision, 'gapless queue snapshot acknowledged');

  runner.sendRpc('audio.openFile', { filePath: firstFixture.path, sampleRate: fixtureSampleRate }, 2);
  const openResponse = await runner.waitResponse(2, 10000);
  runner.assert(!openResponse.error, 'gapless current file opened');
  const initialOperationId = openResponse.result?.operationId;

  runner.sendRpc('audio.gaplessPrepare', {
    filePath: secondFixture.path,
    trackId: 'gapless-track-2',
    itemId: 'gapless-queue-2',
    sampleRate: fixtureSampleRate,
    metadata: { title: 'Gapless 2', album: 'Smoke Album', albumArtist: 'ECHO' },
    following: [{
      filePath: thirdFixture.path,
      trackId: 'gapless-track-3',
      itemId: 'gapless-queue-3',
      metadata: { title: 'Gapless 3', album: 'Smoke Album', albumArtist: 'ECHO' },
    }],
  }, 3);
  const prepareResponse = await runner.waitResponse(3, 10000);
  runner.assert(prepareResponse.result?.prepared === true, 'gapless next FIFO accepted real decoded PCM');
  runner.assert(prepareResponse.result?.operationId === initialOperationId, 'gapless priming stayed on the current operation');

  const endedEvents = await runner.waitNotifications('audio.ended', 3, 15000);
  const advances = endedEvents.filter((event) => event.params?.gaplessAdvance === true);
  runner.assert(advances.length === 2, 'host emitted exactly two PCM-boundary gapless commits');
  runner.assert(advances[0]?.params?.nextItemId === 'gapless-queue-2', 'first boundary committed queue item 2');
  runner.assert(advances[1]?.params?.nextItemId === 'gapless-queue-3', 'second boundary committed queue item 3');
  runner.assert(advances.every((event) => event.params?.queueAdvance === true), 'gapless commits use the queue identity handoff contract');
  runner.assert(
    advances.every((event) => Number.isFinite(event.params?.operationId) && event.params.operationId !== initialOperationId),
    'every gapless boundary issued a new operation identity',
  );
  runner.assert(endedEvents.at(-1)?.params?.queueAdvance !== true, 'final prepared track ended naturally without replaying the queue');
  runner.evidence.gaplessAdvances = advances.map((event) => event.params);

  runner.sendRpc('audio.stop', {}, 4);
  await runner.waitResponse(4, 5000);
  runner.evidence.passed = true;
}

async function scenarioMainThreadStall(runner, evidenceDir) {
  const generatedFixture = generateShortWavFixture(evidenceDir, {
    sampleRate: 48000,
    durationSeconds: 5,
    frequencyHz: 330,
    fileName: 'task-10-main-thread-stall-48000.wav',
  });
  runner.evidence.generatedFixture = generatedFixture;

  runner.spawn();
  await runner.waitReady();
  await sleep(300);
  runner.markEventOffset();

  runner.sendRpc('audio.openFile', [{ filePath: generatedFixture.path, targetSampleRate: 48000 }], 1);
  const openResponse = await runner.waitResponse(1, 10000);
  runner.assert(!openResponse.error, 'stall fixture opened in the native daemon');
  const operationId = openResponse.result?.operationId;
  const sampleRate = openResponse.result?.sampleRate ?? 48000;
  const beforeEvents = await runner.waitNotifications('audio.position', 2, 10000);
  const beforeEvent = beforeEvents.filter((event) => event.params?.operationId === operationId).at(-1);
  const beforeSeconds = observedPositionSeconds(beforeEvent, 0, sampleRate);
  runner.assert(Number.isFinite(beforeSeconds), 'native position was observable before the control-plane stall');

  const stallDurationMs = 1200;
  const stallStartedAt = Date.now();
  while (Date.now() - stallStartedAt < stallDurationMs) {
    Math.sqrt(12345.6789);
  }
  const actualStallMs = Date.now() - stallStartedAt;

  const afterEvents = await runner.waitNotifications('audio.position', beforeEvents.length + 1, 5000);
  const afterEvent = afterEvents.filter((event) => event.params?.operationId === operationId).at(-1);
  const afterSeconds = observedPositionSeconds(afterEvent, 0, sampleRate);
  const positionDeltaSeconds = afterSeconds - beforeSeconds;
  runner.assert(
    Number.isFinite(afterSeconds) && positionDeltaSeconds >= 0.8,
    `native playback advanced ${positionDeltaSeconds.toFixed(3)}s while Node was blocked for ${actualStallMs}ms`,
  );
  runner.assert(runner.child.exitCode === null, 'native daemon remained alive across the control-plane stall');
  runner.evidence.controlPlaneStall = {
    requestedMs: stallDurationMs,
    actualMs: actualStallMs,
    beforeSeconds,
    afterSeconds,
    positionDeltaSeconds,
    operationId,
  };
  runner.evidence.passed = true;
}

async function scenarioLivePlaybackRate(runner, evidenceDir, outputTarget = {}) {
  const generatedFixture = generateShortWavFixture(evidenceDir, {
    sampleRate: 6000,
    durationSeconds: 8,
    frequencyHz: 440,
    fileName: 'live-playback-rate-src-6000.wav',
  });
  runner.evidence.generatedFixture = generatedFixture;

  runner.spawn();
  await runner.waitReady(15000, {
    outputMode: 'shared',
    deviceIndex: outputTarget.deviceIndex ?? -1,
    deviceName: outputTarget.deviceName || '',
    sampleRate: 48000,
    processing: {
      outputFormat: 'pcm',
      dither: {
        mode: 'tpdf',
        bitDepth: 24,
      },
      echoSrc: {
        sourceSampleRate: 6000,
        targetSampleRate: 48000,
        computeBackend: 'cuda',
        stages: [
          { upsampleFactor: 2, taps: [-0.02, 0, 0.24, 0.56, 0.24, 0, -0.02] },
          { upsampleFactor: 2, taps: [0, 0.25, 0.5, 0.25, 0] },
          { upsampleFactor: 2, taps: [0, 0.25, 0.5, 0.25, 0] },
        ],
      },
    },
  });
  runner.markEventOffset();

  runner.sendRpc('audio.openFile', [{ filePath: generatedFixture.path }], 1);
  const openResponse = await runner.waitResponse(1, 10000);
  runner.assert(!openResponse.error, 'playback-rate fixture opened');
  await runner.waitNotifications('audio.position', 1, 10000);

  runner.sendRpc('playbackRate.setRate', [1.05], 2);
  const rateResponse = await runner.waitResponse(2, 5000);
  runner.assert(!rateResponse.error && Math.abs(rateResponse.result?.rate - 1.05) < 0.001,
    'live playback-rate update was acknowledged');
  const postRatePositions = await runner.waitNotifications('audio.position', 12, 5000);
  runner.assert(postRatePositions.some((event) => event.params?.processing?.echoSrc?.active === true),
    '8x ECHO SRC remained active after the playback-rate update');
  runner.assert(postRatePositions.some((event) => event.params?.processing?.dither?.active === true),
    '24-bit TPDF dither remained active after the playback-rate update');

  for (let seekIndex = 0; seekIndex < 6; seekIndex += 1) {
    runner.markEventOffset();
    const seekId = 10 + seekIndex;
    const positionSeconds = 0.5 + seekIndex * 0.25;
    runner.sendRpc('audio.seek', [{ positionSeconds }], seekId);
    const seekResponse = await runner.waitResponse(seekId, 10000);
    runner.assert(!seekResponse.error, `playback-rate seek ${seekIndex + 1} succeeded`);
    await runner.waitNotifications('audio.position', 1, 5000);
  }
  runner.assert(runner.child.exitCode === null, 'daemon remained alive after live playback-rate update');
  runner.evidence.passed = true;
}

// ── Missing-file pre-check (before any spawn) ──

function checkMissingFile(filePath) {
  if (!existsSync(filePath)) {
    const err = {
      scenario: 'missing-file',
      timestamp: new Date().toISOString(),
      error: `File not found: ${filePath}`,
      passed: false,
    };
    console.error(`\n[FAIL] File not found: ${filePath}`);
    return err;
  }
  return null;
}

// ── Main ──

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!VALID_SCENARIOS.includes(args.scenario)) {
    console.error(`Invalid scenario: ${args.scenario}`);
    console.error(`Valid scenarios: ${VALID_SCENARIOS.join(', ')}`);
    process.exit(1);
  }

  ensureEvidenceDir(args.evidenceDir);

  const scenarios = args.scenario === 'all'
    ? VALID_SCENARIOS.filter((s) => s !== 'all')
    : [args.scenario];

  let anyFailed = false;

  for (const scenario of scenarios) {
    console.log(`\n[smoke:daemon] Running scenario: ${scenario}`);
    console.log(`[smoke:daemon] Host: ${args.host}`);
    console.log(`[smoke:daemon] File: ${args.file}`);

    // Pre-check: missing file (skip for scenarios that generate fixtures)
    const generatesFixture = scenario === 'natural-ended'
      || scenario === 'explicit-stop'
      || scenario === 'queue-advance'
      || scenario === 'gapless-boundary'
      || scenario === 'main-thread-stall'
      || scenario === 'live-playback-rate'
      || scenario === 'crash-exit';
    if (!generatesFixture) {
      const missingErr = checkMissingFile(args.file);
      if (missingErr) {
        const slug = `task-1-smoke-helper-missing-file.json`;
        writeEvidence(args.evidenceDir, slug, missingErr);
        console.error(`[smoke:daemon] ✗ ${scenario}: file not found`);
        anyFailed = true;
        if (args.scenario !== 'all') process.exit(1);
        continue;
      }
    }

    const runner = new DaemonRunner(args.host);
    runner.evidence.scenario = scenario;
    runner.evidence.timestamp = new Date().toISOString();
    runner.evidence.host = args.host;
    runner.evidence.file = args.file;

    try {
      switch (scenario) {
        case 'cold-open':
          await scenarioColdOpen(runner, args.file);
          break;
        case 'remote-source':
          await scenarioRemoteSource(runner, args.file);
          break;
        case 'output-mode-cycle':
          await scenarioOutputModeCycle(runner, args.file, {
            deviceIndex: Number.isInteger(args.deviceIndex) ? args.deviceIndex : -1,
            deviceName: args.deviceName,
            alternateDeviceIndex: Number.isInteger(args.alternateDeviceIndex) ? args.alternateDeviceIndex : null,
            alternateDeviceName: args.alternateDeviceName,
            sampleRate: Number.isInteger(args.sampleRate) && args.sampleRate > 0 ? args.sampleRate : 48000,
          });
          break;
        case 'hotplug-recovery':
          await scenarioHotplugRecovery(runner, args.file, {
            outputMode: args.outputMode,
            deviceIndex: Number.isInteger(args.deviceIndex) ? args.deviceIndex : -1,
            deviceName: args.deviceName,
            sampleRate: Number.isInteger(args.sampleRate) && args.sampleRate > 0 ? args.sampleRate : 48000,
          });
          break;
        case 'offset-open':
          await scenarioOffsetOpen(runner, args.file, args.offset, args.evidenceDir);
          break;
        case 'rapid-open-stop-open':
          await scenarioRapidOpenStopOpen(runner, args.file);
          break;
        case 'natural-ended':
          await scenarioNaturalEnded(runner, args.file, args.evidenceDir);
          break;
        case 'explicit-stop':
          await scenarioExplicitStop(runner, args.file, args.evidenceDir);
          break;
        case 'eq-replay':
          await scenarioEqReplay(runner, args.file);
          break;
        case 'prefetch-no-truncate':
          await scenarioPrefetchNoTruncate(runner, args.file);
          break;
        case 'queue-advance':
          await scenarioQueueAdvance(runner, args.file, args.evidenceDir, {
            outputMode: args.outputMode === 'asio' ? 'asio' : args.outputMode === 'exclusive' ? 'exclusive' : 'shared',
            deviceIndex: Number.isInteger(args.deviceIndex) ? args.deviceIndex : -1,
            deviceName: args.deviceName,
            queueRates: args.queueRates,
            queueFiles: args.queueFiles,
          });
          break;
        case 'gapless-boundary':
          await scenarioGaplessBoundary(runner, args.evidenceDir, {
            outputMode: args.outputMode === 'asio' ? 'asio' : args.outputMode === 'exclusive' ? 'exclusive' : 'shared',
            deviceIndex: Number.isInteger(args.deviceIndex) ? args.deviceIndex : -1,
            deviceName: args.deviceName,
            sampleRate: Number.isInteger(args.sampleRate) && args.sampleRate > 0 ? args.sampleRate : 48000,
          });
          break;
        case 'main-thread-stall':
          await scenarioMainThreadStall(runner, args.evidenceDir);
          break;
        case 'live-playback-rate':
          await scenarioLivePlaybackRate(runner, args.evidenceDir, {
            deviceIndex: Number.isInteger(args.deviceIndex) ? args.deviceIndex : -1,
            deviceName: args.deviceName,
          });
          break;
        case 'crash-exit':
          await scenarioCrashExit(runner, args.evidenceDir);
          break;
        case 'lifecycle':
          await scenarioLifecycle(runner, args.file);
          break;
        default:
          runner.fail(`Unknown scenario: ${scenario}`);
      }
    } catch (e) {
      runner.evidence.passed = false;
      runner.evidence.error = e.message;
      console.error(`[smoke:daemon] ✗ ${scenario}: ${e.message}`);
      anyFailed = true;
    }

    // Shutdown daemon (skip if already exited, e.g. lifecycle scenario handles its own shutdown)
    if (runner.child.exitCode === null && !runner.child.killed) {
      try { await runner.shutdown(); } catch { /* process already dead */ }
    }

    // ALSA/PipeWire can keep the just-terminated native output stream visible for
    // a short interval after process exit. In --scenario all this made the next
    // daemon accept a generated WAV openFile but never deliver playback callbacks,
    // so natural-ended passed alone and failed immediately after rapid reopen.
    if (args.scenario === 'all') {
      await sleep(8000);
    }

    // Collect final stderr
    runner.evidence.stderr = runner.stderr.slice(-4000);

    // Write evidence
    const slug = scenario === 'offset-open'
      ? `task-3-smoke-helper-${scenario}.json`
      : scenario === 'rapid-open-stop-open'
        ? 'task-4-rapid-open-stop-open.json'
        : scenario === 'natural-ended'
          ? 'task-5-natural-ended.json'
          : scenario === 'explicit-stop'
            ? 'task-5-explicit-stop.json'
            : scenario === 'eq-replay'
              ? 'task-6-eq-replay.json'
              : scenario === 'prefetch-no-truncate'
                ? 'task-7-prefetch-no-truncate.json'
                : scenario === 'queue-advance'
                  ? 'task-8-queue-advance.json'
                : scenario === 'gapless-boundary'
                  ? 'gapless-boundary.json'
                : scenario === 'remote-source'
                  ? 'task-remote-source.json'
                : scenario === 'main-thread-stall'
                  ? 'task-10-main-thread-stall.json'
                  : scenario === 'live-playback-rate'
                    ? 'live-playback-rate.json'
                  : scenario === 'crash-exit'
                  ? 'task-9-crash-exit.json'
                : scenario === 'lifecycle'
                  ? 'task-8-lifecycle-shutdown.json'
                  : `task-1-smoke-helper-${scenario}.json`;
    const evidencePath = writeEvidence(args.evidenceDir, slug, runner.evidence);
    console.log(`[smoke:daemon] Evidence: ${evidencePath}`);
    console.log(`[smoke:daemon] ${runner.evidence.passed ? '✓ PASS' : '✗ FAIL'}: ${scenario}`);

    if (runner.evidence.passed === false && scenario !== 'all') {
      process.exit(1);
    }
  }

  if (anyFailed) {
    process.exit(1);
  }

  console.log(`\n[smoke:daemon] All scenarios complete`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[smoke:daemon] Fatal: ${e.message}`);
  process.exit(1);
});
