import { createCipheriv, createHash, randomBytes, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith('--') && value && !value.startsWith('--')) {
    args.set(key.slice(2), value);
    index += 1;
  }
}

const required = (name) => {
  const value = args.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
};

const hashText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const decodeSecretKey = (value) => {
  const normalized = value.trim();
  if (/^[a-f0-9]{64}$/iu.test(normalized)) {
    return Buffer.from(normalized, 'hex');
  }
  const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
};

const canonicalizeLicense = (value) => JSON.stringify({
  activationId: value.activationId,
  expiresAt: value.expiresAt,
  features: [...value.features].sort(),
  format: value.format,
  issuedAt: value.issuedAt,
  licenseId: value.licenseId,
  machineCodeHash: value.machineCodeHash,
  plan: value.plan,
  pluginId: value.pluginId,
  qq: value.qq,
  version: value.version,
  ...(value.encryptedWatermark ? { encryptedWatermark: value.encryptedWatermark } : {}),
});

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
};

const canonicalizePackage = (value) => stableStringify({
  exportedAt: value.exportedAt,
  files: [...value.files]
    .map((file) => ({ path: file.path, content: file.content }))
    .sort((left, right) => left.path.localeCompare(right.path)),
  license: value.license,
  licenseSignature: value.licenseSignature,
  manifest: value.manifest,
  type: value.type,
  version: value.version,
});

const encryptWatermark = (payload) => {
  const key = decodeSecretKey(process.env.ECHO_PRO_WATERMARK_KEY ?? '');
  if (key.length !== 32) {
    throw new Error('ECHO_PRO_WATERMARK_KEY must be a 32-byte base64url/base64 or 64-char hex key.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
};

const privateKeyPem = (process.env.ECHO_PRO_LICENSE_PRIVATE_KEY_PEM ?? process.env.ECHO_PRO_LICENSE_PRIVATE_KEY ?? '')
  .trim()
  .replace(/\\n/g, '\n');
if (!privateKeyPem) {
  throw new Error('Set ECHO_PRO_LICENSE_PRIVATE_KEY_PEM to an Ed25519 private key PEM.');
}

const qq = required('qq');
if (!/^[1-9][0-9]{4,11}$/u.test(qq)) {
  throw new Error('QQ must be 5-12 digits and cannot start with 0.');
}

const licenseId = args.get('license-id')?.trim() || `lic_${randomBytes(8).toString('hex')}`;
const activationId = args.get('activation-id')?.trim() || `act_${randomBytes(8).toString('hex')}`;
const machineCode = args.get('machine-code')?.trim();
const machineCodeHashInput = args.get('machine-code-hash')?.trim();
const machineCodeHash = machineCodeHashInput || (machineCode ? hashText(machineCode) : '');
if (!/^[a-f0-9]{64}$/u.test(machineCodeHash)) {
  throw new Error('Provide --machine-code or a 64-char --machine-code-hash from the activation page.');
}

const issuedAt = args.get('issued-at')?.trim() || new Date().toISOString();
const expiresAt = args.get('expires-at')?.trim() || null;
const features = (args.get('features')?.split(',') ?? ['echo-pro', 'downloads', 'connect', 'plugins'])
  .map((item) => item.trim())
  .filter(Boolean);
if (!features.includes('echo-pro')) {
  features.push('echo-pro');
}

const watermark = {
  licenseId,
  activationId,
  qq,
  orderId: args.get('order-id')?.trim() || null,
  machineCodeHash,
  issuedAt,
  issuedBy: args.get('issued-by')?.trim() || 'echo-page',
};

const license = {
  format: 'echo-pro-plugin-license',
  version: 1,
  licenseId,
  activationId,
  qq,
  plan: 'pro',
  features,
  pluginId: 'echo.pro-unlock',
  machineCodeHash,
  issuedAt,
  expiresAt,
  encryptedWatermark: encryptWatermark(watermark),
};

const signature = sign(null, Buffer.from(canonicalizeLicense(license), 'utf8'), privateKeyPem).toString('base64url');
const pluginMessage = [...Buffer.from('ECHO Pro license plugin is verified by the host.', 'utf8')].join(',');
const pluginScript = `(()=>{const m=String.fromCharCode(${pluginMessage});echo?.ui?.notify?.(m).catch?.(()=>{});})();`;
const manifest = {
  id: 'echo.pro-unlock',
  name: 'ECHO Pro Unlock',
  version: args.get('plugin-version')?.trim() || '1.0.0',
  apiVersion: 2,
  entry: 'plugin.js',
  permissions: [],
  contributes: {},
};

const output = resolve(args.get('out')?.trim() || `echo-pro-${licenseId}.echo`);
const pluginPackage = {
  type: 'echo-next-plugin-package',
  version: 1,
  exportedAt: new Date().toISOString(),
  manifest,
  license,
  licenseSignature: signature,
  files: [
    {
      path: 'plugin.js',
      content: pluginScript,
    },
  ],
};
const packageSignature = sign(null, Buffer.from(canonicalizePackage(pluginPackage), 'utf8'), privateKeyPem).toString('base64url');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ ...pluginPackage, packageSignature }, null, 2)}\n`, 'utf8');

console.log(`Generated ${output}`);
console.log(`licenseId=${licenseId}`);
console.log(`activationId=${activationId}`);
