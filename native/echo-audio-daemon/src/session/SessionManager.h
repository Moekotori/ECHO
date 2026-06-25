#pragma once

#include <atomic>
#include <chrono>
#include <cmath>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

#include "src/common/AudioTypes.h"
#include "src/decoder/AvDecoder.h"
#include "src/dsp/DspPipeline.h"
#include "src/ipc/JsonRpcServer.h"
#include "src/output/OutputDevice.h"

using json = nlohmann::json;

namespace echo_audio_daemon {

// ── Gapless Track Buffer ─────────────────────────────────────────────────────
// Holds pre-decoded audio data for the next track (gapless / automix transition).
struct GaplessBuffer {
    std::vector<float> samples;  // interleaved float32 PCM
    int frames      = 0;
    int channels    = 0;
    int sampleRate  = 0;
    double duration = 0.0;
    std::string path;
    std::string format;
    bool valid = false;
};

// ── Automix Configuration ────────────────────────────────────────────────────
struct AutomixConfig {
    bool   prepared          = false;
    double fadeStartSeconds  = 0.0;
    double overlapSeconds    = 0.0;
    double currentGainDb     = 0.0;
    double nextGainDb        = 0.0;
    std::string mode         = "equalPower"; // "equalPower", "linear", "smooth"
};

// ── SessionManager ───────────────────────────────────────────────────────────
// Playback state machine for the ECHO Audio Daemon.
//
// Manages the full audio lifecycle:
//   play → pause ↔ resume → stop / seek / volume / gapless / automix
//
// Owns a background decode thread that:
//   1. Decodes from AvDecoder
//   2. Applies volume gain
//   3. Processes through DspPipeline
//   4. Writes to OutputDevice
//   5. Emits position / levelMeter / state events
class SessionManager {
public:
    SessionManager(JsonRpcServer& server, AvDecoder& decoder,
                   DspPipeline& dsp, OutputDevice& output);
    ~SessionManager();

    // Non-copyable, non-movable
    SessionManager(const SessionManager&) = delete;
    SessionManager& operator=(const SessionManager&) = delete;
    SessionManager(SessionManager&&) = delete;
    SessionManager& operator=(SessionManager&&) = delete;

    /// Register all JSON-RPC method handlers with the server.
    void init();

    // ── Handlers (called by JsonRpcServer dispatch) ─────────────────────────

    /// Start playback of a file. Params: { path, startSeconds?, queueNext? }
    json handlePlay(const json& params);

    /// Pause current playback.
    json handlePause(const json& params);

    /// Resume from paused state.
    json handleResume(const json& params);

    /// Stop playback and reset.
    json handleStop(const json& params);

    /// Seek to position (seconds).
    json handleSeek(const json& params);

    /// Set volume [0.0 .. 1.0].
    json handleSetVolume(const json& params);

    /// Queue next track for gapless transition.
    json handleQueueNext(const json& params);

    /// Prepare automix crossfade parameters.
    json handlePrepareAutomix(const json& params);

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /// Shutdown: stop playback, join thread, release resources.
    void shutdown();

    // ── State queries (thread-safe) ───────────────────────────────────────

    PlaybackState getState() const { return state_.load(); }
    double       getVolume() const { return volume_.load(); }
    uint64_t     getFramesPlayed() const { return framesPlayed_.load(); }
    int          getSampleRate() const { return sampleRate_; }
    int          getChannels() const { return channels_; }
    double       getDuration() const { return duration_; }
    int          getUnderrunCount() const { return underrunCount_; }
    bool         isPlaying() const { return state_.load() == PlaybackState::Playing; }
    bool         isPaused() const  { return state_.load() == PlaybackState::Paused; }
    bool         isStopped() const { return state_.load() == PlaybackState::Stopped; }
    const std::string& getCurrentPath() const { return currentPath_; }

    /// Convert PlaybackState to protocol string (public for testing/status).
    static std::string stateToString(PlaybackState state);

    // ── Level meter subscription ──────────────────────────────────────────

    void setLevelMeterSubscribed(bool subscribed) { levelMeterSubscribed_ = subscribed; }
    bool isLevelMeterSubscribed() const { return levelMeterSubscribed_.load(); }

private:
    // ── Playback Loop ────────────────────────────────────────────────────

    /// Background thread: decode → gain → DSP → output → events.
    void playbackLoop();

    /// Apply volume gain and optional automix crossfade gain.
    void applyGain(float* samples, int frameCount);

    // ── Event Emission ──────────────────────────────────────────────────

    void emitState();
    void emitPosition();
    void emitTrackEnded();
    void emitTrackStarted();
    void computeAndEmitLevelMeter(const float* samples, int frameCount);

    // ── Internal Helpers ────────────────────────────────────────────────

    void transitionTo(PlaybackState newState);
    void startPlayback(const std::string& path, double startSeconds);
    void stopPlayback();
    bool tryGaplessTransition();
    bool queueNextTrack(const std::string& path, double startSeconds);

    // ── References ───────────────────────────────────────────────────────

    JsonRpcServer& server_;
    AvDecoder&     decoder_;
    DspPipeline&   dsp_;
    OutputDevice&  output_;

    // ── State ───────────────────────────────────────────────────────────

    std::atomic<PlaybackState> state_{PlaybackState::Stopped};
    std::atomic<double>        volume_{1.0};
    std::atomic<uint64_t>      framesPlayed_{0};

    // Track info (set before thread start, accessed by loop)
    std::string currentPath_;
    std::string currentFormat_;
    int  sampleRate_         = 44100;
    int  channels_           = 2;
    double duration_         = 0.0;

    // Output config
    int  outputSampleRate_   = 44100;
    int  outputChannels_     = 2;
    int  bufferFrames_       = 512;

    // Underrun
    int underrunCount_       = 0;

    // ── Threading ───────────────────────────────────────────────────────

    std::thread playbackThread_;
    std::atomic<bool> stopRequested_{false};

    // ── Gapless ─────────────────────────────────────────────────────────

    GaplessBuffer gapless_;

    // ── Automix ─────────────────────────────────────────────────────────

    AutomixConfig automix_;

    // ── Level Meter ─────────────────────────────────────────────────────

    std::atomic<bool> levelMeterSubscribed_{false};
    int levelMeterIntervalMs_ = 100;

    // ── Timing (local throttling to reduce event spam on server) ────────

    std::chrono::steady_clock::time_point lastPositionEmit_;
    std::chrono::steady_clock::time_point lastLevelMeterEmit_;
};

} // namespace echo_audio_daemon
