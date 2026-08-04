import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const defaultPackageKeyPath = resolve(projectRoot, '.echo-local', 'keys', 'package-integrity-private-key.pem');
const packageKeyEnvName = 'ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_FILE';
const defaultPublicKeyFiles = [
  resolve(projectRoot, 'scripts', 'after-pack-integrity.mjs'),
  resolve(projectRoot, 'src', 'main', 'app', 'packageIntegrity.ts'),
];

const usage = `Usage:
  npm run echo-admin -- package-key status
  npm run echo-admin -- package-key setup [--path FILE] [--no-set-env]
  npm run echo-admin -- package-key generate [--path FILE] [--no-set-env]
  npm run echo-admin -- package-key rotate --yes [--path FILE] [--no-set-env]
  npm run echo-admin -- package-key delete --yes [--path FILE] [--keep-env]

Package integrity keys are local secrets. The private key is written under
.echo-local/keys/ by default, which must stay ignored by git.

Use setup for normal machines. Use rotate only when intentionally changing the
trusted package signing key for future releases.`;

const fail = (message) => {
  console.error(`[echo-admin] ${message}`);
  process.exit(1);
};

const log = (message) => {
  console.log(`[echo-admin] ${message}`);
};

const parseOptions = (args) => {
  const options = {
    path: defaultPackageKeyPath,
    publicKeyFiles: defaultPublicKeyFiles,
    setEnv: true,
    keepEnv: false,
    yes: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--force') {
      fail('Use package-key rotate --yes instead of --force so key rotation is explicit.');
    }
    if (arg === '--yes') {
      options.yes = true;
      continue;
    }
    if (arg === '--no-set-env') {
      options.setEnv = false;
      continue;
    }
    if (arg === '--keep-env') {
      options.keepEnv = true;
      continue;
    }
    if (arg === '--path') {
      const value = args[index + 1];
      if (!value) {
        fail('--path requires a file path.');
      }
      options.path = resolve(projectRoot, value);
      index += 1;
      continue;
    }
    if (arg === '--public-key-files') {
      const value = args[index + 1];
      if (!value) {
        fail('--public-key-files requires a comma-separated file list.');
      }
      options.publicKeyFiles = value.split(',').filter(Boolean).map((file) => resolve(projectRoot, file));
      index += 1;
      continue;
    }
    fail(`Unknown option: ${arg}`);
  }
  return options;
};

const getUserEnv = (name) => {
  if (process.platform !== 'win32') {
    return process.env[name] ?? '';
  }
  const result = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    `[Environment]::GetEnvironmentVariable('${name}','User')`,
  ], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
};

const runGit = (args) => spawnSync('git', args, {
  cwd: projectRoot,
  encoding: 'utf8',
  shell: false,
});

const isPathIgnoredByGit = (filePath) => {
  const result = runGit(['check-ignore', '-q', '--', filePath]);
  return result.status === 0;
};

