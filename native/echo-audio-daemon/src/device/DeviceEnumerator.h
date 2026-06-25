#pragma once

#include "../common/AudioTypes.h"

#include <string>
#include <vector>

namespace echo_audio_daemon {

/// Unified device enumerator across all audio backends.
///
/// Provides static methods for listing audio output devices from:
///   - Miniaudio (shared mode: WASAPI Shared, ALSA, PulseAudio)
///   - WASAPI exclusive mode (Windows only)
///   - ASIO drivers (Windows only, requires ECHO_ENABLE_ASIO)
class DeviceEnumerator {
public:
    /// Enumerate shared-mode playback devices via miniaudio.
    /// On Windows this covers WASAPI Shared; on Linux ALSA / PulseAudio.
    static std::vector<DeviceInfo> enumerateShared();

    /// Enumerate WASAPI exclusive-mode render endpoints (Windows only).
    /// Uses raw IMMDeviceEnumerator COM API.
    /// Returns an empty vector on non-Windows or when WASAPI exclusive
    /// is disabled at build time.
    static std::vector<DeviceInfo> enumerateExclusive();

    /// Enumerate ASIO drivers (Windows only).
    /// Requires ECHO_ENABLE_ASIO to be defined at build time.
    /// Returns an empty vector otherwise.
    static std::vector<DeviceInfo> enumerateAsio();

    /// Unified enumeration — calls all three backends and deduplicates
    /// by device name.  Shared + exclusive entries from the same
    /// physical device each appear once (different outputMode).
    static std::vector<DeviceInfo> enumerateAll();

    /// Find a device by its @p id across all backends.
    /// Calls enumerateAll() internally; returns a default-constructed
    /// DeviceInfo (id empty) if not found.
    static DeviceInfo findById(const std::string& id);

    /// Return the system default shared-mode playback device.
    /// Returns a default-constructed DeviceInfo (id empty) if none found.
    static DeviceInfo getDefaultShared();
};

} // namespace echo_audio_daemon
