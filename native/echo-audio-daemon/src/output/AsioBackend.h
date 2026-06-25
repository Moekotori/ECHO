#pragma once

#include "OutputDevice.h"

#include <memory>
#include <string>

namespace echo_audio_daemon {

// ── ASIO Audio Output Backend ─────────────────────────────────────────────────
// Wraps the raw Steinberg ASIO SDK into the OutputDevice interface. Supports
// PCM, DoP (DSD over PCM), and native DSD output modes.
//
// On non-Windows platforms this header resolves to a stub that fails at
// runtime — ASIO is a Windows-only technology.
//
// Thread-safety:
//   open() / close() / setDsdMode() — not safe to call concurrently.
//   write() — safe to call from any thread; internally uses a lock-free or
//             mutex-guarded ring buffer consumed by the ASIO callback thread.
class AsioBackend final : public OutputDevice {
public:
    enum class DsdMode {
        Pcm,       ///< Standard PCM output (float → ASIO sample type)
        Dop,       ///< DSD over PCM (uint32_t markers packed in float*)
        NativeDsd  ///< Native DSD bitstream (uint8_t bytes packed in float*)
    };

    AsioBackend();
    ~AsioBackend() override;

    // ── Lifecycle ─────────────────────────────────────────────────────────

    bool open(const DeviceInfo& device,
              int sampleRate,
              int channels,
              int bufferFrames) override;

    void close() override;

    // ── Data Transfer ─────────────────────────────────────────────────────

    /// Push interleaved float32 samples to the ASIO ring buffer.
    /// In DoP mode the float* pointer is reinterpreted as uint32_t* (caller
    /// must have already encoded DSD markers). In native DSD mode the float*
    /// is reinterpreted as uint8_t* (raw DSD byte frames).
    bool write(const float* samples, int frameCount) override;

    void flush() override;

    // ── State Queries ─────────────────────────────────────────────────────

    bool isOpen() const override;
    int getSampleRate() const override;
    int getChannels() const override;
    int getBufferFrames() const override;
    std::string getBackendName() const override;

    // ── DSD Control ───────────────────────────────────────────────────────

    /// Switch the DSD output mode. Must be called *before* open() or after
    /// close() — changing mode while the device is active is not supported.
    void setDsdMode(DsdMode mode);

    /// Current DSD mode.
    DsdMode getDsdMode() const { return dsdMode_; }

    // ── Device Enumeration (static) ───────────────────────────────────────

    /// Populate the vector with all available ASIO device names.
    /// Returns true if at least one driver was found.
    static bool enumerateDevices(std::vector<DeviceInfo>& outDevices);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;

    DsdMode dsdMode_ = DsdMode::Pcm;

    /// Internal cleanup helper (calls ASIOStop/DisposeBuffers/ASIOExit).
    void cleanUp();
};

} // namespace echo_audio_daemon
