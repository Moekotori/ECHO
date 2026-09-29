# ECHO Pro Account Verifier

This directory is intentionally ignored by git. Keep it private.

## Immediate Server Safety

The root password was shared in chat. Treat it as exposed.

1. Log in manually once and rotate the root password.
2. Add your SSH public key to `/root/.ssh/authorized_keys`.
3. Prefer disabling password login after you confirm key login works.

## Deploy On echonext.moe

Copy this private directory to the server, for example:

```bash
scp -r private/echo-pro-cloud root@154.37.219.204:/root/echo-pro-cloud
```

Then run on the server:

```bash
cd /root/echo-pro-cloud
bash ./install-on-server.sh
cat /etc/echo-pro-cloud.env
```

Keep the generated `ECHO_PRO_ADMIN_TOKEN` private.

Add `nginx-location.conf` into the existing `echonext.moe` HTTPS server block, then run:

```bash
nginx -t
systemctl reload nginx
curl -sS https://echonext.moe/api/echo-pro/health
```

The public client endpoints are:

```text
https://echonext.moe/api/echo-pro/verify
https://echonext.moe/api/echo-pro/auth/register
https://echonext.moe/api/echo-pro/auth/login
https://echonext.moe/api/echo-pro/auth/me
https://echonext.moe/api/echo-pro/auth/logout
https://echonext.moe/api/echo-pro/settings/cloud
https://echonext.moe/api/echo-pro/keys/redeem
https://echonext.moe/api/echo-pro/devices/release-all
```

Expose only these routes through HTTPS:

- `POST /api/echo-pro/verify`
- `POST /api/echo-pro/auth/register`
- `POST /api/echo-pro/auth/login`
- `GET /api/echo-pro/auth/me`
- `POST /api/echo-pro/auth/logout`
- `GET /api/echo-pro/settings/cloud`
- `PUT /api/echo-pro/settings/cloud`
- `POST /api/echo-pro/keys/redeem`
- `POST /api/echo-pro/devices/release-all`
- `GET /api/echo-pro/health`

Keep `POST /api/echo-pro/admin/users` protected. It requires:

```http
Authorization: Bearer $ECHO_PRO_ADMIN_TOKEN
```

Keep `POST /api/echo-pro/admin/keys` protected the same way. It returns raw keys only once; the server stores only peppered hashes.

## Grant Pro To An Account

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/users \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"user@example.com","pro":true}'
```

Use `{"username":"user@example.com","resetMachines":true}` to clear bound device slots as admin.

Users can also release their own device slots from ECHO Settings > General > ECHO Pro account. That endpoint requires:

- a valid account session,
- the current account password,
- `POST /api/echo-pro/devices/release-all`.

## Generate Pro Keys

Fast admin tool:

```bash
echo-pro-admin keys
echo-pro-admin keys 20
echo-pro-admin keys --count 50 --redemptions 1 --note "manual batch" --copy
```

The tool prints a numbered list plus a plain copy block, and also saves the batch to `/tmp/echo-pro-keys-*.txt`. If a clipboard command is available (`wl-copy`, `xclip`, `xsel`, `pbcopy`, or `clip.exe`), `--copy` copies the whole batch automatically.

The interactive menu also supports key listing, key stats, key disable/enable, user search, device release, backup, and service status:

```bash
echo-pro-admin
```

Raw API fallback:

```bash
curl -sS https://echonext.moe/api/echo-pro/admin/keys \
  -H "authorization: Bearer $ECHO_PRO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"count":5,"maxRedemptions":1,"note":"manual batch"}'
```

Give the returned `key` value to the user. Do not store raw keys in git or public docs.

Redeeming a key binds the current ECHO machine hash to the account on the server. If the account has reached
`ECHO_PRO_MAX_BOUND_MACHINES`, the redeem call is rejected with `device_limit_reached`; release devices from the app
or run `echo-pro-admin reset-devices <user>` before activating a replacement device.

## Local Runtime

```bash
export ECHO_PRO_BIND_HOST=127.0.0.1
export ECHO_PRO_PORT=8787
export ECHO_PRO_DB=/var/lib/echo-pro/echo-pro.json
export ECHO_PRO_ADMIN_TOKEN='replace-with-a-long-random-secret'
export ECHO_PRO_KEY_PEPPER='replace-with-a-different-long-random-secret'
export ECHO_PRO_ALLOW_PUBLIC_REGISTER=true
export ECHO_PRO_MAX_BOUND_MACHINES=2
export ECHO_PRO_MAX_REQUEST_BODY_BYTES=8388608
node /opt/echo-pro-cloud/server.mjs
```

`PUT /api/echo-pro/settings/cloud` stores sanitized ECHO settings plus ECHO Pro library sync data. Library sync includes online playlists and streaming favorites only; it does not store third-party account cookies, sessions, passwords, or local music files.
