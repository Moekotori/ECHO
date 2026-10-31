import { createServer } from 'node:http';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const host = process.env.ECHO_PRO_BIND_HOST || '127.0.0.1';
const port = Number(process.env.ECHO_PRO_PORT || '8787');
const databasePath = process.env.ECHO_PRO_DB || '/var/lib/echo-pro/echo-pro.json';
const adminToken = process.env.ECHO_PRO_ADMIN_TOKEN || '';
const keyPepper = process.env.ECHO_PRO_KEY_PEPPER || '';
const allowPublicRegister = process.env.ECHO_PRO_ALLOW_PUBLIC_REGISTER !== 'false';
const maxRequestBodyBytes = Math.max(1024 * 1024, Number(process.env.ECHO_PRO_MAX_REQUEST_BODY_BYTES || 8 * 1024 * 1024));

const featureId = 'connect';
const pluginId = 'echo.connect-donator-unlock';
const requiredVersion = `plugin:${pluginId}:v1`;
const hwidHashPattern = /^[a-f0-9]{64}$/u;
const usernamePattern = /^[a-zA-Z0-9_.@-]{3,40}$/u;
const activationKeyPattern = /^ECHO-[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/u;
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const maxBoundMachines = Number(process.env.ECHO_PRO_MAX_BOUND_MACHINES || '2');
const selfUnbindCooldownMs = Math.max(0, Number.parseInt(process.env.ECHO_PRO_SELF_UNBIND_COOLDOWN_SECONDS || String(5 * 60 * 60), 10) || 0) * 1000;
const activationKeyAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const nowIso = () => new Date().toISOString();
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString('base64');

const verifyPassword = (password, salt, expectedHash) => safeEqual(passwordHash(password, salt), expectedHash);

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(payload)}\n`);
};

const readBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBodyBytes) {
      throw new Error('request_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const readJsonBody = async (request) => {
  const raw = await readBody(request);
  return raw ? JSON.parse(raw) : {};
};

const normalizeDatabase = (parsed) => ({
  version: 2,
  users: Array.isArray(parsed.users) ? parsed.users : [],
  sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  activationKeys: Array.isArray(parsed.activationKeys) ? parsed.activationKeys : [],
});

const normalizeHwidHash = (value) => {
  const hwidHash = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return hwidHashPattern.test(hwidHash) ? hwidHash : null;
};

const bindUserHwid = (user, hwidHash) => {
  if (!hwidHash) {
    return true;
  }
  const hwidHashes = Array.isArray(user.hwidHashes) ? user.hwidHashes : [];
  if (hwidHashes.includes(hwidHash)) {
    user.hwidHashes = hwidHashes;
    return true;
  }
  if (hwidHashes.length >= maxBoundMachines) {
    user.hwidHashes = hwidHashes;
    return false;
  }
  hwidHashes.push(hwidHash);
  user.hwidHashes = hwidHashes;
  return true;
};

const normalizeActivationKey = (value) => {
  const compact = typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/gu, '') : '';
  if (compact.startsWith('ECHO') && compact.length === 24) {
    const body = compact.slice(4);
    return `ECHO-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
  }
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
};

const activationKeyHash = (key) => {
  if (!keyPepper) {
    throw new Error('key_pepper_missing');
  }
  return sha256(`${keyPepper}:${normalizeActivationKey(key)}`);
};

