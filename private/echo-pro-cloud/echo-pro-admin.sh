#!/usr/bin/env bash
set -euo pipefail

env_file="${ECHO_PRO_ENV_FILE:-/etc/echo-pro-cloud.env}"
if [[ -f "${env_file}" ]]; then
  # shellcheck disable=SC1090
  source "${env_file}"
fi

activation_env_file="${ECHO_PRO_ACTIVATION_ENV_FILE:-/etc/echo-pro-activation.env}"
if [[ -f "${activation_env_file}" ]]; then
  # shellcheck disable=SC1090
  source "${activation_env_file}"
fi

api_base="${ECHO_PRO_ADMIN_API_BASE:-http://127.0.0.1:${ECHO_PRO_PORT:-8787}/api/echo-pro}"
db_path="${ECHO_PRO_DB:-/var/lib/echo-pro/echo-pro.json}"
activation_db_path="${ECHO_PRO_ACTIVATION_BINDINGS_FILE:-/var/lib/echo-pro-activation/activations.json}"
activation_audit_log_path="${ECHO_PRO_ACTIVATION_AUDIT_LOG_FILE:-/var/lib/echo-pro-activation/audit.jsonl}"
plugin_market_dir="${ECHO_PRO_PLUGIN_MARKET_DIR:-/var/lib/echo-pro-activation/plugin-market}"
backup_dir="${ECHO_PRO_BACKUP_DIR:-/var/backups/echo-pro}"
admin_token="${ECHO_PRO_ADMIN_TOKEN:-}"

if [[ -t 1 ]]; then
  bold=$'\033[1m'
  dim=$'\033[2m'
  green=$'\033[32m'
  yellow=$'\033[33m'
  red=$'\033[31m'
  reset=$'\033[0m'
else
  bold=""
  dim=""
  green=""
  yellow=""
  red=""
  reset=""
fi

die() {
  echo "${red}Error:${reset} $*" >&2
  exit 1
}

require_token() {
  if [[ -z "${admin_token}" ]]; then
    die "Missing ECHO_PRO_ADMIN_TOKEN. Check ${env_file}."
  fi
}

require_db() {
  if [[ ! -f "${db_path}" ]]; then
    die "Database not found: ${db_path}"
  fi
}

require_activation_db() {
  if [[ ! -f "${activation_db_path}" ]]; then
    die "Activation database not found: ${activation_db_path}"
  fi
}

backup_file() {
  local file="$1"
  local label="$2"
  mkdir -p "${backup_dir}"
  cp "${file}" "${backup_dir}/${label}-$(date +%Y%m%d-%H%M%S).json"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf '%s' "${value}"
}

read_required() {
  local prompt="$1"
  local value=""
  while [[ -z "${value}" ]]; do
    read -r -p "${prompt}" value
  done
  printf '%s' "${value}"
}

read_default() {
  local prompt="$1"
  local fallback="$2"
  local value=""
  read -r -p "${prompt}" value
  printf '%s' "${value:-${fallback}}"
}

curl_json() {
  local path="$1"
  local payload="$2"
  require_token
  curl -sS "${api_base}${path}" \
    -H "authorization: Bearer ${admin_token}" \
    -H "content-type: application/json" \
    -d "${payload}"
}

copy_text_file() {
  local file="$1"
  if command -v wl-copy >/dev/null 2>&1; then
    wl-copy < "${file}" && echo "${green}Copied to clipboard via wl-copy.${reset}" && return 0
  fi
  if command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard < "${file}" && echo "${green}Copied to clipboard via xclip.${reset}" && return 0
  fi
  if command -v xsel >/dev/null 2>&1; then
    xsel --clipboard --input < "${file}" && echo "${green}Copied to clipboard via xsel.${reset}" && return 0
  fi
  if command -v pbcopy >/dev/null 2>&1; then
    pbcopy < "${file}" && echo "${green}Copied to clipboard via pbcopy.${reset}" && return 0
  fi
  if command -v clip.exe >/dev/null 2>&1; then
    clip.exe < "${file}" && echo "${green}Copied to clipboard via clip.exe.${reset}" && return 0
  fi
  echo "${yellow}No clipboard command found. Copy from the block above or file below.${reset}"
  return 1
}

format_generated_keys() {
  local json_file="$1"
  local output_file="$2"
  node - "${json_file}" "${output_file}" <<'NODE'
const fs = require('fs');
const inputPath = process.argv[2];
const outputPath = process.argv[3];
const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(payload.keys)) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.error ? 1 : 0);
}
const keys = payload.keys.map((item) => item.key);
const rows = payload.keys.map((item, index) => {
  const expires = item.expiresAt ? ` expires=${item.expiresAt}` : '';
  return `${String(index + 1).padStart(2, '0')}. ${item.key} uses=${item.maxRedemptions}${expires}`;
});
const text = [
  `ECHO Pro Keys (${keys.length})`,
  ...rows,
  '',
  'Copy block:',
  ...keys,
  '',
].join('\n');
fs.writeFileSync(outputPath, text);
process.stdout.write(text);
NODE
}

