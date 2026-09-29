#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the server." >&2
  exit 1
fi

if [[ ! -f ./server.mjs ]]; then
  echo "Run this from the echo-pro-activation directory." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 20+ first." >&2
  exit 1
fi

if ! id echo-pro >/dev/null 2>&1; then
  useradd --system --home /nonexistent --shell /usr/sbin/nologin echo-pro
fi

install -d -m 0755 /opt/echo-pro-activation
install -m 0644 ./server.mjs /opt/echo-pro-activation/server.mjs

install -d -o echo-pro -g echo-pro -m 0750 /var/lib/echo-pro
install -d -o echo-pro -g echo-pro -m 0750 /var/lib/echo-pro-activation
install -d -o echo-pro -g echo-pro -m 0750 /var/lib/echo-pro-activation/plugin-market

if [[ ! -f /etc/echo-pro-activation.env ]]; then
  activation_admin_token="$(openssl rand -base64 48 | tr -d '\n')"
  activation_key_secret="$(openssl rand -base64 48 | tr -d '\n')"
  cat >/etc/echo-pro-activation.env <<EOF
ECHO_PRO_ACTIVATION_HOST=127.0.0.1
ECHO_PRO_ACTIVATION_PORT=8788
ECHO_PRO_DB=/var/lib/echo-pro/echo-pro.json
ECHO_PRO_ACTIVATION_BINDINGS_FILE=/var/lib/echo-pro-activation/activations.json
ECHO_PRO_ACTIVATION_AUDIT_LOG_FILE=/var/lib/echo-pro-activation/audit.jsonl
ECHO_PRO_PLUGIN_MARKET_DIR=/var/lib/echo-pro-activation/plugin-market
ECHO_PRO_ACTIVATION_ADMIN_TOKEN=${activation_admin_token}
ECHO_PRO_ACTIVATION_KEY_SECRET=${activation_key_secret}
ECHO_PRO_ALLOWED_ORIGINS=https://echonext.moe,http://localhost:4321,http://127.0.0.1:4321
ECHO_PRO_MAX_ACTIVATIONS_PER_ORDER=2
EOF
  chmod 0600 /etc/echo-pro-activation.env
  echo "Created /etc/echo-pro-activation.env"
  echo "Fill in AFDIAN_API_TOKEN, ECHO_PRO_LICENSE_PRIVATE_KEY_PEM, ECHO_PRO_WATERMARK_KEY, and ECHO_PRO_KEY_PEPPER before public activation."
else
  chmod 0600 /etc/echo-pro-activation.env
fi

for key_value in \
  'ECHO_PRO_ACTIVATION_BINDINGS_FILE=/var/lib/echo-pro-activation/activations.json' \
  'ECHO_PRO_ACTIVATION_AUDIT_LOG_FILE=/var/lib/echo-pro-activation/audit.jsonl' \
  'ECHO_PRO_PLUGIN_MARKET_DIR=/var/lib/echo-pro-activation/plugin-market'
do
  key="${key_value%%=*}"
  if ! grep -q "^${key}=" /etc/echo-pro-activation.env; then
    printf '\n%s\n' "${key_value}" >>/etc/echo-pro-activation.env
  fi
done

chown -R echo-pro:echo-pro /var/lib/echo-pro-activation

install -m 0644 ./echo-pro-activation.service /etc/systemd/system/echo-pro-activation.service
if [[ -f ./nginx-location.conf ]]; then
  install -m 0644 ./nginx-location.conf /opt/echo-pro-activation/nginx-location.conf
fi
systemctl daemon-reload
systemctl enable --now echo-pro-activation.service
systemctl status --no-pager echo-pro-activation.service
