# ECHO Next Crash Report

Generated: 2026-05-19T13:24:38.446Z
Report file: crash-report.md

## Summary

- Type: no_crash_recorded
- Message: Previous ECHO Next session did not close normally.
- Reason: abnormalExit
- Exit code: n/a
- Crash timestamp: n/a

## Session

```json
{
  "sessionId": "[redacted]",
  "appVersion": "26.5.18",
  "electronVersion": "37.10.3",
  "chromeVersion": "138.0.7204.251",
  "nodeVersion": "22.21.1",
  "platform": "win32",
  "arch": "x64",
  "startedAt": "2026-05-19T13:23:39.444Z",
  "status": "abnormalExit",
  "endedAt": "2026-05-19T13:24:36.068Z"
}
```

## Last Abnormal Session

```json
{
  "sessionId": "[redacted]",
  "startedAt": "2026-05-19T13:23:39.444Z",
  "endedAt": "2026-05-19T13:24:36.068Z",
  "detectedAt": "2026-05-19T13:24:36.068Z",
  "sessionBasename": "[redacted]",
  "sessionPathHash": "[redacted]",
  "reason": "abnormalExit"
}
```

## Crash Details

```json
{
  "message": "No crash.json exists for the previous session. abnormalExit was detected from session.json."
}
```

## Stack

```text
n/a
```

## Safe Runtime Snapshots

```text
Live runtime snapshots are omitted because this report is for a previous abnormal session. Use the log tails below for the failing run.
```

## Recent Logs

### crash.log

```text
n/a
```

### main.log

```text
{"timestamp":"2026-05-19T13:23:39.445Z","scope":"main","level":"info","message":"diagnostics session started","payload":{"sessionId":"[redacted]"}}
{"timestamp":"2026-05-19T13:23:39.592Z","scope":"main","level":"info","message":"[SMTC] Windows SMTC host initialized","payload":{"hostPath":{"basename":"echo-smtc-host.exe","pathHash":"80755d319d962450"}}}
```

### renderer.log

```text
n/a
```

## Privacy

This report is generated locally. Music files, cover binaries, lyric contents, tokens, cookies, and authentication secrets are not included. Local media paths are reduced to basename plus pathHash when captured through diagnostics snapshots.