generate_keys_payload() {
  local count="$1"
  local max_redemptions="$2"
  local note="$3"
  local expires_at="$4"
  local payload
  payload="{\"count\":${count},\"maxRedemptions\":${max_redemptions},\"note\":\"$(json_escape "${note}")\""
  if [[ -n "${expires_at}" ]]; then
    payload+=",\"expiresAt\":\"$(json_escape "${expires_at}")\""
  fi
  payload+="}"
  printf '%s' "${payload}"
}

generate_keys() {
  local count="1"
  local max_redemptions="1"
  local note="manual batch"
  local expires_at=""
  local copy="auto"
  local raw_json="0"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -c|--count) count="${2:-}"; shift 2 ;;
      -r|--redemptions|--max-redemptions) max_redemptions="${2:-}"; shift 2 ;;
      -n|--note) note="${2:-}"; shift 2 ;;
      -e|--expires-at) expires_at="${2:-}"; shift 2 ;;
      --copy) copy="yes"; shift ;;
      --no-copy) copy="no"; shift ;;
      --json) raw_json="1"; shift ;;
      -h|--help) keys_help; return 0 ;;
      *)
        if [[ "$1" =~ ^[0-9]+$ ]]; then
          count="$1"
          shift
        else
          die "Unknown keys option: $1"
        fi
        ;;
    esac
  done

  [[ "${count}" =~ ^[0-9]+$ ]] || die "count must be a number."
  [[ "${max_redemptions}" =~ ^[0-9]+$ ]] || die "max redemptions must be a number."
  if (( count < 1 || count > 100 )); then die "count must be 1-100."; fi
  if (( max_redemptions < 1 || max_redemptions > 50 )); then die "max redemptions must be 1-50."; fi

  local payload response_file output_file
  payload="$(generate_keys_payload "${count}" "${max_redemptions}" "${note}" "${expires_at}")"
  response_file="$(mktemp)"
  output_file="/tmp/echo-pro-keys-$(date +%Y%m%d-%H%M%S).txt"
  curl_json "/admin/keys" "${payload}" > "${response_file}"

  if [[ "${raw_json}" == "1" ]]; then
    cat "${response_file}"
    echo
    return 0
  fi

  echo "${bold}${green}Generated ${count} ECHO Pro key(s).${reset}"
  format_generated_keys "${response_file}" "${output_file}"
  echo "${dim}Saved: ${output_file}${reset}"
  if [[ "${copy}" != "no" ]]; then
    copy_text_file "${output_file}" >/dev/null || true
  fi
}

generate_keys_interactive() {
  local count max_redemptions note expires_at
  count="$(read_default "批量数量 [10]: " "10")"
  max_redemptions="$(read_default "每个 Key 可兑换次数 [1]: " "1")"
  note="$(read_default "备注 [manual batch]: " "manual batch")"
  read -r -p "过期时间 ISO，可留空: " expires_at
  generate_keys --count "${count}" --redemptions "${max_redemptions}" --note "${note}" --expires-at "${expires_at}"
}

set_user_pro() {
  local username enabled payload
  username="${1:-}"
  enabled="${2:-}"
  if [[ -z "${username}" ]]; then
    username="$(read_required "用户名/QQ号: ")"
  fi
  if [[ -z "${enabled}" ]]; then
    read -r -p "开启 Pro? [Y/n]: " enabled
  fi
  case "${enabled:-Y}" in
    n|N|no|NO|off|OFF|false|FALSE|0) payload="{\"username\":\"$(json_escape "${username}")\",\"pro\":false}" ;;
    *) payload="{\"username\":\"$(json_escape "${username}")\",\"pro\":true}" ;;
  esac
  curl_json "/admin/users" "${payload}"
  echo
}

reset_user_devices() {
  local username
  username="${1:-}"
  if [[ -z "${username}" ]]; then
    username="$(read_required "要解绑所有设备的用户名/QQ号: ")"
  fi
  curl_json "/admin/users" "{\"username\":\"$(json_escape "${username}")\",\"resetMachines\":true}"
  echo
}

