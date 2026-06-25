#pragma once

#include "OutputDevice.h"

#include <atomic>
#include <cstdint>
#include <vector>

namespace echo_audio_daemon {

// ── Null Audio Output Backend ────────────────────────────────────────────────
// Consumes samples without any real audio output. Tracks frame count and
// write count for test verification. Zero side-effects — no device, no
// platform API, no audio library dependency.
class NullBackend : public OutputDevice {
public:
    NullBackend() = default;
    ~NullBackend() override = default;

    // ── Lifecycle ─────────────────────────────────────────────────────────

    bool open(const DeviceInfo& device,
              int sampleRate,
              int channels,
              int bufferFrames) override;

    void close() override;

    // ── Data Transfer ─────────────────────────────────────────────────────

    bool write(const float* samples, int frameCount) override;

    // ── State Queries ─────────────────────────────────────────────────────

    bool isOpen() const override { return isOpen_; }
    int getSampleRate() const override { return sampleRate_; }
    int getChannels() const override { return channels_; }
    int getBufferFrames() const override { return bufferFrames_; }
    std::string getBackendName() const override { return "null"; }

    // ── Test Helpers ──────────────────────────────────────────────────────

    /// Total number of frames written over the lifetime of this instance.
    uint64_t totalFramesWritten() const { return framesWritten_.load(); }

    /// Number of write() calls made.
    uint64_t writeCount() const { return writeCount_.load(); }

    /// A copy of the samples from the most recent write() call.
    const std::vector<float>& lastSamples() const { return lastSamples_; }

private:
    bool isOpen_ = false;
    int sampleRate_ = 0;
    int channels_ = 0;
    int bufferFrames_ = 0;

    std::atomic<uint64_t> framesWritten_{0};
    std::atomic<uint64_t> writeCount_{0};
    std::vector<float> lastSamples_;   // last written samples for test inspection
};

} // namespace echo_audio_daemon