const setUserEnv = (name, value) => {
  if (process.platform !== 'win32') {
    log(`Set this in your shell profile: export ${name}="${value}"`);
    return;
  }
  const escapedValue = value.replace(/'/gu, "''");
  const result = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    `[Environment]::SetEnvironmentVariable('${name}','${escapedValue}','User')`,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`Failed to set ${name}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
};

const clearUserEnvIfMatches = (name, expectedPath) => {
  const current = getUserEnv(name);
  if (current && resolve(current) !== resolve(expectedPath)) {
    log(`${name} points elsewhere; leaving it unchanged.`);
    return;
  }
  setUserEnv(name, '');
  log(`Cleared user environment variable ${name}.`);
};

const restrictCurrentUserRead = (filePath) => {
  if (process.platform !== 'win32') {
    return;
  }
  const username = process.env.USERNAME;
  if (!username) {
    return;
  }
  spawnSync('icacls', [filePath, '/inheritance:r'], { stdio: 'ignore' });
  spawnSync('icacls', [filePath, '/grant:r', `${username}:R`], { stdio: 'ignore' });
};

const publicKeyBlock = (publicKeyPem) => {
  const lines = publicKeyPem.trim().split(/\r?\n/u);
  return [
    'const bundledPackageIntegrityPublicKeyPem = [',
    ...lines.map((line) => `  '${line}',`),
    "].join('\\n');",
  ].join('\n');
};

const replaceBundledPublicKey = (source, publicKeyPem) => {
  const pattern = /const bundledPackageIntegrityPublicKeyPem = \[[\s\S]*?\]\.join\('\\n'\);/u;
  if (!pattern.test(source)) {
    fail('Could not find bundledPackageIntegrityPublicKeyPem block.');
  }
  return source.replace(pattern, publicKeyBlock(publicKeyPem));
};

const syncPublicKeyFiles = (publicKeyPem, files) => {
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    writeFileSync(file, replaceBundledPublicKey(source, publicKeyPem), 'utf8');
    log(`Updated bundled package integrity public key in ${file}`);
  }
};

const readPublicKeyFromPrivateKey = (privateKeyPath) => {
  const privateKey = createPrivateKey(readFileSync(privateKeyPath, 'utf8'));
  return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
};

const publicKeyMatchesFile = (publicKeyPem, file) => {
  const source = readFileSync(file, 'utf8');
  return publicKeyPem.trim().split(/\r?\n/u).every((line) => source.includes(line));
};

const setPackageKeyEnv = (options) => {
  if (options.setEnv) {
    setUserEnv(packageKeyEnvName, options.path);
    log(`Set user environment variable ${packageKeyEnvName}.`);
  }
};

const statusPackageKey = (options) => {
  const userEnv = getUserEnv(packageKeyEnvName);
  const keyExists = existsSync(options.path);
  const envMatches = userEnv ? resolve(userEnv) === resolve(options.path) : false;
  const ignored = isPathIgnoredByGit(options.path);
  log(`key path: ${options.path}`);
  log(`key exists: ${keyExists ? 'yes' : 'no'}`);
  log(`git ignored: ${ignored ? 'yes' : 'no'}`);
  log(`${packageKeyEnvName}: ${userEnv || '<not set>'}`);
  log(`env matches key path: ${envMatches ? 'yes' : 'no'}`);
  if (keyExists) {
    const publicKeyPem = readPublicKeyFromPrivateKey(options.path);
    const publicKeyMatches = options.publicKeyFiles.every((file) => publicKeyMatchesFile(publicKeyPem, file));
    log(`public key: ${publicKeyPem.trim().split(/\r?\n/u).join(' ')}`);
    log(`bundled public key matches: ${publicKeyMatches ? 'yes' : 'no'}`);
    if (!ignored) {
      log('next: add the key directory to .gitignore before publishing.');
    } else if (!envMatches || !publicKeyMatches) {
      log('next: run npm run echo-admin -- package-key setup');
    } else {
      log('ready: npm run build:win can sign package integrity manifests on this machine.');
    }
    return;
  }
  log('next: run npm run echo-admin -- package-key setup');
};

const writeNewPackageKey = (options) => {
  if (existsSync(options.path)) {
    fail(`Key already exists: ${options.path}. Use package-key setup, or rotate --yes to intentionally replace it.`);
  }

  mkdirSync(dirname(options.path), { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(options.path, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  restrictCurrentUserRead(options.path);
  syncPublicKeyFiles(publicKeyPem, options.publicKeyFiles);
  setPackageKeyEnv(options);
  log(`Generated package integrity signing key: ${options.path}`);
};

const setupPackageKey = (options) => {
  if (!isPathIgnoredByGit(options.path)) {
    fail(`Private key path is not ignored by git: ${options.path}`);
  }

  if (!existsSync(options.path)) {
    writeNewPackageKey(options);
    return;
  }

  const publicKeyPem = readPublicKeyFromPrivateKey(options.path);
  syncPublicKeyFiles(publicKeyPem, options.publicKeyFiles);
  setPackageKeyEnv(options);
  log('Package integrity signing key is configured.');
};

const rotatePackageKey = (options) => {
  if (!options.yes) {
    fail('Refusing to rotate without --yes. Rotation changes the trusted public key for future packages.');
  }
  if (!isPathIgnoredByGit(options.path)) {
    fail(`Private key path is not ignored by git: ${options.path}`);
  }
  rmSync(options.path, { force: true });
  writeNewPackageKey(options);
  log('Rotated package integrity signing key. Rebuild packages after this change.');
};

const deletePackageKey = (options) => {
  if (!options.yes) {
    fail('Refusing to delete without --yes.');
  }
  rmSync(options.path, { force: true });
  log(`Deleted package integrity signing key: ${options.path}`);
  if (!options.keepEnv) {
    clearUserEnvIfMatches(packageKeyEnvName, options.path);
  }
  log('Bundled public keys were left unchanged; generate/setup a key before the next package build.');
};

const main = () => {
  const [area, command, ...rest] = process.argv.slice(2);
  if (!area || area === '--help' || area === '-h') {
    console.log(usage);
    return;
  }
  if (area !== 'package-key') {
    fail(`Unknown admin area: ${area}\n${usage}`);
  }
  const options = parseOptions(rest);
  if (command === 'status') {
    statusPackageKey(options);
    return;
  }
  if (command === 'setup') {
    setupPackageKey(options);
    return;
  }
  if (command === 'generate') {
    if (!isPathIgnoredByGit(options.path)) {
      fail(`Private key path is not ignored by git: ${options.path}`);
    }
    writeNewPackageKey(options);
    return;
  }
  if (command === 'rotate') {
    rotatePackageKey(options);
    return;
  }
  if (command === 'delete') {
    deletePackageKey(options);
    return;
  }
  fail(`Unknown package-key command: ${command ?? '<missing>'}\n${usage}`);
};

main();
