import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { delimiter, join, resolve } from 'node:path';

const projectRoot = process.cwd();
const appExecutable = resolve(projectRoot, 'dist', 'win-unpacked', 'ECHO NEXT.exe');
const resourcesRoot = resolve(projectRoot, 'dist', 'win-unpacked', 'resources');
const nodeLibraopRoot = join(
  resourcesRoot,
  'app.asar.unpacked',
  'node_modules',
  '@lox-audioserver',
  'node-libraop',
);
const prebuildRoot = join(nodeLibraopRoot, 'prebuilds', 'win32-x64');

const requiredFiles = [
  appExecutable,
  join(resourcesRoot, 'airplayRaopHelper.cjs'),
  join(nodeLibraopRoot, 'package.json'),
  join(prebuildRoot, 'raop_addon.node.napi.node'),
  join(prebuildRoot, 'libssl-3-x64.dll'),
  join(prebuildRoot, 'libcrypto-3-x64.dll'),
  join(prebuildRoot, 'pthreadVC3.dll'),
];

const missing = requiredFiles.filter((filePath) => !existsSync(filePath));

if (missing.length > 0) {
  console.error('[verify:airplay-package] Packaged AirPlay receiver is incomplete.');
  for (const filePath of missing) {
    console.error(`[verify:airplay-package] Missing: ${filePath}`);
  }
  process.exit(1);
}

const findAvailableTcpPort = async (basePort, portRange) => {
  for (let offset = 0; offset < portRange; offset += 1) {
    const port = basePort + offset;
    const available = await new Promise((resolvePort) => {
      const server = createServer();
      server.unref();
      server.once('error', () => resolvePort(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolvePort(true));
      });
    });
    if (available) {
      return port;
    }
  }
  throw new Error(`No available AirPlay smoke-test port in ${basePort}-${basePort + portRange - 1}.`);
};

const runPackagedHelperSmoke = async () => {
  const helperPath = join(resourcesRoot, 'airplayRaopHelper.cjs');
  const nodePath = [
    join(resourcesRoot, 'app.asar.unpacked', 'node_modules'),
    join(resourcesRoot, 'app.asar', 'node_modules'),
  ].join(delimiter);
  const portBase = await findAvailableTcpPort(6230, 50);

  await new Promise((resolveSmoke, rejectSmoke) => {
    let output = '';
    let started = false;
    let settled = false;
    const child = spawn(appExecutable, [helperPath], {
      cwd: resourcesRoot,
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: nodePath,
      },
    });

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Best-effort cleanup after smoke verification.
      }
      if (error) {
        rejectSmoke(error);
      } else {
        resolveSmoke();
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`Packaged AirPlay helper smoke test timed out. Output: ${output}`));
    }, 15_000);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      output += text;
      for (const line of text.split(/\r?\n/u).filter(Boolean)) {
        let message = null;
        try {
          message = JSON.parse(line);
        } catch {
          output += line;
          continue;
        }

        if (message.type === 'ready') {
          child.stdin.write(`${JSON.stringify({
            type: 'start',
            requestId: 1,
            options: {
              name: 'ECHO Packaged Smoke',
              model: 'ECHO-Next-AirPlay-Spike',
              mac: '024543484F00',
              latencies: '1000:1000',
              metadata: true,
              portBase,
              portRange: 20,
            },
          })}\n`);
          return;
        }

        if (message.type === 'started') {
          started = true;
          child.stdin.write(`${JSON.stringify({ type: 'stop', requestId: 2 })}\n`);
          return;
        }

        if (message.type === 'stopped' && started) {
          finish(null);
          return;
        }

        if (message.type === 'fatal' || message.type === 'error') {
          finish(new Error(`Packaged AirPlay helper failed: ${line}`));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.on('error', finish);
    child.on('exit', (code, signal) => {
      if (!settled) {
        finish(new Error(`Packaged AirPlay helper exited early (${code ?? signal ?? 'unknown'}). Output: ${output}`));
      }
    });
  });
};

try {
  await runPackagedHelperSmoke();
  console.log('[verify:airplay-package] Packaged AirPlay receiver resources and helper smoke test passed.');
} catch (error) {
  console.error(`[verify:airplay-package] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
