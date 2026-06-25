#include "src/session/SessionManager.h"

#include <algorithm>
#include <iostream>

namespace echo_audio_daemon {

// ═════════════════════════════════════════════════════════════════════════════
// Construction / Destruction
// ═════════════════════════════════════════════════════════════════════════════

SessionManager::SessionManager(JsonRpcServer& server, AvDecoder& decoder,
                               DspPipeline& dsp, OutputDevice& output)
    : server_(server)
    , decoder_(decoder)
    , dsp_(dsp)
    , output_(output)
{
}

SessionManager::~SessionManager() {
    shutdown();
}

// ═════════════════════════════════════════════════════════════════════════════
// init() — Register all JSON-RPC handlers
// ═════════════════════════════════════════════════════════════════════════════

void SessionManager::init() {
    // Playback
    server_.registerMethod(std::string(METHOD_PLAY),  [this](const json& p) { return handlePlay(p); });
    server_.registerMethod(std::string(METHOD_PAUSE), [this](const json& p) { return handlePause(p); });
    server_.registerMethod(std::string(METHOD_RESUME),[this](const json& p) { return handleResume(p); });
    server_.registerMethod(std::string(METHOD_STOP),  [this](const json& p) { return handleStop(p); });
    server_.registerMethod(std::string(METHOD_SEEK),  [this](const json& p) { return handleSeek(p); });
    server_.registerMethod(std::string(METHOD_SET_VOLUME), [this](const json& p) { return handleSetVolume(p); });
    server_.registerMethod(std::string(METHOD_QUEUE_NEXT),  [this](const json& p) { return handleQueueNext(p); });
    server_.registerMethod(std::string(METHOD_PREPARE_AUTOMIX), [this](const json& p) { return handlePrepareAutomix(p); });

    // Level meter subscription
    server_.registerMethod(std::string(METHOD_LEVEL_METER_SUBSCRIBE),   [this](const json& params) -> json {
        int intervalMs = static_cast<int>(getParamDoubleOpt(params, "intervalMs", 100.0));
        intervalMs = std::max(50, intervalMs);
        levelMeterSubscribed_ = true;
        levelMeterIntervalMs_ = intervalMs;
        return json{{"subscribed", true}};
    });
    server_.registerMethod(std::string(METHOD_LEVEL_METER_UNSUBSCRIBE), [this](const json&) -> json {
        levelMeterSubscribed_ = false;
        return json{{"subscribed", false}};
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// Handler Implementations
// ═════════════════════════════════════════════════════════════════════════════

json SessionManager::handlePlay(const json& params) {
    // Stop any current playback
    if (playbackThread_.joinable()) {
        stopPlayback();
    }

    std::string path = getParamString(params, "path");
    double startSeconds = getParamDoubleOpt(params, "startSeconds", 0.0);

    // Open decoder
    if (!decoder_.open(path, 0, 0)) {
        return json{
            {"error", json{{"code", -32002}, {"message", "Decode error: failed to open file: " + path}}}
        };
    }

    // Read track properties (decode probe for format string)
    auto probeResult = AvDecoder::probe(path);
    sampleRate_      = decoder_.getSampleRate();
    channels_        = decoder_.getChannels();
    duration_        = decoder_.getDuration();
    currentPath_     = path;
    currentFormat_   = probeResult.format;

    // Determine output format (use decoder's native rate/channels)
    outputSampleRate_ = sampleRate_;
    outputChannels_   = channels_;

    // Open output device
    DeviceInfo devInfo;
    devInfo.id   = "default";
    devInfo.name = "Default Output";
    if (!output_.isOpen()) {
        if (!output_.open(devInfo, outputSampleRate_, outputChannels_, bufferFrames_)) {
            decoder_.close();
            return json{
                {"error", json{{"code", -32001}, {"message", "Device unavailable"}}}
            };
        }
    }

    // Prepare DSP
    dsp_.prepare(outputSampleRate_, bufferFrames_, outputChannels_);

    // Handle startSeconds seek
    if (startSeconds > 0.0) {
        decoder_.seek(startSeconds);
    }

    // Reset state
    framesPlayed_ = 0;
    underrunCount_ = 0;
    stopRequested_ = false;
    lastPositionEmit_ = std::chrono::steady_clock::time_point{};

    // Handle optional queueNext
    auto qnIt = params.find("queueNext");
    if (qnIt != params.end() && qnIt->is_object()) {
        std::string nextPath = getParamString(*qnIt, "path");
        double nextStart = getParamDoubleOpt(*qnIt, "startSeconds", 0.0);
        queueNextTrack(nextPath, nextStart);
    }

    // Start playback thread
    state_ = PlaybackState::Playing;
    playbackThread_ = std::thread(&SessionManager::playbackLoop, this);

    // Emit events
    emitTrackStarted();
    emitState();

    return json{{"status", "playing"}};
}

json SessionManager::handlePause(const json& /*params*/) {
    auto s = state_.load();
    if (s != PlaybackState::Playing) {
        return json{{"status", stateToString(s)}};
    }

    transitionTo(PlaybackState::Paused);
    emitState();
    return json{{"status", "paused"}};
}

json SessionManager::handleResume(const json& /*params*/) {
    auto s = state_.load();
    if (s != PlaybackState::Paused) {
        if (s == PlaybackState::Stopped || s == PlaybackState::Ended) {
            return json{
                {"error", json{{"code", -32001}, {"message", "Device unavailable: no active playback session"}}}
            };
        }
        return json{{"status", stateToString(s)}};
    }

    if (!output_.isOpen()) {
        return json{
            {"error", json{{"code", -32001}, {"message", "Device unavailable: output device not open"}}}
        };
    }

    transitionTo(PlaybackState::Playing);
    emitState();
    return json{{"status", "playing"}};
}

json SessionManager::handleStop(const json& /*params*/) {
    stopPlayback();
    return json{{"status", "stopped"}};
}

json SessionManager::handleSeek(const json& params) {
    if (state_.load() != PlaybackState::Playing &&
        state_.load() != PlaybackState::Paused) {
        return json{
            {"error", json{{"code", -32004}, {"message", "Seek error: no active playback"}}}
        };
    }

    double seconds = getParamDouble(params, "seconds");
    seconds = std::max(0.0, std::min(seconds, duration_));

    // Seek decoder
    if (!decoder_.seek(seconds)) {
        return json{
            {"error", json{{"code", -32004}, {"message", "Seek error: seek operation failed"}}}
        };
    }

    // Update frame counter to approximate position
    framesPlayed_ = static_cast<uint64_t>(seconds * outputSampleRate_);

    // Flush output buffer if supported
    output_.flush();

    return json{{"status", stateToString(state_.load())}, {"position", seconds}};
}

json SessionManager::handleSetVolume(const json& params) {
    double vol = getParamDouble(params, "volume");
    vol = std::max(0.0, std::min(1.0, vol)); // clamp [0, 1]
    volume_.store(vol);
    return json{{"volume", vol}};
}

json SessionManager::handleQueueNext(const json& params) {
    std::string path = getParamString(params, "path");
    double startSeconds = getParamDoubleOpt(params, "startSeconds", 0.0);

    if (!queueNextTrack(path, startSeconds)) {
        return json{
            {"error", json{{"code", -32002}, {"message", "Decode error: failed to pre-decode next track"}}}
        };
    }

    return json{{"queued", true}};
}

json SessionManager::handlePrepareAutomix(const json& params) {
    automix_.fadeStartSeconds = getParamDouble(params, "fadeStartSeconds");
    automix_.overlapSeconds   = getParamDouble(params, "overlapSeconds");
    automix_.currentGainDb    = getParamDouble(params, "currentGainDb");
    automix_.nextGainDb       = getParamDouble(params, "nextGainDb");
    automix_.mode             = getParamStringOpt(params, "mode", "equalPower");
    automix_.prepared         = true;

    return json{{"prepared", true}};
}

// ═════════════════════════════════════════════════════════════════════════════
// Playback Loop
// ═════════════════════════════════════════════════════════════════════════════

void SessionManager::playbackLoop() {
    constexpr int kBlockSize = 512;
    std::vector<float> buffer(static_cast<size_t>(kBlockSize) * outputChannels_, 0.0f);

    while (!stopRequested_) {
        PlaybackState s = state_.load();

        // Terminal states
        if (s == PlaybackState::Stopped || s == PlaybackState::Error) {
            break;
        }

        // Paused: sleep and re-check
        if (s == PlaybackState::Paused) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }

        // ── Throttle: back off if output buffer has been full ──────────
        if (underrunCount_ > 10) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            underrunCount_ = 0;
        }

        // ── Decode ──────────────────────────────────────────────────────
        int framesDecoded = decoder_.decode(buffer.data(), kBlockSize);

        if (framesDecoded == 0) {
            // End of file — attempt gapless / automix transition
            if (tryGaplessTransition()) {
                dsp_.prepare(outputSampleRate_, kBlockSize, outputChannels_);
                continue;
            }
            // Wait for output to drain remaining buffered data
            for (int drainWait = 0; drainWait < 50; ++drainWait) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                // Try writing silence — if it succeeds, output is still consuming
                std::vector<float> silence(static_cast<size_t>(kBlockSize) * outputChannels_, 0.0f);
                if (output_.write(silence.data(), kBlockSize)) {
                    continue; // output still alive, keep waiting
                }
            }
            // No next track — track ended naturally
            transitionTo(PlaybackState::Ended);
            emitTrackEnded();
            emitPosition(); // final position
            break;
        }

        // ── Apply Gain (volume + automix crossfade) ─────────────────────
        applyGain(buffer.data(), framesDecoded);

        // ── DSP Processing ──────────────────────────────────────────────
        dsp_.processBlock(buffer.data(), framesDecoded, outputChannels_);

        // ── Level Meter ─────────────────────────────────────────────────
        auto now = std::chrono::steady_clock::now();
        if (levelMeterSubscribed_.load()) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                now - lastLevelMeterEmit_);
            if (elapsed.count() >= levelMeterIntervalMs_) {
                computeAndEmitLevelMeter(buffer.data(), framesDecoded);
                lastLevelMeterEmit_ = now;
            }
        }

