// ── Miniaudio Audio Output Backend ──────────────────────────────────────────
// Implements the OutputDevice interface using the vendored miniaudio library.
// Uses a lock-free SPSC ring buffer (via ma_pcm_rb) so that the audio callback
// never blocks.  Device IDs are hex-encoded ma_device_id unions and stored in
// DeviceInfo.id for round-trip fidelity between enumerate() and open().

#include "MiniaudioBackend.h"

#include <algorithm>
#include <cstring>
#include <iostream>

namespace echo_audio_daemon {

// ═════════════════════════════════════════════════════════════════════════════
// Construction / Destruction
// ═════════════════════════════════════════════════════════════════════════════

MiniaudioBackend::MiniaudioBackend() {
    std::memset(&device_, 0, sizeof(device_));
    std::memset(&context_, 0, sizeof(context_));
    std::memset(&ringBuffer_, 0, sizeof(ringBuffer_));
}

MiniaudioBackend::~MiniaudioBackend() {
    close();
}

// ═════════════════════════════════════════════════════════════════════════════
// Device ID Encoding / Decoding
// ═════════════════════════════════════════════════════════════════════════════

std::string MiniaudioBackend::encodeDeviceId(const ma_device_id& id) {
    static const char hex[] = "0123456789abcdef";
    std::string result(sizeof(ma_device_id) * 2, '\0');
    const auto* bytes = reinterpret_cast<const unsigned char*>(&id);
    for (size_t i = 0; i < sizeof(ma_device_id); ++i) {
        result[i * 2]     = hex[bytes[i] >> 4];
        result[i * 2 + 1] = hex[bytes[i] & 0x0F];
    }
    return result;
}

bool MiniaudioBackend::decodeDeviceId(const std::string& str, ma_device_id& id) {
    if (str.size() != sizeof(ma_device_id) * 2) {
        return false;
    }
    auto* bytes = reinterpret_cast<unsigned char*>(&id);
    for (size_t i = 0; i < sizeof(ma_device_id); ++i) {
        auto hexToNibble = [](char c) -> unsigned char {
            if (c >= '0' && c <= '9') return static_cast<unsigned char>(c - '0');
            if (c >= 'a' && c <= 'f') return static_cast<unsigned char>(c - 'a' + 10);
            if (c >= 'A' && c <= 'F') return static_cast<unsigned char>(c - 'A' + 10);
            return 0;
        };
        bytes[i] = (hexToNibble(str[i * 2]) << 4) | hexToNibble(str[i * 2 + 1]);
    }
    return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Static: Device Enumeration
// ═════════════════════════════════════════════════════════════════════════════

std::vector<DeviceInfo> MiniaudioBackend::enumerate() {
    std::vector<DeviceInfo> result;

    ma_context context;
    if (ma_context_init(nullptr, 0, nullptr, &context) != MA_SUCCESS) {
        // No audio backend available (headless CI, etc.)
        return result;
    }

    ma_device_info* pPlaybackInfos = nullptr;
    ma_uint32 playbackCount = 0;

    if (ma_context_get_devices(&context,
                               &pPlaybackInfos,
                               &playbackCount,
                               nullptr,
                               nullptr) == MA_SUCCESS) {
        for (ma_uint32 i = 0; i < playbackCount; ++i) {
            DeviceInfo info;
            info.id          = encodeDeviceId(pPlaybackInfos[i].id);
            info.name        = pPlaybackInfos[i].name;
            info.outputMode  = OutputMode::Shared;
            info.isDefault   = (pPlaybackInfos[i].isDefault != MA_FALSE);
            info.channels    = 2;   // unknown at enum time; set on open()
            info.sampleRate  = 0;
            result.push_back(info);
        }
    }

    ma_context_uninit(&context);
    return result;
}

DeviceInfo MiniaudioBackend::getDefaultDevice() {
    auto devices = enumerate();
    for (const auto& d : devices) {
        if (d.isDefault) return d;
    }
    // Fallback: return first device (or empty if none)
    if (!devices.empty()) return devices.front();
    return DeviceInfo{};
}

// ═════════════════════════════════════════════════════════════════════════════
// Lifecycle: open / close
// ═════════════════════════════════════════════════════════════════════════════

bool MiniaudioBackend::open(const DeviceInfo& device,
                            int sampleRate,
                            int channels,
                            int bufferFrames) {
    // Close any previous session cleanly
    if (deviceInitialized_.load()) {
        close();
    }

    sampleRate_    = sampleRate;
    channels_      = channels;
    bufferFrames_  = bufferFrames;

    // ── Decode device ID ──────────────────────────────────────────────
    // If the ID doesn't decode (empty / mismatched size), use default device.
    bool useDefaultDevice = !decodeDeviceId(device.id, deviceId_);

    // ── Configure miniaudio device ────────────────────────────────────
    deviceConfig_ = ma_device_config_init(ma_device_type_playback);
    deviceConfig_.playback.pDeviceID = useDefaultDevice ? nullptr : &deviceId_;
    deviceConfig_.playback.format    = ma_format_f32;
    deviceConfig_.playback.channels  = static_cast<ma_uint32>(channels);
    deviceConfig_.playback.shareMode = ma_share_mode_shared;
    deviceConfig_.sampleRate         = static_cast<ma_uint32>(sampleRate);
    deviceConfig_.periodSizeInFrames = static_cast<ma_uint32>(bufferFrames);
    deviceConfig_.dataCallback       = dataCallback;
    deviceConfig_.notificationCallback = notificationCallback;
    deviceConfig_.pUserData          = this;

    // ── Initialize context (lazy, once) ───────────────────────────────
    if (!contextInitialized_) {
        if (ma_context_init(nullptr, 0, nullptr, &context_) != MA_SUCCESS) {
            std::cerr << "[MiniaudioBackend] Failed to init context\n";
            return false;
        }
        contextInitialized_ = true;
    }

    // ── Initialize device ─────────────────────────────────────────────
    if (ma_device_init(&context_, &deviceConfig_, &device_) != MA_SUCCESS) {
        std::cerr << "[MiniaudioBackend] Failed to init device\n";
        return false;
    }

    // ── Initialize ring buffer (4× period size for safety margin) ─────
    ma_uint32 rbFrames = std::max(static_cast<ma_uint32>(bufferFrames * 4),
                                  static_cast<ma_uint32>(256)); // floor
    if (ma_pcm_rb_init(ma_format_f32,
                       static_cast<ma_uint32>(channels),
                       rbFrames,
                       nullptr,
                       nullptr,
                       &ringBuffer_) != MA_SUCCESS) {
        std::cerr << "[MiniaudioBackend] Failed to init ring buffer\n";
        ma_device_uninit(&device_);
        return false;
    }

    // ── Start device ──────────────────────────────────────────────────
    if (ma_device_start(&device_) != MA_SUCCESS) {
        std::cerr << "[MiniaudioBackend] Failed to start device\n";
        ma_pcm_rb_uninit(&ringBuffer_);
        ma_device_uninit(&device_);
        return false;
    }

    deviceInitialized_.store(true);

    // Update bufferFrames_ with actual period size from miniaudio
    bufferFrames_ = static_cast<int>(device_.playback.internalPeriodSizeInFrames);

    return true;
}

void MiniaudioBackend::close() {
    if (!deviceInitialized_.load()) {
        return;
    }

    deviceInitialized_.store(false);

    ma_device_stop(&device_);
    ma_pcm_rb_uninit(&ringBuffer_);
    ma_device_uninit(&device_);

    sampleRate_   = 0;
    channels_     = 0;
    bufferFrames_ = 0;

    // Keep context alive for potential re-open
}

// ═════════════════════════════════════════════════════════════════════════════
// Data Transfer
// ═════════════════════════════════════════════════════════════════════════════

bool MiniaudioBackend::write(const float* samples, int frameCount) {
    if (!deviceInitialized_.load()) {
        return false;
    }

    ma_uint32 totalWritten = 0;
    while (totalWritten < static_cast<ma_uint32>(frameCount)) {
        ma_uint32 framesToWrite =
            static_cast<ma_uint32>(frameCount) - totalWritten;
        void* pWriteBuffer = nullptr;

        ma_result res = ma_pcm_rb_acquire_write(&ringBuffer_,
                                                 &framesToWrite,
                                                 &pWriteBuffer);
        if (res != MA_SUCCESS || framesToWrite == 0) {
            // Ring buffer full — indicate backpressure to caller
            return totalWritten > 0;
        }

        std::memcpy(pWriteBuffer,
                    samples + totalWritten * channels_,
                    framesToWrite * channels_ * sizeof(float));

        ma_pcm_rb_commit_write(&ringBuffer_, framesToWrite);
        totalWritten += framesToWrite;
    }

    return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Miniaudio Callbacks (called from audio thread — MUST NOT BLOCK)
// ═════════════════════════════════════════════════════════════════════════════

void MiniaudioBackend::dataCallback(ma_device* pDevice,
                                    void* pOutput,
                                    const void* /*pInput*/,
                                    ma_uint32 frameCount) {
    static std::atomic<int> cbCnt{0};
    if (++cbCnt % 100 == 0) std::cerr << "[miniaudio] callback #" << cbCnt << "\n";

    auto* self = static_cast<MiniaudioBackend*>(pDevice->pUserData);
    auto* output = static_cast<float*>(pOutput);
    const int channels = self->channels_;

    ma_uint32 totalRead = 0;
    while (totalRead < frameCount) {
        ma_uint32 framesToRead = frameCount - totalRead;
        void* readBuffer = nullptr;

        ma_result res = ma_pcm_rb_acquire_read(&self->ringBuffer_,
                                                &framesToRead,
                                                &readBuffer);
        const void* pReadBuffer = readBuffer;
        if (res != MA_SUCCESS || framesToRead == 0) {
            break; // no more data
        }

        std::memcpy(output + totalRead * channels,
                    pReadBuffer,
                    framesToRead * channels * sizeof(float));

        ma_pcm_rb_commit_read(&self->ringBuffer_, framesToRead);
        totalRead += framesToRead;
    }

    // Fill any remaining frames with silence
    if (totalRead < frameCount) {
        std::memset(output + totalRead * channels,
                    0,
                    (frameCount - totalRead) * channels * sizeof(float));
    }
}

void MiniaudioBackend::notificationCallback(
    const ma_device_notification* pNotification) {
    // Reserved for future disconnect / reroute handling.
    // miniaudio handles re-initialization internally for most events.
    (void)pNotification;
}

} // namespace echo_audio_daemon
