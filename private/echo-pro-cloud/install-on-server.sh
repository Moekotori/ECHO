#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the server." >&2
  exit 1
fi

if [[ ! -f ./server.mjs ]]; then
  echo "Run this from the echo-pro-cloud directory." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 20+ first." >&2
  exit 1
fi

install -d -m 0755 /opt/echo-pro-cloud
install -m 0644 ./server.mjs /opt/echo-pro-cloud/server.mjs

if ! id echo-pro >/dev/null 2>&1; then
  useradd --system --home /nonexistent --shell /usr/sbin/nologin echo-pro
fi

install -d -o echo-pro -g echo-pro -m 0750 /var/lib/echo-pro
install -d -o echo-pro -g echo-pro -m 0750 /var/lib/echo-pro-activation
install -d -o echo-pro -g echo-pro -m 0750 /var/lib/echo-pro-activation/plugin-market
install -d -m 0700 /var/backups/echo-pro

if [[ ! -f /etc/echo-pro-cloud.env ]]; then
  admin_token="$(openssl rand -base64 48 | tr -d '\n')"
  key_pepper="$(openssl rand -base64 48 | tr -d '\n')"
  cat >/etc/echo-pro-cloud.env <<EOF
ECHO_PRO_BIND_HOST=127.0.0.1
ECHO_PRO_PORT=8787
ECHO_PRO_DB=/var/lib/echo-pro/echo-pro.json
ECHO_PRO_ADMIN_TOKEN=${admin_token}
ECHO_PRO_KEY_PEPPER=${key_pepper}
ECHO_PRO_ALLOW_PUBLIC_REGISTER=true
ECHO_PRO_MAX_BOUND_MACHINES=2
ECHO_PRO_MAX_REQUEST_BODY_BYTES=8388608
ECHO_PRO_BACKUP_DIR=/var/backups/echo-pro
ECHO_PRO_BACKUP_RETENTION_DAYS=30
EOF
  chmod 0600 /etc/echo-pro-cloud.env
  echo "Created /etc/echo-pro-cloud.env"
  echo "Admin token is stored there. Do not commit or paste it publicly."
elif ! grep -q '^ECHO_PRO_KEY_PEPPER=' /etc/echo-pro-cloud.env; then
  key_pepper="$(openssl rand -base64 48 | tr -d '\n')"
  printf '\nECHO_PRO_KEY_PEPPER=%s\n' "${key_pepper}" >>/etc/echo-pro-cloud.env
  chmod 0600 /etc/echo-pro-cloud.env
  echo "Added ECHO_PRO_KEY_PEPPER to /etc/echo-pro-cloud.env"
fi

if ! grep -q '^ECHO_PRO_BACKUP_DIR=' /etc/echo-pro-cloud.env; then
  printf '\nECHO_PRO_BACKUP_DIR=/var/backups/echo-pro\n' >>/etc/echo-pro-cloud.env
fi
if ! grep -q '^ECHO_PRO_BACKUP_RETENTION_DAYS=' /etc/echo-pro-cloud.env; then
  printf 'ECHO_PRO_BACKUP_RETENTION_DAYS=30\n' >>/etc/echo-pro-cloud.env
fi
chmod 0600 /etc/echo-pro-cloud.env

install -m 0644 ./echo-pro-cloud.service /etc/systemd/system/echo-pro-cloud.service
install -m 0755 ./backup-database.sh /usr/local/sbin/echo-pro-cloud-backup
install -m 0755 ./echo-pro-admin.sh /usr/local/bin/echo-pro-admin
install -m 0644 ./echo-pro-cloud-backup.service /etc/systemd/system/echo-pro-cloud-backup.service
install -m 0644 ./echo-pro-cloud-backup.timer /etc/systemd/system/echo-pro-cloud-backup.timer
systemctl daemon-reload
systemctl enable --now echo-pro-cloud.service
systemctl enable --now echo-pro-cloud-backup.timer
systemctl status --no-pager echo-pro-cloud.service
