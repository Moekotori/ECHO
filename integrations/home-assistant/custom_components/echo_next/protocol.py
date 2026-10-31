"""Pure MQTT protocol helpers for ECHO NEXT."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import re
from typing import Any

DEVICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,64}$")
TOPIC_PREFIX_PATTERN = re.compile(r"^(?!/)(?!.*//)[A-Za-z0-9_/-]{1,128}(?<!/)$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
PLAYBACK_STATES = frozenset(
    {"idle", "loading", "playing", "paused", "stopped", "error"}
)
SIMPLE_ACTIONS = frozenset({"play", "pause", "stop", "previous", "next"})
PLAYBACK_ORDER_MODES = frozenset({"sequential", "shuffle", "repeat-one"})


@dataclass(frozen=True, slots=True)
class EchoTrack:
    """Public track metadata exposed by ECHO."""

    id: str | None
    title: str | None
    artist: str | None
    album: str | None
    album_artist: str | None


@dataclass(frozen=True, slots=True)
class EchoOutput:
    """Public output metadata exposed by ECHO."""

    mode: str | None
    device_name: str | None
    backend: str | None


@dataclass(frozen=True, slots=True)
class EchoPlaybackSnapshot:
    """Validated ECHO playback snapshot."""

    revision: int
    observed_at: str
    state: str
    track: EchoTrack | None
    position_ms: int
    duration_ms: int
    volume: float
    output: EchoOutput


@dataclass(frozen=True, slots=True)
class EchoCommandResult:
    """Validated command result."""

    request_id: str
    client_id: str
    ok: bool
    completed_at: str
    error: str | None


def normalize_device_id(value: str) -> str:
    """Validate and normalize an ECHO device id."""
    normalized = value.strip()
    if not DEVICE_ID_PATTERN.fullmatch(normalized):
        raise ValueError("invalid_device_id")
    return normalized


def normalize_topic_prefix(value: str) -> str:
    """Validate and normalize an MQTT topic prefix."""
    normalized = value.strip()
    if not TOPIC_PREFIX_PATTERN.fullmatch(normalized):
        raise ValueError("invalid_topic_prefix")
    return normalized


def topic_root(topic_prefix: str, device_id: str) -> str:
    """Build the ECHO MQTT topic root."""
    return f"{normalize_topic_prefix(topic_prefix)}/{normalize_device_id(device_id)}"


def _record(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(code)
    return value


def _optional_text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _finite_number(value: Any, code: str) -> float:
    if isinstance(value, bool):
        raise ValueError(code)
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(code) from error
    if not math.isfinite(number):
        raise ValueError(code)
    return number


def parse_snapshot(payload: str | bytes) -> EchoPlaybackSnapshot:
    """Parse and validate a public ECHO state payload."""
    try:
        raw = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("invalid_state_json") from error
    value = _record(raw, "invalid_state_payload")
    if value.get("version") != 1:
        raise ValueError("unsupported_state_version")

    revision = value.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise ValueError("invalid_state_revision")
    observed_at = value.get("observedAt")
    if not isinstance(observed_at, str) or not observed_at:
        raise ValueError("invalid_state_observed_at")
    state = value.get("state")
    if state not in PLAYBACK_STATES:
        raise ValueError("invalid_playback_state")

    track_value = value.get("track")
    track = None
    if track_value is not None:
        track_record = _record(track_value, "invalid_track")
        track = EchoTrack(
            id=_optional_text(track_record.get("id")),
            title=_optional_text(track_record.get("title")),
            artist=_optional_text(track_record.get("artist")),
            album=_optional_text(track_record.get("album")),
            album_artist=_optional_text(track_record.get("albumArtist")),
        )

    output_value = _record(value.get("output"), "invalid_output")
    position_ms = _finite_number(value.get("positionMs"), "invalid_position")
    duration_ms = _finite_number(value.get("durationMs"), "invalid_duration")
    volume = _finite_number(value.get("volume"), "invalid_volume")
    if position_ms < 0 or duration_ms < 0 or volume < 0 or volume > 1:
        raise ValueError("state_value_out_of_range")

    return EchoPlaybackSnapshot(
        revision=revision,
        observed_at=observed_at,
        state=state,
        track=track,
        position_ms=round(position_ms),
        duration_ms=round(duration_ms),
        volume=volume,
        output=EchoOutput(
            mode=_optional_text(output_value.get("mode")),
            device_name=_optional_text(output_value.get("deviceName")),
            backend=_optional_text(output_value.get("backend")),
        ),
    )


def build_command(
    client_id: str,
    request_id: str,
    action: str,
    **parameters: Any,
) -> str:
    """Build a strict ECHO command payload."""
    if not IDENTIFIER_PATTERN.fullmatch(client_id):
        raise ValueError("invalid_client_id")
    if not IDENTIFIER_PATTERN.fullmatch(request_id):
        raise ValueError("invalid_request_id")

    payload: dict[str, Any] = {
        "version": 1,
        "clientId": client_id,
        "requestId": request_id,
        "action": action,
    }
    if action in SIMPLE_ACTIONS:
        if parameters:
            raise ValueError("unexpected_command_parameters")
    elif action == "seek":
        position_ms = _finite_number(parameters.get("positionMs"), "invalid_seek_position")
        if position_ms < 0:
            raise ValueError("invalid_seek_position")
        payload["positionMs"] = round(position_ms)
    elif action == "setVolume":
        volume = _finite_number(parameters.get("volume"), "invalid_volume")
        if volume < 0 or volume > 1:
            raise ValueError("invalid_volume")
        payload["volume"] = volume
    elif action == "setPlaybackOrder":
        mode = parameters.get("mode")
        if mode not in PLAYBACK_ORDER_MODES:
            raise ValueError("invalid_playback_order")
        payload["mode"] = mode
    else:
        raise ValueError("unsupported_playback_action")

    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def parse_result(payload: str | bytes) -> EchoCommandResult:
    """Parse and validate an ECHO command result."""
    try:
        raw = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("invalid_result_json") from error
    value = _record(raw, "invalid_result_payload")
    if value.get("version") != 1:
        raise ValueError("unsupported_result_version")
    request_id = value.get("requestId")
    client_id = value.get("clientId")
    completed_at = value.get("completedAt")
    ok = value.get("ok")
    if not isinstance(request_id, str) or not IDENTIFIER_PATTERN.fullmatch(request_id):
        raise ValueError("invalid_result_request_id")
    if not isinstance(client_id, str) or not IDENTIFIER_PATTERN.fullmatch(client_id):
        raise ValueError("invalid_result_client_id")
    if not isinstance(completed_at, str) or not completed_at:
        raise ValueError("invalid_result_completed_at")
    if not isinstance(ok, bool):
        raise ValueError("invalid_result_status")
    error = value.get("error")
    if error is not None and not isinstance(error, str):
        raise ValueError("invalid_result_error")
    return EchoCommandResult(
        request_id=request_id,
        client_id=client_id,
        ok=ok,
        completed_at=completed_at,
        error=error,
    )
