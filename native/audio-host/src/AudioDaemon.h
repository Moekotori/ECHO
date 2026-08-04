#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "../../audio-engine/libav_decoder.h"
#include "../../audio-engine/third_party/nlohmann_json.hpp"

class AudioDaemon {
public:
    enum class DecodePath {
        StreamingLibav,
        LegacyFullBufferLibav,
    };

    struct SourceHooks {
        std::function<void()> beginSession;
        std::function<void()> markInputEnded;
        std::function<void()> requestStop;
        std::function<void(bool)> setPaused;
        std::function<int(const float* samples, int frames, bool paused)> replaceBufferedAudio;
        std::function<bool(const float* samples, int frames)> push;
        std::function<uint64_t()> generation;
        std::function<void(float)> setVolume;
    };

    // Queue state for autonomous track advancement
    struct QueueItem {
        std::string filePath;
        int targetSampleRate = 48000;
        double startSeconds = 0.0;
    };

    AudioDaemon(SourceHooks source,
                int actualSampleRate,
                int stdoutFd,
                std::atomic<bool>& shutdownRequested,
                DecodePath decodePath = DecodePath::StreamingLibav);

    void initialize();
    void emitPosition(uint64_t framesPlayed, int bufferedFrames, bool inputEnded);
    void emitEnded();

    // Queue state for autonomous track advancement
    void onQueueSet(const nlohmann::json& items, const std::string& repeatMode);
    void onQueueClear();

private:
    // Callback handlers
    bool onOpenFile(const std::string& filePath, int targetSampleRate, double requestedStartSeconds, nlohmann::json& result);
    void onPause(bool pause);
    bool onSeek(double positionSeconds, nlohmann::json& result);
    void onStop(nlohmann::json& result);
    bool onPrefetch(const std::string& filePath, int targetSampleRate);
    void onSetVolume(float volume);
    void stopDecodeThreadLocked();
    void emitEndedForOperation(uint64_t operationId);
    bool shouldUseStreamingDecode() const;

    // Queue for autonomous advancement
    bool tryAutoAdvance();
    void emitEndedWithAdvance(const nlohmann::json& nextTrackInfo);

    // Signal handling
    static void daemonSignalHandler(int signum);

    // Cache
    struct CachedTrack {
        std::vector<float> samples;
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
    std::unordered_map<std::string, CachedTrack> cache_;
    std::mutex cacheMutex_;

    // State
    std::string currentFilePath_;
    std::mutex operationMutex_;
    std::atomic<uint64_t> operationId_{0};
    std::jthread decodeThread_;
    std::jthread prefetchThread_;
    SourceHooks source_;
    int sampleRate_;
    int stdoutFd_;
    DecodePath decodePath_ = DecodePath::StreamingLibav;
    bool paused_ = false;

    // Shared shutdown signal (set by signal handler, read by main loop)
    std::atomic<bool>* shutdownSignal_;

    // Mutex for thread-safe RPC writes on stdoutFd_
    std::mutex rpcWriteMutex_;
    std::mutex endedNotificationMutex_;
    uint64_t endedNotifiedOperationId_ = UINT64_MAX;

    // Queue for autonomous track advancement
    std::vector<QueueItem> queue_;
    int currentQueueIndex_ = -1;
    std::string repeatMode_ = "off";
};
