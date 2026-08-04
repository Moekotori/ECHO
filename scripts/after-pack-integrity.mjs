import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const hashFileSha256 = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

const normalizeRelativePath = (value) => value.split(sep).join('/');
const bundledPackageIntegrityPublicKeyPem = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEA9FrogOinr0BLbVG65gdRIiNoR0QE+9T7uCAWfDarwf0=',
  '-----END PUBLIC KEY-----',
].join('\n');

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

const canonicalizeIntegrityManifest = (manifest) => stableStringify({
  appId: manifest.appId,
  files: [...manifest.files]
    .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }))
    .sort((left, right) => left.path.localeCompare(right.path)),
  generatedAt: manifest.generatedAt,
  productName: manifest.productName,
  schemaVersion: manifest.schemaVersion,
  version: manifest.version,
});

const readSigningPrivateKeyPem = async () => {
  const inline = (
    process.env.ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_PEM ??
    process.env.ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY ??
    process.env.ECHO_PRO_LICENSE_PRIVATE_KEY_PEM ??
    process.env.ECHO_PRO_LICENSE_PRIVATE_KEY ??
    ''
  ).trim();
  if (inline) {
    return inline.replace(/\\n/g, '\n');
  }

  const keyFile = (
    process.env.ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_FILE ??
    process.env.ECHO_PRO_LICENSE_PRIVATE_KEY_FILE ??
    ''
  ).trim();
  if (keyFile) {
    if (existsSync(keyFile)) {
      return (await readFile(keyFile, 'utf8')).trim();
    }
    console.warn(`[afterPack:integrity] configured signing key file is missing, trying local repo key: ${keyFile}`);
  }

  const localKeyFile = join(process.cwd(), '.echo-local', 'keys', 'package-integrity-private-key.pem');
  if (existsSync(localKeyFile)) {
    return (await readFile(localKeyFile, 'utf8')).trim();
  }

  throw new Error('Set ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_PEM or ECHO_PACKAGE_INTEGRITY_PRIVATE_KEY_FILE to sign echo-integrity.json; ECHO_PRO_LICENSE_PRIVATE_KEY_PEM or ECHO_PRO_LICENSE_PRIVATE_KEY_FILE are also accepted when they match the bundled public key.');
};

const addFileInfo = async (resourcesDir, files, filePath) => {
  files.push({
    path: normalizeRelativePath(relative(resourcesDir, filePath)),
    sha256: await hashFileSha256(filePath),
    size: (await stat(filePath)).size,
  });
};

const addResourcePath = async (resourcesDir, files, relativePath) => {
  const filePath = join(resourcesDir, relativePath);
  if (!existsSync(filePath)) {
    return;
  }

  const info = await stat(filePath);
  if (info.isFile()) {
    await addFileInfo(resourcesDir, files, filePath);
    return;
  }

  if (!info.isDirectory()) {
    return;
  }

  const entries = await readdir(filePath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    await addResourcePath(resourcesDir, files, join(relativePath, entry.name));
  }
};

export default async function afterPack(context) {
  const resourcesDir = join(context.appOutDir, 'resources');
  if (process.env.ECHO_ALLOW_UNSIGNED_BASE_PACKAGE === '1') {
    await rm(join(resourcesDir, 'echo-integrity.json'), { force: true });
    await rm(join(resourcesDir, 'echo-integrity.sig'), { force: true });
    console.warn('[afterPack:integrity] unsigned base package requested; package integrity will fail closed for paid features.');
    return;
  }

  const files = [];
  const candidateFiles = [
    'app.asar',
    'echo-audio-host.exe',
    'echo-smtc-host.exe',
    'echo-native-scanner.exe',
    'echo-src-cuda-worker.exe',
    'airplayRaopHelper.cjs',
    'tools/ffmpeg.exe',
    'tools/yt-dlp.exe',
    'tools/NCMConverter.exe',
  ];

  for (const relativePath of candidateFiles) {
    await addResourcePath(resourcesDir, files, relativePath);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const manifest = {
    schemaVersion: 1,
    appId: context.packager.appInfo.id,
    productName: context.packager.appInfo.productName,
    version: context.packager.appInfo.version,
    generatedAt: new Date().toISOString(),
    files,
  };

  const privateKeyPem = await readSigningPrivateKeyPem();
  const canonicalManifest = Buffer.from(canonicalizeIntegrityManifest(manifest), 'utf8');
  const signatureBytes = sign(null, canonicalManifest, privateKeyPem);
  if (!verify(null, canonicalManifest, createPublicKey(bundledPackageIntegrityPublicKeyPem), signatureBytes)) {
    throw new Error('The package integrity private key does not match the public key bundled in the app.');
  }
  const signature = signatureBytes.toString('base64url');

  await writeFile(join(resourcesDir, 'echo-integrity.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(resourcesDir, 'echo-integrity.sig'), `${signature}\n`);
  console.log(`[afterPack:integrity] wrote ${files.length} file hash(es) to resources/echo-integrity.json and signed echo-integrity.sig`);
}
