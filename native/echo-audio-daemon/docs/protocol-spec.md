# echo-audio-daemon JSON-RPC 2.0 Protocol

Daemon transport uses JSON-RPC 2.0 over stdio pipes (fd 3 write, fd 4 read).
One JSON object per line, no framing.

---

## Two-Level Ready

The daemon emits ready messages on stdout (not JSON-RPC — raw JSON line):

### Level 1: process-ready
Emitted when the daemon process is alive but no audio device is open.

```json
{"ready":true,"readyLevel":"process"}
```

### Level 2: device-ready
Emitted after `session.begin` succeeds and a device is open.

```json
{"ready":true,"readyLevel":"device","sr":48000,"ch":2,"buffer":4096}
```

---

## System Methods

### rpc.ping
Health check.

**Request:**
```json
{"jsonrpc":"2.0","method":"rpc.ping","id":1}
```

**Response:**
```json
{"jsonrpc":"2.0","result":"pong","id":1}
```

### rpc.shutdown
Graceful shutdown.

**Request:**
```json
{"jsonrpc":"2.0","method":"rpc.shutdown","id":1}
```

**Response:**
```json
{"jsonrpc":"2.0","result":"ok","id":1}
```

---

## Session Methods

### session.begin
Open audio device with given parameters. All params optional — daemon uses defaults.

**Request:**
```json
{"jsonrpc":"2.0","method":"session.begin","params":{"sr":48000,"ch":2,"buffer":4096,"fifoMs":3000,"prebufferMs":1000},"id":1}
```

**Params:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| sr | number | 48000 | Sample rate (Hz) |
| ch | number | 2 | Channel count |
| buffer | number | 4096 | Buffer size (frames) |
| fifoMs | number | 3000 | FIFO duration (ms) |
| prebufferMs | number | 1000 | Pre-buffer duration (ms) |

**Response:**
```json
{"jsonrpc":"2.0","result":{"ready":true,"readyLevel":"device","sr":48000,"ch":2,"buffer":4096,"fifoMs":3000,"prebufferMs":1000},"id":1}
```

On failure:
```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"device open failed: no default device"},"id":1}
```

---

## Device Methods

### device.enumerate
List available audio output devices.

**Request:**
```json
{"jsonrpc":"2.0","method":"device.enumerate","id":1}
```

**Response:**
```json
{
  "jsonrpc":"2.0",
  "result":[
    {
      "name":"Speakers (Realtek High Definition Audio)",
      "sampleRates":[44100,48000,96000,192000],
      "channels":[1,2],
      "modes":["shared","exclusive"]
    }
  ],
  "id":1
}
```

**Device object:**

| Field | Type | Description |
|-------|------|-------------|
| name | string | Device display name |
| sampleRates | number[] | Supported sample rates |
| channels | number[] | Supported channel counts |
| modes | string[] | Supported output modes: "shared", "exclusive" |

### device.configure
Switch to a different output device at runtime.

**Request:**
```json
{"jsonrpc":"2.0","method":"device.configure","params":{"deviceId":"Speakers (Realtek High Definition Audio)","sr":48000},"id":1}
```

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| deviceId | string | Device name (from enumerate) |
| sr | number | Desired sample rate |

**Response (success):**
```json
{"jsonrpc":"2.0","result":{"deviceId":"Speakers (Realtek High Definition Audio)","sr":48000},"id":1}
```

**Response (error):**
```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"device not found"},"id":1}
```

---

## Audio Playback Methods

### audio.openFile
Probe metadata and start background decode.

**Request:**
```json
{"jsonrpc":"2.0","method":"audio.openFile","params":[{"filePath":"/music/track.flac","sampleRate":48000}],"id":1}
```

**Response:**
```json
{
  "jsonrpc":"2.0",
  "result":{
    "status":"probed",
    "operationId":1,
    "filePath":"/music/track.flac",
    "sampleRate":44100,
    "channels":2,
    "durationSeconds":240.5,
    "codec":"flac",
    "container":"flac",
    "bitDepth":16
  },
  "id":1
}
```

### audio.prefetch
Decode initial window for gapless/queue readiness.

**Request:**
```json
{"jsonrpc":"2.0","method":"audio.prefetch","params":[{"filePath":"/music/next.flac"}],"id":1}
```

### audio.play / audio.pause / audio.resume / audio.stop
Playback control. Standard request/response with no notable result fields.

### audio.seek
Seek to position.

**Request:**
```json
{"jsonrpc":"2.0","method":"audio.seek","params":[{"positionSeconds":30.0}],"id":1}
```

### audio.setVolume
Set output volume.

**Request:**
```json
{"jsonrpc":"2.0","method":"audio.setVolume","params":[{"volume":0.8}],"id":1}
```

---

## EQ / DSP Methods

### eq.getState / eq.setState / eq.setEnabled
Full EQ state management. See `src/shared/types/eq.ts` for state shape.

### eq.setBandGain / eq.setBandFrequency / eq.setBandQ / eq.setBandFilterType / eq.setBandEnabled
Per-band EQ adjustments.

### eq.setPreamp / eq.setPreset / eq.reset
Preamp gain, preset application, flat reset.

### dsp.setHeadroom / dsp.setSafetyLimiter
DSP headroom and limiter control.

---

## Channel Balance Methods

### channelBalance.getState / channelBalance.setState / channelBalance.reset
Channel balance state. See `src/shared/types/audio.ts` for state shape.

---

## Room Correction Methods

### roomCorrection.getState / roomCorrection.loadIr / roomCorrection.setEnabled / roomCorrection.setTrim / roomCorrection.clear
Room correction convolution control.

---

## Preset / Profile Methods

### preset.list / preset.save / preset.delete
EQ preset management.

### profile.list / profile.save / profile.apply / profile.delete / profile.bind / profile.getBinding / profile.applyBound
EQ profile management with device binding.

---

## Notifications (server → client)

These are JSON-RPC notifications (no `id` field):

| Method | Payload | Description |
|--------|---------|-------------|
| audio.position | `{framesPlayed, bufferedFrames, inputEnded, operationId}` | Playback position update |
| audio.ended | `{operationId}` | Track reached end |
| eq.state | EQ state object | EQ state changed |
| channelBalance.state | ChannelBalanceState | Balance changed |
| roomCorrection.state | RoomCorrectionState | Correction changed |

---

## Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32000 | Application error (message varies) |
