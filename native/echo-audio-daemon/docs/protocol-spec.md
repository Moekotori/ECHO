# ECHO Audio Daemon Protocol Specification

**Version:** 1.0  
**Protocol:** JSON-RPC 2.0  
**Transport:** stdin/stdout (newline-delimited JSON)  
**Status:** Engineering Reference

---

## Table of Contents

1. [Transport Layer](#1-transport-layer)
2. [JSON-RPC 2.0 Conformance](#2-json-rpc-20-conformance)
3. [Method Reference](#3-method-reference)
   - 3.1 [Playback Methods](#31-playback-methods)
   - 3.2 [Device Methods](#32-device-methods)
   - 3.3 [EQ Methods](#33-eq-methods)
   - 3.4 [DSP Methods](#34-dsp-methods)
   - 3.5 [Probe Method](#35-probe-method)
   - 3.6 [Subscription Methods](#36-subscription-methods)
4. [Events (Server Notifications)](#4-events-server-notifications)
5. [Error Codes](#5-error-codes)
6. [Gapless Playback Protocol](#6-gapless-playback-protocol)
7. [Automix Protocol](#7-automix-protocol)
8. [Event Throttling Policy](#8-event-throttling-policy)
9. [Lifecycle](#9-lifecycle)
10. [Full Message Examples](#10-full-message-examples)

---

## 1. Transport Layer

### 1.1 stdin/stdout Framing

The daemon and client communicate over the daemon's stdin (requests) and stdout (responses and events).

- Each message is a single JSON object on a single line.
- Lines are delimited by `\n` (U+000A).
- No pretty-printing. No trailing whitespace.
- Every line is a complete, parseable JSON object.
- The daemon's stderr is reserved for diagnostics and must not contain protocol messages.

```
<-- {"jsonrpc":"2.0","id":1,"method":"play","params":{"path":"/music/track.flac"}}
--> {"jsonrpc":"2.0","id":1,"result":{"status":"playing"}}
--> {"jsonrpc":"2.0","method":"event.state","params":{"state":"playing"}}
```

### 1.2 Binary Audio Data Transport

Audio PCM data is NOT transmitted over JSON-RPC. The daemon reads audio files directly from the filesystem. The JSON-RPC channel controls playback only.

---

## 2. JSON-RPC 2.0 Conformance

### 2.1 Request Object

All requests from the Electron client to the daemon follow the JSON-RPC 2.0 request format:

| Field    | Type            | Required | Description                                    |
|----------|-----------------|----------|------------------------------------------------|
| jsonrpc  | string          | yes      | Must be exactly `"2.0"`                        |
| method   | string          | yes      | Method name. See Section 3.                    |
| params   | object or array | no       | Parameters for the method. Omit if no params.  |
| id       | number or string| no       | Request identifier. Omit for notifications.    |

### 2.2 Response Object

The daemon replies to every non-notification request:

| Field    | Type             | Required | Description                                    |
|----------|------------------|----------|------------------------------------------------|
| jsonrpc  | string           | yes      | Must be exactly `"2.0"`                        |
| result   | any              | no*      | Result on success. Mutually exclusive with error. |
| error    | object           | no*      | Error object on failure. Mutually exclusive with result. |
| id       | number or string | yes      | Matches the request id. Null for parse/invalid. |

*Exactly one of `result` or `error` must be present.

### 2.3 Error Object

| Field   | Type   | Required | Description                            |
|---------|--------|----------|----------------------------------------|
| code    | number | yes      | Integer error code. See Section 5.     |
| message | string | yes      | Short, human-readable description.     |
| data    | any    | no       | Additional error context (server-defined). |

### 2.4 Notification

A JSON-RPC notification is a request without an `id` field. The server does not reply to notifications.

The daemon uses notifications to push events to the client (see Section 4).

---

## 3. Method Reference

### 3.1 Playback Methods

#### `play`

Start playback of a local audio file.

**Params:**

| Field        | Type   | Required | Description                                      |
|--------------|--------|----------|--------------------------------------------------|
| path         | string | yes      | Absolute path to the audio file.                 |
| startSeconds | number | no       | Start position in seconds. Defaults to 0.        |
| queueNext    | object | no       | Next track to prime for gapless transition.      |

**`queueNext` object:**

| Field        | Type   | Required | Description                          |
|--------------|--------|----------|--------------------------------------|
| path         | string | yes      | Absolute path to the next audio file.|
| startSeconds | number | no       | Start position. Defaults to 0.       |

**Result:**

```json
{ "status": "playing" }
```

**Errors:** `-32002` (decode error), `-32003` (format unsupported)

---

#### `pause`

Pause current playback.

**Params:** `{}`

**Result:**

```json
{ "status": "paused" }
```

---

#### `resume`

Resume from paused state.

**Params:** `{}`

**Result:**

```json
{ "status": "playing" }
```

**Errors:** `-32001` (device unavailable)

---

#### `stop`

Stop playback and reset the playback state.

**Params:** `{}`

**Result:**

```json
{ "status": "stopped" }
```

---

#### `seek`

Seek to a specific position in the current track.

**Params:**

| Field   | Type   | Required | Description                     |
|---------|--------|----------|---------------------------------|
| seconds | number | yes      | Target position in seconds.     |

**Result:**

```json
{ "status": "playing", "position": 42.5 }
```

**Errors:** `-32004` (seek error)

---

#### `next`

Skip to the next track in the queue.

**Params:** `{}`

**Result:**

```json
{ "status": "playing" }
```

**Errors:** `-32602` (no next track available)

---

#### `previous`

Go back to the previous track in the queue.

**Params:** `{}`

**Result:**

```json
{ "status": "playing" }
```

**Errors:** `-32602` (no previous track available)

---

#### `setVolume`

Set playback volume.

**Params:**

| Field  | Type   | Required | Description                     |
|--------|--------|----------|---------------------------------|
| volume | number | yes      | Volume from 0.0 (silent) to 1.0 (full). |

**Result:**

```json
{ "volume": 0.75 }
```

---

#### `setOutput`

Set audio output mode and device.

**Params:**

| Field    | Type   | Required | Description                                      |
|----------|--------|----------|--------------------------------------------------|
| mode     | string | yes      | Output mode: `"shared"`, `"exclusive"`, or `"asio"`. |
| deviceId | string | no       | Target device identifier. Omit for system default. |

**Result:**

```json
{ "mode": "shared", "device": { "id": "0", "name": "Speakers (Realtek)" } }
```

**Errors:** `-32001` (device unavailable), `-32005` (ASIO driver error)

---

### 3.2 Device Methods

#### `device.list`

List all available audio output devices.

**Params:** `{}`

**Result:**

```json
{
  "devices": [
    {
      "id": "0",
      "name": "Speakers (Realtek High Definition Audio)",
      "outputMode": "shared",
      "sampleRate": 48000,
      "channels": 2,
      "isDefault": true,
      "sharedSampleRate": 48000
    }
  ]
}
```

**`devices[]` fields:**

| Field            | Type    | Description                               |
|------------------|---------|-------------------------------------------|
| id               | string  | Device identifier.                        |
| name             | string  | Human-readable device name.               |
| outputMode       | string  | `"shared"`, `"exclusive"`, or `"asio"`.   |
| sampleRate       | number  | Current sample rate in Hz.                |
| channels         | number  | Number of output channels.                |
| isDefault        | boolean | Whether this is the system default device.|
| sharedSampleRate | number  | Shared mode mix rate in Hz (may differ).  |

---

### 3.3 EQ Methods

#### `eq.setBand`

Set parameters for a single equalizer band.

**Params:**

| Field     | Type   | Required | Description                                    |
|-----------|--------|----------|------------------------------------------------|
| band      | number | yes      | Band index (0-9).                              |
| frequency | number | no       | Center frequency in Hz.                        |
| gainDb    | number | no       | Gain in dB. Range: -15 to +15.                 |
| q         | number | no       | Q factor (resonance).                          |
| type      | string | no       | Filter type: `"peaking"`, `"lowShelf"`, `"highShelf"`, `"lowPass"`, `"highPass"`, `"notch"`, `"allPass"`, `"bandPass"`. |

At least one of the optional parameters must be provided.

**Result:**

```json
{ "clippingRisk": false }
```

**Errors:** `-32602` (invalid band index or parameter)

---

#### `eq.setEnabled`

Enable or disable the equalizer.

**Params:**

| Field   | Type    | Required | Description             |
|---------|---------|----------|-------------------------|
| enabled | boolean | yes      | EQ on/off.              |

**Result:**

```json
{ "enabled": true }
```

---

#### `eq.setPreset`

Apply a built-in or user-defined EQ preset.

**Params:**

| Field    | Type   | Required | Description                |
|----------|--------|----------|----------------------------|
| presetId | string | yes      | Preset identifier string.  |

**Result:**

```json
{
  "bands": [
    { "frequencyHz": 31, "gainDb": 0, "q": 1, "filterType": "peaking", "enabled": true }
  ],
  "preampDb": 0
}
```

**Errors:** `-32602` (preset not found)

---

#### `eq.reset`

Reset the equalizer to flat (neutral).

**Params:** `{}`

**Result:**

```json
{ "status": "reset" }
```

---

### 3.4 DSP Methods

#### `convolution.loadIr`

Load an impulse response (IR) file for convolution (room correction).

**Params:**

| Field | Type   | Required | Description                                |
|-------|--------|----------|--------------------------------------------|
| path  | string | yes      | Absolute path to the IR WAV file.          |
| irId  | string | yes      | Unique identifier for this IR.             |

**Result:**

```json
{ "irId": "ir-abc123", "irName": "My Room Corrected", "irLenMs": 120 }
```

**Errors:** `-32002` (invalid or unsupported IR file)

---

#### `convolution.setEnabled`

Enable or disable convolution processing.

**Params:**

| Field   | Type    | Required | Description                 |
|---------|---------|----------|-----------------------------|
| enabled | boolean | yes      | Convolution on/off.         |

**Result:**

```json
{ "enabled": true }
```

---

#### `channelBalance.setState`

Set channel balance parameters.

**Params (all optional, only provided fields are updated):**

| Field        | Type    | Description                                    |
|--------------|---------|------------------------------------------------|
| leftGain     | number  | Left channel gain in dB. Range: -18 to +18.    |
| rightGain    | number  | Right channel gain in dB. Range: -18 to +18.   |
| balance      | number  | Stereo balance. -1.0 (full left) to +1.0 (full right). |
| delayMs      | number  | Delay in milliseconds.                         |
| monoMode     | string  | `"off"`, `"sum"`, `"left"`, or `"right"`.     |
| phaseInvertL | boolean | Invert left channel phase.                     |
| phaseInvertR | boolean | Invert right channel phase.                    |
| swapChannels | boolean | Swap left and right channels.                  |

**Result:**

```json
{
  "state": {
    "leftGain": 0,
    "rightGain": 0,
    "balance": 0,
    "delayMs": 0,
    "monoMode": "off",
    "phaseInvertL": false,
    "phaseInvertR": false,
    "swapChannels": false
  }
}
```

---

### 3.5 Probe Method

#### `probe`

Probe an audio file to retrieve its metadata and format information without starting playback.

**Params:**

| Field | Type   | Required | Description                      |
|-------|--------|----------|----------------------------------|
| path  | string | yes      | Absolute path to the audio file. |

**Result:**

```json
{
  "format": "flac",
  "sampleRate": 44100,
  "channels": 2,
  "duration": 245.3,
  "bitRate": 950,
  "codec": "flac",
  "dsd": false
}
```

**Fields:**

| Field      | Type    | Description                                 |
|------------|---------|---------------------------------------------|
| format     | string  | Container format, e.g. `"flac"`, `"wav"`, `"mp3"`, `"dsf"`. |
| sampleRate | number  | Sample rate in Hz.                          |
| channels   | number  | Number of audio channels.                   |
| duration   | number  | Duration in seconds.                        |
| bitRate    | number  | Bit rate in kbps (may be null).             |
| codec      | string  | Audio codec name (may be null).             |
| dsd        | boolean | Whether the file is DSD format.             |

**Errors:** `-32002` (decode error), `-32003` (format unsupported)

---

### 3.6 Subscription Methods

#### `levelMeter.subscribe`

Subscribe to periodic level meter events.

**Params:**

| Field      | Type   | Required | Description                                    |
|------------|--------|----------|------------------------------------------------|
| intervalMs | number | no       | Update interval in milliseconds. Minimum 50. Default 100. |

**Result:**

```json
{ "subscribed": true }
```

Once subscribed, the daemon sends `event.levelMeter` notifications at the requested interval.

---

#### `levelMeter.unsubscribe`

Unsubscribe from level meter events.

**Params:** `{}`

**Result:**

```json
{ "subscribed": false }
```

---

## 4. Events (Server Notifications)

The daemon sends events as JSON-RPC 2.0 notifications (no `id` field) via stdout. Each event uses the method name pattern `event.<name>`.

### `event.position`

Periodic playback position update. Throttled: minimum 100ms between events.

**Params:**

| Field             | Type   | Description                                      |
|-------------------|--------|--------------------------------------------------|
| seconds           | number | Current playback position in seconds.            |
| duration          | number | Total track duration in seconds.                 |
| bufferedFrames    | number | Number of frames buffered in the output (optional). |
| underrunCallbacks | number | Count of buffer underrun events (optional).      |

**Example:**

```json
{
  "jsonrpc": "2.0",
  "method": "event.position",
  "params": {
    "seconds": 42.0,
    "duration": 245.3,
    "bufferedFrames": 4096,
    "underrunCallbacks": 0
  }
}
```

---

### `event.state`

Playback state change notification.

**Params:**

| Field | Type   | Description                                      |
|-------|--------|--------------------------------------------------|
| state | string | One of: `"playing"`, `"paused"`, `"stopped"`, `"ended"`, `"error"`. |
| error | object | Present only when state is `"error"`. Contains `code` (number) and `message` (string). |

**Example:**

```json
{ "jsonrpc": "2.0", "method": "event.state", "params": { "state": "playing" } }
{ "jsonrpc": "2.0", "method": "event.state", "params": { "state": "error", "error": { "code": -32002, "message": "Decode error" } } }
```

---

### `event.trackEnded`

Signals that the current track has reached its natural end. Used for gapless and automix sequencing.

**Params:** `{}`

**Example:**

```json
{ "jsonrpc": "2.0", "method": "event.trackEnded", "params": {} }
```

---

### `event.trackStarted`

Signals that a new track has started playback.

**Params:**

| Field    | Type   | Description                              |
|----------|--------|------------------------------------------|
| filePath | string | Absolute path to the started audio file. |
| format   | string | Container format, e.g. `"flac"`.         |

**Example:**

```json
{ "jsonrpc": "2.0", "method": "event.trackStarted", "params": { "filePath": "/music/track.flac", "format": "flac" } }
```

---

### `event.levelMeter`

Level meter data. Only sent when a subscription is active. Throttled: minimum 50ms between events.

**Params:**

| Field    | Type     | Description                                 |
|----------|----------|---------------------------------------------|
| peak     | number   | Peak level (0.0 to 1.0).                    |
| rms      | number   | RMS level (0.0 to 1.0).                     |
| channels | number[] | Per-channel peak levels.                     |

**Example:**

```json
{ "jsonrpc": "2.0", "method": "event.levelMeter", "params": { "peak": 0.85, "rms": 0.42, "channels": [0.85, 0.80] } }
```

---

### `event.deviceChanged`

Notification of audio device changes.

**Params:**

| Field    | Type   | Description                                       |
|----------|--------|---------------------------------------------------|
| event    | string | `"added"`, `"removed"`, `"default_changed"`, or `"state_changed"`. |
| deviceId | string | Identifier of the affected device.                |

**Example:**

```json
{ "jsonrpc": "2.0", "method": "event.deviceChanged", "params": { "event": "default_changed", "deviceId": "1" } }
```

---

### `event.dspState`

DSP processing state notification. Emitted when clipping risk or limiter status changes.

**Params:**

| Field             | Type    | Description                               |
|-------------------|---------|-------------------------------------------|
| clippingRisk      | boolean | True if DSP processing may cause clipping.|
| limiterProtecting | boolean | True if the safety limiter is active.     |

**Example:**

```json
{ "jsonrpc": "2.0", "method": "event.dspState", "params": { "clippingRisk": true, "limiterProtecting": false } }
```

---

## 5. Error Codes

### Standard JSON-RPC Error Codes

| Code    | Name            | Description                                    |
|---------|-----------------|------------------------------------------------|
| -32700  | Parse error     | Invalid JSON was received by the server.       |
| -32600  | Invalid request | The JSON sent is not a valid Request object.   |
| -32601  | Method not found| The method does not exist or is not available. |
| -32602  | Invalid params  | Invalid method parameter(s).                   |
| -32603  | Internal error  | Internal JSON-RPC error.                       |

### Application-Defined Error Codes

| Code    | Name                 | Description                                    |
|---------|----------------------|------------------------------------------------|
| -32000  | Internal error       | Unspecified internal daemon error.             |
| -32001  | Device unavailable   | Requested audio device is not available.       |
| -32002  | Decode error         | File format is unsupported or file is corrupted.|
| -32003  | Format unsupported   | Audio format is not supported.                 |
| -32004  | Seek error           | Seek operation failed.                         |
| -32005  | ASIO driver error    | ASIO driver returned an error.                 |

### Error Response Format

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32002,
    "message": "Decode error: file format not recognized or corrupted"
  },
  "id": 1
}
```

---

## 6. Gapless Playback Protocol

Gapless playback allows seamless transition between consecutive tracks without silence or audible gaps.

### Protocol Flow

1. The client sends `play` with a `queueNext` parameter containing the next track's path.
2. The daemon decodes the next track and primes its output pipeline while the current track is still playing.
3. When the current track reaches its natural end, the daemon sends `event.trackEnded`.
4. The daemon seamlessly switches to the pre-primed next track.
5. The daemon sends `event.trackStarted` with the new track's file path and format.
6. If another queued track exists, the daemon begins priming it.

### Sequence Diagram

```
Client                              Daemon
  |                                    |
  |--- play({path:"A", queueNext:{path:"B"}}) -->|
  |                                    |  Decodes A, primes B
  |<-- result: {status:"playing"} -----|
  |                                    |
  |                    [A plays...]     |
  |                                    |
  |<-- event.trackEnded ---------------|  A finished naturally
  |<-- event.position {seconds: dur} --|  (last position event)
  |<-- event.trackStarted {path:"B"} --|  B started seamlessly
  |                                    |
  |                    [B plays...]     |
```

### Gapless Constraints

- Tracks must have matching sample rates and channel counts for bit-perfect gapless.
- If sample rates differ, the daemon resamples both tracks to a common rate.
- If the next track cannot be decoded in time, the daemon falls back to a brief silence gap before starting the next track.
- The `event.trackEnded` event fires only at natural end, not after client-initiated `stop` or `next`.

---

## 7. Automix Protocol

Automix provides crossfade transitions between tracks, with configurable overlap duration and gain curves.

### Methods

#### `prepareAutomix`

Set crossfade parameters for the upcoming transition between the current and next track.

**Params:**

| Field             | Type   | Required | Description                                    |
|-------------------|--------|----------|------------------------------------------------|
| fadeStartSeconds  | number | yes      | Seconds before current track end to start fade.|
| overlapSeconds    | number | yes      | Duration of crossfade overlap in seconds.      |
| currentGainDb     | number | yes      | Gain applied to current track during fade.     |
| nextGainDb        | number | yes      | Gain applied to next track during fade.        |
| mode              | string | no       | Transition mode: `"equalPower"`, `"linear"`, `"smooth"`. Defaults to `"equalPower"`. |

**Result:**

```json
{ "prepared": true }
```

#### `queueNext`

Prime the next track for automix transition (same as the `queueNext` parameter in `play`, but callable after playback has started).

**Params:**

| Field        | Type   | Required | Description                          |
|--------------|--------|----------|--------------------------------------|
| path         | string | yes      | Absolute path to the next audio file.|
| startSeconds | number | no       | Start position. Defaults to 0.       |

**Result:**

```json
{ "queued": true }
```

### Sequence Diagram

```
Client                              Daemon
  |                                    |
  |--- play({path:"A"}) ------------->|
  |<-- result: {status:"playing"} -----|
  |                                    |
  |                    [A plays...]     |
  |                                    |
  |--- queueNext({path:"B"}) -------->|
  |<-- result: {queued:true} ---------|
  |--- prepareAutomix({               |
  |      fadeStartSeconds: 8,         |
  |      overlapSeconds: 6,           |
  |      currentGainDb: 0,            |
  |      nextGainDb: -3,              |
  |      mode: "equalPower"           |
  |    }) --------------------------->|
  |<-- result: {prepared:true} -------|
  |                                    |
  |       [A plays... crossfade... B]  |
  |                                    |
  |<-- event.trackEnded ---------------|
  |<-- event.trackStarted {path:"B"} --|
```

### Automix Constraints

- Automix requires the daemon to maintain two decoded PCM streams simultaneously (current + next).
- If the daemon cannot keep up (CPU/memory pressure), it falls back to gapless (no crossfade).
- Crossfade gain is applied in the digital domain before output.

---

## 8. Event Throttling Policy

To prevent flooding the IPC channel, certain high-frequency events are throttled.

| Event               | Minimum Interval | Rationale                                |
|---------------------|------------------|------------------------------------------|
| `event.position`    | 100ms            | Playback position updates are high frequency. 100ms = 10 updates/sec max. |
| `event.levelMeter`  | 50ms             | Level meter data at 20 updates/sec max is sufficient for UI visualization. |
| `event.state`       | No throttle      | State changes are infrequent; emit every time. |
| `event.trackEnded`  | No throttle      | One per track end.                       |
| `event.trackStarted`| No throttle      | One per track start.                     |
| `event.deviceChanged`| No throttle     | Device changes are rare.                 |
| `event.dspState`    | No throttle      | Emitted only on state change.            |

### Throttling Behavior

- When a throttled event is suppressed, the daemon tracks the latest data.
- Immediately after the throttle interval expires, the daemon sends the most recent data (not every suppressed update).
- This guarantees the client always receives the freshest state, never stale intermediate values.

---

## 9. Lifecycle

### Daemon Startup

1. Client spawns the daemon process.
2. Daemon writes a `ready` notification on stdout once initialization is complete:

```json
{"jsonrpc":"2.0","method":"event.ready","params":{"daemonVersion":"1.0.0","defaultSampleRate":48000}}
```

3. Client may now send requests.

### Daemon Shutdown

1. Client sends `{"jsonrpc":"2.0","method":"shutdown","id":100}`.
2. Daemon stops playback, releases audio resources, writes a confirmation, and exits.

```json
{"jsonrpc":"2.0","id":100,"result":{"status":"shutdown"}}
```

3. If the daemon crashes or is killed, the client detects the process exit and cleans up.

---

## 10. Full Message Examples

### Play a track

```json
--> {"jsonrpc":"2.0","id":1,"method":"play","params":{"path":"/music/track.flac"}}
<-- {"jsonrpc":"2.0","id":1,"result":{"status":"playing"}}
<-- {"jsonrpc":"2.0","method":"event.state","params":{"state":"playing"}}
```

### Pause and resume

```json
--> {"jsonrpc":"2.0","id":2,"method":"pause","params":{}}
<-- {"jsonrpc":"2.0","id":2,"result":{"status":"paused"}}
<-- {"jsonrpc":"2.0","method":"event.state","params":{"state":"paused"}}

--> {"jsonrpc":"2.0","id":3,"method":"resume","params":{}}
<-- {"jsonrpc":"2.0","id":3,"result":{"status":"playing"}}
```

### Set EQ band and check clipping

```json
--> {"jsonrpc":"2.0","id":5,"method":"eq.setBand","params":{"band":2,"gainDb":6.0,"q":1.5}}
<-- {"jsonrpc":"2.0","id":5,"result":{"clippingRisk":true}}
```

### Device list

```json
--> {"jsonrpc":"2.0","id":10,"method":"device.list","params":{}}
<-- {"jsonrpc":"2.0","id":10,"result":{"devices":[{"id":"0","name":"Speakers","outputMode":"shared","sampleRate":48000,"channels":2,"isDefault":true,"sharedSampleRate":48000}]}}
```

### Method not found

```json
--> {"jsonrpc":"2.0","id":99,"method":"nonexistent","params":{}}
<-- {"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":99}
```

### Invalid params

```json
--> {"jsonrpc":"2.0","id":100,"method":"seek","params":{"seconds":"not-a-number"}}
<-- {"jsonrpc":"2.0","error":{"code":-32602,"message":"Invalid params: seconds must be a number"},"id":100}
```