set_user_status() {
  local username status
  username="${1:-}"
  status="${2:-}"
  if [[ -z "${username}" ]]; then
    username="$(read_required "用户名/QQ号: ")"
  fi
  if [[ -z "${status}" ]]; then
    status="$(read_default "状态 active/inactive/disabled [disabled]: " "disabled")"
  fi
  curl_json "/admin/users" "{\"username\":\"$(json_escape "${username}")\",\"status\":\"$(json_escape "${status}")\"}"
  echo
}

show_user_local() {
  local username
  require_db
  username="${1:-}"
  if [[ -z "${username}" ]]; then
    username="$(read_required "用户名/QQ号: ")"
  fi
  node - "${db_path}" "${username}" <<'NODE'
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const username = process.argv[3].trim().toLowerCase();
const user = (db.users || []).find((item) => item.username === username);
if (!user) {
  console.log('user_not_found');
  process.exit(1);
}
const sessions = (db.sessions || []).filter((item) => item.userId === user.id);
console.log(JSON.stringify({
  id: user.id,
  username: user.username,
  status: user.status,
  pro: user.pro === true,
  machineCount: Array.isArray(user.hwidHashes) ? user.hwidHashes.length : 0,
  hwidHashes: user.hwidHashes || [],
  sessions: sessions.length,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastVerifiedAt: user.lastVerifiedAt || null,
  settingsCloud: user.settingsCloud ? {
    lastSavedAt: user.settingsCloud.lastSavedAt || null,
    appVersion: user.settingsCloud.appVersion || null,
    deviceName: user.settingsCloud.deviceName || null
  } : null
}, null, 2));
NODE
}

list_users_local() {
  require_db
  node - "${db_path}" "${1:-}" <<'NODE'
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const query = (process.argv[3] || '').trim().toLowerCase();
const users = (db.users || [])
  .filter((user) => !query || user.username.includes(query) || String(user.id).includes(query))
  .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
console.log('username\tpro\tstatus\tmachines\tsessions\tupdated');
for (const user of users) {
  const machines = Array.isArray(user.hwidHashes) ? user.hwidHashes.length : 0;
  const sessions = (db.sessions || []).filter((item) => item.userId === user.id).length;
  console.log(`${user.username}\t${user.pro === true}\t${user.status}\t${machines}\t${sessions}\t${user.updatedAt || ''}`);
}
NODE
}

search_users_local() {
  local query
  query="$(read_required "搜索用户名/ID: ")"
  list_users_local "${query}"
}

list_keys_local() {
  require_db
  node - "${db_path}" "${1:-}" <<'NODE'
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const query = (process.argv[3] || '').trim().toLowerCase();
const keys = (db.activationKeys || [])
  .filter((key) => !query || String(key.id).includes(query) || String(key.keyPrefix).toLowerCase().includes(query) || String(key.note || '').toLowerCase().includes(query))
  .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
console.log('id\tprefix\tused/max\tdisabled\texpires\tnote');
for (const key of keys) {
  const used = Array.isArray(key.redemptions) ? key.redemptions.length : 0;
  console.log(`${key.id}\t${key.keyPrefix || ''}\t${used}/${key.maxRedemptions || 1}\t${key.disabled === true}\t${key.expiresAt || ''}\t${key.note || ''}`);
}
NODE
}

search_keys_local() {
  local query
  read -r -p "搜索 Key ID / prefix / 备注（留空列出全部）: " query
  list_keys_local "${query}"
}

key_stats_local() {
  require_db
  node - "${db_path}" <<'NODE'
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const keys = db.activationKeys || [];
const users = db.users || [];
const used = keys.filter((key) => Array.isArray(key.redemptions) && key.redemptions.length > 0).length;
const disabled = keys.filter((key) => key.disabled === true).length;
const expired = keys.filter((key) => key.expiresAt && Date.parse(key.expiresAt) <= Date.now()).length;
const proUsers = users.filter((user) => user.pro === true).length;
const activeUsers = users.filter((user) => user.status === 'active').length;
console.log(JSON.stringify({
  users: users.length,
  activeUsers,
  proUsers,
  keys: keys.length,
  usedKeys: used,
  unusedKeys: keys.length - used,
  disabledKeys: disabled,
  expiredKeys: expired,
  sessions: (db.sessions || []).length,
  updatedAt: db.updatedAt || null
}, null, 2));
NODE
}

