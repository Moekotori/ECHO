#!/usr/bin/env bash
# ── ECHO Audio Daemon Null-Output Harness Runner ──────────────────────────────
# Starts the daemon binary as a subprocess with --null-output, pipes JSON-RPC
# 2.0 commands via stdin heredoc, reads all responses from stdout, and validates
# them by line index.
#
# Usage:
#   ./harness_runner.sh [path-to-daemon-binary]
#
# If no path is given, defaults to build/src/echo-audio-daemon relative to the
# script's parent directory.
#
# Exit status:
#   0  All checks passed
#   1  A check failed
#   2  Daemon binary not found

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DAEMON="${1:-"${PROJECT_DIR}/build/src/echo-audio-daemon"}"
PASS=0
FAIL=0

fail() {
    local msg="$1"
    echo "[HARNESS] FAIL: ${msg}" >&2
    FAIL=$((FAIL + 1))
}

pass_v() {
    echo "[HARNESS] PASS: $*"
    PASS=$((PASS + 1))
}

validate_json() {
    local line="$1"
    local checks="$2"
    (
        printf '%s\n' "${line}"
    ) | python3 -c "
import json,sys
try:
    r = json.loads(sys.stdin.read())
$(echo "${checks}" | sed 's/^/    /')
    print('OK')
except BaseException as e:
    msg = str(e)
    print('ERROR: ' + msg, file=sys.stderr)
    sys.exit(1)
"
}

# ── Check binary exists ───────────────────────────────────────────────────────
if [[ ! -x "${DAEMON}" ]]; then
    echo "[HARNESS] ERROR: Daemon binary not found at: ${DAEMON}" >&2
    exit 2
fi

echo "[HARNESS] Using daemon: ${DAEMON}"
echo "[HARNESS] Starting daemon with --null-output..."

# ── Create temp file for stderr ───────────────────────────────────────────────
STDERR_FILE="$(mktemp "${TMPDIR:-/tmp}/echo-daemon-harness-stderr.XXXXXX")"
trap 'rm -f "${STDERR_FILE}"' EXIT INT TERM

# ── Pipe all commands via heredoc, capture stdout lines into array ────────────
mapfile -t LINES < <(
    timeout 7 "${DAEMON}" --null-output 2>"${STDERR_FILE}" <<'COMMANDS'
{"jsonrpc":"2.0","id":1,"method":"device.list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"test.echo","params":{"msg":"hello"}}
{"jsonrpc":"2.0","id":3,"method":"test.play","params":{"path":"/tmp/test.flac","sampleRate":44100,"channels":2,"frames":44100}}
{"jsonrpc":"2.0","id":4,"method":"test.getStatus","params":{}}
{"jsonrpc":"2.0","id":5,"method":"shutdown","params":{}}
COMMANDS
) || {
    exit_code=$?
    if [[ "${exit_code}" -eq 124 ]]; then
        echo "[HARNESS] ERROR: Daemon timed out after 7 seconds" >&2
    else
        echo "[HARNESS] ERROR: Daemon exited with code ${exit_code}" >&2
    fi
    echo "[HARNESS] stderr: $(cat "${STDERR_FILE}")" >&2
    exit 2
}

echo "[HARNESS] Got ${#LINES[@]} response lines"

# ── Verify startup message in stderr ──────────────────────────────────────────
if grep -qF "[echo-audio-daemon] null-output mode" "${STDERR_FILE}" 2>/dev/null; then
    pass_v "startup message in stderr"
else
    fail "expected startup message not found; stderr=$(cat "${STDERR_FILE}")"
fi

# ── Validate responses by line index ──────────────────────────────────────────
if [[ ${#LINES[@]} -lt 5 ]]; then
    fail "Expected at least 5 response lines, got ${#LINES[@]}"
else
    # ── Line 0: device.list ────────────────────────────────────────────────
    echo "[HARNESS] --- Validate device.list ---"
    if validate_json "${LINES[0]}" '
assert r["jsonrpc"] == "2.0", "bad jsonrpc"
assert r["id"] == 1, "bad id"
d = r.get("result", {}).get("devices", [])
assert isinstance(d, list) and len(d) >= 1, "no devices"
assert d[0].get("id") == "null", "bad device id"
'; then
        pass_v "device.list: valid devices array"
    else
        fail "device.list validation failed"
    fi

    # ── Line 1: test.echo ──────────────────────────────────────────────────
    echo "[HARNESS] --- Validate test.echo ---"
    if validate_json "${LINES[1]}" '
assert r["jsonrpc"] == "2.0", "bad jsonrpc"
assert r["id"] == 2, "bad id"
assert r["result"].get("msg") == "hello", "bad msg"
'; then
        pass_v "test.echo: msg echoed correctly"
    else
        fail "test.echo validation failed"
    fi

    # ── Line 2: test.play ──────────────────────────────────────────────────
    echo "[HARNESS] --- Validate test.play ---"
    if validate_json "${LINES[2]}" '
assert r["jsonrpc"] == "2.0", "bad jsonrpc"
assert r["id"] == 3, "bad id"
assert r["result"].get("status") == "playing", "bad status"
assert r["result"].get("framesWritten", 0) > 0, "no frames written"
'; then
        pass_v "test.play: frames written to NullBackend"
    else
        fail "test.play validation failed"
    fi

    # ── Line 3: test.getStatus ─────────────────────────────────────────────
    echo "[HARNESS] --- Validate test.getStatus ---"
    if validate_json "${LINES[3]}" '
assert r["jsonrpc"] == "2.0", "bad jsonrpc"
assert r["id"] == 4, "bad id"
assert r["result"].get("state") == "playing", "bad state"
assert r["result"].get("framesWritten", 0) > 0, "no frames"
assert r["result"].get("volume") == 1.0, "bad volume"
'; then
        pass_v "test.getStatus: correct state"
    else
        fail "test.getStatus validation failed"
    fi

    # ── Line 4: shutdown ───────────────────────────────────────────────────
    echo "[HARNESS] --- Validate shutdown ---"
    if validate_json "${LINES[4]}" '
assert r["jsonrpc"] == "2.0", "bad jsonrpc"
assert r["id"] == 5, "bad id"
assert r["result"].get("status") == "shutdown", "bad shutdown status"
'; then
        pass_v "shutdown: clean exit"
    else
        fail "shutdown validation failed"
    fi
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "[HARNESS] ========================================"
echo "[HARNESS] Results: ${PASS} passed, ${FAIL} failed"
echo "[HARNESS] ========================================"

if [[ "${FAIL}" -eq 0 ]]; then
    exit 0
else
    exit 1
fi