const createRawActivationKey = () => {
  let body = '';
  while (body.length < 20) {
    const bytes = randomBytes(20);
    for (const byte of bytes) {
      body += activationKeyAlphabet[byte % activationKeyAlphabet.length];
      if (body.length >= 20) {
        break;
      }
    }
  }
  return `ECHO-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
};

const publicSettingsCloudStatus = (user) => {
  const cloud = user && typeof user.settingsCloud === 'object' && !Array.isArray(user.settingsCloud)
    ? user.settingsCloud
    : null;
  const settings = cloud && typeof cloud.settings === 'object' && !Array.isArray(cloud.settings)
    ? cloud.settings
    : null;
  const librarySync = cloud && typeof cloud.librarySync === 'object' && !Array.isArray(cloud.librarySync)
    ? cloud.librarySync
    : null;
  const streamingPlaylists = Array.isArray(librarySync?.streamingPlaylists) ? librarySync.streamingPlaylists : [];
  const streamingFavorites = librarySync && typeof librarySync.streamingFavorites === 'object' && !Array.isArray(librarySync.streamingFavorites)
    ? librarySync.streamingFavorites
    : null;
  const favoriteProviders = streamingFavorites && typeof streamingFavorites.providers === 'object' && !Array.isArray(streamingFavorites.providers)
    ? Object.values(streamingFavorites.providers)
    : [];
  const providerFavoriteTracks = favoriteProviders.reduce((total, tracks) => total + (Array.isArray(tracks) ? tracks.length : 0), 0);
  const favoriteCollections = Array.isArray(streamingFavorites?.collections) ? streamingFavorites.collections : [];
  const collectionFavoriteTracks = favoriteCollections.reduce((total, collection) => total + (Array.isArray(collection?.tracks) ? collection.tracks.length : 0), 0);
  return {
    available: settings !== null,
    lastSavedAt: typeof cloud?.lastSavedAt === 'string' ? cloud.lastSavedAt : null,
    appVersion: typeof cloud?.appVersion === 'string' ? cloud.appVersion : null,
    deviceName: typeof cloud?.deviceName === 'string' ? cloud.deviceName : null,
    settingsCount: settings ? Object.keys(settings).length : 0,
    librarySyncPlaylistCount: streamingPlaylists.length,
    librarySyncFavoriteTrackCount: providerFavoriteTracks + collectionFavoriteTracks,
  };
};

const loadDatabase = async () => {
  try {
    return normalizeDatabase(JSON.parse(await readFile(databasePath, 'utf8')));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { version: 2, users: [], sessions: [], activationKeys: [] };
    }
    throw error;
  }
};

const saveDatabase = async (database) => {
  await mkdir(dirname(databasePath), { recursive: true });
  const tempPath = `${databasePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  await rename(tempPath, databasePath);
};

const bearerToken = (request) => {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
};

const requireAdmin = (request) => {
  const token = bearerToken(request);
  return Boolean(adminToken && token && safeEqual(token, adminToken));
};

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName || user.username,
  status: user.status,
  pro: user.pro === true,
  machineCount: Array.isArray(user.hwidHashes) ? user.hwidHashes.length : 0,
  maxMachineCount: maxBoundMachines,
});

const normalizeUsername = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const normalizePassword = (value) => (typeof value === 'string' ? value : '');

const createSession = (database, user) => {
  const token = randomBytes(32).toString('base64url');
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  database.sessions.push({
    tokenHash: sha256(token),
    userId: user.id,
    issuedAt,
    expiresAt,
    lastSeenAt: issuedAt,
  });
  return { token, expiresAt };
};

const assertSelfUnbindCooldown = (user) => {
  if (selfUnbindCooldownMs <= 0 || !user.lastDeviceReleaseAt) {
    return null;
  }
  const last = Date.parse(user.lastDeviceReleaseAt);
  if (!Number.isFinite(last)) {
    return null;
  }
  const retryAtMs = last + selfUnbindCooldownMs;
  if (Date.now() >= retryAtMs) {
    return null;
  }
  return {
    retryAt: new Date(retryAtMs).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000)),
  };
};

const authenticateSession = (database, request) => {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }
  const tokenHash = sha256(token);
  const session = database.sessions.find((item) => item.tokenHash === tokenHash) || null;
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    database.sessions = database.sessions.filter((item) => item !== session);
    return null;
  }
  const user = database.users.find((item) => item.id === session.userId) || null;
  if (!user || user.status !== 'active') {
    return null;
  }
  session.lastSeenAt = nowIso();
  return { session, user };
};

