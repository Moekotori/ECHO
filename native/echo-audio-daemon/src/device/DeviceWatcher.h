#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <thread>

namespace echo_audio_daemon {

/// Device hotplug monitor.
///
/// Watches for audio device changes (add / remove / default-change) and
/// invokes a user-supplied callback.  The watcher runs its own thread;
/// callbacks are dispatched from that thread and MUST NOT block.
///
/// ## Events
///   - "added"            — a new device appeared
///   - "removed"          — a device was removed
///   - "default_changed"  — the system default device changed
///   - "state_changed"    — a device's state changed (enabled / disabled)
///
/// ## Platform
///   - Windows :  IMMNotificationClient COM interface
///   - Linux   :  polls /proc/asound/cards every ~1 s
class DeviceWatcher {
public:
    using Callback = std::function<void(const std::string& event,
                                        const std::string& deviceId)>;

    DeviceWatcher() = default;
    ~DeviceWatcher();

    DeviceWatcher(const DeviceWatcher&) = delete;
    DeviceWatcher& operator=(const DeviceWatcher&) = delete;

    DeviceWatcher(DeviceWatcher&&) = delete;
    DeviceWatcher& operator=(DeviceWatcher&&) = delete;

    /// Set the callback invoked on device change events.
    /// May be called before or after start() but is not thread-safe
    /// when called concurrently with the running callback.
    void setCallback(Callback cb);

    /// Start monitoring.  Returns true if the watcher thread was
    /// successfully launched.
    bool start();

    /// Request a graceful stop and join the watcher thread.
    void stop();

    /// Whether the watcher thread is currently running.
    bool isRunning() const;

private:
    void run();

    std::atomic<bool> running_{false};
    std::thread       thread_;
    Callback          callback_;

// ── Platform-specific state ───────────────────────────────────────────────
#ifdef _WIN32
    void* deviceEnumerator_ = nullptr;  // IMMDeviceEnumerator*
    void* notifyClient_     = nullptr;  // IMMNotificationClient*
#else
    std::string lastCardsState_;        // cached /proc/asound/cards snapshot
#endif
};

} // namespace echo_audio_daemon
