#pragma once

#include "../common/AudioTypes.h"

#include <string>

namespace echo_audio_daemon {

// ── Output Device Interface ──────────────────────────────────────────────────
// Pure virtual base for all audio output backends (NullBackend,
// MiniaudioBackend, WasapiExclusiveBackend, AsioBackend).
class OutputDevice {
public:
    virtual ~OutputDevice() = default;

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /// Open device with the specified parameters.
    /// @param device      DeviceInfo describing the target hardware.
    /// @param sampleRate  Sample rate in Hz (e.g. 44100, 48000, 96000).
    /// @param channels    Number of output channels (1 = mono, 2 = stereo).
    /// @param bufferFrames  Desired buffer size in frames.
    /// @return true if the device was opened successfully.
    virtual bool open(const DeviceInfo& device,
                      int sampleRate,
                      int channels,
                      int bufferFrames) = 0;

    /// Close the device and release all resources.
    virtual void close() = 0;

    // ── Data Transfer ─────────────────────────────────────────────────────

    /// Write interleaved float32 samples to the output.
    /// @param samples    Pointer to interleaved float32 sample data.
    /// @param frameCount Number of audio frames (samples per channel).
    /// @return true if the samples were accepted / queued successfully.
    virtual bool write(const float* samples, int frameCount) = 0;

    // ── State Queries ─────────────────────────────────────────────────────

    /// Whether the device is currently open.
    virtual bool isOpen() const = 0;

    /// Current sample rate (Hz). Valid only when open.
    virtual int getSampleRate() const = 0;

    /// Current channel count. Valid only when open.
    virtual int getChannels() const = 0;

    /// Configured buffer size in frames. Valid only when open.
    virtual int getBufferFrames() const = 0;

    /// Human-readable backend name (e.g. "null", "miniaudio", "wasapi_exclusive").
    virtual std::string getBackendName() const = 0;

    // ── Optional ──────────────────────────────────────────────────────────

    /// Flush any internal buffers. No-op by default.
    virtual void flush() {}
};

} // namespace echo_audio_daemon