change_key_disabled_local() {
  local disabled="$1"
  local key_ref
  require_db
  key_ref="${2:-}"
  if [[ -z "${key_ref}" ]]; then
    key_ref="$(read_required "Key ID 或 prefix: ")"
  fi
  mkdir -p "${backup_dir}"
  cp "${db_path}" "${backup_dir}/echo-pro-before-key-edit-$(date +%Y%m%d-%H%M%S).json"
  node - "${db_path}" "${key_ref}" "${disabled}" <<'NODE'
const fs = require('fs');
const dbPath = process.argv[2];
const ref = process.argv[3].trim();
const disabled = process.argv[4] === 'true';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const key = (db.activationKeys || []).find((item) => item.id === ref || String(item.keyPrefix || '').startsWith(ref));
if (!key) {
  console.error('key_not_found');
  process.exit(1);
}
key.disabled = disabled;
key.updatedAt = new Date().toISOString();
db.updatedAt = key.updatedAt;
fs.writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, id: key.id, keyPrefix: key.keyPrefix, disabled: key.disabled }, null, 2));
NODE
  systemctl try-reload-or-restart echo-pro-cloud.service >/dev/null 2>&1 || true
}

list_hwids_local() {
  require_db
  node - "${db_path}" "${activation_db_path}" "${1:-}" <<'NODE'
const fs = require('fs');
const [dbPath, activationPath, rawQuery = ''] = process.argv.slice(2);
const query = rawQuery.trim().toLowerCase();
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
let activationDb = { activations: {} };
try {
  activationDb = JSON.parse(fs.readFileSync(activationPath, 'utf8'));
} catch {}
const rows = [];
for (const user of db.users || []) {
  for (const hwidHash of user.hwidHashes || []) {
    rows.push({
      source: 'account',
      owner: user.username,
      pro: user.pro === true,
      status: user.status,
      hwidHash,
      updatedAt: user.updatedAt || user.createdAt || '',
    });
  }
}
for (const [orderId, entry] of Object.entries(activationDb.activations || {})) {
  const records = Array.isArray(entry?.activations) ? entry.activations : [];
  for (const record of records) {
    rows.push({
      source: 'afdian',
      owner: `${orderId}/${record.qq || ''}`,
      pro: record.revoked !== true,
      status: record.revoked === true ? 'revoked' : 'active',
      hwidHash: record.machineCodeHash || '',
      updatedAt: record.revokedAt || record.issuedAt || '',
    });
  }
}
const filtered = rows
  .filter((row) => !query || Object.values(row).some((value) => String(value).toLowerCase().includes(query)))
  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
console.log('source\towner\tstatus/pro\thwidHash\tupdated');
for (const row of filtered) {
  console.log(`${row.source}\t${row.owner}\t${row.status}/${row.pro}\t${row.hwidHash}\t${row.updatedAt}`);
}
NODE
}

