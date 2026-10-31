"""MQTT control plane for ECHO NEXT."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import Any
from uuid import uuid4

from homeassistant.components import mqtt
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import COMMAND_TIMEOUT_SECONDS
from .protocol import (
    EchoPlaybackSnapshot,
    build_command,
    parse_result,
    parse_snapshot,
    topic_root,
)

_LOGGER = logging.getLogger(__name__)

StateListener = Callable[[], None]


class EchoMqttController:
    """Own MQTT subscriptions and correlated ECHO commands."""

    def __init__(
        self,
        hass: HomeAssistant,
        *,
        entry_id: str,
        topic_prefix: str,
        device_id: str,
    ) -> None:
        """Initialize the ECHO MQTT controller."""
        self.hass = hass
        self.device_id = device_id
        self.root_topic = topic_root(topic_prefix, device_id)
        self.client_id = f"home-assistant-{entry_id[:8]}"
        self.snapshot: EchoPlaybackSnapshot | None = None
        self.available = False
        self._listeners: set[StateListener] = set()
        self._pending: dict[str, asyncio.Future[None]] = {}
        self._unsubscribers: list[CALLBACK_TYPE] = []
        self._started = False

    async def async_start(self) -> None:
        """Subscribe to ECHO state, availability, and command results."""
        if self._started:
            return
        self._started = True
        try:
            self._unsubscribers.append(
                await mqtt.async_subscribe(
                    self.hass,
                    f"{self.root_topic}/state",
                    self._handle_state,
                    qos=0,
                )
            )
            self._unsubscribers.append(
                await mqtt.async_subscribe(
                    self.hass,
                    f"{self.root_topic}/availability",
                    self._handle_availability,
                    qos=1,
                )
            )
            self._unsubscribers.append(
                await mqtt.async_subscribe(
                    self.hass,
                    f"{self.root_topic}/result/{self.client_id}/+",
                    self._handle_result,
                    qos=1,
                )
            )
            self._unsubscribers.append(
                mqtt.async_subscribe_connection_status(
                    self.hass,
                    self._handle_mqtt_connection,
                )
            )
        except Exception:
            await self.async_stop()
            raise

    async def async_stop(self) -> None:
        """Remove subscriptions and fail outstanding commands."""
        if not self._started:
            return
        self._started = False
        while self._unsubscribers:
            self._unsubscribers.pop()()
        for future in self._pending.values():
            if not future.done():
                future.set_exception(HomeAssistantError("ECHO NEXT integration unloaded"))
        self._pending.clear()
        self.available = False
        self._notify()

    @callback
    def async_add_listener(self, listener: StateListener) -> CALLBACK_TYPE:
        """Register an entity state listener."""
        self._listeners.add(listener)

        @callback
        def remove_listener() -> None:
            self._listeners.discard(listener)

        return remove_listener

    async def async_execute(self, action: str, **parameters: Any) -> None:
        """Publish a command and wait for the correlated ECHO result."""
        if not self.available:
            raise HomeAssistantError("ECHO NEXT is unavailable")
        request_id = f"ha-{uuid4().hex}"
        payload = build_command(
            self.client_id,
            request_id,
            action,
            **parameters,
        )
        future = self.hass.loop.create_future()
        self._pending[request_id] = future
        try:
            await mqtt.async_publish(
                self.hass,
                f"{self.root_topic}/command",
                payload,
                qos=1,
                retain=False,
            )
            await asyncio.wait_for(
                asyncio.shield(future),
                timeout=COMMAND_TIMEOUT_SECONDS,
            )
        except TimeoutError as error:
            raise HomeAssistantError(
                f"ECHO NEXT command timed out: {action}"
            ) from error
        finally:
            pending = self._pending.pop(request_id, None)
            if pending is not None and not pending.done():
                pending.cancel()

    @callback
    def _handle_state(self, message: mqtt.ReceiveMessage) -> None:
        try:
            self.snapshot = parse_snapshot(message.payload)
        except ValueError as error:
            _LOGGER.warning("Ignored invalid ECHO NEXT state: %s", error)
            return
        self._notify()

    @callback
    def _handle_availability(self, message: mqtt.ReceiveMessage) -> None:
        payload = message.payload
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8", errors="replace")
        payload = str(payload).strip().lower()
        self.available = payload == "online"
        if not self.available:
            self._fail_pending("ECHO NEXT became unavailable")
        self._notify()

    @callback
    def _handle_result(self, message: mqtt.ReceiveMessage) -> None:
        try:
            result = parse_result(message.payload)
        except ValueError as error:
            _LOGGER.warning("Ignored invalid ECHO NEXT command result: %s", error)
            return
        if result.client_id != self.client_id:
            return
        future = self._pending.get(result.request_id)
        if future is None or future.done():
            return
        if result.ok:
            future.set_result(None)
        else:
            future.set_exception(
                HomeAssistantError(
                    f"ECHO NEXT rejected the command: {result.error or 'unknown_error'}"
                )
            )

    @callback
    def _handle_mqtt_connection(self, connected: bool) -> None:
        if connected:
            return
        self.available = False
        self._fail_pending("MQTT disconnected")
        self._notify()

    @callback
    def _fail_pending(self, message: str) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(HomeAssistantError(message))

    @callback
    def _notify(self) -> None:
        for listener in tuple(self._listeners):
            listener()
