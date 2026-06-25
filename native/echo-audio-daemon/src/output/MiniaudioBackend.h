#pragma once

#include "OutputDevice.h"
#include <miniaudio.h>

#include <atomic>
#include <string>
#include <vector>

namespace echo_audio_daemon {

// ── Miniaudio Audio Output Backend ──────────────────────────────────────────
// Shared-mode audio output using the miniaudio library (WASAPI Shared on
// Windows, ALSA/PulseAudio on Linux).  Uses a lock-free SPSC ring buffer
// (ma_pcm_rb) between write() and the miniaudio data callback so that the
// callback never blocks.
class MiniaudioBackend : public OutputDevice {
public:
    MiniaudioBackend();
    ~MiniaudioBackend() override;

    // ── Lifecycle ─────────────────────────────────────────────────────────
    bool open(const DeviceInfo& device,
              int sampleRate,
              int channels,
              int bufferFrames) override;
    void close() override;

    // ── Data Transfer ─────────────────────────────────────────────────────
    bool write(const float* samples, int frameCount) override;

    // ── State Queries ─────────────────────────────────────────────────────
    bool isOpen() const override { return deviceInitialized_.load(); }
    int getSampleRate() const override { return sampleRate_; }
    int getChannels() const override { return channels_; }
    int getBufferFrames() const override { return bufferFrames_; }
    std::string getBackendName() const override { return "miniaudio"; }

    // ── Static Helpers ────────────────────────────────────────────────────

    /// Enumerate all available playback devices.
    static std::vector<DeviceInfo> enumerate();

    /// Return the system-default playback device (or first available).
    static DeviceInfo getDefaultDevice();

private:
    // Miniaudio handles
    ma_device device_;
    ma_device_config deviceConfig_;
    ma_context context_;

    // Lock-free SPSC ring buffer (inter-thread: write() → dataCallback)
    ma_pcm_rb ringBuffer_;

    // State
    std::atomic<bool> deviceInitialized_{false};
    int sampleRate_ = 0;
    int channels_ = 0;
    int bufferFrames_ = 0;
    bool contextInitialized_ = false;

    // Decoded device ID (from hex stored in DeviceInfo.id)
    ma_device_id deviceId_;

    // ── Helpers ───────────────────────────────────────────────────────

    /// Encode a ma_device_id to a hex string for storage in DeviceInfo.id.
    static std::string encodeDeviceId(const ma_device_id& id);

    /// Decode a hex string back to a ma_device_id.
    static bool decodeDeviceId(const std::string& str, ma_device_id& id);

    // ── Miniaudio Callbacks (static, called from audio thread) ─────────

    /// Data callback: pull samples from the ring buffer into the output.
    static void dataCallback(ma_device* pDevice,
                             void* pOutput,
                             const void* pInput,
                             ma_uint32 frameCount);

    /// Notification callback: detect device disconnect / reroute events.
    static void notificationCallback(const ma_device_notification* pNotification);
};

} // namespace echo_audio_daemon
