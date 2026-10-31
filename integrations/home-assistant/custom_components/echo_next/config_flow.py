"""Config flow for ECHO NEXT."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult

from .const import (
    CONF_DEVICE_ID,
    CONF_DEVICE_NAME,
    CONF_TOPIC_PREFIX,
    DEFAULT_DEVICE_NAME,
    DEFAULT_TOPIC_PREFIX,
    DOMAIN,
)
from .protocol import normalize_device_id, normalize_topic_prefix


def _device_id(value: Any) -> str:
    if not isinstance(value, str):
        raise vol.Invalid("invalid_device_id")
    try:
        return normalize_device_id(value)
    except ValueError as error:
        raise vol.Invalid("invalid_device_id") from error


def _topic_prefix(value: Any) -> str:
    if not isinstance(value, str):
        raise vol.Invalid("invalid_topic_prefix")
    try:
        return normalize_topic_prefix(value)
    except ValueError as error:
        raise vol.Invalid("invalid_topic_prefix") from error


def _device_name(value: Any) -> str:
    if not isinstance(value, str):
        raise vol.Invalid("invalid_device_name")
    normalized = value.strip()
    if not 1 <= len(normalized) <= 64:
        raise vol.Invalid("invalid_device_name")
    return normalized


class EchoNextConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle an ECHO NEXT config flow."""

    VERSION = 1

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:
        """Create an ECHO NEXT MQTT entry."""
        errors: dict[str, str] = {}
        if user_input is not None:
            device_id = user_input[CONF_DEVICE_ID]
            await self.async_set_unique_id(device_id)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=user_input[CONF_DEVICE_NAME],
                data=user_input,
            )

        schema = vol.Schema(
            {
                vol.Required(CONF_DEVICE_ID): _device_id,
                vol.Required(
                    CONF_TOPIC_PREFIX,
                    default=DEFAULT_TOPIC_PREFIX,
                ): _topic_prefix,
                vol.Required(
                    CONF_DEVICE_NAME,
                    default=DEFAULT_DEVICE_NAME,
                ): _device_name,
            }
        )
        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
        )