const handleRegister = async (request, response) => {
  if (!allowPublicRegister) {
    sendJson(response, 403, { error: 'registration_disabled' });
    return;
  }

  const body = await readJsonBody(request);
  const username = normalizeUsername(body.username);
  const password = normalizePassword(body.password);
  const hwidHash = normalizeHwidHash(body.hwidHash);
  if (!usernamePattern.test(username) || password.length < 8 || password.length > 200) {
    sendJson(response, 400, { error: 'invalid_credentials' });
    return;
  }

  const database = await loadDatabase();
  if (database.users.some((user) => user.username === username)) {
    sendJson(response, 409, { error: 'username_taken' });
    return;
  }

  const salt = randomBytes(16).toString('base64url');
  const user = {
    id: randomBytes(16).toString('base64url'),
    username,
    displayName: username,
    passwordSalt: salt,
    passwordHash: passwordHash(password, salt),
    status: 'active',
    pro: false,
    hwidHashes: hwidHash ? [hwidHash] : [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  database.users.push(user);
  const session = createSession(database, user);
  await saveDatabase(database);
  sendJson(response, 201, { sessionToken: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
};

const handleLogin = async (request, response) => {
  const body = await readJsonBody(request);
  const username = normalizeUsername(body.username);
  const password = normalizePassword(body.password);
  const hwidHash = normalizeHwidHash(body.hwidHash);
  const database = await loadDatabase();
  const user = database.users.find((item) => item.username === username) || null;
  if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    sendJson(response, 401, { error: 'invalid_credentials' });
    return;
  }
  if (!bindUserHwid(user, hwidHash)) {
    await saveDatabase(database);
    sendJson(response, 403, { error: 'device_limit_reached', user: publicUser(user) });
    return;
  }
  user.updatedAt = nowIso();

  const session = createSession(database, user);
  await saveDatabase(database);
  sendJson(response, 200, { sessionToken: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
};

const handleMe = async (request, response) => {
  const database = await loadDatabase();
  const auth = authenticateSession(database, request);
  if (!auth) {
    await saveDatabase(database);
    sendJson(response, 401, { error: 'session_required' });
    return;
  }

  await saveDatabase(database);
  sendJson(response, 200, { user: publicUser(auth.user) });
};

const handleLogout = async (request, response) => {
  const token = bearerToken(request);
  const database = await loadDatabase();
  if (token) {
    const tokenHash = sha256(token);
    database.sessions = database.sessions.filter((item) => item.tokenHash !== tokenHash);
    await saveDatabase(database);
  }
  sendJson(response, 200, { ok: true });
};

const handleVerify = async (request, response) => {
  const body = await readJsonBody(request);
  const hwidHash = normalizeHwidHash(body.hwidHash);
  if (
    body.appId !== 'echo-next' ||
    body.featureId !== featureId ||
    body.pluginId !== pluginId ||
    body.requiredVersion !== requiredVersion ||
    body.authMode !== 'account' ||
    !hwidHash
  ) {
    sendJson(response, 400, { unlocked: false, reason: 'license-invalid' });
    return;
  }

  const database = await loadDatabase();
  const auth = authenticateSession(database, request);
  if (!auth || auth.user.pro !== true) {
    await saveDatabase(database);
    sendJson(response, 403, { unlocked: false, reason: 'license-invalid' });
    return;
  }

  if (!bindUserHwid(auth.user, hwidHash)) {
    await saveDatabase(database);
    sendJson(response, 403, { unlocked: false, reason: 'hwid-not-allowed', user: publicUser(auth.user) });
    return;
  }

  auth.user.lastVerifiedAt = nowIso();
  auth.user.lastAppVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 64) : '';
  auth.user.updatedAt = nowIso();
  await saveDatabase(database);
  sendJson(response, 200, { unlocked: true, reason: 'unlocked', cacheSeconds: 3600, user: publicUser(auth.user) });
};

const handleGetSettingsCloud = async (request, response) => {
  const database = await loadDatabase();
  const auth = authenticateSession(database, request);
  if (!auth || auth.user.pro !== true) {
    await saveDatabase(database);
    sendJson(response, 403, { error: 'pro_required' });
    return;
  }

  await saveDatabase(database);
  const status = publicSettingsCloudStatus(auth.user);
  sendJson(response, 200, {
    ...status,
    settings: status.available ? auth.user.settingsCloud.settings : null,
    librarySync: status.available && auth.user.settingsCloud.librarySync ? auth.user.settingsCloud.librarySync : null,
  });
};

const handlePutSettingsCloud = async (request, response) => {
  const body = await readJsonBody(request);
  const settings = body && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : null;
  const librarySync = body && typeof body.librarySync === 'object' && !Array.isArray(body.librarySync) ? body.librarySync : null;
  if (!settings) {
    sendJson(response, 400, { error: 'invalid_settings' });
    return;
  }

  const database = await loadDatabase();
  const auth = authenticateSession(database, request);
  if (!auth || auth.user.pro !== true) {
    await saveDatabase(database);
    sendJson(response, 403, { error: 'pro_required' });
    return;
  }

  const savedAt = nowIso();
  auth.user.settingsCloud = {
    settings,
    librarySync,
    lastSavedAt: savedAt,
    appVersion: typeof body.appVersion === 'string' ? body.appVersion.slice(0, 64) : null,
    deviceName: typeof body.deviceName === 'string' ? body.deviceName.slice(0, 120) : null,
  };
  auth.user.updatedAt = savedAt;
  await saveDatabase(database);
  sendJson(response, 200, publicSettingsCloudStatus(auth.user));
};

const handleRedeemKey = async (request, response) => {
  const body = await readJsonBody(request);
  const key = normalizeActivationKey(body.key);
  const hwidHash = normalizeHwidHash(body.hwidHash);
  if (!activationKeyPattern.test(key) || !keyPepper) {
    sendJson(response, 400, { error: 'invalid_key' });
    return;
  }
  if (!hwidHash) {
    sendJson(response, 400, { error: 'invalid_hwid' });
    return;
  }

  const database = await loadDatabase();
  const auth = authenticateSession(database, request);
  if (!auth) {
    await saveDatabase(database);
    sendJson(response, 401, { error: 'session_required' });
    return;
  }

  const keyHash = activationKeyHash(key);
  const activationKey = database.activationKeys.find((item) => item.keyHash === keyHash) || null;
  const now = nowIso();
  if (!activationKey || activationKey.disabled === true || (activationKey.expiresAt && Date.parse(activationKey.expiresAt) <= Date.now())) {
    await saveDatabase(database);
    sendJson(response, 403, { error: 'key_rejected' });
    return;
  }

  const redemptions = Array.isArray(activationKey.redemptions) ? activationKey.redemptions : [];
  const activeRedemptions = redemptions.filter((item) => item.revoked !== true);
  const existingRedemption = activeRedemptions.find((item) => item.userId === auth.user.id) || null;
  if (!existingRedemption && activeRedemptions.length >= Math.max(1, Number(activationKey.maxRedemptions || 1))) {
    await saveDatabase(database);
    sendJson(response, 403, { error: 'key_already_used' });
    return;
  }

  if (!bindUserHwid(auth.user, hwidHash)) {
    await saveDatabase(database);
    sendJson(response, 403, { error: 'device_limit_reached', user: publicUser(auth.user) });
    return;
  }

  if (!existingRedemption) {
    redemptions.push({
      userId: auth.user.id,
      username: auth.user.username,
      hwidHash,
      redeemedAt: now,
    });
    activationKey.redemptions = redemptions;
    activationKey.updatedAt = now;
  }
  auth.user.pro = true;
  auth.user.status = 'active';
  auth.user.proGrantedBy = 'activation-key';
  auth.user.proKeyId = activationKey.id;
  auth.user.updatedAt = now;
  await saveDatabase(database);
  sendJson(response, 200, { ok: true, redeemedAt: existingRedemption?.redeemedAt || now, user: publicUser(auth.user) });
};

const handleReleaseDevices = async (request, response) => {
  const body = await readJsonBody(request);
  const password = normalizePassword(body.password);
  const database = await loadDatabase();
  const auth = authenticateSession(database, request);
  if (!auth) {
    await saveDatabase(database);
    sendJson(response, 401, { error: 'session_required' });
    return;
  }
  if (!password || !verifyPassword(password, auth.user.passwordSalt, auth.user.passwordHash)) {
    await saveDatabase(database);
    sendJson(response, 401, { error: 'invalid_credentials' });
    return;
  }
  const cooldown = assertSelfUnbindCooldown(auth.user);
  if (cooldown) {
    await saveDatabase(database);
    sendJson(response, 429, { error: 'release_cooldown', ...cooldown });
    return;
  }

  const releasedCount = Array.isArray(auth.user.hwidHashes) ? auth.user.hwidHashes.length : 0;
  auth.user.hwidHashes = [];
  auth.user.lastDeviceReleaseAt = nowIso();
  auth.user.updatedAt = auth.user.lastDeviceReleaseAt;
  database.sessions = database.sessions.filter((session) => session.userId !== auth.user.id || session === auth.session);
  await saveDatabase(database);
  sendJson(response, 200, {
    ok: true,
    releasedAt: auth.user.updatedAt,
    releasedCount,
    user: publicUser(auth.user),
  });
};

const handleAdminKeys = async (request, response) => {
  if (!requireAdmin(request)) {
    sendJson(response, 401, { error: 'admin_token_required' });
    return;
  }
  if (!keyPepper) {
    sendJson(response, 500, { error: 'key_pepper_missing' });
    return;
  }

  const body = await readJsonBody(request);
  const count = Math.max(1, Math.min(100, Math.round(Number(body.count || 1))));
  const maxRedemptions = Math.max(1, Math.min(50, Math.round(Number(body.maxRedemptions || 1))));
  const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt.trim() ? body.expiresAt.trim() : null;
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) {
    sendJson(response, 400, { error: 'invalid_expires_at' });
    return;
  }

  const database = await loadDatabase();
  const createdAt = nowIso();
  const keys = [];
  for (let index = 0; index < count; index += 1) {
    let rawKey = createRawActivationKey();
    let keyHashValue = activationKeyHash(rawKey);
    while (database.activationKeys.some((item) => item.keyHash === keyHashValue)) {
      rawKey = createRawActivationKey();
      keyHashValue = activationKeyHash(rawKey);
    }
    const record = {
      id: randomBytes(12).toString('base64url'),
      keyHash: keyHashValue,
      keyPrefix: rawKey.slice(0, 15),
      maxRedemptions,
      redemptions: [],
      note: typeof body.note === 'string' ? body.note.slice(0, 200) : '',
      expiresAt,
      disabled: false,
      createdAt,
      updatedAt: createdAt,
    };
    database.activationKeys.push(record);
    keys.push({
      id: record.id,
      key: rawKey,
      maxRedemptions,
      expiresAt,
      createdAt,
    });
  }

  await saveDatabase(database);
  sendJson(response, 201, { keys });
};

const handleAdminUser = async (request, response) => {
  if (!requireAdmin(request)) {
    sendJson(response, 401, { error: 'admin_token_required' });
    return;
  }

  const body = await readJsonBody(request);
  const username = normalizeUsername(body.username);
  if (!usernamePattern.test(username)) {
    sendJson(response, 400, { error: 'invalid_username' });
    return;
  }

  const database = await loadDatabase();
  const user = database.users.find((item) => item.username === username) || null;
  if (!user) {
    sendJson(response, 404, { error: 'user_not_found' });
    return;
  }

  if (typeof body.pro === 'boolean') {
    user.pro = body.pro;
  }
  if (body.status === 'active' || body.status === 'inactive' || body.status === 'disabled') {
    user.status = body.status;
  }
  if (body.resetMachines === true) {
    user.hwidHashes = [];
  }
  user.updatedAt = nowIso();
  await saveDatabase(database);
  sendJson(response, 200, { user: publicUser(user) });
};

const handleRequest = async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/auth/register') {
      await handleRegister(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/auth/login') {
      await handleLogin(request, response);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/echo-pro/auth/me') {
      await handleMe(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/auth/logout') {
      await handleLogout(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/verify') {
      await handleVerify(request, response);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/echo-pro/settings/cloud') {
      await handleGetSettingsCloud(request, response);
      return;
    }
    if (request.method === 'PUT' && url.pathname === '/api/echo-pro/settings/cloud') {
      await handlePutSettingsCloud(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/keys/redeem') {
      await handleRedeemKey(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/devices/release-all') {
      await handleReleaseDevices(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/admin/keys') {
      await handleAdminKeys(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/echo-pro/admin/users') {
      await handleAdminUser(request, response);
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  } catch {
    sendJson(response, 500, { error: 'internal_error' });
  }
};

createServer((request, response) => {
  void handleRequest(request, response);
}).listen(port, host, () => {
  console.log(`ECHO Pro account verifier listening on http://${host}:${port}`);
});