        // ── Write to Output ─────────────────────────────────────────────
        while (!output_.write(buffer.data(), framesDecoded)) {
            ++underrunCount_;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }

        // ── Position Tracking ──────────────────────────────────────────
        framesPlayed_ += framesDecoded;

        // ── Position Event ─────────────────────────────────────────────
        if (now - lastPositionEmit_ >= std::chrono::milliseconds(100)) {
            emitPosition();
            lastPositionEmit_ = now;
        }
    }

    // Thread exit cleanup
    if (state_.load() != PlaybackState::Stopped &&
        state_.load() != PlaybackState::Ended &&
        state_.load() != PlaybackState::Error) {
        // Only transition if not already in a terminal state via another path
        if (!stopRequested_) {
            transitionTo(PlaybackState::Ended);
            emitTrackEnded();
        }
    }
    // output_ stays open for gapless transitions; stopPlayback() closes it.
}

// ═════════════════════════════════════════════════════════════════════════════
// Gapless / Automix Transition
// ═════════════════════════════════════════════════════════════════════════════

bool SessionManager::tryGaplessTransition() {
    if (!gapless_.valid || gapless_.frames == 0) {
        return false;
    }

    // ── Apply automix crossfade gains during transition ────────────────
    // For the pre-decoded gapless buffer, apply the next track's automix gain
    if (automix_.prepared) {
        double gainLinear = std::pow(10.0, automix_.nextGainDb / 20.0);
        for (int i = 0; i < gapless_.frames * gapless_.channels; ++i) {
            gapless_.samples[i] *= static_cast<float>(gainLinear);
        }
    }

    // ── Track the transition ───────────────────────────────────────────
    std::string oldPath = currentPath_;

    // Update track info
    currentPath_      = gapless_.path;
    currentFormat_    = gapless_.format;
    sampleRate_       = gapless_.sampleRate;
    channels_         = gapless_.channels;
    duration_         = gapless_.duration;
    framesPlayed_     = 0;
    underrunCount_    = 0;

    // ── Reopen output if format changed ────────────────────────────────
    if (sampleRate_ != outputSampleRate_ || channels_ != outputChannels_) {
        output_.close();
        DeviceInfo devInfo;
        devInfo.id   = "default";
        devInfo.name = "Default Output";
        if (!output_.open(devInfo, sampleRate_, channels_, bufferFrames_)) {
            gapless_.valid = false;
            return false;
        }
        outputSampleRate_ = sampleRate_;
        outputChannels_   = channels_;
    }

    // ── Write the pre-decoded buffer to output ─────────────────────────
    // Process through DSP pipeline
    dsp_.processBlock(gapless_.samples.data(), gapless_.frames, gapless_.channels);

    if (!output_.write(gapless_.samples.data(), gapless_.frames)) {
        ++underrunCount_;
    }
    framesPlayed_ += gapless_.frames;

    // ── Emit events ────────────────────────────────────────────────────
    emitTrackEnded();   // old track ended naturally
    emitTrackStarted(); // new track started
    emitState();
    emitPosition();

    // ── Clear gapless buffer ───────────────────────────────────────────
    gapless_.valid = false;
    gapless_.samples.clear();
    gapless_.frames = 0;

    // Clear automix for next transition
    automix_.prepared = false;

    return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Gain Application (volume + automix crossfade)
// ═════════════════════════════════════════════════════════════════════════════

void SessionManager::applyGain(float* samples, int frameCount) {
    double vol = volume_.load();
    int total = frameCount * outputChannels_;

    if (vol == 1.0 && !automix_.prepared) {
        return; // fast path: no gain adjustment needed
    }

    // Base volume gain
    double gain = vol;

    // Automix crossfade: if we're within the fade window of the track end
    if (automix_.prepared && duration_ > 0.0) {
        double currentSeconds = static_cast<double>(framesPlayed_.load()) / outputSampleRate_;
        double remaining = duration_ - currentSeconds;

        if (remaining <= automix_.fadeStartSeconds && remaining >= -automix_.overlapSeconds) {
            // Normalize fade position: 1.0 = start of fade, 0.0 = end
            double fadePos = 1.0;
            if (automix_.fadeStartSeconds > 0.0) {
                fadePos = remaining / automix_.fadeStartSeconds;
                fadePos = std::max(0.0, std::min(1.0, fadePos));
            }

            // Compute current track fade gain
            double currentFadeGain = 1.0;
            if (automix_.currentGainDb != 0.0) {
                double fadeDb = automix_.currentGainDb * (1.0 - fadePos);
                currentFadeGain = std::pow(10.0, fadeDb / 20.0);
            }

            gain *= currentFadeGain;
        }
    }

    if (gain != 1.0) {
        for (int i = 0; i < total; ++i) {
            samples[i] *= static_cast<float>(gain);
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Queue Next Track (pre-decode for gapless)
// ═════════════════════════════════════════════════════════════════════════════

bool SessionManager::queueNextTrack(const std::string& path, double startSeconds) {
    // Create a temporary decoder for the next track
    AvDecoder tempDecoder;
    if (!tempDecoder.open(path, outputSampleRate_, outputChannels_)) {
        return false;
    }

    // Seek if requested
    if (startSeconds > 0.0) {
        tempDecoder.seek(startSeconds);
    }

    // Decode entire file into buffer
    constexpr int kChunkSize = 4096;
    std::vector<float> tempBuffer(static_cast<size_t>(kChunkSize) * outputChannels_);
    std::vector<float> allSamples;
    int totalFrames = 0;

    while (true) {
        int frames = tempDecoder.decode(tempBuffer.data(), kChunkSize);
        if (frames <= 0) break;

        allSamples.insert(allSamples.end(),
                          tempBuffer.data(),
                          tempBuffer.data() + static_cast<size_t>(frames) * outputChannels_);
        totalFrames += frames;
    }

    if (totalFrames == 0) {
        tempDecoder.close();
        return false;
    }

    // Store in gapless buffer
    gapless_.samples   = std::move(allSamples);
    gapless_.frames    = totalFrames;
    gapless_.channels  = outputChannels_;
    gapless_.sampleRate = outputSampleRate_;
    gapless_.duration  = static_cast<double>(totalFrames) / outputSampleRate_;
    gapless_.path      = path;
    gapless_.format    = AvDecoder::probe(path).format;
    gapless_.valid     = true;

    tempDecoder.close();
    return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═════════════════════════════════════════════════════════════════════════════

void SessionManager::transitionTo(PlaybackState newState) {
    state_.store(newState);
}

void SessionManager::startPlayback(const std::string& path, double startSeconds) {
    // Delegate to handlePlay via init; this is a convenience wrapper
    json params = {{"path", path}};
    if (startSeconds > 0.0) {
        params["startSeconds"] = startSeconds;
    }
    handlePlay(params);
}

void SessionManager::stopPlayback() {
    stopRequested_ = true;

    if (playbackThread_.joinable()) {
        playbackThread_.join();
    }

    // Clean up decoder
    decoder_.close();

    // Close output
    if (output_.isOpen()) {
        output_.close();
    }

    // Reset state
    transitionTo(PlaybackState::Stopped);
    framesPlayed_ = 0;
    underrunCount_ = 0;
    stopRequested_ = false;

    // Clear gapless
    gapless_.valid = false;
    gapless_.samples.clear();
    gapless_.frames = 0;

    // Clear automix
    automix_.prepared = false;

    emitState();
}

void SessionManager::shutdown() {
    stopPlayback();
}

// ═════════════════════════════════════════════════════════════════════════════
// Event Emission
// ═════════════════════════════════════════════════════════════════════════════

void SessionManager::emitState() {
    std::string stateStr = stateToString(state_.load());
    json params = {{"state", stateStr}};

    if (state_.load() == PlaybackState::Error) {
        params["error"] = {{"code", -32000}, {"message", "Playback error"}};
    }

    server_.sendEvent(std::string(EVENT_STATE), params);
}

void SessionManager::emitPosition() {
    double seconds = 0.0;
    if (sampleRate_ > 0) {
        seconds = static_cast<double>(framesPlayed_.load()) / outputSampleRate_;
    }

    json params = {
        {"seconds",  seconds},
        {"duration", duration_},
    };

    if (underrunCount_ > 0) {
        params["underrunCallbacks"] = underrunCount_;
    }

    server_.sendEvent(std::string(EVENT_POSITION), params);
}

void SessionManager::emitTrackEnded() {
    server_.sendEvent(std::string(EVENT_TRACK_ENDED), json::object());
}

void SessionManager::emitTrackStarted() {
    json params = {
        {"filePath", currentPath_},
        {"format",   currentFormat_},
    };
    server_.sendEvent(std::string(EVENT_TRACK_STARTED), params);
}

void SessionManager::computeAndEmitLevelMeter(const float* samples, int frameCount) {
    if (!levelMeterSubscribed_.load()) return;

    float peak = 0.0f;
    double sumSq = 0.0;
    int total = frameCount * outputChannels_;

    std::vector<double> channelPeaks(outputChannels_, 0.0);

    for (int i = 0; i < total; ++i) {
        float absVal = std::fabs(samples[i]);
        peak = std::max(peak, absVal);

        int ch = i % outputChannels_;
        channelPeaks[ch] = std::max(channelPeaks[ch], static_cast<double>(absVal));

        sumSq += static_cast<double>(samples[i]) * samples[i];
    }

    double rms = (total > 0) ? std::sqrt(sumSq / total) : 0.0;

    json chArray = json::array();
    for (int ch = 0; ch < outputChannels_; ++ch) {
        chArray.push_back(channelPeaks[ch]);
    }

    json params = {
        {"peak",     static_cast<double>(peak)},
        {"rms",      rms},
        {"channels", chArray},
    };

    server_.sendEvent(std::string(EVENT_LEVEL_METER), params);
}

// ═════════════════════════════════════════════════════════════════════════════
// Utility
// ═════════════════════════════════════════════════════════════════════════════

std::string SessionManager::stateToString(PlaybackState state) {
    switch (state) {
        case PlaybackState::Stopped: return "stopped";
        case PlaybackState::Playing: return "playing";
        case PlaybackState::Paused:  return "paused";
        case PlaybackState::Ended:   return "ended";
        case PlaybackState::Error:   return "error";
    }
    return "unknown";
}

} // namespace echo_audio_daemon
