"""Focused tests for the ECHO NEXT MQTT command controller."""

from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest

INTEGRATION_DIR = (
    Path(__file__).parents[1] / "custom_components" / "echo_next"
)
TEST_PACKAGE = "echo_next_controller_test"


class HomeAssistantError(Exception):
    """Test substitute for Home Assistant service errors."""


class MqttHarness:
    """Record MQTT subscriptions and publications."""

    def __init__(self) -> None:
        self.subscriptions: dict[str, object] = {}
        self.connection_listener = None
        self.published: list[dict[str, object]] = []
        self.unsubscribe_count = 0
        self.fail_subscribe_topic: str | None = None

    def unsubscribe(self) -> None:
        self.unsubscribe_count += 1


class FakeHass:
    """Small Home Assistant event-loop substitute."""

    def __init__(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.mqtt_harness = MqttHarness()


def _install_home_assistant_stubs() -> None:
    homeassistant = ModuleType("homeassistant")
    components = ModuleType("homeassistant.components")
    mqtt = ModuleType("homeassistant.components.mqtt")
    core = ModuleType("homeassistant.core")
    exceptions = ModuleType("homeassistant.exceptions")

    async def async_subscribe(hass, topic, listener, qos=0):
        del qos
        if topic == hass.mqtt_harness.fail_subscribe_topic:
            raise RuntimeError("subscription_failed")
        hass.mqtt_harness.subscriptions[topic] = listener
        return hass.mqtt_harness.unsubscribe

    async def async_publish(hass, topic, payload, qos=0, retain=False):
        hass.mqtt_harness.published.append(
            {
                "topic": topic,
                "payload": payload,
                "qos": qos,
                "retain": retain,
            }
        )

    def async_subscribe_connection_status(hass, listener):
        hass.mqtt_harness.connection_listener = listener
        return hass.mqtt_harness.unsubscribe

    mqtt.async_subscribe = async_subscribe
    mqtt.async_publish = async_publish
    mqtt.async_subscribe_connection_status = async_subscribe_connection_status
    mqtt.ReceiveMessage = object
    components.mqtt = mqtt

    core.CALLBACK_TYPE = object
    core.HomeAssistant = object
    core.callback = lambda function: function
    exceptions.HomeAssistantError = HomeAssistantError

    sys.modules["homeassistant"] = homeassistant
    sys.modules["homeassistant.components"] = components
    sys.modules["homeassistant.components.mqtt"] = mqtt
    sys.modules["homeassistant.core"] = core
    sys.modules["homeassistant.exceptions"] = exceptions


def _load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(
        f"{TEST_PACKAGE}.{name}",
        INTEGRATION_DIR / filename,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {filename}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_install_home_assistant_stubs()
package = ModuleType(TEST_PACKAGE)
package.__path__ = [str(INTEGRATION_DIR)]
sys.modules[TEST_PACKAGE] = package
_load_module("const", "const.py")
_load_module("protocol", "protocol.py")
controller_module = _load_module("mqtt_controller", "mqtt_controller.py")
EchoMqttController = controller_module.EchoMqttController


class EchoMqttControllerTest(unittest.IsolatedAsyncioTestCase):
    """Verify command correlation and fail-safe behavior."""

    async def asyncSetUp(self) -> None:
        self.hass = FakeHass()
        self.controller = EchoMqttController(
            self.hass,
            entry_id="1234567890abcdef",
            topic_prefix="echo",
            device_id="living-room",
        )
        await self.controller.async_start()

    async def asyncTearDown(self) -> None:
        await self.controller.async_stop()

    def _set_online(self) -> None:
        listener = self.hass.mqtt_harness.subscriptions[
            "echo/living-room/availability"
        ]
        listener(SimpleNamespace(payload=b"online"))

    async def _start_command(self, action: str = "play") -> tuple[asyncio.Task, dict]:
        task = asyncio.create_task(self.controller.async_execute(action))
        await asyncio.sleep(0)
        published = self.hass.mqtt_harness.published[-1]
        return task, json.loads(published["payload"])

    def _deliver_result(
        self,
        command: dict,
        *,
        ok: bool,
        error: str | None = None,
    ) -> None:
        listener = self.hass.mqtt_harness.subscriptions[
            "echo/living-room/result/home-assistant-12345678/+"
        ]
        listener(
            SimpleNamespace(
                payload=json.dumps(
                    {
                        "version": 1,
                        "clientId": command["clientId"],
                        "requestId": command["requestId"],
                        "ok": ok,
                        "completedAt": "2026-07-28T12:00:00Z",
                        "error": error,
                    }
                )
            )
        )

    async def test_command_completes_only_after_matching_success_result(self) -> None:
        self._set_online()
        task, command = await self._start_command()

        self.assertFalse(task.done())
        self.assertEqual(command["action"], "play")
        self.assertEqual(command["clientId"], "home-assistant-12345678")
        self.assertEqual(
            self.hass.mqtt_harness.published[-1]["topic"],
            "echo/living-room/command",
        )

        self._deliver_result(command, ok=True)
        await task

    async def test_rejected_command_surfaces_home_assistant_error(self) -> None:
        self._set_online()
        task, command = await self._start_command("pause")
        self._deliver_result(command, ok=False, error="not_allowed")

        with self.assertRaisesRegex(HomeAssistantError, "not_allowed"):
            await task

    async def test_disconnect_fails_pending_command(self) -> None:
        self._set_online()
        task, _ = await self._start_command("stop")

        self.hass.mqtt_harness.connection_listener(False)

        with self.assertRaisesRegex(HomeAssistantError, "MQTT disconnected"):
            await task
        self.assertFalse(self.controller.available)

    async def test_unavailable_controller_rejects_without_publish(self) -> None:
        with self.assertRaisesRegex(HomeAssistantError, "unavailable"):
            await self.controller.async_execute("play")
        self.assertEqual(self.hass.mqtt_harness.published, [])

    async def test_stop_removes_all_subscriptions(self) -> None:
        await self.controller.async_stop()
        self.assertEqual(self.hass.mqtt_harness.unsubscribe_count, 4)

    async def test_start_failure_rolls_back_prior_subscription(self) -> None:
        hass = FakeHass()
        hass.mqtt_harness.fail_subscribe_topic = "echo/office/availability"
        controller = EchoMqttController(
            hass,
            entry_id="abcdef1234567890",
            topic_prefix="echo",
            device_id="office",
        )

        with self.assertRaisesRegex(RuntimeError, "subscription_failed"):
            await controller.async_start()

        self.assertFalse(controller._started)
        self.assertEqual(hass.mqtt_harness.unsubscribe_count, 1)


if __name__ == "__main__":
    unittest.main()
