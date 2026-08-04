import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const inlineKeyEnvNames = [
  'ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_PEM',
  'ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY',
  'ECHO_PRO_LICENSE_PRIVATE_KEY_PEM',
  'ECHO_PRO_LICENSE_PRIVATE_KEY',
];

const keyFileEnvNames = [
  'ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_FILE',
  'ECHO_PRO_LICENSE_PRIVATE_KEY_FILE',
];

const privateKeyPemPattern = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u;
const looksLikePrivateKeyPem = (value) => privateKeyPemPattern.test(value.replace(/\\n/g, '\n'));
const defaultLocalKeyFile = join(process.cwd(), '.echo-local', 'keys', 'package-integrity-private-key.pem');

const configuredInlineKey = inlineKeyEnvNames
  .map((name) => ({ name, value: (process.env[name] ?? '').trim() }))
  .find(({ value }) => value.length > 0);
const configuredKeyFile = keyFileEnvNames
  .map((name) => ({ name, value: (process.env[name] ?? '').trim() }))
  .find(({ value }) => value.length > 0);

if (configuredInlineKey) {
  if (!looksLikePrivateKeyPem(configuredInlineKey.value)) {
    console.error(`[ensure:package-integrity-key] ${configuredInlineKey.name} is set but does not look like a PEM private key.`);
    process.exit(1);
  }

  console.log(`[ensure:package-integrity-key] package integrity signing key is configured by ${configuredInlineKey.name}.`);
  process.exit(0);
}

if (configuredKeyFile) {
  if (!existsSync(configuredKeyFile.value)) {
    if (!existsSync(defaultLocalKeyFile)) {
      console.error(
        `[ensure:package-integrity-key] ${configuredKeyFile.name} points to a missing file: ${configuredKeyFile.value}`,
      );
      process.exit(1);
    }
    console.warn(
      `[ensure:package-integrity-key] ${configuredKeyFile.name} points to a missing file; using local repo key instead: ${defaultLocalKeyFile}`,
    );
    process.env.ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_FILE = defaultLocalKeyFile;
    console.log('[ensure:package-integrity-key] package integrity signing key is configured by local repo key.');
    process.exit(0);
  }

  const keyFileInfo = statSync(configuredKeyFile.value);
  if (!keyFileInfo.isFile()) {
    console.error(
      `[ensure:package-integrity-key] ${configuredKeyFile.name} must point to a private-key PEM file: ${configuredKeyFile.value}`,
    );
    process.exit(1);
  }

  if (!looksLikePrivateKeyPem(readFileSync(configuredKeyFile.value, 'utf8'))) {
    console.error(
      `[ensure:package-integrity-key] ${configuredKeyFile.name} does not look like a PEM private key: ${configuredKeyFile.value}`,
    );
    process.exit(1);
  }

  console.log(`[ensure:package-integrity-key] package integrity signing key is configured by ${configuredKeyFile.name}.`);
  process.exit(0);
}

if (existsSync(defaultLocalKeyFile) && looksLikePrivateKeyPem(readFileSync(defaultLocalKeyFile, 'utf8'))) {
  console.log('[ensure:package-integrity-key] package integrity signing key is configured by local repo key.');
  process.exit(0);
}

console.error([
  '[ensure:package-integrity-key] Missing package integrity signing key.',
  'Set ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_PEM or ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_FILE before release packaging.',
  'Default developer Windows packages can use npm run build:win without a package integrity key; paid features stay fail-closed in those packages.',
].join('\n'));
process.exit(1);
