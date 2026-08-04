import { createCipheriv, createHash, createHmac, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';

const loadLocalEnv = (filePath = resolve('.env')) => {
  if (!existsSync(filePath)) {
    return;
  }
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/gu, '\n');
  }
};

loadLocalEnv();

const afdianUserId = process.env.AFDIAN_USER_ID?.trim() || 'e78f972400bb11ec851352540025c377';
const afdianApiToken = process.env.AFDIAN_API_TOKEN?.trim() || '';
const afdianApiBaseUrl = (process.env.AFDIAN_API_BASE_URL?.trim() || 'https://afdian.com/api/open').replace(/\/+$/u, '');
const licensePrivateKeyPem = (process.env.ECHO_PRO_LICENSE_PRIVATE_KEY_PEM ?? process.env.ECHO_PRO_LICENSE_PRIVATE_KEY ?? '')
  .trim()
  .replace(/\\n/gu, '\n');
const watermarkKeyText = process.env.ECHO_PRO_WATERMARK_KEY?.trim() || '';
const activationKeySecret = process.env.ECHO_PRO_ACTIVATION_KEY_SECRET?.trim() || '';
const proKeyPepper = process.env.ECHO_PRO_KEY_PEPPER?.trim() || '';
const allowedOrigins = new Set(
  (process.env.ECHO_PRO_ALLOWED_ORIGINS ?? 'http://localhost:4321,http://127.0.0.1:4321')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const allowedPlanIds = new Set(
  (process.env.ECHO_PRO_ALLOWED_PLAN_IDS ?? '')
    .split(',')
    .map((planId) => planId.trim())
    .filter(Boolean),
);
const parseMoneyAmount = (value, fallback) => {
  const parsed = Number.parseFloat(String(value ?? fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const minAmount = Math.max(40, parseMoneyAmount(process.env.ECHO_PRO_MIN_AMOUNT, 40));
const maxActivationsPerOrder = Math.max(1, Number.parseInt(process.env.ECHO_PRO_MAX_ACTIVATIONS_PER_ORDER ?? '2', 10) || 2);
const selfUnbindCooldownMs = Math.max(0, Number.parseInt(process.env.ECHO_PRO_SELF_UNBIND_COOLDOWN_SECONDS ?? String(5 * 60 * 60), 10) || 0) * 1000;
const bindingsPath = resolve(process.env.ECHO_PRO_ACTIVATION_BINDINGS_FILE ?? 'data/echo-pro-activations.json');
const cloudDatabasePath = resolve(process.env.ECHO_PRO_DB ?? '/var/lib/echo-pro/echo-pro.json');
const auditLogPath = resolve(process.env.ECHO_PRO_ACTIVATION_AUDIT_LOG_FILE ?? 'data/echo-pro-activation-audit.jsonl');
const pluginMarketDirectory = resolve(process.env.ECHO_PRO_PLUGIN_MARKET_DIR ?? '/var/lib/echo-pro-activation/plugin-market');
const adminToken = process.env.ECHO_PRO_ACTIVATION_ADMIN_TOKEN?.trim() || '';
const host = process.env.ECHO_PRO_ACTIVATION_HOST?.trim() || '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? process.env.ECHO_PRO_ACTIVATION_PORT ?? '8787', 10);

const hashText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const md5Text = (value) => createHash('md5').update(value, 'utf8').digest('hex');
const hmacSha256 = (secret, value) => createHmac('sha256', secret).update(value, 'utf8').digest('base64url');
const activationKeyPattern = /^ECHO-[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/u;
const maxPluginMarketPackageBytes = Math.max(256 * 1024, Number.parseInt(process.env.ECHO_PRO_PLUGIN_MARKET_MAX_PACKAGE_BYTES ?? String(2 * 1024 * 1024), 10) || 0);
const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const deriveActivationKey = (orderId) => {
  if (!activationKeySecret) {
    throw Object.assign(new Error('activation_key_secret_missing'), { status: 500 });
  }
  return `ECHO-PRO-${hmacSha256(activationKeySecret, `order:${orderId}`).slice(0, 28).toUpperCase()}`;
};

const deriveBindingProof = ({ activationKey, qq, machineCode }) =>
  hashText(`echo-pro-binding-v1:${activationKey}:${qq}:${machineCode}`);

const normalizeProKey = (value) => {
  const compact = typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/gu, '') : '';
  if (compact.startsWith('ECHO') && compact.length === 24) {
    const body = compact.slice(4);
    return `ECHO-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
  }
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
};

const activationKeyHash = (key) => {
  if (!proKeyPepper) {
    throw Object.assign(new Error('key_pepper_missing'), { status: 500 });
  }
  return hashText(`${proKeyPepper}:${normalizeProKey(key)}`);
};

const decodeSecretKey = (value) => {
  if (/^[a-f0-9]{64}$/iu.test(value)) {
    return Buffer.from(value, 'hex');
  }
  return Buffer.from(value.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64');
};

const watermarkKey = decodeSecretKey(watermarkKeyText);

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).byteLength > 32 * 1024) {
      throw Object.assign(new Error('request_too_large'), { status: 413 });
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const readBindings = () => {
  if (!existsSync(bindingsPath)) {
    return { activations: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(bindingsPath, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.activations && typeof parsed.activations === 'object'
      ? parsed
      : { activations: {} };
  } catch {
    return { activations: {} };
  }
};

const readCloudDatabase = () => {
  if (!existsSync(cloudDatabasePath)) {
    return { version: 2, users: [], sessions: [], activationKeys: [] };
  }
  const parsed = JSON.parse(readFileSync(cloudDatabasePath, 'utf8'));
  return {
    version: 2,
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    activationKeys: Array.isArray(parsed.activationKeys) ? parsed.activationKeys : [],
  };
};

const writeCloudDatabase = (state) => {
  mkdirSync(dirname(cloudDatabasePath), { recursive: true });
  const tempPath = `${cloudDatabasePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, cloudDatabasePath);
};

const writeBindings = (state) => {
  mkdirSync(dirname(bindingsPath), { recursive: true });
  writeFileSync(bindingsPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};

const normalizeOrderEntry = (state, orderId) => {
  const current = state.activations[orderId];
  if (current && Array.isArray(current.activations)) {
    current.orderId = current.orderId || orderId;
    return current;
  }
  if (current && typeof current === 'object') {
    const migrated = { orderId, activations: [current] };
    state.activations[orderId] = migrated;
    return migrated;
  }
  const created = { orderId, activations: [] };
  state.activations[orderId] = created;
  return created;
};

const assertSelfUnbindCooldown = (entry) => {
  if (selfUnbindCooldownMs <= 0 || !entry.lastSelfUnbindAt) {
    return;
  }
  const last = Date.parse(entry.lastSelfUnbindAt);
  if (!Number.isFinite(last)) {
    return;
  }
  const retryAtMs = last + selfUnbindCooldownMs;
  if (Date.now() < retryAtMs) {
    const retryAt = new Date(retryAtMs).toISOString();
    throw Object.assign(new Error('unbind_cooldown'), {
      status: 429,
      retryAt,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000)),
    });
  }
};

const allActivationRecords = (state) =>
  Object.entries(state.activations ?? {}).flatMap(([orderId, entry]) => {
    const normalized = normalizeOrderEntry(state, orderId);
    return normalized.activations.map((record) => ({ orderId, record }));
  });

const createActivationRecord = ({ orderId, qq, machineCodeHash, activationKeyHash, bindingProof }) => {
  const nonce = randomBytes(8).toString('hex');
  return {
    orderId,
    qq,
    machineCodeHash,
    activationKeyHash,
    bindingProof,
    licenseId: `lic_${hashText(`license:${bindingProof}:${nonce}`).slice(0, 16)}`,
    activationId: `act_${hashText(`activation:${bindingProof}:${nonce}`).slice(0, 16)}`,
    issuedAt: new Date().toISOString(),
    downloadCount: 0,
    revoked: false,
  };
};

const createProKeyActivationRecord = ({ keyId, keyPrefix, keyHash, qq, machineCodeHash }) => {
  const issuedAt = new Date().toISOString();
  const nonce = randomBytes(8).toString('hex');
  const bindingProof = hashText(`echo-prokey-binding-v1:${keyId}:${machineCodeHash}:${nonce}`);
  return {
    orderId: `prokey_${keyId}`,
    qq,
    source: 'pro-key',
    proKeyId: keyId,
    proKeyPrefix: keyPrefix,
    proKeyHash: keyHash,
    machineCodeHash,
    activationKeyHash: keyHash,
    bindingProof,
    licenseId: `lic_${hashText(`license:prokey:${bindingProof}`).slice(0, 16)}`,
    activationId: `act_${hashText(`activation:prokey:${bindingProof}`).slice(0, 16)}`,
    issuedAt,
    downloadCount: 0,
    revoked: false,
  };
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

const signText = (value) => sign(null, Buffer.from(value, 'utf8'), licensePrivateKeyPem).toString('base64url');

const auditActivation = (event) => {
  try {
    mkdirSync(dirname(auditLogPath), { recursive: true });
    appendFileSync(auditLogPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Audit logging must never block legitimate activation.
  }
};

const encryptWatermark = (payload) => {
  if (watermarkKey.length !== 32) {
    throw Object.assign(new Error('watermark_key_missing'), { status: 500 });
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', watermarkKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
};

const queryAfdianOrder = async (orderId) => {
  if (!afdianApiToken) {
    throw Object.assign(new Error('afdian_token_missing'), { status: 500 });
  }
  const params = JSON.stringify({ out_trade_no: orderId });
  const ts = Math.floor(Date.now() / 1000);
  const signText = `${afdianApiToken}params${params}ts${ts}user_id${afdianUserId}`;
  let response;
  try {
    response = await fetch(`${afdianApiBaseUrl}/query-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: afdianUserId,
        params,
        ts,
        sign: md5Text(signText),
      }),
    });
  } catch (error) {
    const causeCode = error?.cause?.code ? `:${error.cause.code}` : '';
    throw Object.assign(new Error(`afdian_network_failed${causeCode}`), { status: 502 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`afdian_http_${response.status}`), { status: 502 });
  }
  const payload = await response.json();
  if (payload.ec !== 200) {
    throw Object.assign(new Error(`afdian_${payload.ec}:${payload.em || 'unknown_error'}`), { status: 400 });
  }
  const order = payload.data?.list?.[0];
  if (!order || order.out_trade_no !== orderId) {
    throw Object.assign(new Error('order_not_found'), { status: 404 });
  }
  return order;
};

const assertOrderEligible = (order) => {
  if (order.status !== 2) {
    throw Object.assign(new Error('order_not_paid'), { status: 403 });
  }
  if (allowedPlanIds.size > 0 && !allowedPlanIds.has(String(order.plan_id ?? ''))) {
    throw Object.assign(new Error('order_plan_not_allowed'), { status: 403 });
  }
  const paidAmount = Number.parseFloat(String(order.total_amount ?? ''));
  if (!Number.isFinite(paidAmount) || paidAmount <= minAmount) {
    throw Object.assign(new Error('order_amount_too_low'), { status: 403 });
  }
};

const buildPluginPackage = ({
  orderId,
  qq,
  machineCodeHash,
  activationKeyHash,
  bindingProof,
  licenseId,
  activationId,
  issuedAt,
  source,
  proKeyId,
  proKeyPrefix,
  proKeyHash,
}) => {
  if (!licensePrivateKeyPem) {
    throw Object.assign(new Error('license_private_key_missing'), { status: 500 });
  }
  const watermark = {
    licenseId,
    activationId,
    qq,
    orderId,
    source: source ?? 'afdian',
    ...(proKeyId ? { proKeyId } : {}),
    ...(proKeyPrefix ? { proKeyPrefix } : {}),
    ...(proKeyHash ? { proKeyHash } : {}),
    machineCodeHash,
    activationKeyHash,
    bindingProof,
    issuedAt,
    issuedBy: source === 'pro-key' ? 'echo-page-pro-key' : 'echo-page-afdian',
  };
  const license = {
    format: 'echo-pro-plugin-license',
    version: 1,
    licenseId,
    activationId,
    qq,
    plan: 'pro',
    features: ['echo-pro', 'downloads', 'connect', 'plugins'],
    pluginId: 'echo.pro-unlock',
    machineCodeHash,
    issuedAt,
    expiresAt: null,
    encryptedWatermark: encryptWatermark(watermark),
  };
  const pluginMessage = [...Buffer.from('ECHO Pro license plugin is verified by the host.', 'utf8')].join(',');
  const pluginScript = `(()=>{const m=String.fromCharCode(${pluginMessage});echo?.ui?.notify?.(m).catch?.(()=>{});})();`;
  const pluginPackage = {
    type: 'echo-next-plugin-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    manifest: {
      id: 'echo.pro-unlock',
      name: 'ECHO Pro Unlock',
      version: '1.0.0',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: [],
      contributes: {},
    },
    license,
    licenseSignature: signText(canonicalizeLicense(license)),
    files: [{ path: 'plugin.js', content: pluginScript }],
  };
  return {
    ...pluginPackage,
    packageSignature: signText(canonicalizePackage(pluginPackage)),
  };
};

const normalizeActivationRequest = (body) => {
  const orderId = String(body.orderId ?? '').trim();
  const qq = String(body.qq ?? '').trim();
  const machineCode = String(body.machineCode ?? '').trim();
  if (!/^[0-9A-Za-z_-]{12,80}$/u.test(orderId)) {
    throw Object.assign(new Error('order_id_invalid'), { status: 400 });
  }
  if (!/^[1-9][0-9]{4,11}$/u.test(qq)) {
    throw Object.assign(new Error('qq_invalid'), { status: 400 });
  }
  if (!/^[a-f0-9]{32,128}$/iu.test(machineCode)) {
    throw Object.assign(new Error('machine_code_invalid'), { status: 400 });
  }
  return { orderId, qq, machineCode, machineCodeHash: hashText(machineCode) };
};

const normalizeProKeyActivationRequest = (body) => {
  const key = normalizeProKey(body.key ?? body.proKey);
  const qq = String(body.qq ?? '').trim();
  const machineCodeHash = String(body.hwidHash ?? body.machineCodeHash ?? '').trim().toLowerCase();
  if (!activationKeyPattern.test(key)) {
    throw Object.assign(new Error('invalid_key'), { status: 400 });
  }
  if (!/^[1-9][0-9]{4,11}$/u.test(qq)) {
    throw Object.assign(new Error('qq_invalid'), { status: 400 });
  }
  if (!/^[a-f0-9]{64}$/u.test(machineCodeHash)) {
    throw Object.assign(new Error('invalid_hwid'), { status: 400 });
  }
  return { key, qq, machineCodeHash };
};

const corsHeaders = (origin) => {
  const headers = {
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-expose-headers': 'x-echo-activation-id,x-echo-active-count,x-echo-license-id,x-echo-max-activations,x-echo-package-name',
    'vary': 'origin',
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
};

const sendJson = (response, status, payload, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
};

const bearerToken = (request) => {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
};

const requireAdmin = (request) => {
  const token = bearerToken(request);
  if (!adminToken || !token || !safeEqual(token, adminToken)) {
    throw Object.assign(new Error('admin_unauthorized'), { status: 401 });
  }
};

const handleProKeyRedeem = async (request, response, headers, meta) => {
  const input = normalizeProKeyActivationRequest(await readJsonBody(request));
  const keyHash = activationKeyHash(input.key);
  const cloudState = readCloudDatabase();
  const activationKey = cloudState.activationKeys.find((item) => item.keyHash === keyHash) ?? null;
  if (!activationKey || activationKey.disabled === true || (activationKey.expiresAt && Date.parse(activationKey.expiresAt) <= Date.now())) {
    throw Object.assign(new Error('key_rejected'), { status: 403 });
  }

  const state = readBindings();
  const entryId = `prokey_${activationKey.id}`;
  const orderEntry = normalizeOrderEntry(state, entryId);
  orderEntry.source = 'pro-key';
  orderEntry.proKeyId = activationKey.id;
  orderEntry.proKeyPrefix = activationKey.keyPrefix ?? null;

  const activeRecords = orderEntry.activations.filter((record) => record.revoked !== true);
  let record = activeRecords.find((item) => item.machineCodeHash === input.machineCodeHash && item.qq === input.qq) ?? null;
  if (!record && activeRecords.length >= Math.max(1, Number(activationKey.maxRedemptions || 1))) {
    throw Object.assign(new Error('key_already_used'), { status: 403 });
  }

  const redemptions = Array.isArray(activationKey.redemptions) ? activationKey.redemptions : [];
  const activeRedemptions = redemptions.filter((item) => item.revoked !== true);
  let redemption = activeRedemptions.find((item) => item.hwidHash === input.machineCodeHash && item.qq === input.qq) ?? null;
  if (!redemption && activeRedemptions.length >= Math.max(1, Number(activationKey.maxRedemptions || 1))) {
    throw Object.assign(new Error('key_already_used'), { status: 403 });
  }

  if (!record) {
    record = createProKeyActivationRecord({
      keyId: activationKey.id,
      keyPrefix: activationKey.keyPrefix ?? '',
      keyHash,
      qq: input.qq,
      machineCodeHash: input.machineCodeHash,
    });
    orderEntry.activations.push(record);
  }

  const now = new Date().toISOString();
  if (!redemption) {
    redemption = {
      source: 'web-plugin',
      qq: input.qq,
      hwidHash: input.machineCodeHash,
      licenseId: record.licenseId,
      activationId: record.activationId,
      redeemedAt: now,
    };
    redemptions.push(redemption);
  } else {
    redemption.licenseId = redemption.licenseId || record.licenseId;
    redemption.activationId = redemption.activationId || record.activationId;
  }
  activationKey.redemptions = redemptions;
  activationKey.updatedAt = now;

  record.downloadCount = (record.downloadCount ?? 0) + 1;
  record.lastDownloadAt = now;
  writeBindings(state);
  writeCloudDatabase(cloudState);

  const pluginPackage = buildPluginPackage(record);
  const fileName = `echo-pro-key-${String(activationKey.keyPrefix ?? activationKey.id).replace(/[^a-z0-9-]/giu, '').toLowerCase()}.echo`;
  auditActivation({
    event: 'pro_key_package_issued',
    status: 200,
    ip: meta.ip,
    userAgent: meta.userAgent,
    origin: meta.origin,
    qq: input.qq,
    proKeyId: activationKey.id,
    keyPrefix: activationKey.keyPrefix ?? null,
    machineCodeHash: input.machineCodeHash,
    licenseId: record.licenseId,
    activationId: record.activationId,
    activeCount: orderEntry.activations.filter((item) => item.revoked !== true).length,
    maxActivations: Math.max(1, Number(activationKey.maxRedemptions || 1)),
    fileName,
  });
  response.writeHead(200, {
    ...headers,
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${fileName}"`,
    'x-echo-package-name': fileName,
    'x-echo-active-count': String(orderEntry.activations.filter((item) => item.revoked !== true).length),
    'x-echo-max-activations': String(Math.max(1, Number(activationKey.maxRedemptions || 1))),
    'x-echo-license-id': record.licenseId,
    'x-echo-activation-id': record.activationId,
  });
  response.end(`${JSON.stringify(pluginPackage, null, 2)}\n`);
};

const handleActivationVerify = async (request, response, headers, meta) => {
  const body = await readJsonBody(request);
  const licenseId = String(body.licenseId ?? '').trim();
  const activationId = String(body.activationId ?? '').trim();
  const machineCodeHash = String(body.machineCodeHash ?? '').trim().toLowerCase();
  if (!/^lic_[a-f0-9]{16}$/iu.test(licenseId) || !/^act_[a-f0-9]{16}$/iu.test(activationId) || !/^[a-f0-9]{64}$/u.test(machineCodeHash)) {
    throw Object.assign(new Error('license_verify_invalid'), { status: 400 });
  }

  const state = readBindings();
  const match = allActivationRecords(state).find(({ record }) =>
    record.licenseId === licenseId && record.activationId === activationId,
  );
  const record = match?.record ?? null;
  const valid = Boolean(record && record.revoked !== true && record.machineCodeHash === machineCodeHash);
  const reason = !record
    ? 'license_not_found'
    : record.revoked === true
      ? 'license_revoked'
      : record.machineCodeHash !== machineCodeHash
        ? 'machine_mismatch'
        : 'unlocked';
  auditActivation({
    event: 'activation_license_verified',
    status: 200,
    ip: meta.ip,
    userAgent: meta.userAgent,
    origin: meta.origin,
    orderId: match?.orderId ?? null,
    licenseId,
    activationId,
    machineCodeHash,
    valid,
    reason,
  });
  sendJson(response, 200, {
    ok: true,
    valid,
    reason,
    revokedAt: record?.revokedAt ?? null,
    cacheSeconds: valid ? 3600 : 60,
  }, headers);
};

const handleAdminUnbind = async (request, response, headers, meta) => {
  requireAdmin(request);
  const body = await readJsonBody(request);
  const orderId = String(body.orderId ?? '').trim();
  const qq = String(body.qq ?? '').trim();
  const licenseId = String(body.licenseId ?? '').trim();
  const activationId = String(body.activationId ?? '').trim();
  const machineCodeHash = String(body.machineCodeHash ?? '').trim().toLowerCase();
  if (!/^[0-9A-Za-z_-]{12,80}$/u.test(orderId)) {
    throw Object.assign(new Error('order_id_invalid'), { status: 400 });
  }
  if (qq && !/^[1-9][0-9]{4,11}$/u.test(qq)) {
    throw Object.assign(new Error('qq_invalid'), { status: 400 });
  }
  if (!qq && !activationId && !licenseId && !machineCodeHash) {
    throw Object.assign(new Error('unbind_selector_required'), { status: 400 });
  }

  const state = readBindings();
  const orderEntry = normalizeOrderEntry(state, orderId);
  const matches = orderEntry.activations.filter((record) =>
    record.revoked !== true && (
    (qq && record.qq === qq) ||
    (activationId && record.activationId === activationId) ||
    (licenseId && record.licenseId === licenseId) ||
    (machineCodeHash && record.machineCodeHash === machineCodeHash)),
  );
  if (matches.length === 0) {
    throw Object.assign(new Error('activation_not_found'), { status: 404 });
  }

  const revokedAt = new Date().toISOString();
  for (const record of matches) {
    record.revoked = true;
    record.revokedAt = revokedAt;
    record.revokedReason = String(body.reason ?? 'admin_unbind').slice(0, 120);
  }
  writeBindings(state);
  auditActivation({
    event: 'activation_admin_unbound',
    status: 200,
    ip: meta.ip,
    userAgent: meta.userAgent,
    origin: meta.origin,
    orderId,
    revokedCount: matches.length,
    licenseIds: matches.map((record) => record.licenseId),
    activationIds: matches.map((record) => record.activationId),
    machineCodeHashes: matches.map((record) => record.machineCodeHash),
  });
  sendJson(response, 200, {
    ok: true,
    orderId,
    revokedAt,
    revokedCount: matches.length,
    activeCount: orderEntry.activations.filter((record) => record.revoked !== true).length,
    maxActivations: maxActivationsPerOrder,
  }, headers);
};

const handleSelfUnbind = async (request, response, headers, meta) => {
  const body = await readJsonBody(request);
  const proKey = normalizeProKey(body.key ?? body.proKey);
  const proKeyQq = String(body.qq ?? '').trim();
  const orderId = String(body.orderId ?? '').trim();
  const qq = String(body.qq ?? '').trim();
  if (proKey) {
    if (!activationKeyPattern.test(proKey)) {
      throw Object.assign(new Error('invalid_key'), { status: 400 });
    }
    if (!/^[1-9][0-9]{4,11}$/u.test(proKeyQq)) {
      throw Object.assign(new Error('qq_invalid'), { status: 400 });
    }
    const keyHash = activationKeyHash(proKey);
    const cloudState = readCloudDatabase();
    const activationKey = cloudState.activationKeys.find((item) => item.keyHash === keyHash) ?? null;
    if (!activationKey) {
      throw Object.assign(new Error('key_rejected'), { status: 403 });
    }
    const state = readBindings();
    const entryId = `prokey_${activationKey.id}`;
    const orderEntry = normalizeOrderEntry(state, entryId);
    assertSelfUnbindCooldown(orderEntry);
    const matches = orderEntry.activations.filter((record) => record.revoked !== true && record.qq === proKeyQq);
    if (matches.length === 0) {
      throw Object.assign(new Error('activation_not_found'), { status: 404 });
    }

    const revokedAt = new Date().toISOString();
    for (const record of matches) {
      record.revoked = true;
      record.revokedAt = revokedAt;
      record.revokedReason = 'self_unbind_pro_key';
    }
    orderEntry.lastSelfUnbindAt = revokedAt;

    const redemptions = Array.isArray(activationKey.redemptions) ? activationKey.redemptions : [];
    const matchIds = new Set(matches.map((record) => record.activationId));
    const matchHwids = new Set(matches.map((record) => record.machineCodeHash));
    for (const redemption of redemptions) {
      if (
        redemption.revoked === true ||
        (!matchIds.has(redemption.activationId) && !matchHwids.has(redemption.hwidHash))
      ) {
        continue;
      }
      redemption.revoked = true;
      redemption.revokedAt = revokedAt;
      redemption.revokedReason = 'self_unbind_pro_key';
    }
    activationKey.redemptions = redemptions;
    activationKey.updatedAt = revokedAt;
    writeBindings(state);
    writeCloudDatabase(cloudState);
    auditActivation({
      event: 'pro_key_self_unbound',
      status: 200,
      ip: meta.ip,
      userAgent: meta.userAgent,
      origin: meta.origin,
      qq: proKeyQq,
      proKeyId: activationKey.id,
      keyPrefix: activationKey.keyPrefix ?? null,
      revokedCount: matches.length,
      licenseIds: matches.map((record) => record.licenseId),
      activationIds: matches.map((record) => record.activationId),
      machineCodeHashes: matches.map((record) => record.machineCodeHash),
    });
    sendJson(response, 200, {
      ok: true,
      mode: 'pro-key',
      revokedAt,
      revokedCount: matches.length,
      activeCount: orderEntry.activations.filter((record) => record.revoked !== true).length,
      maxActivations: Math.max(1, Number(activationKey.maxRedemptions || 1)),
      cooldownSeconds: Math.round(selfUnbindCooldownMs / 1000),
    }, headers);
    return;
  }

  if (!/^[0-9A-Za-z_-]{12,80}$/u.test(orderId)) {
    throw Object.assign(new Error('order_id_invalid'), { status: 400 });
  }
  if (!/^[1-9][0-9]{4,11}$/u.test(qq)) {
    throw Object.assign(new Error('qq_invalid'), { status: 400 });
  }

  const state = readBindings();
  const orderEntry = normalizeOrderEntry(state, orderId);
  assertSelfUnbindCooldown(orderEntry);
  const matches = orderEntry.activations.filter((record) => record.revoked !== true && record.qq === qq);
  if (matches.length === 0) {
    throw Object.assign(new Error('activation_not_found'), { status: 404 });
  }

  const revokedAt = new Date().toISOString();
  for (const record of matches) {
    record.revoked = true;
    record.revokedAt = revokedAt;
    record.revokedReason = 'self_unbind';
  }
  orderEntry.lastSelfUnbindAt = revokedAt;
  writeBindings(state);
  auditActivation({
    event: 'activation_self_unbound',
    status: 200,
    ip: meta.ip,
    userAgent: meta.userAgent,
    origin: meta.origin,
    orderId,
    qq,
    revokedCount: matches.length,
    licenseIds: matches.map((record) => record.licenseId),
    activationIds: matches.map((record) => record.activationId),
    machineCodeHashes: matches.map((record) => record.machineCodeHash),
  });
  sendJson(response, 200, {
    ok: true,
    orderId,
    revokedAt,
    revokedCount: matches.length,
    activeCount: orderEntry.activations.filter((record) => record.revoked !== true).length,
    maxActivations: maxActivationsPerOrder,
    cooldownSeconds: Math.round(selfUnbindCooldownMs / 1000),
  }, headers);
};

const pluginPermissionSet = new Set([
  'playback:read',
  'playback:control',
  'library:read',
  'library:write',
  'sources:provide',
  'settings:read',
  'settings:write',
  'audio:analyze',
  'network',
  'fs:plugin',
]);

const normalizeMarketPackage = (fileName) => {
  if (!fileName.endsWith('.echo')) {
    return null;
  }
  const filePath = join(pluginMarketDirectory, fileName);
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size > maxPluginMarketPackageBytes) {
    return null;
  }
  const text = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(text);
  const manifest = parsed?.manifest && typeof parsed.manifest === 'object' ? parsed.manifest : null;
  const id = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
  const name = typeof manifest?.name === 'string' ? manifest.name.trim() : '';
  const version = typeof manifest?.version === 'string' ? manifest.version.trim() : '';
  const apiVersion = Number.isFinite(manifest?.apiVersion) ? Math.max(1, Math.round(manifest.apiVersion)) : 1;
  if (parsed?.type !== 'echo-next-plugin-package' || parsed?.version !== 1 || !id || !name || !version) {
    return null;
  }
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions.filter((permission) => pluginPermissionSet.has(permission))
    : [];
  return {
    id,
    name,
    version,
    apiVersion,
    description: typeof manifest.description === 'string' && manifest.description.trim()
      ? manifest.description.trim().slice(0, 240)
      : null,
    permissions,
    checksum: hashText(text),
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
    fileName,
    filePath,
  };
};

const listPluginMarketPackages = () => {
  if (!existsSync(pluginMarketDirectory)) {
    return [];
  }
  const latestById = new Map();
  for (const fileName of readdirSync(pluginMarketDirectory)) {
    try {
      const entry = normalizeMarketPackage(fileName);
      if (!entry) {
        continue;
      }
      const current = latestById.get(entry.id);
      if (!current || String(entry.updatedAt).localeCompare(String(current.updatedAt)) > 0) {
        latestById.set(entry.id, entry);
      }
    } catch {
      // Ignore malformed packages so one bad upload does not hide the rest of the market.
    }
  }
  return [...latestById.values()].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
};

const sendPluginMarketList = (response, headers) => {
  const plugins = listPluginMarketPackages().map(({ filePath, fileName, ...entry }) => entry);
  sendJson(response, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    plugins,
  }, headers);
};

const sendPluginMarketPackage = (response, headers, pluginId) => {
  const entry = listPluginMarketPackages().find((item) => item.id === pluginId);
  if (!entry) {
    sendJson(response, 404, { ok: false, message: 'plugin_not_found' }, headers);
    return;
  }
  response.writeHead(200, {
    ...headers,
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${basename(entry.fileName)}"`,
    'x-echo-package-name': basename(entry.fileName),
    'x-echo-plugin-id': entry.id,
    'x-echo-plugin-version': entry.version,
    'x-echo-plugin-checksum': entry.checksum,
  });
  response.end(readFileSync(entry.filePath));
};

const server = createServer(async (request, response) => {
  const origin = request.headers.origin ?? '';
  const headers = corsHeaders(origin);
  const ip = String(request.headers['x-forwarded-for'] ?? request.socket.remoteAddress ?? '')
    .split(',')[0]
    .trim();
  const userAgent = String(request.headers['user-agent'] ?? '').slice(0, 240);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(response, 403, { ok: false, message: 'origin_not_allowed' }, headers);
    return;
  }
  if (request.method === 'GET' && path === '/api/echo-pro/plugins/market') {
    sendPluginMarketList(response, headers);
    return;
  }
  if (request.method === 'GET' && path.startsWith('/api/echo-pro/plugins/market/')) {
    const pluginId = decodeURIComponent(path.slice('/api/echo-pro/plugins/market/'.length));
    sendPluginMarketPackage(response, headers, pluginId);
    return;
  }
  if (request.method !== 'POST' || ![
    '/api/echo-pro/activate',
    '/api/echo-pro/keys/redeem',
    '/api/echo-pro/license/verify',
    '/api/echo-pro/unbind',
    '/api/echo-pro/admin/unbind',
  ].includes(path)) {
    sendJson(response, 404, { ok: false, message: 'not_found' }, headers);
    return;
  }

  let input = null;
  let record = null;
  try {
    const meta = { ip, userAgent, origin };
    if (path === '/api/echo-pro/license/verify') {
      await handleActivationVerify(request, response, headers, meta);
      return;
    }
    if (path === '/api/echo-pro/keys/redeem') {
      await handleProKeyRedeem(request, response, headers, meta);
      return;
    }
    if (path === '/api/echo-pro/unbind') {
      await handleSelfUnbind(request, response, headers, meta);
      return;
    }
    if (path === '/api/echo-pro/admin/unbind') {
      await handleAdminUnbind(request, response, headers, meta);
      return;
    }

    input = normalizeActivationRequest(await readJsonBody(request));
    const activationKey = deriveActivationKey(input.orderId);
    const activationKeyHash = hashText(activationKey);
    const bindingProof = deriveBindingProof({
      activationKey,
      qq: input.qq,
      machineCode: input.machineCode,
    });
    const state = readBindings();
    const orderEntry = normalizeOrderEntry(state, input.orderId);
    const existing = orderEntry.activations.find((item) => item.revoked !== true && item.bindingProof === bindingProof) ?? null;
    const activeCount = orderEntry.activations.filter((item) => item.revoked !== true).length;
    if (!existing && activeCount >= maxActivationsPerOrder) {
      throw Object.assign(new Error('order_activation_limit_exceeded'), { status: 409 });
    }

    const order = await queryAfdianOrder(input.orderId);
    assertOrderEligible(order);

    record = existing ?? createActivationRecord({
      orderId: input.orderId,
      qq: input.qq,
      machineCodeHash: input.machineCodeHash,
      activationKeyHash,
      bindingProof,
    });
    if (record.revoked) {
      throw Object.assign(new Error('license_revoked'), { status: 403 });
    }
    record.downloadCount = (record.downloadCount ?? 0) + 1;
    record.lastDownloadAt = new Date().toISOString();
    if (!existing) {
      orderEntry.activations.push(record);
    }
    writeBindings(state);

    const pluginPackage = buildPluginPackage(record);
    const fileName = `echo-pro-${input.orderId}.echo`;
    const activeCountAfterIssue = orderEntry.activations.filter((item) => item.revoked !== true).length;
    auditActivation({
      event: 'activation_package_issued',
      status: 200,
      ip,
      userAgent,
      origin,
      orderId: input.orderId,
      qq: input.qq,
      machineCodeHash: input.machineCodeHash,
      licenseId: record.licenseId,
      activationId: record.activationId,
      downloadCount: record.downloadCount,
      activeCount: activeCountAfterIssue,
      maxActivations: maxActivationsPerOrder,
      fileName,
    });
    response.writeHead(200, {
      ...headers,
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${fileName}"`,
      'x-echo-package-name': fileName,
      'x-echo-active-count': String(activeCountAfterIssue),
      'x-echo-max-activations': String(maxActivationsPerOrder),
      'x-echo-license-id': record.licenseId,
      'x-echo-activation-id': record.activationId,
    });
    response.end(`${JSON.stringify(pluginPackage, null, 2)}\n`);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    auditActivation({
      event: 'activation_package_failed',
      status,
      ip,
      userAgent,
      origin,
      ...(input
        ? {
          orderId: input.orderId,
          qq: input.qq,
          machineCodeHash: input.machineCodeHash,
        }
        : {}),
      ...(record
        ? {
          licenseId: record.licenseId,
          activationId: record.activationId,
        }
        : {}),
      message: error instanceof Error ? error.message : 'activation_failed',
    });
    sendJson(response, status, {
      ok: false,
      code: error instanceof Error ? error.message : 'activation_failed',
      message: error instanceof Error ? error.message : 'activation_failed',
      ...(typeof error.retryAt === 'string' ? { retryAt: error.retryAt } : {}),
      ...(Number.isFinite(error.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    }, headers);
  }
});

server.listen(port, host, () => {
  console.log(`ECHO Pro activation server listening on http://${host}:${port}/api/echo-pro/activate`);
});
