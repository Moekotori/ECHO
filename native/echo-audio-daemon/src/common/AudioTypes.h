#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace echo_audio_daemon {

// ── Playback State ──────────────────────────────────────────────────────────
// Mirrors AudioPlaybackState from shared/types/audio.ts (idle/loading omitted;
// managed externally; Ended signals natural stream termination).
enum class PlaybackState {
    Stopped,
    Playing,
    Paused,
    Ended,
    Error
};

// ── Output Mode ─────────────────────────────────────────────────────────────
// Mirrors AudioOutputMode from shared/types/audio.ts (system folded into
// Shared; daemon manages the distinction internally).
enum class OutputMode {
    Shared,
    Exclusive,
    Asio
};

// ── Audio Format ────────────────────────────────────────────────────────────
// Describes a decoded audio stream's properties.
// Mirrors fields from AudioStatus + AudioProbeResult in audioTypes.ts.
struct AudioFormat {
    std::string format;       // "flac", "mp3", "wav", "aac", "ogg", "wma", etc.
    int sampleRate = 0;       // Hz
    int channels = 0;         // number of channels
    double duration = 0.0;    // seconds
    int bitRate = 0;          // bits per second (optional; 0 = unknown)
    std::string codec;        // codec name (optional; e.g. "FLAC", "MP3", "AAC")
    bool isDsd = false;       // DSD stream indicator
};

// ── Device Info ─────────────────────────────────────────────────────────────
// Describes an audio output device.
// Mirrors AudioDeviceInfo from shared/types/audio.ts.
struct DeviceInfo {
    std::string id;                    // device identifier
    std::string name;                  // human-readable name
    OutputMode outputMode = OutputMode::Shared;
    int sampleRate = 0;                // current/active sample rate (Hz)
    int sharedSampleRate = 0;          // shared-mode mix rate (Hz)
    int channels = 2;                  // output channel count
    bool isDefault = false;            // system default device
    int asioOutputChannels = 0;        // ASIO output channel count (0 = not ASIO)
};

// ── Decoder Session ─────────────────────────────────────────────────────────
// Runtime state of an active decode session.
struct DecoderSession {
    std::string filePath;
    AudioFormat format;
    double position = 0.0;     // current decode position (seconds)
    double speed = 1.0;        // playback speed factor
    bool seekable = false;
    bool gaplessReady = false; // next track pre-decoded for gapless transition
    int bitDepth = 0;          // 16, 24, 32
};

// ── DSP State ───────────────────────────────────────────────────────────────
// Mirrors DSP-related fields from AudioStatus (dspClippingRisk,
// dspLimiterProtecting, dspHeadroomDb, eqEnabled, channelBalanceEnabled).
struct DspState {
    bool eqEnabled = false;
    bool convolutionEnabled = false;
    bool channelBalanceEnabled = false;
    bool clippingRisk = false;         // DSP output approaching clipping
    bool limiterProtecting = false;    // limiter actively reducing gain
    double headroomDb = 0.0;          // available headroom before clipping
};

} // namespace echo_audio_daemon
