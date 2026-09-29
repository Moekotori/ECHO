#pragma once

#include <atomic>
#include <array>
#include <cstdint>
#include <functional>
#include <mutex>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "../../audio-engine/libav_decoder.h"
#include "../../audio-engine/third_party/nlohmann_json.hpp"
#include "CachePcmProducer.h"
#include "../../audio-engine/LevelMeterProcessor.h"

class AudioDaemon {
public:
    enum class DecodePath {
        StreamingLibav,
        LegacyFullBufferLibav,
    };

    struct SourceHooks {
        std::function<void()> beginSession;
        std::function<void()> continueSessionAfterDrain;
        std::function<void()> markInputEnded;
        std::function<void()> requestStop;
        std::function<void(bool)> setPaused;
        std::function<int(const float* samples, int frames, bool paused)> replaceBufferedAudio;
        std::function<bool(const float* samples, int frames)> push;
        std::function<bool(const float* samples, int frames, uint64_t generation)> pushForGeneration;
        std::function<bool()> prepareGapless;
        std::function<bool(const float* samples, int frames)> pushGaplessNext;
        std::function<void()> markGaplessNextEnded;
        std::function<void()> cancelGapless;
        std::function<uint64_t()> gaplessBoundaryFrame;
        std::function<bool(uint64_t, uint64_t, double, double, double, double)> prepareAutomixFrames;
        std::function<bool(const float* samples, int frames)> pushAutomixNext;
        std::function<void()> markAutomixNextEnded;
        std::function<void()> cancelAutomix;
        std::function<void(uint64_t)> failAutomixNext;
        std::function<uint64_t()> automixFadeStartFrame;
        std::function<uint64_t()> automixFadeEndFrame;
        std::function<bool()> automixActive;
        std::function<uint64_t()> generation;
        std::function<void(float)> setVolume;
        std::function<int(int outputSampleRate)> decoderSampleRateFor;
        std::function<nlohmann::json()> processingTelemetry;
        std::function<int()> seekPrerollFrames;
        std::function<int(
            const float* samples,
            int frames,
            int prerollFrames,
            bool paused)> replaceBufferedAudioWithPreroll;
        std::function<bool(int targetSampleRate, nlohmann::json& result, std::string& error)> reconfigureOutputSampleRate;
        std::function<bool()> strictOutputSampleRateTransition;
    };

    // Queue state for autonomous track advancement
    struct QueueItem {
        std::string itemId;
        std::string trackId;
        std::string filePath;
        std::string title;
        std::string artist;
        std::string album;
        std::string albumArtist;
        std::string coverUrl;
        int targetSampleRate = 0;
        double startSeconds = 0.0;
    };

    AudioDaemon(SourceHooks source,
                int actualSampleRate,
                int stdoutFd,
                std::atomic<bool>& shutdownRequested,
                DecodePath decodePath = DecodePath::StreamingLibav,
                int outputChannels = 2);

    void initialize();
    void emitPosition(uint64_t framesPlayed, int bufferedFrames, bool inputEnded);
    void emitFirstPcm(uint64_t operationId);
    void emitEnded();
    void queueLevelMeter(const echo::LevelMeterSnapshot& snapshot) noexcept;
    void flushLevelMeter();

#ifdef ECHO_AUDIO_ENGINE_TESTS
    void stopForTests(nlohmann::json& result) { onStop(result); }
    bool hasPendingQueueAdvanceForTests()
    {
        std::lock_guard<std::mutex> lock(operationMutex_);
        return pendingQueueAdvance_.has_value();
    }
#endif

    // Queue state for autonomous track advancement
    bool onQueueSet(
        const nlohmann::json& items,
        const std::string& repeatMode,
        uint64_t revision,
        const std::string& currentItemId);
    void onQueueClear();

private:
    // Callback handlers
    bool onOpenFile(const std::string& filePath, int targetSampleRate, double requestedStartSeconds, nlohmann::json& result,
                    bool autonomousAdvance = false, uint64_t expectedCompletedOperationId = UINT64_MAX);
    bool onOpenSource(const nlohmann::json& source, int targetSampleRate, double requestedStartSeconds, nlohmann::json& result);
    void onPause(bool pause);
    bool onSeek(double positionSeconds, nlohmann::json& result);
    void onStop(nlohmann::json& result);
    bool onPrefetch(const std::string& filePath, int targetSampleRate);
    bool onGaplessPrepare(const nlohmann::json& request, nlohmann::json& result);
    bool onAutomixPrepare(const nlohmann::json& request, nlohmann::json& result);
    bool onAutomixCancel(const std::string& planId, nlohmann::json& result);
    nlohmann::json onAutomixState();
    void onSetVolume(float volume);
    void stopDecodeThreadLocked();
    void stopProducersLocked();
    uint64_t cancelPendingQueueAdvanceLocked();
    void emitAudioError(uint64_t operationId, const std::string& message);
    void emitEndedForOperation(uint64_t operationId);
    bool shouldUseStreamingDecode() const;

