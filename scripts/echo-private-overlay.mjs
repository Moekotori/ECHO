import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configuredPrivateRoot = process.env.ECHO_PRIVATE_ROOT
  ? resolve(process.env.ECHO_PRIVATE_ROOT)
  : resolve(repoRoot, '..', 'ECHOPrivate');

const localOverlayRuntime = resolve(repoRoot, 'src/main/plugins/privateOverlayRuntime.local.ts');
const siblingOverlayRuntime = resolve(configuredPrivateRoot, 'overlay/src/main/plugins/privateOverlayRuntime.ts');
const publicStubRuntime = resolve(repoRoot, 'src/main/plugins/privateOverlayRuntime.ts');

const runGit = (cwd, args) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.error) {
    return { ok: false, output: result.error.message };
  }
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
};

const pickOverlayRuntime = () => {
  if (existsSync(localOverlayRuntime)) {
    return { kind: 'local workspace overlay', path: localOverlayRuntime, privateEnabled: true, selfContained: true };
  }
  if (existsSync(siblingOverlayRuntime)) {
    return { kind: 'private sibling overlay', path: siblingOverlayRuntime, privateEnabled: true, selfContained: false };
  }
  return { kind: 'public stub', path: publicStubRuntime, privateEnabled: false, selfContained: false };
};

const printStatus = () => {
  const overlay = pickOverlayRuntime();
  const privateExists = existsSync(configuredPrivateRoot);

  console.log('ECHO private overlay status');
  console.log(`public repo: ${repoRoot}`);
  console.log(`private repo: ${configuredPrivateRoot}${privateExists ? '' : ' (missing)'}`);
  console.log(`active overlay: ${overlay.kind}`);
  console.log(`overlay path: ${overlay.path}`);
  if (overlay.selfContained) {
    console.log('mode: self-contained private dev workspace');
  }

  if (!privateExists) {
    console.log('');
    if (overlay.selfContained) {
      console.log('Separate ECHOPrivate repo is optional because this workspace already contains the Pro overlay.');
      return 0;
    }
    console.log('Private repo is not present. Clone it next to this repo, or set ECHO_PRIVATE_ROOT.');
    console.log('Example: set ECHO_PRIVATE_ROOT=D:\\Dev\\ECHOPrivate');
    return overlay.privateEnabled ? 0 : 1;
  }

  const privateStatus = runGit(configuredPrivateRoot, ['status', '--short']);
  console.log('');
  console.log('private git status:');
  console.log(privateStatus.output || 'clean');
  return overlay.privateEnabled ? 0 : 1;
};

const pullPrivate = () => {
  if (!existsSync(configuredPrivateRoot)) {
    console.error(`Private repo is missing: ${configuredPrivateRoot}`);
    return 1;
  }
  const result = runGit(configuredPrivateRoot, ['pull', '--ff-only']);
  console.log(result.output || 'Already up to date.');
  return result.ok ? 0 : 1;
};

const command = process.argv[2] ?? 'status';

if (command === 'status' || command === 'doctor') {
  process.exitCode = printStatus();
} else if (command === 'pull') {
  process.exitCode = pullPrivate();
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: node scripts/echo-private-overlay.mjs [status|doctor|pull]');
  process.exitCode = 1;
}
