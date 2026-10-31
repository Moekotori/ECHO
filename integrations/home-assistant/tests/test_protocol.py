"""Tests for the ECHO NEXT Home Assistant MQTT protocol helpers."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest

PROTOCOL_PATH = (
    Path(__file__).parents[1]
    / "custom_components"
    / "echo_next"
    / "protocol.py"
)
SPEC = importlib.util.spec_from_file_location("echo_next_protocol", PROTOCOL_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load ECHO NEXT protocol module")
PROTOCOL = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PROTOCOL
SPEC.loader.exec_module(PROTOCOL)


class EchoNextProtocolTests(unittest.TestCase):
    """Verify the public ECHO MQTT contract."""

    def test_parses_safe_playback_snapshot(self) -> None:
        snapshot = PROTOCOL.parse_snapshot(
            json.dumps(
                {
                    "version": 1,
                    "revision": 9,
                    "observedAt": "2026-07-28T02:00:00.000Z",
                    "state": "playing",
                    "track": {
                        "id": "track-1",
                        "title": "Example",
                        "artist": "ECHO",
                        "album": "Connected",
                        "albumArtist": "ECHO",
                    },
                    "positionMs": 12345,
                    "durationMs": 180000,
                    "volume": 0.42,
                    "output": {
                        "mode": "shared",
                        "deviceName": "Speakers",
                        "backend": "wasapi",
                    },
                }
            )
        )

        self.assertEqual(snapshot.state, "playing")
        self.assertEqual(snapshot.track.title, "Example")
        self.assertEqual(snapshot.position_ms, 12345)
        self.assertEqual(snapshot.volume, 0.42)
        self.assertEqual(snapshot.output.device_name, "Speakers")

    def test_rejects_invalid_snapshot_ranges(self) -> None:
        with self.assertRaisesRegex(ValueError, "state_value_out_of_range"):
            PROTOCOL.parse_snapshot(
                json.dumps(
                    {
                        "version": 1,
                        "revision": 1,
                        "observedAt": "2026-07-28T02:00:00.000Z",
                        "state": "playing",
                        "track": None,
                        "positionMs": -1,
                        "durationMs": 10,
                        "volume": 2,
                        "output": {},
                    }
                )
            )

    def test_builds_correlated_control_commands(self) -> None:
        payload = json.loads(
            PROTOCOL.build_command(
                "home-assistant-a1b2c3d4",
                "ha-request-1",
                "seek",
                positionMs=60123,
            )
        )

        self.assertEqual(
            payload,
            {
                "version": 1,
                "clientId": "home-assistant-a1b2c3d4",
                "requestId": "ha-request-1",
                "action": "seek",
                "positionMs": 60123,
            },
        )

    def test_rejects_unbounded_volume(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_volume"):
            PROTOCOL.build_command(
                "home-assistant-a1b2c3d4",
                "ha-request-2",
                "setVolume",
                volume=1.5,
            )

    def test_parses_success_and_error_results(self) -> None:
        success = PROTOCOL.parse_result(
            json.dumps(
                {
                    "version": 1,
                    "requestId": "ha-request-1",
                    "clientId": "home-assistant-a1b2c3d4",
                    "ok": True,
                    "completedAt": "2026-07-28T02:00:01.000Z",
                }
            )
        )
        failure = PROTOCOL.parse_result(
            json.dumps(
                {
                    "version": 1,
                    "requestId": "ha-request-2",
                    "clientId": "home-assistant-a1b2c3d4",
                    "ok": False,
                    "completedAt": "2026-07-28T02:00:02.000Z",
                    "error": "command_rate_limited",
                }
            )
        )

        self.assertTrue(success.ok)
        self.assertFalse(failure.ok)
        self.assertEqual(failure.error, "command_rate_limited")

    def test_validates_device_and_topic_identity(self) -> None:
        self.assertEqual(PROTOCOL.topic_root("echo/home", "echo-aabbcc"), "echo/home/echo-aabbcc")
        with self.assertRaisesRegex(ValueError, "invalid_device_id"):
            PROTOCOL.topic_root("echo", "../private")
        with self.assertRaisesRegex(ValueError, "invalid_topic_prefix"):
            PROTOCOL.topic_root("echo//nested", "echo-aabbcc")


if __name__ == "__main__":
    unittest.main()