    // Queue for autonomous advancement
    bool tryAutoAdvance(uint64_t completedOperationId);
    bool maybeCommitGaplessAdvance(uint64_t absoluteFramesPlayed, nlohmann::json& nextTrackInfo);
    void maybeCommitAutomix(uint64_t absoluteFramesPlayed);
    void emitEndedWithAdvance(const nlohmann::json& nextTrackInfo);
    void cancelGaplessLocked();
    void cancelAutomixLocked(const std::string& reason);

    // Signal handling
    static void daemonSignalHandler(int signum);

    // Cache
    struct CachedTrack {
        std::shared_ptr<const std::vector<float>> samples;
        int sampleRate = 0;
        int channels = 0;
        double durationSeconds = 0.0;
        double startSeconds = 0.0;
        echo::AudioProbe probe;
        bool complete = false;
        double cachedStartSeconds = 0.0;
        double cachedDurationSeconds = 0.0;
        double fullDurationSeconds = 0.0;
    };
    std::unordered_map<std::string, std::shared_ptr<const CachedTrack>> cache_;
    std::mutex cacheMutex_;

    // State
    std::string currentFilePath_;
    echo::LibavInputOptions currentInputOptions_;
    std::mutex operationMutex_;
    std::atomic<uint64_t> operationId_{0};
    std::jthread decodeThread_;
    std::shared_ptr<echo::LibavPcmStreamDecoder> activeStream_;
    std::jthread prefetchThread_;
    std::jthread gaplessThread_;
    std::shared_ptr<echo::LibavPcmStreamDecoder> activeGaplessStream_;
    SourceHooks source_;
    CachePcmProducer cacheProducer_;
    int sampleRate_;
    int outputChannels_ = 2;
    int stdoutFd_;
    DecodePath decodePath_ = DecodePath::StreamingLibav;
    bool paused_ = false;

    // Shared shutdown signal (set by signal handler, read by main loop)
    std::atomic<bool>* shutdownSignal_;

    // Mutex for thread-safe RPC writes on stdoutFd_
    std::mutex rpcWriteMutex_;
    std::mutex endedNotificationMutex_;
    uint64_t endedNotifiedOperationId_ = UINT64_MAX;
    uint64_t firstPcmNotifiedOperationId_ = UINT64_MAX;
    uint64_t startedNotifiedOperationId_ = UINT64_MAX;
    static constexpr size_t maximumLevelMeterChannels_ = 32;
    std::array<std::atomic<float>, maximumLevelMeterChannels_> pendingLevelMeterPeakDb_ {};
    std::array<std::atomic<float>, maximumLevelMeterChannels_> pendingLevelMeterRmsDb_ {};
    std::atomic<size_t> pendingLevelMeterChannels_ { 0 };
    std::atomic<double> pendingLevelMeterTimestampMs_ { 0.0 };
    std::atomic<uint64_t> pendingLevelMeterOperationId_ { 0 };
    std::atomic<uint64_t> pendingLevelMeterSequence_ { 0 };
    uint64_t flushedLevelMeterSequence_ = 0;
    // Operation-scoped: a later explicit open naturally makes an older stop
    // marker irrelevant without mutating the synchronized queue snapshot.
    std::atomic<uint64_t> autoAdvanceSuppressedOperationId_{UINT64_MAX};
    std::atomic<uint64_t> positionFrameOffset_{0};
    std::atomic<double> positionFrameScale_{1.0};
    std::atomic<uint64_t> gaplessPreparationId_{0};

    struct PendingQueueAdvance {
        uint64_t fromOperationId = 0;
        uint64_t targetOperationId = 0;
        nlohmann::json payload;
    };
    std::optional<PendingQueueAdvance> pendingQueueAdvance_;

    struct PreparedGaplessTrack {
        uint64_t startFrameAfterBoundary = 0;
        nlohmann::json trackInfo;
    };

    struct PreparedGaplessTransition {
        bool active = false;
        uint64_t currentOperationId = 0;
        size_t nextTransitionIndex = 0;
        std::vector<PreparedGaplessTrack> tracks;
    };
    std::mutex gaplessStateMutex_;
    PreparedGaplessTransition preparedGapless_;

    struct PreparedAutomixTransition {
        std::string state = "idle";
        std::string planId;
        std::string reason;
        uint64_t queueRevision = 0;
        uint64_t operationId = 0;
        uint64_t fadeStartFrame = 0;
        uint64_t fadeEndFrame = 0;
        uint64_t commitFrame = 0;
        double nextStartSeconds = 0.0;
        bool commitEmitted = false;
        nlohmann::json plan;
        nlohmann::json nextTrackInfo;
    };
    std::mutex automixStateMutex_;
    PreparedAutomixTransition preparedAutomix_;
    std::jthread automixThread_;
    std::shared_ptr<echo::LibavPcmStreamDecoder> activeAutomixStream_;
    std::atomic<uint64_t> automixPreparationId_{0};

    // Queue for autonomous track advancement
    std::vector<QueueItem> queue_;
    std::mutex queueMutex_;
    int currentQueueIndex_ = -1;
    std::string repeatMode_ = "off";
    uint64_t queueRevision_ = 0;
};
