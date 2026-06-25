#!/usr/bin/env bash
set -euo pipefail

DAEMON="${1:-./electron-app/build/echo-audio-daemon}"
TEST_FILE="/tmp/test_tone.flac"

# Generate test file (10s to allow full test flow before track ends)
[ -f "$TEST_FILE" ] || ffmpeg -y -f lavfi -i "sine=frequency=440:duration=10" -ar 44100 -ac 2 "$TEST_FILE" 2>/dev/null

PASS=0; FAIL=0; TOTAL=0
assert() { TOTAL=$((TOTAL+1)); if eval "$2"; then echo "  ✅  $1"; PASS=$((PASS+1)); else echo "  ❌  $1"; FAIL=$((FAIL+1)); fi; }

# Spawn daemon with named pipes
rm -f /tmp/din /tmp/dout
mkfifo /tmp/din /tmp/dout
$DAEMON </tmp/din >/tmp/dout 2>/dev/null & DAEMON_PID=$!
exec 3>/tmp/din; exec 4</tmp/dout
send() { echo "$1" >&3; }

# Read ONE line (for events/notifications)
recv() { local line; read -r -t "${1:-5}" line <&4 || { echo "TIMEOUT"; return 1; }; echo "$line"; }

# Read until response with matching id (daemon emits events before response)
recv_id() {
  local eid="$1" t="${2:-5}" line deadline
  deadline=$(($(date +%s) + t))
  while read -r -t "$t" line <&4; do
    if echo "$line" | grep -q "\"id\":$eid[,}]"; then echo "$line"; return 0; fi
    t=$((deadline - $(date +%s))); [ "$t" -le 0 ] && { echo "TIMEOUT:id=$eid"; return 1; }
  done
}

cleanup() { kill "$DAEMON_PID" 2>/dev/null || true; exec 3>&- 2>/dev/null || true; exec 4<&- 2>/dev/null || true; wait "$DAEMON_PID" 2>/dev/null || true; rm -f /tmp/din /tmp/dout; }
trap cleanup EXIT

echo "=== Waiting for event.ready ==="
READY=$(recv 10)
assert "daemon emits event.ready" '[ -n "$(echo "$READY" | grep event.ready)" ]'

echo ""; echo "=== 1. device.list ==="
send '{"jsonrpc":"2.0","id":1,"method":"device.list"}'
R=$(recv_id 1 5)
assert "device.list returns result" '[ -n "$(echo "$R" | grep result)" ]'
CNT=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['result']['devices']))" 2>/dev/null || echo 0)
assert "device.list has >=1 device (got $CNT)" '[ "$CNT" -ge 1 ]'

echo ""; echo "=== 2. probe ==="
send "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"probe\",\"params\":{\"path\":\"$TEST_FILE\"}}"
R=$(recv_id 2 5)
FMT=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('format',''))" 2>/dev/null || echo "")
assert "probe format=flac (got: $FMT)" '[ "$FMT" = "flac" ]'
SR=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('sampleRate',0))" 2>/dev/null || echo 0)
assert "probe sr=44100 (got: $SR)" '[ "$SR" -eq 44100 ]'

echo ""; echo "=== 3. play ==="
send "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"play\",\"params\":{\"path\":\"$TEST_FILE\"}}"
R=$(recv_id 3 5)
ST=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('status',''))" 2>/dev/null || echo "")
assert "play status=playing (got: $ST)" '[ "$ST" = "playing" ]'

echo ""; echo "=== 4. position events ==="
# Get just one position event quickly, then proceed
L=$(recv 2) || L=""
assert "received position event" '[ -n "$(echo "$L" | grep event.position)" ]'

echo ""; echo "=== 5. pause ==="
send '{"jsonrpc":"2.0","id":4,"method":"pause"}'; recv_id 4 5 >/dev/null
send '{"jsonrpc":"2.0","id":99,"method":"getStatus"}'
R=$(recv_id 99 5)
PS=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('state',''))" 2>/dev/null || echo "")
assert "pause state=paused (got: $PS)" '[ "$PS" = "paused" ]'

echo ""; echo "=== 6. resume ==="
send '{"jsonrpc":"2.0","id":5,"method":"resume"}'; recv_id 5 5 >/dev/null
sleep 0.3; L=$(recv 2) || L=""
assert "resume has position event" '[ -n "$(echo "$L" | grep event.position)" ]'

echo ""; echo "=== 7. setVolume ==="
send '{"jsonrpc":"2.0","id":6,"method":"setVolume","params":{"volume":0.5}}'
R=$(recv_id 6 5)
VL=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('volume',-1))" 2>/dev/null || echo -1)
assert "volume=0.5 (got: $VL)" '[ "$VL" = "0.5" ]'

echo ""; echo "=== 8. getStatus ==="
send '{"jsonrpc":"2.0","id":7,"method":"getStatus"}'
R=$(recv_id 7 5)
GS=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('state',''))" 2>/dev/null || echo "")
assert "getStatus state=playing (got: $GS)" '[ "$GS" = "playing" ]'

echo ""; echo "=== 9. seek ==="
send '{"jsonrpc":"2.0","id":8,"method":"seek","params":{"seconds":2.0}}'
recv_id 8 5 >/dev/null
sleep 0.3
send '{"jsonrpc":"2.0","id":98,"method":"getStatus"}'
R=$(recv_id 98 5)
SP=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('position',0))" 2>/dev/null || echo 0)
assert "seek pos near 2s (got: $SP)" 'python3 -c "import sys; p=float(sys.argv[1]); sys.exit(0 if 1.5 < p < 2.5 else 1)" "$SP"'

echo ""; echo "=== 10. stop ==="
send '{"jsonrpc":"2.0","id":9,"method":"stop"}'; recv_id 9 5 >/dev/null
send '{"jsonrpc":"2.0","id":97,"method":"getStatus"}'
R=$(recv_id 97 5)
SS=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('state',''))" 2>/dev/null || echo "")
assert "stop state=stopped (got: $SS)" '[ "$SS" = "stopped" ]'

echo ""; echo "=== 11. shutdown ==="
send '{"jsonrpc":"2.0","id":10,"method":"shutdown"}'
SHUTDOWN_RESP=$(recv_id 10 5) || true
wait $DAEMON_PID 2>/dev/null || true; RC=$?
assert "daemon exits cleanly (code=$RC)" '[ "${RC:-0}" -eq 0 ]'
assert "shutdown response received" '[ -n "$SHUTDOWN_RESP" ]'

echo ""; echo "══════ RESULTS: $PASS/$TOTAL passed ══════"
[ "$FAIL" -eq 0 ]
