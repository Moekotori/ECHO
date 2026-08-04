import { createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const packagePath = process.argv[2];
if (!packagePath) {
  throw new Error('Usage: node scripts/echo-pro-decrypt-watermark.mjs <echo-pro-package.echo>');
}

const decodeSecretKey = (value) => {
  const normalized = value.trim();
  if (/^[a-f0-9]{64}$/iu.test(normalized)) {
    return Buffer.from(normalized, 'hex');
  }
  const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
};

const key = decodeSecretKey(process.env.ECHO_PRO_WATERMARK_KEY ?? '');
if (key.length !== 32) {
  throw new Error('ECHO_PRO_WATERMARK_KEY must be the same 32-byte key used during generation.');
}

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((keyName) => `${JSON.stringify(keyName)}:${stableStringify(value[keyName])}`)
    .join(',')}}`;
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

const getPublicKeyPem = () => {
  const publicKey = (process.env.ECHO_PRO_LICENSE_PUBLIC_KEY_PEM ?? process.env.ECHO_PRO_LICENSE_PUBLIC_KEY ?? '')
    .trim()
    .replace(/\\n/gu, '\n');
  if (publicKey) {
    return publicKey;
  }
  const privateKey = (process.env.ECHO_PRO_LICENSE_PRIVATE_KEY_PEM ?? process.env.ECHO_PRO_LICENSE_PRIVATE_KEY ?? '')
    .trim()
    .replace(/\\n/gu, '\n');
  return privateKey ? createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString() : '';
};

const verifySignature = (payload, signatureText) => {
  const publicKeyPem = getPublicKeyPem();
  if (!publicKeyPem || typeof signatureText !== 'string' || !signatureText.trim()) {
    return false;
  }
  try {
    const signature = Buffer.from(signatureText.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return verify(null, Buffer.from(payload, 'utf8'), createPublicKey(publicKeyPem), signature);
  } catch {
    return false;
  }
};

const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
const license = parsed?.license;
const encryptedWatermark = license?.encryptedWatermark;
if (typeof encryptedWatermark !== 'string') {
  throw new Error('Package does not contain an encrypted watermark.');
}

const [version, ivText, tagText, ciphertextText] = encryptedWatermark.split('.');
if (version !== 'v1' || !ivText || !tagText || !ciphertextText) {
  throw new Error('Unsupported watermark format.');
}

const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
const plaintext = Buffer.concat([
  decipher.update(Buffer.from(ciphertextText, 'base64url')),
  decipher.final(),
]).toString('utf8');

console.log(JSON.stringify({
  licenseSignatureValid: verifySignature(canonicalizeLicense(license), parsed.licenseSignature),
  packageSignatureValid: verifySignature(canonicalizePackage(parsed), parsed.packageSignature),
  watermark: JSON.parse(plaintext),
}, null, 2));
