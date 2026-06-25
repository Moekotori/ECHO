#pragma once

#include "OutputDevice.h"

#include <atomic>
#include <memory>
#include <string>
#include <vector>

namespace echo_audio_daemon {

// ── Forward declarations from WASAPI C API ──────────────────────────────────
// These are fully defined in WasapiExclusiveBackend.cpp (Windows only).

#ifdef _WIN32
struct wasapi_exclusive_runtime;
#endif

// ── WASAPI Exclusive Audio Output Backend ────────────────────────────────────
// Wraps the existing WASAPI exclusive-mode C implementation (pure Win32 COM,
// no JUCE) into the OutputDevice interface.
//
// Architecture:
//   write() → AudioRingBuffer (SPSC lock-free) ← WASAPI render thread
//
// The render thread pulls samples from the ring buffer. Underruns produce
// silence (the WASAPI callback buffer is zeroed before the fill attempt).
//
// Platform guards:
//   Windows:   Full implementation using WASAPI exclusive mode.
//   Non-Windows: Stub that returns false on all operations.

class WasapiExclusiveBackend : public OutputDevice {
public:
    WasapiExclusiveBackend() = default;
    ~WasapiExclusiveBackend() override;

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
    std::string getBackendName() const override { return "wasapi_exclusive"; }

    // ── Device Enumeration ────────────────────────────────────────────────
    /// Enumerate available WASAPI exclusive-mode render devices.
    /// Returns an empty vector on non-Windows platforms.
    static std::vector<DeviceInfo> listAvailableDevices();

private:
    // ── Lock-free SPSC Ring Buffer ────────────────────────────────────────
    // Transfers audio samples from the write() caller (producer, audio
    // pipeline thread) to the WASAPI render thread (consumer) without
    // mutex contention.  Uses monotonically-increasing head/tail counters
    // so no ABA problem exists.
    class AudioRingBuffer {
    public:
        AudioRingBuffer(int capacityFrames, int channels);

        /// Write up to @p frameCount frames. Returns frames actually written.
        int write(const float* samples, int frameCount);

        /// Read up to @p maxFrames frames into @p samples. Returns frames
        /// actually read (may be less than maxFrames — caller should zero-fill).
        int read(float* samples, int maxFrames);

        /// Number of frames available for reading right now.
        int availableFrames() const;

        /// Reset both counters to zero. NOT thread-safe — call only when
        /// both producer and consumer are known to be idle.
        void reset();

    private:
        std::vector<float> buffer_;
        int capacityFrames_;
        int channels_;

        // Separate cache lines to avoid false sharing.
        alignas(64) std::atomic<uint64_t> head_{0};   // written by producer
        alignas(64) std::atomic<uint64_t> tail_{0};   // written by consumer
    };

    // ── Static Callback Adapters ──────────────────────────────────────────
    // WASAPI exclusive calls these from its render thread.  We cast the
    // void* userData back to a WasapiExclusiveBackend* and route into the
    // instance's ring buffer.
    static unsigned int renderCallback(void* userData,
                                       float* output,
                                       unsigned int frameCount,
                                       unsigned int channels);

    // ── Members ───────────────────────────────────────────────────────────
#ifdef _WIN32
    wasapi_exclusive_runtime* runtime_ = nullptr;
#else
    void* runtime_ = nullptr;
#endif

    DeviceInfo deviceInfo_;
    int sampleRate_ = 0;
    int channels_ = 0;
    int bufferFrames_ = 0;
    bool isOpen_ = false;

    std::unique_ptr<AudioRingBuffer> ringBuffer_;

    // Error buffer for the underlying C API.
    char lastError_[256] = {};
};

} // namespace echo_audio_daemon
