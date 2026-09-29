"""ECHO NEXT Home Assistant integration."""

from __future__ import annotations

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady

from .const import CONF_DEVICE_ID, CONF_TOPIC_PREFIX, PLATFORMS
from .mqtt_controller import EchoMqttController

type EchoNextConfigEntry = ConfigEntry[EchoMqttController]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EchoNextConfigEntry,
) -> bool:
    """Set up ECHO NEXT from a config entry."""
    if not await mqtt.async_wait_for_mqtt_client(hass):
        raise ConfigEntryNotReady("Home Assistant MQTT client is unavailable")

    controller = EchoMqttController(
        hass,
        entry_id=entry.entry_id,
        topic_prefix=entry.data[CONF_TOPIC_PREFIX],
        device_id=entry.data[CONF_DEVICE_ID],
    )
    await controller.async_start()
    entry.runtime_data = controller
    try:
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception:
        await controller.async_stop()
        raise
    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: EchoNextConfigEntry,
) -> bool:
    """Unload an ECHO NEXT config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.async_stop()
    return unloaded
