"""Media player entity for ECHO NEXT."""

from __future__ import annotations

from homeassistant.components.media_player import (
    MediaPlayerDeviceClass,
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.components.media_player.const import MediaType
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import CONF_DEVICE_ID, CONF_DEVICE_NAME, DOMAIN
from .mqtt_controller import EchoMqttController
from .protocol import EchoPlaybackSnapshot

type EchoNextConfigEntry = ConfigEntry[EchoMqttController]

SUPPORTED_FEATURES = (
    MediaPlayerEntityFeature.PLAY
    | MediaPlayerEntityFeature.PAUSE
    | MediaPlayerEntityFeature.STOP
    | MediaPlayerEntityFeature.PREVIOUS_TRACK
    | MediaPlayerEntityFeature.NEXT_TRACK
    | MediaPlayerEntityFeature.SEEK
    | MediaPlayerEntityFeature.VOLUME_SET
)

STATE_MAP = {
    "loading": MediaPlayerState.BUFFERING,
    "playing": MediaPlayerState.PLAYING,
    "paused": MediaPlayerState.PAUSED,
    "idle": MediaPlayerState.IDLE,
    "stopped": MediaPlayerState.IDLE,
    "error": MediaPlayerState.IDLE,
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EchoNextConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the ECHO NEXT media player."""
    async_add_entities(
        [
            EchoNextMediaPlayer(
                controller=entry.runtime_data,
                device_id=entry.data[CONF_DEVICE_ID],
                device_name=entry.data[CONF_DEVICE_NAME],
            )
        ]
    )


class EchoNextMediaPlayer(MediaPlayerEntity):
    """Represent ECHO NEXT as a native Home Assistant media player."""

    _attr_device_class = MediaPlayerDeviceClass.SPEAKER
    _attr_has_entity_name = True
    _attr_media_content_type = MediaType.MUSIC
    _attr_name = None
    _attr_should_poll = False
    _attr_supported_features = SUPPORTED_FEATURES

    def __init__(
        self,
        *,
        controller: EchoMqttController,
        device_id: str,
        device_name: str,
    ) -> None:
        """Initialize the ECHO NEXT media player."""
        self._controller = controller
        self._attr_unique_id = f"echo_next_{device_id}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, device_id)},
            manufacturer="ECHO",
            model="ECHO NEXT",
            name=device_name,
        )
        self._apply_controller_state()

    async def async_added_to_hass(self) -> None:
        """Subscribe to controller updates."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self._controller.async_add_listener(self._handle_controller_update)
        )
        self._apply_controller_state()

    @callback
    def _handle_controller_update(self) -> None:
        self._apply_controller_state()
        self.async_write_ha_state()

    @callback
    def _apply_controller_state(self) -> None:
        self._attr_available = self._controller.available
        snapshot = self._controller.snapshot
        if snapshot is None:
            self._clear_media_state()
            return
        self._apply_snapshot(snapshot)

    @callback
    def _clear_media_state(self) -> None:
        self._attr_state = MediaPlayerState.IDLE
        self._attr_media_content_id = None
        self._attr_media_title = None
        self._attr_media_artist = None
        self._attr_media_album_name = None
        self._attr_media_album_artist = None
        self._attr_media_position = None
        self._attr_media_duration = None
        self._attr_media_position_updated_at = None
        self._attr_volume_level = None
        self._attr_extra_state_attributes = {}

    @callback
    def _apply_snapshot(self, snapshot: EchoPlaybackSnapshot) -> None:
        track = snapshot.track
        self._attr_state = STATE_MAP[snapshot.state]
        self._attr_media_content_id = track.id if track else None
        self._attr_media_title = track.title if track else None
        self._attr_media_artist = track.artist if track else None
        self._attr_media_album_name = track.album if track else None
        self._attr_media_album_artist = track.album_artist if track else None
        self._attr_media_position = snapshot.position_ms / 1000
        self._attr_media_duration = snapshot.duration_ms / 1000
        self._attr_media_position_updated_at = (
            dt_util.parse_datetime(snapshot.observed_at) or dt_util.utcnow()
        )
        self._attr_volume_level = snapshot.volume
        self._attr_extra_state_attributes = {
            "echo_playback_state": snapshot.state,
            "echo_revision": snapshot.revision,
            "observed_at": snapshot.observed_at,
            "output_mode": snapshot.output.mode,
            "output_device": snapshot.output.device_name,
            "output_backend": snapshot.output.backend,
        }

    async def async_media_play(self) -> None:
        """Play media."""
        await self._controller.async_execute("play")

    async def async_media_pause(self) -> None:
        """Pause media."""
        await self._controller.async_execute("pause")

    async def async_media_stop(self) -> None:
        """Stop media."""
        await self._controller.async_execute("stop")

    async def async_media_previous_track(self) -> None:
        """Play the previous track."""
        await self._controller.async_execute("previous")

    async def async_media_next_track(self) -> None:
        """Play the next track."""
        await self._controller.async_execute("next")

    async def async_media_seek(self, position: float) -> None:
        """Seek to a position in seconds."""
        await self._controller.async_execute(
            "seek",
            positionMs=max(0, round(position * 1000)),
        )

    async def async_set_volume_level(self, volume: float) -> None:
        """Set the volume level."""
        await self._controller.async_execute(
            "setVolume",
            volume=max(0.0, min(1.0, volume)),
        )
