#!/usr/bin/env bash
set -euo pipefail

env_file="${ECHO_PRO_ENV_FILE:-/etc/echo-pro-cloud.env}"
if [[ -f "${env_file}" ]]; then
  # shellcheck disable=SC1090
  source "${env_file}"
fi

db_path="${ECHO_PRO_DB:-/var/lib/echo-pro/echo-pro.json}"
backup_dir="${ECHO_PRO_BACKUP_DIR:-/var/backups/echo-pro}"
retention_days="${ECHO_PRO_BACKUP_RETENTION_DAYS:-30}"

if [[ ! -f "${db_path}" ]]; then
  echo "ECHO Pro database does not exist yet: ${db_path}"
  exit 0
fi

install -d -m 0700 "${backup_dir}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${backup_dir}/echo-pro-${timestamp}.json.gz"
temp="${target}.tmp"

gzip -c "${db_path}" >"${temp}"
chmod 0600 "${temp}"
mv "${temp}" "${target}"

find "${backup_dir}" -type f -name 'echo-pro-*.json.gz' -mtime +"${retention_days}" -delete

echo "Created ${target}"