list_authorized_users_local() {
  require_db
  node - "${db_path}" "${activation_db_path}" "${1:-}" <<'NODE'
const fs = require('fs');
const [dbPath, activationPath, rawQuery = ''] = process.argv.slice(2);
const query = rawQuery.trim().toLowerCase();
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
let activationDb = { activations: {} };
try {
  activationDb = JSON.parse(fs.readFileSync(activationPath, 'utf8'));
} catch {}

const shorten = (value, left = 10, right = 6) => {
  const text = String(value || '');
  return text.length > left + right + 3 ? `${text.slice(0, left)}...${text.slice(-right)}` : text;
};
const rows = [];
for (const user of db.users || []) {
  const hwids = Array.isArray(user.hwidHashes) ? user.hwidHashes : [];
  rows.push({
    kind: 'account',
    qq: user.username || '',
    source: user.proKeyId ? `pro-key:${user.proKeyId}` : 'account',
    state: `${user.status || 'unknown'}/${user.pro === true ? 'pro' : 'free'}`,
    active: hwids.length,
    total: hwids.length,
    hwids,
    licenseIds: [],
    activationIds: [],
    updatedAt: user.updatedAt || user.createdAt || '',
  });
}
for (const [entryId, entry] of Object.entries(activationDb.activations || {})) {
  const records = Array.isArray(entry?.activations) ? entry.activations : [];
  const groups = new Map();
  for (const record of records) {
    const qq = String(record.qq || '');
    const groupKey = `${entryId}\t${qq}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        kind: record.source === 'pro-key' || entry?.source === 'pro-key' || entryId.startsWith('prokey_') ? 'pro-key' : 'afdian',
        qq,
        source: record.source === 'pro-key' || entry?.source === 'pro-key' || entryId.startsWith('prokey_')
          ? `key:${record.proKeyPrefix || entry.proKeyPrefix || record.proKeyId || entry.proKeyId || entryId.replace(/^prokey_/, '')}`
          : `order:${entryId}`,
        state: 'active',
        active: 0,
        total: 0,
        hwids: [],
        licenseIds: [],
        activationIds: [],
        updatedAt: '',
      });
    }
    const group = groups.get(groupKey);
    group.total += 1;
    if (record.revoked !== true) {
      group.active += 1;
      if (record.machineCodeHash) group.hwids.push(record.machineCodeHash);
      if (record.licenseId) group.licenseIds.push(record.licenseId);
      if (record.activationId) group.activationIds.push(record.activationId);
    }
    const last = record.revokedAt || record.lastDownloadAt || record.issuedAt || '';
    if (String(last).localeCompare(String(group.updatedAt)) > 0) group.updatedAt = last;
  }
  for (const group of groups.values()) {
    group.state = group.active > 0 ? 'active' : 'revoked';
    rows.push(group);
  }
}

const filtered = rows
  .filter((row) => !query || [
    row.kind,
    row.qq,
    row.source,
    row.state,
    row.updatedAt,
    ...row.hwids,
    ...row.licenseIds,
    ...row.activationIds,
  ].some((value) => String(value || '').toLowerCase().includes(query)))
  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

console.log('kind\tqq/user\tsource\tstate\tactive/total\thwids\tlicenses\tupdated');
for (const row of filtered) {
  const hwids = row.hwids.map((item) => shorten(item)).join(',');
  const licenses = row.licenseIds.map((item) => shorten(item, 12, 4)).join(',');
  console.log(`${row.kind}\t${row.qq}\t${row.source}\t${row.state}\t${row.active}/${row.total}\t${hwids}\t${licenses}\t${row.updatedAt}`);
}
NODE
}

search_authorization_local() {
  local query
  query="${1:-}"
  if [[ -z "${query}" ]]; then
    query="$(read_required "搜索 QQ / HWID / 订单号 / Key / license / activation: ")"
  fi
  list_authorized_users_local "${query}"
}

recent_authorization_events_local() {
  local limit
  limit="${1:-}"
  if [[ -z "${limit}" ]]; then
    limit="$(read_default "显示最近多少条授权事件 [30]: " "30")"
  fi
  if [[ ! "${limit}" =~ ^[0-9]+$ ]]; then
    die "limit must be a number."
  fi
  if [[ ! -f "${activation_audit_log_path}" ]]; then
    die "Activation audit log not found: ${activation_audit_log_path}"
  fi
  node - "${activation_audit_log_path}" "${limit}" <<'NODE'
const fs = require('fs');
const [auditPath, rawLimit] = process.argv.slice(2);
const limit = Math.max(1, Math.min(200, Number(rawLimit) || 30));
const lines = fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/u).filter(Boolean);
const events = lines.slice(-limit).map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}).filter(Boolean).reverse();
const shorten = (value) => {
  const text = String(value || '');
  return text.length > 18 ? `${text.slice(0, 12)}...${text.slice(-4)}` : text;
};
console.log('time\tevent\tqq/source\tlicense\tactivation\thwid/ip\tstatus');
for (const event of events) {
  const source = event.qq || event.orderId || event.proKeyId || event.keyPrefix || '';
  const license = Array.isArray(event.licenseIds) ? event.licenseIds.map(shorten).join(',') : shorten(event.licenseId);
  const activation = Array.isArray(event.activationIds) ? event.activationIds.map(shorten).join(',') : shorten(event.activationId);
  const hwid = Array.isArray(event.machineCodeHashes) ? event.machineCodeHashes.map(shorten).join(',') : shorten(event.machineCodeHash || event.ip);
  console.log(`${event.at || ''}\t${event.event || ''}\t${source}\t${license}\t${activation}\t${hwid}\t${event.reason || event.message || event.status || ''}`);
}
NODE
}

remove_user_hwid_local() {
  local username hwid
  require_db
  username="${1:-}"
  hwid="${2:-}"
  if [[ -z "${username}" ]]; then
    username="$(read_required "Username/QQ: ")"
  fi
  if [[ -z "${hwid}" ]]; then
    hwid="$(read_required "HWID hash to remove: ")"
  fi
  backup_file "${db_path}" "echo-pro-before-hwid-remove"
  node - "${db_path}" "${username}" "${hwid}" <<'NODE'
const fs = require('fs');
const [dbPath, rawUsername, rawHwid] = process.argv.slice(2);
const username = rawUsername.trim().toLowerCase();
const hwid = rawHwid.trim().toLowerCase();
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const user = (db.users || []).find((item) => item.username === username);
if (!user) {
  console.error('user_not_found');
  process.exit(1);
}
const before = Array.isArray(user.hwidHashes) ? user.hwidHashes : [];
const after = before.filter((item) => item !== hwid);
if (after.length === before.length) {
  console.error('hwid_not_found');
  process.exit(1);
}
user.hwidHashes = after;
user.updatedAt = new Date().toISOString();
db.updatedAt = user.updatedAt;
fs.writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, username: user.username, removed: hwid, remaining: after }, null, 2));
NODE
}

list_orders_local() {
  require_activation_db
  node - "${activation_db_path}" "${1:-}" <<'NODE'
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const query = (process.argv[3] || '').trim().toLowerCase();
const entries = Object.entries(db.activations || {}).map(([orderId, entry]) => {
  const records = Array.isArray(entry?.activations) ? entry.activations : [];
  const active = records.filter((record) => record.revoked !== true);
  const qqs = [...new Set(records.map((record) => record.qq).filter(Boolean))].join(',');
  const last = records.map((record) => record.revokedAt || record.lastDownloadAt || record.issuedAt || '').sort().at(-1) || '';
  return { orderId, qqs, active: active.length, total: records.length, last };
}).filter((row) => !query || row.orderId.toLowerCase().includes(query) || row.qqs.toLowerCase().includes(query))
  .sort((a, b) => String(b.last).localeCompare(String(a.last)));
console.log('orderId\tqq\tactive/total\tlast');
for (const row of entries) {
  console.log(`${row.orderId}\t${row.qqs}\t${row.active}/${row.total}\t${row.last}`);
}
NODE
}

show_order_local() {
  local order_id
  require_activation_db
  order_id="${1:-}"
  if [[ -z "${order_id}" ]]; then
    order_id="$(read_required "Afdian order id: ")"
  fi
  node - "${activation_db_path}" "${order_id}" <<'NODE'
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const orderId = process.argv[3].trim();
const entry = db.activations?.[orderId];
if (!entry) {
  console.log('order_not_found');
  process.exit(1);
}
const records = Array.isArray(entry.activations) ? entry.activations : [];
console.log(JSON.stringify({
  orderId,
  activeCount: records.filter((record) => record.revoked !== true).length,
  totalCount: records.length,
  activations: records.map((record) => ({
    qq: record.qq,
    licenseId: record.licenseId,
    activationId: record.activationId,
    machineCodeHash: record.machineCodeHash,
    issuedAt: record.issuedAt,
    lastDownloadAt: record.lastDownloadAt || null,
    downloadCount: record.downloadCount || 0,
    revoked: record.revoked === true,
    revokedAt: record.revokedAt || null,
    revokedReason: record.revokedReason || null,
  })),
}, null, 2));
NODE
}

revoke_order_activation_local() {
  local order_id selector reason
  require_activation_db
  order_id="${1:-}"
  selector="${2:-}"
  reason="${3:-admin_shell_revoke}"
  if [[ -z "${order_id}" ]]; then
    order_id="$(read_required "Afdian order id: ")"
  fi
  if [[ -z "${selector}" ]]; then
    selector="$(read_default "Selector (all / qq / licenseId / activationId / hwid) [all]: " "all")"
  fi
  backup_file "${activation_db_path}" "echo-pro-activation-before-revoke"
  node - "${activation_db_path}" "${order_id}" "${selector}" "${reason}" <<'NODE'
const fs = require('fs');
const [dbPath, orderId, selector, reason] = process.argv.slice(2);
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const entry = db.activations?.[orderId];
if (!entry || !Array.isArray(entry.activations)) {
  console.error('order_not_found');
  process.exit(1);
}
const now = new Date().toISOString();
let count = 0;
for (const record of entry.activations) {
  const match = selector === 'all'
    || record.qq === selector
    || record.licenseId === selector
    || record.activationId === selector
    || record.machineCodeHash === selector;
  if (match && record.revoked !== true) {
    record.revoked = true;
    record.revokedAt = now;
    record.revokedReason = reason;
    count += 1;
  }
}
db.updatedAt = now;
fs.writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, orderId, selector, revokedCount: count }, null, 2));
NODE
}

backup_now() {
  systemctl start echo-pro-cloud-backup.service
  ls -lh "${backup_dir}" | tail -20
}

service_status() {
  systemctl status --no-pager echo-pro-cloud.service || true
  echo
  systemctl list-timers echo-pro-cloud-backup.timer || true
}

open_db_path() {
  echo "env: ${env_file}"
  echo "activation env: ${activation_env_file}"
  echo "api: ${api_base}"
  echo "db : ${db_path}"
  echo "activation db: ${activation_db_path}"
  echo "activation audit: ${activation_audit_log_path}"
  echo "plugin market: ${plugin_market_dir}"
  echo "bak: ${backup_dir}"
}

plugin_market_list() {
  mkdir -p "${plugin_market_dir}"
  echo "market dir: ${plugin_market_dir}"
  node - "${plugin_market_dir}" <<'NODE'
const fs = require('fs');
const path = require('path');
const marketDir = process.argv[2];
const rows = [];
for (const fileName of fs.readdirSync(marketDir)) {
  if (!fileName.endsWith('.echo')) continue;
  const filePath = path.join(marketDir, fileName);
  try {
    const stat = fs.statSync(filePath);
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const manifest = payload && payload.manifest ? payload.manifest : {};
    rows.push({
      fileName,
      id: manifest.id || '',
      version: manifest.version || '',
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  } catch {
    rows.push({ fileName, id: 'invalid_package', version: '', size: 0, updatedAt: '' });
  }
}
rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
console.log('id\tversion\tsize\tupdated\tfile');
for (const row of rows) {
  console.log(`${row.id}\t${row.version}\t${row.size}\t${row.updatedAt}\t${row.fileName}`);
}
NODE
}

pause_menu() {
  if [[ -t 0 ]]; then
    echo
    read -r -p "按 Enter 返回菜单..." _
  fi
}

confirm_action() {
  local prompt="$1"
  local answer=""
  read -r -p "${prompt} [y/N]: " answer
  case "${answer}" in
    y|Y|yes|YES|ok|OK|确认) return 0 ;;
    *) echo "${yellow}已取消。${reset}"; return 1 ;;
  esac
}

menu_summary() {
  echo "${dim}API ${api_base}${reset}"
  if [[ -f "${db_path}" ]]; then
    node - "${db_path}" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const users = db.users || [];
const keys = db.activationKeys || [];
const proUsers = users.filter((user) => user.pro === true).length;
const unusedKeys = keys.filter((key) => !Array.isArray(key.redemptions) || key.redemptions.length === 0).length;
console.log(`用户 ${users.length} / Pro ${proUsers} / 未使用Key ${unusedKeys} / 会话 ${(db.sessions || []).length}`);
NODE
  else
    echo "${yellow}本地数据库未找到：${db_path}${reset}"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    local service_state
    service_state="$(systemctl is-active echo-pro-cloud.service 2>/dev/null || true)"
    if [[ "${service_state}" == "active" ]]; then
      echo "${green}服务运行中${reset}"
    elif [[ -n "${service_state}" ]]; then
      echo "${yellow}服务状态：${service_state}${reset}"
    fi
  fi
}

menu_bulk_keys() {
  echo
  echo "${bold}批量生成 Pro Key${reset}"
  echo "${dim}常用：10 个单次兑换 Key，生成后会显示可复制区块。${reset}"
  generate_keys_interactive
}

keys_help() {
  cat <<'HELP'
Usage:
  echo-pro-admin keys [count] [--redemptions N] [--note TEXT] [--expires-at ISO] [--copy|--no-copy]

Examples:
  echo-pro-admin keys
  echo-pro-admin keys 20
  echo-pro-admin keys --count 50 --redemptions 1 --note "July supporters" --copy
HELP
}

usage() {
  cat <<'HELP'
Usage: echo-pro-admin [command]

Commands:
  menu                 Open the friendly admin menu
  keys [count]         Generate Pro key(s) immediately
  keys-batch           Guided batch key generation
  pro [user] [on|off]  Enable/disable user Pro
  reset-devices [user] Release all devices for a user
  status [user] [state] Set user status
  show [user]          Show one user from local DB
  list [query]         List/search users from local DB
  key-list [query]     List/search activation keys from local DB
  key-stats            Show user/key totals
  key-disable [ref]    Disable a key locally, with DB backup
  key-enable [ref]     Enable a key locally, with DB backup
  orders [query]       List/search Afdian order activations
  order-show [order]   Show one Afdian order activation detail
  order-revoke [order] [selector] [reason]
                       Revoke order activations by all/qq/licenseId/activationId/hwid
  users-auth [query]   List all authorized users/QQ/HWID across account/Afdian/ProKey
  auth-search [query]  Search QQ/HWID/order/key/license/activation in authorization data
  auth-recent [limit]  Show recent activation/redeem/unbind audit events
  market               List .echo plugin packages in the plugin market directory
  hwids [query]        List/search account and Afdian HWID bindings
  hwid-remove [user] [hwid]
                       Remove one account HWID binding, with DB backup
  backup               Run backup service now
  service              Show service/timer status
  doctor               Show env/API/DB paths
HELP
}

menu() {
  while true; do
    cat <<MENU

${bold}ECHO Pro 管理台${reset}
MENU
    menu_summary
    cat <<MENU

${bold}常用${reset}
  ${green}Enter / 1${reset}  直接生成 1 个 Pro Key
  2          批量生成 Key（默认 10 个，可一键复制）
  3          给用户开启/关闭 Pro
  4          查看某个用户详情

${bold}Key 管理${reset}
  5          查看/搜索 Key 列表
  6          Key 与用户统计
  7          禁用 Key（会先备份数据库）
  8          恢复 Key

${bold}用户与设备${reset}
  9          搜索/列出用户
  10         解绑用户所有设备
  11         禁用/恢复用户状态
  12         授权用户总览（QQ / HWID / 来源）
  13         快速搜索授权（QQ/HWID/订单/Key/license）
  14         查看/搜索 HWID 绑定
  15         删除某个账号的单个 HWID 绑定

${bold}爱发电订单${reset}
  16         查看/搜索爱发电订单激活
  17         查看某个订单详情
  18         撤销某个订单/QQ/HWID 激活

${bold}审计${reset}
  19         最近授权事件

${bold}运维${reset}
  20         立即备份数据库
  21         查看服务状态
  22         查看路径/配置
  h          帮助
  q / 0      退出
MENU
    read -r -p "选择（回车=生成 1 个 Key）: " choice
    case "${choice}" in
      ""|1) generate_keys --count 1 --redemptions 1 --note "quick admin key"; pause_menu ;;
      2) menu_bulk_keys; pause_menu ;;
      3) set_user_pro; pause_menu ;;
      4) show_user_local; pause_menu ;;
      5) search_keys_local; pause_menu ;;
      6) key_stats_local; pause_menu ;;
      7) confirm_action "禁用 Key 会修改本地数据库，继续吗？" && change_key_disabled_local true; pause_menu ;;
      8) change_key_disabled_local false; pause_menu ;;
      9) search_users_local; pause_menu ;;
      10) confirm_action "解绑会清空该用户所有设备绑定，继续吗？" && reset_user_devices; pause_menu ;;
      11) confirm_action "这会修改用户账号状态，继续吗？" && set_user_status; pause_menu ;;
      12) read -r -p "搜索 QQ/HWID/来源（留空列出全部）: " query; list_authorized_users_local "${query:-}"; pause_menu ;;
      13) search_authorization_local; pause_menu ;;
      14) read -r -p "搜索 owner/order/hwid（留空列出全部）: " query; list_hwids_local "${query:-}"; pause_menu ;;
      15) confirm_action "这会删除账号上的单个 HWID 绑定，继续吗？" && remove_user_hwid_local; pause_menu ;;
      16) read -r -p "搜索订单号/QQ（留空列出全部）: " query; list_orders_local "${query:-}"; pause_menu ;;
      17) show_order_local; pause_menu ;;
      18) confirm_action "这会撤销匹配的爱发电激活记录，继续吗？" && revoke_order_activation_local; pause_menu ;;
      19) recent_authorization_events_local; pause_menu ;;
      20) backup_now; pause_menu ;;
      21) service_status; pause_menu ;;
      22) open_db_path; pause_menu ;;
      h|H|help|HELP|\?) usage; pause_menu ;;
      q|Q|0) exit 0 ;;
      *) echo "${yellow}未知选项${reset}" ;;
    esac
  done
}

case "${1:-menu}" in
  menu) shift || true; menu "$@" ;;
  keys) shift || true; generate_keys "$@" ;;
  keys-batch) shift || true; generate_keys_interactive "$@" ;;
  pro) shift || true; set_user_pro "$@" ;;
  reset-devices) shift || true; reset_user_devices "$@" ;;
  status) shift || true; set_user_status "$@" ;;
  show) shift || true; show_user_local "$@" ;;
  list) shift || true; list_users_local "${1:-}" ;;
  key-list) shift || true; list_keys_local "${1:-}" ;;
  key-stats) shift || true; key_stats_local "$@" ;;
  key-disable) shift || true; change_key_disabled_local true "${1:-}" ;;
  key-enable) shift || true; change_key_disabled_local false "${1:-}" ;;
  orders) shift || true; list_orders_local "${1:-}" ;;
  order-show) shift || true; show_order_local "${1:-}" ;;
  order-revoke) shift || true; revoke_order_activation_local "${1:-}" "${2:-}" "${3:-}" ;;
  users-auth) shift || true; list_authorized_users_local "${1:-}" ;;
  auth-search) shift || true; search_authorization_local "${1:-}" ;;
  auth-recent) shift || true; recent_authorization_events_local "${1:-}" ;;
  market) shift || true; plugin_market_list "$@" ;;
  hwids) shift || true; list_hwids_local "${1:-}" ;;
  hwid-remove) shift || true; remove_user_hwid_local "${1:-}" "${2:-}" ;;
  backup) shift || true; backup_now "$@" ;;
  service) shift || true; service_status "$@" ;;
  doctor) shift || true; open_db_path "$@" ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
